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
import type { UserJacket } from '../src/lib/userJackets';
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
    expect(json.schemaVersion).toBe(2);
    expect(json.jackets).toEqual({});
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

  it('集計：35/39形態を所持、総枚数はZIPの全枚数と一致', async () => {
    const parsed = await parseBackupZip(new Uint8Array(readFileSync(V1_ZIP)), RELEASES);
    const s = computeStats(RELEASES, parsed.collection);
    const all = Object.values(V1_EXPECTED.collection);
    expect(s.totalForms).toBe(39);
    expect(s.ownedForms).toBe(35);
    expect(s.unopened).toBe(all.reduce((n, h) => n + h.unopened, 0));
    expect(s.opened).toBe(all.reduce((n, h) => n + h.opened, 0));
  });

  it('v1.2.0 のバックアップ（schemaVersion 2）は、v1 の項目をすべて同じ名前で含み、jackets を追加しただけ', async () => {
    const v1 = JSON.parse(await (await JSZip.loadAsync(readFileSync(V1_ZIP))).file(BACKUP_FILE_NAME)!.async('string'));
    const bytes = await createBackupZip(buildBackupPayload(sampleCollection, sampleSettings, MASTER_VERSION));
    const v2 = JSON.parse(await (await JSZip.loadAsync(bytes)).file(BACKUP_FILE_NAME)!.async('string'));
    expect(v1.schemaVersion).toBe(1);
    expect(v2.schemaVersion).toBe(2);
    expect(Object.keys(v2).sort()).toEqual([...Object.keys(v1), 'jackets'].sort());
    expect(Object.keys(v2.settings).sort()).toEqual(Object.keys(v1.settings).sort());
  });

  it('v1 のバックアップは「画像の情報なし」として読み込む（復元しても今の画像は変更しない）', async () => {
    const parsed = await parseBackupZip(new Uint8Array(readFileSync(V1_ZIP)), RELEASES);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.jackets).toBeNull();
  });
});

// ───────────── v1.2.0：自分で設定したジャケット画像を含むバックアップ（schemaVersion 2） ─────────────

/** 先頭が JPEG / PNG のシグネチャになっているダミー画像 */
function fakeJpeg(size: number, seed = 1): ArrayBuffer {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 31 + seed) & 0xff;
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b.buffer;
}
function fakePng(size: number): ArrayBuffer {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b.buffer;
}
const J = (id: string, data: ArrayBuffer, type: UserJacket['type'] = 'image/jpeg'): UserJacket => ({
  id,
  type,
  data,
  updatedAt: '2026-11-23T01:02:03.000Z',
});
const sampleJackets = [J('KIXM-627', fakeJpeg(3000, 7)), J('KICM-1641', fakeJpeg(1200, 3)), J('KICS-93477', fakePng(800), 'image/png')];

async function v2Zip(jackets: UserJacket[] = sampleJackets) {
  const payload = buildBackupPayload(sampleCollection, sampleSettings, MASTER_VERSION, new Date('2026-11-23T00:00:00Z'), jackets);
  return { payload, bytes: await createBackupZip(payload, jackets) };
}

/** バックアップJSONを書き換えたZIPを作る（画像ファイルはそのまま） */
async function tamper(bytes: Uint8Array, edit: (json: Record<string, any>, zip: JSZip) => void | Promise<void>) {
  const zip = await JSZip.loadAsync(bytes);
  const json = JSON.parse(await zip.file(BACKUP_FILE_NAME)!.async('string'));
  await edit(json, zip);
  zip.file(BACKUP_FILE_NAME, JSON.stringify(json));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('ジャケット画像を含むバックアップ（v1.2.0〜）', () => {
  it('ZIPに jackets/<形態ID>.<拡張子> として無圧縮で格納し、JSONに一覧を記録する', async () => {
    const { payload, bytes } = await v2Zip();
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).sort()).toEqual(
      [BACKUP_FILE_NAME, 'jackets/KICM-1641.jpg', 'jackets/KICS-93477.png', 'jackets/KIXM-627.jpg'].sort(),
    );
    expect(payload.jackets).toEqual({
      'KICM-1641': { file: 'jackets/KICM-1641.jpg', type: 'image/jpeg', bytes: 1200, updatedAt: '2026-11-23T01:02:03.000Z' },
      'KICS-93477': { file: 'jackets/KICS-93477.png', type: 'image/png', bytes: 800, updatedAt: '2026-11-23T01:02:03.000Z' },
      'KIXM-627': { file: 'jackets/KIXM-627.jpg', type: 'image/jpeg', bytes: 3000, updatedAt: '2026-11-23T01:02:03.000Z' },
    });
    expect(payload.summary.jackets).toBe(3);
    const stored = new Uint8Array(await zip.file('jackets/KIXM-627.jpg')!.async('uint8array'));
    expect(stored).toEqual(new Uint8Array(sampleJackets[0].data));
  });

  it('作成→読み込みで画像が1バイトも変わらずに戻る', async () => {
    const { bytes } = await v2Zip();
    const parsed = await parseBackupZip(bytes, RELEASES);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.collection).toEqual(sampleCollection);
    expect(parsed.jackets).toHaveLength(3);
    for (const j of sampleJackets) {
      const got = parsed.jackets!.find((x) => x.id === j.id)!;
      expect(got.type).toBe(j.type);
      expect(got.updatedAt).toBe(j.updatedAt);
      expect(new Uint8Array(got.data)).toEqual(new Uint8Array(j.data));
    }
  });

  it('画像なしで作成したバックアップは「画像0枚」（復元すると今の画像はなくなる）', async () => {
    const parsed = await parseBackupZip((await v2Zip([])).bytes, RELEASES);
    expect(parsed.jackets).toEqual([]);
  });

  it('画像の保存領域を使えない端末で作成したバックアップは「画像の情報なし」（復元しても今の画像は変更しない）', async () => {
    const payload = buildBackupPayload(sampleCollection, sampleSettings, MASTER_VERSION, new Date(), null);
    expect(payload.jackets).toBeNull();
    const parsed = await parseBackupZip(await createBackupZip(payload), RELEASES);
    expect(parsed.jackets).toBeNull();
  });

  it('作品マスターにない形態の画像も破棄せずに保持する', async () => {
    const parsed = await parseBackupZip((await v2Zip([J('KICS-99999', fakeJpeg(100))])).bytes, RELEASES);
    expect(parsed.jackets!.map((j) => j.id)).toEqual(['KICS-99999']);
  });

  it('フォルダに入れて圧縮し直したZIPでも画像を読める', async () => {
    const { bytes } = await v2Zip();
    const src = await JSZip.loadAsync(bytes);
    const re = new JSZip();
    for (const f of Object.values(src.files)) if (!f.dir) re.file('backup-folder/' + f.name, await f.async('uint8array'));
    const parsed = await parseBackupZip(await re.generateAsync({ type: 'uint8array' }), RELEASES);
    expect(parsed.jackets).toHaveLength(3);
  });

  it('画像ファイルが足りないZIPは拒否する', async () => {
    const bytes = await tamper((await v2Zip()).bytes, (_j, zip) => void zip.remove('jackets/KIXM-627.jpg'));
    await expectReject(bytes, /画像ファイルが見つかりません/);
  });

  it('記録と大きさが違う（壊れた）画像は拒否する', async () => {
    const bytes = await tamper((await v2Zip()).bytes, (j) => void (j.jackets['KIXM-627'].bytes = 2999));
    await expectReject(bytes, /壊れています/);
  });

  it('中身が画像でないファイル・種類の申告が違うファイルは拒否する', async () => {
    const notImage = await tamper((await v2Zip()).bytes, (_j, zip) => void zip.file('jackets/KICM-1641.jpg', new Uint8Array(1200)));
    await expectReject(notImage, /壊れています/);
    const wrongType = await tamper((await v2Zip()).bytes, (j, zip) => {
      j.jackets['KICS-93477'] = { ...j.jackets['KICS-93477'], type: 'image/jpeg', file: 'jackets/KICS-93477.jpg' };
      zip.file('jackets/KICS-93477.jpg', new Uint8Array(fakePng(800)));
    });
    await expectReject(wrongType, /壊れています/);
  });

  it.each([
    ['決まった形以外のパス', { file: '../../evil.jpg' }],
    ['別の形態のファイル名', { file: 'jackets/KICM-1662.jpg' }],
    ['対応していない種類', { type: 'image/gif', file: 'jackets/KICM-1641.gif' }],
    ['大きさが0', { bytes: 0 }],
    ['大きすぎる', { bytes: LIMITS.jacketBytes + 1 }],
  ])('画像の情報が不正（%s）なバックアップは拒否する', async (_label, patch) => {
    const bytes = await tamper((await v2Zip()).bytes, (j) => void (j.jackets['KICM-1641'] = { ...j.jackets['KICM-1641'], ...patch }));
    await expectReject(bytes, /画像の情報が不正/);
  });

  it('不正な形態IDの画像・配列の jackets は拒否する', async () => {
    const badId = await tamper((await v2Zip()).bytes, (j) => {
      j.jackets['../x'] = { file: 'jackets/../x.jpg', type: 'image/jpeg', bytes: 10 };
    });
    await expectReject(badId, /画像の情報が不正/);
    await expectReject(await zipWith({ [BACKUP_FILE_NAME]: validJson({ jackets: [] }) }), /画像の情報の形式が不正/);
  });

  it('画像の枚数・合計サイズの上限を超えるバックアップは拒否する', async () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i <= LIMITS.jackets; i++) many[`X-${i}`] = { file: `jackets/X-${i}.jpg`, type: 'image/jpeg', bytes: 10 };
    await expectReject(await zipWith({ [BACKUP_FILE_NAME]: validJson({ jackets: many }) }), /枚数が多すぎます/);
    const big: Record<string, unknown> = {};
    const n = Math.ceil(LIMITS.jacketTotalBytes / LIMITS.jacketBytes) + 1;
    for (let i = 0; i < n; i++) big[`X-${i}`] = { file: `jackets/X-${i}.jpg`, type: 'image/jpeg', bytes: LIMITS.jacketBytes };
    await expectReject(await zipWith({ [BACKUP_FILE_NAME]: validJson({ jackets: big }) }), /合計サイズが大きすぎます/);
  });

  it('展開すると巨大になる画像（ZIP爆弾）を途中で止める', async () => {
    const bytes = await tamper((await v2Zip()).bytes, (j, zip) => {
      const huge = new Uint8Array(LIMITS.jacketBytes * 4);
      huge.set([0xff, 0xd8, 0xff]);
      zip.file('jackets/KICM-1641.jpg', huge, { compression: 'DEFLATE' });
      j.jackets['KICM-1641'].bytes = LIMITS.jacketBytes;
    });
    expect(bytes.byteLength).toBeLessThan(LIMITS.jacketBytes);
    await expectReject(bytes, /展開できませんでした/);
  });

  it('createBackupZip は一覧と中身が食い違う場合に作成を中止する', async () => {
    const payload = buildBackupPayload(sampleCollection, sampleSettings, MASTER_VERSION, new Date(), sampleJackets);
    await expect(createBackupZip(payload, sampleJackets.slice(1))).rejects.toThrow(BackupError);
  });
});
