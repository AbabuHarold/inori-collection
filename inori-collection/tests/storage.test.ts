import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Release } from '../src/data/types';
import { RELEASES } from '../src/data/releases';
import { DEFAULT_SETTINGS, computeStats, getHolding } from '../src/lib/collection';
import { KEYS, countCorrupted, loadCollection, loadSettings, saveCollection, saveSettings } from '../src/lib/storage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('所持データの保存と読み込み', () => {
  it('保存した枚数が再読み込み後も残る', () => {
    const c = { 'KICM-1641': { unopened: 2, opened: 1 }, 'KIXM-648': { unopened: 1, opened: 0 } };
    expect(saveCollection(c).ok).toBe(true);
    const r = loadCollection();
    expect(r.collection).toEqual(c);
    expect(r.issues).toEqual([]);
    expect(r.blockSaves).toBe(false);
  });

  it('初回起動（データなし）は空・問題なし', () => {
    expect(loadCollection()).toEqual({ collection: {}, issues: [], blockSaves: false });
  });

  it('壊れたJSONは退避してから空で起動し、ユーザーに通知する', () => {
    localStorage.setItem(KEYS.collection, '{broken');
    const r = loadCollection();
    expect(r.collection).toEqual({});
    expect(r.issues[0]).toContain('破損');
    expect(countCorrupted()).toBe(1);
    // 同じ破損データは二重に退避しない
    loadCollection();
    expect(countCorrupted()).toBe(1);
  });

  it('一部だけ不正な値なら、正常な分は読み込み、元データは退避する', () => {
    localStorage.setItem(
      KEYS.collection,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: '',
        items: { 'KICM-1641': { unopened: 1, opened: 0 }, 'KICM-1662': { unopened: -1, opened: 0 }, 'KICM-1726': { unopened: 1.5, opened: 0 } },
      }),
    );
    const r = loadCollection();
    expect(r.collection).toEqual({ 'KICM-1641': { unopened: 1, opened: 0 } });
    expect(r.issues[0]).toContain('2 件');
    expect(countCorrupted()).toBe(1);
  });

  it('容量超過時は失敗を返す（例外で落ちない）', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === KEYS.collection) throw new DOMException('full', 'QuotaExceededError');
    });
    const r = saveCollection({ A1: { unopened: 1, opened: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('quota');
      expect(r.message).toContain('容量');
    }
  });

  it('localStorage が使えない環境でも例外で落ちない', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const r = saveCollection({});
    expect(r.ok).toBe(false);
    expect(() => loadCollection()).not.toThrow();
  });

  it('新作が追加されても既存の所持データはそのまま維持され、新作は0枚', () => {
    saveCollection({ 'KICM-1641': { unopened: 1, opened: 2 }, 'KIXM-315': { unopened: 1, opened: 0 } });
    const newRelease: Release = { ...RELEASES[0], id: 'KICM-9999', workKey: 'single-99', title: '新作', releaseDate: '2027-01-01' };
    const updatedMaster = [...RELEASES, newRelease];
    const loaded = loadCollection().collection;
    expect(getHolding(loaded, 'KICM-1641')).toEqual({ unopened: 1, opened: 2 });
    expect(getHolding(loaded, 'KICM-9999')).toEqual({ unopened: 0, opened: 0 });
    const s = computeStats(updatedMaster, loaded);
    expect(s.ownedForms).toBe(2);
    expect(s.totalForms).toBe(RELEASES.length + 1);
  });
});

describe('表示設定の保存と読み込み', () => {
  it('保存した設定が復元される', () => {
    const s = { view: 'list', category: 'album', owned: 'owned', open: 'hasOpened', query: 'glow', sort: 'title' } as const;
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });

  it('壊れていたら既定値', () => {
    localStorage.setItem(KEYS.settings, 'xx');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
