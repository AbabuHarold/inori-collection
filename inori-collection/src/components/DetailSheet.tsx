import { useRef } from 'react';
import type { Release } from '../data/types';
import { CATEGORY_LABEL, editionLabel } from '../data/releases';
import type { Holding } from '../lib/collection';
import { type UserJacket, formatBytes } from '../lib/userJackets';
import { IS_PUBLIC_EDITION } from '../edition';
import { Jacket } from './Jacket';
import { Modal } from './Overlay';

export type UserJacketAvailability = 'loading' | 'ready' | 'unsupported';

interface Props {
  release: Release | null;
  onClose: () => void;
  holding: Holding;
  userJacket: UserJacket | null;
  userJacketUrl: string | null;
  availability: UserJacketAvailability;
  busy: boolean;
  error: string | null;
  onPickImage: (file: File) => void;
  onRemoveImage: () => void;
}

function formatDate(iso: string): string {
  return iso.replaceAll('-', '.');
}

/** 作品の詳細と、ジャケット画像の設定 */
export function DetailSheet(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const r = p.release;
  const hasUser = p.userJacket !== null;
  const officialAvailable = !IS_PUBLIC_EDITION && (r?.jacketUrls.length ?? 0) > 0;
  const canEdit = p.availability === 'ready' && !p.busy;

  return (
    <Modal open={r !== null} onClose={p.onClose} title="作品の詳細">
      {r && (
        <div className="flex flex-col gap-4" data-testid="detail" data-id={r.id}>
          <div className="mx-auto w-full max-w-[15rem] overflow-hidden rounded-2xl border border-slate-200">
            <Jacket release={r} userUrl={p.userJacketUrl} hint={IS_PUBLIC_EDITION ? '画像は未設定です' : null} />
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="text-base leading-snug font-bold break-words text-slate-800">{r.title}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
              <dt className="text-slate-500">カテゴリー</dt>
              <dd>{CATEGORY_LABEL[r.category]}</dd>
              <dt className="text-slate-500">形態</dt>
              <dd>{editionLabel(r)}</dd>
              <dt className="text-slate-500">品番</dt>
              <dd className="tabular-nums">{r.catalogNumber ?? r.id}</dd>
              <dt className="text-slate-500">発売日</dt>
              <dd className="tabular-nums">{formatDate(r.releaseDate)}</dd>
              <dt className="text-slate-500">所持</dt>
              <dd>
                未開封 {p.holding.unopened}枚 / 開封済 {p.holding.opened}枚
              </dd>
            </dl>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {r.officialUrl && (
                <a href={r.officialUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-inori-800 underline underline-offset-2">
                  公式サイトの作品ページ
                </a>
              )}
              {r.sourceUrl && (
                <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-inori-800 underline underline-offset-2">
                  キングレコードの商品ページ
                </a>
              )}
            </div>
          </div>

          <section className="flex flex-col gap-2 rounded-2xl bg-slate-50 p-3">
            <h4 className="text-sm font-bold text-inori-900">ジャケット画像</h4>
            <p className="text-[13px] text-slate-700" data-testid="jacket-source">
              {hasUser
                ? `自分で設定した画像を表示しています（${formatBytes(p.userJacket!.data.byteLength)}）。`
                : officialAvailable
                  ? '公式サイトの画像を表示しています。'
                  : '画像は設定されていません。'}
            </p>

            {p.availability === 'unsupported' ? (
              <p className="rounded-xl bg-amber-50 p-2 text-[13px] text-amber-900">
                このブラウザでは画像を端末内に保存できません（プライベートブラウズ中の可能性があります）。
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!canEdit}
                  className="h-12 rounded-2xl bg-inori-700 text-[15px] font-bold text-white active:bg-inori-800 disabled:opacity-50"
                  data-testid="pick-jacket"
                >
                  {p.busy ? '保存中…' : hasUser ? '画像を変更' : '画像を選ぶ'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  data-testid="jacket-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) p.onPickImage(f);
                  }}
                />
                {hasUser && (
                  <button
                    type="button"
                    onClick={p.onRemoveImage}
                    disabled={!canEdit}
                    className="h-11 rounded-2xl border border-slate-300 bg-white text-sm font-bold text-slate-700 active:bg-slate-100 disabled:opacity-50"
                    data-testid="remove-jacket"
                  >
                    {officialAvailable ? '設定した画像を削除（公式の画像に戻す）' : '設定した画像を削除'}
                  </button>
                )}
              </div>
            )}
            {p.error && (
              <p role="alert" className="rounded-xl bg-red-50 p-2 text-[13px] text-red-900" data-testid="jacket-error">
                {p.error}
              </p>
            )}
            <p className="text-[12px] leading-relaxed text-slate-500">
              手持ちのCD・Blu-rayを撮影した写真などを選んでください。画像は縮小してこの端末内にだけ保存し、どこにも送信しません（写真の位置情報などは保存しません）。機種変更のときはバックアップに含めて引き継げます。
            </p>
          </section>
        </div>
      )}
    </Modal>
  );
}
