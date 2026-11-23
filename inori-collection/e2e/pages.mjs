// E2Eテスト（GitHub Pages 形式の公開）：https://<ユーザー名>.github.io/inori-collection/ のように
// サブパスで公開したときに、表示・インストール・オフライン・更新が正しく動くかを実ブラウザで確認する。
// 実行: npm run test:e2e:pages   （CHROME_PATH で Chromium の実行ファイルを指定可能）
//
// テスト用サーバーは GitHub Pages の配信方法を再現する：
//   - /inori-collection/ の下だけを配信し、それ以外は 404
//   - 存在しないファイルは 404（index.html への自動フォールバックなし）
//   - すべてのファイルに Cache-Control: max-age=600（GitHub Pages の既定）
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(process.env.E2E_OUT || resolve(ROOT, 'e2e/output'));
mkdirSync(OUT, { recursive: true });
const PREFIX = '/inori-collection/';
const APP_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version;

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

// ───────── ビルド（GitHub Pages と同じく BASE_PATH=/inori-collection/ を指定） ─────────
if (!process.env.E2E_SKIP_BUILD) {
  console.log('build (BASE_PATH=/inori-collection/) …');
  execSync('npx vite build --outDir dist-pages-e2e', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, BASE_PATH: PREFIX } });
  console.log('build v2 (更新テスト用) …');
  execSync('npx vite build --outDir dist-pages-e2e-v2', {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, BASE_PATH: PREFIX, APP_VERSION_OVERRIDE: '1.2.0-pages-e2e' },
  });
}

// ───────── GitHub Pages 形式のサーバー ─────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
let siteRoot = resolve(ROOT, 'dist-pages-e2e');
const outsideRequests = [];
const notFound = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send404 = () => {
    notFound.push(url.pathname);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Page not found · GitHub Pages</title><h1>404</h1>');
  };
  if (url.pathname === PREFIX.slice(0, -1)) {
    res.writeHead(301, { Location: PREFIX });
    return res.end();
  }
  if (!url.pathname.startsWith(PREFIX)) {
    outsideRequests.push(url.pathname);
    return send404();
  }
  try {
    const rel = normalize(decodeURIComponent(url.pathname.slice(PREFIX.length))).replace(/^(\.\.[/\\])+/, '');
    let file = join(siteRoot, rel);
    if (!file.startsWith(siteRoot)) return send404();
    let s = await stat(file).catch(() => null);
    if (s?.isDirectory()) {
      file = join(file, 'index.html');
      s = await stat(file).catch(() => null);
    }
    if (!s) return send404();
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(await readFile(file));
  } catch {
    send404();
  }
});
await new Promise((ok) => server.listen(4174, ok));
const ORIGIN = 'http://localhost:4174';
const APP = `${ORIGIN}${PREFIX}`;

const DUMMY_IMG = readFileSync(resolve(ROOT, 'public/icons/icon-192.png'));
let networkDown = false;
let imageRequests = 0;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await browser.newContext({
  viewport: { width: 375, height: 812 },
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
await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
await ctx.route(/^https:\/\/(www\.kingrecords\.co\.jp\/img\/goods|inoriminase\.com\/wp\/wp-content\/uploads)\//, (route) => {
  if (networkDown) return route.abort('internetdisconnected');
  imageRequests++;
  return route.fulfill({ status: 200, contentType: 'image/jpeg', body: DUMMY_IMG });
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => {
  pageErrors.push(e.message);
  console.log('     [pageerror]', e.message);
});
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|net::ERR_FAILED/.test(m.text())) pageErrors.push(m.text());
});

const card = (id) => page.locator(`[data-testid=release][data-id="${id}"]`);
async function counts(id) {
  const vals = await card(id).locator('[data-testid=count]').allTextContents();
  return { unopened: Number(vals[0]), opened: Number(vals[1]) };
}
async function tap(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await locator.click();
}
async function settingsVersion() {
  await page.getByRole('button', { name: '設定（バックアップ・復元）' }).click();
  await page.getByRole('heading', { name: '設定' }).waitFor();
  const text = await page.locator('dialog[open]').last().innerText();
  await page.locator('dialog[open] header button[aria-label="閉じる"]').last().click();
  return /アプリのバージョン：([^\s（]+)/.exec(text)?.[1];
}

console.log(`GitHub Pages 形式のサーバー: ${APP}`);

await step('サブパス（/inori-collection/）で開くと、39形態が表示され、エラーが出ない', async () => {
  await page.goto(APP);
  await page.locator('[data-testid=release]').first().waitFor({ timeout: 20000 });
  eq(await page.locator('[data-testid=release]').count(), 39, '表示件数');
  eq(pageErrors, [], 'エラー');
  await page.screenshot({ path: resolve(OUT, 'pages-01-initial.png') });
});

await step('「/inori-collection」（末尾の / なし）で開いても表示される', async () => {
  await page.goto(`${ORIGIN}/inori-collection`);
  eq(new URL(page.url()).pathname, PREFIX, '転送先');
  await page.locator('[data-testid=release]').first().waitFor({ timeout: 20000 });
});

await step('画面上部のアイコン・ファビコン・ホーム画面用アイコンが読み込まれる', async () => {
  const r = await page.evaluate(async () => {
    const header = document.querySelector('header img');
    const icon = document.querySelector('link[rel=icon]').href;
    const apple = document.querySelector('link[rel=apple-touch-icon]').href;
    return {
      header: header.complete && header.naturalWidth > 0,
      headerSrc: new URL(header.src).pathname,
      icon: [new URL(icon).pathname, (await fetch(icon)).status],
      apple: [new URL(apple).pathname, (await fetch(apple)).status],
    };
  });
  eq(r, {
    header: true,
    headerSrc: '/inori-collection/favicon.svg',
    icon: ['/inori-collection/favicon.svg', 200],
    apple: ['/inori-collection/icons/apple-touch-icon.png', 200],
  }, 'アイコン');
});

await step('マニフェスト：開始URL・範囲（scope）・アイコンが /inori-collection/ を指している', async () => {
  const m = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const json = await (await fetch(href)).json();
    const abs = (u) => new URL(u, href);
    const icons = await Promise.all(json.icons.map(async (i) => [abs(i.src).pathname, i.purpose, (await fetch(abs(i.src))).status]));
    return {
      href: new URL(href).pathname,
      start: abs(json.start_url).pathname,
      scope: abs(json.scope).pathname,
      id: abs(json.id).pathname,
      display: json.display,
      icons,
    };
  });
  eq(m, {
    href: '/inori-collection/manifest.webmanifest',
    start: '/inori-collection/',
    scope: '/inori-collection/',
    id: '/inori-collection/',
    display: 'standalone',
    icons: [
      ['/inori-collection/icons/icon-192.png', 'any', 200],
      ['/inori-collection/icons/icon-512.png', 'any', 200],
      ['/inori-collection/icons/icon-maskable-512.png', 'maskable', 200],
    ],
  }, 'マニフェスト');
});

await step('Service Worker が /inori-collection/ の範囲で有効になり、「オフラインOK」になる', async () => {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 }).catch(async () => {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  });
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { scope: new URL(r.scope).pathname, script: new URL(r.active.scriptURL).pathname };
  });
  eq(reg, { scope: '/inori-collection/', script: '/inori-collection/sw.js' }, '登録');
  await page.locator('[data-testid=offline-pill][data-state=ready]').waitFor({ timeout: 40000 });
  eq((await page.getByTestId('offline-pill').textContent()).trim(), 'オフラインOK', 'ヘッダー表示');
  const cached = await page.evaluate(async () => (await (await caches.open('inori-jackets-v1')).keys()).length);
  eq(cached, 39, 'ジャケットのキャッシュ数');
});

// 注：Chrome の Page.getInstallabilityErrors はこのテスト環境（ヘッドレス）ではマニフェストが 404 でも
// 空を返すため判定に使えない。代わりに Chrome 自身が読み込んだマニフェストの内容と、インストールの条件を個別に確認する。
await step('Chrome がマニフェストを読み込めており、ホーム画面追加（インストール）の条件を満たしている', async () => {
  const cdp = await ctx.newCDPSession(page);
  const m = await cdp.send('Page.getAppManifest');
  await cdp.detach();
  eq(new URL(m.url).pathname, '/inori-collection/manifest.webmanifest', 'Chrome が読んだマニフェストのURL');
  assert(m.data && m.data.length > 0, 'Chrome がマニフェストの中身を読めていない');
  eq(m.errors, [], 'マニフェストの解析エラー');
  eq([m.manifest.startUrl, m.manifest.scope, m.manifest.id], [APP, APP, APP], 'Chrome が解釈した開始URL・範囲・ID');
  // インストールの条件：名前・192px と 512px のアイコン・standalone 表示・開始URLが範囲内・ページを制御する Service Worker
  const c = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const j = await (await fetch(href)).json();
    const sizes = await Promise.all(
      j.icons.map(
        (i) =>
          new Promise((ok) => {
            const img = new Image();
            img.onload = () => ok(`${img.naturalWidth}x${img.naturalHeight}`);
            img.onerror = () => ok('error');
            img.src = new URL(i.src, href).href;
          }),
      ),
    );
    const start = new URL(j.start_url, href).href;
    const scope = new URL(j.scope, href).href;
    return {
      name: !!j.name && !!j.short_name,
      display: j.display,
      icons: sizes,
      startInScope: start.startsWith(scope),
      pageInScope: location.href.startsWith(scope),
      sw: !!navigator.serviceWorker.controller,
    };
  });
  eq(c, { name: true, display: 'standalone', icons: ['192x192', '512x512', '512x512'], startInScope: true, pageInScope: true, sw: true }, 'インストール条件');
});

await step('アプリのファイルの読み込みが /inori-collection/ の外に出ていない', async () => {
  eq(outsideRequests, [], '/inori-collection/ の外へのリクエスト');
  eq(notFound, [], '404 になったファイル');
});

await step('枚数を変更すると保存され、再読み込み後も残る', async () => {
  await tap(card('KICM-1641').locator('button[aria-label$="未開封を1枚増やす"]'));
  await tap(card('KIXM-398').locator('button[aria-label$="開封済を1枚増やす"]'));
  await page.reload();
  await page.locator('[data-testid=release]').first().waitFor();
  eq(await counts('KICM-1641'), { unopened: 1, opened: 0 }, 'KICM-1641');
  eq(await counts('KIXM-398'), { unopened: 0, opened: 1 }, 'KIXM-398');
});

await step('オフライン（機内モード相当）でも /inori-collection/ で起動でき、ジャケットも表示される', async () => {
  networkDown = true;
  imageRequests = 0;
  await ctx.setOffline(true);
  await page.goto(APP);
  await page.locator('[data-testid=release]').first().waitFor({ timeout: 15000 });
  eq(await page.locator('[data-testid=release]').count(), 39, 'オフライン一覧');
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=release] img')].every((i) => i.complete), null, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('[data-testid=release] img')];
    return { n: imgs.length, ok: imgs.filter((i) => i.naturalWidth > 0).length };
  });
  eq(r, { n: 39, ok: 39 }, 'オフラインのジャケット');
  eq(imageRequests, 0, '外部への画像リクエスト');
  eq(await counts('KICM-1641'), { unopened: 1, opened: 0 }, 'オフラインで所持データ');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(OUT, 'pages-02-offline.png') });
});

await step('オフラインで index.html や ?付きのURLで開いても起動できる', async () => {
  for (const u of [`${APP}index.html`, `${APP}?source=homescreen`]) {
    await page.goto(u);
    await page.locator('[data-testid=release]').first().waitFor({ timeout: 15000 });
  }
  networkDown = false;
  await ctx.setOffline(false);
});

await step('バックアップ（ZIP）を書き出せる', async () => {
  await page.goto(APP);
  await page.locator('[data-testid=release]').first().waitFor();
  await page.getByRole('button', { name: '設定（バックアップ・復元）' }).click();
  await page.getByRole('heading', { name: '設定' }).waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /バックアップを(作成|書き出)/ }).click()]);
  assert(/^inori-collection-backup-.*\.zip$/.test(dl.suggestedFilename()), `ファイル名 ${dl.suggestedFilename()}`);
  await page.locator('dialog[open] header button[aria-label="閉じる"]').last().click();
});

await step('新しいバージョンを公開すると「更新する」で切り替わり、データは残る（GitHub Pages のキャッシュ設定 max-age=600 でも）', async () => {
  eq(await settingsVersion(), APP_VERSION, '更新前のバージョン');
  siteRoot = resolve(ROOT, 'dist-pages-e2e-v2');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.getByText('新しいバージョンがあります').waitFor({ timeout: 30000 });
  await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.getByRole('button', { name: '更新する' }).click()]);
  await page.locator('[data-testid=release]').first().waitFor();
  eq(await settingsVersion(), '1.2.0-pages-e2e', '更新後のバージョン');
  eq(await counts('KICM-1641'), { unopened: 1, opened: 0 }, '更新後の所持データ');
  eq(new URL(page.url()).pathname, PREFIX, '更新後のURL');
});

await step('更新後もオフラインで起動できる', async () => {
  networkDown = true;
  await ctx.setOffline(true);
  await page.reload();
  await page.locator('[data-testid=release]').first().waitFor({ timeout: 15000 });
  eq(await settingsVersion(), '1.2.0-pages-e2e', 'オフラインでのバージョン');
  networkDown = false;
  await ctx.setOffline(false);
  eq(outsideRequests, [], '/inori-collection/ の外へのリクエスト');
});

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nGitHub Pages 形式 E2E: ${results.length - failed.length}/${results.length} 成功`);
for (const f of failed) console.log('  ✘', f.name, '\n     ', f.error);
process.exit(failed.length ? 1 : 0);
