import {
  type Collection,
  type Settings,
  DEFAULT_SETTINGS,
  isValidCount,
  isValidId,
  sanitizeSettings,
} from './collection';

/**
 * ブラウザ内保存（localStorage）
 *
 * Service Worker のキャッシュとは完全に別の領域に保存するため、
 * アプリ更新（キャッシュ入れ替え）で所持データが消えることはない。
 */
export const KEYS = {
  collection: 'inori-collection/collection',
  settings: 'inori-collection/settings',
  corruptedPrefix: 'inori-collection/corrupted/',
} as const;

export const COLLECTION_SCHEMA_VERSION = 1;

export interface StoredCollection {
  schemaVersion: number;
  updatedAt: string;
  items: Record<string, { unopened: number; opened: number }>;
}

export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'unavailable' | 'unknown'; message: string };

export interface LoadResult {
  collection: Collection;
  /** ユーザーに知らせるべき問題（空なら正常） */
  issues: string[];
  /**
   * 破損データを退避できなかったため、上書き保存すると元データが失われる状態。
   * true の間はアプリ側で自動保存を止める。
   */
  blockSaves: boolean;
  /** blockSaves 時、ユーザーが手元に控えられるよう生データを渡す */
  rawCorrupt?: string;
}

/** items 部分の検証結果 */
export interface ParsedItems {
  collection: Collection;
  invalid: string[];
}

/**
 * items オブジェクトを検証して Collection に変換する。
 * 不正な項目は invalid に記録する（呼び出し側で「拒否」か「除外」かを決める）。
 */
export function parseItems(items: unknown, maxEntries = 10000): ParsedItems | null {
  if (!items || typeof items !== 'object' || Array.isArray(items)) return null;
  const entries = Object.entries(items as Record<string, unknown>);
  if (entries.length > maxEntries) return null;
  const collection: Collection = {};
  const invalid: string[] = [];
  for (const [id, v] of entries) {
    if (!isValidId(id) || !v || typeof v !== 'object' || Array.isArray(v)) {
      invalid.push(id);
      continue;
    }
    const { unopened, opened } = v as Record<string, unknown>;
    if (!isValidCount(unopened) || !isValidCount(opened)) {
      invalid.push(id);
      continue;
    }
    if (unopened + opened > 0) collection[id] = { unopened, opened };
  }
  return { collection, invalid };
}

export function serializeCollection(c: Collection, now = new Date()): string {
  const ids = Object.keys(c).sort();
  const items: StoredCollection['items'] = {};
  for (const id of ids) items[id] = { unopened: c[id].unopened, opened: c[id].opened };
  const payload: StoredCollection = {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    items,
  };
  return JSON.stringify(payload);
}

function getStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    // Safari のプライベートモード等で setItem だけ失敗するケースを検出
    const probe = 'inori-collection/__probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
}

function safeSet(key: string, value: string): SaveResult {
  const s = getStorage();
  if (!s) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'このブラウザでは端末内に保存できません（プライベートブラウズ中の可能性があります）。',
    };
  }
  try {
    s.setItem(key, value);
    return { ok: true };
  } catch (e) {
    if (isQuotaError(e)) {
      return { ok: false, reason: 'quota', message: '端末の保存容量が不足しているため保存できませんでした。' };
    }
    return { ok: false, reason: 'unknown', message: '保存中に予期しないエラーが発生しました。' };
  }
}

/** 破損データを別キーに退避する。成功したら true */
function preserveCorrupt(raw: string): boolean {
  const s = getStorage();
  if (!s) return false;
  try {
    // 同じ内容が既に退避済みなら重複させない
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(KEYS.corruptedPrefix) && s.getItem(k) === raw) return true;
    }
    s.setItem(KEYS.corruptedPrefix + new Date().toISOString(), raw);
    return true;
  } catch {
    return false;
  }
}

export function loadCollection(): LoadResult {
  const s = getStorage();
  if (!s) {
    // 読み取りだけはできる場合がある
    let raw: string | null = null;
    try {
      raw = globalThis.localStorage?.getItem(KEYS.collection) ?? null;
    } catch {
      raw = null;
    }
    if (raw) {
      const parsed = tryParseStored(raw);
      if (parsed) {
        return {
          collection: parsed.collection,
          issues: ['端末内に保存できない状態です。変更は保存されません。'],
          blockSaves: false,
        };
      }
    }
    return {
      collection: {},
      issues: ['このブラウザでは端末内に保存できません（プライベートブラウズ中の可能性があります）。変更は保存されません。'],
      blockSaves: false,
    };
  }

  const raw = s.getItem(KEYS.collection);
  if (raw === null) return { collection: {}, issues: [], blockSaves: false };

  const parsed = tryParseStored(raw);
  if (parsed && parsed.invalid.length === 0) {
    return { collection: parsed.collection, issues: [], blockSaves: false };
  }

  // 破損 or 一部不正：元データを退避してから読み込める部分だけ使う
  const preserved = preserveCorrupt(raw);
  if (!preserved) {
    return {
      collection: parsed?.collection ?? {},
      issues: ['保存データの一部が破損していました。元データを退避できなかったため、自動保存を停止しています。'],
      blockSaves: true,
      rawCorrupt: raw,
    };
  }
  if (parsed) {
    return {
      collection: parsed.collection,
      issues: [
        `保存データのうち ${parsed.invalid.length} 件が不正な値だったため読み込みませんでした（元データは端末内に退避済みです）。`,
      ],
      blockSaves: false,
    };
  }
  return {
    collection: {},
    issues: ['保存データが破損していたため読み込めませんでした（元データは端末内に退避済みです）。バックアップがあれば復元してください。'],
    blockSaves: false,
  };
}

function tryParseStored(raw: string): ParsedItems | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Partial<StoredCollection>;
  if (o.schemaVersion !== COLLECTION_SCHEMA_VERSION) return null;
  return parseItems(o.items);
}

export function saveCollection(c: Collection): SaveResult {
  return safeSet(KEYS.collection, serializeCollection(c));
}

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(KEYS.settings);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): SaveResult {
  return safeSet(KEYS.settings, JSON.stringify(s));
}

/** 退避済みの破損データの件数 */
export function countCorrupted(): number {
  try {
    const s = globalThis.localStorage;
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s.key(i)?.startsWith(KEYS.corruptedPrefix)) n++;
    return n;
  } catch {
    return 0;
  }
}

/** 端末の保存領域を「消されにくい」状態にするよう要求（対応ブラウザのみ） */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
