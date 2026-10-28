# 新作追加時のデータ更新手順

新作（シングル・アルバム・ライブBlu-ray）が発売されたら、作品マスター `src/data/releases.ts` に追加して再デプロイします。
アプリ側の所持データ・バックアップは自動的に引き継がれ、新作の所持枚数は 0 から始まります。

## 絶対に守るルール

1. **既存レコードの `id` を変更しない・使い回さない**（所持データとバックアップのキーです）
2. 新しいレコードの `id` は**代表品番**（例 `KICM-2190`、2枚組でも先頭の品番）にする
3. 形態（初回限定盤・通常盤など）は**1 形態 = 1 レコード**で追加する
4. **確認できない情報は推測で埋めない**（形態名・媒体構成・品番・画像が不明なら省略する）
5. 既存レコードを削除しない（どうしても外す場合でも、所持データは「作品データにない所持データ」として保持されます）
6. **バックアップ形式（`src/lib/backup.ts`）は変更しない**。作品の追加だけなら変更は不要です

## 手順

### 1. 公式情報を確認する

1. **水瀬いのり公式サイト**（最優先）<https://www.inoriminase.com/discography/>
   - 作品の詳細ページ（`?category_id=…&id=…`）で、タイトル・発売日・形態・品番・形態ごとのジャケットを確認
   - 画像は詳細ページの「【初回限定盤】」「【通常盤】」の下にある画像。URL は `https://www.inoriminase.com/img/disco/images_pc/<ファイル名>`
2. **キングレコード公式の商品ページ**（補助）<https://www.kingrecords.co.jp/cs/artist/artist.aspx?artist=44810>
   - 一覧の作品をクリックすると `https://www.kingrecords.co.jp/cs/g/g<品番>/` の商品ページが開きます
   - 画像の下に「初回限定盤」「通常盤」と表示されるので、形態との対応を取り違えないよう確認
   - 画像 URL は `https://www.kingrecords.co.jp/img/goods/<L または 1>/<ファイル名>.jpg`

画像 URL は、ページの画像を右クリック（スマホは長押し）→「画像アドレスをコピー」で取得できます。

### 2. `src/data/releases.ts` に追記する

カテゴリーごとのブロックの末尾に追加します。例：

```ts
// ───────────── SINGLE ─────────────
rel('KICM-2190', 'single-14', '新しいシングル', 'single', '2027-02-10', {
  format: 'CD',
  king: 'L/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.jpg',   // キングレコードの画像（/img/goods/ 以降）
  officialImage: '6b0000000000a.jpg',                // 公式サイトの画像（/img/disco/images_pc/ 以降）
  official: '?category_id=1&id=80',                  // 公式サイトの詳細ページ
}),

// ───────────── ALBUM（形態が2つある場合）─────────────
rel('KICS-94300', 'album-new-title', '新しいアルバム', 'album', '2027-05-01', {
  edition: '初回限定盤',
  format: 'CD+Blu-ray',
  king: 'L/xxxxxxxx.jpg',
  officialImage: '6b0000000001a.jpg',
  official: '?category_id=2&id=81',
}),
rel('KICS-4300', 'album-new-title', '新しいアルバム', 'album', '2027-05-01', {
  edition: '通常盤',
  format: 'CD',
  king: '1/yyyyyyyy.jpg',
  officialImage: '6b0000000001b.jpg',
  official: '?category_id=2&id=81',
  kingPage: 'KICS-94300', // 通常盤の情報が初回限定盤のキングレコード商品ページに載っている場合
}),

// ───────────── LIVE Blu-ray（2枚組の例）─────────────
rel('KIXM-700', 'live-2026-tour', 'Inori Minase LIVE TOUR 2026 ……', 'bluray', '2027-03-10', {
  format: 'Blu-ray',
  catalogNumber: 'KIXM-700～1',
  king: 'L/zzzzzzzz.jpg',
  officialImage: '6b0000000002a.jpg',
  official: '?category_id=3&id=82',
}),
```

引数の意味：

| 引数 | 内容 |
| --- | --- |
| 1 `id` | 代表品番（変更禁止） |
| 2 `workKey` | 同じ作品の形態違いで共通にするキー（形態違いは同じ値にする） |
| 3 タイトル | 公式サイトの表記のまま（全角・半角も合わせる） |
| 4 カテゴリー | `single` / `album` / `bluray` |
| 5 発売日 | `YYYY-MM-DD` |
| `edition` | 形態名。単一形態で公式に形態名がなければ省略 |
| `format` | 公式に記載のある媒体構成（例 `CD+BD`）。記載がなければ省略 |
| `catalogNumber` | 「～8」のように範囲表記がある場合のみ指定（省略時は id） |
| `king` | キングレコードの画像パス。掲載がなければ省略 |
| `officialImage` | 公式サイトの画像ファイル名。不明なら省略 |
| `official` | 公式サイトの詳細ページのクエリ（必須） |
| `kingPage` | 情報を確認したキングレコード商品ページの品番（id と同じなら省略、掲載がなければ `null`） |

画像は `king` → `officialImage` の順に表示を試します。両方とも省略した形態は CDアイコン表示になります。

最後に `MASTER_VERSION`（ファイル先頭）を更新日に変更します。

### 3. 確認・テストして公開する

```powershell
npm run check:images   # 追加した画像URLが実際に表示できるか確認（インターネット接続が必要）
npm test               # データ整合性テスト（ID重複・日付・画像URL重複など）を含む
npm run build
```

`tests/data.test.ts` の件数テスト（36 形態など）は、追加した件数に合わせて数字を更新してください。

GitHub に push（またはファイルをアップロード）すると、GitHub Pages（`.github/workflows/deploy.yml`）または Vercel が自動で再公開します。スマートフォンでアプリを開くと「新しいバージョンがあります」と表示されるので「更新する」を押してください。新作のジャケット画像は、オンラインで開いたときに自動でオフライン用に保存されます。

## Claude に依頼する場合のテンプレート

```
Inori Collection の作品マスター（src/data/releases.ts）に新作を追加してください。
- 対象：<作品名>（<発売日>発売）
- 水瀬いのり公式サイト https://www.inoriminase.com/discography/ の詳細ページを最優先に、
  キングレコード公式の商品ページも照合して、全形態のタイトル・発売日・形態名・媒体構成・品番・
  形態ごとのジャケット画像URL・公式詳細ページURLを確認してください
- docs/UPDATING.md のルール（既存IDを変えない、id は代表品番、推測で埋めない、バックアップ形式を変えない）に従ってください
- tests/data.test.ts の件数を更新し、npm test と npm run build が通ることを確認してください
- 追加した形態の一覧と、確認できなかった項目を報告してください
```

## 公式サイト復旧後の確認（推奨）

2026-10-28 時点では、公式サイトのディスコグラフィーが改修中（404）でした。そのため、作品データは公式サイトの保存版（Internet Archive）で確認しています。公式サイトが復旧したら、次のことを確認してください。

1. `npm run check:images` を実行し、次の2点を確認する。
   - 公式サイトの画像が表示可能になっているか。
   - 特に KICS-93477・KICS-93785 の初回限定盤2形態の画像が表示できるか。
2. 画像のURLが変わっていた場合は、`officialImage` を新しいファイル名に更新する。
3. 公式の詳細ページURL（`official`）が変わっていないか確認する。
