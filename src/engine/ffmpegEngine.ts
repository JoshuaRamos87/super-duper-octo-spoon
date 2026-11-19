import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import type { FFmpegLoadState } from '../types/studio';
import { buildFfmpegCommandPlan, type FfmpegJobInput } from './ffmpegArgs';
import { parseFfmpegProbeOutput, type ProbedStreamInfo } from './probe';

export interface FfmpegLoadProgressCallback {
  (state: FFmpegLoadState, statusText: string, progressPct?: number): void;
}

export interface EngineResult {
  blob: Blob;
  outExt: string;
  mimeType: string;
  downloadName: string;
  modeSummary: string;
  engineUsed: 'ffmpeg' | 'webcodecs';
}

const CDN_ST_CORE_URLS = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
  'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
];

const CDN_ST_WASM_URLS = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm',
  'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm',
];

const CDN_MT_CORE_URLS = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.js',
  'https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.js',
];

const CDN_MT_WASM_URLS = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.wasm',
  'https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.wasm',
];

const CDN_MT_WORKER_URLS = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.worker.js',
  'https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.worker.js',
];

export function canUseMultiThread(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.crossOriginIsolated) &&
    typeof SharedArrayBuffer !== 'undefined'
  );
}

function getFfmpegDir(mode: 'mt' | 'st'): string {
  const base = import.meta.env.BASE_URL || '/';
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  return mode === 'mt' ? `${cleanBase}ffmpeg-mt/` : `${cleanBase}ffmpeg/`;
}

async function fetchAsBlobURL(
  urls: string[],
  mimeType: string,
  onProgress?: (ratio: number) => void,
  onLog?: (msg: string) => void
): Promise<string> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${url}`);
      }
      const total = Number(response.headers.get('content-length')) || 0;
      if (!response.body || !total) {
        const buf = await response.arrayBuffer();
        onProgress?.(1);
        return URL.createObjectURL(new Blob([buf], { type: mimeType }));
      }
      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value.slice());
          received += value.length;
          onProgress?.(Math.min(1, received / total));
        }
      }
      return URL.createObjectURL(new Blob(chunks, { type: mimeType }));
    } catch (err) {
      lastError = err;
      onLog?.(`[Loader] Source failed (${url}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to load FFmpeg asset.');
}

class FFmpegController {
  private ffmpeg: FFmpeg | null = null;
  private loadingPromise: Promise<FFmpeg> | null = null;
  private activeMode: 'mt' | 'st' = canUseMultiThread() ? 'mt' : 'st';

  // Cached Blob URLs per core type across runs/terminations
  private cachedStCoreURL: string | null = null;
  private cachedStWasmURL: string | null = null;
  private cachedMtCoreURL: string | null = null;
  private cachedMtWasmURL: string | null = null;
  private cachedMtWorkerURL: string | null = null;

  private phaseOffset = 0;
  private phaseScale = 1;
  private cancelled = false;
  private activeLogHandler: ((msg: string) => void) | null = null;
  private activeProgressHandler: ((pct: number) => void) | null = null;

  public getActiveMode(): 'mt' | 'st' {
    return this.activeMode;
  }

  public isMultiThreadCapable(): boolean {
    return canUseMultiThread();
  }

  public async isWasmCached(mode: 'mt' | 'st' = canUseMultiThread() ? 'mt' : 'st'): Promise<boolean> {
    try {
      if (typeof caches === 'undefined') return false;
      const wasmPath = `${getFfmpegDir(mode)}ffmpeg-core.wasm`;
      const match = await caches.match(wasmPath);
      return Boolean(match);
    } catch {
      return false;
    }
  }

  public isLoaded(): boolean {
    return Boolean(this.ffmpeg && this.ffmpeg.loaded);
  }

  private async bootCoreInstance(
    mode: 'mt' | 'st',
    onStatus: FfmpegLoadProgressCallback,
    onLog: (msg: string) => void
  ): Promise<FFmpeg> {
    const stDir = getFfmpegDir('st');
    const localClassWorkerURL = new URL(`${stDir}worker.js`, window.location.origin).href;

    const dir = getFfmpegDir(mode);
    const localCoreURL = new URL(`${dir}ffmpeg-core.js`, window.location.origin).href;
    const localWasmURL = new URL(`${dir}ffmpeg-core.wasm`, window.location.origin).href;
    const localPthreadWorkerURL =
      mode === 'mt'
        ? new URL(`${dir}ffmpeg-core.worker.js`, window.location.origin).href
        : null;

    const wasCached = await this.isWasmCached(mode);
    const modeTag = mode === 'mt' ? 'Multi-Threaded' : 'Single-Threaded';

    let coreURL: string;
    let wasmURL: string;
    let workerURL: string | undefined;

    if (mode === 'mt') {
      if (!this.cachedMtCoreURL || !this.cachedMtWasmURL || !this.cachedMtWorkerURL) {
        onStatus('loading', `Preparing FFmpeg ${modeTag}...`, 8);
        onLog(
          wasCached
            ? '[Loader] Loading cached FFmpeg.wasm MT core from offline storage...'
            : '[Loader] Fetching self-hosted FFmpeg.wasm MT core (~32 MB)...'
        );

        const [mtCore, mtWorker] = await Promise.all([
          fetchAsBlobURL([localCoreURL, ...CDN_MT_CORE_URLS], 'text/javascript', undefined, onLog),
          fetchAsBlobURL(
            [localPthreadWorkerURL!, ...CDN_MT_WORKER_URLS],
            'text/javascript',
            undefined,
            onLog
          ),
        ]);

        onStatus(
          'loading',
          wasCached ? 'Reading cached MT WASM...' : 'Downloading MT WASM (0%)',
          15
        );
        const mtWasm = await fetchAsBlobURL(
          [localWasmURL, ...CDN_MT_WASM_URLS],
          'application/wasm',
          (ratio) => {
            const pct = Math.round(ratio * 100);
            onStatus(
              'loading',
              wasCached ? `Loading MT WASM (${pct}%)` : `Downloading MT WASM (${pct}%)`,
              15 + ratio * 75
            );
          },
          onLog
        );

        this.cachedMtCoreURL = mtCore;
        this.cachedMtWorkerURL = mtWorker;
        this.cachedMtWasmURL = mtWasm;
      } else {
        onStatus('loading', 'Re-initializing FFmpeg MT worker...', 90);
      }
      coreURL = this.cachedMtCoreURL;
      wasmURL = this.cachedMtWasmURL;
      workerURL = this.cachedMtWorkerURL;
    } else {
      if (!this.cachedStCoreURL || !this.cachedStWasmURL) {
        onStatus('loading', 'Preparing FFmpeg ST...', 8);
        onLog(
          wasCached
            ? '[Loader] Loading cached FFmpeg.wasm ST core from offline storage...'
            : '[Loader] Fetching self-hosted FFmpeg.wasm ST core (~31 MB)...'
        );

        const stCore = await fetchAsBlobURL(
          [localCoreURL, ...CDN_ST_CORE_URLS],
          'text/javascript',
          undefined,
          onLog
        );

        onStatus(
          'loading',
          wasCached ? 'Reading cached WASM...' : 'Downloading ST WASM (0%)',
          15
        );
        const stWasm = await fetchAsBlobURL(
          [localWasmURL, ...CDN_ST_WASM_URLS],
          'application/wasm',
          (ratio) => {
            const pct = Math.round(ratio * 100);
            onStatus(
              'loading',
              wasCached ? `Loading WASM (${pct}%)` : `Downloading WASM (${pct}%)`,
              15 + ratio * 75
            );
          },
          onLog
        );

        this.cachedStCoreURL = stCore;
        this.cachedStWasmURL = stWasm;
      } else {
        onStatus('loading', 'Re-initializing FFmpeg ST worker...', 90);
      }
      coreURL = this.cachedStCoreURL;
      wasmURL = this.cachedStWasmURL;
    }

    onStatus('loading', `Booting ${modeTag} WebAssembly...`, 94);
    const instance = new FFmpeg();

    instance.on('log', ({ message }) => {
      if (message) this.activeLogHandler?.(message);
    });

    instance.on('progress', ({ progress }) => {
      const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
      const globalPct = Math.min(
        99,
        Math.round((this.phaseOffset + clamped * this.phaseScale) * 100)
      );
      this.activeProgressHandler?.(globalPct);
    });

    try {
      await instance.load({
        classWorkerURL: localClassWorkerURL,
        coreURL,
        wasmURL,
        ...(workerURL ? { workerURL } : {}),
      });
      return instance;
    } catch (err) {
      try {
        instance.terminate();
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  public async ensureLoaded(
    onStatus: FfmpegLoadProgressCallback,
    onLog: (msg: string) => void
  ): Promise<FFmpeg> {
    if (this.ffmpeg && this.ffmpeg.loaded) {
      return this.ffmpeg;
    }
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      try {
        const preferMt = canUseMultiThread();
        let chosenMode: 'mt' | 'st' = preferMt ? 'mt' : 'st';
        let instance: FFmpeg;

        if (preferMt) {
          try {
            instance = await this.bootCoreInstance('mt', onStatus, onLog);
          } catch (mtErr) {
            onLog(
              `[Loader] Multi-threaded core unavailable (${
                mtErr instanceof Error ? mtErr.message : String(mtErr)
              }); falling back to single-threaded core...`
            );
            chosenMode = 'st';
            instance = await this.bootCoreInstance('st', onStatus, onLog);
          }
        } else {
          onLog('[Loader] Cross-origin isolation inactive; using single-threaded FFmpeg core.');
          instance = await this.bootCoreInstance('st', onStatus, onLog);
        }

        this.ffmpeg = instance;
        this.activeMode = chosenMode;

        const cached = await this.isWasmCached(chosenMode);
        const modePrefix = chosenMode === 'mt' ? 'FFmpeg MT' : 'FFmpeg ST';
        onStatus('ready', cached ? `${modePrefix} Ready (Offline)` : `${modePrefix} Ready`);
        onLog(
          `[Loader] FFmpeg.wasm ${
            chosenMode === 'mt' ? 'multi-threaded (pthreads)' : 'single-threaded'
          } engine is ready.`
        );
        return instance;
      } catch (err) {
        onStatus('error', 'FFmpeg Load Error');
        throw err;
      } finally {
        this.loadingPromise = null;
      }
    })();

    return this.loadingPromise;
  }

  public cancel(): void {
    this.cancelled = true;
    if (this.ffmpeg) {
      try {
        this.ffmpeg.terminate();
      } catch {
        // Ignore termination errors
      }
      this.ffmpeg = null;
    }
  }

  public async probeFile(
    file: File,
    onStatus: FfmpegLoadProgressCallback,
    onLog: (msg: string) => void
  ): Promise<ProbedStreamInfo | null> {
    const collected: string[] = [];
    const prevHandler = this.activeLogHandler;
    this.activeLogHandler = (msg) => {
      collected.push(msg);
      onLog(msg);
    };

    try {
      const ffmpeg = await this.ensureLoaded(onStatus, onLog);
      const mountDir = '/probe_in';
      let mounted = false;
      let inputPath = '';

      try {
        await ffmpeg.createDir(mountDir).catch(() => {});
        const ok = await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, mountDir);
        if (!ok) throw new Error('WORKERFS mount failed');
        mounted = true;
        inputPath = `${mountDir}/${file.name}`;
      } catch {
        const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
        inputPath = `probe_tmp.${ext}`;
        await ffmpeg.writeFile(inputPath, new Uint8Array(await file.arrayBuffer()));
      }

      try {
        await ffmpeg.exec(['-i', inputPath]);
      } catch {
        // `ffmpeg -i <file>` with no output always exits non-zero after logging stream info
      } finally {
        if (mounted) {
          await ffmpeg.unmount(mountDir).catch(() => {});
          await ffmpeg.deleteDir(mountDir).catch(() => {});
        } else if (inputPath) {
          await ffmpeg.deleteFile(inputPath).catch(() => {});
        }
      }

      return parseFfmpegProbeOutput(collected);
    } catch {
      return null;
    } finally {
      this.activeLogHandler = prevHandler;
    }
  }

  public async executeJob(
    jobInput: Omit<FfmpegJobInput, 'inputFSPath'>,
    callbacks: {
      onLoadStatus: FfmpegLoadProgressCallback;
      onProgress: (pct: number, statusText: string, subtext: string) => void;
      onLog: (msg: string) => void;
    }
  ): Promise<EngineResult> {
    this.cancelled = false;
    this.activeLogHandler = callbacks.onLog;
    this.activeProgressHandler = (pct) => {
      callbacks.onProgress(pct, currentPhaseLabel, currentPhaseSub);
    };

    let currentPhaseLabel = 'Initializing FFmpeg.wasm...';
    let currentPhaseSub = 'Preparing local WebAssembly engine';
    let mounted = false;
    let fallbackInputPath: string | null = null;
    const mountDir = '/input';

    const ffmpeg = await this.ensureLoaded(callbacks.onLoadStatus, callbacks.onLog);
    if (this.cancelled) {
      throw new DOMException('Cancelled by user', 'AbortError');
    }

    const modeLabel =
      this.activeMode === 'mt' ? 'FFmpeg.wasm (Multi-Threaded)' : 'FFmpeg.wasm (Single-Threaded)';

    const file = jobInput.metadata.file;
    let inputFSPath = '';

    callbacks.onProgress(2, 'Mounting file with WORKERFS...', file.name);

    try {
      await ffmpeg.createDir(mountDir).catch(() => {});
      const ok = await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, mountDir);
      if (!ok) {
        throw new Error('WORKERFS mount returned false');
      }
      mounted = true;
      inputFSPath = `${mountDir}/${file.name}`;
      callbacks.onLog(`[WORKERFS] Mounted "${file.name}" directly without RAM duplication.`);
    } catch (mountErr) {
      callbacks.onLog(
        `[WORKERFS] Mount unavailable (${mountErr instanceof Error ? mountErr.message : String(mountErr)}); falling back to MEMFS.`
      );
      const ext =
        (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
      fallbackInputPath = `input_mem.${ext}`;
      await ffmpeg.writeFile(fallbackInputPath, new Uint8Array(await file.arrayBuffer()));
      inputFSPath = fallbackInputPath;
    }

    const plan = buildFfmpegCommandPlan({
      ...jobInput,
      inputFSPath,
    });

    try {
      let offset = 0;
      for (let i = 0; i < plan.passes.length; i++) {
        if (this.cancelled) {
          throw new DOMException('Cancelled by user', 'AbortError');
        }

        const passArgs = plan.passes[i];
        const weight = plan.phaseWeights[i] ?? 1 / plan.passes.length;
        this.phaseOffset = offset;
        this.phaseScale = weight;

        currentPhaseLabel =
          plan.passes.length > 1
            ? `Pass ${i + 1}/${plan.passes.length}: ${plan.modeSummary}`
            : `Processing: ${plan.modeSummary}`;
        currentPhaseSub = modeLabel;
        callbacks.onProgress(Math.round(offset * 100), currentPhaseLabel, currentPhaseSub);
        callbacks.onLog(`[Command] ffmpeg ${passArgs.join(' ')}`);

        const exitCode = await ffmpeg.exec(passArgs);
        if (this.cancelled) {
          throw new DOMException('Cancelled by user', 'AbortError');
        }
        if (exitCode !== 0) {
          throw new Error(`FFmpeg exited with code ${exitCode}. Open terminal logs for details.`);
        }
        offset += weight;
      }

      callbacks.onProgress(99, 'Finalizing output file...', plan.downloadName);
      const outData = await ffmpeg.readFile(plan.outputFSName);
      const bytes =
        outData instanceof Uint8Array
          ? outData.slice()
          : new TextEncoder().encode(outData);
      const blob = new Blob([bytes], { type: plan.mimeType });

      return {
        blob,
        outExt: plan.outExt,
        mimeType: plan.mimeType,
        downloadName: plan.downloadName,
        modeSummary: plan.modeSummary,
        engineUsed: 'ffmpeg',
      };
    } finally {
      this.activeProgressHandler = null;
      if (this.ffmpeg && this.ffmpeg.loaded) {
        await this.ffmpeg.deleteFile(plan.outputFSName).catch(() => {});
        for (const extra of plan.extraCleanupFiles) {
          await this.ffmpeg.deleteFile(extra).catch(() => {});
        }
        if (fallbackInputPath) {
          await this.ffmpeg.deleteFile(fallbackInputPath).catch(() => {});
        }
        if (mounted) {
          await this.ffmpeg.unmount(mountDir).catch(() => {});
          await this.ffmpeg.deleteDir(mountDir).catch(() => {});
        }
      }
    }
  }
}

export const ffmpegEngine = new FFmpegController();
