// E2Eテスト：本番ビルドを実ブラウザ（Chromium）で操作して確認する。
// 実行: npm run test:e2e   （CHROME_PATH で Chromium の実行ファイルを指定可能）
//
// 外部サイト（キングレコード公式）の画像はテスト中はダミー画像で応答させる。
// ネットワーク遮断（オフライン）時は Service Worker のキャッシュだけで表示できるかを確認する。
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './server.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const APP_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
/** 現在の作品マスターの形態数（v1.2.0：39形態） */
const TOTAL = 39;
const OUT = resolve(process.env.E2E_OUT || resolve(ROOT, 'e2e/output'));
mkdirSync(OUT, { recursive: true });

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log('  ✔', name);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message ?? e).split('\n').slice(0, 6).join(' | ') });
    console.log('  ✘', name, '\n     ', String(e?.message ?? e).split('\n')[0]);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg}: expected ${sb} but got ${sa}`);
}

// ───────── ビルド ─────────
if (!process.env.E2E_SKIP_BUILD) {
  console.log('build v1 …');
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
  console.log('build v2 (更新テスト用) …');
  execSync('npx vite build --outDir dist-e2e-v2', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, APP_VERSION_OVERRIDE: '1.2.0-e2e' } });
}
const server = await startServer(resolve(ROOT, 'dist'), 4173);
const BASE = server.url;

const DUMMY_IMG = readFileSync(resolve(ROOT, 'public/icons/icon-192.png'));
let imageRequests = 0;
let networkDown = false;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

/**
 * @param imagePolicy URL ごとの画像の応答：'ok'（ダミー画像） / '404'（HTMLの404＝実際の公式サイトと同じ挙動） / 'abort'（通信失敗）
 */
async function newDevice(width = 375, height = 812, imagePolicy = () => 'ok') {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    acceptDownloads: true,
    serviceWorkers: 'allow',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
  });
  // 外部通信は遮断（Playwright は後から登録したルートが優先されるため、こちらを先に登録する）
  await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  // ジャケット画像の配信元（キングレコード / 水瀬いのり公式）→ ダミー画像
  // CORSヘッダーなし＝本番と同じ opaque 応答になる
  // ※ リニューアル前の公式サイトの画像（www.inoriminase.com/img/disco/）は、実際と同じく 404 を返す（v1.1.1 からの更新テスト用）
  await ctx.route(/^https:\/\/www\.inoriminase\.com\/img\/disco\//, (route) => {
    if (networkDown) return route.abort('internetdisconnected');
    return route.fulfill({ status: 404, contentType: 'text/html', body: '<html><body>404 Not Found</body></html>' });
  });
  await ctx.route(/^https:\/\/(www\.kingrecords\.co\.jp\/img\/goods|inoriminase\.com\/wp\/wp-content\/uploads)\//, (route) => {
    if (networkDown) return route.abort('internetdisconnected');
    imageRequests++;
    const policy = imagePolicy(route.request().url());
    if (policy === '404') return route.fulfill({ status: 404, contentType: 'text/html', body: '<html><body>404 Not Found</body></html>' });
    if (policy === 'abort') return route.abort('connectionrefused');
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: DUMMY_IMG });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('     [pageerror]', e.message));
  return { ctx, page };
}

const card = (page, id) => page.locator(`[data-testid=release][data-id="${id}"]`);
async function counts(page, id) {
  const vals = await card(page, id).locator('[data-testid=count]').allTextContents();
  return { unopened: Number(vals[0]), opened: Number(vals[1]) };
}
async function tap(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await locator.click();
}
async function plus(page, id, field) {
  const label = field === 'unopened' ? '未開封' : '開封済';
  await tap(card(page, id).locator(`button[aria-label$="${label}を1枚増やす"]`));
}
async function minus(page, id, field) {
  const label = field === 'unopened' ? '未開封' : '開封済';
  await tap(card(page, id).locator(`button[aria-label$="${label}を1枚減らす"]`));
}
async function stats(page) {
  const g = async (id) => (await page.getByTestId(id).textContent()).trim();
  return {
    owned: Number(await g('stat-owned')),
    total: Number(await g('stat-total')),
    unopened: Number(await g('stat-unopened')),
    opened: Number(await g('stat-opened')),
    completion: await g('stat-completion'),
  };
}
const releaseCount = (page) => page.locator('[data-testid=release]').count();
async function openSettings(page) {
  await page.getByRole('button', { name: '設定（バックアップ・復元）' }).click();
  await page.getByRole('heading', { name: '設定' }).waitFor();
}
async function closeTopDialog(page) {
  await page.locator('dialog[open] header button[aria-label="閉じる"]').last().click();
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
}
async function openFilterPanel(page) {
  if ((await page.locator('#filter-panel').count()) === 0) await page.getByRole('button', { name: /絞り込み/ }).click();
}
/** カード内の要素がカードからはみ出していないか・ページに横スクロールが出ていないか */
async function layoutProblems(page) {
  return page.evaluate(() => {
    const problems = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push(`横スクロール発生 ${document.documentElement.scrollWidth}>${window.innerWidth}`);
    for (const c of document.querySelectorAll('[data-testid=release]')) {
      const cr = c.getBoundingClientRect();
      for (const el of c.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > cr.right + 1 || r.left < cr.left - 1) {
          problems.push(`${c.dataset.id}: ${el.tagName}.${String(el.className).slice(0, 30)} がはみ出し`);
          break;
        }
      }
      // ＋−ボタン同士・ラベルが重なっていないか
      const btns = [...c.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      for (let i = 0; i < btns.length; i++)
        for (let j = i + 1; j < btns.length; j++) {
          const a = btns[i];
          const b = btns[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) problems.push(`${c.dataset.id}: ボタンが重なっている`);
        }
      // タップ領域が小さすぎないか
      for (const b of c.querySelectorAll('button')) {
        const r = b.getBoundingClientRect();
        if (r.width < 34 || r.height < 34) problems.push(`${c.dataset.id}: ボタンが小さい ${r.width}x${r.height}`);
      }
    }
    return problems;
  });
}

/** ヘッダーのアプリ名・検索欄のプレースホルダーが途切れていないか */
async function headerProblems(page) {
  return page.evaluate(() => {
    const out = [];
    const h1 = document.querySelector('h1');
    if (h1.scrollWidth > h1.clientWidth + 1) out.push(`アプリ名が途切れている ${h1.scrollWidth}>${h1.clientWidth}`);
    const input = document.querySelector('input[type=search]');
    const cs = getComputedStyle(input);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const need = ctx.measureText(input.placeholder).width;
    const avail = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (need > avail + 1) out.push(`検索欄のプレースホルダーが途切れている ${need.toFixed(0)}>${avail.toFixed(0)}`);
    return out;
  });
}

console.log(`\nE2E: ${BASE}`);

// ═════════ 端末A（旧スマートフォン相当） ═════════
const A = await newDevice();
const pageA = A.page;
let expectedA;
let backupZipPath;
let settingsAtBackup;

await step('全作品一覧（39形態）がグリッド2列で表示される', async () => {
  await pageA.goto(BASE);
  await pageA.locator('[data-testid=release]').first().waitFor();
  eq(await releaseCount(pageA), TOTAL, '件数');
  assert((await pageA.getByTestId('grid').count()) === 1, 'グリッド表示ではない');
  const boxes = await Promise.all([0, 1, 2].map((i) => pageA.locator('[data-testid=release]').nth(i).boundingBox()));
  assert(Math.abs(boxes[0].y - boxes[1].y) < 1 && boxes[1].x > boxes[0].x, '1行目が2列になっていない');
  assert(boxes[2].y > boxes[0].y + 10, '3件目が2行目に来ていない');
  eq((await pageA.locator('[data-testid=release]').first().getAttribute('data-id')), 'KICM-1641', '初期表示の先頭（発売日が古い順）');
  await shot(pageA, '01-grid-initial');
});

await step('ジャケット画像が表示される（全形態）', async () => {
  for (let i = 0; i < 6; i++) {
    await pageA.mouse.wheel(0, 2000);
    await pageA.waitForTimeout(150);
  }
  await pageA.waitForFunction(() => [...document.querySelectorAll('[data-testid=release] img')].every((i) => i.complete), null, { timeout: 15000 });
  const r = await pageA.evaluate(() => {
    const imgs = [...document.querySelectorAll('[data-testid=release] img')];
    return { n: imgs.length, ok: imgs.filter((i) => i.naturalWidth > 0).length };
  });
  eq(r, { n: TOTAL, ok: TOTAL }, '画像');
  await pageA.evaluate(() => window.scrollTo(0, 0));
});

await step('初期状態：全て未所持・集計0・コンプリート率0%', async () => {
  eq(await pageA.getByTestId('badge').filter({ hasText: '未所持' }).count(), TOTAL, '未所持バッジ数');
  eq(await stats(pageA), { owned: 0, total: 0, unopened: 0, opened: 0, completion: '0%' }, '集計');
});

await step('グリッド表示（幅375px）で文字・ボタンがはみ出さない', async () => {
  eq(await layoutProblems(pageA), [], 'レイアウト');
  eq(await headerProblems(pageA), [], 'ヘッダー');
});

await step('未開封・開封済を一覧から直接＋−でき、バッジと集計が即時更新される', async () => {
  await plus(pageA, 'KICM-1641', 'unopened');
  eq(await counts(pageA, 'KICM-1641'), { unopened: 1, opened: 0 }, '＋未開封');
  eq((await card(pageA, 'KICM-1641').getByTestId('badge').textContent()).trim(), '所持 1枚', 'バッジ');
  eq(await stats(pageA), { owned: 1, total: 1, unopened: 1, opened: 0, completion: '2.5%' }, '集計');
  await plus(pageA, 'KICM-1641', 'opened');
  await plus(pageA, 'KICM-1641', 'opened');
  eq((await card(pageA, 'KICM-1641').getByTestId('badge').textContent()).trim(), '所持 3枚', 'バッジ3枚');
  await minus(pageA, 'KICM-1641', 'opened');
  eq(await counts(pageA, 'KICM-1641'), { unopened: 1, opened: 1 }, '−開封済');
  eq(await stats(pageA), { owned: 1, total: 2, unopened: 1, opened: 1, completion: '2.5%' }, '集計2');
  await shot(pageA, '02-after-count');
});

await step('0枚のときは−を押せない（0未満にならない）', async () => {
  const btn = card(pageA, 'KIXM-648').locator('button[aria-label$="未開封を1枚減らす"]');
  assert(await btn.isDisabled(), '−ボタンが無効になっていない');
  await btn.evaluate((el) => el.click()); // 無効ボタンを強制クリックしても変化しない
  eq(await counts(pageA, 'KIXM-648'), { unopened: 0, opened: 0 }, '0のまま');
});

await step('「元に戻す」で直前の変更前に戻る（連続して戻せる）', async () => {
  await plus(pageA, 'KICM-1641', 'unopened');
  await plus(pageA, 'KICM-1641', 'unopened');
  eq(await counts(pageA, 'KICM-1641'), { unopened: 3, opened: 1 }, '準備');
  await pageA.getByRole('button', { name: '元に戻す' }).click();
  eq(await counts(pageA, 'KICM-1641'), { unopened: 2, opened: 1 }, '1回目');
  await pageA.getByRole('button', { name: '元に戻す' }).click();
  eq(await counts(pageA, 'KICM-1641'), { unopened: 1, opened: 1 }, '2回目');
  eq(await stats(pageA), { owned: 1, total: 2, unopened: 1, opened: 1, completion: '2.5%' }, '集計も戻る');
  // 「元に戻す」も保存されている
  const saved = await pageA.evaluate(() => JSON.parse(localStorage.getItem('inori-collection/collection')).items['KICM-1641']);
  eq(saved, { unopened: 1, opened: 1 }, '保存値');
});

await step('再読み込み後も枚数が残る', async () => {
  await plus(pageA, 'KICS-93710', 'unopened');
  await plus(pageA, 'KIXM-648', 'opened');
  await plus(pageA, 'KIXM-648', 'opened');
  await plus(pageA, 'KICS-4217', 'unopened');
  await plus(pageA, 'KICS-4217', 'opened');
  expectedA = {
    'KICM-1641': { unopened: 1, opened: 1 },
    'KICS-93710': { unopened: 1, opened: 0 },
    'KIXM-648': { unopened: 0, opened: 2 },
    'KICS-4217': { unopened: 1, opened: 1 },
  };
  await pageA.reload();
  await pageA.locator('[data-testid=release]').first().waitFor();
  for (const [id, v] of Object.entries(expectedA)) eq(await counts(pageA, id), v, id);
  eq(await stats(pageA), { owned: 4, total: 7, unopened: 3, opened: 4, completion: '10.2%' }, '集計');
});

await step('アプリを閉じて開き直しても枚数が残る（タブを閉じて新しいタブで開く）', async () => {
  await pageA.close();
  const p2 = await A.ctx.newPage();
  await p2.goto(BASE);
  await p2.locator('[data-testid=release]').first().waitFor();
  for (const [id, v] of Object.entries(expectedA)) eq(await counts(p2, id), v, id);
  A.page = p2;
});
const pA = () => A.page;

await step('リスト表示に切り替えられ、＋−も使える', async () => {
  await pA().getByRole('radio', { name: 'リスト表示' }).click();
  await pA().getByTestId('list').waitFor();
  eq(await releaseCount(pA()), TOTAL, '件数');
  const jacket = await card(pA(), 'KICM-1641').locator('img').boundingBox();
  const title = await card(pA(), 'KICM-1641').locator('h3').boundingBox();
  assert(jacket.x < title.x, 'ジャケットが左側にない');
  await plus(pA(), 'KICM-1641', 'opened');
  eq(await counts(pA(), 'KICM-1641'), { unopened: 1, opened: 2 }, 'リストで＋');
  await minus(pA(), 'KICM-1641', 'opened');
  eq(await layoutProblems(pA()), [], 'リストのレイアウト');
  await shot(pA(), '03-list');
});

await step('カテゴリー絞り込み', async () => {
  await pA().getByRole('radio', { name: 'アルバム' }).click();
  eq(await releaseCount(pA()), 14, 'アルバム');
  await pA().getByRole('radio', { name: 'シングル' }).click();
  eq(await releaseCount(pA()), 14, 'シングル');
  await pA().getByRole('radio', { name: 'ライブBlu-ray' }).click();
  eq(await releaseCount(pA()), 9, 'Blu-ray');
  await pA().getByRole('radio', { name: 'MUSIC CLIP BOX' }).click();
  eq(await releaseCount(pA()), 2, 'MUSIC CLIP BOX');
  await pA().getByRole('radio', { name: 'すべて' }).first().click();
  eq(await releaseCount(pA()), TOTAL, 'すべて');
});

await step('所持状況・開封状態の絞り込みと複合フィルター', async () => {
  await openFilterPanel(pA());
  await pA().getByRole('radio', { name: '所持している作品' }).click();
  eq(await releaseCount(pA()), 4, '所持');
  await pA().getByRole('radio', { name: '未所持の作品' }).click();
  eq(await releaseCount(pA()), TOTAL - 4, '未所持');
  await pA().getByRole('radio', { name: '所持している作品' }).click();
  await pA().getByRole('radio', { name: '未開封が1枚以上' }).click();
  eq(await releaseCount(pA()), 3, '未開封あり');
  await pA().getByRole('radio', { name: '開封済が1枚以上' }).click();
  eq(await releaseCount(pA()), 3, '開封済あり');
  await pA().getByRole('radio', { name: 'アルバム' }).click();
  eq(await releaseCount(pA()), 1, 'アルバム×所持×開封済');
  eq(await pA().locator('[data-testid=release]').first().getAttribute('data-id'), 'KICS-4217', '該当作品');
});

await step('作品名検索（フィルターとの組み合わせ・0件メッセージ）', async () => {
  await pA().getByPlaceholder('作品名で検索').fill('ｔｒａｖｅｌ');
  eq(await releaseCount(pA()), 1, '検索＋フィルター');
  await pA().getByPlaceholder('作品名で検索').fill('存在しない作品名');
  await pA().getByTestId('empty').waitFor();
  assert((await pA().getByTestId('empty').textContent()).includes('条件に一致する作品はありません'), '0件メッセージ');
  await shot(pA(), '04-empty');
  await pA().getByTestId('empty').getByRole('button', { name: '条件をリセット' }).click();
  eq(await releaseCount(pA()), TOTAL, 'リセット');
  await pA().getByPlaceholder('作品名で検索').fill('あいまいもこ');
  eq(await pA().locator('[data-testid=release]').first().getAttribute('data-id'), 'KICM-1783', 'ひらがなで検索');
  await pA().getByRole('button', { name: '検索キーワードを消す' }).click();
  eq(await releaseCount(pA()), TOTAL, 'クリア');
});

await step('並び替え（新しい順・作品名順・カテゴリー順・古い順）', async () => {
  await openFilterPanel(pA());
  const first = async () => pA().locator('[data-testid=release]').first().getAttribute('data-id');
  await pA().getByRole('radio', { name: '発売日が新しい順' }).click();
  eq(await first(), 'KICM-2183', '新しい順の先頭（発売予定の14th Single）');
  await pA().getByRole('radio', { name: '作品名順' }).click();
  const titles = await pA().locator('[data-testid=release] h3').allTextContents();
  const sorted = [...titles].sort(new Intl.Collator('ja', { numeric: true, sensitivity: 'base' }).compare);
  eq(titles, sorted, '作品名順');
  await pA().getByRole('radio', { name: 'カテゴリー順' }).click();
  const ids = await pA().locator('[data-testid=release]').evaluateAll((els) => els.map((e) => e.dataset.id));
  eq([ids[0], ids[13], ids[14], ids[28], ids[37]], ['KICM-1641', 'KICM-2183', 'KICS-93477', 'KIXM-315', 'KIXM-379'], 'カテゴリー順の境目');
  await pA().getByRole('radio', { name: '発売日が古い順' }).click();
  eq(await first(), 'KICM-1641', '古い順の先頭');
});

await step('表示設定（表示形式・フィルター・検索語・並び順）が再起動後に復元される', async () => {
  await openFilterPanel(pA());
  await pA().getByRole('radio', { name: 'シングル' }).click();
  await pA().getByRole('radio', { name: '所持している作品' }).click();
  await pA().getByRole('radio', { name: '未開封が1枚以上' }).click();
  await pA().getByRole('radio', { name: '発売日が新しい順' }).click();
  await pA().getByPlaceholder('作品名で検索').fill('夢');
  await pA().reload();
  await pA().getByTestId('list').waitFor();
  eq(await pA().getByPlaceholder('作品名で検索').inputValue(), '夢', '検索語');
  eq(await pA().getByRole('radio', { name: 'シングル' }).getAttribute('aria-checked'), 'true', 'カテゴリー');
  await openFilterPanel(pA());
  eq(await pA().getByRole('radio', { name: '所持している作品' }).getAttribute('aria-checked'), 'true', '所持');
  eq(await pA().getByRole('radio', { name: '未開封が1枚以上' }).getAttribute('aria-checked'), 'true', '開封');
  eq(await pA().getByRole('radio', { name: '発売日が新しい順' }).getAttribute('aria-checked'), 'true', '並び');
  eq(await releaseCount(pA()), 1, '結果');
  // バックアップに含まれる設定として控えておく
  settingsAtBackup = await pA().evaluate(() => JSON.parse(localStorage.getItem('inori-collection/settings')));
  eq(settingsAtBackup, { view: 'list', category: 'single', owned: 'owned', open: 'hasUnopened', query: '夢', sort: 'dateDesc' }, '保存値');
});

await step('バックアップを作成：ZIPがダウンロードされ、正しいデータが入っている', async () => {
  await openSettings(pA());
  await shot(pA(), '05-settings');
  const [dl] = await Promise.all([pA().waitForEvent('download'), pA().getByRole('button', { name: 'バックアップを作成' }).click()]);
  const name = dl.suggestedFilename();
  assert(/^inori-collection-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(name), `ファイル名 ${name}`);
  backupZipPath = resolve(OUT, name);
  await dl.saveAs(backupZipPath);
  const zip = await JSZip.loadAsync(readFileSync(backupZipPath));
  eq(Object.keys(zip.files), ['inori-collection-backup.json'], 'ZIPの中身');
  const json = JSON.parse(await zip.file('inori-collection-backup.json').async('string'));
  eq(json.format, 'inori-collection-backup', 'format');
  eq(json.schemaVersion, 2, 'version');
  eq(json.jackets, {}, '画像なし（自分で設定した画像がない）');
  assert(!Number.isNaN(Date.parse(json.createdAt)), '作成日時');
  eq(json.collection, Object.fromEntries(Object.keys(expectedA).sort().map((k) => [k, expectedA[k]])), '所持データ');
  eq(json.settings, settingsAtBackup, '表示設定');
  await closeTopDialog(pA());
});

await step('ZIPは標準形式（OS非依存）：Pythonの標準 zipfile でも読める', async () => {
  const out = execSync(
    `python3 -c "import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; d=json.loads(z.read('inori-collection-backup.json').decode('utf-8')); print(len(d['collection']))" "${backupZipPath}"`,
  )
    .toString()
    .trim();
  eq(out, '4', '件数');
});

// ═════════ 端末B（新しいスマートフォン相当：初期状態） ═════════
const B = await newDevice(390, 844);
const pageB = B.page;
const restoreInput = (p) => p.locator('[data-testid=restore-input]');

await step('新しい端末（初期状態）でZIPを選ぶと、確認ダイアログが出てから復元される', async () => {
  await pageB.goto(BASE);
  await pageB.locator('[data-testid=release]').first().waitFor();
  eq(await stats(pageB), { owned: 0, total: 0, unopened: 0, opened: 0, completion: '0%' }, '初期');
  await openSettings(pageB);
  await restoreInput(pageB).setInputFiles(backupZipPath);
  await pageB.getByTestId('confirm-restore').waitFor();
  eq((await pageB.getByTestId('restore-forms').textContent()).trim(), '4', '確認画面の形態数');
  // 確認前はまだ上書きされていない
  eq(await pageB.evaluate(() => localStorage.getItem('inori-collection/collection')), null, '確認前');
  await shot(pageB, '06-restore-confirm');
  await pageB.getByTestId('confirm-restore').click();
  await pageB.getByTestId('list').waitFor();
});

await step('復元後の所持枚数・集計・表示設定が元の端末と一致する', async () => {
  await openFilterPanel(pageB);
  await pageB.getByRole('button', { name: '検索・絞り込み条件をリセット' }).click();
  eq(await stats(pageB), { owned: 4, total: 7, unopened: 3, opened: 4, completion: '10.2%' }, '集計');
  for (const [id, v] of Object.entries(expectedA)) eq(await counts(pageB, id), v, id);
  await pageB.reload();
  await pageB.getByTestId('list').waitFor();
  eq(await pageB.getByRole('radio', { name: 'リスト表示' }).getAttribute('aria-checked'), 'true', '表示形式');
  eq(await stats(pageB), { owned: 4, total: 7, unopened: 3, opened: 4, completion: '10.2%' }, '再読み込み後');
});

await step('復元直後は「元に戻す」で復元前に戻せる', async () => {
  await openSettings(pageB);
  await restoreInput(pageB).setInputFiles(resolve(ROOT, 'tests/fixtures/backup-v1-sample.zip'));
  await pageB.getByTestId('confirm-restore').click();
  await pageB.getByRole('button', { name: '元に戻す' }).click();
  eq(await stats(pageB), { owned: 4, total: 7, unopened: 3, opened: 4, completion: '10.2%' }, '戻った');
});

const before = async () => pageB.evaluate(() => localStorage.getItem('inori-collection/collection'));

await step('ZIPでないファイルは拒否され、既存データは変わらない', async () => {
  const b = await before();
  const fake = resolve(OUT, 'not-a-zip.zip');
  writeFileSync(fake, 'これはZIPではありません');
  await openSettings(pageB);
  await restoreInput(pageB).setInputFiles(fake);
  await pageB.getByTestId('restore-error').waitFor();
  assert((await pageB.getByTestId('restore-error').textContent()).includes('ZIPファイルではありません'), 'メッセージ');
  await shot(pageB, '07-restore-error');
  await closeTopDialog(pageB);
  eq(await before(), b, 'データ不変');
});

await step('不正な枚数データを含むZIPは拒否され、既存データは変わらない', async () => {
  const b = await before();
  const zip = new JSZip();
  zip.file(
    'inori-collection-backup.json',
    JSON.stringify({ format: 'inori-collection-backup', schemaVersion: 1, createdAt: new Date().toISOString(), collection: { 'KICM-1641': { unopened: -5, opened: 0 } }, settings: {} }),
  );
  const bad = resolve(OUT, 'bad-count.zip');
  writeFileSync(bad, await zip.generateAsync({ type: 'nodebuffer' }));
  await restoreInput(pageB).setInputFiles(bad);
  await pageB.getByTestId('restore-error').waitFor();
  assert((await pageB.getByTestId('restore-error').textContent()).includes('不正な枚数データ'), 'メッセージ');
  await closeTopDialog(pageB);
  eq(await before(), b, 'データ不変');
  await closeTopDialog(pageB);
});

await step('復元時に保存が失敗した場合（容量不足）は、画面も保存データも既存のまま', async () => {
  const b = await before();
  const s0 = await stats(pageB);
  await pageB.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'inori-collection/collection') throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  await openSettings(pageB);
  await restoreInput(pageB).setInputFiles(resolve(ROOT, 'tests/fixtures/backup-v1-sample.zip'));
  await pageB.getByTestId('confirm-restore').click();
  await pageB.getByTestId('restore-error').waitFor();
  assert((await pageB.getByTestId('restore-error').textContent()).includes('復元に失敗しました'), 'メッセージ');
  await closeTopDialog(pageB);
  await closeTopDialog(pageB);
  eq(await stats(pageB), s0, '画面のデータ不変');
  eq(await before(), b, '保存データ不変');
  await pageB.reload(); // setItem の差し替えを元に戻す
  await pageB.locator('[data-testid=release]').first().waitFor();
  eq(await stats(pageB), s0, '再読み込み後も不変');
});

await step('通常操作で保存に失敗したらユーザーに通知される', async () => {
  await pageB.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'inori-collection/collection') throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  await plus(pageB, 'KICM-1662', 'unopened');
  await pageB.getByRole('alert').filter({ hasText: '保存されていません' }).waitFor();
  await shot(pageB, '08-save-error');
  await pageB.reload();
  await pageB.locator('[data-testid=release]').first().waitFor();
});

await step('保存データが壊れていても起動でき、通知され、元データは退避される', async () => {
  await pageB.evaluate(() => localStorage.setItem('inori-collection/collection', '{"broken'));
  await pageB.reload();
  await pageB.locator('[data-testid=release]').first().waitFor();
  await pageB.getByText('保存データが破損していたため').waitFor();
  const kept = await pageB.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('inori-collection/corrupted/')).map((k) => localStorage.getItem(k)));
  eq(kept, ['{"broken'], '退避データ');
  // 復旧：バックアップから戻す
  await openSettings(pageB);
  await restoreInput(pageB).setInputFiles(backupZipPath);
  await pageB.getByTestId('confirm-restore').click();
  await pageB.getByTestId('list').waitFor();
  await openFilterPanel(pageB);
  await pageB.getByRole('button', { name: '検索・絞り込み条件をリセット' }).click();
  eq(await stats(pageB), { owned: 4, total: 7, unopened: 3, opened: 4, completion: '10.2%' }, 'バックアップで復旧');
});

await step('v1.0.0 時点でマスター未登録だった KICS-93477 は、追加された初回限定盤に紐づいて表示される', async () => {
  await openSettings(pageB);
  await restoreInput(pageB).setInputFiles(resolve(ROOT, 'tests/fixtures/backup-v1-sample.zip'));
  await pageB.getByTestId('confirm-restore').waitFor();
  eq(await pageB.getByText('現在の作品データにない項目').count(), 0, '未登録の警告が出ない');
  await pageB.getByTestId('confirm-restore').click();
  await openFilterPanel(pageB);
  await pageB.getByRole('button', { name: '検索・絞り込み条件をリセット' }).click();
  eq(await counts(pageB, 'KICS-93477'), { unopened: 1, opened: 0 }, 'Innocent flower 初回限定盤に表示');
  eq((await card(pageB, 'KICS-93477').getByTestId('badge').textContent()).trim(), '所持 1枚', 'バッジ');
});

await step('本当にマスターにないIDを含むバックアップも、そのIDを破棄せず保持する', async () => {
  const zip = new JSZip();
  zip.file(
    'inori-collection-backup.json',
    JSON.stringify({ format: 'inori-collection-backup', schemaVersion: 1, createdAt: new Date().toISOString(), collection: { 'KICM-1641': { unopened: 1, opened: 0 }, 'KICS-99999': { unopened: 2, opened: 0 } }, settings: {} }),
  );
  const f = resolve(OUT, 'unknown-id.zip');
  writeFileSync(f, await zip.generateAsync({ type: 'nodebuffer' }));
  await openSettings(pageB);
  await restoreInput(pageB).setInputFiles(f);
  await pageB.getByText('現在の作品データにない項目が 1 件').waitFor();
  await pageB.getByTestId('confirm-restore').click();
  const saved = await pageB.evaluate(() => JSON.parse(localStorage.getItem('inori-collection/collection')).items['KICS-99999']);
  eq(saved, { unopened: 2, opened: 0 }, '保持');
});

// ═════════ 旧バージョン（v1.0.0・34形態）のZIPを新しい端末で復元 ═════════
const V1_EXPECTED = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/backup-v1.0.0-34forms.expected.json'), 'utf-8'));

await step('v1.0.0（34形態）で作成したZIPを、新しい端末の v1.2.0（39形態）で復元できる', async () => {
  const C = await newDevice();
  await C.page.goto(BASE);
  await C.page.locator('[data-testid=release]').first().waitFor();
  await openSettings(C.page);
  await restoreInput(C.page).setInputFiles(resolve(ROOT, 'tests/fixtures/backup-v1.0.0-34forms.zip'));
  await C.page.getByTestId('confirm-restore').waitFor();
  eq((await C.page.getByTestId('restore-forms').textContent()).trim(), '35', '確認画面の形態数');
  eq(await C.page.getByText('現在の作品データにない項目').count(), 0, '未登録の警告が出ない');
  await C.page.getByTestId('confirm-restore').click();
  await C.page.locator('[data-testid=release]').first().waitFor();
  // 既存34形態の枚数がすべて一致（画面表示で確認）
  for (const id of V1_EXPECTED.v1FormIds) eq(await counts(C.page, id), V1_EXPECTED.collection[id], id);
  // 以前は未登録だった KICS-93477 が紐づく / 新規の KICS-93785 は0枚・未所持
  eq(await counts(C.page, 'KICS-93477'), V1_EXPECTED.collection['KICS-93477'], 'KICS-93477');
  eq(await counts(C.page, 'KICS-93785'), { unopened: 0, opened: 0 }, 'KICS-93785');
  eq((await card(C.page, 'KICS-93785').getByTestId('badge').textContent()).trim(), '未所持', 'KICS-93785 バッジ');
  const all = Object.values(V1_EXPECTED.collection);
  const sum = (k) => all.reduce((n, h) => n + h[k], 0);
  eq(await stats(C.page), { owned: 35, total: sum('unopened') + sum('opened'), unopened: sum('unopened'), opened: sum('opened'), completion: '89.7%' }, '集計');
  await shot(C.page, '13-restored-from-v1');
  await C.ctx.close();
});

await step('幅320pxの小型端末でもグリッドの文字・ボタンが重ならない', async () => {
  const S = await newDevice(320, 568);
  await S.page.goto(BASE);
  await S.page.locator('[data-testid=release]').first().waitFor();
  eq(await layoutProblems(S.page), [], '320px グリッド');
  eq(await headerProblems(S.page), [], '320px ヘッダー');
  await shot(S.page, '09-grid-320');
  await S.page.getByRole('radio', { name: 'リスト表示' }).click();
  eq(await layoutProblems(S.page), [], '320px リスト');
  await S.ctx.close();
});

// ═════════ PWA・オフライン（端末A） ═════════
await step('Web App Manifest とアイコンが正しく配信される', async () => {
  const m = await pA().evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]')?.getAttribute('href');
    const json = await (await fetch(href)).json();
    const icons = await Promise.all(json.icons.map(async (i) => ({ ...i, status: (await fetch(i.src)).status })));
    const apple = (await fetch(document.querySelector('link[rel=apple-touch-icon]').href)).status;
    return { href, name: json.name, display: json.display, start: json.start_url, theme: json.theme_color, icons, apple };
  });
  eq([m.name, m.display, m.start, m.theme], ['Inori Collection', 'standalone', '/', '#79C8ED'], 'manifest');
  assert(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512') && m.icons.some((i) => i.purpose === 'maskable'), 'アイコン定義');
  assert(m.icons.every((i) => i.status === 200) && m.apple === 200, 'アイコン配信');
});

await step('Service Worker が有効になり、オフライン準備完了が表示される', async () => {
  await pA().waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 }).catch(async () => {
    await pA().reload();
    await pA().waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  });
  await pA().locator('[data-testid=offline-pill][data-state=ready]').waitFor({ timeout: 40000 });
  eq((await pA().getByTestId('offline-pill').textContent()).trim(), 'オフラインOK', 'ヘッダー表示');
  const cached = await pA().evaluate(async () => (await (await caches.open('inori-jackets-v1')).keys()).length);
  eq(cached, TOTAL, 'ジャケットのキャッシュ数');
  await shot(pA(), '10-offline-ready');
});

await step('オフラインで起動・一覧表示・ジャケット表示ができる', async () => {
  networkDown = true;
  await A.ctx.setOffline(true);
  imageRequests = 0;
  await pA().reload();
  await pA().locator('[data-testid=release]').first().waitFor({ timeout: 15000 });
  // 表示条件を初期化
  await openFilterPanel(pA());
  await pA().getByRole('button', { name: '検索・絞り込み条件をリセット' }).click();
  await pA().getByRole('radio', { name: 'グリッド表示' }).click();
  eq(await releaseCount(pA()), TOTAL, 'オフライン一覧');
  for (let i = 0; i < 8; i++) {
    await pA().mouse.wheel(0, 2000);
    await pA().waitForTimeout(150);
  }
  await pA().waitForFunction(() => [...document.querySelectorAll('[data-testid=release] img')].every((i) => i.complete), null, { timeout: 15000 });
  const r = await pA().evaluate(() => {
    const imgs = [...document.querySelectorAll('[data-testid=release] img')];
    return { n: imgs.length, ok: imgs.filter((i) => i.naturalWidth > 0).length };
  });
  eq(r, { n: TOTAL, ok: TOTAL }, 'オフラインのジャケット');
  eq(imageRequests, 0, '外部への画像リクエスト（0であるべき）');
  await pA().evaluate(() => window.scrollTo(0, 0));
  await shot(pA(), '11-offline');
});

await step('オフラインで検索・絞り込み・枚数変更・集計ができ、保存される', async () => {
  await pA().getByPlaceholder('作品名で検索').fill('summer');
  eq(await releaseCount(pA()), 1, 'オフライン検索');
  await plus(pA(), 'KICM-2174', 'unopened');
  eq(await counts(pA(), 'KICM-2174'), { unopened: 1, opened: 0 }, 'オフライン＋');
  eq(await stats(pA()), { owned: 5, total: 8, unopened: 4, opened: 4, completion: '12.8%' }, 'オフライン集計');
  await pA().getByRole('button', { name: '検索キーワードを消す' }).click();
  await pA().getByRole('radio', { name: 'ライブBlu-ray' }).click();
  eq(await releaseCount(pA()), 9, 'オフライン絞り込み');
  await pA().getByRole('radio', { name: 'すべて' }).first().click();
  await pA().reload();
  await pA().locator('[data-testid=release]').first().waitFor();
  eq(await counts(pA(), 'KICM-2174'), { unopened: 1, opened: 0 }, 'オフラインで保存');
});

await step('オンライン復帰後もデータが維持される', async () => {
  networkDown = false;
  await A.ctx.setOffline(false);
  await pA().reload();
  await pA().locator('[data-testid=release]').first().waitFor();
  eq(await stats(pA()), { owned: 5, total: 8, unopened: 4, opened: 4, completion: '12.8%' }, '集計');
});

await step('アプリ更新後も所持情報・表示設定・画像キャッシュが維持される', async () => {
  await pA().getByRole('radio', { name: 'リスト表示' }).click();
  server.setRoot(resolve(ROOT, 'dist-e2e-v2'));
  await pA().evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await pA().getByText('新しいバージョンがあります').waitFor({ timeout: 30000 });
  await shot(pA(), '12-update-banner');
  await Promise.all([pA().waitForEvent('load', { timeout: 30000 }), pA().getByRole('button', { name: '更新する' }).click()]);
  await pA().locator('[data-testid=release]').first().waitFor();
  await openSettings(pA());
  await pA().getByText('アプリのバージョン：1.2.0-e2e').waitFor();
  await closeTopDialog(pA());
  eq(await stats(pA()), { owned: 5, total: 8, unopened: 4, opened: 4, completion: '12.8%' }, '更新後の集計');
  eq(await pA().getByRole('radio', { name: 'リスト表示' }).getAttribute('aria-checked'), 'true', '更新後の表示設定');
  const cached = await pA().evaluate(async () => (await (await caches.open('inori-jackets-v1')).keys()).length);
  eq(cached, TOTAL, '更新後の画像キャッシュ');
});

await step('更新後もオフラインで起動できる', async () => {
  networkDown = true;
  await A.ctx.setOffline(true);
  await pA().reload();
  await pA().locator('[data-testid=release]').first().waitFor({ timeout: 15000 });
  eq(await stats(pA()), { owned: 5, total: 8, unopened: 4, opened: 4, completion: '12.8%' }, '集計');
  networkDown = false;
  await A.ctx.setOffline(false);
});

// ═════════ ジャケット画像の取得失敗時の処理（ダミー画像で再現） ═════════
const KING_YUME = 'c966882027bc4237a58b546ab62efde9';
const KING_HARMONY = 'b50d6389cc2a466aa123fc747a3e1027';
const OFFICIAL_HARMONY = '60a4e55e62520';
async function scrollAll(page) {
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function imgState(page, id) {
  const c = card(page, id);
  await c.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  return c.evaluate((el) => {
    const img = el.querySelector('img[data-jacket-index]');
    return {
      placeholder: !!el.querySelector('[data-testid=jacket-placeholder]'),
      index: img ? Number(img.getAttribute('data-jacket-index')) : null,
      loaded: img ? img.complete && img.naturalWidth > 0 : false,
    };
  });
}

const F = await newDevice(375, 812, (url) => {
  if (url.includes(KING_YUME)) return '404'; // 1つ目の配信元だけ取得できない
  if (url.includes(KING_HARMONY) || url.includes(OFFICIAL_HARMONY)) return '404'; // どの配信元からも取得できない
  return 'ok';
});

await step('1つ目の配信元（キングレコード）で取得できない画像は、公式サイトの画像で表示・オフライン保存される', async () => {
  await F.page.goto(BASE);
  await F.page.locator('[data-testid=release]').first().waitFor();
  await F.page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 }).catch(async () => {
    await F.page.reload();
    await F.page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  });
  await F.page.locator('[data-testid=offline-pill][data-state=partial]').waitFor({ timeout: 40000 });
  const s1 = await imgState(F.page, 'KICM-1641');
  eq(s1, { placeholder: false, index: 1, loaded: true }, '夢のつぼみは予備の画像で表示');
  const cached = await F.page.evaluate(async () => (await (await caches.open('inori-jackets-v1')).keys()).map((r) => r.url));
  assert(cached.some((u) => u.includes('60a4e3bf248cf')), '予備画像がキャッシュされていない');
  assert(!cached.some((u) => u.includes('c966882027bc4237a58b546ab62efde9')), '取得できない画像がキャッシュに残っている');
  eq(cached.length, TOTAL - 1, 'キャッシュ数（取得できない1形態を除く）');
});

await step('どの配信元からも取得できない画像は、CDアイコンを表示し、準備状況に「画像なし」と明示する（「オフラインOK」とは表示しない）', async () => {
  const s2 = await imgState(F.page, 'KICM-1662');
  eq(s2, { placeholder: true, index: null, loaded: false }, 'harmony ribbon はプレースホルダー');
  eq((await F.page.getByTestId('offline-pill').textContent()).trim(), '画像なし1件', 'ヘッダー表示');
  await openSettings(F.page);
  const txt = await F.page.getByTestId('jacket-unavailable').textContent();
  assert(txt.includes('1 件') && txt.includes('harmony ribbon'), `設定画面の表示: ${txt}`);
  eq((await F.page.getByTestId('offline-summary').textContent()).trim(), 'オフライン準備完了（1形態は画像なし）', '設定画面の要約');
  await shot(F.page, '14-image-unavailable-settings');
  await closeTopDialog(F.page);
});

await step('画像取得失敗があっても、オフラインで再起動したとき保存済みの画像は表示され、状況表示も維持される', async () => {
  networkDown = true;
  await F.ctx.setOffline(true);
  await F.page.reload();
  await F.page.locator('[data-testid=release]').first().waitFor({ timeout: 15000 });
  eq(await imgState(F.page, 'KICM-1641'), { placeholder: false, index: 1, loaded: true }, '予備画像をオフラインで表示');
  eq((await imgState(F.page, 'KICM-1662')).placeholder, true, 'プレースホルダー');
  eq(await F.page.getByTestId('offline-pill').getAttribute('data-state'), 'partial', 'オフライン再起動後の状態');
  networkDown = false;
  await F.ctx.setOffline(false);
  await F.ctx.close();
});

let gPolicy = 'abort';
const G = await newDevice(375, 812, () => gPolicy);

await step('画像がすべて取得できないとき（配信元の障害など）は「オフラインOK」と表示しない', async () => {
  await G.page.goto(BASE);
  await G.page.locator('[data-testid=release]').first().waitFor();
  await G.page.locator('[data-testid=offline-pill][data-state=partial]').waitFor({ timeout: 40000 });
  eq((await G.page.getByTestId('offline-pill').textContent()).trim(), `画像なし${TOTAL}件`, 'ヘッダー表示');
  eq(await G.page.locator('[data-testid=jacket-placeholder]').count() > 0, true, 'プレースホルダー表示');
});

await step('配信元が復旧したら、再試行ボタンで画像を取得してオフライン準備完了になる', async () => {
  gPolicy = 'ok';
  await openSettings(G.page);
  await G.page.getByRole('button', { name: '取得できなかった画像を再試行' }).click();
  await G.page.locator('[data-testid=offline-pill][data-state=ready]').waitFor({ timeout: 40000 });
  eq(await G.page.evaluate(async () => (await (await caches.open('inori-jackets-v1')).keys()).length), TOTAL, 'キャッシュ数');
  await closeTopDialog(G.page);
  await G.ctx.close();
});

// ═════════ 自分で設定したジャケット画像（個人用版：公式の画像より優先） ═════════
const USER_IMG = resolve(ROOT, 'public/icons/icon-512.png');
const P = await newDevice();
const detail = (page) => page.locator('dialog[open] [data-testid=detail]');
async function openDetail(page, id) {
  await tap(card(page, id).getByTestId('open-detail'));
  await detail(page).waitFor();
}
async function cardImage(page, id) {
  const c = card(page, id);
  await c.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForFunction(
    (id) => [...document.querySelectorAll(`[data-testid=release][data-id="${id}"] img`)].every((i) => i.complete),
    id,
    { timeout: 10000 },
  );
  return c.evaluate((el) => {
    const img = el.querySelector('img');
    return { user: img?.hasAttribute('data-user-jacket') ?? false, official: img?.hasAttribute('data-jacket-index') ?? false, width: img?.naturalWidth ?? 0 };
  });
}

await step('ジャケットをタップすると作品の詳細（品番・発売日・公式ページへのリンク）が開く', async () => {
  await P.page.goto(BASE);
  await P.page.locator('[data-testid=release]').first().waitFor();
  await openDetail(P.page, 'KICM-2183');
  const text = await detail(P.page).innerText();
  for (const t of ['未解決で、ロマンスで。', 'KICM-2183', '2027.01.27', 'シングル', '公式サイトの画像を表示しています。']) assert(text.includes(t), `詳細に「${t}」がない: ${text}`);
  eq(await detail(P.page).getByRole('link', { name: '公式サイトの作品ページ' }).getAttribute('href'), 'https://inoriminase.com/discography/2445/', '公式ページ');
  eq(await detail(P.page).getByRole('link', { name: 'キングレコードの商品ページ' }).getAttribute('href'), 'https://www.kingrecords.co.jp/cs/g/gKICM-2183/', 'キングレコード');
  await shot(P.page, '16-detail-personal');
});

await step('個人用版でも自分で画像を設定でき、公式の画像より優先して表示される', async () => {
  await detail(P.page).getByTestId('jacket-input').setInputFiles(USER_IMG);
  await P.page.getByText('の画像を設定しました').waitFor();
  eq(((await detail(P.page).getByTestId('jacket-source').textContent()) ?? '').startsWith('自分で設定した画像を表示しています'), true, '詳細の表示');
  await closeTopDialog(P.page);
  eq(await cardImage(P.page, 'KICM-2183'), { user: true, official: false, width: 512 }, '一覧で自分の画像を表示');
  await P.page.reload();
  await P.page.locator('[data-testid=release]').first().waitFor();
  eq(await cardImage(P.page, 'KICM-2183'), { user: true, official: false, width: 512 }, '再読み込み後も表示');
});

await step('設定した画像を削除すると公式の画像に戻り、「元に戻す」で再び表示される', async () => {
  await openDetail(P.page, 'KICM-2183');
  await detail(P.page).getByTestId('remove-jacket').click();
  await P.page.getByText('の画像を削除しました').waitFor();
  eq(await cardImage(P.page, 'KICM-2183'), { user: false, official: true, width: 192 }, '公式の画像（ダミー）に戻る');
  await P.page.getByRole('button', { name: '元に戻す' }).click();
  await P.page.locator(`[data-testid=release][data-id="KICM-2183"] img[data-user-jacket]`).waitFor();
  eq(await cardImage(P.page, 'KICM-2183'), { user: true, official: false, width: 512 }, '元に戻す');
  await P.ctx.close();
});

// ═════════ 前回の版（v1.1.1・36形態）からのアプリ更新 ═════════
const V111_DIST = process.env.V111_DIST || resolve(ROOT, '../v1.1.1-dist');
if (!existsSync(resolve(V111_DIST, 'index.html'))) {
  results.push({ name: 'v1.1.1 からのアプリ更新（v1.1.1 のビルドが見つからないため未実施）', ok: null });
  console.log('  - v1.1.1 のビルドがないため、前回の版からの更新テストを省略（V111_DIST を指定）');
} else {
  const server4 = await startServer(V111_DIST, 4177);
  const V = await newDevice();
  let before;
  let settingsBefore;
  await step('v1.1.1（36形態）を使っている端末で、データ・表示設定・オフライン準備を用意する（公式サイト改修中で画像なし2件）', async () => {
    await V.page.goto(server4.url);
    await V.page.locator('[data-testid=release]').first().waitFor();
    eq(await releaseCount(V.page), 36, 'v1.1.1 は36形態');
    await plus(V.page, 'KICS-93477', 'unopened');
    await plus(V.page, 'KICM-2174', 'opened');
    await plus(V.page, 'KIXM-648', 'unopened');
    await V.page.getByRole('radio', { name: 'ライブBlu-ray' }).click();
    await V.page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 }).catch(async () => {
      await V.page.reload();
      await V.page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
    });
    // v1.1.1 は公式サイトの旧URL（404）を見ているので、初回限定盤2形態が「画像なし」
    await V.page.locator('[data-testid=offline-pill][data-state=partial]').waitFor({ timeout: 40000 });
    eq((await V.page.getByTestId('offline-pill').textContent()).trim(), '画像なし2件', 'v1.1.1 のヘッダー表示');
    await V.page.reload();
    await V.page.locator('[data-testid=release]').first().waitFor();
    before = await V.page.evaluate(() => JSON.parse(localStorage.getItem('inori-collection/collection')).items);
    settingsBefore = await V.page.evaluate(() => JSON.parse(localStorage.getItem('inori-collection/settings')));
  });

  await step('v1.1.1 → v1.2.0 に更新：所持枚数・表示設定はそのまま、新作3形態が0枚で加わり、初回限定盤2形態の画像も表示される', async () => {
    server4.setRoot(resolve(ROOT, 'dist'));
    await V.page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await V.page.getByText('新しいバージョンがあります').waitFor({ timeout: 30000 });
    await Promise.all([V.page.waitForEvent('load', { timeout: 30000 }), V.page.getByRole('button', { name: '更新する' }).click()]);
    await V.page.locator('[data-testid=release]').first().waitFor();
    eq(await V.page.evaluate(() => JSON.parse(localStorage.getItem('inori-collection/collection')).items), before, '所持データは更新前と同じ');
    eq(await V.page.evaluate(() => JSON.parse(localStorage.getItem('inori-collection/settings'))), settingsBefore, '表示設定は更新前と同じ');
    eq(await releaseCount(V.page), 9, '表示設定（ライブBlu-ray）のまま');
    await V.page.getByRole('radio', { name: 'すべて' }).first().click();
    eq(await releaseCount(V.page), TOTAL, `${TOTAL}形態`);
    for (const id of ['KICM-2183', 'KIXM-379', 'KIXM-627']) eq(await counts(V.page, id), { unopened: 0, opened: 0 }, `${id} は0枚`);
    eq(await counts(V.page, 'KICS-93477'), { unopened: 1, opened: 0 }, '既存の枚数');
    await V.page.locator('[data-testid=offline-pill][data-state=ready]').waitFor({ timeout: 40000 });
    eq(await imgState(V.page, 'KICS-93477'), { placeholder: false, index: 0, loaded: true }, 'Innocent flower 初回限定盤の画像（リニューアル後の公式サイト）');
    eq(await V.page.evaluate(async () => (await (await caches.open('inori-jackets-v1')).keys()).length), TOTAL, '画像キャッシュ');
    await shot(V.page, '17-upgraded-from-v1.1.1');
  });
  await V.ctx.close();
  await server4.close();
}

// ═════════ 実際の旧バージョン（v1.0.0・34形態）からのアプリ更新 ═════════
const V1_DIST = process.env.V1_DIST || resolve(ROOT, '../v1-dist');
if (!existsSync(resolve(V1_DIST, 'index.html'))) {
  results.push({ name: 'v1.0.0 からのアプリ更新（v1.0.0 のビルドが見つからないため未実施）', ok: null });
  console.log('  - v1.0.0 のビルドがないため、旧版からの更新テストを省略（V1_DIST を指定）');
} else {
  const server2 = await startServer(V1_DIST, 4174);
  const U = await newDevice();
  let before;
  await step('v1.0.0（34形態）を使っている端末で、データ・表示設定・オフライン準備を用意する', async () => {
    await U.page.goto(server2.url);
    await U.page.locator('[data-testid=release]').first().waitFor();
    eq(await releaseCount(U.page), 34, 'v1.0.0 は34形態');
    // 当時マスター未登録の KICS-93477 を含むバックアップを復元 → いくつか＋
    await openSettings(U.page);
    await restoreInput(U.page).setInputFiles(resolve(ROOT, 'tests/fixtures/backup-v1-sample.zip'));
    await U.page.getByTestId('confirm-restore').click();
    await openFilterPanel(U.page);
    await U.page.getByRole('button', { name: '検索・絞り込み条件をリセット' }).click();
    await U.page.getByRole('radio', { name: 'リスト表示' }).click();
    await plus(U.page, 'KICM-1641', 'unopened');
    await plus(U.page, 'KIXM-315', 'opened');
    await U.page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 }).catch(async () => {
      await U.page.reload();
      await U.page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
    });
    await U.page.locator('[data-testid=offline-pill][data-state=ready]').waitFor({ timeout: 40000 });
    // ふだんの利用と同じく、アプリを開き直した状態にしておく
    await U.page.reload();
    await U.page.locator('[data-testid=release]').first().waitFor();
    before = await U.page.evaluate(() => JSON.parse(localStorage.getItem('inori-collection/collection')).items);
    eq(before['KICS-93477'], { unopened: 1, opened: 0 }, 'v1.0.0 では未登録IDとして保持');
  });

  await step('v1.0.0 → 最新版に更新：既存の所持枚数・表示設定・画像キャッシュが維持され、追加した形態が表示される', async () => {
    server2.setRoot(resolve(ROOT, 'dist'));
    await U.page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await U.page.getByText('新しいバージョンがあります').waitFor({ timeout: 30000 });
    await Promise.all([U.page.waitForEvent('load', { timeout: 30000 }), U.page.getByRole('button', { name: '更新する' }).click()]);
    await U.page.locator('[data-testid=release]').first().waitFor();
    await openSettings(U.page);
    await U.page.getByText(`アプリのバージョン：${APP_VERSION}`).waitFor();
    await U.page.getByText(`登録形態数：${TOTAL}`).waitFor();
    await closeTopDialog(U.page);
    const after = await U.page.evaluate(() => JSON.parse(localStorage.getItem('inori-collection/collection')).items);
    eq(after, before, '保存データは更新前と完全に同じ');
    eq(await releaseCount(U.page), TOTAL, `${TOTAL}形態を表示`);
    eq(await U.page.getByRole('radio', { name: 'リスト表示' }).getAttribute('aria-checked'), 'true', '表示設定');
    eq(await counts(U.page, 'KICM-1641'), { unopened: 2, opened: 2 }, '既存の枚数');
    eq(await counts(U.page, 'KICS-93477'), { unopened: 1, opened: 0 }, '以前は未登録だった KICS-93477 が紐づく');
    eq(await counts(U.page, 'KICS-93785'), { unopened: 0, opened: 0 }, '新規追加の KICS-93785 は0枚');
    const s = await stats(U.page);
    eq([s.owned, s.total], [Object.keys(before).length, Object.values(before).reduce((n, h) => n + h.unopened + h.opened, 0)], '集計（KICS-93477も含む）');
    // 追加形態の画像も取得され、オフライン準備完了になる
    await U.page.locator('[data-testid=offline-pill][data-state=ready]').waitFor({ timeout: 40000 });
    eq(await U.page.evaluate(async () => (await (await caches.open('inori-jackets-v1')).keys()).length), TOTAL, '画像キャッシュ');
    await shot(U.page, '15-upgraded-from-v1');
  });

  await step('最新版への更新後、オフラインで起動して全形態とジャケットを表示できる', async () => {
    networkDown = true;
    await U.ctx.setOffline(true);
    imageRequests = 0;
    await U.page.reload();
    await U.page.locator('[data-testid=release]').first().waitFor({ timeout: 15000 });
    eq(await releaseCount(U.page), TOTAL, '件数');
    await scrollAll(U.page);
    await U.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=release] img')].every((i) => i.complete), null, { timeout: 15000 });
    const r = await U.page.evaluate(() => {
      const imgs = [...document.querySelectorAll('[data-testid=release] img')];
      return { n: imgs.length, ok: imgs.filter((i) => i.naturalWidth > 0).length };
    });
    eq(r, { n: TOTAL, ok: TOTAL }, 'オフラインのジャケット');
    eq(imageRequests, 0, '外部への画像リクエスト');
    networkDown = false;
    await U.ctx.setOffline(false);
  });
  await U.ctx.close();

  await step('（v1.0.0 の既知の不具合）初回インストール直後の画面で更新した場合は自動で切り替わらないが、開き直せば最新版になりデータも維持される', async () => {
    server2.setRoot(V1_DIST);
    const U2 = await newDevice();
    await U2.page.goto(server2.url);
    await U2.page.locator('[data-testid=release]').first().waitFor();
    await plus(U2.page, 'KICM-2174', 'unopened');
    await U2.page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
    server2.setRoot(resolve(ROOT, 'dist'));
    await U2.page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await U2.page.getByText('新しいバージョンがあります').waitFor({ timeout: 30000 });
    await U2.page.getByRole('button', { name: '更新する' }).click();
    await U2.page.waitForTimeout(3000);
    eq(await releaseCount(U2.page), 34, 'v1.0.0 の画面のまま（旧版の不具合）');
    await U2.page.reload();
    await U2.page.locator('[data-testid=release]').first().waitFor();
    eq(await releaseCount(U2.page), TOTAL, '開き直すと最新版');
    eq(await counts(U2.page, 'KICM-2174'), { unopened: 1, opened: 0 }, 'データ維持');
    await U2.ctx.close();
  });
  await server2.close();
}

await step('（v1.1.0 で修正）初回インストール直後の画面でも「更新する」で新しいバージョンに切り替わる', async () => {
  const server3 = await startServer(resolve(ROOT, 'dist'), 4176);
  const W = await newDevice();
  await W.page.goto(server3.url);
  await W.page.locator('[data-testid=release]').first().waitFor();
  await plus(W.page, 'KICM-2174', 'opened');
  await W.page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  server3.setRoot(resolve(ROOT, 'dist-e2e-v2'));
  await W.page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await W.page.getByText('新しいバージョンがあります').waitFor({ timeout: 30000 });
  await Promise.all([W.page.waitForEvent('load', { timeout: 15000 }), W.page.getByRole('button', { name: '更新する' }).click()]);
  await W.page.locator('[data-testid=release]').first().waitFor();
  await openSettings(W.page);
  await W.page.getByText('アプリのバージョン：1.2.0-e2e').waitFor();
  await closeTopDialog(W.page);
  eq(await counts(W.page, 'KICM-2174'), { unopened: 0, opened: 1 }, 'データ維持');
  await W.ctx.close();
  await server3.close();
});


await browser.close();
await server.close();

const passed = results.filter((r) => r.ok === true).length;
const skipped = results.filter((r) => r.ok === null).length;
const failed = results.filter((r) => r.ok === false).length;
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
writeFileSync(resolve(OUT, 'e2e-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: 'Chromium (headless)', results }, null, 2));
process.exit(failed === 0 ? 0 : 1);
