// E2Eテスト用の最小静的サーバー（配信ディレクトリを途中で切り替えて「アプリ更新」を再現できる）
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer(rootDir, port = 4173) {
  let root = resolve(rootDir);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      let file = join(root, p);
      if (!file.startsWith(root)) throw new Error('bad path');
      let s = await stat(file).catch(() => null);
      if (!s || s.isDirectory()) {
        file = join(root, 'index.html'); // SPA フォールバック
      }
      const body = await readFile(file);
      const headers = { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' };
      // Vercel の設定（vercel.json）と同じキャッシュ方針
      if (file.endsWith('sw.js') || file.endsWith('index.html') || file.endsWith('.webmanifest')) headers['Cache-Control'] = 'no-cache';
      else if (file.includes('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((ok) =>
    server.listen(port, () =>
      ok({
        url: `http://localhost:${port}`,
        setRoot: (d) => (root = resolve(d)),
        close: () => new Promise((r) => server.close(r)),
      }),
    ),
  );
}
