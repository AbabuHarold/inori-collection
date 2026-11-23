import { JACKETS_FROM_SOURCES } from '#jackets';

/**
 * アプリの版（vite.config.ts の INORI_EDITION / --mode public で切り替え）
 * - personal：ジャケット画像を公式の配信元から取得して表示する個人用版（既定）
 * - public  ：配信元から画像を取得しない公開用版。ジャケット画像は使う人が端末内で設定する
 */
export const EDITION: 'personal' | 'public' = JACKETS_FROM_SOURCES ? 'personal' : 'public';
export const IS_PUBLIC_EDITION = EDITION === 'public';
