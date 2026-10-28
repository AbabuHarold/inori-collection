import { describe, expect, it } from 'vitest';
import { RELEASES, MASTER_VERSION, editionLabel } from '../src/data/releases';
import { isValidId } from '../src/lib/collection';

/** v1.0.0（34形態）で公開済みのID。所持データ・バックアップのキーなので、以後のバージョンでも必ず残す */
const V1_IDS = [
  'KICM-1641', 'KICM-1662', 'KICM-1726', 'KICM-1783', 'KICM-1817', 'KICM-1890', 'KICM-1914', 'KICM-2029', 'KICM-2065',
  'KICM-2092', 'KICM-2128', 'KICM-2138', 'KICM-2174', 'KICS-3477', 'KICS-93710', 'KICS-3710', 'KICS-3785', 'KICS-94059',
  'KICS-4059', 'KICS-94166', 'KICS-4166', 'KICS-94217', 'KICS-4217', 'KICS-94219', 'KICS-4219', 'KIXM-315', 'KIXM-340',
  'KIXM-398', 'KIXM-449', 'KIXM-493', 'KIXM-536', 'KIXM-578', 'KIXM-618', 'KIXM-648',
];

describe('作品マスターデータの整合性', () => {
  it('件数：29作品・36形態（シングル13 / アルバム7作品14形態 / ライブBlu-ray9）', () => {
    expect(RELEASES).toHaveLength(36);
    expect(new Set(RELEASES.map((r) => r.workKey)).size).toBe(29);
    const by = (c: string) => RELEASES.filter((r) => r.category === c);
    expect(by('single')).toHaveLength(13);
    expect(by('album')).toHaveLength(14);
    expect(new Set(by('album').map((r) => r.workKey)).size).toBe(7);
    expect(by('bluray')).toHaveLength(9);
  });

  it('アルバムは全7作品が「初回限定盤」「通常盤」の2形態ずつ', () => {
    const albums = RELEASES.filter((r) => r.category === 'album');
    const byWork = new Map<string, string[]>();
    for (const r of albums) byWork.set(r.workKey, [...(byWork.get(r.workKey) ?? []), r.edition ?? '']);
    for (const [work, eds] of byWork) expect(eds.sort(), work).toEqual(['初回限定盤', '通常盤']);
  });

  it('v1.0.0 で公開済みの34形態のIDがすべて残っている（既存の所持データ・バックアップとの互換性）', () => {
    const ids = new Set(RELEASES.map((r) => r.id));
    for (const id of V1_IDS) expect(ids.has(id), id).toBe(true);
  });

  it('v1.1.0 で追加した2形態（公式サイトで確認）', () => {
    const inn = RELEASES.find((r) => r.id === 'KICS-93477')!;
    expect(inn).toMatchObject({
      title: 'Innocent flower', category: 'album', releaseDate: '2017-04-05', edition: '初回限定盤', format: 'CD+BD',
      catalogNumber: 'KICS-93477', officialUrl: 'https://www.inoriminase.com/discography/?category_id=2&id=4',
    });
    const ctr = RELEASES.find((r) => r.id === 'KICS-93785')!;
    expect(ctr).toMatchObject({
      title: 'Catch the Rainbow！', category: 'album', releaseDate: '2019-04-10', edition: '初回限定盤', format: 'CD+BD',
      catalogNumber: 'KICS-93785', officialUrl: 'https://www.inoriminase.com/discography/?category_id=2&id=37',
    });
    // 同じ作品の通常盤と同じ workKey でまとまっている
    expect(inn.workKey).toBe(RELEASES.find((r) => r.id === 'KICS-3477')!.workKey);
    expect(ctr.workKey).toBe(RELEASES.find((r) => r.id === 'KICS-3785')!.workKey);
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

  it('全形態に公式サイトの作品詳細URLがあり、作品ごとに異なる', () => {
    const byWork = new Map<string, string>();
    for (const r of RELEASES) {
      expect(r.officialUrl, r.id).toMatch(/^https:\/\/www\.inoriminase\.com\/discography\/\?(category_id=\d&)?id=\d+$/);
      byWork.set(r.workKey, r.officialUrl!);
    }
    expect(new Set(byWork.values()).size).toBe(byWork.size);
  });

  it('ジャケット画像：全形態に候補があり、候補はすべて公式配信元のURL', () => {
    for (const r of RELEASES) {
      expect(r.jacketUrls.length, r.id).toBeGreaterThan(0);
      for (const u of r.jacketUrls) {
        expect(u, r.id).toMatch(
          /^https:\/\/(www\.kingrecords\.co\.jp\/img\/goods\/[A-Za-z0-9]+\/[\w-]+\.jpg|www\.inoriminase\.com\/img\/disco\/images_pc\/[0-9a-f]+\.jpe?g)$/,
        );
      }
    }
  });

  it('ジャケット画像：同じURLが別の形態に使われていない（取り違え・重複登録の検出）', () => {
    const seen = new Map<string, string>();
    for (const r of RELEASES) {
      for (const u of r.jacketUrls) {
        expect(seen.get(u), `${u} が ${seen.get(u)} と ${r.id} で重複`).toBeUndefined();
        seen.set(u, r.id);
      }
    }
  });

  it('ジャケット画像：キングレコードを優先し、公式サイトの画像を予備にする（初回限定盤2形態は公式のみ）', () => {
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

  it('補助確認元はキングレコード公式の商品ページ（掲載のない2形態は null）', () => {
    for (const r of RELEASES) {
      if (r.id === 'KICS-93477' || r.id === 'KICS-93785') expect(r.sourceUrl).toBeNull();
      else expect(r.sourceUrl, r.id).toMatch(/^https:\/\/www\.kingrecords\.co\.jp\/cs\/g\/g[A-Z]+-\d+\/$/);
    }
    expect(MASTER_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
  });

  it('対象外の商品（配信・他名義ライブ・MV集）が混入していない', () => {
    const ids = RELEASES.map((r) => r.id);
    for (const excluded of ['KIXM-292', 'KIXM-379', 'KIXM-627', 'NOPA-7311', 'NOPA-8359', 'NOPV-763']) {
      expect(ids).not.toContain(excluded);
    }
  });
});
