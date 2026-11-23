import { isValidId } from './collection';

/**
 * 自分で設定したジャケット画像（端末内保存）
 *
 * 公開版では配信元から画像を取得しないため、使う人が自分で撮影・用意した画像を形態ごとに設定できる。
 * 個人用版でも、公式の画像より優先して表示する画像として使える。
 *
 * ■ 保存先：IndexedDB（データベース `inori-collection`、ストア `user-jackets`）
 *   - 所持データ（localStorage）・Service Worker のキャッシュとは別の領域。アプリ更新で消えない
 *   - 画像は Blob ではなく ArrayBuffer で保存する（古い iOS Safari の IndexedDB は Blob の保存が不安定なため）
 *   - この端末の中にだけ保存し、どこにも送信しない。機種変更は ZIP バックアップに含めて引き継ぐ（src/lib/backup.ts）
 */
export const USER_JACKET_DB = 'inori-collection';
export const USER_JACKET_STORE = 'user-jackets';
const DB_VERSION = 1;
/** 別のタブで画像が変わったことを知らせるチャンネル */
const CHANNEL = 'inori-collection/user-jackets';

export const USER_JACKET_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type UserJacketType = (typeof USER_JACKET_TYPES)[number];
export const USER_JACKET_EXT: Record<UserJacketType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** 安全上の上限（バックアップの検証でも使う） */
export const USER_JACKET_LIMITS = {
  /** 1枚あたりの最大サイズ（アプリが保存する画像は長辺800pxのJPEGで、通常 50〜300KB） */
  bytes: 2 * 1024 * 1024,
  /** 保存できる最大枚数 */
  count: 1000,
} as const;

export interface UserJacket {
  /** 形態ID（所持データと同じキー） */
  id: string;
  type: UserJacketType;
  data: ArrayBuffer;
  /** 設定した日時（ISO 8601） */
  updatedAt: string;
}

/** 先頭のバイト列から画像の種類を判定する（拡張子や申告された種類は信用しない） */
export function detectImageType(b: Uint8Array): UserJacketType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  return null;
}

/** 保存データ・バックアップ由来のレコードを検証する */
export function isValidUserJacket(x: unknown): x is UserJacket {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (!isValidId(o.id)) return false;
  if (typeof o.type !== 'string' || !(USER_JACKET_TYPES as readonly string[]).includes(o.type)) return false;
  // instanceof は別の実行環境（iframe・テスト環境など）で作られた ArrayBuffer を見分けられないため、型名で判定する
  if (Object.prototype.toString.call(o.data) !== '[object ArrayBuffer]') return false;
  const data = o.data as ArrayBuffer;
  if (data.byteLength === 0 || data.byteLength > USER_JACKET_LIMITS.bytes) return false;
  if (detectImageType(new Uint8Array(data, 0, Math.min(16, data.byteLength))) !== o.type) return false;
  return typeof o.updatedAt === 'string';
}

export function userJacketsSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null && typeof indexedDB.open === 'function';
  } catch {
    return false;
  }
}

export class UserJacketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserJacketError';
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!userJacketsSupported()) return Promise.reject(new UserJacketError('このブラウザでは画像を端末内に保存できません。'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(USER_JACKET_DB, DB_VERSION);
    } catch {
      reject(new UserJacketError('画像の保存領域を開けませんでした（プライベートブラウズ中の可能性があります）。'));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(USER_JACKET_STORE)) db.createObjectStore(USER_JACKET_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // 別のタブが新しいバージョンで開こうとしたら閉じて譲る（次回の操作で開き直す）
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(new UserJacketError('画像の保存領域を開けませんでした（プライベートブラウズ中の可能性があります）。'));
    req.onblocked = () => reject(new UserJacketError('画像の保存領域が別のタブで使用中です。他のタブを閉じてからもう一度お試しください。'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function isQuota(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
}

/** 書き込みトランザクションを実行し、完了（コミット）まで待つ */
async function write(fn: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(USER_JACKET_STORE, 'readwrite');
      fn(tx.objectStore(USER_JACKET_STORE));
    } catch (e) {
      reject(isQuota(e) ? new UserJacketError('端末の保存容量が不足しているため画像を保存できませんでした。') : new UserJacketError('画像を保存できませんでした。'));
      return;
    }
    tx.oncomplete = () => resolve();
    const fail = () =>
      reject(
        isQuota(tx.error)
          ? new UserJacketError('端末の保存容量が不足しているため画像を保存できませんでした。')
          : new UserJacketError('画像を保存できませんでした。'),
      );
    tx.onerror = fail;
    tx.onabort = fail;
  });
  notifyOtherTabs();
}

/** 保存済みの画像をすべて読み込む（壊れたレコードは読み飛ばす。削除はしない） */
export async function listUserJackets(): Promise<UserJacket[]> {
  const db = await openDb();
  const all = await new Promise<unknown[]>((resolve, reject) => {
    try {
      const req = db.transaction(USER_JACKET_STORE, 'readonly').objectStore(USER_JACKET_STORE).getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(new UserJacketError('保存した画像を読み込めませんでした。'));
    } catch {
      reject(new UserJacketError('保存した画像を読み込めませんでした。'));
    }
  });
  return all.filter(isValidUserJacket);
}

export async function putUserJacket(j: UserJacket): Promise<void> {
  if (!isValidUserJacket(j)) throw new UserJacketError('画像データが不正です。');
  await write((s) => s.put(j));
}

export async function deleteUserJacket(id: string): Promise<void> {
  await write((s) => s.delete(id));
}

/** すべての画像を list の内容で置き換える（1つのトランザクションで行うため、失敗したら何も変わらない） */
export async function replaceAllUserJackets(list: readonly UserJacket[]): Promise<void> {
  if (list.length > USER_JACKET_LIMITS.count) throw new UserJacketError('画像の枚数が多すぎます。');
  for (const j of list) if (!isValidUserJacket(j)) throw new UserJacketError('画像データが不正です。');
  await write((s) => {
    s.clear();
    for (const j of list) s.put(j);
  });
}

// ───────────── 別タブとの同期 ─────────────

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  try {
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    channel = null;
  }
  return channel;
}

function notifyOtherTabs() {
  try {
    getChannel()?.postMessage('changed');
  } catch {
    /* 同期できなくても、開き直せば反映される */
  }
}

/**
 * 別のタブで画像が変更されたときに呼ばれる。戻り値で購読解除。
 * 送信と受信に同じ BroadcastChannel を使うため、このタブ自身の変更では呼ばれない。
 */
export function onUserJacketsChangedElsewhere(cb: () => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = () => cb();
  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
}

/** 合計サイズ（バイト） */
export function totalBytes(list: Iterable<UserJacket>): number {
  let n = 0;
  for (const j of list) n += j.data.byteLength;
  return n;
}

/** 1.2MB / 340KB のような表示 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
