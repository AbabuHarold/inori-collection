/**
 * ジャケット画像のオフライン保存
 *
 * 画像ファイルはアプリに同梱・再配布せず、公式配信元（キングレコード公式サイト・水瀬いのり公式サイト）の
 * URL を参照する。一度読み込んだ画像は、この端末のブラウザ内キャッシュ（Cache Storage）にだけ保存し、
 * Service Worker がオフライン時にそこから表示する。
 *
 * 1形態につき画像URLの候補を複数持てる（先頭から順に試す）。配信元の仕様変更などで
 * 1つ目が取得できなくなっても、次の候補で表示を続けられる。
 *
 * 配信元はCORSに対応していないため「opaque」レスポンスとして保存される。
 * 中身を直接検査できないので、保存後に <img> として実際に表示できるかで確認する。
 */
export const JACKET_CACHE = 'inori-jackets-v1';
/** 配信元から取得できなかった形態の記録（所持データとは別キー。消えても再試行するだけで害はない） */
export const UNAVAILABLE_KEY = 'inori-collection/jacket-unavailable';
/** 取得できなかった画像を自動で再試行する間隔 */
export const UNAVAILABLE_RETRY_MS = 24 * 60 * 60 * 1000;

type UnavailableLog = Record<string, { urls: string; at: number }>;

function readUnavailable(): UnavailableLog {
  try {
    const raw = globalThis.localStorage?.getItem(UNAVAILABLE_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? (o as UnavailableLog) : {};
  } catch {
    return {};
  }
}

function writeUnavailable(log: UnavailableLog) {
  try {
    globalThis.localStorage?.setItem(UNAVAILABLE_KEY, JSON.stringify(log));
  } catch {
    /* 保存できなくても次回再試行するだけ */
  }
}

export interface JacketTarget {
  id: string;
  jacketUrls: readonly string[];
}

/** 各形態の画像準備状況 */
export type JacketState =
  /** いずれかの候補が端末内に保存済み（オフラインでも表示できる） */
  | 'cached'
  /** オンラインで全候補を試したが、配信元から画像を取得できなかった（プレースホルダー表示） */
  | 'unavailable'
  /** 未保存（未試行、または通信できなかった） */
  | 'pending';

export interface JacketReport {
  states: Record<string, JacketState>;
  cached: number;
  unavailable: number;
  pending: number;
  total: number;
}

export function summarize(targets: readonly JacketTarget[], states: Record<string, JacketState>): JacketReport {
  let cached = 0;
  let unavailable = 0;
  let pending = 0;
  for (const t of targets) {
    const s = states[t.id] ?? (t.jacketUrls.length === 0 ? 'unavailable' : 'pending');
    if (s === 'cached') cached++;
    else if (s === 'unavailable') unavailable++;
    else pending++;
  }
  return { states, cached, unavailable, pending, total: targets.length };
}

export function cacheApiAvailable(): boolean {
  return typeof caches !== 'undefined' && typeof caches.open === 'function';
}

/**
 * 端末内に保存済みの形態を調べる（候補のどれか1つが保存されていれば保存済み）。
 * 保存されていない形態のうち、前回「配信元から取得できなかった」と記録したもの（候補URLが同じもの）は 'unavailable'。
 */
export async function scanCached(targets: readonly JacketTarget[]): Promise<Record<string, JacketState>> {
  const states: Record<string, JacketState> = {};
  const log = readUnavailable();
  for (const t of targets) {
    if (t.jacketUrls.length === 0) states[t.id] = 'unavailable';
    else states[t.id] = log[t.id]?.urls === t.jacketUrls.join('|') ? 'unavailable' : 'pending';
  }
  if (!cacheApiAvailable()) return states;
  try {
    const cache = await caches.open(JACKET_CACHE);
    await Promise.all(
      targets.map(async (t) => {
        for (const u of t.jacketUrls) {
          if (await cache.match(u)) {
            states[t.id] = 'cached';
            return;
          }
        }
      }),
    );
  } catch {
    /* 取得できなければ未保存扱い */
  }
  return states;
}

function loadImage(url: string, timeoutMs = 20000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = '';
      resolve(false);
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth > 0);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.src = url;
  });
}

/** 1つのURLを取得して保存し、画像として表示できるか確認する。表示できなければキャッシュから消す */
async function fetchAndVerify(cache: Cache, url: string, signal?: AbortSignal): Promise<'ok' | 'bad' | 'network'> {
  let res: Response;
  try {
    res = await fetch(url, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal });
  } catch {
    // ネットワークエラー（オフライン、または配信元がHTMLの404を返して読み込みを拒否された場合）
    return 'network';
  }
  if (!(res.type === 'opaque' || res.ok)) return 'bad';
  try {
    await cache.put(url, res);
  } catch {
    return 'network'; // 容量不足など
  }
  const ok = await loadImage(url);
  if (!ok) await cache.delete(url).catch(() => false);
  return ok ? 'ok' : 'bad';
}

export interface PrepareOptions {
  onProgress: (report: JacketReport) => void;
  signal?: AbortSignal;
  /** 同時に処理する形態数 */
  concurrency?: number;
  /** テスト用：オンライン判定 */
  isOnline?: () => boolean;
  /** true なら「取得できなかった」と記録済みの形態も再試行する（設定画面の再試行ボタン） */
  retryUnavailable?: boolean;
  /** テスト用：現在時刻 */
  now?: () => number;
}

/**
 * 未保存のジャケット画像をダウンロードしてキャッシュに保存する。
 * 既に保存済みの形態は再ダウンロードしない。
 */
export async function prepareJackets(targets: readonly JacketTarget[], opts: PrepareOptions): Promise<JacketReport> {
  const isOnline = opts.isOnline ?? (() => navigator.onLine);
  const states = await scanCached(targets);
  const emit = () => opts.onProgress(summarize(targets, { ...states }));
  emit();
  if (!cacheApiAvailable()) return summarize(targets, states);
  const cache = await caches.open(JACKET_CACHE);
  const now = opts.now ?? Date.now;
  const log = readUnavailable();
  const queue = targets.filter((t) => {
    if (t.jacketUrls.length === 0) return false;
    if (states[t.id] === 'pending') return true;
    if (states[t.id] === 'unavailable') {
      // 記録から一定時間たったら自動で再確認（配信元の復旧に追従する）
      return opts.retryUnavailable || now() - (log[t.id]?.at ?? 0) > UNAVAILABLE_RETRY_MS;
    }
    return false;
  });

  const queueTried = new Set<string>();
  const worker = async () => {
    while (queue.length > 0) {
      if (opts.signal?.aborted) return;
      const t = queue.shift()!;
      queueTried.add(t.id);
      let result: JacketState = 'pending';
      let sawNetworkError = false;
      for (const url of t.jacketUrls) {
        const r = await fetchAndVerify(cache, url, opts.signal);
        if (r === 'ok') {
          result = 'cached';
          break;
        }
        if (r === 'network') sawNetworkError = true;
      }
      if (result !== 'cached') {
        // オンラインなのに全候補が失敗 → 配信元で取得できない画像として扱う
        // （配信元がHTMLの404を返す場合もブラウザ上は通信エラーに見えるため、オンライン状態で判定する）
        result = isOnline() || !sawNetworkError ? 'unavailable' : 'pending';
      }
      states[t.id] = result;
      emit();
    }
  };
  const n = Math.max(1, opts.concurrency ?? 4);
  await Promise.all(Array.from({ length: n }, () => worker()));
  // 取得できなかった形態を記録（保存できた形態は記録から消す）
  const nextLog = readUnavailable();
  for (const t of targets) {
    if (states[t.id] === 'unavailable' && t.jacketUrls.length > 0) {
      const prev = nextLog[t.id];
      const urls = t.jacketUrls.join('|');
      // 今回試していない（記録が新しい）ものは記録時刻を据え置く
      if (!prev || prev.urls !== urls || queueTried.has(t.id)) nextLog[t.id] = { urls, at: now() };
    } else delete nextLog[t.id];
  }
  writeUnavailable(nextLog);
  return summarize(targets, states);
}

/** 画像の表示に失敗したとき、壊れたキャッシュを消して次回オンライン時に取り直せるようにする */
export async function forgetJacket(url: string): Promise<void> {
  if (!cacheApiAvailable()) return;
  try {
    const cache = await caches.open(JACKET_CACHE);
    await cache.delete(url);
  } catch {
    /* 何もしない */
  }
}

/** アプリ本体（HTML/JS/CSS）がオフライン用に保存済みか */
export async function appShellReady(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.active) return false;
    if (!cacheApiAvailable()) return false;
    const keys = await caches.keys();
    const precache = keys.find((k) => k.includes('precache'));
    if (!precache) return false;
    const cache = await caches.open(precache);
    const reqs = await cache.keys();
    return reqs.some((r) => r.url.includes('index.html'));
  } catch {
    return false;
  }
}
