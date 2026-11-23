import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type UserJacket,
  USER_JACKET_DB,
  USER_JACKET_LIMITS,
  USER_JACKET_STORE,
  deleteUserJacket,
  detectImageType,
  formatBytes,
  isValidUserJacket,
  listUserJackets,
  putUserJacket,
  replaceAllUserJackets,
  totalBytes,
} from '../src/lib/userJackets';
import { fitWithin } from '../src/lib/imageProcess';

function jpeg(size: number, seed = 0): ArrayBuffer {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i + seed) & 0xff;
  b.set([0xff, 0xd8, 0xff, 0xdb]);
  return b.buffer;
}
const J = (id: string, size = 100, seed = 0): UserJacket => ({ id, type: 'image/jpeg', data: jpeg(size, seed), updatedAt: '2026-11-23T00:00:00.000Z' });
const ids = (l: UserJacket[]) => l.map((j) => j.id).sort();

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(USER_JACKET_DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/** アプリを通さずに保存領域へ直接書き込む（壊れたデータの再現用） */
function rawPut(value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(USER_JACKET_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(USER_JACKET_STORE, { keyPath: 'id' });
    open.onsuccess = () => {
      const tx = open.result.transaction(USER_JACKET_STORE, 'readwrite');
      tx.objectStore(USER_JACKET_STORE).put(value);
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

beforeEach(async () => {
  await deleteDb();
});

describe('画像の種類の判定（中身の先頭バイトで判定し、拡張子は信用しない）', () => {
  it('JPEG / PNG / WebP を判定し、それ以外は null', () => {
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).toBe('image/jpeg');
    expect(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectImageType(new TextEncoder().encode('RIFF\x00\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
    expect(detectImageType(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(detectImageType(new TextEncoder().encode('<html>404</html>'))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });

  it('保存するレコードの検証', () => {
    expect(isValidUserJacket(J('KICM-1641'))).toBe(true);
    expect(isValidUserJacket({ ...J('KICM-1641'), id: '../x' })).toBe(false);
    expect(isValidUserJacket({ ...J('KICM-1641'), type: 'image/gif' })).toBe(false);
    expect(isValidUserJacket({ ...J('KICM-1641'), type: 'image/png' })).toBe(false); // 中身は JPEG
    expect(isValidUserJacket({ ...J('KICM-1641'), data: new ArrayBuffer(0) })).toBe(false);
    expect(isValidUserJacket({ ...J('KICM-1641'), data: jpeg(USER_JACKET_LIMITS.bytes + 1) })).toBe(false);
    expect(isValidUserJacket({ ...J('KICM-1641'), data: 'abc' })).toBe(false);
    expect(isValidUserJacket(null)).toBe(false);
  });
});

describe('端末内への保存（IndexedDB）', () => {
  it('保存・読み込み・上書き・削除ができ、中身が変わらない', async () => {
    expect(await listUserJackets()).toEqual([]);
    await putUserJacket(J('KICM-1641', 500, 1));
    await putUserJacket(J('KIXM-627', 300, 2));
    let list = await listUserJackets();
    expect(ids(list)).toEqual(['KICM-1641', 'KIXM-627']);
    expect(new Uint8Array(list.find((j) => j.id === 'KICM-1641')!.data)).toEqual(new Uint8Array(jpeg(500, 1)));

    await putUserJacket(J('KICM-1641', 800, 9)); // 上書き
    list = await listUserJackets();
    expect(list.find((j) => j.id === 'KICM-1641')!.data.byteLength).toBe(800);

    await deleteUserJacket('KICM-1641');
    expect(ids(await listUserJackets())).toEqual(['KIXM-627']);
  });

  it('不正な画像は保存しない', async () => {
    await expect(putUserJacket({ ...J('KICM-1641'), data: new TextEncoder().encode('<html>').buffer })).rejects.toThrow(/不正/);
    expect(await listUserJackets()).toEqual([]);
  });

  it('まとめて置き換え（復元用）：全部入れ替わり、1件でも不正なら何も変わらない', async () => {
    await putUserJacket(J('KICM-1641'));
    await putUserJacket(J('KICM-1662'));
    await replaceAllUserJackets([J('KIXM-379'), J('KIXM-627')]);
    expect(ids(await listUserJackets())).toEqual(['KIXM-379', 'KIXM-627']);

    await expect(replaceAllUserJackets([J('KICS-3477'), { ...J('KICS-3710'), type: 'image/png' }])).rejects.toThrow();
    expect(ids(await listUserJackets())).toEqual(['KIXM-379', 'KIXM-627']);

    await replaceAllUserJackets([]);
    expect(await listUserJackets()).toEqual([]);
  });

  it('壊れたレコードは読み飛ばす（削除はしない）', async () => {
    await putUserJacket(J('KICM-1641'));
    await rawPut({ id: 'KICM-1662', type: 'image/jpeg', data: 'broken', updatedAt: 'x' });
    expect(ids(await listUserJackets())).toEqual(['KICM-1641']);
  });

  it('枚数の上限を超える置き換えは拒否する', async () => {
    const many = Array.from({ length: USER_JACKET_LIMITS.count + 1 }, (_, i) => J(`X-${i}`, 10));
    await expect(replaceAllUserJackets(many)).rejects.toThrow(/多すぎます/);
  });
});

describe('補助', () => {
  it('縮小後のサイズ：長辺800px以内・縦横比を保つ・小さい画像は拡大しない', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1000, 3000)).toEqual({ width: 267, height: 800 });
    expect(fitWithin(500, 500)).toEqual({ width: 500, height: 500 });
    expect(fitWithin(10000, 1)).toEqual({ width: 800, height: 1 });
  });

  it('合計サイズと表示', () => {
    expect(totalBytes([J('A', 1000), J('B', 24)])).toBe(1024);
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(340 * 1024)).toBe('340KB');
    expect(formatBytes(1.25 * 1024 * 1024)).toBe('1.3MB');
  });
});
