import { type ReactNode, useEffect, useId, useRef } from 'react';
import { IconX } from './Icons';

/** 画面下の「元に戻す」付きトースト */
export function UndoToast({ message, onUndo, onClose }: { message: string; onUndo?: () => void; onClose: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 safe-bottom" role="status" aria-live="polite">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl bg-slate-800 py-2 pr-2 pl-4 text-sm text-white shadow-lg">
        <p className="min-w-0 flex-1 leading-snug break-words">{message}</p>
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="h-10 shrink-0 rounded-xl bg-inori-500 px-3 text-sm font-bold text-slate-900 active:bg-inori-300"
          >
            元に戻す
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="閉じる" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/70 active:bg-white/10">
          <IconX width={18} height={18} />
        </button>
      </div>
    </div>
  );
}

/** モーダル（ネイティブ <dialog> を使用。alert/confirm は使わない） */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  fullHeight = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  fullHeight?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-1.5rem)] max-w-lg overflow-hidden rounded-3xl bg-white p-0 text-slate-800 shadow-xl backdrop:bg-slate-900/40 ${
        fullHeight ? 'h-[calc(100dvh-2rem)] max-h-[52rem]' : 'max-h-[calc(100dvh-2rem)]'
      }`}
    >
      {open && (
        <div className="flex h-full max-h-[inherit] flex-col">
          <header className="flex shrink-0 items-center justify-between border-b border-slate-100 py-2 pr-2 pl-4">
            <h2 id={titleId} className="text-base font-bold">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="閉じる" className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 active:bg-slate-100">
              <IconX />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer && <footer className="shrink-0 border-t border-slate-100 px-4 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Banner({ tone, children, action }: { tone: 'error' | 'warn' | 'info'; children: ReactNode; action?: ReactNode }) {
  const color =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-900'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-inori-200 bg-inori-50 text-inori-900';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-[13px] leading-snug ${color}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
