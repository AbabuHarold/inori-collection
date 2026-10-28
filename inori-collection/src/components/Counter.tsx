import { memo } from 'react';
import { IconMinus, IconPlus } from './Icons';
import { MAX_COUNT } from '../lib/collection';

interface Props {
  label: string;
  value: number;
  /** 読み上げ用：作品名＋形態 */
  itemName: string;
  onChange: (delta: 1 | -1) => void;
  /**
   * compact: グリッド用。ラベルを数字の上に重ねて横幅を抑える（幅320pxの端末でも2列で収まる）
   */
  compact?: boolean;
}

const btnBase =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition active:scale-90 disabled:opacity-30 disabled:active:scale-100';

/** 「−」 数 「＋」 の常時表示カウンター */
export const Counter = memo(function Counter({ label, value, itemName, onChange, compact = false }: Props) {
  const minus = (
    <button
      type="button"
      className={`${btnBase} border-slate-300 bg-white text-slate-600`}
      onClick={() => onChange(-1)}
      disabled={value <= 0}
      aria-label={`${itemName} の${label}を1枚減らす`}
    >
      <IconMinus width={18} height={18} />
    </button>
  );
  const plus = (
    <button
      type="button"
      className={`${btnBase} border-inori-700 bg-inori-700 text-white`}
      onClick={() => onChange(1)}
      disabled={value >= MAX_COUNT}
      aria-label={`${itemName} の${label}を1枚増やす`}
    >
      <IconPlus width={18} height={18} />
    </button>
  );

  if (compact) {
    return (
      <div className="flex items-center justify-between" data-counter={label}>
        {minus}
        <div className="flex min-w-0 flex-1 flex-col items-center leading-none">
          <span className="text-[10px] font-medium whitespace-nowrap text-slate-500">{label}</span>
          <span className="mt-0.5 text-base font-bold tabular-nums text-slate-800" data-testid="count">
            {value}
          </span>
        </div>
        {plus}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2" data-counter={label}>
      <span className="w-12 shrink-0 text-xs font-medium whitespace-nowrap text-slate-500">{label}</span>
      {minus}
      <span className="w-8 text-center text-base font-bold tabular-nums text-slate-800" data-testid="count">
        {value}
      </span>
      {plus}
    </div>
  );
});

export function OwnedBadge({ total, className = '' }: { total: number; className?: string }) {
  return total > 0 ? (
    <span
      data-testid="badge"
      className={`inline-flex items-center rounded-full bg-inori-700 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-white shadow-sm ${className}`}
    >
      所持 {total}枚
    </span>
  ) : (
    <span
      data-testid="badge"
      className={`inline-flex items-center rounded-full border border-slate-300 bg-white/95 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-slate-500 shadow-sm ${className}`}
    >
      未所持
    </span>
  );
}
