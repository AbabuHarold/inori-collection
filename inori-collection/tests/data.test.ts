import { describe, expect, it } from 'vitest';
import { RELEASES, MASTER_VERSION, CATEGORY_LABEL, editionLabel } from '../src/data/releases';
import { JACKETS, JACKETS_FROM_SOURCES } from '../src/data/jackets';
import * as PublicJackets from '../src/data/jackets.public';
import { isValidId } from '../src/lib/collection';

/** v1.0.0（34形態）で公開済みのID。所持データ・バックアップのキーなので、以後のバージョンでも必ず残す */
const V1_IDS = [
  'KICM-1641', 'KICM-1662', 'KICM-1726', 'KICM-1783', 'KICM-1817', 'KICM-1890', 'KICM-1914', 'KICM-2029', 'KICM-2065',
  'KICM-2092', 'KICM-2128', 'KICM-2138', 'KICM-2174', 'KICS-3477', 'KICS-93710', 'KICS-3710', 'KICS-3785', 'KICS-94059',
  'KICS-4059', 'KICS-94166', 'KICS-4166', 'KICS-94217', 'KICS-4217', 'KICS-94219', 'KICS-4219', 'KIXM-315', 'KIXM-340',
  'KIXM-398', 'KIXM-449', 'KIXM-493', 'KIXM-536', 'KIXM-578', 'KIXM-618', 'KIXM-648',
];
/** v1.1.0 で追加したID */
const V11_IDS = ['KICS-93477', 'KICS-93785'];

describe('作品マスターデータの整合性', () => {
  it('件数：32作品・39形態（シングル14 / アルバム7作品14形態 / ライブBlu-ray9 / MUSIC CLIP BOX 2）', () => {
    expect(RELEASES).toHaveLength(39);
    expect(new Set(RELEASES.map((r) => r.workKey)).size).toBe(32);
    const by = (c: string) => RELEASES.filter((r) => r.category === c);
    expect(by('single')).toHaveLength(14);
    expect(by('album')).toHaveLength(14);
    expect(new Set(by('album').map((r) => r.workKey)).size).toBe(7);
    expect(by('bluray')).toHaveLength(9);
    expect(by('clips')).toHaveLength(2);
    // カテゴリーはすべて表示名を持つ
    for (const r of RELEASES) expect(CATEGORY_LABEL[r.category], r.id).toBeTruthy();
  });

  it('アルバムは全7作品が「初回限定盤」「通常盤」の2形態ずつ', () => {
    const albums = RELEASES.filter((r) => r.category === 'album');
    const byWork = new Map<string, string[]>();
    for (const r of albums) byWork.set(r.workKey, [...(byWork.get(r.workKey) ?? []), r.edition ?? '']);
    for (const [work, eds] of byWork) expect(eds.sort(), work).toEqual(['初回限定盤', '通常盤']);
  });

  it('v1.0.0 で公開済みの34形態・v1.1.0 で追加した2形態のIDがすべて残っている（既存の所持データ・バックアップとの互換性）', () => {
    const ids = new Set(RELEASES.map((r) => r.id));
    for (const id of [...V1_IDS, ...V11_IDS]) expect(ids.has(id), id).toBe(true);
  });

  it('v1.2.0 で追加した3形態（公式サイト・キングレコードで確認）', () => {
    expect(RELEASES.find((r) => r.id === 'KICM-2183')).toMatchObject({
      workKey: 'single-14', title: '未解決で、ロマンスで。', category: 'single', releaseDate: '2027-01-27', edition: null, format: 'CD',
      catalogNumber: 'KICM-2183', officialUrl: 'https://inoriminase.com/discography/2445/',
      sourceUrl: 'https://www.kingrecords.co.jp/cs/g/gKICM-2183/',
    });
    expect(RELEASES.find((r) => r.id === 'KIXM-379')).toMatchObject({
      workKey: 'clips-01', title: 'Inori Minase MUSIC CLIP BOX', category: 'clips', releaseDate: '2019-06-26', edition: null, format: 'Blu-ray',
      catalogNumber: 'KIXM-379', officialUrl: 'https://inoriminase.com/discography/1882/',
      sourceUrl: 'https://www.kingrecords.co.jp/cs/g/gKIXM-379/',
    });
    expect(RELEASES.find((r) => r.id === 'KIXM-627')).toMatchObject({
      workKey: 'clips-02', title: 'Inori Minase MUSIC CLIP BOX 2', category: 'clips', releaseDate: '2025-06-18', edition: null, format: 'Blu-ray',
      catalogNumber: 'KIXM-627', officialUrl: 'https://inoriminase.com/discography/1931/',
      sourceUrl: 'https://www.kingrecords.co.jp/cs/g/gKIXM-627/',
    });
  });

  it('v1.1.0 で追加した2形態（公式サイトで確認。キングレコードには掲載なし）', () => {
    const inn = RELEASES.find((r) => r.id === 'KICS-93477')!;
    expect(inn).toMatchObject({
      title: 'Innocent flower', category: 'album', releaseDate: '2017-04-05', edition: '初回限定盤', format: 'CD+BD',
      catalogNumber: 'KICS-93477', officialUrl: 'https://inoriminase.com/discography/1853/', sourceUrl: null,
    });
    const ctr = RELEASES.find((r) => r.id === 'KICS-93785')!;
    expect(ctr).toMatchObject({
      title: 'Catch the Rainbow！', category: 'album', releaseDate: '2019-04-10', edition: '初回限定盤', format: 'CD+BD',
      catalogNumber: 'KICS-93785', officialUrl: 'https://inoriminase.com/discography/1879/', sourceUrl: null,
    });
    // 同じ作品の通常盤と同じ workKey でまとまっている
    expect(inn.workKey).toBe(RELEASES.find((r) => r.id === 'KICS-3477')!.workKey);
    expect(ctr.workKey).toBe(RELEASES.find((r) => r.id === 'KICS-3785')!.workKey);
  });

  it('シングルは 1st〜14th がそろっている（workKey の番号が欠けていない）', () => {
    const nums = RELEASES.filter((r) => r.category === 'single').map((r) => Number(r.workKey.replace('single-', '')));
    expect(nums.sort((a, b) => a - b)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });

  it('IDは重複せず、所持データのキーとして有効な形式', () => {
    const ids = RELEASES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isValidId(id), id).toBe(true);
  });

  it('IDは代表品番と一致する（品番は変わらないのでIDも変わらない）', () => {
    for (const r of RELEASES) {
      expect(r.catalogNumber, r.id).not.toBeNull();
      expect(r.catalogNumber!.startsWith(r.id), `${r.id} vs ${r.catalogNumber}`).toBe(true);
    }
  });

  it('発売日は実在する日付（YYYY-MM-DD）', () => {
    for (const r of RELEASES) {
      expect(r.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const d = new Date(`${r.releaseDate}T00:00:00Z`);
      expect(d.toISOString().slice(0, 10), r.id).toBe(r.releaseDate);
    }
  });

  it('同じ作品（workKey）の形態はタイトル・発売日・カテゴリー・公式URLが一致し、形態名が重複しない', () => {
    const groups = new Map<string, typeof RELEASES>();
    for (const r of RELEASES) groups.set(r.workKey, [...(groups.get(r.workKey) ?? []), r]);
    for (const [key, list] of groups) {
      expect(new Set(list.map((r) => r.title)).size, key).toBe(1);
      expect(new Set(list.map((r) => r.releaseDate)).size, key).toBe(1);
      expect(new Set(list.map((r) => r.category)).size, key).toBe(1);
      expect(new Set(list.map((r) => r.officialUrl)).size, key).toBe(1);
      expect(new Set(list.map((r) => editionLabel(r))).size, key).toBe(list.length);
    }
  });

  it('全形態に公式サイト（リニューアル後）の作品詳細URLがあり、作品ごとに異なる', () => {
    const byWork = new Map<string, string>();
    for (const r of RELEASES) {
      expect(r.officialUrl, r.id).toMatch(/^https:\/\/inoriminase\.com\/discography\/\d+\/$/);
      byWork.set(r.workKey, r.officialUrl!);
    }
    expect(new Set(byWork.values()).size).toBe(byWork.size);
  });

  it('補助確認元はキングレコード公式の商品ページ（掲載のない2形態は null）', () => {
    for (const r of RELEASES) {
      if (r.id === 'KICS-93477' || r.id === 'KICS-93785') expect(r.sourceUrl).toBeNull();
      else expect(r.sourceUrl, r.id).toMatch(/^https:\/\/www\.kingrecords\.co\.jp\/cs\/g\/g[A-Z]+-\d+\/$/);
    }
    expect(MASTER_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
  });

  it('対象外の商品（配信限定・他名義ライブ）が混入していない', () => {
    const ids = RELEASES.map((r) => r.id);
    for (const excluded of ['KIXM-292', 'NOPA-7311', 'NOPA-8359', 'NOPV-763']) expect(ids).not.toContain(excluded);
    // 配信限定の作品（配信SINGLE・LIVE ALBUM）はタイトルでも混入していない
    const titles = RELEASES.map((r) => r.title);
    for (const t of ['まっすぐに、トウメイに。', 'REAL-EYES']) expect(titles).not.toContain(t);
    expect(RELEASES.filter((r) => r.title.includes('LIVE TOUR 2024 heart bookmark'))).toHaveLength(0);
  });
});

describe('ジャケット画像（個人用版：src/data/jackets.ts）', () => {
  it('テストは個人用版の画像一覧で実行される', () => {
    expect(JACKETS_FROM_SOURCES).toBe(true);
  });

  it('全形態に画像の候補があり、作品マスターにない形態の画像は登録されていない', () => {
    const ids = new Set(RELEASES.map((r) => r.id));
    for (const r of RELEASES) expect(r.jacketUrls.length, r.id).toBeGreaterThan(0);
    for (const id of Object.keys(JACKETS)) expect(ids.has(id), `${id} は作品マスターにない`).toBe(true);
  });

  it('候補はすべて公式配信元のURL（公式サイトはリニューアル後の /wp/wp-content/uploads/<年>/<月>/）', () => {
    for (const r of RELEASES) {
      for (const u of r.jacketUrls) {
        expect(u, r.id).toMatch(
          /^https:\/\/(www\.kingrecords\.co\.jp\/img\/goods\/[A-Za-z0-9]+\/[\w-]+\.jpg|inoriminase\.com\/wp\/wp-content\/uploads\/20\d\d\/(0[1-9]|1[0-2])\/[\w.-]+\.jpe?g)$/,
        );
      }
    }
  });

  it('同じURLが別の形態に使われていない（取り違え・重複登録の検出）', () => {
    const seen = new Map<string, string>();
    for (const r of RELEASES) {
      for (const u of r.jacketUrls) {
        expect(seen.get(u), `${u} が ${seen.get(u)} と ${r.id} で重複`).toBeUndefined();
        seen.set(u, r.id);
      }
    }
  });

  it('キングレコードを優先し、公式サイトの画像を予備にする（キングレコードに掲載のない初回限定盤2形態は公式のみ）', () => {
    for (const r of RELEASES) {
      const officialOnly = r.id === 'KICS-93477' || r.id === 'KICS-93785';
      if (officialOnly) {
        expect(r.jacketUrls, r.id).toHaveLength(1);
        expect(r.jacketUrls[0]).toContain('inoriminase.com');
      } else {
        expect(r.jacketUrls, r.id).toHaveLength(2);
        expect(r.jacketUrls[0]).toContain('kingrecords.co.jp');
        expect(r.jacketUrls[1]).toContain('inoriminase.com');
      }
    }
  });

  it('公式サイトの画像ファイル名はリニューアル前（v1.1.1）と同じ（保存場所だけが変わった）', () => {
    // v1.1.1 で記録していたファイル名（https://www.inoriminase.com/img/disco/images_pc/<ファイル名>）の一部
    const before: Record<string, string> = {
      'KICM-1641': '60a4e3bf248cf.jpg',
      'KICS-93477': '60a4e9efc6447.jpg',
      'KICS-93785': '60a4ef4278963.jpg',
      'KICS-4219': '68849999e9418.jpg',
      'KIXM-648': '695de76d73bde.jpg',
    };
    for (const [id, file] of Object.entries(before)) {
      const official = RELEASES.find((r) => r.id === id)!.jacketUrls.find((u) => u.includes('inoriminase.com'))!;
      expect(official.endsWith(`/${file}`), id).toBe(true);
    }
  });
});

describe('ジャケット画像（公開版：src/data/jackets.public.ts）', () => {
  it('画像URLを1つも持たず、配信元から取得しない', () => {
    expect(PublicJackets.JACKETS_FROM_SOURCES).toBe(false);
    expect(Object.keys(PublicJackets.JACKETS)).toHaveLength(0);
  });

  it('個人用版と同じ形の値を書き出している（ビルド時に差し替えても型が合う）', () => {
    expect(Object.keys(PublicJackets).sort()).toEqual(['JACKETS', 'JACKETS_FROM_SOURCES']);
    expect(Object.isFrozen(PublicJackets.JACKETS)).toBe(true);
  });
});
