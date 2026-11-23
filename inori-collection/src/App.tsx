import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { MASTER_VERSION, RELEASES, editionLabel } from './data/releases';
import type { Release } from './data/types';
import {
  type Collection,
  type CountField,
  type Holding,
  type Settings,
  DEFAULT_SETTINGS,
  applyDelta,
  computeStats,
  filterAndSort,
  getHolding,
  isDefaultFilter,
  orphanIds,
  setHolding,
} from './lib/collection';
import { KEYS, countCorrupted, loadCollection, loadSettings, requestPersistentStorage, saveCollection, saveSettings } from './lib/storage';
import { BackupError, type ParsedBackup, LIMITS, backupFileName, buildBackupPayload, createBackupZip, parseBackupZip } from './lib/backup';
import { type JacketReport, type JacketState, appShellReady, cacheApiAvailable, prepareJackets, scanCached, summarize } from './lib/offline';
import {
  type UserJacket,
  UserJacketError,
  deleteUserJacket,
  listUserJackets,
  onUserJacketsChangedElsewhere,
  putUserJacket,
  replaceAllUserJackets,
  totalBytes,
  userJacketsSupported,
} from './lib/userJackets';
import { ImageProcessError, processUserImage } from './lib/imageProcess';
import { EDITION } from './edition';
import { ReleaseCard, ReleaseRow } from './components/ReleaseItem';
import { DetailSheet, type UserJacketAvailability } from './components/DetailSheet';
import { StatsPanel } from './components/StatsPanel';
import { Toolbar } from './components/Toolbar';
import { Banner, Modal, UndoToast } from './components/Overlay';
import { type OfflineStatus, SettingsSheet, offlineSummary } from './components/SettingsSheet';
import { IconCheck, IconCloudOff, IconDisc, IconSettings } from './components/Icons';

declare const __APP_VERSION__: string;

type UndoEntry =
  | { kind: 'count'; id: string; before: Holding }
  /** 自分で設定したジャケット画像の変更（before が null なら変更前は未設定） */
  | { kind: 'jacket'; id: string; before: UserJacket | null }
  /** beforeJackets が null なら、復元で画像は変更していない */
  | { kind: 'restore'; beforeCollection: Collection; beforeSettings: Settings; beforeJackets: UserJacket[] | null };

interface Toast {
  message: string;
  undoable: boolean;
}

const FIELD_LABEL: Record<CountField, string> = { unopened: '未開封', opened: '開封済' };
const RELEASE_BY_ID = new Map<string, Release>(RELEASES.map((r) => [r.id, r]));
/** 配信元から画像を取得する形態（公開版では空＝何も取得しない） */
const JACKET_TARGETS = RELEASES.filter((r) => r.jacketUrls.length > 0).map((r) => ({ id: r.id, jacketUrls: r.jacketUrls }));
const TITLE_OF = (id: string) => {
  const r = RELEASE_BY_ID.get(id);
  return r ? `${r.title}（${editionLabel(r)}）` : id;
};
const UNDO_LIMIT = 50;

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type UserJacketMap = ReadonlyMap<string, UserJacket>;

/** 端末内に保存した画像を <img> で表示するための object URL を、画像が変わったときだけ作り直す */
function useObjectUrls(jackets: UserJacketMap): Readonly<Record<string, string>> {
  const cache = useRef(new Map<string, { jacket: UserJacket; url: string }>());
  const urls = useMemo(() => {
    const out: Record<string, string> = {};
    const next = new Map<string, { jacket: UserJacket; url: string }>();
    for (const [id, j] of jackets) {
      const prev = cache.current.get(id);
      const entry = prev && prev.jacket === j ? prev : { jacket: j, url: URL.createObjectURL(new Blob([j.data], { type: j.type })) };
      next.set(id, entry);
      out[id] = entry.url;
    }
    // 使わなくなった URL は少し待ってから解放する（表示の切り替え中に消えないように）
    const stale = [...cache.current.values()].filter((e) => next.get(e.jacket.id)?.url !== e.url).map((e) => e.url);
    if (stale.length) window.setTimeout(() => stale.forEach((u) => URL.revokeObjectURL(u)), 10_000);
    cache.current = next;
    return out;
  }, [jackets]);
  // 画面（App）は閉じるまで表示し続けるので、アンマウント時の一括解放はしない
  // （開発時の StrictMode の仮アンマウントで、表示中の URL まで解放されてしまうため）
  return urls;
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof UserJacketError || e instanceof ImageProcessError || e instanceof BackupError ? e.message : fallback;
}

function formatDateTime(d: Date | null): string {
  if (!d) return '不明';
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  // ───────────── 所持データ ─────────────
  const initial = useMemo(() => loadCollection(), []);
  const [collection, setCollection] = useState<Collection>(initial.collection);
  const collectionRef = useRef(collection);
  const blockSavesRef = useRef(initial.blockSaves);
  const [blockSaves, setBlockSaves] = useState(initial.blockSaves);
  const rawCorruptRef = useRef(initial.rawCorrupt);
  const [loadIssues, setLoadIssues] = useState<string[]>(initial.issues);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** 画面に反映して自動保存する。保存に失敗しても画面の状態は保ち、ユーザーに通知する */
  const commit = useCallback((next: Collection) => {
    collectionRef.current = next;
    setCollection(next);
    if (blockSavesRef.current) {
      setSaveError('保存データ保護のため自動保存を停止中です。この変更は保存されていません。');
      return;
    }
    const r = saveCollection(next);
    setSaveError(r.ok ? null : `${r.message}この変更は保存されていません。`);
  }, []);

  // ───────────── 表示設定 ─────────────
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    const r = saveSettings(settings);
    if (!r.ok) setSaveError(`${r.message}（表示設定）`);
  }, [settings]);
  const updateSettings = useCallback((patch: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...patch })), []);
  const resetFilters = useCallback(
    () => setSettings((prev) => ({ ...prev, category: DEFAULT_SETTINGS.category, owned: 'all', open: 'all', query: '' })),
    [],
  );

  // ───────────── 自分で設定したジャケット画像 ─────────────
  const [userJackets, setUserJackets] = useState<UserJacketMap>(() => new Map());
  const userJacketsRef = useRef<UserJacketMap>(userJackets);
  const [jacketAvailability, setJacketAvailability] = useState<UserJacketAvailability>(() =>
    userJacketsSupported() ? 'loading' : 'unsupported',
  );
  const setJacketMap = useCallback((m: UserJacketMap) => {
    userJacketsRef.current = m;
    setUserJackets(m);
  }, []);
  const reloadUserJackets = useCallback(async () => {
    if (!userJacketsSupported()) return;
    try {
      const list = await listUserJackets();
      setJacketMap(new Map(list.map((j) => [j.id, j])));
      setJacketAvailability('ready');
    } catch {
      setJacketAvailability('unsupported');
    }
  }, [setJacketMap]);
  useEffect(() => {
    void reloadUserJackets();
    return onUserJacketsChangedElsewhere(() => void reloadUserJackets());
  }, [reloadUserJackets]);
  const userJacketUrls = useObjectUrls(userJackets);
  const userJacketBytes = useMemo(() => totalBytes(userJackets.values()), [userJackets]);

  // ───────────── 元に戻す ─────────────
  const undoStack = useRef<UndoEntry[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string, undoable: boolean, ms = 6000) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, undoable });
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      undoStack.current = [];
    }, ms);
  }, []);
  const closeToast = useCallback(() => {
    window.clearTimeout(toastTimer.current);
    setToast(null);
    undoStack.current = [];
  }, []);

  const changeCount = useCallback(
    (id: string, field: CountField, delta: 1 | -1) => {
      const cur = collectionRef.current;
      const next = applyDelta(cur, id, field, delta);
      if (!next) return;
      const before = getHolding(cur, id);
      undoStack.current.push({ kind: 'count', id, before });
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      commit(next);
      const r = RELEASE_BY_ID.get(id);
      const after = getHolding(next, id)[field];
      showToast(`「${r?.title ?? id}」${r ? `（${editionLabel(r)}）` : ''} ${FIELD_LABEL[field]} ${before[field]}→${after}枚`, true);
    },
    [commit, showToast],
  );

  /** 1形態の画像を保存（next が null なら削除）して画面に反映する。失敗したら例外 */
  const writeUserJacket = useCallback(
    async (id: string, next: UserJacket | null) => {
      if (next) await putUserJacket(next);
      else await deleteUserJacket(id);
      const m = new Map(userJacketsRef.current);
      if (next) m.set(id, next);
      else m.delete(id);
      setJacketMap(m);
    },
    [setJacketMap],
  );

  const undo = useCallback(() => {
    const e = undoStack.current.pop();
    if (!e) return;
    const remaining = undoStack.current.length;
    const done = () => showToast(remaining > 0 ? `元に戻しました（あと${remaining}回戻せます）` : '元に戻しました', remaining > 0);
    if (e.kind === 'count') {
      commit(setHolding(collectionRef.current, e.id, e.before));
      done();
    } else if (e.kind === 'jacket') {
      writeUserJacket(e.id, e.before).then(done, (err) => showToast(errorMessage(err, '画像を元に戻せませんでした。'), false, 8000));
    } else {
      commit(e.beforeCollection);
      setSettings(e.beforeSettings);
      if (e.beforeJackets) {
        const before = e.beforeJackets;
        replaceAllUserJackets(before).then(
          () => {
            setJacketMap(new Map(before.map((j) => [j.id, j])));
            done();
          },
          (err) => showToast(errorMessage(err, '画像を元に戻せませんでした。'), false, 8000),
        );
      } else done();
    }
  }, [commit, showToast, writeUserJacket, setJacketMap]);

  // ───────────── 作品の詳細・ジャケット画像の設定 ─────────────
  const [detailId, setDetailId] = useState<string | null>(null);
  const [jacketBusy, setJacketBusy] = useState(false);
  const [jacketError, setJacketError] = useState<string | null>(null);
  const openDetail = useCallback((id: string) => {
    setJacketError(null);
    setDetailId(id);
  }, []);
  const closeDetail = useCallback(() => setDetailId(null), []);

  const changeUserJacket = useCallback(
    async (id: string, file: File | null) => {
      setJacketError(null);
      setJacketBusy(true);
      try {
        const before = userJacketsRef.current.get(id) ?? null;
        const next = file ? await processUserImage(file, id) : null;
        await writeUserJacket(id, next);
        undoStack.current.push({ kind: 'jacket', id, before });
        if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
        showToast(`「${TITLE_OF(id)}」の画像を${next ? '設定' : '削除'}しました`, true);
        if (!next) setDetailId(null);
      } catch (e) {
        setJacketError(errorMessage(e, '画像を保存できませんでした。'));
      } finally {
        setJacketBusy(false);
      }
    },
    [writeUserJacket, showToast],
  );

  // ───────────── 他のタブで変更されたときの同期 ─────────────
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEYS.collection) {
        const r = loadCollection();
        collectionRef.current = r.collection;
        setCollection(r.collection);
        undoStack.current = [];
        setToast(null);
      } else if (e.key === KEYS.settings) {
        setSettings(loadSettings());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ───────────── 端末の保存領域の保護 ─────────────
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void requestPersistentStorage().then(setPersisted);
  }, []);

  // ───────────── PWA / オフライン ─────────────
  const [online, setOnline] = useState(() => navigator.onLine);
  const [appShell, setAppShell] = useState(false);
  const [jackets, setJackets] = useState<JacketReport>(() => summarize(JACKET_TARGETS, {}));
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);

  const refreshAppShell = useCallback(() => {
    void appShellReady().then(setAppShell);
  }, []);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => refreshAppShell();
      if (reg.active) check();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'activated') check();
        });
      });
      // 長時間開きっぱなしでも更新に気付けるよう、1時間ごとに確認
      setInterval(() => {
        if (navigator.onLine) void reg.update().catch(() => {});
      }, 60 * 60 * 1000);
    },
    onOfflineReady() {
      refreshAppShell();
    },
  });

  /**
   * 「更新する」：待機中の新しい Service Worker を有効にして画面を読み込み直す。
   * プラグイン標準の再読み込みは「起動時に既に Service Worker が動いていた画面」でしか働かず、
   * 初回インストール直後の画面で更新が来た場合に画面が切り替わらないため、制御の切り替わりを自分で検知する。
   */
  const applyUpdate = useCallback(() => {
    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker?.addEventListener('controllerchange', reload, { once: true });
    void updateServiceWorker(false);
    // 念のため：切り替わりが検知できなかった場合も数秒後に読み込み直す（データは端末内に保存済みなので安全）
    window.setTimeout(reload, 5000);
  }, [updateServiceWorker]);

  const runPrepare = useCallback(async (retryUnavailable = false) => {
    if (preparingRef.current || !cacheApiAvailable()) return;
    preparingRef.current = true;
    setPreparing(true);
    try {
      const res = await prepareJackets(JACKET_TARGETS, { onProgress: setJackets, retryUnavailable });
      setJackets(res);
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const needsWork = (states: Record<string, string>) => Object.values(states).some((s) => s !== 'cached');
    void scanCached(JACKET_TARGETS).then((states) => {
      if (cancelled) return;
      setJackets(summarize(JACKET_TARGETS, states));
      // 最初の画面表示を優先し、少し待ってから未保存の画像だけ保存する
      if (needsWork(states) && navigator.onLine) {
        window.setTimeout(() => void runPrepare(), 1500);
      }
    });
    refreshAppShell();
    const onOnline = () => {
      setOnline(true);
      void scanCached(JACKET_TARGETS).then((states) => {
        if (needsWork(states)) void runPrepare();
      });
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    navigator.serviceWorker?.addEventListener('controllerchange', refreshAppShell);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      navigator.serviceWorker?.removeEventListener('controllerchange', refreshAppShell);
    };
  }, [runPrepare, refreshAppShell]);

  // 自分で画像を設定した形態は、配信元の画像がなくても端末内に画像がある（オフラインで表示できる）
  const effectiveJackets = useMemo(() => {
    if (userJackets.size === 0) return jackets;
    const states: Record<string, JacketState> = { ...jackets.states };
    for (const t of JACKET_TARGETS) if (userJackets.has(t.id)) states[t.id] = 'cached';
    return summarize(JACKET_TARGETS, states);
  }, [jackets, userJackets]);

  const offlineStatus: OfflineStatus = {
    online,
    swSupported: 'serviceWorker' in navigator,
    cacheSupported: cacheApiAvailable(),
    appShell,
    jacketsCached: effectiveJackets.cached,
    jacketsUnavailable: effectiveJackets.unavailable,
    jacketsTotal: effectiveJackets.total,
    unavailableTitles: JACKET_TARGETS.filter((t) => effectiveJackets.states[t.id] === 'unavailable').map((t) => TITLE_OF(t.id)),
    preparing,
  };
  const offlineInfo = offlineSummary(offlineStatus);
  /** ヘッダー用の短い表示（詳細は設定画面） */
  const pillText =
    offlineInfo.state === 'ready'
      ? 'オフラインOK'
      : offlineInfo.state === 'partial'
        ? `画像なし${effectiveJackets.unavailable}件`
        : !online
          ? 'オフライン'
          : preparing
            ? `準備中 ${effectiveJackets.cached + effectiveJackets.unavailable}/${effectiveJackets.total}`
            : 'オフライン未準備';

  // ───────────── バックアップ ─────────────
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{ parsed: ParsedBackup; fileName: string } | null>(null);
  const canShareFiles = useMemo(() => {
    try {
      const f = new File([new Uint8Array([0])], 'a.zip', { type: 'application/zip' });
      return typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] });
    } catch {
      return false;
    }
  }, []);

  const createBackup = useCallback(
    async (mode: 'download' | 'share') => {
      setBackupBusy(true);
      try {
        // 画像の保存領域を使えない端末では「画像の情報なし」として作成する（復元先の画像を消さないため）
        const list = jacketAvailability === 'ready' ? [...userJacketsRef.current.values()] : null;
        const payload = buildBackupPayload(collectionRef.current, settingsRef.current, MASTER_VERSION, new Date(), list, {
          version: __APP_VERSION__,
          edition: EDITION,
        });
        const bytes = await createBackupZip(payload, list ?? []);
        const name = backupFileName();
        const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
        if (mode === 'share') {
          const file = new File([blob], name, { type: 'application/zip' });
          await navigator.share({ files: [file], title: name });
        } else {
          downloadBlob(blob, name);
        }
        showToast(`バックアップを作成しました（${name}）`, false);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // 共有をキャンセル
        showToast('バックアップの作成に失敗しました。もう一度お試しください。', false, 8000);
      } finally {
        setBackupBusy(false);
      }
    },
    [showToast, jacketAvailability],
  );

  const pickRestoreFile = useCallback(async (file: File) => {
    setRestoreError(null);
    setRestoreBusy(true);
    try {
      if (file.size > LIMITS.zipBytes) throw new BackupError('ファイルが大きすぎます。Inori Collection で作成したバックアップを選んでください。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await parseBackupZip(bytes, RELEASES);
      setPendingRestore({ parsed, fileName: file.name });
    } catch (e) {
      setRestoreError(e instanceof BackupError ? e.message : 'ファイルを読み込めませんでした。');
    } finally {
      setRestoreBusy(false);
    }
  }, []);

  const [confirmBusy, setConfirmBusy] = useState(false);
  const confirmRestore = useCallback(async () => {
    if (!pendingRestore || confirmBusy) return;
    const { parsed } = pendingRestore;
    setConfirmBusy(true);
    try {
      // 画像 → 所持データの順に保存し、どちらかが失敗したら両方とも元のまま（画像は元に戻す）にする
      let beforeJackets = [...userJacketsRef.current.values()];
      const replaceJackets = parsed.jackets !== null && jacketAvailability !== 'unsupported';
      if (replaceJackets) {
        try {
          // 起動直後で画像の読み込みが終わっていなければ、置き換え前の画像をここで読み込んでおく（元に戻せるように）
          if (jacketAvailability !== 'ready') beforeJackets = await listUserJackets();
          await replaceAllUserJackets(parsed.jackets!);
        } catch (e) {
          setPendingRestore(null);
          setRestoreError(`復元に失敗しました。${errorMessage(e, '画像を保存できませんでした。')}現在のデータは変更されていません。`);
          return;
        }
      }
      const r = saveCollection(parsed.collection);
      if (!r.ok) {
        if (replaceJackets) await replaceAllUserJackets(beforeJackets).catch(() => {});
        setPendingRestore(null);
        setRestoreError(`復元に失敗しました。${r.message}現在のデータは変更されていません。`);
        return;
      }
      undoStack.current = [
        {
          kind: 'restore',
          beforeCollection: collectionRef.current,
          beforeSettings: settingsRef.current,
          beforeJackets: replaceJackets ? beforeJackets : null,
        },
      ];
      blockSavesRef.current = false;
      setBlockSaves(false);
      collectionRef.current = parsed.collection;
      setCollection(parsed.collection);
      setSettings(parsed.settings);
      setSaveError(null);
      setPendingRestore(null);
      setSettingsOpen(false);
      if (replaceJackets) {
        setJacketMap(new Map(parsed.jackets!.map((j) => [j.id, j])));
        setJacketAvailability('ready');
      }
      showToast('バックアップから復元しました', true, 15000);
    } finally {
      setConfirmBusy(false);
    }
  }, [pendingRestore, confirmBusy, jacketAvailability, setJacketMap, showToast]);

  // ───────────── 表示 ─────────────
  const stats = useMemo(() => computeStats(RELEASES, collection), [collection]);
  const visible = useMemo(() => filterAndSort(RELEASES, collection, settings), [collection, settings]);
  const orphans = useMemo(() => orphanIds(RELEASES, collection), [collection]);
  const currentSummary = useMemo(() => {
    const values = Object.values(collection);
    return { forms: values.length, discs: values.reduce((n, h) => n + h.unopened + h.opened, 0) };
  }, [collection]);

  return (
    <div className="min-h-dvh bg-white">
      <header className="safe-top sticky top-0 z-30 border-b border-inori-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8 shrink-0 rounded-lg" />
            <h1 className="truncate text-[17px] font-extrabold tracking-tight text-inori-900">Inori Collection</h1>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold ${
              offlineInfo.state === 'ready'
                ? 'bg-emerald-50 text-emerald-800'
                : offlineInfo.state === 'partial' || online
                  ? 'bg-amber-50 text-amber-900'
                  : 'bg-slate-100 text-slate-600'
            }`}
            aria-label={`オフライン状態：${offlineInfo.label}（設定を開く）`}
            title={offlineInfo.label}
            data-testid="offline-pill"
            data-state={offlineInfo.state}
          >
            {offlineInfo.state !== 'not-ready' ? (
              <IconCheck width={14} height={14} />
            ) : !online ? (
              <IconCloudOff width={14} height={14} />
            ) : (
              <IconDisc width={14} height={14} className={preparing ? 'animate-spin' : ''} />
            )}
            <span className="hidden whitespace-nowrap min-[360px]:inline">{pillText}</span>
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="設定（バックアップ・復元）"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-inori-900 active:bg-inori-50"
          >
            <IconSettings width={22} height={22} />
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-3 px-3 pt-3 pb-28">
        {needRefresh && (
          <Banner
            tone="info"
            action={
              <button type="button" onClick={applyUpdate} className="h-9 rounded-xl bg-inori-700 px-3 text-sm font-bold text-white">
                更新する
              </button>
            }
          >
            新しいバージョンがあります。所持データはそのまま引き継がれます。
          </Banner>
        )}
        {loadIssues.map((msg, i) => (
          <Banner
            key={i}
            tone="warn"
            action={
              <button type="button" onClick={() => setLoadIssues((l) => l.filter((_, j) => j !== i))} className="h-9 rounded-xl px-2 text-sm font-semibold underline">
                閉じる
              </button>
            }
          >
            {msg}
          </Banner>
        ))}
        {blockSaves && (
          <Banner
            tone="error"
            action={
              <div className="flex gap-2">
                <button
                  type="button"
                  className="h-9 rounded-xl border border-red-300 bg-white px-3 text-sm font-semibold"
                  onClick={() => rawCorruptRef.current && downloadBlob(new Blob([rawCorruptRef.current], { type: 'text/plain' }), 'inori-collection-damaged-data.txt')}
                >
                  破損データを保存
                </button>
                <button
                  type="button"
                  className="h-9 rounded-xl bg-red-700 px-3 text-sm font-semibold text-white"
                  onClick={() => {
                    blockSavesRef.current = false;
                    setBlockSaves(false);
                    commit(collectionRef.current);
                  }}
                >
                  保存を再開
                </button>
              </div>
            }
          >
            保存データが破損していたため、元データを守るために自動保存を止めています。必要なら破損データを保存してから「保存を再開」を押してください。
          </Banner>
        )}
        {saveError && !blockSaves && (
          <Banner
            tone="error"
            action={
              <button type="button" onClick={() => commit(collectionRef.current)} className="h-9 rounded-xl bg-red-700 px-3 text-sm font-semibold text-white">
                再試行
              </button>
            }
          >
            {saveError}
          </Banner>
        )}

        <StatsPanel stats={stats} />

        <div className="py-1">
          <Toolbar settings={settings} onChange={updateSettings} onReset={resetFilters} />
        </div>

        <p className="text-xs text-slate-500" aria-live="polite" data-testid="result-count">
          {visible.length} 件を表示中{!isDefaultFilter(settings) && `（全 ${RELEASES.length} 件）`}
        </p>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center" data-testid="empty">
            <p className="font-bold text-slate-700">条件に一致する作品はありません</p>
            <p className="text-sm text-slate-500">検索キーワードや絞り込み条件を変えてみてください。</p>
            <button type="button" onClick={resetFilters} className="h-11 rounded-2xl bg-inori-700 px-5 text-sm font-bold text-white">
              条件をリセット
            </button>
          </div>
        ) : settings.view === 'grid' ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" data-testid="grid">
            {visible.map((r) => (
              <ReleaseCard
                key={r.id}
                release={r}
                holding={getHolding(collection, r.id)}
                onChange={changeCount}
                userJacketUrl={userJacketUrls[r.id] ?? null}
                onOpen={openDetail}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2" data-testid="list">
            {visible.map((r) => (
              <ReleaseRow
                key={r.id}
                release={r}
                holding={getHolding(collection, r.id)}
                onChange={changeCount}
                userJacketUrl={userJacketUrls[r.id] ?? null}
                onOpen={openDetail}
              />
            ))}
          </div>
        )}
      </main>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        offline={offlineStatus}
        onRetryJackets={() => void runPrepare(true)}
        onCreateBackup={(m) => void createBackup(m)}
        canShareFiles={canShareFiles}
        backupBusy={backupBusy}
        onPickRestoreFile={(f) => void pickRestoreFile(f)}
        restoreBusy={restoreBusy}
        persisted={persisted}
        orphanCount={orphans.length}
        corruptedCount={countCorrupted()}
        formsTotal={RELEASES.length}
        masterVersion={MASTER_VERSION}
        appVersion={__APP_VERSION__}
        userJackets={{ count: userJackets.size, bytes: userJacketBytes, availability: jacketAvailability }}
      />

      <DetailSheet
        release={detailId ? (RELEASE_BY_ID.get(detailId) ?? null) : null}
        onClose={closeDetail}
        holding={getHolding(collection, detailId ?? '')}
        userJacket={detailId ? (userJackets.get(detailId) ?? null) : null}
        userJacketUrl={detailId ? (userJacketUrls[detailId] ?? null) : null}
        availability={jacketAvailability}
        busy={jacketBusy}
        error={jacketError}
        onPickImage={(f) => detailId && void changeUserJacket(detailId, f)}
        onRemoveImage={() => detailId && void changeUserJacket(detailId, null)}
      />

      <Modal
        open={pendingRestore !== null}
        title="バックアップから復元"
        onClose={() => setPendingRestore(null)}
        footer={
          <div className="flex gap-2">
            <button type="button" onClick={() => setPendingRestore(null)} className="h-12 flex-1 rounded-2xl border border-slate-300 bg-white font-bold text-slate-700">
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => void confirmRestore()}
              disabled={confirmBusy}
              className="h-12 flex-1 rounded-2xl bg-inori-700 font-bold text-white disabled:opacity-50"
              data-testid="confirm-restore"
            >
              {confirmBusy ? '復元中…' : '復元する'}
            </button>
          </div>
        }
      >
        {pendingRestore && (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-emerald-800">ファイルの確認が完了しました。以下の内容で復元します。</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-2xl bg-slate-50 p-3">
              <dt className="text-slate-500">ファイル</dt>
              <dd className="break-all">{pendingRestore.fileName}</dd>
              <dt className="text-slate-500">作成日時</dt>
              <dd>{formatDateTime(pendingRestore.parsed.createdAt)}</dd>
              <dt className="text-slate-500">所持形態数</dt>
              <dd data-testid="restore-forms">{pendingRestore.parsed.forms}</dd>
              <dt className="text-slate-500">未開封 / 開封済</dt>
              <dd>
                {pendingRestore.parsed.unopened}枚 / {pendingRestore.parsed.opened}枚
              </dd>
              <dt className="text-slate-500">ジャケット画像</dt>
              <dd data-testid="restore-jackets">
                {pendingRestore.parsed.jackets === null ? '含まれていません' : `${pendingRestore.parsed.jackets.length}枚`}
              </dd>
            </dl>
            {pendingRestore.parsed.jackets === null ? (
              userJackets.size > 0 && (
                <p className="rounded-xl bg-slate-50 p-2 text-slate-700">
                  このバックアップには画像の情報が含まれていないため、今の端末で設定した画像（{userJackets.size}枚）はそのまま残します。
                </p>
              )
            ) : jacketAvailability === 'unsupported' ? (
              pendingRestore.parsed.jackets.length > 0 && (
                <p className="rounded-xl bg-amber-50 p-2 text-amber-900">
                  このブラウザでは画像を端末内に保存できないため、画像は復元されません（所持枚数と表示設定だけ復元します）。
                </p>
              )
            ) : (
              (userJackets.size > 0 || pendingRestore.parsed.jackets.length > 0) && (
                <p className="rounded-xl bg-slate-50 p-2 text-slate-700" data-testid="restore-jackets-note">
                  自分で設定した画像は、バックアップの画像（{pendingRestore.parsed.jackets.length}枚）に置き換わります
                  {userJackets.size > 0 && `（今の端末の画像 ${userJackets.size} 枚は削除されます）`}。
                </p>
              )
            )}
            {pendingRestore.parsed.unknownIds.length > 0 && (
              <p className="rounded-xl bg-amber-50 p-2 text-amber-900">
                現在の作品データにない項目が {pendingRestore.parsed.unknownIds.length} 件あります。削除せずにそのまま保持します。
              </p>
            )}
            <p className="rounded-xl bg-red-50 p-2 text-red-900">
              現在のデータ（{currentSummary.forms}形態・{currentSummary.discs}枚）と表示設定は、バックアップの内容で上書きされます。復元直後は「元に戻す」で取り消せます。
            </p>
          </div>
        )}
      </Modal>

      <Modal open={restoreError !== null} title="復元できませんでした" onClose={() => setRestoreError(null)}>
        <p className="text-sm leading-relaxed" data-testid="restore-error">
          {restoreError}
        </p>
        <p className="mt-2 text-sm text-slate-500">現在のデータは変更されていません。</p>
      </Modal>

      {toast && <UndoToast message={toast.message} onUndo={toast.undoable ? undo : undefined} onClose={closeToast} />}
    </div>
  );
}
