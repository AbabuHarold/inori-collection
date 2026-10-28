/** 作品カテゴリー */
export type Category = 'single' | 'album' | 'bluray';

/**
 * 作品マスターの1レコード = 1形態（初回限定盤・通常盤などは別レコード）。
 *
 * `id` は所持データ・バックアップのキーになるため、一度公開したら絶対に変更しないこと。
 * 原則として代表品番（例: "KICS-93710"）をそのまま使う。
 */
export interface Release {
  /** 安定した固有ID（変更禁止）。代表品番。 */
  id: string;
  /** 同じ作品の形態違いをまとめるためのキー */
  workKey: string;
  /** 作品タイトル（公式サイトの表記） */
  title: string;
  category: Category;
  /** 発売日 YYYY-MM-DD */
  releaseDate: string;
  /** 形態名（初回限定盤・通常盤など）。公式情報に形態名がない単一形態の作品は null */
  edition: string | null;
  /** 公式に記載のある媒体構成（例: "CD+Blu-ray"）。記載がなければ null */
  format: string | null;
  /** 公式表記の品番（例: "KICS-94217～8"） */
  catalogNumber: string | null;
  /**
   * ジャケット画像URLの候補（先頭から順に試し、表示できたものを使う）。
   * 画像ファイルはアプリに同梱せず、公式の配信元を参照する。空なら常にプレースホルダー表示。
   */
  jacketUrls: string[];
  /** 水瀬いのり公式サイトの作品詳細ページURL。確認できない場合は null */
  officialUrl: string | null;
  /** 補助的に確認した公式商品ページ（キングレコード）。掲載がない形態は null */
  sourceUrl: string | null;
  /** 情報を確認した日 YYYY-MM-DD */
  verifiedAt: string;
}
