// v1.0.0 時点のバックアップ形式（schemaVersion 1）のサンプルZIPを生成する。
// このファイルは「古いバックアップを将来のバージョンでも読めるか」の互換性テストに使うため、
// 一度生成したら内容を変更しないこと（形式を変えた場合は新しいフィクスチャを追加する）。
// 実行: node tests/fixtures/make-fixture.mjs
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

const payload = {
  format: 'inori-collection-backup',
  schemaVersion: 1,
  createdAt: '2026-10-28T03:00:00.000Z',
  app: { name: 'Inori Collection', masterVersion: '2026-10-28' },
  collection: {
    'KICM-1641': { unopened: 1, opened: 2 },
    'KICS-93710': { unopened: 1, opened: 0 },
    'KIXM-648': { unopened: 0, opened: 1 },
    // 現在のマスターに存在しないID（復元時に破棄されず保持されることの確認用）
    'KICS-93477': { unopened: 1, opened: 0 },
  },
  settings: { view: 'list', category: 'all', owned: 'owned', open: 'all', query: '', sort: 'dateDesc' },
  summary: { forms: 4, unopened: 3, opened: 3 },
};

const zip = new JSZip();
zip.file('inori-collection-backup.json', JSON.stringify(payload, null, 2), { date: new Date(payload.createdAt) });
const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(new URL('./backup-v1-sample.zip', import.meta.url), out);
console.log('wrote backup-v1-sample.zip', out.length, 'bytes');
