import type { Category, Release } from '../data/types';
import { CATEGORY_ORDER } from '../data/releases';

/** 1形態あたりの所持枚数 */
export interface Holding {
  unopened: number;
  opened: number;
}

/** 所持データ：形態ID → 所持枚数。マスターにないIDも保持する。 */
export type Collection = Record<string, Holding>;

/** 1つのカウンターの上限（誤操作・不正データ対策） */
export const MAX_COUNT = 999;

export const EMPTY_HOLDING: Holding = Object.freeze({ unopened: 0, opened: 0 }) as Holding;

/** IDとして受け付ける文字列（品番形式を想定、将来の追加にも余裕を持たせる） */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function isValidCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_COUNT;
}

export function getHolding(c: Collection, id: string): Holding {
  return Object.prototype.hasOwnProperty.call(c, id) ? c[id] : EMPTY_HOLDING;
}

export function totalOf(h: Holding): number {
  return h.unopened + h.opened;
}

export type CountField = keyof Holding;

/**
 * 枚数を delta だけ変更した新しい Collection を返す（元のオブジェクトは変更しない）。
 * 0未満・上限超過になる場合は null（変更なし）を返す。
 * 0枚・0枚になった形態はキーごと削除し、データを小さく保つ。
 */
export function applyDelta(c: Collection, id: string, field: CountField, delta: number): Collection | null {
  const cur = getHolding(c, id);
  const next = cur[field] + delta;
  if (!isValidCount(next)) return null;
  return setHolding(c, id, { ...cur, [field]: next });
}

export function setHolding(c: Collection, id: string, h: Holding): Collection {
  const out: Collection = { ...c };
  if (h.unopened === 0 && h.opened === 0) delete out[id];
  else out[id] = { unopened: h.unopened, opened: h.opened };
  return out;
}

// ───────────── 集計 ─────────────

export interface Stats {
  ownedForms: number;
  totalForms: number;
  totalDiscs: number;
  unopened: number;
  opened: number;
  /** 0〜100 */
  completion: number;
}

/** マスターに存在する形態だけを集計対象にする */
export function computeStats(releases: readonly Release[], c: Collection): Stats {
  let ownedForms = 0;
  let unopened = 0;
  let opened = 0;
  for (const r of releases) {
    const h = getHolding(c, r.id);
    unopened += h.unopened;
    opened += h.opened;
    if (totalOf(h) > 0) ownedForms++;
  }
  const totalForms = releases.length;
  const completion = totalForms === 0 ? 0 : (ownedForms / totalForms) * 100;
  return { ownedForms, totalForms, totalDiscs: unopened + opened, unopened, opened, completion };
}

/** コンプリート率の表示（小数1桁、100%未満は切り捨てて「全部揃っていないのに100%」を防ぐ） */
export function formatCompletion(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '0%';
  if (p >= 100) return '100%';
  const floored = Math.floor(p * 10) / 10;
  return `${floored.toFixed(1).replace(/\.0$/, '')}%`;
}

/** マスターにないID（作品データ更新で消えた/新しい版で作られたバックアップ由来など） */
export function orphanIds(releases: readonly Release[], c: Collection): string[] {
  const known = new Set(releases.map((r) => r.id));
  return Object.keys(c).filter((id) => !known.has(id) && totalOf(c[id]) > 0);
}

// ───────────── 絞り込み・並び替え ─────────────

export type ViewMode = 'grid' | 'list';
export type CategoryFilter = 'all' | Category;
export type OwnedFilter = 'all' | 'owned' | 'missing';
export type OpenFilter = 'all' | 'hasUnopened' | 'hasOpened';
export type SortKey = 'dateAsc' | 'dateDesc' | 'title' | 'category';

export interface Settings {
  view: ViewMode;
  category: CategoryFilter;
  owned: OwnedFilter;
  open: OpenFilter;
  query: string;
  sort: SortKey;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  view: 'grid',
  category: 'all',
  owned: 'all',
  open: 'all',
  query: '',
  sort: 'dateAsc',
}) as Settings;

export const SETTING_VALUES = {
  view: ['grid', 'list'],
  category: ['all', 'single', 'album', 'bluray'],
  owned: ['all', 'owned', 'missing'],
  open: ['all', 'hasUnopened', 'hasOpened'],
  sort: ['dateAsc', 'dateDesc', 'title', 'category'],
} as const;

export const MAX_QUERY_LENGTH = 100;

/** 不正な値は既定値に置き換えた Settings を返す（設定は破損しても致命的ではないため寛容に扱う） */
export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Record<string, unknown>;
  for (const key of ['view', 'category', 'owned', 'open', 'sort'] as const) {
    const v = o[key];
    if (typeof v === 'string' && (SETTING_VALUES[key] as readonly string[]).includes(v)) {
      (s as unknown as Record<string, string>)[key] = v;
    }
  }
  if (typeof o.query === 'string') s.query = o.query.slice(0, MAX_QUERY_LENGTH);
  return s;
}

/** 検索用の正規化：全角/半角・大文字小文字・ひらがな/カタカナの違いを吸収 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, ' ')
    .trim();
}

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

function editionRank(r: Release): number {
  if (r.edition?.includes('初回')) return 0;
  if (r.edition?.includes('通常')) return 2;
  return 1;
}

function tieBreak(a: Release, b: Release): number {
  return (
    CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
    a.workKey.localeCompare(b.workKey) ||
    editionRank(a) - editionRank(b) ||
    a.id.localeCompare(b.id)
  );
}

export function filterAndSort(releases: readonly Release[], c: Collection, s: Settings): Release[] {
  const terms = normalizeForSearch(s.query).split(' ').filter(Boolean);
  const list = releases.filter((r) => {
    if (s.category !== 'all' && r.category !== s.category) return false;
    const h = getHolding(c, r.id);
    if (s.owned === 'owned' && totalOf(h) === 0) return false;
    if (s.owned === 'missing' && totalOf(h) > 0) return false;
    if (s.open === 'hasUnopened' && h.unopened < 1) return false;
    if (s.open === 'hasOpened' && h.opened < 1) return false;
    if (terms.length > 0) {
      const hay = normalizeForSearch(r.title);
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const byDate = (a: Release, b: Release) => a.releaseDate.localeCompare(b.releaseDate);
  list.sort((a, b) => {
    switch (s.sort) {
      case 'dateDesc':
        return byDate(b, a) || tieBreak(a, b);
      case 'title':
        return collator.compare(a.title, b.title) || byDate(a, b) || tieBreak(a, b);
      case 'category':
        return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || byDate(a, b) || tieBreak(a, b);
      case 'dateAsc':
      default:
        return byDate(a, b) || tieBreak(a, b);
    }
  });
  return list;
}

export function isDefaultFilter(s: Settings): boolean {
  return s.category === 'all' && s.owned === 'all' && s.open === 'all' && s.query.trim() === '';
}
