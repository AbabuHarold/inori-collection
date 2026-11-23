// E2Eテスト（公開版）：INORI_EDITION=public（vite build --mode public）でビルドしたアプリを実ブラウザで確認する。
// 実行: npm run test:e2e:public   （CHROME_PATH で Chromium の実行ファイルを指定可能）
//
// 確認すること：
//   - ビルドに画像URLが1つも含まれず、配信元（キングレコード・水瀬いのり公式サイト）へ1回も通信しない
//   - ジャケット画像を自分で設定でき、再読み込み・オフライン・アプリ更新のあとも残る
//   - バックアップに画像が含まれ、別の端末で復元できる（元に戻す・画像の情報がない旧形式も含む）
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startServer } from './server.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(process.env.E2E_OUT || resolve(ROOT, 'e2e/output'), 'public');
mkdirSync(OUT, { recursive: true });
const APP_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;
const TOTAL = 39;
const DIST = resolve(ROOT, 'dist-public-e2e');
const DIST_V2 = resolve(ROOT, 'dist-public-e2e-v2');

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
  console.log('build (公開版) …');
  execSync(`npx vite build --mode public --outDir ${DIST}`, { cwd: ROOT, stdio: 'ignore' });
  console.log('build v2 (公開版・更新テスト用) …');
  execSync(`npx vite build --mode public --outDir ${DIST_V2}`, { cwd: ROOT, stdio: 'ignore', env: { ...process.env, APP_VERSION_OVERRIDE: '1.2.0-public-e2e' } });
}
const server = await startServer(DIST, 4180);
const BASE = server.url;

// 配信元への通信を数える（公開版では0であるべき）
const sourceRequests = [];
const SOURCE = /^https?:\/\/(www\.)?(kingrecords\.co\.jp|inoriminase\.com)\//;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

async function newDevice(width = 375, height = 812) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    acceptDownloads: true,
    serviceWorkers: 'allow',
  });
  await ctx.route(/^https?:\/\/(?!localhost)/, (route) => {
    if (SOURCE.test(route.request().url())) sourceRequests.push(route.request().url());
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('     [pageerror]', e.message));
  return { ctx, page };
}

const card = (page, id) => page.locator(`[data-testid=release][data-id="${id}"]`);
const detail = (page) => page.locator('dialog[open] [data-testid=detail]');
const restoreInput = (p) => p.locator('[data-testid=restore-input]');
async function tap(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await locator.click();
}
async function openDetail(page, id) {
  await tap(card(page, id).getByTestId('open-detail'));
  await detail(page).waitFor();
}
async function closeTopDialog(page) {
  await page.locator('dialog[open] header button[aria-label="閉じる"]').last().click();
}
async function openSettings(page) {
  await page.getByRole('button', { name: '設定（バックアップ・復元）' }).click();
  await page.getByRole('heading', { name: '設定' }).waitFor();
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
}
/** 一覧の各形態が自分の画像を表示しているか（id → 画像の幅。プレースホルダーなら 0） */
async function userImages(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=release] img[data-user-jacket]')].every((i) => i.complete), null, {
    timeout: 10000,
  });
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-testid=release] img[data-user-jacket]')].map((i) => [i.closest('[data-testid=release]').dataset.id, i.naturalWidth]),
    ),
  );
}
async function setImage(page, id, file) {
  await openDetail(page, id);
  await detail(page).getByTestId('jacket-input').setInputFiles(file);
  await page.getByText(/の画像を設定しました/).waitFor();
  await closeTopDialog(page);
}
async function idbRecords(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('inori-collection');
        r.onsuccess = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('user-jackets')) return resolve([]);
          const q = db.transaction('user-jackets').objectStore('user-jackets').getAll();
          q.onsuccess = () => {
            resolve(q.result.map((x) => ({ id: x.id, type: x.type, bytes: x.data.byteLength })));
            db.close();
          };
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}

/** 大きな写真（4000x3000 の JPEG）をブラウザで作る */
async function makeBigPhoto(page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4000;
    c.height = 3000;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 4000, 3000);
    grad.addColorStop(0, '#79c8ed');
    grad.addColorStop(1, '#12506f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4000, 3000);
    g.fillStyle = '#fff';
    g.font = 'bold 400px sans-serif';
    g.fillText('TEST', 1200, 1700);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return { name: 'IMG_0001.JPG', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
const ICON = resolve(ROOT, 'public/icons/icon-512.png');

console.log(`\nE2E（公開版）: ${BASE}`);

// ═════════ ビルドの内容 ═════════
await step('公開版のビルドには画像URL（キングレコード・公式サイトの画像の場所）が1つも含まれない', async () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html|webmanifest|css)$/.test(f)) files.push(p);
    }
  };
  walk(DIST);
  const hits = [];
  for (const f of files) {
    const t = readFileSync(f, 'utf-8');
    for (const pat of ['/img/goods/', 'wp-content/uploads', '/img/disco/']) if (t.includes(pat)) hits.push(`${f}: ${pat}`);
  }
  eq(hits, [], '画像URL');
  // Service Worker も外部の画像を扱わない（個人用版だけにある画像用のキャッシュ設定がない）
  const sw = readFileSync(join(DIST, 'sw.js'), 'utf-8');
  assert(!sw.includes('CacheFirst') && !sw.includes('kingrecords'), 'Service Worker に画像用の設定がある');
  // 作品ページへのリンク（画像ではない）は含まれる
  assert(files.some((f) => readFileSync(f, 'utf-8').includes('https://inoriminase.com')), '公式の作品ページへのリンクがない');
});

// ═════════ 端末A ═════════
const A = await newDevice();
const pA = A.page;

await step(`全${TOTAL}形態が表示され、画像はすべて「タップで画像を設定」の表示`, async () => {
  await pA.goto(BASE);
  await pA.locator('[data-testid=release]').first().waitFor();
  eq(await pA.locator('[data-testid=release]').count(), TOTAL, '件数');
  eq(await pA.locator('[data-testid=release] img').count(), 0, '画像要素（なし）');
  eq(await pA.locator('[data-testid=jacket-placeholder]').count(), TOTAL, 'プレースホルダー');
  assert((await card(pA, 'KICM-2183').innerText()).includes('タップで画像を設定'), '案内');
  await shot(pA, 'p01-grid');
});

await step('配信元の画像がなくても、アプリ本体を保存できれば「オフラインOK」と表示する', async () => {
  await pA.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 }).catch(async () => {
    await pA.reload();
    await pA.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  });
  await pA.locator('[data-testid=offline-pill][data-state=ready]').waitFor({ timeout: 30000 });
  eq((await pA.getByTestId('offline-pill').textContent()).trim(), 'オフラインOK', 'ヘッダー');
  await openSettings(pA);
  const t = await pA.locator('dialog[open]').innerText();
  for (const s of ['公開版', 'このアプリにはジャケット画像は含まれていません', '配信元から取得しない版です', '自分で設定した画像：0 枚']) assert(t.includes(s), `設定画面に「${s}」がない`);
  assert(!t.includes('取得できなかった画像を再試行') && !t.includes('ジャケット画像をオフライン用に保存'), '公開版に画像取得のボタンがある');
  await shot(pA, 'p02-settings');
  await closeTopDialog(pA);
});

await step('ジャケットをタップして画像を選ぶと、縮小したJPEGとして端末内に保存され、一覧に表示される', async () => {
  await openDetail(pA, 'KICM-1641');
  eq((await detail(pA).getByTestId('jacket-source').textContent()).trim(), '画像は設定されていません。', '設定前');
  await shot(pA, 'p03-detail-empty');
  await detail(pA).getByTestId('jacket-input').setInputFiles(await makeBigPhoto(pA));
  await pA.getByText('の画像を設定しました').waitFor();
  assert((await detail(pA).getByTestId('jacket-source').textContent()).startsWith('自分で設定した画像を表示しています'), '設定後');
  await shot(pA, 'p04-detail-set');
  await closeTopDialog(pA);
  eq(await userImages(pA), { 'KICM-1641': 800 }, '一覧の画像（長辺800pxに縮小）');
  const recs = await idbRecords(pA);
  eq(recs.map((r) => [r.id, r.type]), [['KICM-1641', 'image/jpeg']], '保存内容');
  assert(recs[0].bytes < 300 * 1024, `保存サイズが大きすぎる ${recs[0].bytes}`);
  await setImage(pA, 'KIXM-627', ICON);
  eq(await userImages(pA), { 'KICM-1641': 800, 'KIXM-627': 512 }, '2枚目（小さい画像は拡大しない）');
  await pA.evaluate(() => window.scrollTo(0, 0));
  await shot(pA, 'p05-grid-with-images');
});

await step('画像でないファイルを選ぶとエラーを表示し、何も保存しない', async () => {
  await openDetail(pA, 'KICM-1662');
  await detail(pA).getByTestId('jacket-input').setInputFiles({ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await detail(pA).getByTestId('jacket-error').waitFor();
  assert((await detail(pA).getByTestId('jacket-error').textContent()).includes('画像ファイルを選んでください'), 'エラー文');
  await detail(pA).getByTestId('jacket-input').setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not really a jpeg') });
  await pA.waitForFunction(() => document.querySelector('[data-testid=jacket-error]')?.textContent.includes('読み込めませんでした'));
  await closeTopDialog(pA);
  eq((await idbRecords(pA)).map((r) => r.id).sort(), ['KICM-1641', 'KIXM-627'], '保存内容は変わらない');
});

await step('別のタブで開いている画面にも、設定した画像がすぐ反映される', async () => {
  const p2 = await A.ctx.newPage();
  await p2.goto(BASE);
  await p2.locator('[data-testid=release]').first().waitFor();
  eq(await userImages(p2), { 'KICM-1641': 800, 'KIXM-627': 512 }, '2つ目のタブ（開いた時点）');
  await setImage(pA, 'KICM-1726', ICON);
  await p2.locator('[data-testid=release][data-id="KICM-1726"] img[data-user-jacket]').waitFor({ timeout: 5000 });
  await p2.close();
});

await step('再読み込み・オフライン起動でも画像が表示される（配信元へは1回も通信しない）', async () => {
  await pA.reload();
  await pA.locator('[data-testid=release]').first().waitFor();
  eq(await userImages(pA), { 'KICM-1641': 800, 'KICM-1726': 512, 'KIXM-627': 512 }, '再読み込み後');
  await A.ctx.setOffline(true);
  await pA.reload();
  await pA.locator('[data-testid=release]').first().waitFor({ timeout: 15000 });
  eq(await userImages(pA), { 'KICM-1641': 800, 'KICM-1726': 512, 'KIXM-627': 512 }, 'オフライン');
  await shot(pA, 'p06-offline');
  await A.ctx.setOffline(false);
  eq(sourceRequests, [], '配信元への通信');
});

let zipPath;
await step('バックアップに画像が含まれる（JSONに一覧、jackets/ に画像。標準の zipfile でも読める）', async () => {
  await openSettings(pA);
  assert((await pA.getByTestId('backup-jacket-note').textContent()).includes('3 枚'), 'バックアップの案内');
  const [dl] = await Promise.all([pA.waitForEvent('download'), pA.getByRole('button', { name: 'バックアップを作成' }).click()]);
  zipPath = resolve(OUT, dl.suggestedFilename());
  await dl.saveAs(zipPath);
  await closeTopDialog(pA);
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  eq(
    Object.keys(zip.files).sort(),
    ['inori-collection-backup.json', 'jackets/KICM-1641.jpg', 'jackets/KICM-1726.jpg', 'jackets/KIXM-627.jpg'],
    'ZIPの中身',
  );
  const json = JSON.parse(await zip.file('inori-collection-backup.json').async('string'));
  eq([json.schemaVersion, json.app.edition, json.app.version, Object.keys(json.jackets).sort()], [2, 'public', APP_VERSION, ['KICM-1641', 'KICM-1726', 'KIXM-627']], 'JSON');
  const out = execSync(
    `python3 -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(sorted(n for n in z.namelist() if n.startswith('jackets/')))" "${zipPath}"`,
  )
    .toString()
    .trim();
  eq(out, "['jackets/KICM-1641.jpg', 'jackets/KICM-1726.jpg', 'jackets/KIXM-627.jpg']", 'Python で読める');
});

// ═════════ 端末B（新しいスマートフォン） ═════════
const B = await newDevice(390, 844);
const pB = B.page;

await step('新しい端末で復元すると、確認画面に画像の枚数が表示され、復元後に画像が表示される', async () => {
  await pB.goto(BASE);
  await pB.locator('[data-testid=release]').first().waitFor();
  await openSettings(pB);
  await restoreInput(pB).setInputFiles(zipPath);
  await pB.getByTestId('confirm-restore').waitFor();
  eq((await pB.getByTestId('restore-jackets').textContent()).trim(), '3枚', '確認画面');
  await shot(pB, 'p07-restore-confirm');
  await pB.getByTestId('confirm-restore').click();
  await pB.getByText('バックアップから復元しました').waitFor();
  eq(await userImages(pB), { 'KICM-1641': 800, 'KICM-1726': 512, 'KIXM-627': 512 }, '復元後');
  await pB.reload();
  await pB.locator('[data-testid=release]').first().waitFor();
  eq(await userImages(pB), { 'KICM-1641': 800, 'KICM-1726': 512, 'KIXM-627': 512 }, '再読み込み後');
});

await step('別の画像を設定してから復元すると置き換わり、「元に戻す」で復元前の画像に戻る', async () => {
  await setImage(pB, 'KICS-3477', ICON);
  await openSettings(pB);
  await restoreInput(pB).setInputFiles(zipPath);
  await pB.getByTestId('confirm-restore').waitFor();
  assert((await pB.getByTestId('restore-jackets-note').textContent()).includes('今の端末の画像 4 枚は削除されます'), '確認画面の注意');
  await pB.getByTestId('confirm-restore').click();
  await pB.getByText('バックアップから復元しました').waitFor();
  eq(await userImages(pB), { 'KICM-1641': 800, 'KICM-1726': 512, 'KIXM-627': 512 }, '置き換え後（KICS-3477 は消える）');
  await pB.getByRole('button', { name: '元に戻す' }).click();
  await pB.getByText('元に戻しました').waitFor();
  eq(await userImages(pB), { 'KICM-1641': 800, 'KICM-1726': 512, 'KICS-3477': 512, 'KIXM-627': 512 }, '元に戻す');
  eq((await idbRecords(pB)).length, 4, '保存内容も戻る');
});

await step('画像の情報がない旧形式（v1.1.1 以前）のバックアップを復元しても、設定した画像はそのまま', async () => {
  await openSettings(pB);
  await restoreInput(pB).setInputFiles(resolve(ROOT, 'tests/fixtures/backup-v1.0.0-34forms.zip'));
  await pB.getByTestId('confirm-restore').waitFor();
  eq((await pB.getByTestId('restore-jackets').textContent()).trim(), '含まれていません', '確認画面');
  await pB.getByTestId('confirm-restore').click();
  await pB.getByText('バックアップから復元しました').waitFor();
  eq(Object.keys(await userImages(pB)).sort(), ['KICM-1641', 'KICM-1726', 'KICS-3477', 'KIXM-627'], '画像はそのまま');
  eq(await pB.locator('[data-testid=badge]').filter({ hasText: '所持' }).count() > 30, true, '所持枚数は復元される');
});

await step('設定した画像を削除すると「タップで画像を設定」の表示に戻る', async () => {
  await openDetail(pB, 'KICS-3477');
  await detail(pB).getByTestId('remove-jacket').click();
  await pB.getByText('の画像を削除しました').waitFor();
  assert((await card(pB, 'KICS-3477').innerText()).includes('タップで画像を設定'), 'プレースホルダー');
  eq((await idbRecords(pB)).map((r) => r.id).sort(), ['KICM-1641', 'KICM-1726', 'KIXM-627'], '保存内容');
  await B.ctx.close();
});

await step('アプリを更新しても、設定した画像・所持データは消えない', async () => {
  server.setRoot(DIST_V2);
  await pA.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await pA.getByText('新しいバージョンがあります').waitFor({ timeout: 30000 });
  await Promise.all([pA.waitForEvent('load', { timeout: 30000 }), pA.getByRole('button', { name: '更新する' }).click()]);
  await pA.locator('[data-testid=release]').first().waitFor();
  await openSettings(pA);
  await pA.getByText('アプリのバージョン：1.2.0-public-e2e（公開版）').waitFor();
  await closeTopDialog(pA);
  eq(await userImages(pA), { 'KICM-1641': 800, 'KICM-1726': 512, 'KIXM-627': 512 }, '更新後');
  server.setRoot(DIST);
});

await step('幅320pxの小型端末でも、画像あり・なしのカードの文字・ボタンがはみ出さない', async () => {
  const S = await newDevice(320, 640);
  await S.page.goto(BASE);
  await S.page.locator('[data-testid=release]').first().waitFor();
  const problems = await S.page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('横スクロール');
    for (const c of document.querySelectorAll('[data-testid=release]')) {
      const cr = c.getBoundingClientRect();
      for (const el of c.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > cr.right + 1 || r.left < cr.left - 1)) {
          out.push(`${c.dataset.id}: はみ出し`);
          break;
        }
      }
    }
    return out;
  });
  eq(problems, [], 'レイアウト');
  await S.page.getByRole('radio', { name: 'MUSIC CLIP BOX' }).click();
  await shot(S.page, 'p08-320-clips');
  await S.ctx.close();
});

await step('最後まで配信元（キングレコード・公式サイト）へは1回も通信していない', async () => {
  eq(sourceRequests, [], '配信元への通信');
});

await browser.close();
await server.close();

const passed = results.filter((r) => r.ok === true).length;
const failed = results.filter((r) => r.ok === false).length;
console.log(`\n${passed} passed, ${failed} failed`);
writeFileSync(resolve(OUT, 'e2e-public-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: 'Chromium (headless)', results }, null, 2));
process.exit(failed === 0 ? 0 : 1);
