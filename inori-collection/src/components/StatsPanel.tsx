import { memo } from 'react';
import { type Stats, formatCompletion } from '../lib/collection';

export const StatsPanel = memo(function StatsPanel({ stats }: { stats: Stats }) {
  const pct = formatCompletion(stats.completion);
  const bar = Math.min(100, Math.max(0, stats.completion));
  return (
    <section aria-label="コレクション集計" className="rounded-2xl bg-gradient-to-br from-inori-600 to-inori-800 p-3 text-white shadow-sm">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium text-white/90">コンプリート率</p>
          <p className="text-2xl leading-none font-extrabold tabular-nums" data-testid="stat-completion">
            {pct}
          </p>
        </div>
        <p className="text-right text-[11px] text-white/90 tabular-nums">
          {stats.ownedForms} / {stats.totalForms} 形態
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/35" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(bar)} aria-label="コンプリート率">
        <div className="h-full rounded-full bg-white transition-[width] duration-300" style={{ width: `${bar}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-1 text-center">
        {(
          [
            ['所持作品数', stats.ownedForms, 'stat-owned'],
            ['総所持枚数', stats.totalDiscs, 'stat-total'],
            ['未開封', stats.unopened, 'stat-unopened'],
            ['開封済', stats.opened, 'stat-opened'],
          ] as const
        ).map(([label, value, id]) => (
          <div key={id} className="rounded-xl bg-white/20 px-1 py-1.5">
            <dt className="text-[10px] leading-tight whitespace-nowrap text-white/95">{label}</dt>
            <dd className="text-lg leading-tight font-bold tabular-nums" data-testid={id}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
});
