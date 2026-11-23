import { type ReactNode, useRef } from 'react';
import { Modal } from './Overlay';
import { IconCheck, IconCloudOff, IconDisc } from './Icons';
import { IS_PUBLIC_EDITION } from '../edition';
import { formatBytes } from '../lib/userJackets';
import type { UserJacketAvailability } from './DetailSheet';

export interface OfflineStatus {
  online: boolean;
  swSupported: boolean;
  appShell: boolean;
  /** 端末内に保存済みの形態数 */
  jacketsCached: number;
  /** 配信元から画像を取得できなかった形態数（プレースホルダー表示） */
  jacketsUnavailable: number;
  jacketsTotal: number;
  unavailableTitles: string[];
  preparing: boolean;
  cacheSupported: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  offline: OfflineStatus;
  onRetryJackets: () => void;
  onCreateBackup: (mode: 'download' | 'share') => void;
  canShareFiles: boolean;
  backupBusy: boolean;
  onPickRestoreFile: (file: File) => void;
  restoreBusy: boolean;
  persisted: boolean | null;
  orphanCount: number;
  corruptedCount: number;
  formsTotal: number;
  masterVersion: string;
  appVersion: string;
  /** 自分で設定したジャケット画像 */
  userJackets: { count: number; bytes: number; availability: UserJacketAvailability };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-slate-100 py-4 first:pt-1 last:border-b-0">
      <h3 className="text-sm font-bold text-inori-900">{title}</h3>
      {children}
    </section>
  );
}

export type OfflineState = 'ready' | 'partial' | 'not-ready';

/**
 * オフライン準備状況
 * - ready    : アプリ本体と全形態のジャケット画像が端末内に保存済み
 * - partial  : 取得できる画像はすべて保存済みだが、配信元から取得できなかった形態がある（その形態はCDアイコン表示）
 * - not-ready: まだ準備が終わっていない（未保存の画像がある・アプリ本体が未保存）
 */
export function offlineSummary(o: OfflineStatus): { state: OfflineState; ready: boolean; label: string } {
  if (!o.swSupported || !o.cacheSupported) return { state: 'not-ready', ready: false, label: 'このブラウザはオフライン非対応' };
  const settled = o.jacketsCached + o.jacketsUnavailable;
  // 配信元から取得する画像がない（公開版）ときは、アプリ本体が保存できていれば準備完了
  const allSettled = settled >= o.jacketsTotal;
  if (o.appShell && allSettled && o.jacketsUnavailable === 0) return { state: 'ready', ready: true, label: 'オフライン準備完了' };
  if (o.appShell && allSettled && !o.preparing) {
    return { state: 'partial', ready: false, label: `オフライン準備完了（${o.jacketsUnavailable}形態は画像なし）` };
  }
  if (o.preparing) return { state: 'not-ready', ready: false, label: `オフライン準備中 ${settled}/${o.jacketsTotal}` };
  return { state: 'not-ready', ready: false, label: 'オフライン準備未完了' };
}

export function SettingsSheet(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const o = p.offline;
  const summary = offlineSummary(o);
  const pct = o.jacketsTotal ? Math.floor(((o.jacketsCached + o.jacketsUnavailable) / o.jacketsTotal) * 100) : 0;

  return (
    <Modal open={p.open} onClose={p.onClose} title="設定" fullHeight>
      <Section title="バックアップ（機種変更用）">
        <p className="text-[13px] leading-relaxed text-slate-600">
          所持枚数・表示設定・自分で設定したジャケット画像を ZIP ファイル1つに保存します。機種変更のときは、新しいスマートフォンの「バックアップから復元」でこのファイルを選ぶだけで引き継げます（iPhone ⇔ Android 間も可）。
        </p>
        {p.userJackets.count > 0 && (
          <p className="text-[12px] text-slate-500" data-testid="backup-jacket-note">
            自分で設定した画像 {p.userJackets.count} 枚（約{formatBytes(p.userJackets.bytes)}）も含めます。
          </p>
        )}
        <button
          type="button"
          onClick={() => p.onCreateBackup('download')}
          disabled={p.backupBusy}
          className="h-12 rounded-2xl bg-inori-700 text-[15px] font-bold text-white active:bg-inori-800 disabled:opacity-50"
        >
          {p.backupBusy ? '作成中…' : 'バックアップを作成'}
        </button>
        {p.canShareFiles && (
          <button
            type="button"
            onClick={() => p.onCreateBackup('share')}
            disabled={p.backupBusy}
            className="h-11 rounded-2xl border border-inori-700 bg-white text-sm font-bold text-inori-800 active:bg-inori-50 disabled:opacity-50"
          >
            共有メニューから保存（「ファイル」アプリ等）
          </button>
        )}
        <p className="text-[12px] leading-relaxed text-slate-500">
          保存したZIPは、クラウドストレージやパソコンなど、このスマートフォン以外の場所にも保管しておくと安心です。
        </p>

        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={p.restoreBusy}
            className="h-12 rounded-2xl border border-slate-300 bg-white text-[15px] font-bold text-slate-700 active:bg-slate-50 disabled:opacity-50"
          >
            {p.restoreBusy ? 'ファイルを確認中…' : 'バックアップから復元'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed,application/octet-stream"
            className="hidden"
            data-testid="restore-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) p.onPickRestoreFile(f);
            }}
          />
          <p className="text-[12px] leading-relaxed text-slate-500">ファイルの内容を確認してから、上書きしてよいか確認画面を表示します。確認するまで現在のデータは変更されません。</p>
        </div>
      </Section>

      <Section title="ジャケット画像">
        <p className="text-[13px] leading-relaxed text-slate-600">
          {IS_PUBLIC_EDITION
            ? 'このアプリにはジャケット画像は含まれていません。一覧のジャケット部分をタップすると、手持ちのCD・Blu-rayを撮影した写真などを形態ごとに設定できます。'
            : '一覧のジャケット部分をタップすると、自分で用意した画像に差し替えられます（公式サイトの画像より優先して表示します）。'}
        </p>
        <ul className="flex flex-col gap-1 text-[13px] text-slate-600">
          <li data-testid="user-jacket-count">
            自分で設定した画像：{p.userJackets.availability === 'loading' ? '読み込み中' : `${p.userJackets.count} 枚`}
            {p.userJackets.count > 0 && `（約${formatBytes(p.userJackets.bytes)}）`}
          </li>
        </ul>
        {p.userJackets.availability === 'unsupported' && (
          <p className="rounded-xl bg-amber-50 p-2 text-[13px] text-amber-900">
            このブラウザでは画像を端末内に保存できません（プライベートブラウズ中の可能性があります）。
          </p>
        )}
        <p className="text-[12px] leading-relaxed text-slate-500">
          設定した画像は縮小してこの端末内にだけ保存し、どこにも送信しません。ブラウザのデータを削除すると画像も消えるため、バックアップを作成しておいてください。
        </p>
      </Section>

      <Section title="オフライン利用">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {summary.state !== 'not-ready' ? (
            <IconCheck className={summary.ready ? 'text-emerald-600' : 'text-amber-600'} />
          ) : o.online ? (
            <IconDisc className="text-amber-600" />
          ) : (
            <IconCloudOff className="text-slate-500" />
          )}
          <span data-testid="offline-summary">{summary.label}</span>
        </div>
        <ul className="flex flex-col gap-1 text-[13px] text-slate-600">
          <li>
            アプリ本体：
            {!o.swSupported ? 'このブラウザでは保存できません' : o.appShell ? '保存済み' : '準備中（一度オンラインで開いてください）'}
          </li>
          {IS_PUBLIC_EDITION ? (
            <li data-testid="jacket-status">ジャケット画像：配信元から取得しない版です（自分で設定した画像は端末内に保存済み）</li>
          ) : (
            <li data-testid="jacket-status">
              ジャケット画像：{o.jacketsCached} / {o.jacketsTotal} 形態ぶん保存済み
            </li>
          )}
          {o.jacketsUnavailable > 0 && (
            <li className="text-amber-800" data-testid="jacket-unavailable">
              配信元から画像を取得できなかった形態：{o.jacketsUnavailable} 件（CDアイコンで表示します）
              <ul className="mt-0.5 list-disc pl-5 text-[12px]">
                {o.unavailableTitles.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </li>
          )}
          <li>ネットワーク：{o.online ? 'オンライン' : 'オフライン'}</li>
        </ul>
        {o.jacketsTotal > 0 && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div className="h-full bg-inori-600 transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}
        {o.jacketsTotal > 0 && (!summary.ready || o.jacketsUnavailable > 0) && (
          <button
            type="button"
            onClick={p.onRetryJackets}
            disabled={o.preparing || !o.online || !o.cacheSupported}
            className="h-11 rounded-2xl border border-inori-700 bg-white text-sm font-bold text-inori-800 active:bg-inori-50 disabled:opacity-40"
          >
            {o.preparing ? '保存中…' : !o.online ? 'オンライン時に再試行できます' : summary.state === 'partial' ? '取得できなかった画像を再試行' : 'ジャケット画像をオフライン用に保存'}
          </button>
        )}
        <p className="text-[12px] leading-relaxed text-slate-500">
          {IS_PUBLIC_EDITION
            ? '所持枚数・設定・自分で設定した画像は、この端末のブラウザ内に保存されます。'
            : '所持枚数・設定はこの端末のブラウザ内に保存されます。ジャケット画像はキングレコード公式サイト・水瀬いのり公式サイトの画像を、この端末内にだけ保存して表示します（約数MB〜十数MB）。'}
        </p>
        <p className="text-[12px] text-slate-500">
          端末の保存領域の保護：{p.persisted === true ? '有効' : p.persisted === false ? '未許可（ホーム画面に追加すると許可されやすくなります）' : '不明'}
        </p>
      </Section>

      <Section title="データ">
        <ul className="flex flex-col gap-1 text-[13px] text-slate-600">
          <li>登録形態数：{p.formsTotal}</li>
          <li>作品データの版：{p.masterVersion}</li>
          {p.orphanCount > 0 && (
            <li className="text-amber-800">現在の作品データにない所持データ：{p.orphanCount} 件（削除せず保持し、バックアップにも含めています）</li>
          )}
          {p.corruptedCount > 0 && <li className="text-amber-800">退避済みの破損データ：{p.corruptedCount} 件</li>}
          <li data-testid="app-version">
            アプリのバージョン：{p.appVersion}（{IS_PUBLIC_EDITION ? '公開版' : '個人用版'}）
          </li>
        </ul>
        <p className="text-[12px] leading-relaxed text-slate-500">
          {IS_PUBLIC_EDITION
            ? '作品情報の出典：水瀬いのり公式サイト（ディスコグラフィー）・キングレコード公式サイト。ジャケット画像は含まれていません（各自で設定）。ファンが作成した非公式アプリです。'
            : '作品情報の出典：水瀬いのり公式サイト（ディスコグラフィー）・キングレコード公式サイト。ジャケット画像は各公式サイトの配信画像を参照しています。個人利用を目的とした非公式アプリです。'}
        </p>
      </Section>
    </Modal>
  );
}
