import type {
  ExportSettings,
  FFmpegLoadState,
  TransformSettings,
  TrimSegment,
  VideoMetadata,
} from '../types/studio';
import { ffmpegEngine, type EngineResult, type FfmpegLoadProgressCallback } from './ffmpegEngine';
import { canUseWebCodecs, mediabunnyEngine } from './mediabunnyEngine';

export interface DispatchJob {
  metadata: VideoMetadata;
  segments: TrimSegment[];
  transform: TransformSettings;
  settings: ExportSettings;
}

export interface DispatchCallbacks {
  onLoadStatus: FfmpegLoadProgressCallback;
  onProgress: (
    pct: number,
    statusText: string,
    subtext: string,
    activeEngine: 'webcodecs' | 'ffmpeg'
  ) => void;
  onLog: (msg: string) => void;
}

let activeBackend: 'webcodecs' | 'ffmpeg' | null = null;
let userCancelled = false;

export function cancelActiveExport(): void {
  userCancelled = true;
  if (activeBackend === 'webcodecs') {
    mediabunnyEngine.cancel();
  } else if (activeBackend === 'ffmpeg') {
    ffmpegEngine.cancel();
  }
}

export async function runExportJob(
  job: DispatchJob,
  callbacks: DispatchCallbacks
): Promise<EngineResult> {
  userCancelled = false;
  const pref = job.settings.enginePreference;
  const wcCapable = canUseWebCodecs(job.metadata, job.segments, job.transform, job.settings);

  if (pref === 'webcodecs' && !wcCapable.supported) {
    throw new Error(
      `WebCodecs GPU mode is unavailable for this configuration: ${wcCapable.reason}`
    );
  }

  if (pref !== 'ffmpeg' && wcCapable.supported) {
    activeBackend = 'webcodecs';
    try {
      const result = await mediabunnyEngine.executeJob(job, {
        onProgress: (pct, status, sub) => callbacks.onProgress(pct, status, sub, 'webcodecs'),
        onLog: callbacks.onLog,
      });
      activeBackend = null;
      return result;
    } catch (err) {
      if (userCancelled || (err instanceof DOMException && err.name === 'AbortError')) {
        activeBackend = null;
        throw err;
      }
      if (pref === 'webcodecs') {
        activeBackend = null;
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.onLog(
        `[Dispatcher] WebCodecs GPU path unavailable (${msg}); automatically falling back to FFmpeg.wasm...`
      );
    }
  } else if (pref === 'auto' && !wcCapable.supported && wcCapable.reason) {
    callbacks.onLog(`[Dispatcher] Using FFmpeg.wasm (${wcCapable.reason}).`);
  }

  activeBackend = 'ffmpeg';
  try {
    return await ffmpegEngine.executeJob(
      {
        fileName: job.metadata.name,
        metadata: job.metadata,
        segments: job.segments,
        transform: job.transform,
        settings: job.settings,
      },
      {
        onLoadStatus: callbacks.onLoadStatus,
        onProgress: (pct, status, sub) => callbacks.onProgress(pct, status, sub, 'ffmpeg'),
        onLog: callbacks.onLog,
      }
    );
  } finally {
    activeBackend = null;
  }
}

export async function preloadFfmpegEngine(
  onLoadStatus: FfmpegLoadProgressCallback,
  onLog: (msg: string) => void
): Promise<void> {
  await ffmpegEngine.ensureLoaded(onLoadStatus, onLog);
}

export async function checkInitialWasmStatus(): Promise<FFmpegLoadState> {
  if (ffmpegEngine.isLoaded()) return 'ready';
  const cached = await ffmpegEngine.isWasmCached();
  return cached ? 'cached' : 'idle';
}
