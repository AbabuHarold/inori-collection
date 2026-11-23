import type { Category, Release } from './types';
// 個人用版は src/data/jackets.ts、公開版（INORI_EDITION=public）は src/data/jackets.public.ts（空）を読み込む。
// 対応は package.json の "imports" と vite.config.ts を参照。
import { JACKETS } from '#jackets';

/**
 * 作品マスターデータ
 *
 * ■ 情報源（2026-11-23 確認）
 *   1. 水瀬いのり公式サイト ディスコグラフィー（最優先）
 *      https://inoriminase.com/discography/
 *      2026-11 にリニューアルが完了し、全作品の詳細ページ（/discography/<番号>/）が公開された。
 *      全作品の作品名・発売日・形態・品番・形態別ジャケットを、リニューアル後の詳細ページで確認した。
 *   2. キングレコード公式の商品ページ（補助）
 *      https://www.kingrecords.co.jp/cs/artist/artist.aspx?artist=44810
 *      公式サイトと照合し、一致を確認した。
 *
 * ■ ジャケット画像
 *   画像URLはこのファイルではなく src/data/jackets.ts に書く（公開版のビルドから画像URLを除くため）。
 *
 * ■ 変更ルール（docs/UPDATING.md も参照）
 *   - 既存レコードの `id` は絶対に変更しない（所持データとバックアップのキー）
 *   - 新作・追加形態は配列に追加するだけでよい（初期所持枚数は自動的に 0）
 *   - レコードを削除しても所持データは「マスターにないデータ」として保持される
 */
export const MASTER_VERSION = '2026-11-23';

const KING = 'https://www.kingrecords.co.jp';
const OFFICIAL = 'https://inoriminase.com';
const VERIFIED = '2026-11-23';

function rel(
  id: string,
  workKey: string,
  title: string,
  category: Category,
  releaseDate: string,
  opts: {
    edition?: string | null;
    format?: string | null;
    catalogNumber?: string;
    /** 公式サイトの詳細ページの番号（https://inoriminase.com/discography/<番号>/） */
    official: number;
    /** キングレコードで情報を確認した商品ページの品番。掲載がなければ null */
    kingPage?: string | null;
  },
): Release {
  const kingPage = opts.kingPage === undefined ? id : opts.kingPage;
  return {
    id,
    workKey,
    title,
    category,
    releaseDate,
    edition: opts.edition ?? null,
    format: opts.format ?? null,
    catalogNumber: opts.catalogNumber ?? id,
    jacketUrls: JACKETS[id] ? [...JACKETS[id]] : [],
    officialUrl: `${OFFICIAL}/discography/${opts.official}/`,
    sourceUrl: kingPage ? `${KING}/cs/g/g${kingPage}/` : null,
    verifiedAt: VERIFIED,
  };
}

export const RELEASES: Release[] = [
  // ───────────── SINGLE（公式：1st〜14th SINGLE） ─────────────
  rel('KICM-1641', 'single-01', '夢のつぼみ', 'single', '2015-12-02', { format: 'CD', official: 1858 }),
  rel('KICM-1662', 'single-02', 'harmony ribbon', 'single', '2016-04-13', { format: 'CD', official: 1856 }),
  rel('KICM-1726', 'single-03', 'Starry Wish', 'single', '2016-11-09', { format: 'CD', official: 1851 }),
  rel('KICM-1783', 'single-04', 'アイマイモコ', 'single', '2017-08-09', { format: 'CD', official: 1860 }),
  rel('KICM-1817', 'single-05', 'Ready Steady Go!', 'single', '2017-11-29', { format: 'CD', official: 1862 }),
  rel('KICM-1890', 'single-06', 'TRUST IN ETERNITY', 'single', '2018-10-17', { format: 'CD', official: 1873 }),
  rel('KICM-1914', 'single-07', 'Wonder Caravan！', 'single', '2019-01-23', { format: 'CD', official: 1875 }),
  rel('KICM-2029', 'single-08', 'ココロソマリ', 'single', '2020-02-05', { format: 'CD', official: 1889 }),
  rel('KICM-2065', 'single-09', 'Starlight Museum', 'single', '2020-12-02', { format: 'CD', official: 1891 }),
  rel('KICM-2092', 'single-10', 'HELLO HORIZON', 'single', '2021-07-21', { format: 'CD', official: 1895 }),
  rel('KICM-2128', 'single-11', 'アイオライト', 'single', '2023-04-19', { format: 'CD', official: 1912 }),
  rel('KICM-2138', 'single-12', 'スクラップアート', 'single', '2023-09-13', { format: 'CD', official: 1914 }),
  rel('KICM-2174', 'single-13', 'Summer Challenger', 'single', '2026-07-22', { format: 'CD', official: 1955 }),
  // 14th Single：v1.2.0 で追加（2027-01-27 発売予定。公式サイト・キングレコードで確認）
  rel('KICM-2183', 'single-14', '未解決で、ロマンスで。', 'single', '2027-01-27', { format: 'CD', official: 2445 }),

  // ───────────── ALBUM（公式：1st〜4th ALBUM / 1st・2nd HALF ALBUM / BEST ALBUM） ─────────────
  // Innocent flower 初回限定盤：v1.1.0 で追加（キングレコードには掲載なし）
  rel('KICS-93477', 'album-innocent-flower', 'Innocent flower', 'album', '2017-04-05', { edition: '初回限定盤', format: 'CD+BD', official: 1853, kingPage: null }),
  rel('KICS-3477', 'album-innocent-flower', 'Innocent flower', 'album', '2017-04-05', { edition: '通常盤', format: 'CD', official: 1853 }),
  rel('KICS-93710', 'album-blue-compass', 'BLUE COMPASS', 'album', '2018-05-23', { edition: '初回限定盤', format: 'CD+BD', official: 1866 }),
  rel('KICS-3710', 'album-blue-compass', 'BLUE COMPASS', 'album', '2018-05-23', { edition: '通常盤', format: 'CD', official: 1866, kingPage: 'KICS-93710' }),
  // Catch the Rainbow！ 初回限定盤：v1.1.0 で追加（キングレコードには掲載なし）
  rel('KICS-93785', 'album-catch-the-rainbow', 'Catch the Rainbow！', 'album', '2019-04-10', { edition: '初回限定盤', format: 'CD+BD', official: 1879, kingPage: null }),
  rel('KICS-3785', 'album-catch-the-rainbow', 'Catch the Rainbow！', 'album', '2019-04-10', { edition: '通常盤', format: 'CD', official: 1879 }),
  rel('KICS-94059', 'album-glow', 'glow', 'album', '2022-07-20', { edition: '初回限定盤', format: 'CD+BD', official: 1907 }),
  rel('KICS-4059', 'album-glow', 'glow', 'album', '2022-07-20', { edition: '通常盤', format: 'CD', official: 1907, kingPage: 'KICS-94059' }),
  rel('KICS-94166', 'album-heart-bookmark', 'heart bookmark', 'album', '2024-08-21', { edition: '初回限定盤', format: 'CD+Blu-ray', official: 1918 }),
  rel('KICS-4166', 'album-heart-bookmark', 'heart bookmark', 'album', '2024-08-21', { edition: '通常盤', format: 'CD', official: 1918, kingPage: 'KICS-94166' }),
  rel('KICS-94217', 'album-travel-record', 'Travel Record', 'album', '2025-09-03', { edition: '初回限定盤', format: 'CD2枚組+Blu-ray', catalogNumber: 'KICS-94217～8', official: 1943 }),
  rel('KICS-4217', 'album-travel-record', 'Travel Record', 'album', '2025-09-03', { edition: '通常盤', format: 'CD2枚組', catalogNumber: 'KICS-4217～8', official: 1943, kingPage: 'KICS-94217' }),
  rel('KICS-94219', 'album-turquoise', 'Turquoise', 'album', '2025-09-03', { edition: '初回限定盤', format: 'CD+Blu-ray', official: 1939 }),
  rel('KICS-4219', 'album-turquoise', 'Turquoise', 'album', '2025-09-03', { edition: '通常盤', format: 'CD', official: 1939, kingPage: 'KICS-94219' }),

  // ───────────── LIVE Blu-ray（公式カテゴリー「Blu-ray」のうち LIVE Blu-ray） ─────────────
  rel('KIXM-315', 'live-2017-1st', 'Inori Minase 1st LIVE Ready Steady Go!', 'bluray', '2018-04-04', { format: 'Blu-ray', official: 1864 }),
  rel('KIXM-340', 'live-2018-blue-compass', 'Inori Minase LIVE TOUR BLUE COMPASS', 'bluray', '2018-10-17', { format: 'Blu-ray', official: 1871 }),
  rel('KIXM-398', 'live-2019-catch-the-rainbow', 'Inori Minase LIVE TOUR Catch the Rainbow！', 'bluray', '2019-10-23', { format: 'Blu-ray', official: 1887 }),
  rel('KIXM-449', 'live-2020-5th-anniversary', 'Inori Minase 5th ANNIVERSARY LIVE Starry Wishes', 'bluray', '2021-03-24', { format: 'Blu-ray', official: 1893 }),
  rel('KIXM-493', 'live-2021-hello-horizon', 'Inori Minase LIVE TOUR HELLO HORIZON', 'bluray', '2022-02-23', { format: 'Blu-ray', official: 1905 }),
  rel('KIXM-536', 'live-2022-glow', 'Inori Minase LIVE TOUR glow', 'bluray', '2023-04-19', { format: 'Blu-ray', official: 1910 }),
  rel('KIXM-578', 'live-2023-scrap-art', 'Inori Minase LIVE TOUR SCRAP ART', 'bluray', '2024-03-06', { format: 'Blu-ray', catalogNumber: 'KIXM-578～9', official: 1916 }),
  rel('KIXM-618', 'live-2024-heart-bookmark', 'Inori Minase LIVE TOUR heart bookmark', 'bluray', '2025-03-12', { format: 'Blu-ray', catalogNumber: 'KIXM-618～9', official: 1921 }),
  rel('KIXM-648', 'live-2025-10th-anniversary', 'Inori Minase 10th ANNIVERSARY LIVE TOUR Travel Record', 'bluray', '2026-03-11', { format: 'Blu-ray', catalogNumber: 'KIXM-648～9', official: 1951 }),

  // ───────────── MUSIC CLIP BOX（公式カテゴリー「Blu-ray」のうち MUSIC CLIPS） ─────────────
  // v1.2.0 で追加（公式サイト・キングレコードで確認）
  rel('KIXM-379', 'clips-01', 'Inori Minase MUSIC CLIP BOX', 'clips', '2019-06-26', { format: 'Blu-ray', official: 1882 }),
  rel('KIXM-627', 'clips-02', 'Inori Minase MUSIC CLIP BOX 2', 'clips', '2025-06-18', { format: 'Blu-ray', official: 1931 }),
];

export const CATEGORY_LABEL: Record<Category, string> = {
  single: 'シングル',
  album: 'アルバム',
  bluray: 'ライブBlu-ray',
  clips: 'MUSIC CLIP BOX',
};

export const CATEGORY_ORDER: Record<Category, number> = { single: 0, album: 1, bluray: 2, clips: 3 };

/** 一覧に表示する形態ラベル（例: "初回限定盤（CD+BD）"） */
export function editionLabel(r: Release): string {
  if (r.edition && r.format) return `${r.edition}（${r.format}）`;
  return r.edition ?? r.format ?? '形態情報なし';
}
