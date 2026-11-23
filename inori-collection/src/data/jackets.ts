/**
 * ジャケット画像の配信元URL（個人用版）
 *
 * 画像ファイルはアプリに同梱せず、公式の配信元のURLを参照する。
 * 閲覧した端末の中にだけキャッシュとして保存して表示する（src/lib/offline.ts）。
 *
 * ■ 公開版（INORI_EDITION=public でビルド）では、このファイルの代わりに jackets.public.ts（空）が使われる。
 *   公開版のビルドには画像URLが1つも含まれず、配信元から画像を取得しない（vite.config.ts）。
 *
 * ■ 候補の順番：①キングレコード公式 → ②水瀬いのり公式サイト
 *   1つ目が取得できなくなっても、2つ目で表示を続ける。
 *
 * ■ 2026-11-23 確認：水瀬いのり公式サイトのリニューアル後のディスコグラフィー（https://inoriminase.com/discography/）
 *   で、全形態の画像を詳細ページで確認した。画像の場所は /wp/wp-content/uploads/<年>/<月>/<ファイル名> に変わった
 *   （ファイル名はリニューアル前と同じ）。
 *
 * ■ 新作を追加するとき（docs/UPDATING.md）：
 *   キー = src/data/releases.ts の id。値 = j(キングレコードの画像パス, 公式サイトの画像パス)。
 *   掲載がない側は null にする。
 */
const KING = 'https://www.kingrecords.co.jp/img/goods/';
const OFFICIAL = 'https://inoriminase.com/wp/wp-content/uploads/';

/** @param king キングレコードの画像パス（/img/goods/ 以降） @param official 公式サイトの画像パス（/wp/wp-content/uploads/ 以降） */
function j(king: string | null, official: string | null): readonly string[] {
  const urls: string[] = [];
  if (king) urls.push(KING + king);
  if (official) urls.push(OFFICIAL + official);
  return Object.freeze(urls);
}

/** 画像を配信元から取得する版か（公開版の jackets.public.ts では false） */
export const JACKETS_FROM_SOURCES = true;

/** 形態ID → ジャケット画像URLの候補 */
export const JACKETS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // ───────────── SINGLE ─────────────
  'KICM-1641': j('L/c966882027bc4237a58b546ab62efde9.jpg', '2021/05/60a4e3bf248cf.jpg'), // 夢のつぼみ
  'KICM-1662': j('L/b50d6389cc2a466aa123fc747a3e1027.jpg', '2021/05/60a4e55e62520.jpg'), // harmony ribbon
  'KICM-1726': j('L/7cc4742d2ab74139b15cbf1fd022c3cc.jpg', '2021/05/60a4e57784cd7.jpg'), // Starry Wish
  'KICM-1783': j('L/343f39748ab54b1eb1b1d5012da539b7.jpg', '2021/05/60a4ecba5a14f.jpg'), // アイマイモコ
  'KICM-1817': j('L/c82fcb20c4104013a9fe3e2e4263992a.jpg', '2021/05/60a4ecd5e4ff8.jpg'), // Ready Steady Go!
  'KICM-1890': j('L/1f9c1fd12b9044d4ba92e15d9dc3770a.jpg', '2021/05/60a4ed3a913da.jpg'), // TRUST IN ETERNITY
  'KICM-1914': j('L/8ad4bd4054664b73b7f0d0cdc75550c5.jpg', '2021/05/60a4ed50110f0.jpg'), // Wonder Caravan！
  'KICM-2029': j('L/8468ae64ce544dfba268d262fbf889a8.jpg', '2021/05/60a4ede544191.jpg'), // ココロソマリ
  'KICM-2065': j('L/af7b920d730e489689b1b3982aa16894.jpg', '2021/05/60a4ee03c1ce6.jpg'), // Starlight Museum
  'KICM-2092': j('L/655665fe55b84989974afd1e8cff561b.jpg', '2021/05/60a781ae01bef.jpg'), // HELLO HORIZON
  'KICM-2128': j('L/29feeac1cce749f2ae686323d140b713.jpg', '2023/02/63ef51df46443.jpg'), // アイオライト
  'KICM-2138': j('L/d67e095c1c0e44b99825a1c62711a58c.jpg', '2023/07/64c79d484fb15.jpg'), // スクラップアート
  'KICM-2174': j('L/KICM-2174_e2521cebe7d9434bb79250a2cfeae95f.jpg', '2026/05/6a183c96e4216.jpg'), // Summer Challenger
  'KICM-2183': j('L/KICM-2183_36e26d80d2cb426c909c88f133c24518.jpg', '2026/11/inori_MRJK_fix_re-scaled.jpg'), // 未解決で、ロマンスで。

  // ───────────── ALBUM ─────────────
  'KICS-93477': j(null, '2021/05/60a4e9efc6447.jpg'), // Innocent flower 初回限定盤（キングレコードに掲載なし）
  'KICS-3477': j('L/8de31cf474df4bd4b5ee6bc9ab3864c6.jpg', '2021/05/60a4e9efd1fde.jpg'), // Innocent flower 通常盤
  'KICS-93710': j('L/ddaeb16347ca469d9e9467baa509636a.jpg', '2021/05/60a4ebeba2362.jpg'), // BLUE COMPASS 初回限定盤
  'KICS-3710': j('1/9570928b551e4bb4981a0f9461253837.jpg', '2021/05/60a4ebebb3798.jpg'), // BLUE COMPASS 通常盤
  'KICS-93785': j(null, '2021/05/60a4ef4278963.jpg'), // Catch the Rainbow！ 初回限定盤（キングレコードに掲載なし）
  'KICS-3785': j('L/697df710d1944c2e8fc85c4ef65f4175.jpg', '2021/05/60a4ef428a479.jpg'), // Catch the Rainbow！ 通常盤
  'KICS-94059': j('L/559481845c23436d877ff4f073f3e4ec.jpg', '2022/05/628766388df87.jpg'), // glow 初回限定盤
  'KICS-4059': j('1/06f4b00ce43e41d5960e34088ba2f235.jpg', '2022/05/6287663896409.jpg'), // glow 通常盤
  'KICS-94166': j('L/d3b383aac48e4d0b90b47d16aa45ae3f.jpg', '2024/07/668672a511b83.jpg'), // heart bookmark 初回限定盤
  'KICS-4166': j('1/7172436d445942559ccaf73b53031442.jpg', '2024/07/668672a520777.jpg'), // heart bookmark 通常盤
  'KICS-94217': j('L/28717e32e32e49e49e26933b3fa25364.jpg', '2025/07/6864f5331e872.jpg'), // Travel Record 初回限定盤
  'KICS-4217': j('1/fc0bbd19f5604f029b65fc50a5063511.jpg', '2025/07/6864f533a6c10.jpg'), // Travel Record 通常盤
  'KICS-94219': j('L/c7c5702f709447d09d750c3af5ce5442.jpg', '2025/07/6864f58847ac5.jpg'), // Turquoise 初回限定盤
  'KICS-4219': j('1/70ec2bf599eb4c419693ee94eaa60001.jpg', '2025/07/68849999e9418.jpg'), // Turquoise 通常盤

  // ───────────── LIVE Blu-ray ─────────────
  'KIXM-315': j('L/14b62edf428448f28b6778816bb05f8a.jpg', '2021/05/60a4ecf44d72d.jpg'), // 1st LIVE Ready Steady Go!
  'KIXM-340': j('L/e201a80323374412bb9f492408bb9749.jpg', '2021/05/60a4ed177a0d2.jpg'), // LIVE TOUR BLUE COMPASS
  'KIXM-398': j('L/e9b3335c3981462e80115870fbc7bfd6.jpg', '2021/05/60a4edd44d12b.jpg'), // LIVE TOUR Catch the Rainbow！
  'KIXM-449': j('L/3d867956370d404b8c0a92b884f9bd82.jpg', '2021/05/60a4eebb4f4d8.jpg'), // 5th ANNIVERSARY LIVE Starry Wishes
  'KIXM-493': j('L/e151f83cc5924ee398c787eec90c5207.jpg', '2021/12/61a9e47410f3b.jpg'), // LIVE TOUR HELLO HORIZON
  'KIXM-536': j('L/daecc06138294dbe90c77e466280a1bf.jpg', '2023/02/63ef527c8460d.jpg'), // LIVE TOUR glow
  'KIXM-578': j('L/b5832189903e427f96ef80bfbaf9ee18.jpg', '2024/01/65a619a3610aa.jpg'), // LIVE TOUR SCRAP ART
  'KIXM-618': j('L/df469492001e4bedb7ae43d49843ad27.jpg', '2025/01/678a2a27e6b96.jpg'), // LIVE TOUR heart bookmark
  'KIXM-648': j('L/4929fa0c0cec4c2aa32ce00310a14096.jpg', '2026/01/695de76d73bde.jpg'), // 10th ANNIVERSARY LIVE TOUR Travel Record

  // ───────────── MUSIC CLIP BOX ─────────────
  'KIXM-379': j('L/6b0e52fc16c84fc88071299edeaef35a.jpg', '2021/05/60a4eda6e2aae.jpg'), // MUSIC CLIP BOX
  'KIXM-627': j('L/3c79a49843bd4040a80fce547a76e08e.jpg', '2025/04/67efdb89f1c9e.jpg'), // MUSIC CLIP BOX 2
});
