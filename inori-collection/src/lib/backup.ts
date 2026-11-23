import JSZip from 'jszip';
import type { Release } from '../data/types';
import { type Collection, type Settings, isValidId, sanitizeSettings, orphanIds, totalOf } from './collection';
import { parseItems } from './storage';
import { type UserJacket, type UserJacketType, USER_JACKET_EXT, USER_JACKET_LIMITS, USER_JACKET_TYPES, detectImageType } from './userJackets';

/**
 * ZIPバックアップ
 *
 * ZIPの中身：
 *   inori-collection-backup.json   所持枚数・表示設定（UTF-8 の JSON）
 *   jackets/<形態ID>.jpg           自分で設定したジャケット画像（schemaVersion 2 から。設定した形態だけ）
 * どれも OS に依存しない形式なので、iPhone / Android のどちらで作成しても同じ形式になる。
 *
 * ■ データ形式のバージョン管理
 *   schemaVersion を上げるときは MIGRATIONS に「旧→新」の変換関数を追加し、
 *   古いバックアップも読み込めるようにすること。
 *   - 1：v1.0.0〜v1.1.1。所持枚数と表示設定
 *   - 2：v1.2.0〜。自分で設定したジャケット画像（jackets）を追加
 */
export const BACKUP_FORMAT = 'inori-collection-backup';
export const BACKUP_SCHEMA_VERSION = 2;
export const BACKUP_FILE_NAME = 'inori-collection-backup.json';
/** ZIP内で画像を置くフォルダー */
export const BACKUP_JACKET_DIR = 'jackets/';

/** 安全上の上限 */
export const LIMITS = {
  /** 読み込むZIPファイル自体の最大サイズ（画像を含むため 64MB。画像なしなら数KB） */
  zipBytes: 64 * 1024 * 1024,
  /** ZIP内のエントリ数（フォルダ含む）の上限。画像の最大枚数 + 余裕（Mac で圧縮し直したときの __MACOSX も見込む） */
  entries: USER_JACKET_LIMITS.count * 2 + 20,
  /** 展開後JSONの最大サイズ */
  jsonBytes: 1024 * 1024,
  /** 所持データの最大件数 */
  items: 10000,
  /** 画像1枚の最大サイズ */
  jacketBytes: USER_JACKET_LIMITS.bytes,
  /** 画像の合計の最大サイズ */
  jacketTotalBytes: 60 * 1024 * 1024,
  /** 画像の最大枚数 */
  jackets: USER_JACKET_LIMITS.count,
} as const;

/** バックアップ内の画像1枚の情報 */
export interface JacketManifestEntry {
  /** ZIP内のパス（jackets/<形態ID>.<拡張子>） */
  file: string;
  type: UserJacketType;
  bytes: number;
  updatedAt: string;
}

export interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  createdAt: string;
  app: { name: string; masterVersion: string; version?: string; edition?: string };
  collection: Record<string, { unopened: number; opened: number }>;
  settings: Settings;
  /**
   * 自分で設定したジャケット画像（形態ID → 画像の情報）。
   * null は「画像の情報を含まない」（画像の保存領域を使えない端末で作成した場合など）。復元しても今の画像は変更しない。
   */
  jackets: Record<string, JacketManifestEntry> | null;
  /** 確認表示用の参考情報（復元処理では使わない） */
  summary: { forms: number; unopened: number; opened: number; jackets: number };
}

export function jacketFileName(id: string, type: UserJacketType): string {
  return `${BACKUP_JACKET_DIR}${id}.${USER_JACKET_EXT[type]}`;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

// ───────────── 作成 ─────────────

/**
 * @param userJackets 自分で設定した画像。null は「画像の情報を含めない」（画像の保存領域を使えない端末）
 */
export function buildBackupPayload(
  collection: Collection,
  settings: Settings,
  masterVersion: string,
  now = new Date(),
  userJackets: readonly UserJacket[] | null = [],
  appInfo: { version?: string; edition?: string } = {},
): BackupPayload {
  const ids = Object.keys(collection).sort();
  const items: BackupPayload['collection'] = {};
  let unopened = 0;
  let opened = 0;
  for (const id of ids) {
    const h = collection[id];
    if (totalOf(h) === 0) continue;
    items[id] = { unopened: h.unopened, opened: h.opened };
    unopened += h.unopened;
    opened += h.opened;
  }
  let jackets: BackupPayload['jackets'] = null;
  if (userJackets) {
    jackets = {};
    for (const j of [...userJackets].sort((a, b) => a.id.localeCompare(b.id))) {
      jackets[j.id] = { file: jacketFileName(j.id, j.type), type: j.type, bytes: j.data.byteLength, updatedAt: j.updatedAt };
    }
  }
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    app: { name: 'Inori Collection', masterVersion, ...appInfo },
    collection: items,
    settings: sanitizeSettings(settings),
    jackets,
    summary: { forms: Object.keys(items).length, unopened, opened, jackets: jackets ? Object.keys(jackets).length : 0 },
  };
}

/**
 * @param userJackets payload.jackets に記載した画像の中身（buildBackupPayload に渡したものと同じ）
 */
export async function createBackupZip(payload: BackupPayload, userJackets: readonly UserJacket[] = []): Promise<Uint8Array> {
  const zip = new JSZip();
  const date = new Date(payload.createdAt);
  zip.file(BACKUP_FILE_NAME, JSON.stringify(payload, null, 2), { date });
  const byId = new Map(userJackets.map((j) => [j.id, j]));
  for (const [id, entry] of Object.entries(payload.jackets ?? {})) {
    const j = byId.get(id);
    if (!j || j.data.byteLength !== entry.bytes) throw new BackupError('画像データの準備に失敗しました。');
    // JPEG などは圧縮してもほとんど小さくならないため、無圧縮で格納する
    zip.file(entry.file, new Uint8Array(j.data), { date, compression: 'STORE', createFolders: false });
  }
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
}

/** inori-collection-backup-2026-10-28.zip（端末のローカル日付） */
export function backupFileName(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `inori-collection-backup-${y}-${m}-${d}.zip`;
}

// ───────────── 読み込み・検証 ─────────────

export interface ParsedBackup {
  collection: Collection;
  settings: Settings;
  createdAt: Date | null;
  /** バックアップを作成したときのデータ形式のバージョン（変換前） */
  schemaVersion: number;
  /** 現在の作品マスターにないID（データは保持される） */
  unknownIds: string[];
  forms: number;
  unopened: number;
  opened: number;
  /**
   * 自分で設定したジャケット画像。復元すると今の画像はすべてこの内容に置き換わる。
   * null は「画像の情報を含まないバックアップ」（v1.1.1 以前で作成したものなど）。復元しても今の画像は変更しない。
   */
  jackets: UserJacket[] | null;
}

type Migration = (o: Record<string, unknown>) => Record<string, unknown>;
/** key: 変換元の schemaVersion。例: { 1: (o) => ({ ...o, schemaVersion: 2, ... }) } */
const MIGRATIONS: Record<number, Migration> = {
  // v1.1.1 以前のバックアップには画像の情報がない → 「画像の情報なし」（復元しても今の画像は変更しない）
  1: (o) => ({ ...o, schemaVersion: 2, jackets: null }),
};

function migrate(o: Record<string, unknown>): Record<string, unknown> {
  let cur = o;
  for (let guard = 0; guard < 100; guard++) {
    const v = cur.schemaVersion as number;
    if (v === BACKUP_SCHEMA_VERSION) return cur;
    const step = MIGRATIONS[v];
    if (!step) throw new BackupError(`対応していないデータ形式です（バージョン ${v}）。`);
    cur = step(cur);
  }
  throw new BackupError('データ形式の変換に失敗しました。');
}

/**
 * JSZip 3.x の ZipObject#internalStream（公式の async() も内部でこれを使っている）。
 * 型定義に含まれていないため、ここで最小限の型を宣言する。
 */
interface JSZipStreamHelper {
  on(event: 'data', cb: (chunk: Uint8Array) => void): JSZipStreamHelper;
  on(event: 'error', cb: (e: unknown) => void): JSZipStreamHelper;
  on(event: 'end', cb: () => void): JSZipStreamHelper;
  pause(): JSZipStreamHelper;
  resume(): JSZipStreamHelper;
}

/** エントリを展開しつつサイズ上限を超えた時点で中断する（ZIP爆弾対策） */
function readEntryLimited(file: JSZip.JSZipObject, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let done = false;
    const stream = (file as unknown as { internalStream(t: 'uint8array'): JSZipStreamHelper }).internalStream('uint8array');
    stream
      .on('data', (chunk: Uint8Array) => {
        if (done) return;
        size += chunk.length;
        if (size > limit) {
          done = true;
          stream.pause();
          reject(new BackupError('バックアップの中身が大きすぎます。正しいバックアップファイルか確認してください。'));
          return;
        }
        chunks.push(chunk);
      })
      .on('error', () => {
        if (done) return;
        done = true;
        reject(new BackupError('ZIPファイルの展開に失敗しました。ファイルが壊れている可能性があります。'));
      })
      .on('end', () => {
        if (done) return;
        done = true;
        const out = new Uint8Array(size);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.length;
        }
        resolve(out);
      })
      .resume();
  });
}

function baseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * ZIPファイルを検証して内容を返す。
 * この関数は既存データに一切触れない（検証が全て通ってから呼び出し側で反映する）。
 */
export async function parseBackupZip(data: Uint8Array, releases: readonly Release[]): Promise<ParsedBackup> {
  if (data.byteLength === 0) throw new BackupError('ファイルが空です。');
  if (data.byteLength > LIMITS.zipBytes) {
    throw new BackupError('ファイルが大きすぎます。Inori Collection で作成したバックアップを選んでください。');
  }
  // ZIPのシグネチャ "PK\x03\x04"
  if (!(data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04)) {
    throw new BackupError('ZIPファイルではありません。Inori Collection で作成したバックアップを選んでください。');
  }

  let zip: JSZip;
  try {
    // checkCRC32 を有効にすると読み込み時に全エントリを無制限に展開してしまうため無効にする。
    // 中身の正しさは後段の上限付き展開 + JSON 検証で確認する。
    zip = await JSZip.loadAsync(data, { checkCRC32: false, createFolders: false });
  } catch {
    throw new BackupError('ZIPファイルを読み込めませんでした。ファイルが壊れている可能性があります。');
  }

  const entries = Object.values(zip.files);
  if (entries.length > LIMITS.entries) throw new BackupError('ZIP内のファイル数が多すぎます。');
  const candidates = entries.filter((f) => !f.dir && baseName(f.name) === BACKUP_FILE_NAME && !f.name.startsWith('__MACOSX/'));
  if (candidates.length === 0) {
    throw new BackupError('このZIPには Inori Collection のバックアップデータが含まれていません。');
  }
  if (candidates.length > 1) throw new BackupError('バックアップデータが複数含まれているため読み込めません。');

  let bytes: Uint8Array;
  try {
    bytes = await readEntryLimited(candidates[0], LIMITS.jsonBytes);
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError('ZIPファイルの展開に失敗しました。');
  }
  // 画像はバックアップデータ（JSON）と同じフォルダーを基準に探す（フォルダーごと圧縮し直されたZIPにも対応）
  const jsonName = candidates[0].name;
  const baseDir = jsonName.slice(0, jsonName.lastIndexOf('/') + 1);

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    throw new BackupError('バックアップデータの文字コードが不正です。');
  }

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new BackupError('バックアップデータが壊れています（JSONとして読み込めません）。');
  }
  const { parsed, manifest } = validatePayloadWithManifest(obj, releases);
  if (manifest) parsed.jackets = await readJackets(zip, baseDir, manifest);
  return parsed;
}

/** 画像の情報（manifest）を検証する。null は「画像の情報なし」 */
function validateManifest(raw: unknown): Record<string, JacketManifestEntry> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new BackupError('画像の情報の形式が不正です。');
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > LIMITS.jackets) throw new BackupError('画像の枚数が多すぎます。');
  const out: Record<string, JacketManifestEntry> = {};
  let total = 0;
  for (const [id, v] of entries) {
    const bad = () => new BackupError(`画像の情報が不正です（${id.slice(0, 64)}）。`);
    if (!isValidId(id) || !v || typeof v !== 'object' || Array.isArray(v)) throw bad();
    const e = v as Record<string, unknown>;
    if (typeof e.type !== 'string' || !(USER_JACKET_TYPES as readonly string[]).includes(e.type)) throw bad();
    const type = e.type as UserJacketType;
    // ZIP内のパスは決まった形だけを受け付ける（任意のパスを読ませない）
    if (e.file !== jacketFileName(id, type)) throw bad();
    if (typeof e.bytes !== 'number' || !Number.isInteger(e.bytes) || e.bytes < 1 || e.bytes > LIMITS.jacketBytes) throw bad();
    total += e.bytes;
    const updatedAt = typeof e.updatedAt === 'string' && !Number.isNaN(Date.parse(e.updatedAt)) ? e.updatedAt : new Date(0).toISOString();
    out[id] = { file: e.file, type, bytes: e.bytes, updatedAt };
  }
  if (total > LIMITS.jacketTotalBytes) throw new BackupError('画像の合計サイズが大きすぎます。');
  return out;
}

/** manifest に記載された画像をZIPから読み込み、中身を検証する（1枚でも不正なら復元しない） */
async function readJackets(zip: JSZip, baseDir: string, manifest: Record<string, JacketManifestEntry>): Promise<UserJacket[]> {
  const out: UserJacket[] = [];
  for (const [id, e] of Object.entries(manifest)) {
    const file = zip.file(baseDir + e.file);
    if (!file || file.dir) throw new BackupError(`画像ファイルが見つかりません（${e.file}）。ZIPファイルが壊れている可能性があります。`);
    let bytes: Uint8Array;
    try {
      bytes = await readEntryLimited(file, LIMITS.jacketBytes);
    } catch {
      throw new BackupError(`画像ファイルを展開できませんでした（${e.file}）。ZIPファイルが壊れている可能性があります。`);
    }
    if (bytes.byteLength !== e.bytes || detectImageType(bytes) !== e.type) {
      throw new BackupError(`画像ファイルが壊れています（${e.file}）。`);
    }
    // 独立した ArrayBuffer にして保存する（ZIP展開用のバッファを参照し続けない）
    const data = bytes.slice().buffer as ArrayBuffer;
    out.push({ id, type: e.type, data, updatedAt: e.updatedAt });
  }
  return out;
}

/** JSON（バックアップデータ）を検証する。画像の中身は読み込まない（jackets は null を返す） */
export function validatePayload(obj: unknown, releases: readonly Release[]): ParsedBackup {
  return validatePayloadWithManifest(obj, releases).parsed;
}

function validatePayloadWithManifest(
  obj: unknown,
  releases: readonly Release[],
): { parsed: ParsedBackup; manifest: Record<string, JacketManifestEntry> | null } {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new BackupError('バックアップデータの形式が不正です。');
  let o = obj as Record<string, unknown>;
  if (o.format !== BACKUP_FORMAT) throw new BackupError('Inori Collection のバックアップデータではありません。');
  const v = o.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new BackupError('データ形式のバージョンが不正です。');
  if (v > BACKUP_SCHEMA_VERSION) {
    throw new BackupError('新しいバージョンのアプリで作成されたバックアップです。アプリを最新版に更新してから復元してください。');
  }
  o = migrate(o);

  const parsed = parseItems(o.collection, LIMITS.items);
  if (!parsed) throw new BackupError('所持データの形式が不正です。');
  if (parsed.invalid.length > 0) {
    const sample = parsed.invalid.slice(0, 3).join(', ');
    throw new BackupError(`不正な枚数データが ${parsed.invalid.length} 件含まれているため復元できません（例: ${sample}）。`);
  }

  const createdAt = typeof o.createdAt === 'string' && !Number.isNaN(Date.parse(o.createdAt)) ? new Date(o.createdAt) : null;
  const collection = parsed.collection;
  let unopened = 0;
  let opened = 0;
  for (const h of Object.values(collection)) {
    unopened += h.unopened;
    opened += h.opened;
  }
  const manifest = validateManifest(o.jackets);
  return {
    parsed: {
      collection,
      settings: sanitizeSettings(o.settings),
      createdAt,
      schemaVersion: v,
      unknownIds: orphanIds(releases, collection),
      forms: Object.keys(collection).length,
      unopened,
      opened,
      jackets: null,
    },
    manifest,
  };
}
