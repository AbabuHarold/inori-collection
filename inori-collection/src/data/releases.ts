import type { Category, Release } from './types';

/**
 * 作品マスターデータ
 *
 * ■ 情報源（2026-10-28 確認）
 *   1. 水瀬いのり公式サイト ディスコグラフィー（最優先）
 *      https://www.inoriminase.com/discography/
 *      2026-10-28 時点、公式サイトはメンテナンス明けの「一部サービス再開」でディスコグラフィーが 404 のため、
 *      Internet Archive に保存された公式ページ（2025-04〜2026-09 保存分）で
 *      全作品の作品名・発売日・形態・品番・形態別ジャケットを確認した。
 *   2. キングレコード公式の商品ページ（補助）
 *      https://www.kingrecords.co.jp/cs/artist/artist.aspx?artist=44810
 *      公式サイトと全項目を照合し、一致を確認した。
 *
 * ■ ジャケット画像
 *   画像ファイルは同梱しない。公式配信元の URL を参照し、端末内にのみキャッシュする。
 *   候補の順番：キングレコード（2026-10-28 時点で全て配信中）→ 水瀬いのり公式サイト
 *   （同日時点では公式サイト改修中のため大半が 404。復旧すれば自動的に使われる）。
 *   ※『Innocent flower』『Catch the Rainbow！』初回限定盤はキングレコードに画像がなく、公式サイトの画像のみ。
 *
 * ■ 変更ルール（docs/UPDATING.md も参照）
 *   - 既存レコードの `id` は絶対に変更しない（所持データとバックアップのキー）
 *   - 新作・追加形態は配列に追加するだけでよい（初期所持枚数は自動的に 0）
 *   - レコードを削除しても所持データは「マスターにないデータ」として保持される
 */
export const MASTER_VERSION = '2026-10-28.2';

const KING = 'https://www.kingrecords.co.jp';
const OFFICIAL = 'https://www.inoriminase.com';
const VERIFIED = '2026-10-28';

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
    /** キングレコードの画像パス（/img/goods/ 以下）。掲載がなければ省略 */
    king?: string;
    /** 公式サイトの画像ファイル名（/img/disco/images_pc/ 以下） */
    officialImage?: string;
    /** 公式サイトの詳細ページのクエリ（例 "?category_id=2&id=4"） */
    official: string;
    /** キングレコードで情報を確認した商品ページの品番。掲載がなければ null */
    kingPage?: string | null;
  },
): Release {
  const jacketUrls: string[] = [];
  if (opts.king) jacketUrls.push(`${KING}/img/goods/${opts.king}`);
  if (opts.officialImage) jacketUrls.push(`${OFFICIAL}/img/disco/images_pc/${opts.officialImage}`);
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
    jacketUrls,
    officialUrl: `${OFFICIAL}/discography/${opts.official}`,
    sourceUrl: kingPage ? `${KING}/cs/g/g${kingPage}/` : null,
    verifiedAt: VERIFIED,
  };
}

export const RELEASES: Release[] = [
  // ───────────── SINGLE（公式：1st〜13th SINGLE） ─────────────
  rel('KICM-1641', 'single-01', '夢のつぼみ', 'single', '2015-12-02', { format: 'CD', king: 'L/c966882027bc4237a58b546ab62efde9.jpg', officialImage: '60a4e3bf248cf.jpg', official: '?id=6' }),
  rel('KICM-1662', 'single-02', 'harmony ribbon', 'single', '2016-04-13', { format: 'CD', king: 'L/b50d6389cc2a466aa123fc747a3e1027.jpg', officialImage: '60a4e55e62520.jpg', official: '?id=5' }),
  rel('KICM-1726', 'single-03', 'Starry Wish', 'single', '2016-11-09', { format: 'CD', king: 'L/7cc4742d2ab74139b15cbf1fd022c3cc.jpg', officialImage: '60a4e57784cd7.jpg', official: '?id=3' }),
  rel('KICM-1783', 'single-04', 'アイマイモコ', 'single', '2017-08-09', { format: 'CD', king: 'L/343f39748ab54b1eb1b1d5012da539b7.jpg', officialImage: '60a4ecba5a14f.jpg', official: '?category_id=1&id=12' }),
  rel('KICM-1817', 'single-05', 'Ready Steady Go!', 'single', '2017-11-29', { format: 'CD', king: 'L/c82fcb20c4104013a9fe3e2e4263992a.jpg', officialImage: '60a4ecd5e4ff8.jpg', official: '?category_id=1&id=13' }),
  rel('KICM-1890', 'single-06', 'TRUST IN ETERNITY', 'single', '2018-10-17', { format: 'CD', king: 'L/1f9c1fd12b9044d4ba92e15d9dc3770a.jpg', officialImage: '60a4ed3a913da.jpg', official: '?category_id=1&id=29' }),
  rel('KICM-1914', 'single-07', 'Wonder Caravan！', 'single', '2019-01-23', { format: 'CD', king: 'L/8ad4bd4054664b73b7f0d0cdc75550c5.jpg', officialImage: '60a4ed50110f0.jpg', official: '?category_id=1&id=31' }),
  rel('KICM-2029', 'single-08', 'ココロソマリ', 'single', '2020-02-05', { format: 'CD', king: 'L/8468ae64ce544dfba268d262fbf889a8.jpg', officialImage: '60a4ede544191.jpg', official: '?category_id=1&id=45' }),
  rel('KICM-2065', 'single-09', 'Starlight Museum', 'single', '2020-12-02', { format: 'CD', king: 'L/af7b920d730e489689b1b3982aa16894.jpg', officialImage: '60a4ee03c1ce6.jpg', official: '?category_id=1&id=46' }),
  rel('KICM-2092', 'single-10', 'HELLO HORIZON', 'single', '2021-07-21', { format: 'CD', king: 'L/655665fe55b84989974afd1e8cff561b.jpg', officialImage: '60a781ae01bef.jpg', official: '?category_id=1&id=48' }),
  rel('KICM-2128', 'single-11', 'アイオライト', 'single', '2023-04-19', { format: 'CD', king: 'L/29feeac1cce749f2ae686323d140b713.jpg', officialImage: '63ef51df46443.jpg', official: '?category_id=1&id=56' }),
  rel('KICM-2138', 'single-12', 'スクラップアート', 'single', '2023-09-13', { format: 'CD', king: 'L/d67e095c1c0e44b99825a1c62711a58c.jpg', officialImage: '64c79d484fb15.jpg', official: '?category_id=1&id=58' }),
  rel('KICM-2174', 'single-13', 'Summer Challenger', 'single', '2026-07-22', { format: 'CD', king: 'L/KICM-2174_e2521cebe7d9434bb79250a2cfeae95f.jpg', officialImage: '6a183c96e4216.jpg', official: '?id=78' }),

  // ───────────── ALBUM（公式：1st〜4th ALBUM / 1st・2nd HALF ALBUM / BEST ALBUM） ─────────────
  // Innocent flower 初回限定盤：v1.1.0 で追加（公式サイトで確認。キングレコードには掲載なし）
  rel('KICS-93477', 'album-innocent-flower', 'Innocent flower', 'album', '2017-04-05', { edition: '初回限定盤', format: 'CD+BD', officialImage: '60a4e9efc6447.jpg', official: '?category_id=2&id=4', kingPage: null }),
  rel('KICS-3477', 'album-innocent-flower', 'Innocent flower', 'album', '2017-04-05', { edition: '通常盤', format: 'CD', king: 'L/8de31cf474df4bd4b5ee6bc9ab3864c6.jpg', officialImage: '60a4e9efd1fde.jpg', official: '?category_id=2&id=4' }),
  rel('KICS-93710', 'album-blue-compass', 'BLUE COMPASS', 'album', '2018-05-23', { edition: '初回限定盤', format: 'CD+BD', king: 'L/ddaeb16347ca469d9e9467baa509636a.jpg', officialImage: '60a4ebeba2362.jpg', official: '?category_id=2&id=22' }),
  rel('KICS-3710', 'album-blue-compass', 'BLUE COMPASS', 'album', '2018-05-23', { edition: '通常盤', format: 'CD', king: '1/9570928b551e4bb4981a0f9461253837.jpg', officialImage: '60a4ebebb3798.jpg', official: '?category_id=2&id=22', kingPage: 'KICS-93710' }),
  // Catch the Rainbow！ 初回限定盤：v1.1.0 で追加（公式サイトで確認。キングレコードには掲載なし）
  rel('KICS-93785', 'album-catch-the-rainbow', 'Catch the Rainbow！', 'album', '2019-04-10', { edition: '初回限定盤', format: 'CD+BD', officialImage: '60a4ef4278963.jpg', official: '?category_id=2&id=37', kingPage: null }),
  rel('KICS-3785', 'album-catch-the-rainbow', 'Catch the Rainbow！', 'album', '2019-04-10', { edition: '通常盤', format: 'CD', king: 'L/697df710d1944c2e8fc85c4ef65f4175.jpg', officialImage: '60a4ef428a479.jpg', official: '?category_id=2&id=37' }),
  rel('KICS-94059', 'album-glow', 'glow', 'album', '2022-07-20', { edition: '初回限定盤', format: 'CD+BD', king: 'L/559481845c23436d877ff4f073f3e4ec.jpg', officialImage: '628766388df87.jpg', official: '?category_id=2&id=54' }),
  rel('KICS-4059', 'album-glow', 'glow', 'album', '2022-07-20', { edition: '通常盤', format: 'CD', king: '1/06f4b00ce43e41d5960e34088ba2f235.jpg', officialImage: '6287663896409.jpg', official: '?category_id=2&id=54', kingPage: 'KICS-94059' }),
  rel('KICS-94166', 'album-heart-bookmark', 'heart bookmark', 'album', '2024-08-21', { edition: '初回限定盤', format: 'CD+Blu-ray', king: 'L/d3b383aac48e4d0b90b47d16aa45ae3f.jpg', officialImage: '668672a511b83.jpg', official: '?category_id=2&id=61' }),
  rel('KICS-4166', 'album-heart-bookmark', 'heart bookmark', 'album', '2024-08-21', { edition: '通常盤', format: 'CD', king: '1/7172436d445942559ccaf73b53031442.jpg', officialImage: '668672a520777.jpg', official: '?category_id=2&id=61', kingPage: 'KICS-94166' }),
  rel('KICS-94217', 'album-travel-record', 'Travel Record', 'album', '2025-09-03', { edition: '初回限定盤', format: 'CD2枚組+Blu-ray', catalogNumber: 'KICS-94217～8', king: 'L/28717e32e32e49e49e26933b3fa25364.jpg', officialImage: '6864f5331e872.jpg', official: '?id=73' }),
  rel('KICS-4217', 'album-travel-record', 'Travel Record', 'album', '2025-09-03', { edition: '通常盤', format: 'CD2枚組', catalogNumber: 'KICS-4217～8', king: '1/fc0bbd19f5604f029b65fc50a5063511.jpg', officialImage: '6864f533a6c10.jpg', official: '?id=73', kingPage: 'KICS-94217' }),
  rel('KICS-94219', 'album-turquoise', 'Turquoise', 'album', '2025-09-03', { edition: '初回限定盤', format: 'CD+Blu-ray', king: 'L/c7c5702f709447d09d750c3af5ce5442.jpg', officialImage: '6864f58847ac5.jpg', official: '?category_id=2&id=72' }),
  rel('KICS-4219', 'album-turquoise', 'Turquoise', 'album', '2025-09-03', { edition: '通常盤', format: 'CD', king: '1/70ec2bf599eb4c419693ee94eaa60001.jpg', officialImage: '68849999e9418.jpg', official: '?category_id=2&id=72', kingPage: 'KICS-94219' }),

  // ───────────── LIVE Blu-ray（公式カテゴリー「Blu-ray」のうちライブ作品） ─────────────
  rel('KIXM-315', 'live-2017-1st', 'Inori Minase 1st LIVE Ready Steady Go!', 'bluray', '2018-04-04', { format: 'Blu-ray', king: 'L/14b62edf428448f28b6778816bb05f8a.jpg', officialImage: '60a4ecf44d72d.jpg', official: '?category_id=3&id=14' }),
  rel('KIXM-340', 'live-2018-blue-compass', 'Inori Minase LIVE TOUR BLUE COMPASS', 'bluray', '2018-10-17', { format: 'Blu-ray', king: 'L/e201a80323374412bb9f492408bb9749.jpg', officialImage: '60a4ed177a0d2.jpg', official: '?category_id=3&id=28' }),
  rel('KIXM-398', 'live-2019-catch-the-rainbow', 'Inori Minase LIVE TOUR Catch the Rainbow！', 'bluray', '2019-10-23', { format: 'Blu-ray', king: 'L/e9b3335c3981462e80115870fbc7bfd6.jpg', officialImage: '60a4edd44d12b.jpg', official: '?category_id=3&id=43' }),
  rel('KIXM-449', 'live-2020-5th-anniversary', 'Inori Minase 5th ANNIVERSARY LIVE Starry Wishes', 'bluray', '2021-03-24', { format: 'Blu-ray', king: 'L/3d867956370d404b8c0a92b884f9bd82.jpg', officialImage: '60a4eebb4f4d8.jpg', official: '?category_id=3&id=47' }),
  rel('KIXM-493', 'live-2021-hello-horizon', 'Inori Minase LIVE TOUR HELLO HORIZON', 'bluray', '2022-02-23', { format: 'Blu-ray', king: 'L/e151f83cc5924ee398c787eec90c5207.jpg', officialImage: '61a9e47410f3b.jpg', official: '?category_id=3&id=53' }),
  rel('KIXM-536', 'live-2022-glow', 'Inori Minase LIVE TOUR glow', 'bluray', '2023-04-19', { format: 'Blu-ray', king: 'L/daecc06138294dbe90c77e466280a1bf.jpg', officialImage: '63ef527c8460d.jpg', official: '?category_id=3&id=55' }),
  rel('KIXM-578', 'live-2023-scrap-art', 'Inori Minase LIVE TOUR SCRAP ART', 'bluray', '2024-03-06', { format: 'Blu-ray', catalogNumber: 'KIXM-578～9', king: 'L/b5832189903e427f96ef80bfbaf9ee18.jpg', officialImage: '65a619a3610aa.jpg', official: '?category_id=3&id=60' }),
  rel('KIXM-618', 'live-2024-heart-bookmark', 'Inori Minase LIVE TOUR heart bookmark', 'bluray', '2025-03-12', { format: 'Blu-ray', catalogNumber: 'KIXM-618～9', king: 'L/df469492001e4bedb7ae43d49843ad27.jpg', officialImage: '678a2a27e6b96.jpg', official: '?category_id=3&id=63' }),
  rel('KIXM-648', 'live-2025-10th-anniversary', 'Inori Minase 10th ANNIVERSARY LIVE TOUR Travel Record', 'bluray', '2026-03-11', { format: 'Blu-ray', catalogNumber: 'KIXM-648～9', king: 'L/4929fa0c0cec4c2aa32ce00310a14096.jpg', officialImage: '695de76d73bde.jpg', official: '?id=76' }),
];

export const CATEGORY_LABEL: Record<Category, string> = {
  single: 'シングル',
  album: 'アルバム',
  bluray: 'ライブBlu-ray',
};

export const CATEGORY_ORDER: Record<Category, number> = { single: 0, album: 1, bluray: 2 };

/** 一覧に表示する形態ラベル（例: "初回限定盤（CD+BD）"） */
export function editionLabel(r: Release): string {
  if (r.edition && r.format) return `${r.edition}（${r.format}）`;
  return r.edition ?? r.format ?? '形態情報なし';
}
