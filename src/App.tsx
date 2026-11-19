import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Upload, UploadCloud } from 'lucide-react';
import { BatchQueue } from './components/BatchQueue';
import { ControlsPanel } from './components/ControlsPanel';
import { DropZone } from './components/DropZone';
import { ExportHistory } from './components/ExportHistory';
import { Header } from './components/Header';
import { ProgressTerminal } from './components/ProgressTerminal';
import { ShortcutsModal } from './components/ShortcutsModal';
import { Timeline } from './components/Timeline';
import { ToastContainer } from './components/ToastContainer';
import { VideoPreview } from './components/VideoPreview';
import {
  cancelActiveExport,
  checkInitialWasmStatus,
  preloadFfmpegEngine,
  runExportJob,
} from './engine/dispatcher';
import { ffmpegEngine } from './engine/ffmpegEngine';
import { hasWebCodecsAPI } from './engine/mediabunnyEngine';
import { enrichVideoMetadata } from './engine/probe';
import {
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_TRANSFORM,
  type CustomPreset,
  type ExportHistoryItem,
  type ExportSettings,
  type FFmpegLoadState,
  type QueuedJob,
  type ToastMessage,
  type TransformSettings,
  type TrimSegment,
  type VideoMetadata,
} from './types/studio';
import { generateFilmstrip, type FilmstripFrame } from './utils/filmstrip';
import { captureTransformedFrame } from './utils/frameCapture';
import { deleteCustomPreset, loadCustomPresets, saveCustomPreset } from './utils/presets';
import { formatBytes, formatTime, getTotalSegmentsDuration } from './utils/timecode';
import { generateAudioWaveform } from './utils/waveform';

const VALID_VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v|ogv|avi|flv|wmv)$/i;

export function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaAbortRef = useRef<AbortController | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);

  // Engine / PWA status
  const webCodecsReady = useMemo(() => hasWebCodecsAPI(), []);
  const [ffmpegState, setFfmpegState] = useState<FFmpegLoadState>('idle');
  const [ffmpegStatusText, setFfmpegStatusText] = useState('FFmpeg Idle');
  const [ffmpegProgressPct, setFfmpegProgressPct] = useState<number | null>(null);

  // Loaded media & metadata
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [filmstrip, setFilmstrip] = useState<FilmstripFrame[]>([]);
  const [waveform, setWaveform] = useState<number[] | null>(null);

  // Playback & timeline state
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loopSelection, setLoopSelection] = useState(true);
  const [segments, setSegments] = useState<TrimSegment[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState('seg_1');

  // Transform & Export Settings
  const [transform, setTransform] = useState<TransformSettings>(DEFAULT_TRANSFORM);
  const [cropMode, setCropMode] = useState(false);
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(() => loadCustomPresets());

  // Processing, Logs, Batch Queue & Session History
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressStatus, setProgressStatus] = useState('Preparing...');
  const [progressSubtext, setProgressSubtext] = useState('');
  const [activeEngine, setActiveEngine] = useState<'webcodecs' | 'ffmpeg' | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  const [queue, setQueue] = useState<QueuedJob[]>([]);
  const [history, setHistory] = useState<ExportHistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  // UI Overlays
  const [isDraggingWindow, setIsDraggingWindow] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((message: string, type: ToastMessage['type'] = 'info') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => {
      const next = [...prev, line];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  const handleLoadStatus = useCallback(
    (state: FFmpegLoadState, text: string, pct?: number) => {
      setFfmpegState(state);
      setFfmpegStatusText(text);
      setFfmpegProgressPct(pct ?? null);
    },
    []
  );

  // Detect cached WASM on boot
  useEffect(() => {
    checkInitialWasmStatus().then((status) => {
      if (status === 'cached') {
        setFfmpegState('cached');
        setFfmpegStatusText('FFmpeg Cached');
      }
    });
  }, []);

  // Load a selected/dropped video file
  const handleFileSelected = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('video/') && !VALID_VIDEO_EXT.test(file.name)) {
        pushToast('Please drop a valid video file (MP4, WebM, MOV, MKV, AVI).', 'warning');
        return;
      }

      // Abort previous thumbnail/waveform workers & revoke old URLs
      mediaAbortRef.current?.abort();
      const abortCtrl = new AbortController();
      mediaAbortRef.current = abortCtrl;

      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setHistory((prev) => {
        prev.forEach((h) => URL.revokeObjectURL(h.blobUrl));
        return [];
      });
      setActiveHistoryId(null);
      setQueue([]);
      setFilmstrip([]);
      setWaveform(null);
      setCropMode(false);
      setTransform(DEFAULT_TRANSFORM);
      setCurrentTime(0);
      setIsPlaying(false);

      const objUrl = URL.createObjectURL(file);
      setVideoUrl(objUrl);

      // Immediate placeholder metadata so workspace switches immediately
      const placeholder: VideoMetadata = {
        file,
        name: file.name,
        size: file.size,
        duration: 0,
        width: 0,
        height: 0,
        fps: 30,
        hasAudio: true,
        videoCodec: null,
        audioCodec: null,
        browserPlayable: true,
        probeSource: 'html5',
      };
      setMetadata(placeholder);

      // Probe HTML5 <video> metadata safely
      const html5Info = await new Promise<{
        duration: number;
        width: number;
        height: number;
        playable: boolean;
      }>((resolve) => {
        const probeVid = document.createElement('video');
        probeVid.preload = 'metadata';
        probeVid.muted = true;

        let settled = false;
        const done = (res: { duration: number; width: number; height: number; playable: boolean }) => {
          if (settled) return;
          settled = true;
          probeVid.removeAttribute('src');
          probeVid.load();
          resolve(res);
        };

        const timeout = window.setTimeout(
          () => done({ duration: 0, width: 0, height: 0, playable: false }),
          2500
        );

        probeVid.addEventListener(
          'loadedmetadata',
          () => {
            window.clearTimeout(timeout);
            const dur = Number.isFinite(probeVid.duration) ? probeVid.duration : 0;
            done({
              duration: dur,
              width: probeVid.videoWidth || 0,
              height: probeVid.videoHeight || 0,
              playable: dur > 0,
            });
          },
          { once: true }
        );

        probeVid.addEventListener(
          'error',
          () => {
            window.clearTimeout(timeout);
            done({ duration: 0, width: 0, height: 0, playable: false });
          },
          { once: true }
        );

        probeVid.src = objUrl;
      });

      if (abortCtrl.signal.aborted) return;

      const enriched = await enrichVideoMetadata(file, html5Info, async (f) => {
        pushToast('Probing container metadata with FFmpeg.wasm...', 'info');
        return ffmpegEngine.probeFile(f, handleLoadStatus, appendLog);
      });

      if (abortCtrl.signal.aborted) return;

      setMetadata(enriched);
      const dur = enriched.duration > 0 ? enriched.duration : 10;
      setSegments([{ id: 'seg_1', start: 0, end: dur }]);
      setActiveSegmentId('seg_1');

      if (!enriched.browserPlayable) {
        pushToast(
          'Browser cannot play this codec directly, but metadata was probed for FFmpeg export.',
          'warning'
        );
      } else {
        // Generate filmstrip & waveform asynchronously
        generateFilmstrip(objUrl, dur, 14, abortCtrl.signal).then((frames) => {
          if (!abortCtrl.signal.aborted) setFilmstrip(frames);
        });
        if (enriched.hasAudio) {
          generateAudioWaveform(file, 160, abortCtrl.signal).then((peaks) => {
            if (!abortCtrl.signal.aborted) setWaveform(peaks);
          });
        }
      }
    },
    [appendLog, handleLoadStatus, pushToast]
  );

  // Global window drag-and-drop so dropping works anywhere, even inside the editor
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingWindow(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDraggingWindow(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingWindow(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void handleFileSelected(file);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFileSelected]);

  // Playback helpers
  const seekTo = useCallback(
    (time: number) => {
      const dur = metadata?.duration || 0;
      const clamped = Math.max(0, Math.min(dur, time));
      setCurrentTime(clamped);
      if (videoRef.current && metadata?.browserPlayable) {
        videoRef.current.currentTime = clamped;
      }
    },
    [metadata]
  );

  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !metadata?.browserPlayable || metadata.duration <= 0) return;

    if (vid.paused) {
      const sorted = [...segments].sort((a, b) => a.start - b.start);
      const insideAny = sorted.some((s) => vid.currentTime >= s.start && vid.currentTime < s.end - 0.05);
      if (!insideAny && sorted[0]) {
        vid.currentTime = sorted[0].start;
      }
      vid.playbackRate = playbackRate;
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [metadata, playbackRate, segments]);

  const stepFrames = useCallback(
    (deltaFrames: number) => {
      const fps = metadata?.fps && metadata.fps > 1 ? metadata.fps : 30;
      seekTo(currentTime + deltaFrames / fps);
    },
    [currentTime, metadata, seekTo]
  );

  const stepSeconds = useCallback(
    (deltaSec: number) => {
      seekTo(currentTime + deltaSec);
    },
    [currentTime, seekTo]
  );

  // Sync <video> element events & multi-segment loop playback
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = previewMuted;
  }, [previewMuted]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      const t = vid.currentTime;
      setCurrentTime(t);

      if (loopSelection && !vid.paused && segments.length > 0) {
        const sorted = [...segments].sort((a, b) => a.start - b.start);
        const currIdx = sorted.findIndex((s) => t >= s.start - 0.05 && t <= s.end + 0.05);
        if (currIdx >= 0 && t >= sorted[currIdx].end) {
          const nextSeg = sorted[(currIdx + 1) % sorted.length];
          vid.currentTime = nextSeg.start;
        } else if (currIdx === -1) {
          const upcoming = sorted.find((s) => s.start > t) || sorted[0];
          if (upcoming) vid.currentTime = upcoming.start;
        }
      }
    };

    vid.addEventListener('play', onPlay);
    vid.addEventListener('pause', onPause);
    vid.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      vid.removeEventListener('play', onPlay);
      vid.removeEventListener('pause', onPause);
      vid.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [loopSelection, segments]);

  // Segment editing handlers
  const handleUpdateSegment = useCallback((id: string, start: number, end: number) => {
    setSegments((prev) =>
      prev
        .map((s) => (s.id === id ? { ...s, start, end } : s))
        .sort((a, b) => a.start - b.start)
    );
  }, []);

  const handleSplitAtPlayhead = useCallback(() => {
    if (!metadata || metadata.duration <= 0) return;
    const target = segments.find((s) => currentTime > s.start + 0.2 && currentTime < s.end - 0.2);
    if (!target) {
      pushToast('Place the playhead inside a segment (away from edges) to split it.', 'info');
      return;
    }

    const gap = Math.min(0.06, (target.end - target.start) * 0.05);
    const first: TrimSegment = { id: target.id, start: target.start, end: currentTime - gap / 2 };
    const secondId = `seg_${Date.now().toString(36)}`;
    const second: TrimSegment = { id: secondId, start: currentTime + gap / 2, end: target.end };

    setSegments((prev) =>
      prev
        .flatMap((s) => (s.id === target.id ? [first, second] : [s]))
        .sort((a, b) => a.start - b.start)
    );
    setActiveSegmentId(secondId);
    pushToast('Split segment! Drag handles or remove any segment chip to cut out a section.', 'success');
  }, [currentTime, metadata, pushToast, segments]);

  const handleAddSegment = useCallback(() => {
    if (!metadata || metadata.duration <= 0) return;
    const sorted = [...segments].sort((a, b) => a.start - b.start);

    // Find largest unused gap
    let bestStart = 0;
    let bestLen = 0;
    let cursor = 0;
    for (const s of sorted) {
      if (s.start - cursor > bestLen) {
        bestLen = s.start - cursor;
        bestStart = cursor;
      }
      cursor = Math.max(cursor, s.end);
    }
    if (metadata.duration - cursor > bestLen) {
      bestLen = metadata.duration - cursor;
      bestStart = cursor;
    }

    if (bestLen < 0.3) {
      pushToast('No free gap on timeline. Trim an existing segment shorter first.', 'warning');
      return;
    }

    const pad = Math.min(0.1, bestLen * 0.1);
    const segLen = Math.min(Math.max(0.25, bestLen - pad * 2), Math.max(2, metadata.duration * 0.2));
    const newId = `seg_${Date.now().toString(36)}`;
    const newSeg: TrimSegment = {
      id: newId,
      start: bestStart + pad,
      end: bestStart + pad + segLen,
    };
    setSegments((prev) => [...prev, newSeg].sort((a, b) => a.start - b.start));
    setActiveSegmentId(newId);
    seekTo(newSeg.start);
  }, [metadata, pushToast, seekTo, segments]);

  const handleRemoveSegment = useCallback(
    (id: string) => {
      if (segments.length <= 1) {
        pushToast('At least one kept segment is required.', 'warning');
        return;
      }
      const next = segments.filter((s) => s.id !== id);
      setSegments(next);
      if (activeSegmentId === id && next[0]) {
        setActiveSegmentId(next[0].id);
      }
    },
    [activeSegmentId, pushToast, segments]
  );

  const handleResetTrim = useCallback(() => {
    if (!metadata) return;
    setSegments([{ id: 'seg_1', start: 0, end: metadata.duration }]);
    setActiveSegmentId('seg_1');
    seekTo(0);
  }, [metadata, seekTo]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (!metadata) return;

      if (e.code === 'Space' || e.key.toLowerCase() === 'k') {
        if (tag === 'BUTTON') return;
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === 'j') {
        e.preventDefault();
        stepSeconds(-1);
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        stepSeconds(1);
      } else if (e.key === ',') {
        e.preventDefault();
        stepFrames(-1);
      } else if (e.key === '.') {
        e.preventDefault();
        stepFrames(1);
      } else if (e.key === 'ArrowLeft' && (document.activeElement as HTMLElement | null)?.getAttribute('role') !== 'slider') {
        e.preventDefault();
        stepSeconds(-1);
      } else if (e.key === 'ArrowRight' && (document.activeElement as HTMLElement | null)?.getAttribute('role') !== 'slider') {
        e.preventDefault();
        stepSeconds(1);
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        const seg = segments.find((s) => s.id === activeSegmentId) || segments[0];
        if (seg && currentTime < seg.end - 0.1) {
          handleUpdateSegment(seg.id, currentTime, seg.end);
        }
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        const seg = segments.find((s) => s.id === activeSegmentId) || segments[0];
        if (seg && currentTime > seg.start + 0.1) {
          handleUpdateSegment(seg.id, seg.start, currentTime);
        }
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSplitAtPlayhead();
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setTransform((prev) => ({
          ...prev,
          rotate: ((prev.rotate + 90) % 360) as TransformSettings['rotate'],
        }));
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setCropMode((v) => !v);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setPreviewMuted((v) => !v);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeSegmentId,
    currentTime,
    handleSplitAtPlayhead,
    handleUpdateSegment,
    metadata,
    segments,
    stepFrames,
    stepSeconds,
    togglePlay,
  ]);

  // Capture Frame Snapshot (PNG / JPG)
  const handleCaptureFrame = useCallback(
    async (format: 'image/png' | 'image/jpeg') => {
      if (!videoRef.current || !metadata) return;
      const blob = await captureTransformedFrame(videoRef.current, transform, format);
      if (!blob) {
        pushToast('Could not capture frame snapshot.', 'error');
        return;
      }
      const ext = format === 'image/png' ? 'png' : 'jpg';
      const base = metadata.name.replace(/\.[^/.]+$/, '') || 'frame';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}_${formatTime(currentTime).replace(/[:.]/g, '-')}.${ext}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      pushToast(`Saved current frame (${ext.toUpperCase()}).`, 'success');
    },
    [currentTime, metadata, pushToast, transform]
  );

  // Elapsed timer helpers
  const startTimer = () => {
    const started = performance.now();
    setElapsedSec(0);
    window.clearInterval(elapsedTimerRef.current ?? undefined);
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedSec((performance.now() - started) / 1000);
    }, 100);
  };

  const stopTimer = () => {
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  };

  // Core single export runner
  const executeSingleExport = useCallback(
    async (
      exportSegments: TrimSegment[],
      exportTransform: TransformSettings,
      exportSettings: ExportSettings,
      targetCapOverride?: number
    ) => {
      if (!metadata) return;

      const sortedSegs = [...exportSegments].sort((a, b) => a.start - b.start);
      appendLog(`\n--- Starting Export (${exportSettings.mode.toUpperCase()}) ---`);

      const result = await runExportJob(
        {
          metadata,
          segments: sortedSegs,
          transform: exportTransform,
          settings: exportSettings,
        },
        {
          onLoadStatus: handleLoadStatus,
          onProgress: (pct, status, sub, engine) => {
            setProgressPct(pct);
            setProgressStatus(status);
            setProgressSubtext(sub);
            setActiveEngine(engine);
          },
          onLog: appendLog,
        }
      );

      const trimDur = getTotalSegmentsDuration(sortedSegs);
      const effectiveTargetMB =
        exportSettings.mode === 'target'
          ? targetCapOverride ?? exportSettings.targetMB
          : undefined;
      const targetHit =
        effectiveTargetMB !== undefined
          ? result.blob.size <= effectiveTargetMB * 1_000_000
          : undefined;

      const blobUrl = URL.createObjectURL(result.blob);
      const item: ExportHistoryItem = {
        id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
        downloadName: result.downloadName,
        mimeType: result.mimeType,
        ext: result.outExt,
        blobUrl,
        sizeBytes: result.blob.size,
        originalSizeBytes: metadata.size,
        modeSummary: result.modeSummary,
        engineUsed: result.engineUsed,
        targetMB: effectiveTargetMB,
        targetHit,
        trimDurationSec: trimDur,
        segmentsSnapshot: structuredClone(sortedSegs),
        transformSnapshot: structuredClone(exportTransform),
        settingsSnapshot: structuredClone(exportSettings),
      };

      setHistory((prev) => [item, ...prev]);
      setActiveHistoryId(item.id);
      return item;
    },
    [appendLog, handleLoadStatus, metadata]
  );

  const handleStartExport = async () => {
    if (!metadata || isProcessing) return;
    setIsProcessing(true);
    setProgressVisible(true);
    setProgressPct(0);
    setProgressStatus('Starting export...');
    setProgressSubtext(metadata.name);
    setActiveEngine(null);
    startTimer();

    try {
      const item = await executeSingleExport(segments, transform, settings);
      setProgressPct(100);
      setProgressStatus('Done!');
      if (item) {
        setProgressSubtext(`Generated ${formatBytes(item.sizeBytes)}`);
      }
      pushToast('Export completed successfully!', 'success');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setProgressStatus('Processing cancelled');
        setProgressSubtext('Worker stopped cleanly');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`[Error] ${msg}`);
        setProgressStatus('Export failed');
        setProgressSubtext(msg);
        pushToast(msg, 'error');
      }
    } finally {
      stopTimer();
      setIsProcessing(false);
    }
  };

  const handleRetryTighter = async (item: ExportHistoryItem) => {
    if (!metadata || isProcessing) return;
    const origCap = item.targetMB ?? item.settingsSnapshot.targetMB;
    const tighterSettings: ExportSettings = item.settingsSnapshot.twoPass
      ? {
          ...item.settingsSnapshot,
          twoPass: true,
          targetMB: Math.max(0.5, Number((item.settingsSnapshot.targetMB * 0.92).toFixed(2))),
        }
      : {
          ...item.settingsSnapshot,
          twoPass: true,
        };

    setSettings(tighterSettings);
    setIsProcessing(true);
    setProgressVisible(true);
    setProgressPct(0);
    setProgressStatus(`Retrying ${origCap} MB with 2-Pass VBR...`);
    setProgressSubtext(metadata.name);
    startTimer();

    try {
      const nextItem = await executeSingleExport(
        item.segmentsSnapshot,
        item.transformSnapshot,
        tighterSettings,
        origCap
      );
      setProgressPct(100);
      setProgressStatus('Done!');
      if (nextItem) setProgressSubtext(`Generated ${formatBytes(nextItem.sizeBytes)}`);
      pushToast('2-Pass retry complete!', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog(`[Error] ${msg}`);
      pushToast(msg, 'error');
    } finally {
      stopTimer();
      setIsProcessing(false);
    }
  };

  const handleQueueClip = () => {
    if (!metadata) return;
    const trimDur = getTotalSegmentsDuration(segments);
    const label = `${metadata.name.replace(/\.[^/.]+$/, '')} (${formatTime(trimDur)})`;
    const newJob: QueuedJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label,
      segments: structuredClone(segments),
      transform: structuredClone(transform),
      settings: structuredClone(settings),
      status: 'queued',
    };
    setQueue((prev) => [...prev, newJob]);
    pushToast('Added clip to batch export queue.', 'info');
  };

  const handleRunQueue = async () => {
    if (!metadata || isProcessing) return;
    const pending = queue.filter((j) => j.status === 'queued' || j.status === 'error');
    if (pending.length === 0) return;

    setIsProcessing(true);
    setProgressVisible(true);
    startTimer();

    try {
      for (let i = 0; i < pending.length; i++) {
        const job = pending[i];
        setQueue((prev) =>
          prev.map((q) => (q.id === job.id ? { ...q, status: 'running', error: undefined } : q))
        );
        setProgressStatus(`Queue ${i + 1}/${pending.length}: ${job.label}`);
        try {
          await executeSingleExport(job.segments, job.transform, job.settings);
          setQueue((prev) =>
            prev.map((q) => (q.id === job.id ? { ...q, status: 'done' } : q))
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            setQueue((prev) =>
              prev.map((q) => (q.id === job.id ? { ...q, status: 'queued' } : q))
            );
            throw err;
          }
          const msg = err instanceof Error ? err.message : String(err);
          setQueue((prev) =>
            prev.map((q) => (q.id === job.id ? { ...q, status: 'error', error: msg } : q))
          );
        }
      }
      setProgressPct(100);
      setProgressStatus('Batch queue finished!');
      pushToast(`Finished exporting ${pending.length} queued clip(s)!`, 'success');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setProgressStatus('Batch queue cancelled');
      }
    } finally {
      stopTimer();
      setIsProcessing(false);
    }
  };

  const handleCancelExport = () => {
    if (!isProcessing) return;
    cancelActiveExport();
    appendLog('[System] Export cancelled by user.');
    pushToast('Processing cancelled.', 'warning');
  };

  const handlePreloadFfmpeg = () => {
    preloadFfmpegEngine(handleLoadStatus, appendLog)
      .then(() => pushToast('FFmpeg.wasm engine loaded and ready!', 'success'))
      .catch((err) =>
        pushToast(
          `FFmpeg load error: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        )
      );
  };

  const handleClearWasmCache = async () => {
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const mc = new MessageChannel();
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_WASM_CACHE' }, [mc.port2]);
      }
      if (typeof caches !== 'undefined') {
        await caches.delete('clipshrink-wasm-v1');
      }
      if (!ffmpegEngine.isLoaded()) {
        setFfmpegState('idle');
        setFfmpegStatusText('FFmpeg Idle');
      }
      pushToast('Cleared offline WASM cache.', 'info');
    } catch {
      pushToast('Could not clear WASM cache.', 'warning');
    }
  };

  const handleCopyLogs = async () => {
    const text = logs.join('\n') || 'No logs yet.';
    try {
      await navigator.clipboard.writeText(text);
      pushToast('Engine logs copied to clipboard.', 'info');
    } catch {
      pushToast('Could not copy logs.', 'error');
    }
  };

  return (
    <>
      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Full-Window Drag-and-Drop Overlay */}
      {isDraggingWindow && (
        <div className="fixed inset-0 z-50 bg-studio-950/85 backdrop-blur-md border-4 border-dashed border-indigo-500 flex flex-col items-center justify-center p-6 pointer-events-none">
          <UploadCloud className="w-14 h-14 text-indigo-400 mb-3 animate-bounce" />
          <div className="text-xl font-bold text-white">Drop video to load into ClipShrink Studio</div>
          <p className="text-xs text-zinc-400 mt-1">100% private client-side processing</p>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.webm,.mov,.mkv,.m4v,.avi,video/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileSelected(file);
          e.target.value = '';
        }}
        className="hidden"
      />

      <Header
        webCodecsReady={webCodecsReady}
        ffmpegState={ffmpegState}
        ffmpegStatusText={ffmpegStatusText}
        ffmpegProgressPct={ffmpegProgressPct}
        onPreloadFfmpeg={handlePreloadFfmpeg}
        onClearWasmCache={handleClearWasmCache}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        {!metadata || !videoUrl ? (
          <DropZone
            onSelectFileClick={() => fileInputRef.current?.click()}
            onDropFile={(f) => void handleFileSelected(f)}
          />
        ) : (
          <section className="flex flex-col gap-6">
            {/* Top File Metadata Bar */}
            <div className="rounded-2xl bg-studio-900 border border-zinc-800/90 p-3.5 sm:px-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                  <Film className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{metadata.name}</div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-400 font-mono mt-0.5">
                    <span>{formatBytes(metadata.size)}</span>
                    <span className="text-zinc-700">•</span>
                    <span>{metadata.duration > 0 ? formatTime(metadata.duration) : '...'}</span>
                    <span className="text-zinc-700">•</span>
                    <span>
                      {metadata.width > 0 ? `${metadata.width}×${metadata.height}` : '...'}
                    </span>
                    <span className="text-zinc-700">•</span>
                    <span>{Math.round(metadata.fps || 30)} fps</span>
                    {metadata.videoCodec && (
                      <>
                        <span className="text-zinc-700">•</span>
                        <span className="uppercase text-indigo-300">{metadata.videoCodec}</span>
                      </>
                    )}
                    {!metadata.hasAudio && (
                      <>
                        <span className="text-zinc-700">•</span>
                        <span className="text-amber-400">No Audio</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 border border-zinc-700/80 transition inline-flex items-center gap-1.5 shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Replace Video
              </button>
            </div>

            {/* Main Two-Column Studio Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Video Preview + Timeline + Session Exports */}
              <div className="lg:col-span-7 flex flex-col gap-4">
                <div className="rounded-2xl bg-studio-900 border border-zinc-800/90 overflow-hidden shadow-xl">
                  <VideoPreview
                    videoRef={videoRef}
                    videoUrl={videoUrl}
                    metadata={metadata}
                    isPlaying={isPlaying}
                    totalTrimDuration={getTotalSegmentsDuration(segments)}
                    transform={transform}
                    cropMode={cropMode}
                    onTogglePlay={togglePlay}
                    onToggleCropMode={() => setCropMode((v) => !v)}
                    onChangeTransform={setTransform}
                    onCaptureFrame={handleCaptureFrame}
                  />

                  <Timeline
                    duration={metadata.duration}
                    fps={metadata.fps}
                    currentTime={currentTime}
                    isPlaying={isPlaying}
                    previewMuted={previewMuted}
                    playbackRate={playbackRate}
                    loopSelection={loopSelection}
                    segments={segments}
                    activeSegmentId={activeSegmentId}
                    filmstrip={filmstrip}
                    waveform={waveform}
                    onTogglePlay={togglePlay}
                    onSeek={seekTo}
                    onStepFrames={stepFrames}
                    onStepSeconds={stepSeconds}
                    onTogglePreviewMute={() => setPreviewMuted((v) => !v)}
                    onChangePlaybackRate={setPlaybackRate}
                    onToggleLoop={setLoopSelection}
                    onSelectSegment={setActiveSegmentId}
                    onUpdateSegment={handleUpdateSegment}
                    onSplitAtPlayhead={handleSplitAtPlayhead}
                    onAddSegment={handleAddSegment}
                    onRemoveSegment={handleRemoveSegment}
                    onResetTrim={handleResetTrim}
                  />
                </div>

                <ExportHistory
                  history={history}
                  activeId={activeHistoryId}
                  sourceVideoUrl={videoUrl}
                  sourceBrowserPlayable={metadata.browserPlayable}
                  onSelect={setActiveHistoryId}
                  onDelete={(id) => {
                    setHistory((prev) => {
                      const target = prev.find((h) => h.id === id);
                      if (target) URL.revokeObjectURL(target.blobUrl);
                      const next = prev.filter((h) => h.id !== id);
                      if (activeHistoryId === id) {
                        setActiveHistoryId(next[0]?.id ?? null);
                      }
                      return next;
                    });
                  }}
                  onRetryTighter={handleRetryTighter}
                />
              </div>

              {/* Right Column: Compression Controls + Batch Queue + Progress Terminal */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                <ControlsPanel
                  metadata={metadata}
                  segments={segments}
                  transform={transform}
                  settings={settings}
                  customPresets={customPresets}
                  isProcessing={isProcessing}
                  onChangeSettings={setSettings}
                  onSavePreset={(name) => {
                    setCustomPresets(saveCustomPreset(name, settings));
                    pushToast(`Saved preset "${name}"`, 'success');
                  }}
                  onApplyPreset={(preset) => {
                    setSettings(structuredClone(preset.settings));
                    pushToast(`Applied preset "${preset.name}"`, 'info');
                  }}
                  onDeletePreset={(id) => {
                    setCustomPresets(deleteCustomPreset(id));
                  }}
                  onStartExport={handleStartExport}
                  onQueueClip={handleQueueClip}
                  onCancelExport={handleCancelExport}
                />

                <BatchQueue
                  queue={queue}
                  isProcessing={isProcessing}
                  onRunQueue={handleRunQueue}
                  onRemoveJob={(id) => setQueue((prev) => prev.filter((q) => q.id !== id))}
                  onClearQueue={() => setQueue([])}
                />

                <ProgressTerminal
                  visible={progressVisible}
                  isProcessing={isProcessing}
                  percent={progressPct}
                  statusText={progressStatus}
                  subtext={progressSubtext}
                  elapsedSec={elapsedSec}
                  activeEngine={activeEngine}
                  logs={logs}
                  onCopyLogs={handleCopyLogs}
                  onClearLogs={() => setLogs([])}
                />
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-zinc-900 py-4 px-4 text-center text-[11px] text-zinc-500">
        Powered by <span className="text-zinc-300 font-medium">WebCodecs GPU</span> &amp;{' '}
        <span className="text-zinc-300 font-medium">FFmpeg.wasm (WORKERFS)</span> • 100% local
        browser processing
      </footer>
    </>
  );
}

export default App;
