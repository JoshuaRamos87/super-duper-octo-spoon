import { X } from 'lucide-react';
import type { ToastMessage } from '../types/studio';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const TONE_MAP: Record<ToastMessage['type'], string> = {
  info: 'bg-studio-900/95 border-zinc-700 text-zinc-100',
  success: 'bg-emerald-950/95 border-emerald-500/40 text-emerald-100',
  warning: 'bg-amber-950/95 border-amber-500/40 text-amber-100',
  error: 'bg-rose-950/95 border-rose-500/40 text-rose-100',
};

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto px-3.5 py-2.5 rounded-xl border shadow-2xl text-xs font-medium flex items-center justify-between gap-2.5 backdrop-blur-md transition-all ${TONE_MAP[t.type]}`}
        >
          <span className="leading-relaxed">{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
            className="text-current/60 hover:text-current p-0.5 rounded shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
