/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

/**
 * 公開先のパス。
 * - Vercel など、ドメイン直下で公開する場合：未指定（'/'）
 * - GitHub Pages（https://<ユーザー名>.github.io/<リポジトリ名>/）：BASE_PATH=/<リポジトリ名>/
 *   （.github/workflows/deploy.yml が自動で指定します）
 */
function resolveBase(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (value === '' || value === '/') return '/';
  if (!/^\/?[A-Za-z0-9._~\-/]+\/?$/.test(value) || value.includes('..') || value.includes('//')) {
    throw new Error(`BASE_PATH が不正です: "${value}"（例：/inori-collection/）`);
  }
  return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}
const base = resolveBase(process.env.BASE_PATH);

/**
 * アプリの版
 * - personal（既定）：ジャケット画像を公式の配信元（キングレコード・水瀬いのり公式サイト）から取得して表示する個人用版
 * - public          ：配信元から画像を取得しない公開用版。画像URLをビルドに含めず、画像は使う人が端末内で後から設定する
 *
 * 公開版のビルド：`npm run build:public`（= vite build --mode public）、または環境変数 INORI_EDITION=public
 */
function resolveEdition(mode: string): 'personal' | 'public' {
  const raw = (process.env.INORI_EDITION ?? '').trim();
  if (raw !== '' && raw !== 'personal' && raw !== 'public') {
    throw new Error(`INORI_EDITION が不正です: "${raw}"（personal または public を指定してください）`);
  }
  return mode === 'public' || raw === 'public' ? 'public' : 'personal';
}

export default defineConfig(({ mode }) => {
  const isPublic = resolveEdition(mode) === 'public';

  return {
    base,
    define: {
      // E2Eテストで「アプリ更新」を再現するときだけ APP_VERSION_OVERRIDE で別バージョンとしてビルドする
      __APP_VERSION__: JSON.stringify(process.env.APP_VERSION_OVERRIDE || pkg.version),
    },
    resolve: {
      // 公開版では、画像URLの一覧（src/data/jackets.ts）の代わりに空の一覧（jackets.public.ts）を読み込む。
      // これで公開版のビルドには画像URLが1つも含まれない（.github/workflows/deploy.yml と e2e/public.mjs で確認）。
      // 個人用版は package.json の "imports" の指定どおり src/data/jackets.ts を読み込む。
      alias: isPublic
        ? [{ find: /^#jackets$/, replacement: fileURLToPath(new URL('./src/data/jackets.public.ts', import.meta.url)) }]
        : [],
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // 更新はユーザーが「更新する」を押したときだけ適用（操作中に勝手に再読み込みしない）
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          // id / start_url / scope は公開先のパスに合わせる（GitHub Pages では /<リポジトリ名>/）
          id: base,
          name: 'Inori Collection',
          short_name: 'Inori Collection',
          description: isPublic
            ? '水瀬いのりのCD・Blu-rayの所持状況を管理するコレクションアプリ（非公式）'
            : '水瀬いのりのCD・Blu-rayの所持状況を管理する個人用コレクションアプリ',
          lang: 'ja',
          dir: 'ltr',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#ffffff',
          theme_color: '#79C8ED',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          navigateFallback: `${base}index.html`,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: false,
          // 公開版は配信元の画像を一切扱わない（自分で設定した画像は IndexedDB に保存するので Service Worker は関与しない）
          runtimeCaching: isPublic
            ? []
            : [
                {
                  // ジャケット画像（公式配信元：キングレコード / 水瀬いのり公式サイト）。一度取得したら端末内キャッシュから表示する。
                  // ※ この関数は Service Worker のコードに埋め込まれるため、外側の変数や関数を参照しないこと
                  urlPattern: ({ url }) =>
                    (url.origin === 'https://www.kingrecords.co.jp' && url.pathname.startsWith('/img/goods/')) ||
                    (url.origin === 'https://inoriminase.com' && url.pathname.startsWith('/wp/wp-content/uploads/')),
                  handler: 'CacheFirst',
                  options: {
                    cacheName: 'inori-jackets-v1',
                    // 配信元はCORS非対応のため応答は opaque（中身もステータスも見えない）。
                    // 404 のHTMLでも opaque として保存できてしまうため、Service Worker 自身は保存しない（status 200 のみ＝実質保存しない）。
                    // キャッシュへの保存は、画像として表示できることを確認するアプリ側（src/lib/offline.ts）だけが行う。
                    cacheableResponse: { statuses: [200] },
                  },
                },
              ],
        },
        devOptions: { enabled: false },
      }),
    ],
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/setup.ts'],
    },
  };
});
