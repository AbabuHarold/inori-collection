// ジャケット画像URLが現在有効かを、実際の配信元に問い合わせて確認する（保守用）。
// 実行: npm run check:images
//
// 各形態の画像候補（キングレコード → 水瀬いのり公式サイト）を順に取得し、
// 「画像（image/*）が返るか」を確認して一覧表示する。少なくとも1つの候補が有効なら表示可能。
// 対象は個人用版の画像一覧（src/data/jackets.ts）。公開版は画像を取得しないため確認は不要。
import { RELEASES } from '../src/data/releases.ts';

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
let usable = 0;
const problems = [];

for (const r of RELEASES) {
  const results = [];
  for (const url of r.jacketUrls) {
    let status = 'ERR';
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'InoriCollection-ImageCheck/1.0' } });
      const type = res.headers.get('content-type') ?? '';
      const len = (await res.arrayBuffer()).byteLength;
      status = res.ok && type.startsWith('image/') ? `OK ${type} ${len}B` : `NG ${res.status} ${type}`;
    } catch (e) {
      status = `ERR ${e.cause?.code ?? e.message}`;
    }
    results.push({ url, status });
  }
  const ok = results.some((x) => x.status.startsWith('OK'));
  if (ok) usable++;
  else problems.push(r);
  const host = (u) => (u.includes('kingrecords') ? 'King' : 'Official');
  console.log(`${ok ? '✔' : '✘'} ${pad(r.id, 11)} ${pad(r.title + ' ' + (r.edition ?? ''), 48)} ${results.map((x) => `${host(x.url)}:${x.status.split(' ')[0]}`).join('  ')}`);
}

console.log(`\n表示可能 ${usable} / ${RELEASES.length} 形態`);
if (problems.length) {
  console.log('画像を取得できない形態（アプリではCDアイコンを表示します）:');
  for (const r of problems) console.log(`  - ${r.id} ${r.title} ${r.edition ?? ''}`);
}
