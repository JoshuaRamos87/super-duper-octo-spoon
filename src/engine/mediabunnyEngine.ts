import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import type {
  ExportSettings,
  TransformSettings,
  TrimSegment,
  VideoMetadata,
} from '../types/studio';
import { calculateTargetBitrates } from '../utils/bitrate';
import { computeEffectiveDimensions } from '../utils/filters';
import { getTotalSegmentsDuration } from '../utils/timecode';
import type { EngineResult } from './ffmpegEngine';

export interface WebCodecsCapabilityResult {
  supported: boolean;
  reason?: string;
}

export function hasWebCodecsAPI(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
}

export function canUseWebCodecs(
  metadata: VideoMetadata,
  segments: TrimSegment[],
  transform: TransformSettings,
  settings: ExportSettings
): WebCodecsCapabilityResult {
  if (!hasWebCodecsAPI()) {
    return { supported: false, reason: 'Browser does not expose WebCodecs API' };
  }
  if (metadata.width <= 0 || metadata.height <= 0) {
    return { supported: false, reason: 'Video dimensions unknown prior to decode' };
  }
  if (segments.length !== 1) {
    return { supported: false, reason: 'Multi-segment cuts use FFmpeg filter_complex' };
  }
  if (settings.mode === 'gif') {
    return { supported: false, reason: 'GIF/WebP conversion uses FFmpeg palette pipeline' };
  }
  if (settings.mode === 'audio') {
    return { supported: false, reason: 'Audio extraction uses FFmpeg' };
  }
  if (settings.mode === 'target' && settings.twoPass) {
    return { supported: false, reason: '2-Pass exact sizing uses FFmpeg' };
  }
  if (settings.mode === 'quality' && settings.qualityMode === 'copy') {
    return { supported: false, reason: 'Lossless stream copy uses FFmpeg' };
  }
  if (Math.abs(settings.speed - 1) > 1e-4) {
    return { supported: false, reason: 'Speed adjustment uses FFmpeg setpts/atempo' };
  }
  if (transform.flipH || transform.flipV) {
    return { supported: false, reason: 'Flip transforms use FFmpeg' };
  }
  if (Math.abs(settings.audioVolume - 1) > 1e-2 || settings.audioNormalize) {
    return { supported: false, reason: 'Audio gain/normalization uses FFmpeg' };
  }

  return { supported: true };
}

export class MediabunnyController {
  private activeConversion: Conversion | null = null;
  private cancelled = false;

  public cancel(): void {
    this.cancelled = true;
    if (this.activeConversion) {
      this.activeConversion.cancel().catch(() => {});
    }
  }

  public async executeJob(
    job: {
      metadata: VideoMetadata;
      segments: TrimSegment[];
      transform: TransformSettings;
      settings: ExportSettings;
    },
    callbacks: {
      onProgress: (pct: number, statusText: string, subtext: string) => void;
      onLog: (msg: string) => void;
    }
  ): Promise<EngineResult> {
    this.cancelled = false;
    this.activeConversion = null;

    const { metadata, segments, transform, settings } = job;
    const seg = segments[0];
    const trimDur = getTotalSegmentsDuration(segments);
    const baseName = metadata.name.replace(/\.[^/.]+$/, '') || 'clip';

    const dims = computeEffectiveDimensions(
      metadata.width,
      metadata.height,
      transform,
      settings.resolution
    );

    const calc = calculateTargetBitrates({
      targetMB: settings.targetMB,
      trimDurationSec: trimDur,
      totalDurationSec: metadata.duration,
      originalFileSize: metadata.size,
      speed: settings.speed,
      muteOutput: settings.muteOutput,
      audioMono: settings.audioMono,
      hasAudio: metadata.hasAudio,
      twoPass: false,
    });

    const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], {
      width: dims.outputWidth,
      height: dims.outputHeight,
    });
    if (!videoCodec) {
      throw new Error('No hardware/WebCodecs video encoder available for this resolution.');
    }

    const videoQuality =
      settings.mode === 'target'
        ? new Quality({ bitrate: calc.videoKbps * 1000, bitrateMode: 'variable' })
        : new Quality({
            quality: Math.max(
              0.15,
              Math.min(0.95, 1 - ((settings.crf - 18) / 17) * 0.78)
            ),
          });

    const includeAudio = !settings.muteOutput && metadata.hasAudio;
    let audioCodec: 'aac' | 'opus' | null = null;
    if (includeAudio) {
      const candidate = await getFirstEncodableAudioCodec(['aac', 'opus']);
      if (candidate === 'aac' || candidate === 'opus') {
        audioCodec = candidate;
      } else {
        throw new Error('No WebCodecs audio encoder available; falling back to FFmpeg.');
      }
    }

    const audioBitrateBps =
      (settings.mode === 'target' ? calc.audioKbps : settings.audioMono ? 64 : 128) * 1000;

    const input = new Input({
      source: new BlobSource(metadata.file),
      formats: ALL_FORMATS,
    });
    const bufferTarget = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: bufferTarget,
    });

    try {
      const statusLabel =
        settings.mode === 'target'
          ? `GPU Encoding to ~${settings.targetMB} MB MP4...`
          : `GPU Re-encoding MP4 (CRF ${settings.crf})...`;
      const subLabel = `WebCodecs (${videoCodec.toUpperCase()} • ${dims.outputWidth}×${dims.outputHeight})`;

      callbacks.onProgress(2, statusLabel, subLabel);
      callbacks.onLog(`[WebCodecs] Initializing Mediabunny pipeline (${subLabel})...`);

      const conversion = await Conversion.init({
        input,
        output,
        showWarnings: false,
        copy: false,
        trim: {
          start: Math.max(0, seg.start),
          end: Math.max(seg.start + 0.05, seg.end),
        },
        video: {
          codec: videoCodec,
          quality: videoQuality,
          rotate: transform.rotate,
          allowTransformationMetadata: false,
          crop: dims.pixelCrop
            ? {
                left: dims.pixelCrop.x,
                top: dims.pixelCrop.y,
                width: dims.pixelCrop.width,
                height: dims.pixelCrop.height,
              }
            : undefined,
          width: dims.outputWidth,
          height: dims.outputHeight,
          frameRate: settings.fpsCap !== 'original' ? settings.fpsCap : undefined,
          forceTranscode: true,
        },
        audio:
          !includeAudio || !audioCodec
            ? { discard: true }
            : {
                codec: audioCodec,
                numberOfChannels: settings.audioMono ? 1 : undefined,
                quality: new Quality({ bitrate: audioBitrateBps }),
                forceTranscode: true,
              },
      });

      if (!conversion.isValid) {
        const reasons = conversion.discardedTracks
          .map((d) => `${d.track.type}:${d.reason}`)
          .join(', ');
        throw new Error(`WebCodecs conversion invalid (${reasons || 'unsupported stream'})`);
      }

      this.activeConversion = conversion;
      conversion.onProgress = (progress) => {
        const pct = Math.min(99, Math.max(1, Math.round(progress * 100)));
        callbacks.onProgress(pct, statusLabel, subLabel);
      };

      await conversion.execute();

      if (this.cancelled) {
        throw new DOMException('Cancelled by user', 'AbortError');
      }

      if (!bufferTarget.buffer) {
        throw new Error('WebCodecs produced an empty output buffer.');
      }

      const blob = new Blob([bufferTarget.buffer], { type: 'video/mp4' });
      const downloadName =
        settings.mode === 'target'
          ? `${baseName}_${settings.targetMB}MB.mp4`
          : `${baseName}_crf${settings.crf}.mp4`;

      return {
        blob,
        outExt: 'mp4',
        mimeType: 'video/mp4',
        downloadName,
        modeSummary:
          settings.mode === 'target'
            ? `Target ${settings.targetMB} MB (GPU • ${calc.videoKbps}k)`
            : `MP4 Re-encode (GPU • CRF ${settings.crf})`,
        engineUsed: 'webcodecs',
      };
    } catch (err) {
      if (err instanceof ConversionCanceledError || this.cancelled) {
        throw new DOMException('Cancelled by user', 'AbortError');
      }
      throw err;
    } finally {
      this.activeConversion = null;
      input.dispose();
    }
  }
}

export const mediabunnyEngine = new MediabunnyController();
