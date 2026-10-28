import JSZip from 'jszip';
import type { Release } from '../data/types';
import { type Collection, type Settings, sanitizeSettings, orphanIds, totalOf } from './collection';
import { parseItems } from './storage';

/**
 * ZIPバックアップ
 *
 * ZIPの中身は JSON ファイル1つ（BACKUP_FILE_NAME）。
 * JSON は UTF-8 のテキストなので、iPhone / Android のどちらで作成しても同じ形式になる。
 *
 * ■ データ形式のバージョン管理
 *   schemaVersion を上げるときは MIGRATIONS に「旧→新」の変換関数を追加し、
 *   古いバックアップも読み込めるようにすること。
 */
export const BACKUP_FORMAT = 'inori-collection-backup';
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_FILE_NAME = 'inori-collection-backup.json';

/** 安全上の上限 */
export const LIMITS = {
  /** 読み込むZIPファイル自体の最大サイズ */
  zipBytes: 2 * 1024 * 1024,
  /** ZIP内のエントリ数（フォルダ含む）の上限 */
  entries: 20,
  /** 展開後JSONの最大サイズ */
  jsonBytes: 1024 * 1024,
  /** 所持データの最大件数 */
  items: 10000,
} as const;

export interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  createdAt: string;
  app: { name: string; masterVersion: string };
  collection: Record<string, { unopened: number; opened: number }>;
  settings: Settings;
  /** 確認表示用の参考情報（復元処理では使わない） */
  summary: { forms: number; unopened: number; opened: number };
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

// ───────────── 作成 ─────────────

export function buildBackupPayload(
  collection: Collection,
  settings: Settings,
  masterVersion: string,
  now = new Date(),
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
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    app: { name: 'Inori Collection', masterVersion },
    collection: items,
    settings: sanitizeSettings(settings),
    summary: { forms: Object.keys(items).length, unopened, opened },
  };
}

export async function createBackupZip(payload: BackupPayload): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(BACKUP_FILE_NAME, JSON.stringify(payload, null, 2), { date: new Date(payload.createdAt) });
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
  schemaVersion: number;
  /** 現在の作品マスターにないID（データは保持される） */
  unknownIds: string[];
  forms: number;
  unopened: number;
  opened: number;
}

type Migration = (o: Record<string, unknown>) => Record<string, unknown>;
/** key: 変換元の schemaVersion。例: { 1: (o) => ({ ...o, schemaVersion: 2, ... }) } */
const MIGRATIONS: Record<number, Migration> = {};

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
  return validatePayload(obj, releases);
}

export function validatePayload(obj: unknown, releases: readonly Release[]): ParsedBackup {
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
  return {
    collection,
    settings: sanitizeSettings(o.settings),
    createdAt,
    schemaVersion: v,
    unknownIds: orphanIds(releases, collection),
    forms: Object.keys(collection).length,
    unopened,
    opened,
  };
}
