import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { TrimSegment } from '../types/studio';
import type { FilmstripFrame } from '../utils/filmstrip';
import { formatTime, parseTime } from '../utils/timecode';

interface TimelineProps {
  duration: number;
  fps: number;
  currentTime: number;
  isPlaying: boolean;
  previewMuted: boolean;
  playbackRate: number;
  loopSelection: boolean;
  segments: TrimSegment[];
  activeSegmentId: string;
  filmstrip: FilmstripFrame[];
  waveform: number[] | null;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onStepFrames: (deltaFrames: number) => void;
  onStepSeconds: (deltaSec: number) => void;
  onTogglePreviewMute: () => void;
  onChangePlaybackRate: (rate: number) => void;
  onToggleLoop: (loop: boolean) => void;
  onSelectSegment: (id: string) => void;
  onUpdateSegment: (id: string, start: number, end: number) => void;
  onSplitAtPlayhead: () => void;
  onAddSegment: () => void;
  onRemoveSegment: (id: string) => void;
  onResetTrim: () => void;
}

const PLAYBACK_RATES = [0.5, 1, 1.5, 2];

function chooseTickStep(duration: number, zoom: number): number {
  const visibleSec = duration / Math.max(1, zoom);
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const c of candidates) {
    if (visibleSec / c <= 10) return c;
  }
  return 600;
}

export function Timeline({
  duration,
  fps,
  currentTime,
  isPlaying,
  previewMuted,
  playbackRate,
  loopSelection,
  segments,
  activeSegmentId,
  filmstrip,
  waveform,
  onTogglePlay,
  onSeek,
  onStepFrames,
  onStepSeconds,
  onTogglePreviewMute,
  onChangePlaybackRate,
  onToggleLoop,
  onSelectSegment,
  onUpdateSegment,
  onSplitAtPlayhead,
  onAddSegment,
  onRemoveSegment,
  onResetTrim,
}: TimelineProps) {
  const scrollWrapRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [showWaveform, setShowWaveform] = useState(true);

  const activeSegment = useMemo(
    () => segments.find((s) => s.id === activeSegmentId) || segments[0],
    [segments, activeSegmentId]
  );

  const [startText, setStartText] = useState(formatTime(activeSegment?.start ?? 0, true));
  const [endText, setEndText] = useState(formatTime(activeSegment?.end ?? duration, true));

  useEffect(() => {
    if (activeSegment) {
      setStartText(formatTime(activeSegment.start, true));
      setEndText(formatTime(activeSegment.end, true));
    }
  }, [activeSegment]);

  // Render audio waveform onto track canvas
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !waveform || !showWaveform) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const barWidth = Math.max(1, w / waveform.length);
    ctx.fillStyle = 'rgba(129, 140, 248, 0.55)';

    for (let i = 0; i < waveform.length; i++) {
      const amp = waveform[i];
      const barH = Math.max(2, amp * (h * 0.72));
      const x = i * barWidth;
      const y = (h - barH) / 2;
      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barH);
    }
  }, [waveform, showWaveform, zoom]);

  const dragStateRef = useRef<{
    type: 'playhead' | 'start' | 'end' | 'window';
    segId: string;
    grabOffsetSec: number;
    origStart: number;
    origEnd: number;
    minBound: number;
    maxBound: number;
  } | null>(null);

  const clientXToTime = (clientX: number): number => {
    const track = trackRef.current;
    if (!track || duration <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * duration;
  };

  const getSegmentBounds = (segId: string): { minBound: number; maxBound: number } => {
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const idx = sorted.findIndex((s) => s.id === segId);
    const prevEnd = idx > 0 ? sorted[idx - 1].end : 0;
    const nextStart = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1].start : duration;
    return { minBound: prevEnd, maxBound: nextStart };
  };

  const beginDrag = (
    e: ReactPointerEvent<HTMLElement>,
    type: 'playhead' | 'start' | 'end' | 'window',
    seg?: TrimSegment
  ) => {
    if (!duration) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    if (type === 'playhead' || !seg) {
      dragStateRef.current = {
        type: 'playhead',
        segId: '',
        grabOffsetSec: 0,
        origStart: 0,
        origEnd: 0,
        minBound: 0,
        maxBound: duration,
      };
      onSeek(clientXToTime(e.clientX));
      return;
    }

    onSelectSegment(seg.id);
    const bounds = getSegmentBounds(seg.id);
    const pointerTime = clientXToTime(e.clientX);
    dragStateRef.current = {
      type,
      segId: seg.id,
      grabOffsetSec: pointerTime - seg.start,
      origStart: seg.start,
      origEnd: seg.end,
      minBound: bounds.minBound,
      maxBound: bounds.maxBound,
    };
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragStateRef.current;
    if (!d || duration <= 0) return;
    const t = clientXToTime(e.clientX);
    const minGap = Math.min(0.2, duration * 0.04);

    if (d.type === 'playhead') {
      onSeek(t);
    } else if (d.type === 'start') {
      const nextStart = Math.max(d.minBound, Math.min(t, d.origEnd - minGap));
      onUpdateSegment(d.segId, nextStart, d.origEnd);
      onSeek(nextStart);
    } else if (d.type === 'end') {
      const nextEnd = Math.min(d.maxBound, Math.max(t, d.origStart + minGap));
      onUpdateSegment(d.segId, d.origStart, nextEnd);
      onSeek(nextEnd);
    } else if (d.type === 'window') {
      const segLen = d.origEnd - d.origStart;
      const desiredStart = t - d.grabOffsetSec;
      const clampedStart = Math.max(d.minBound, Math.min(d.maxBound - segLen, desiredStart));
      onUpdateSegment(d.segId, clampedStart, clampedStart + segLen);
      onSeek(clampedStart);
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  const handleTrackWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.25 : 0.8;
      setZoom((z) => Math.max(1, Math.min(10, Number((z * delta).toFixed(2)))));
    }
  };

  const handleHandleKeyDown = (
    e: React.KeyboardEvent,
    seg: TrimSegment,
    edge: 'start' | 'end'
  ) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 0.1;
    const delta = e.key === 'ArrowRight' ? step : -step;
    const bounds = getSegmentBounds(seg.id);
    const minGap = 0.1;

    if (edge === 'start') {
      const nextStart = Math.max(bounds.minBound, Math.min(seg.end - minGap, seg.start + delta));
      onUpdateSegment(seg.id, nextStart, seg.end);
      onSeek(nextStart);
    } else {
      const nextEnd = Math.min(bounds.maxBound, Math.max(seg.start + minGap, seg.end + delta));
      onUpdateSegment(seg.id, seg.start, nextEnd);
      onSeek(nextEnd);
    }
  };

  const commitStartInput = () => {
    if (!activeSegment || duration <= 0) return;
    const parsed = parseTime(startText);
    const bounds = getSegmentBounds(activeSegment.id);
    if (!Number.isNaN(parsed)) {
      const nextStart = Math.max(bounds.minBound, Math.min(parsed, activeSegment.end - 0.1));
      onUpdateSegment(activeSegment.id, nextStart, activeSegment.end);
      onSeek(nextStart);
    } else {
      setStartText(formatTime(activeSegment.start, true));
    }
  };

  const commitEndInput = () => {
    if (!activeSegment || duration <= 0) return;
    const parsed = parseTime(endText);
    const bounds = getSegmentBounds(activeSegment.id);
    if (!Number.isNaN(parsed)) {
      const nextEnd = Math.min(bounds.maxBound, Math.max(parsed, activeSegment.start + 0.1));
      onUpdateSegment(activeSegment.id, activeSegment.start, nextEnd);
      onSeek(nextEnd);
    } else {
      setEndText(formatTime(activeSegment.end, true));
    }
  };

  const cyclePlaybackRate = () => {
    const idx = PLAYBACK_RATES.indexOf(playbackRate);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    onChangePlaybackRate(next);
  };

  const ticks = useMemo(() => {
    if (duration <= 0) return [];
    const step = chooseTickStep(duration, zoom);
    const list: number[] = [];
    for (let t = 0; t <= duration + 1e-4; t += step) {
      list.push(Number(t.toFixed(2)));
    }
    return list;
  }, [duration, zoom]);

  const durSafe = duration || 1;
  const playheadPct = Math.max(0, Math.min(100, (currentTime / durSafe) * 100));

  return (
    <div className="p-4 sm:p-5 flex flex-col gap-3.5 bg-studio-900">
      {/* Playback Transport Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePlay}
            title="Play / Pause (Space)"
            className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition active:scale-95"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onStepSeconds(-1)}
            title="Jump back 1 second (←)"
            className="px-2.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition active:scale-95 text-xs font-mono"
          >
            -1s
          </button>

          <button
            type="button"
            onClick={() => onStepFrames(-1)}
            title={`Step back 1 frame (${Math.round(fps || 30)} fps) (,) `}
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition active:scale-95 inline-flex items-center text-[11px] font-mono"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            1f
          </button>

          <button
            type="button"
            onClick={() => onStepFrames(1)}
            title={`Step forward 1 frame (${Math.round(fps || 30)} fps) (.)`}
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition active:scale-95 inline-flex items-center text-[11px] font-mono"
          >
            1f
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onStepSeconds(1)}
            title="Jump forward 1 second (→)"
            className="px-2.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition active:scale-95 text-xs font-mono"
          >
            +1s
          </button>

          <button
            type="button"
            onClick={cyclePlaybackRate}
            title="Preview playback speed"
            className="px-2.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-indigo-300 transition text-xs font-mono"
          >
            {playbackRate}x
          </button>

          <button
            type="button"
            onClick={onTogglePreviewMute}
            title="Mute / Unmute Preview Audio (M)"
            className="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition active:scale-95"
          >
            {previewMuted ? (
              <VolumeX className="w-4 h-4 text-rose-400" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Live Playhead Timecode */}
        <div className="font-mono text-xs sm:text-sm text-zinc-300 bg-studio-950 px-3 py-1.5 rounded-xl border border-zinc-800">
          <span className="text-white font-semibold">{formatTime(currentTime, true)}</span>
          <span className="text-zinc-600 mx-1.5">/</span>
          <span className="text-zinc-400">{formatTime(duration, true)}</span>
        </div>
      </div>

      {/* Timeline Tools Bar: Zoom, Waveform, Split/Multi-Cut */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSplitAtPlayhead}
            title="Split active clip at playhead to cut out a middle section (S)"
            className="px-2.5 py-1.5 rounded-lg bg-zinc-800/90 hover:bg-indigo-600/25 border border-zinc-700/80 hover:border-indigo-500/40 text-zinc-200 transition inline-flex items-center gap-1.5"
          >
            <Scissors className="w-3.5 h-3.5 text-indigo-400" />
            <span>Split Here</span>
          </button>

          <button
            type="button"
            onClick={onAddSegment}
            title="Add another kept clip segment from this recording"
            className="px-2.5 py-1.5 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 transition inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>Add Clip</span>
          </button>

          {waveform && (
            <button
              type="button"
              onClick={() => setShowWaveform((v) => !v)}
              title="Toggle audio waveform overlay"
              className={`px-2 py-1.5 rounded-lg border transition inline-flex items-center gap-1 ${
                showWaveform
                  ? 'bg-indigo-500/15 border-indigo-500/35 text-indigo-200'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Waveform</span>
            </button>
          )}
        </div>

        {/* Timeline Zoom Controls */}
        <div className="flex items-center gap-1 bg-studio-950 border border-zinc-800 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, Number((z / 1.5).toFixed(2))))}
            disabled={zoom <= 1}
            title="Zoom out timeline"
            className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-35"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            title="Reset timeline zoom (Ctrl+Wheel to zoom)"
            className="px-1.5 font-mono text-[11px] text-zinc-300 hover:text-white"
          >
            {zoom.toFixed(zoom % 1 === 0 ? 0 : 1)}x
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(10, Number((z * 1.5).toFixed(2))))}
            disabled={zoom >= 10}
            title="Zoom in timeline"
            className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-35"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable Zoomed Timeline Track */}
      <div
        ref={scrollWrapRef}
        onWheel={handleTrackWheel}
        className="overflow-x-auto pb-1"
      >
        <div style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
          {/* Ruler */}
          <div className="relative h-4 mb-1 select-none text-[10px] font-mono text-zinc-500">
            {ticks.map((t) => {
              const pct = (t / durSafe) * 100;
              return (
                <div
                  key={t}
                  style={{ left: `${pct}%` }}
                  className="absolute top-0 -translate-x-1/2 flex flex-col items-center pointer-events-none"
                >
                  <span>{formatTime(t)}</span>
                </div>
              );
            })}
          </div>

          {/* Visual Track */}
          <div
            ref={trackRef}
            onPointerDown={(e) => beginDrag(e, 'playhead')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="timeline-track relative h-16 rounded-xl bg-studio-950 border border-zinc-800 cursor-pointer overflow-hidden"
          >
            {/* Filmstrip Thumbnails Layer */}
            {filmstrip.length > 0 && (
              <div className="absolute inset-0 flex pointer-events-none opacity-65">
                {filmstrip.map((frame, i) => (
                  <img
                    key={`${frame.time}_${i}`}
                    src={frame.dataUrl}
                    alt=""
                    draggable={false}
                    className="h-full flex-1 object-cover min-w-0 border-r border-black/30 last:border-r-0"
                  />
                ))}
              </div>
            )}

            {/* Audio Waveform Layer */}
            {waveform && showWaveform && (
              <canvas
                ref={waveformCanvasRef}
                width={800}
                height={64}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
            )}

            {/* Subtle Base Dimming Over Unselected Regions */}
            <div className="absolute inset-0 bg-black/55 pointer-events-none" />

            {/* Kept Segments */}
            {segments.map((seg, idx) => {
              const isSelected = seg.id === activeSegment?.id;
              const leftPct = (seg.start / durSafe) * 100;
              const widthPct = Math.max(0.4, ((seg.end - seg.start) / durSafe) * 100);

              return (
                <div
                  key={seg.id}
                  onPointerDown={(e) => beginDrag(e, 'window', seg)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  title={`Clip ${idx + 1}: drag center to slide window`}
                  className={`absolute top-0 bottom-0 cursor-grab active:cursor-grabbing transition-colors ${
                    isSelected
                      ? 'bg-indigo-500/20 border-y-2 border-indigo-400 z-10'
                      : 'bg-emerald-500/15 border-y-2 border-emerald-500/70 z-10'
                  }`}
                >
                  {/* Segment Label Badge */}
                  {segments.length > 1 && (
                    <span
                      className={`absolute top-1 left-2 px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold pointer-events-none ${
                        isSelected ? 'bg-indigo-600 text-white' : 'bg-emerald-700 text-white'
                      }`}
                    >
                      #{idx + 1}
                    </span>
                  )}

                  {/* Start Handle */}
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={`Clip ${idx + 1} Start`}
                    aria-valuemin={0}
                    aria-valuemax={duration}
                    aria-valuenow={seg.start}
                    onKeyDown={(e) => handleHandleKeyDown(e, seg, 'start')}
                    onPointerDown={(e) => beginDrag(e, 'start', seg)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    className="absolute top-0 bottom-0 -left-2 w-4 z-30 cursor-ew-resize flex items-center justify-center group"
                  >
                    <div
                      className={`w-3 h-full rounded-l-md shadow-md flex items-center justify-center ${
                        isSelected
                          ? 'bg-indigo-500 group-hover:bg-indigo-400'
                          : 'bg-emerald-500 group-hover:bg-emerald-400'
                      }`}
                    >
                      <div className="w-0.5 h-5 bg-white/85 rounded-full" />
                    </div>
                  </div>

                  {/* End Handle */}
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={`Clip ${idx + 1} End`}
                    aria-valuemin={0}
                    aria-valuemax={duration}
                    aria-valuenow={seg.end}
                    onKeyDown={(e) => handleHandleKeyDown(e, seg, 'end')}
                    onPointerDown={(e) => beginDrag(e, 'end', seg)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    className="absolute top-0 bottom-0 -right-2 w-4 z-30 cursor-ew-resize flex items-center justify-center group"
                  >
                    <div
                      className={`w-3 h-full rounded-r-md shadow-md flex items-center justify-center ${
                        isSelected
                          ? 'bg-indigo-500 group-hover:bg-indigo-400'
                          : 'bg-emerald-500 group-hover:bg-emerald-400'
                      }`}
                    >
                      <div className="w-0.5 h-5 bg-white/85 rounded-full" />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Current Playhead Indicator */}
            <div
              style={{ left: `${playheadPct}%` }}
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.95)] pointer-events-none z-20"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-white -ml-[4px] -mt-0.5 shadow" />
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Segment Chips (visible when > 1 clip kept) */}
      {segments.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {segments.map((seg, idx) => {
            const active = seg.id === activeSegment?.id;
            return (
              <div
                key={seg.id}
                onClick={() => {
                  onSelectSegment(seg.id);
                  onSeek(seg.start);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono cursor-pointer transition ${
                  active
                    ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-100'
                    : 'bg-studio-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="font-semibold">#{idx + 1}</span>
                <span>
                  {formatTime(seg.start)}–{formatTime(seg.end)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveSegment(seg.id);
                  }}
                  title="Remove this segment (cuts it out of final video)"
                  className="text-zinc-400 hover:text-rose-400 ml-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Precise Start/End Inputs & Quick Set Buttons */}
      {activeSegment && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center gap-2 bg-studio-950 p-2 rounded-xl border border-zinc-800/90">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 pl-1.5">
              Start
            </label>
            <input
              type="text"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
              onBlur={commitStartInput}
              onKeyDown={(e) => e.key === 'Enter' && commitStartInput()}
              className="w-24 bg-studio-900 border border-zinc-700/80 focus:border-indigo-500 focus:outline-none rounded-lg px-2 py-1 text-xs font-mono text-white text-center"
            />
            <button
              type="button"
              onClick={() => {
                const bounds = getSegmentBounds(activeSegment.id);
                const nextStart = Math.max(
                  bounds.minBound,
                  Math.min(currentTime, activeSegment.end - 0.1)
                );
                onUpdateSegment(activeSegment.id, nextStart, activeSegment.end);
              }}
              title="Set Start to Playhead (I)"
              className="ml-auto px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-indigo-600/30 hover:text-indigo-200 hover:border-indigo-500/40 border border-zinc-700/70 text-[11px] font-medium text-zinc-300 transition"
            >
              Set Start (I)
            </button>
          </div>

          <div className="flex items-center gap-2 bg-studio-950 p-2 rounded-xl border border-zinc-800/90">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 pl-1.5">
              End
            </label>
            <input
              type="text"
              value={endText}
              onChange={(e) => setEndText(e.target.value)}
              onBlur={commitEndInput}
              onKeyDown={(e) => e.key === 'Enter' && commitEndInput()}
              className="w-24 bg-studio-900 border border-zinc-700/80 focus:border-indigo-500 focus:outline-none rounded-lg px-2 py-1 text-xs font-mono text-white text-center"
            />
            <button
              type="button"
              onClick={() => {
                const bounds = getSegmentBounds(activeSegment.id);
                const nextEnd = Math.min(
                  bounds.maxBound,
                  Math.max(currentTime, activeSegment.start + 0.1)
                );
                onUpdateSegment(activeSegment.id, activeSegment.start, nextEnd);
              }}
              title="Set End to Playhead (O)"
              className="ml-auto px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-indigo-600/30 hover:text-indigo-200 hover:border-indigo-500/40 border border-zinc-700/70 text-[11px] font-medium text-zinc-300 transition"
            >
              Set End (O)
            </button>
          </div>
        </div>
      )}

      {/* Loop Selection & Reset Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-zinc-800/70">
        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={loopSelection}
            onChange={(e) => onToggleLoop(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600 border border-zinc-700" />
          <span className="text-xs font-medium text-zinc-300">Loop Selection</span>
        </label>

        <button
          type="button"
          onClick={onResetTrim}
          className="text-xs text-zinc-400 hover:text-white transition inline-flex items-center gap-1"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset Trim
        </button>
      </div>
    </div>
  );
}
