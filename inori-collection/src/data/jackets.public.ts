/**
 * ジャケット画像の配信元URL（公開版）
 *
 * 公開版（INORI_EDITION=public でビルド）では、src/data/jackets.ts の代わりにこのファイルが使われる（vite.config.ts）。
 * 画像URLを1つも持たないため、公開版のアプリは配信元（キングレコード・水瀬いのり公式サイト）から画像を取得しない。
 * ジャケット画像は、使う人が自分の端末で後から設定する（src/lib/userJackets.ts）。
 */

/** 画像を配信元から取得する版か */
export const JACKETS_FROM_SOURCES = false;

/** 形態ID → ジャケット画像URLの候補（公開版は常に空） */
export const JACKETS: Readonly<Record<string, readonly string[]>> = Object.freeze({});
