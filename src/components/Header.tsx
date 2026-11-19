import { Film, HelpCircle, Trash2, Zap } from 'lucide-react';
import type { FFmpegLoadState } from '../types/studio';

interface HeaderProps {
  webCodecsReady: boolean;
  ffmpegState: FFmpegLoadState;
  ffmpegStatusText: string;
  ffmpegProgressPct: number | null;
  onPreloadFfmpeg: () => void;
  onClearWasmCache: () => void;
  onOpenShortcuts: () => void;
}

const DOT_COLOR: Record<FFmpegLoadState, string> = {
  idle: 'bg-zinc-500',
  loading: 'bg-amber-400 animate-pulse',
  ready: 'bg-emerald-400',
  cached: 'bg-emerald-400',
  error: 'bg-rose-500',
};

export function Header({
  webCodecsReady,
  ffmpegState,
  ffmpegStatusText,
  ffmpegProgressPct,
  onPreloadFfmpeg,
  onClearWasmCache,
  onOpenShortcuts,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-studio-950/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
            <Film className="w-5 h-5 text-white" />
          </div>
          <div className="truncate">
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-white flex items-center gap-2">
              ClipShrink Studio
              <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">
                100% Local • Offline PWA
              </span>
            </h1>
            <p className="text-[11px] sm:text-xs text-zinc-400 truncate">
              Client-Side Trimmer, Cropper &amp; Target-Size Compressor
            </p>
          </div>
        </div>

        {/* Engine Badges & Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {webCodecsReady && (
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-300 font-medium"
              title="Browser WebCodecs GPU hardware encoding is available for fast MP4 exports"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>GPU Ready</span>
            </div>
          )}

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-studio-900 border border-zinc-800 text-xs">
            <span className={`w-2 h-2 rounded-full ${DOT_COLOR[ffmpegState]}`} />
            <span className="text-zinc-300 font-medium hidden sm:inline">
              {ffmpegStatusText}
            </span>
            <span className="text-zinc-300 font-medium sm:hidden">
              {ffmpegState === 'loading' && ffmpegProgressPct !== null
                ? `${Math.round(ffmpegProgressPct)}%`
                : ffmpegState === 'cached'
                  ? 'Cached'
                  : ffmpegState === 'ready'
                    ? 'Ready'
                    : 'FFmpeg'}
            </span>
          </div>

          {ffmpegState !== 'ready' && (
            <button
              type="button"
              onClick={onPreloadFfmpeg}
              disabled={ffmpegState === 'loading'}
              title="Download/load FFmpeg.wasm (~31 MB) into offline browser cache"
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 active:scale-[0.98] text-xs font-medium text-zinc-200 border border-zinc-700/80 transition flex items-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">
                {ffmpegState === 'cached' ? 'Warm Engine' : 'Load FFmpeg'}
              </span>
              <span className="sm:hidden">Load</span>
            </button>
          )}

          {ffmpegState === 'cached' && (
            <button
              type="button"
              onClick={onClearWasmCache}
              title="Clear offline cached FFmpeg.wasm binary"
              className="p-2 rounded-xl bg-studio-900 hover:bg-zinc-800 text-zinc-400 hover:text-rose-300 border border-zinc-800 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenShortcuts}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            className="p-2 rounded-xl bg-studio-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Thin WASM Download Progress Bar */}
      {ffmpegState === 'loading' && ffmpegProgressPct !== null && (
        <div className="h-1 w-full bg-zinc-900 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 transition-all duration-200"
            style={{ width: `${Math.max(3, Math.min(100, ffmpegProgressPct))}%` }}
          />
        </div>
      )}
    </header>
  );
}
