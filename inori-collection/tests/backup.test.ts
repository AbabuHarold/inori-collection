import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE = resolve(__dirname, 'fixtures/backup-v1-sample.zip');
/** v1.0.0（34形態版）の実アプリで「バックアップを作成」して作ったZIP（e2e/make-v1-fixture.mjs） */
const V1_ZIP = resolve(__dirname, 'fixtures/backup-v1.0.0-34forms.zip');
const V1_EXPECTED = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/backup-v1.0.0-34forms.expected.json'), 'utf-8')) as {
  v1FormIds: string[];
  collection: Record<string, { unopened: number; opened: number }>;
};
import { RELEASES, MASTER_VERSION } from '../src/data/releases';
import { DEFAULT_SETTINGS, computeStats, getHolding } from '../src/lib/collection';
import {
  BACKUP_FILE_NAME,
  BackupError,
  LIMITS,
  backupFileName,
  buildBackupPayload,
  createBackupZip,
  parseBackupZip,
} from '../src/lib/backup';

const sampleCollection = {
  'KICM-1641': { unopened: 2, opened: 1 },
  'KICS-93710': { unopened: 1, opened: 0 },
  'KICS-3710': { unopened: 0, opened: 3 },
  'KIXM-648': { unopened: 1, opened: 1 },
};
const sampleSettings = { ...DEFAULT_SETTINGS, view: 'list' as const, sort: 'title' as const, query: 'glow', category: 'album' as const };

async function zipWith(files: Record<string, string | Uint8Array>, compression: 'DEFLATE' | 'STORE' = 'DEFLATE') {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array', compression });
}

function validJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ ...buildBackupPayload(sampleCollection, sampleSettings, MASTER_VERSION), ...overrides });
}

async function expectReject(data: Uint8Array, msg: RegExp) {
  await expect(parseBackupZip(data, RELEASES)).rejects.toThrow(BackupError);
  await expect(parseBackupZip(data, RELEASES)).rejects.toThrow(msg);
}

describe('バックアップの作成', () => {
  it('ZIPの中に必要な情報をすべて含んだJSONが1つ入っている', async () => {
    const now = new Date('2026-10-28T12:34:56Z');
    const bytes = await createBackupZip(buildBackupPayload(sampleCollection, sampleSettings, MASTER_VERSION, now));
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual([BACKUP_FILE_NAME]);
    const json = JSON.parse(await zip.file(BACKUP_FILE_NAME)!.async('string'));
    expect(json.format).toBe('inori-collection-backup');
    expect(json.schemaVersion).toBe(1);
    expect(json.createdAt).toBe('2026-10-28T12:34:56.000Z');
    expect(json.collection).toEqual(sampleCollection);
    expect(json.settings).toEqual(sampleSettings);
    expect(json.app.masterVersion).toBe(MASTER_VERSION);
  });

  it('ファイル名は inori-collection-backup-YYYY-MM-DD.zip', () => {
    expect(backupFileName(new Date(2026, 9, 28, 23, 59))).toBe('inori-collection-backup-2026-10-28.zip');
    expect(backupFileName(new Date(2027, 0, 5))).toBe('inori-collection-backup-2027-01-05.zip');
  });
});

describe('バックアップからの復元（往復）', () => {
  it('作成→読み込みで所持枚数・設定・集計が完全に一致する', async () => {
    const bytes = await createBackupZip(buildBackupPayload(sampleCollection, sampleSettings, MASTER_VERSION));
    const parsed = await parseBackupZip(bytes, RELEASES);
    expect(parsed.collection).toEqual(sampleCollection);
    expect(parsed.settings).toEqual(sampleSettings);
    expect(computeStats(RELEASES, parsed.collection)).toEqual(computeStats(RELEASES, sampleCollection));
    expect(parsed.forms).toBe(4);
    expect(parsed.unopened).toBe(4);
    expect(parsed.opened).toBe(5);
  });

  it('古い形式（v1.0.0 で作成したフィクスチャ）を読み込める', async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const parsed = await parseBackupZip(bytes, RELEASES);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.collection['KICM-1641']).toEqual({ unopened: 1, opened: 2 });
    expect(parsed.settings.view).toBe('list');
    expect(parsed.createdAt?.toISOString()).toBe('2026-10-28T03:00:00.000Z');
  });

  it('v1.0.0 時点でマスター未登録だった KICS-93477 は、v1.1.0 で追加された形態に紐づく', async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const parsed = await parseBackupZip(bytes, RELEASES);
    expect(parsed.unknownIds).toEqual([]);
    expect(parsed.collection['KICS-93477']).toEqual({ unopened: 1, opened: 0 });
    // 集計にも含まれる（4形態・6枚）
    const s = computeStats(RELEASES, parsed.collection);
    expect([s.ownedForms, s.totalDiscs]).toEqual([4, 6]);
  });

  it('現在の作品マスターにないIDも破棄せず保持する', async () => {
    const json = validJson({ collection: { 'KICM-1641': { unopened: 1, opened: 0 }, 'KICS-99999': { unopened: 2, opened: 1 } } });
    const parsed = await parseBackupZip(await zipWith({ [BACKUP_FILE_NAME]: json }), RELEASES);
    expect(parsed.unknownIds).toEqual(['KICS-99999']);
    expect(parsed.collection['KICS-99999']).toEqual({ unopened: 2, opened: 1 });
  });

  it('フォルダに入れて圧縮し直したZIPでも読める', async () => {
    const parsed = await parseBackupZip(await zipWith({ ['my-backup/' + BACKUP_FILE_NAME]: validJson() }), RELEASES);
    expect(parsed.collection).toEqual(sampleCollection);
  });

  it('BOM付き・設定欠落でも所持データが正しければ読める（設定は既定値）', async () => {
    const json = JSON.parse(validJson());
    delete json.settings;
    const parsed = await parseBackupZip(await zipWith({ [BACKUP_FILE_NAME]: '﻿' + JSON.stringify(json) }), RELEASES);
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('不正なファイルの拒否', () => {
  it('空ファイル', async () => expectReject(new Uint8Array(), /空/));

  it('ZIPではないファイル', async () => expectReject(new TextEncoder().encode('hello'), /ZIPファイルではありません/));

  it('壊れたZIP（先頭だけZIPに見える）', async () => {
    const bytes = await zipWith({ [BACKUP_FILE_NAME]: validJson() });
    await expectReject(bytes.slice(0, 40), /読み込めませんでした|展開に失敗/);
  });

  it('大きすぎるファイル', async () => {
    const big = new Uint8Array(LIMITS.zipBytes + 1);
    big.set([0x50, 0x4b, 0x03, 0x04]);
    await expectReject(big, /大きすぎます/);
  });

  it('バックアップJSONが入っていないZIP', async () => expectReject(await zipWith({ 'photo.jpg': 'x' }), /含まれていません/));

  it('バックアップJSONが複数入っているZIP', async () =>
    expectReject(await zipWith({ [BACKUP_FILE_NAME]: validJson(), ['a/' + BACKUP_FILE_NAME]: validJson() }), /複数/));

  it('ファイル数が多すぎるZIP', async () => {
    const files: Record<string, string> = { [BACKUP_FILE_NAME]: validJson() };
    for (let i = 0; i < LIMITS.entries + 1; i++) files[`junk${i}.txt`] = 'x';
    await expectReject(await zipWith(files), /多すぎます/);
  });

  it('展開すると巨大になるZIP（ZIP爆弾）を途中で止める', async () => {
    const bomb = '{"format":"inori-collection-backup"' + ' '.repeat(8 * 1024 * 1024) + '}';
    const bytes = await zipWith({ [BACKUP_FILE_NAME]: bomb });
    expect(bytes.byteLength).toBeLessThan(LIMITS.zipBytes);
    await expectReject(bytes, /大きすぎます/);
  });

  it('JSONとして壊れている', async () => expectReject(await zipWith({ [BACKUP_FILE_NAME]: '{"format":' }), /JSON/));

  it('別アプリのJSON', async () => expectReject(await zipWith({ [BACKUP_FILE_NAME]: '{"format":"other"}' }), /ではありません/));

  it('新しいバージョンで作られたバックアップ', async () =>
    expectReject(await zipWith({ [BACKUP_FILE_NAME]: validJson({ schemaVersion: 99 }) }), /新しいバージョン/));

  it('不正なバージョン値', async () => expectReject(await zipWith({ [BACKUP_FILE_NAME]: validJson({ schemaVersion: '1' }) }), /バージョン/));

  it.each([
    ['マイナス', { unopened: -1, opened: 0 }],
    ['小数', { unopened: 1.5, opened: 0 }],
    ['文字列', { unopened: '2', opened: 0 }],
    ['上限超過', { unopened: 1000, opened: 0 }],
    ['欠落', { unopened: 1 }],
    ['null', null],
  ])('不正な枚数データ（%s）を含むバックアップは全体を拒否する', async (_label, value) => {
    const json = validJson({ collection: { 'KICM-1641': { unopened: 1, opened: 0 }, 'KICM-1662': value } });
    await expectReject(await zipWith({ [BACKUP_FILE_NAME]: json }), /不正な枚数データ/);
  });

  it('不正なID', async () => {
    const json = validJson({ collection: { '../evil': { unopened: 1, opened: 0 } } });
    await expectReject(await zipWith({ [BACKUP_FILE_NAME]: json }), /不正な枚数データ/);
  });

  it('collection が配列', async () => expectReject(await zipWith({ [BACKUP_FILE_NAME]: validJson({ collection: [] }) }), /形式が不正/));

  it('UTF-8 として不正な文字列', async () =>
    expectReject(await zipWith({ [BACKUP_FILE_NAME]: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) }), /文字コード/));
});

describe('旧バージョン（v1.0.0・34形態）で作成したZIPを新しい構成（36形態）で復元', () => {
  it('v1.0.0 のZIPは34形態すべて＋当時マスター未登録の KICS-93477 を含む', () => {
    expect(V1_EXPECTED.v1FormIds).toHaveLength(34);
    expect(Object.keys(V1_EXPECTED.collection)).toHaveLength(35);
    expect(V1_EXPECTED.collection['KICS-93477']).toBeDefined();
  });

  it('既存34形態の所持枚数がすべてそのまま保持される', async () => {
    const parsed = await parseBackupZip(new Uint8Array(readFileSync(V1_ZIP)), RELEASES);
    for (const id of V1_EXPECTED.v1FormIds) {
      expect(getHolding(parsed.collection, id), id).toEqual(V1_EXPECTED.collection[id]);
    }
  });

  it('新しく追加した形態は 0枚 で表示される（KICS-93785）', async () => {
    const parsed = await parseBackupZip(new Uint8Array(readFileSync(V1_ZIP)), RELEASES);
    expect(getHolding(parsed.collection, 'KICS-93785')).toEqual({ unopened: 0, opened: 0 });
  });

  it('以前はマスター未登録だった KICS-93477 の所持データが、新規登録された形態に正しく紐づく', async () => {
    const parsed = await parseBackupZip(new Uint8Array(readFileSync(V1_ZIP)), RELEASES);
    expect(parsed.unknownIds).toEqual([]);
    expect(getHolding(parsed.collection, 'KICS-93477')).toEqual(V1_EXPECTED.collection['KICS-93477']);
  });

  it('集計：35/36形態を所持、総枚数はZIPの全枚数と一致', async () => {
    const parsed = await parseBackupZip(new Uint8Array(readFileSync(V1_ZIP)), RELEASES);
    const s = computeStats(RELEASES, parsed.collection);
    const all = Object.values(V1_EXPECTED.collection);
    expect(s.totalForms).toBe(36);
    expect(s.ownedForms).toBe(35);
    expect(s.unopened).toBe(all.reduce((n, h) => n + h.unopened, 0));
    expect(s.opened).toBe(all.reduce((n, h) => n + h.opened, 0));
  });

  it('バックアップ形式は変更していない（v1.1.0 で作るZIPも schemaVersion 1・同じファイル名・同じ項目）', async () => {
    const v1 = JSON.parse(await (await JSZip.loadAsync(readFileSync(V1_ZIP))).file(BACKUP_FILE_NAME)!.async('string'));
    const bytes = await createBackupZip(buildBackupPayload(sampleCollection, sampleSettings, MASTER_VERSION));
    const v11 = JSON.parse(await (await JSZip.loadAsync(bytes)).file(BACKUP_FILE_NAME)!.async('string'));
    expect(v11.schemaVersion).toBe(v1.schemaVersion);
    expect(Object.keys(v11).sort()).toEqual(Object.keys(v1).sort());
    expect(Object.keys(v11.settings).sort()).toEqual(Object.keys(v1.settings).sort());
  });
});
