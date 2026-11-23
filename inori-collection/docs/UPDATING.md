# 新作追加時のデータ更新手順

新作（シングル・アルバム・ライブBlu-ray・MUSIC CLIP BOX）が発売されたら、作品データに追加して再デプロイします。
アプリ側の所持データ・バックアップは自動的に引き継がれ、新作の所持枚数は 0 から始まります。

追加するファイルは2つです。

| ファイル | 書くこと |
| --- | --- |
| `src/data/releases.ts` | 作品の情報（品番・タイトル・カテゴリー・発売日・形態・公式ページ） |
| `src/data/jackets.ts` | ジャケット画像の配信元URL（個人用版だけが使う。公開版のビルドには含まれない） |

## 絶対に守るルール

1. **既存レコードの `id` を変更しない・使い回さない**（所持データ・バックアップ・自分で設定した画像のキーです）
2. 新しいレコードの `id` は**代表品番**（例 `KICM-2190`、2枚組でも先頭の品番）にする
3. 形態（初回限定盤・通常盤など）は**1 形態 = 1 レコード**で追加する
4. **確認できない情報は推測で埋めない**（形態名・媒体構成・品番・画像が不明なら省略する）
5. 既存レコードを削除しない（どうしても外す場合でも、所持データは「作品データにない所持データ」として保持されます）
6. **バックアップ形式（`src/lib/backup.ts`）は変更しない**。作品の追加だけなら変更は不要です
7. 画像URLは `src/data/releases.ts` に書かない（`src/data/jackets.ts` に書く。公開版に画像URLが入らないようにするため）

## 手順

### 1. 公式情報を確認する

1. **水瀬いのり公式サイト**（最優先）<https://inoriminase.com/discography/>
   - 一覧の作品をクリックすると詳細ページ `https://inoriminase.com/discography/<番号>/` が開きます。この**番号**を控えます
   - 詳細ページで、タイトル・発売日・形態・品番・形態ごとのジャケットを確認します
   - 画像の URL は `https://inoriminase.com/wp/wp-content/uploads/<年>/<月>/<ファイル名>` の形です
   - 一覧は10件ずつ表示されます。古い作品は `https://inoriminase.com/discography/page/2/?category_id=<カテゴリー>` で確認できます（1=SINGLE、2=ALBUM、3=Blu-ray、4=LIVE ALBUM）
2. **キングレコード公式の商品ページ**（補助）<https://www.kingrecords.co.jp/cs/artist/artist.aspx?artist=44810>
   - 一覧の作品をクリックすると `https://www.kingrecords.co.jp/cs/g/g<品番>/` の商品ページが開きます
   - 画像の下に「初回限定盤」「通常盤」と表示されるので、形態との対応を取り違えないよう確認
   - 画像 URL は `https://www.kingrecords.co.jp/img/goods/<L または 1>/<ファイル名>.jpg`

画像 URL は、ページの画像を右クリック（スマホは長押し）→「画像アドレスをコピー」で取得できます。

> 公式サイトの「配信SINGLE」「LIVE ALBUM」は配信限定（CD・Blu-ray の商品がない）のため、このアプリの対象外です。

### 2. `src/data/releases.ts` に作品を追記する

カテゴリーごとのブロックの末尾に追加します。例：

```ts
// ───────────── SINGLE ─────────────
rel('KICM-2190', 'single-15', '新しいシングル', 'single', '2027-06-10', { format: 'CD', official: 2500 }),

// ───────────── ALBUM（形態が2つある場合）─────────────
rel('KICS-94300', 'album-new-title', '新しいアルバム', 'album', '2027-05-01', { edition: '初回限定盤', format: 'CD+Blu-ray', official: 2501 }),
rel('KICS-4300', 'album-new-title', '新しいアルバム', 'album', '2027-05-01', {
  edition: '通常盤',
  format: 'CD',
  official: 2501,
  kingPage: 'KICS-94300', // 通常盤の情報が初回限定盤のキングレコード商品ページに載っている場合
}),

// ───────────── LIVE Blu-ray（2枚組の例）─────────────
rel('KIXM-700', 'live-2026-tour', 'Inori Minase LIVE TOUR 2026 ……', 'bluray', '2027-03-10', { format: 'Blu-ray', catalogNumber: 'KIXM-700～1', official: 2502 }),

// ───────────── MUSIC CLIP BOX ─────────────
rel('KIXM-750', 'clips-03', 'Inori Minase MUSIC CLIP BOX 3', 'clips', '2028-01-01', { format: 'Blu-ray', official: 2503 }),
```

引数の意味：

| 引数 | 内容 |
| --- | --- |
| 1 `id` | 代表品番（変更禁止） |
| 2 `workKey` | 同じ作品の形態違いで共通にするキー（形態違いは同じ値にする） |
| 3 タイトル | 公式サイトの表記のまま（全角・半角も合わせる） |
| 4 カテゴリー | `single` / `album` / `bluray`（ライブBlu-ray） / `clips`（MUSIC CLIP BOX） |
| 5 発売日 | `YYYY-MM-DD` |
| `edition` | 形態名。単一形態で公式に形態名がなければ省略 |
| `format` | 公式に記載のある媒体構成（例 `CD+BD`）。記載がなければキングレコードの表記（`CD`・`Blu-ray`） |
| `catalogNumber` | 「～8」のように範囲表記がある場合のみ指定（省略時は id） |
| `official` | 公式サイトの詳細ページの**番号**（`/discography/<番号>/` の番号。必須） |
| `kingPage` | 情報を確認したキングレコード商品ページの品番（id と同じなら省略、掲載がなければ `null`） |

最後に `MASTER_VERSION` と `VERIFIED`（ファイル先頭）を更新日に変更します。

### 3. `src/data/jackets.ts` に画像URLを追記する

キーは releases.ts の `id`、値は `j(キングレコードの画像パス, 公式サイトの画像パス)` です。掲載がない側は `null` にします。

```ts
'KICM-2190': j('L/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.jpg', '2027/04/yyyyyyyyyyyyy.jpg'), // 新しいシングル
```

| 引数 | 内容 |
| --- | --- |
| 1つ目 | キングレコードの画像パス（`/img/goods/` より後ろ） |
| 2つ目 | 公式サイトの画像パス（`/wp/wp-content/uploads/` より後ろ。`<年>/<月>/<ファイル名>`） |

画像は ① キングレコード → ② 公式サイト の順に表示を試します。両方とも `null`（または行がない）形態は CDアイコン表示になります（公開版は常に、自分で設定した画像か CDアイコンです）。

### 4. 確認・テストして公開する

```powershell
npm run check:images   # 追加した画像URLが実際に表示できるか確認（インターネット接続が必要）
npm test               # データ整合性テスト（ID重複・日付・画像URL重複など）を含む
npm run build
```

`tests/data.test.ts` の件数テスト（39 形態など）は、追加した件数に合わせて数字を更新してください。E2E テスト（`e2e/run.mjs`・`e2e/public.mjs`・`e2e/pages.mjs`）の形態数 `TOTAL` なども同様です。

GitHub に push（またはファイルをアップロード）すると、GitHub Pages（`.github/workflows/deploy.yml`）または Vercel が自動で再公開します。スマートフォンでアプリを開くと「新しいバージョンがあります」と表示されるので「更新する」を押してください。新作のジャケット画像は、オンラインで開いたときに自動でオフライン用に保存されます（個人用版）。

## Claude に依頼する場合のテンプレート

```
Inori Collection の作品データに新作を追加してください。
- 対象：<作品名>（<発売日>発売）
- 水瀬いのり公式サイト https://inoriminase.com/discography/ の詳細ページを最優先に、
  キングレコード公式の商品ページも照合して、全形態のタイトル・発売日・形態名・媒体構成・品番・
  形態ごとのジャケット画像URL・公式詳細ページの番号を確認してください
- 作品は src/data/releases.ts、画像URLは src/data/jackets.ts に追加してください
- docs/UPDATING.md のルール（既存IDを変えない、id は代表品番、推測で埋めない、バックアップ形式を変えない）に従ってください
- tests/data.test.ts の件数を更新し、npm test と npm run build が通ることを確認してください
- 追加した形態の一覧と、確認できなかった項目を報告してください
```

## 公式サイトの URL が変わったとき

2026-11 の公式サイトリニューアルでは、詳細ページの URL（`?category_id=…&id=…` → `/discography/<番号>/`）と画像の場所（`/img/disco/images_pc/` → `/wp/wp-content/uploads/<年>/<月>/`）が変わりました（v1.2.0 で対応済み）。同じようなことがあったら：

1. `npm run check:images` で、表示できなくなった画像を確認する
2. 公式サイトの詳細ページで新しい画像URLを確認し、`src/data/jackets.ts` を更新する
3. 詳細ページの番号が変わっていたら `src/data/releases.ts` の `official` を更新する
