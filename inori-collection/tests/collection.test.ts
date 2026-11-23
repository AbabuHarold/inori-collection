import { describe, expect, it } from 'vitest';
import type { Release } from '../src/data/types';
import { RELEASES } from '../src/data/releases';
import {
  type Collection,
  DEFAULT_SETTINGS,
  MAX_COUNT,
  applyDelta,
  computeStats,
  filterAndSort,
  formatCompletion,
  normalizeForSearch,
  orphanIds,
  sanitizeSettings,
} from '../src/lib/collection';

const ids = (list: Release[]) => list.map((r) => r.id);

describe('枚数の変更', () => {
  it('未開封・開封済をそれぞれ独立して増減できる', () => {
    let c: Collection = {};
    c = applyDelta(c, 'KICM-1641', 'unopened', 1)!;
    c = applyDelta(c, 'KICM-1641', 'unopened', 1)!;
    c = applyDelta(c, 'KICM-1641', 'opened', 1)!;
    expect(c['KICM-1641']).toEqual({ unopened: 2, opened: 1 });
  });

  it('0未満にはならない（変更なし= null）', () => {
    expect(applyDelta({}, 'KICM-1641', 'unopened', -1)).toBeNull();
    expect(applyDelta({ 'KICM-1641': { unopened: 0, opened: 1 } }, 'KICM-1641', 'unopened', -1)).toBeNull();
  });

  it('上限を超えない', () => {
    expect(applyDelta({ X1: { unopened: MAX_COUNT, opened: 0 } }, 'X1', 'unopened', 1)).toBeNull();
  });

  it('元のオブジェクトを変更しない（元に戻す用のスナップショットが壊れない）', () => {
    const before: Collection = { A1: { unopened: 1, opened: 0 } };
    const after = applyDelta(before, 'A1', 'unopened', 1)!;
    expect(before.A1.unopened).toBe(1);
    expect(after.A1.unopened).toBe(2);
  });

  it('0枚になった形態はキーごと消える', () => {
    const c = applyDelta({ A1: { unopened: 1, opened: 0 } }, 'A1', 'unopened', -1)!;
    expect(c).toEqual({});
  });
});

describe('集計', () => {
  it('同じ形態を5枚持っていても所持作品数は1', () => {
    const s = computeStats(RELEASES, { 'KICM-1641': { unopened: 3, opened: 2 } });
    expect(s.ownedForms).toBe(1);
    expect(s.totalDiscs).toBe(5);
    expect(s.unopened).toBe(3);
    expect(s.opened).toBe(2);
  });

  it('コンプリート率 = 所持形態数 / 全形態数 × 100', () => {
    const c: Collection = {};
    // 39形態のうち13形態を所持 → 33.33…%（表示は切り捨てで 33.3%）
    expect(RELEASES).toHaveLength(39);
    RELEASES.slice(0, 13).forEach((r) => (c[r.id] = { unopened: 0, opened: 1 }));
    const s = computeStats(RELEASES, c);
    expect(s.completion).toBeCloseTo(100 / 3);
    expect(formatCompletion(s.completion)).toBe('33.3%');
  });

  it('全形態0件でも0除算しない', () => {
    const s = computeStats([], {});
    expect(s.completion).toBe(0);
    expect(formatCompletion(s.completion)).toBe('0%');
  });

  it('100%未満は100%と表示しない（切り捨て）', () => {
    expect(formatCompletion(99.97)).toBe('99.9%');
    expect(formatCompletion(100)).toBe('100%');
    expect(formatCompletion((1 / 34) * 100)).toBe('2.9%');
  });

  it('マスターにないIDは集計に含めないが、orphan として検出される', () => {
    const c: Collection = { 'ZZZ-1': { unopened: 5, opened: 0 }, 'KICM-1641': { unopened: 1, opened: 0 } };
    expect(computeStats(RELEASES, c).totalDiscs).toBe(1);
    expect(orphanIds(RELEASES, c)).toEqual(['ZZZ-1']);
  });
});

describe('検索・絞り込み', () => {
  const owned: Collection = {
    'KICM-1641': { unopened: 1, opened: 0 }, // 夢のつぼみ（未開封のみ）
    'KICS-93710': { unopened: 0, opened: 2 }, // BLUE COMPASS 初回（開封済のみ）
    'KIXM-315': { unopened: 1, opened: 1 }, // 1st LIVE（両方）
  };

  it('カテゴリー', () => {
    expect(filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, category: 'single' })).toHaveLength(14);
    expect(filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, category: 'album' })).toHaveLength(14);
    expect(filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, category: 'bluray' })).toHaveLength(9);
    expect(ids(filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, category: 'clips' }))).toEqual(['KIXM-379', 'KIXM-627']);
  });

  it('所持状況', () => {
    expect(ids(filterAndSort(RELEASES, owned, { ...DEFAULT_SETTINGS, owned: 'owned' }))).toEqual(['KICM-1641', 'KIXM-315', 'KICS-93710']); // 発売日順（1st LIVE BD 2018-04-04 → BLUE COMPASS 2018-05-23）
    expect(filterAndSort(RELEASES, owned, { ...DEFAULT_SETTINGS, owned: 'missing' })).toHaveLength(RELEASES.length - 3);
  });

  it('開封状態', () => {
    expect(ids(filterAndSort(RELEASES, owned, { ...DEFAULT_SETTINGS, open: 'hasUnopened' }))).toEqual(['KICM-1641', 'KIXM-315']);
    expect(ids(filterAndSort(RELEASES, owned, { ...DEFAULT_SETTINGS, open: 'hasOpened' }))).toEqual(['KIXM-315', 'KICS-93710']);
  });

  it('複合（カテゴリー＋所持＋開封＋検索）', () => {
    const s = { ...DEFAULT_SETTINGS, category: 'bluray' as const, owned: 'owned' as const, open: 'hasOpened' as const, query: 'ready' };
    expect(ids(filterAndSort(RELEASES, owned, s))).toEqual(['KIXM-315']);
    expect(filterAndSort(RELEASES, owned, { ...s, category: 'single' })).toHaveLength(0);
  });

  it('作品名検索：大文字小文字・全角半角・ひらがな/カタカナを区別しない', () => {
    expect(ids(filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, query: 'ＷＯＮＤＥＲ caravan!' }))).toEqual(['KICM-1914']);
    expect(ids(filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, query: 'あいまいもこ' }))).toEqual(['KICM-1783']);
    expect(filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, query: 'glow' }).map((r) => r.id).sort()).toEqual(['KICS-4059', 'KICS-94059', 'KIXM-536']);
    expect(filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, query: '存在しない作品' })).toHaveLength(0);
    expect(normalizeForSearch('  Ｒｅａｄｙ　Steady ')).toBe('ready steady');
  });
});

describe('並び替え', () => {
  it('初期は発売日が古い順（同日は初回限定盤→通常盤）', () => {
    const list = filterAndSort(RELEASES, {}, DEFAULT_SETTINGS);
    expect(list[0].id).toBe('KICM-1641');
    for (let i = 1; i < list.length; i++) expect(list[i - 1].releaseDate <= list[i].releaseDate).toBe(true);
    const tr = ids(list).filter((id) => ['KICS-94217', 'KICS-4217'].includes(id));
    expect(tr).toEqual(['KICS-94217', 'KICS-4217']);
  });

  it('発売日が新しい順', () => {
    const list = filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, sort: 'dateDesc' });
    // 発売予定の 14th Single（2027-01-27）が先頭
    expect(list[0].id).toBe('KICM-2183');
    expect(list[1].id).toBe('KICM-2174');
    for (let i = 1; i < list.length; i++) expect(list[i - 1].releaseDate >= list[i].releaseDate).toBe(true);
  });

  it('作品名順', () => {
    const list = filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, sort: 'title' });
    const c = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
    for (let i = 1; i < list.length; i++) expect(c.compare(list[i - 1].title, list[i].title)).toBeLessThanOrEqual(0);
  });

  it('カテゴリー順（シングル→アルバム→ライブBlu-ray→MUSIC CLIP BOX、各カテゴリー内は発売日順）', () => {
    const list = filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, sort: 'category' });
    const cats = list.map((r) => r.category);
    expect(cats.lastIndexOf('single')).toBe(13);
    expect(cats.indexOf('album')).toBe(14);
    expect(cats.indexOf('bluray')).toBe(28);
    expect(cats.indexOf('clips')).toBe(37);
    expect(ids(list.slice(37))).toEqual(['KIXM-379', 'KIXM-627']);
  });

  it('MUSIC CLIP BOX は発売日順でほかの作品の間に並ぶ（初期の古い順）', () => {
    const list = ids(filterAndSort(RELEASES, {}, DEFAULT_SETTINGS));
    // 2019-04-10 Catch the Rainbow！ → 2019-06-26 MUSIC CLIP BOX → 2019-10-23 LIVE TOUR Catch the Rainbow！
    expect(list.indexOf('KIXM-379')).toBe(list.indexOf('KICS-3785') + 1);
    expect(list.indexOf('KIXM-398')).toBe(list.indexOf('KIXM-379') + 1);
  });

  it('作品名検索で MUSIC CLIP BOX を探せる', () => {
    expect(ids(filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, query: 'music clip' }))).toEqual(['KIXM-379', 'KIXM-627']);
    expect(ids(filterAndSort(RELEASES, {}, { ...DEFAULT_SETTINGS, query: 'ロマンス' }))).toEqual(['KICM-2183']);
  });
});

describe('表示設定の検証', () => {
  it('不正な値は既定値に戻す', () => {
    expect(sanitizeSettings({ view: 'x', sort: 'dateDesc', query: 1, owned: 'owned' })).toEqual({
      ...DEFAULT_SETTINGS,
      sort: 'dateDesc',
      owned: 'owned',
    });
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ query: 'a'.repeat(500) }).query).toHaveLength(100);
    // v1.2.0 で追加したカテゴリー（MUSIC CLIP BOX）も保存・復元できる
    expect(sanitizeSettings({ category: 'clips' }).category).toBe('clips');
    expect(sanitizeSettings({ category: 'dvd' }).category).toBe('all');
  });

  it('初期状態は 全作品・発売日が古い順・グリッド・キーワードなし', () => {
    expect(DEFAULT_SETTINGS).toEqual({ view: 'grid', category: 'all', owned: 'all', open: 'all', query: '', sort: 'dateAsc' });
  });
});
