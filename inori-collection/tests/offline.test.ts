import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JACKET_CACHE, UNAVAILABLE_KEY, UNAVAILABLE_RETRY_MS, prepareJackets, scanCached, summarize } from '../src/lib/offline';

/** Cache Storage の簡易モック */
function installCaches() {
  const store = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    const key = (r: RequestInfo | URL) => (typeof r === 'string' ? r : r instanceof URL ? r.href : r.url);
    return {
      match: async (r: RequestInfo | URL) => m.get(key(r)),
      put: async (r: RequestInfo | URL, res: Response) => void m.set(key(r), res),
      delete: async (r: RequestInfo | URL) => m.delete(key(r)),
      keys: async () => [...m.keys()].map((u) => new Request(u)),
    } as unknown as Cache;
  };
  vi.stubGlobal('caches', { open, keys: async () => [...store.keys()] });
  return store;
}

/** URL ごとの挙動：ok=画像を取得・表示できる / network=通信エラー / broken=取得できるが画像として表示できない */
type Behavior = 'ok' | 'network' | 'broken';
function installNetwork(behaviors: Record<string, Behavior>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    const b = behaviors[url] ?? 'network';
    if (b === 'network') throw new TypeError('Failed to fetch');
    return new Response('x', { status: 200 });
  });
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    set src(u: string) {
      if (!u) return;
      setTimeout(() => {
        if (behaviors[u] === 'ok') {
          this.naturalWidth = 100;
          this.onload?.();
        } else this.onerror?.();
      }, 0);
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return calls;
}

const T = (id: string, ...urls: string[]) => ({ id, jacketUrls: urls });

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('ジャケット画像のオフライン保存', () => {
  it('1つ目の候補を保存できればそれを使い、2つ目は取得しない', async () => {
    const store = installCaches();
    const calls = installNetwork({ 'https://king/a.jpg': 'ok', 'https://official/a.jpg': 'ok' });
    const r = await prepareJackets([T('A', 'https://king/a.jpg', 'https://official/a.jpg')], { onProgress: () => {}, isOnline: () => true });
    expect(r.states.A).toBe('cached');
    expect(calls).toEqual(['https://king/a.jpg']);
    expect([...store.get(JACKET_CACHE)!.keys()]).toEqual(['https://king/a.jpg']);
  });

  it('1つ目が取得できない（配信元の仕様変更など）ときは次の候補で保存する', async () => {
    installCaches();
    const calls = installNetwork({ 'https://king/a.jpg': 'network', 'https://official/a.jpg': 'ok' });
    const r = await prepareJackets([T('A', 'https://king/a.jpg', 'https://official/a.jpg')], { onProgress: () => {}, isOnline: () => true });
    expect(r.states.A).toBe('cached');
    expect(calls).toEqual(['https://king/a.jpg', 'https://official/a.jpg']);
  });

  it('取得できても画像として表示できない応答はキャッシュから消し、次の候補を試す', async () => {
    const store = installCaches();
    installNetwork({ 'https://king/a.jpg': 'broken', 'https://official/a.jpg': 'ok' });
    const r = await prepareJackets([T('A', 'https://king/a.jpg', 'https://official/a.jpg')], { onProgress: () => {}, isOnline: () => true });
    expect(r.states.A).toBe('cached');
    expect([...store.get(JACKET_CACHE)!.keys()]).toEqual(['https://official/a.jpg']);
  });

  it('オンラインで全候補が失敗したら「配信元で取得できない」として確定（準備完了の判定に含める）', async () => {
    installCaches();
    installNetwork({});
    const r = await prepareJackets([T('A', 'https://x/a.jpg', 'https://y/a.jpg'), T('B')], { onProgress: () => {}, isOnline: () => true });
    expect(r.states.A).toBe('unavailable');
    expect([r.cached, r.unavailable, r.pending, r.total]).toEqual([0, 2, 0, 2]);
  });

  it('オフラインで失敗した場合は「未保存」のまま（準備完了と誤認させない）', async () => {
    installCaches();
    installNetwork({});
    const r = await prepareJackets([T('A', 'https://x/a.jpg')], { onProgress: () => {}, isOnline: () => false });
    expect(r.states.A).toBe('pending');
    expect(r.pending).toBe(1);
  });

  it('保存済みの形態は再取得しない（どの候補で保存されていても保存済み）', async () => {
    installCaches();
    const first = installNetwork({ 'https://king/a.jpg': 'network', 'https://official/a.jpg': 'ok' });
    await prepareJackets([T('A', 'https://king/a.jpg', 'https://official/a.jpg')], { onProgress: () => {}, isOnline: () => true });
    expect(first).toHaveLength(2);
    const second = installNetwork({});
    const states = await scanCached([T('A', 'https://king/a.jpg', 'https://official/a.jpg')]);
    expect(states.A).toBe('cached');
    const r = await prepareJackets([T('A', 'https://king/a.jpg', 'https://official/a.jpg')], { onProgress: () => {}, isOnline: () => true });
    expect(r.states.A).toBe('cached');
    expect(second).toHaveLength(0);
  });

  it('進捗が段階的に通知される', async () => {
    installCaches();
    installNetwork({ 'https://k/1.jpg': 'ok', 'https://k/2.jpg': 'ok' });
    const seen: number[] = [];
    await prepareJackets([T('1', 'https://k/1.jpg'), T('2', 'https://k/2.jpg')], {
      onProgress: (p) => seen.push(p.cached),
      isOnline: () => true,
      concurrency: 1,
    });
    expect(seen).toEqual([0, 1, 2]);
  });

  it('Cache API がない環境では何もせず未保存扱い', async () => {
    vi.stubGlobal('caches', undefined);
    const r = await prepareJackets([T('A', 'https://x/a.jpg')], { onProgress: () => {}, isOnline: () => true });
    expect(r.states.A).toBe('pending');
  });

  it('summarize：候補のない形態は最初から「取得できない」扱い', () => {
    const r = summarize([T('A'), T('B', 'u')], {});
    expect([r.cached, r.unavailable, r.pending]).toEqual([0, 1, 1]);
  });

  it('「取得できなかった」記録は再起動後も保持され、オフラインでも準備完了の判定に使われる', async () => {
    installCaches();
    installNetwork({ 'https://k/ok.jpg': 'ok' });
    const targets = [T('OK', 'https://k/ok.jpg'), T('NG', 'https://k/ng.jpg', 'https://o/ng.jpg')];
    await prepareJackets(targets, { onProgress: () => {}, isOnline: () => true });
    expect(JSON.parse(localStorage.getItem(UNAVAILABLE_KEY)!).NG.urls).toBe('https://k/ng.jpg|https://o/ng.jpg');
    // 再起動（オフライン）：保存済み＋取得不可で確定
    const r = summarize(targets, await scanCached(targets));
    expect([r.cached, r.unavailable, r.pending]).toEqual([1, 1, 0]);
  });

  it('記録が新しいうちは自動で再試行しない（毎回の起動で通信しない）、24時間たつか再試行ボタンで再試行する', async () => {
    installCaches();
    installNetwork({});
    const targets = [T('NG', 'https://k/ng.jpg')];
    let t = 1_000_000;
    await prepareJackets(targets, { onProgress: () => {}, isOnline: () => true, now: () => t });
    const calls1 = installNetwork({});
    await prepareJackets(targets, { onProgress: () => {}, isOnline: () => true, now: () => t + 1000 });
    expect(calls1).toHaveLength(0);
    const calls2 = installNetwork({});
    await prepareJackets(targets, { onProgress: () => {}, isOnline: () => true, now: () => t + 1000, retryUnavailable: true });
    expect(calls2).toHaveLength(1);
    t += UNAVAILABLE_RETRY_MS + 1;
    const calls3 = installNetwork({ 'https://k/ng.jpg': 'ok' });
    const r = await prepareJackets(targets, { onProgress: () => {}, isOnline: () => true, now: () => t + 2000 });
    expect(calls3).toHaveLength(1);
    expect(r.states.NG).toBe('cached');
    expect(JSON.parse(localStorage.getItem(UNAVAILABLE_KEY)!).NG).toBeUndefined();
  });

  it('候補URLが変わった（作品データ更新）ら記録は無効になり再試行する', async () => {
    installCaches();
    installNetwork({});
    await prepareJackets([T('X', 'https://k/old.jpg')], { onProgress: () => {}, isOnline: () => true });
    const states = await scanCached([T('X', 'https://k/new.jpg')]);
    expect(states.X).toBe('pending');
  });
});
