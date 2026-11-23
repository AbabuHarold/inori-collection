import { memo, useMemo } from 'react';
import type { Release } from '../data/types';
import { CATEGORY_LABEL, editionLabel } from '../data/releases';
import type { CountField, Holding } from '../lib/collection';
import { Counter, OwnedBadge } from './Counter';
import { Jacket } from './Jacket';
import { IS_PUBLIC_EDITION } from '../edition';

interface Props {
  release: Release;
  holding: Holding;
  onChange: (id: string, field: CountField, delta: 1 | -1) => void;
  /** 自分で設定したジャケット画像の URL */
  userJacketUrl: string | null;
  /** ジャケットをタップしたとき（作品の詳細・画像の設定を開く） */
  onOpen: (id: string) => void;
}

/** 公開版で、まだ画像を設定していない形態のプレースホルダーに出す案内 */
const PLACEHOLDER_HINT = IS_PUBLIC_EDITION ? 'タップで画像を設定' : null;

function useHandlers(release: Release, onChange: Props['onChange']) {
  return useMemo(
    () => ({
      unopened: (d: 1 | -1) => onChange(release.id, 'unopened', d),
      opened: (d: 1 | -1) => onChange(release.id, 'opened', d),
    }),
    [release.id, onChange],
  );
}

const categoryChip: Record<Release['category'], string> = {
  single: 'bg-inori-100 text-inori-900',
  album: 'bg-sky-100 text-sky-900',
  bluray: 'bg-indigo-100 text-indigo-900',
  clips: 'bg-violet-100 text-violet-900',
};

/** グリッド表示用カード */
export const ReleaseCard = memo(function ReleaseCard({ release, holding, onChange, userJacketUrl, onOpen }: Props) {
  const h = useHandlers(release, onChange);
  const total = holding.unopened + holding.opened;
  const name = `${release.title}（${editionLabel(release)}）`;
  return (
    <article
      className={`flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm ${total > 0 ? 'border-inori-300' : 'border-slate-200'}`}
      data-testid="release"
      data-id={release.id}
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => onOpen(release.id)}
          aria-label={`${name}の詳細・ジャケット画像の設定`}
          className="block w-full active:opacity-80"
          data-testid="open-detail"
        >
          <Jacket release={release} userUrl={userJacketUrl} hint={PLACEHOLDER_HINT} />
        </button>
        <OwnedBadge total={total} className="pointer-events-none absolute top-2 left-2" />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2">
        <h3 className="line-clamp-2 min-h-[2.5em] text-[13px] leading-tight font-bold break-words text-slate-800">{release.title}</h3>
        <div className="flex min-w-0 items-center gap-1">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${categoryChip[release.category]}`}>
            {CATEGORY_LABEL[release.category]}
          </span>
          <span className="truncate text-[11px] text-slate-500">{editionLabel(release)}</span>
        </div>
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          <Counter compact label="未開封" value={holding.unopened} itemName={name} onChange={h.unopened} />
          <Counter compact label="開封済" value={holding.opened} itemName={name} onChange={h.opened} />
        </div>
      </div>
    </article>
  );
});

/** リスト表示用の行 */
export const ReleaseRow = memo(function ReleaseRow({ release, holding, onChange, userJacketUrl, onOpen }: Props) {
  const h = useHandlers(release, onChange);
  const total = holding.unopened + holding.opened;
  const name = `${release.title}（${editionLabel(release)}）`;
  return (
    <article
      className={`flex gap-3 rounded-2xl border bg-white p-2 shadow-sm ${total > 0 ? 'border-inori-300' : 'border-slate-200'}`}
      data-testid="release"
      data-id={release.id}
    >
      <button
        type="button"
        onClick={() => onOpen(release.id)}
        aria-label={`${name}の詳細・ジャケット画像の設定`}
        className="w-24 shrink-0 self-start overflow-hidden rounded-lg active:opacity-80 sm:w-28"
        data-testid="open-detail"
      >
        <Jacket release={release} userUrl={userJacketUrl} hint={PLACEHOLDER_HINT} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm leading-tight font-bold break-words text-slate-800">{release.title}</h3>
          <OwnedBadge total={total} className="shrink-0" />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${categoryChip[release.category]}`}>
            {CATEGORY_LABEL[release.category]}
          </span>
          <span className="text-xs text-slate-500">{editionLabel(release)}</span>
          <span className="text-[11px] text-slate-400 tabular-nums">{release.releaseDate.replaceAll('-', '.')}</span>
        </div>
        <div className="mt-1 flex flex-col gap-1">
          <Counter label="未開封" value={holding.unopened} itemName={name} onChange={h.unopened} />
          <Counter label="開封済" value={holding.opened} itemName={name} onChange={h.opened} />
        </div>
      </div>
    </article>
  );
});
