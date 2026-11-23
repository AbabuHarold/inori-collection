import { memo, useEffect, useState } from 'react';
import type { Release } from '../data/types';
import { CATEGORY_LABEL } from '../data/releases';
import { forgetJacket } from '../lib/offline';

/**
 * ジャケット画像。所持状況に関係なく常にカラー表示。
 *
 * 表示の優先順位：
 *   1. 自分で設定した画像（userUrl。端末内に保存した画像の object URL）
 *   2. 公式の配信元の画像（個人用版のみ。候補を先頭から順に試す）
 *   3. CD 風のプレースホルダー
 * 縦長・横長のジャケット（ライブBlu-ray・BOX仕様など）も切れないよう、全体が収まるように表示する。
 */
export const Jacket = memo(function Jacket({
  release,
  userUrl = null,
  className = '',
  hint = null,
}: {
  release: Release;
  /** 自分で設定した画像の URL（なければ null） */
  userUrl?: string | null;
  className?: string;
  /** プレースホルダーに添える短い案内（公開版の「タップで画像を設定」など） */
  hint?: string | null;
}) {
  const [index, setIndex] = useState(0);
  const [userFailed, setUserFailed] = useState(false);
  const urls = release.jacketUrls;
  // オフライン中に失敗した画像は、オンライン復帰時に最初の候補から読み込み直す
  useEffect(() => {
    const retry = () => setIndex(0);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);
  // 設定した画像が変わったら、もう一度その画像から表示を試す
  useEffect(() => setUserFailed(false), [userUrl]);

  const showUser = userUrl !== null && !userFailed;
  const url = index < urls.length ? urls[index] : null;
  const exhausted = urls.length > 0 && url === null;

  return (
    <div className={`relative aspect-square overflow-hidden bg-slate-100 ${className}`}>
      {showUser ? (
        <img
          key={userUrl}
          src={userUrl}
          alt={`${release.title} ジャケット（自分で設定した画像）`}
          decoding="async"
          draggable={false}
          data-user-jacket=""
          onError={() => setUserFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : url ? (
        <img
          key={url}
          src={url}
          alt={`${release.title} ジャケット`}
          loading="lazy"
          decoding="async"
          draggable={false}
          data-jacket-index={index}
          onError={() => {
            // 壊れた応答がキャッシュに残っていれば消しておく（次回オンライン時に取り直す）
            if (navigator.onLine) void forgetJacket(url);
            setIndex((i) => i + 1);
          }}
          className="h-full w-full object-contain"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-inori-100 to-inori-300 p-2 text-center"
          role="img"
          aria-label={`${release.title}（画像なし）`}
          data-testid="jacket-placeholder"
        >
          <svg viewBox="0 0 64 64" className="h-1/3 w-1/3 text-white drop-shadow-sm" aria-hidden="true">
            <circle cx="32" cy="32" r="28" fill="currentColor" />
            <circle cx="32" cy="32" r="9" fill="#9fd7f2" />
            <circle cx="32" cy="32" r="4" fill="#ffffff" />
          </svg>
          <span className="line-clamp-2 text-[11px] leading-tight font-semibold text-inori-900">{release.title}</span>
          <span className="text-[10px] text-inori-800">{exhausted ? '画像を読み込めません' : (hint ?? CATEGORY_LABEL[release.category])}</span>
        </div>
      )}
    </div>
  );
});
