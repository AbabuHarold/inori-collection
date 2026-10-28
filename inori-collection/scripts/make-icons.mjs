// アプリアイコン（PNG）を SVG から生成する。
// 実行: npm run icons  （CHROME_PATH にChromium系ブラウザの実行ファイルを指定。未指定ならPlaywright標準のChromium）
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = new URL('../public/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });

/** @param {number} size @param {number} discScale 円盤の大きさ(背景比) @param {boolean} rounded */
function svg(size, discScale, rounded) {
  const r = 168 * discScale;
  const hole = 52 * discScale;
  const center = 22 * discScale;
  const arc1 = 152 * discScale;
  const arc2 = 116 * discScale;
  const c = 256;
  const p = (rad, deg) => [c + rad * Math.cos((deg * Math.PI) / 180), c + rad * Math.sin((deg * Math.PI) / 180)];
  const [x1a, y1a] = p(arc1, -90);
  const [x1b, y1b] = p(arc1, -30);
  const [x2a, y2a] = p(arc2, -90);
  const [x2b, y2b] = p(arc2, -30);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="#79C8ED"/>
  <circle cx="256" cy="256" r="${r}" fill="#ffffff"/>
  <path d="M${x1a} ${y1a}A${arc1} ${arc1} 0 0 1 ${x1b} ${y1b}" fill="none" stroke="#C4E7F8" stroke-width="${14 * discScale}" stroke-linecap="round"/>
  <path d="M${x2a} ${y2a}A${arc2} ${arc2} 0 0 1 ${x2b} ${y2b}" fill="none" stroke="#E3F4FC" stroke-width="${10 * discScale}" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="${hole}" fill="#79C8ED"/>
  <circle cx="256" cy="256" r="${center}" fill="#ffffff"/>
</svg>`;
}

const targets = [
  // purpose: any（四角いアイコン。OS側で角丸にされる）
  { file: 'icon-192.png', size: 192, scale: 1, rounded: false },
  { file: 'icon-512.png', size: 512, scale: 1, rounded: false },
  // purpose: maskable（円形などに切り抜かれても欠けないよう、中央80%の安全領域内に収める）
  { file: 'icon-maskable-512.png', size: 512, scale: 0.78, rounded: false },
  // iPhone ホーム画面用（透過不可・角丸はiOSが付ける）
  { file: 'apple-touch-icon.png', size: 180, scale: 1, rounded: false },
];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0">${svg(t.size, t.scale, t.rounded)}</body></html>`);
  await page.locator('svg').screenshot({ path: new URL(t.file, outDir).pathname, omitBackground: false });
  console.log('wrote', t.file);
}
await browser.close();
