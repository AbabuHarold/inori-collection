import { memo, useState } from 'react';
import {
  type CategoryFilter,
  type OpenFilter,
  type OwnedFilter,
  type Settings,
  type SortKey,
  MAX_QUERY_LENGTH,
} from '../lib/collection';
import { IconFilter, IconGrid, IconList, IconSearch, IconX } from './Icons';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
}

const CATEGORY_OPTIONS: [CategoryFilter, string][] = [
  ['all', 'すべて'],
  ['single', 'シングル'],
  ['album', 'アルバム'],
  ['bluray', 'ライブBlu-ray'],
];
const OWNED_OPTIONS: [OwnedFilter, string][] = [
  ['all', 'すべて'],
  ['owned', '所持している作品'],
  ['missing', '未所持の作品'],
];
const OPEN_OPTIONS: [OpenFilter, string][] = [
  ['all', 'すべて'],
  ['hasUnopened', '未開封が1枚以上'],
  ['hasOpened', '開封済が1枚以上'],
];
export const SORT_OPTIONS: [SortKey, string][] = [
  ['dateAsc', '発売日が古い順'],
  ['dateDesc', '発売日が新しい順'],
  ['title', '作品名順'],
  ['category', 'カテゴリー順'],
];

function Chips<T extends string>({
  name,
  options,
  value,
  onSelect,
  scroll = false,
}: {
  name: string;
  options: [T, string][];
  value: T;
  onSelect: (v: T) => void;
  scroll?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={`flex gap-1.5 ${scroll ? 'no-scrollbar -mx-3 overflow-x-auto px-3' : 'flex-wrap'}`}
    >
      {options.map(([v, label]) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(v)}
            className={`h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition ${
              active ? 'border-inori-700 bg-inori-700 text-white' : 'border-slate-200 bg-white text-slate-600 active:bg-slate-50'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export const Toolbar = memo(function Toolbar({ settings, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const extraActive = (settings.owned !== 'all' ? 1 : 0) + (settings.open !== 'all' ? 1 : 0);
  const sortLabel = SORT_OPTIONS.find(([k]) => k === settings.sort)?.[1] ?? '';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">作品名で検索</span>
          <IconSearch className="pointer-events-none absolute left-3 text-slate-400" width={18} height={18} />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={MAX_QUERY_LENGTH}
            value={settings.query}
            onChange={(e) => onChange({ query: e.target.value })}
            placeholder="作品名で検索"
            className={`h-10 w-full rounded-full border border-slate-200 bg-slate-50 pl-9 text-base ${settings.query ? 'pr-9' : 'pr-3'} text-slate-800 placeholder:text-slate-400 focus:border-inori-500 focus:bg-white focus:outline-none [&::-webkit-search-cancel-button]:hidden`}
          />
          {settings.query && (
            <button
              type="button"
              onClick={() => onChange({ query: '' })}
              className="absolute right-1 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
              aria-label="検索キーワードを消す"
            >
              <IconX width={16} height={16} />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="filter-panel"
          aria-label="絞り込み・並び替え"
          className={`relative flex h-10 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[13px] font-semibold ${
            open || extraActive ? 'border-inori-700 bg-inori-50 text-inori-800' : 'border-slate-200 bg-white text-slate-600'
          }`}
        >
          <IconFilter width={18} height={18} />
          <span className="hidden min-[360px]:inline">絞り込み</span>
          {extraActive > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-inori-700 text-[11px] text-white">
              {extraActive}
            </span>
          )}
        </button>
        <div className="flex shrink-0 overflow-hidden rounded-full border border-slate-200" role="radiogroup" aria-label="表示形式">
          <button
            type="button"
            role="radio"
            aria-checked={settings.view === 'grid'}
            aria-label="グリッド表示"
            onClick={() => onChange({ view: 'grid' })}
            className={`flex h-10 w-10 items-center justify-center ${settings.view === 'grid' ? 'bg-inori-700 text-white' : 'bg-white text-slate-500'}`}
          >
            <IconGrid width={18} height={18} />
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={settings.view === 'list'}
            aria-label="リスト表示"
            onClick={() => onChange({ view: 'list' })}
            className={`flex h-10 w-10 items-center justify-center ${settings.view === 'list' ? 'bg-inori-700 text-white' : 'bg-white text-slate-500'}`}
          >
            <IconList width={18} height={18} />
          </button>
        </div>
      </div>

      <Chips name="カテゴリー" scroll options={CATEGORY_OPTIONS} value={settings.category} onSelect={(v) => onChange({ category: v })} />

      {open && (
        <div id="filter-panel" className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-bold text-slate-500">所持状況</legend>
            <Chips name="所持状況" options={OWNED_OPTIONS} value={settings.owned} onSelect={(v) => onChange({ owned: v })} />
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-bold text-slate-500">開封状態</legend>
            <Chips name="開封状態" options={OPEN_OPTIONS} value={settings.open} onSelect={(v) => onChange({ open: v })} />
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-bold text-slate-500">並び替え</legend>
            <Chips name="並び替え" options={SORT_OPTIONS} value={settings.sort} onSelect={(v) => onChange({ sort: v })} />
          </fieldset>
          <button type="button" onClick={onReset} className="self-start text-[13px] font-semibold text-inori-800 underline underline-offset-2">
            検索・絞り込み条件をリセット
          </button>
        </div>
      )}
      {!open && settings.sort !== 'dateAsc' && <p className="text-[11px] text-slate-500">並び順：{sortLabel}</p>}
    </div>
  );
});
