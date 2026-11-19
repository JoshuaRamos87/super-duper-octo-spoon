import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Copy, Cpu, Terminal, Trash2, Zap } from 'lucide-react';

interface ProgressTerminalProps {
  visible: boolean;
  isProcessing: boolean;
  percent: number;
  statusText: string;
  subtext: string;
  elapsedSec: number;
  activeEngine: 'webcodecs' | 'ffmpeg' | null;
  logs: string[];
  onCopyLogs: () => void;
  onClearLogs: () => void;
}

export function ProgressTerminal({
  visible,
  isProcessing,
  percent,
  statusText,
  subtext,
  elapsedSec,
  activeEngine,
  logs,
  onCopyLogs,
  onClearLogs,
}: ProgressTerminalProps) {
  const [openLogs, setOpenLogs] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (openLogs && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [logs, openLogs]);

  return (
    <div className="rounded-2xl bg-studio-900 border border-zinc-800/90 overflow-hidden">
      {visible && (
        <div className="p-4 border-b border-zinc-800/80 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {activeEngine === 'webcodecs' ? (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-semibold text-emerald-300 inline-flex items-center gap-1 shrink-0">
                  <Zap className="w-3 h-3" />
                  GPU
                </span>
              ) : activeEngine === 'ffmpeg' ? (
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-semibold text-indigo-300 inline-flex items-center gap-1 shrink-0">
                  <Cpu className="w-3 h-3" />
                  WASM
                </span>
              ) : null}
              <span className="font-medium text-zinc-200 truncate">{statusText}</span>
            </div>
            <span className="font-mono font-semibold text-indigo-300 shrink-0">{percent}%</span>
          </div>

          <div className="w-full h-2.5 rounded-full bg-studio-950 border border-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-150 ${
                isProcessing
                  ? 'bg-gradient-to-r from-indigo-500 to-violet-500'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono">
            <span className="truncate pr-2">{subtext}</span>
            <span className="shrink-0">{elapsedSec.toFixed(1)}s</span>
          </div>
        </div>
      )}

      {/* Collapsible Log Header */}
      <button
        type="button"
        onClick={() => setOpenLogs((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition"
      >
        <span className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-zinc-500" />
          Engine Terminal Output
          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400">
            {logs.length}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 ${openLogs ? 'rotate-180' : ''}`}
        />
      </button>

      {openLogs && (
        <div className="border-t border-zinc-800/80 bg-[#070709]">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/70 bg-studio-950">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              WebCodecs &amp; FFmpeg stdout/stderr
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCopyLogs}
                className="text-[11px] text-zinc-400 hover:text-white inline-flex items-center gap-1"
              >
                <Copy className="w-3 h-3" />
                Copy
              </button>
              <button
                type="button"
                onClick={onClearLogs}
                className="text-[11px] text-zinc-400 hover:text-white inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            </div>
          </div>
          <pre
            ref={preRef}
            className="p-3 h-48 overflow-y-auto font-mono text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap break-all"
          >
            {logs.length > 0 ? logs.join('\n') : 'Waiting for engine activity...'}
          </pre>
        </div>
      )}
    </div>
  );
}
