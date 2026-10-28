// v1.0.0（34形態版）の実際のアプリでバックアップZIPを作り、互換性テスト用のフィクスチャとして保存する。
//
// 使い方: node e2e/make-v1-fixture.mjs <v1.0.0 のビルド済み dist ディレクトリ>
//   （v1.0.0 は git の最初のコミット e4f6707。`git worktree add ../v1src e4f6707` → `npx vite build --outDir ../v1-dist`）
//
// 生成物（一度作ったら変更しないこと）:
//   tests/fixtures/backup-v1.0.0-34forms.zip            … v1.0.0 の「バックアップを作成」で作ったZIP
//   tests/fixtures/backup-v1.0.0-34forms.expected.json  … 作成時点の v1.0.0 の所持データ（検証用）
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './server.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const distDir = process.argv[2];
if (!distDir) throw new Error('v1.0.0 の dist ディレクトリを指定してください');

const server = await startServer(resolve(distDir), 4180);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
const page = await ctx.newPage();
await page.goto(server.url);
await page.locator('[data-testid=release]').first().waitFor();

const version = await page.evaluate(() => document.body.innerText.includes('Inori Collection'));
if (!version) throw new Error('アプリが表示されない');

// 1) 当時マスター未登録だった KICS-93477 を含むバックアップ（v1.0.0 形式のサンプル）を復元しておく
await page.getByRole('button', { name: '設定（バックアップ・復元）' }).click();
await page.locator('[data-testid=restore-input]').setInputFiles(resolve(ROOT, 'tests/fixtures/backup-v1-sample.zip'));
await page.getByTestId('confirm-restore').click();
await page.locator('[data-testid=release]').first().waitFor();

// 2) 絞り込みを解除し、34形態すべてを画面の＋ボタンで登録する
if ((await page.locator('#filter-panel').count()) === 0) await page.getByRole('button', { name: /絞り込み/ }).click();
await page.getByRole('button', { name: '検索・絞り込み条件をリセット' }).click();
await page.getByRole('radio', { name: 'グリッド表示' }).click();
const ids = await page.locator('[data-testid=release]').evaluateAll((els) => els.map((e) => e.dataset.id));
if (ids.length !== 34) throw new Error(`v1.0.0 の形態数が34ではない: ${ids.length}`);
for (let i = 0; i < ids.length; i++) {
  const card = page.locator(`[data-testid=release][data-id="${ids[i]}"]`);
  const plus = async (label) => {
    const b = card.locator(`button[aria-label$="${label}を1枚増やす"]`);
    await b.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await b.click();
  };
  await plus('未開封');
  if (i % 3 === 0) await plus('開封済');
  if (i % 5 === 0) await plus('未開封');
}
await page.waitForTimeout(300);

// 3) v1.0.0 の画面から「バックアップを作成」
await page.getByRole('button', { name: '設定（バックアップ・復元）' }).click();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを作成' }).click()]);
const zipPath = resolve(ROOT, 'tests/fixtures/backup-v1.0.0-34forms.zip');
await dl.saveAs(zipPath);

const stored = await page.evaluate(() => ({
  collection: JSON.parse(localStorage.getItem('inori-collection/collection')).items,
  settings: JSON.parse(localStorage.getItem('inori-collection/settings')),
  appVersionText: document.body.innerText,
}));
writeFileSync(
  resolve(ROOT, 'tests/fixtures/backup-v1.0.0-34forms.expected.json'),
  JSON.stringify({ createdBy: 'Inori Collection v1.0.0 (commit e4f6707)', v1FormIds: ids, collection: stored.collection, settings: stored.settings }, null, 2) + '\n',
);
console.log('wrote', zipPath, readFileSync(zipPath).length, 'bytes;', Object.keys(stored.collection).length, 'entries');
await browser.close();
await server.close();
