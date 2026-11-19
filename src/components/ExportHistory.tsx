import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Columns2,
  Download,
  History,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { ExportHistoryItem } from '../types/studio';
import { formatBytes, formatDecimalMB, formatTime } from '../utils/timecode';

interface ExportHistoryProps {
  history: ExportHistoryItem[];
  activeId: string | null;
  sourceVideoUrl: string | null;
  sourceBrowserPlayable: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRetryTighter: (item: ExportHistoryItem) => void;
}

export function ExportHistory({
  history,
  activeId,
  sourceVideoUrl,
  sourceBrowserPlayable,
  onSelect,
  onDelete,
  onRetryTighter,
}: ExportHistoryProps) {
  const [compareMode, setCompareMode] = useState(false);
  const origCompareRef = useRef<HTMLVideoElement | null>(null);
  const outCompareRef = useRef<HTMLVideoElement | null>(null);

  if (history.length === 0) return null;

  const active = history.find((h) => h.id === activeId) || history[0];
  const diffPct =
    active.originalSizeBytes > 0
      ? ((active.originalSizeBytes - active.sizeBytes) / active.originalSizeBytes) * 100
      : 0;
  const isImage = active.ext === 'gif' || active.ext === 'webp';
  const isAudio = active.ext === 'mp3' || active.ext === 'm4a' || active.ext === 'wav';
  const canSideBySide = !isImage && !isAudio && sourceBrowserPlayable && Boolean(sourceVideoUrl);

  const targetCapBytes = active.targetMB ? active.targetMB * 1_000_000 : null;
  const overshotBytes =
    targetCapBytes !== null && active.sizeBytes > targetCapBytes
      ? active.sizeBytes - targetCapBytes
      : 0;

  const syncComparePlay = () => {
    const outV = outCompareRef.current;
    const origV = origCompareRef.current;
    if (!outV || !origV) return;
    const segStart = active.segmentsSnapshot[0]?.start ?? 0;
    origV.currentTime = segStart + outV.currentTime;
    origV.muted = true;
    origV.play().catch(() => {});
  };

  const syncComparePause = () => {
    origCompareRef.current?.pause();
  };

  return (
    <div className="rounded-2xl bg-studio-900 border border-emerald-500/30 shadow-xl overflow-hidden">
      {/* Active Result Header */}
      <div className="px-5 py-3.5 bg-emerald-500/10 border-b border-emerald-500/20 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <div>
            <h3 className="text-sm font-semibold text-emerald-100">Export Complete</h3>
            <p className="text-[11px] text-emerald-300/75 font-mono">
              {active.modeSummary} • {active.engineUsed === 'webcodecs' ? '⚡ WebCodecs GPU' : 'FFmpeg.wasm'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {targetCapBytes !== null && (
            active.targetHit ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-500/35">
                Fits {active.targetMB} MB cap ✓
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-rose-500/20 text-rose-200 border border-rose-500/35">
                Overshot by {formatDecimalMB(overshotBytes)}
              </span>
            )
          )}

          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold border ${
              diffPct >= 0
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            }`}
          >
            {diffPct >= 0 ? `-${diffPct.toFixed(1)}% smaller` : `+${Math.abs(diffPct).toFixed(1)}% larger`}
          </span>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-4">
        {/* Overshoot Retry Prompt */}
        {overshotBytes > 0 && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                Output ({formatDecimalMB(active.sizeBytes)}) exceeded your {active.targetMB} MB limit.
              </span>
            </div>
            <button
              type="button"
              onClick={() => onRetryTighter(active)}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Tighter (2-Pass)
            </button>
          </div>
        )}

        {/* Size Stats + Compare Mode Switch */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-studio-950 border border-zinc-800">
            <div className="text-[11px] text-zinc-400 uppercase tracking-wider">Original File</div>
            <div className="text-base font-mono font-semibold text-zinc-300 mt-0.5">
              {formatBytes(active.originalSizeBytes)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-studio-950 border border-emerald-500/25">
            <div className="text-[11px] text-emerald-400/90 uppercase tracking-wider">
              Exported ({formatDecimalMB(active.sizeBytes)})
            </div>
            <div className="text-base font-mono font-semibold text-white mt-0.5">
              {formatBytes(active.sizeBytes)}
            </div>
          </div>
        </div>

        {/* Side-by-Side Toggle */}
        {canSideBySide && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setCompareMode((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition ${
                compareMode
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-studio-950 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              {compareMode ? 'Exit Side-by-Side Compare' : 'Compare vs Original'}
            </button>
          </div>
        )}

        {/* Playable Preview */}
        {isImage ? (
          <div className="rounded-xl bg-black border border-zinc-800 overflow-hidden flex items-center justify-center max-h-80">
            <img
              src={active.blobUrl}
              alt="Generated animated clip"
              className="max-h-80 w-auto object-contain"
            />
          </div>
        ) : isAudio ? (
          <div className="p-4 rounded-xl bg-studio-950 border border-zinc-800">
            <audio src={active.blobUrl} controls className="w-full" />
          </div>
        ) : compareMode && canSideBySide ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl bg-black border border-zinc-800 overflow-hidden">
              <div className="px-2.5 py-1 bg-studio-950 text-[10px] font-mono text-zinc-400 border-b border-zinc-800">
                Original Source (Muted)
              </div>
              <video
                ref={origCompareRef}
                src={sourceVideoUrl!}
                muted
                playsInline
                className="w-full max-h-64 object-contain"
              />
            </div>
            <div className="rounded-xl bg-black border border-emerald-500/30 overflow-hidden">
              <div className="px-2.5 py-1 bg-studio-950 text-[10px] font-mono text-emerald-300 border-b border-zinc-800">
                Exported ({formatBytes(active.sizeBytes)})
              </div>
              <video
                ref={outCompareRef}
                src={active.blobUrl}
                controls
                playsInline
                onPlay={syncComparePlay}
                onPause={syncComparePause}
                className="w-full max-h-64 object-contain"
              />
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-black border border-zinc-800 overflow-hidden flex items-center justify-center max-h-80">
            <video
              src={active.blobUrl}
              controls
              playsInline
              className="w-full max-h-80 object-contain"
            />
          </div>
        )}

        {/* Download CTA */}
        <a
          href={active.blobUrl}
          download={active.downloadName}
          className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-semibold text-sm shadow-lg shadow-emerald-600/20 transition flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          <span>
            Download {active.downloadName} ({formatBytes(active.sizeBytes)})
          </span>
        </a>

        {/* Session Comparison History Tray */}
        {history.length > 1 && (
          <div className="pt-3 border-t border-zinc-800/80 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
              <History className="w-3.5 h-3.5 text-indigo-400" />
              Session Exports ({history.length}) — click to compare
            </div>
            <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
              {history.map((item) => {
                const selected = item.id === active.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition text-xs ${
                      selected
                        ? 'bg-indigo-500/15 border-indigo-500/45 text-white'
                        : 'bg-studio-950 border-zinc-800/80 text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{item.downloadName}</div>
                      <div className="text-[11px] font-mono text-zinc-400">
                        {item.modeSummary} • {formatTime(item.trimDurationSec)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-xs text-emerald-300">
                        {formatBytes(item.sizeBytes)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(item.id);
                        }}
                        aria-label="Delete session export"
                        className="p-1 text-zinc-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
