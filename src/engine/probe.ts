import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { VideoMetadata } from '../types/studio';

export interface ProbedStreamInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  source: 'mediabunny' | 'ffmpeg';
}

export async function probeWithMediabunny(file: File): Promise<ProbedStreamInfo | null> {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });

  try {
    const readable = await input.canRead();
    if (!readable) return null;

    let duration = (await input.getDurationFromMetadata()) ?? 0;
    if (!Number.isFinite(duration) || duration <= 0) {
      duration = await input.computeDuration().catch(() => 0);
    }

    const vTrack = await input.getPrimaryVideoTrack();
    const aTrack = await input.getPrimaryAudioTrack();

    let width = 0;
    let height = 0;
    let fps = 30;
    let videoCodec: string | null = null;

    if (vTrack) {
      width = await vTrack.getDisplayWidth().catch(() => 0);
      height = await vTrack.getDisplayHeight().catch(() => 0);
      videoCodec = await vTrack.getCodec().catch(() => null);
      try {
        const metrics = await vTrack.computeFrameRateMetrics({ targetPacketCount: 96 });
        if (Number.isFinite(metrics.bestGuessFrameRate) && metrics.bestGuessFrameRate > 0) {
          fps = Math.round(metrics.bestGuessFrameRate * 100) / 100;
        }
      } catch {
        fps = 30;
      }
    }

    const hasAudio = Boolean(aTrack);
    const audioCodec = aTrack ? await aTrack.getCodec().catch(() => null) : null;

    return {
      duration: Number.isFinite(duration) ? duration : 0,
      width,
      height,
      fps,
      hasAudio,
      videoCodec,
      audioCodec,
      source: 'mediabunny',
    };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

/**
 * Parses `ffmpeg -i <file>` stderr output for Duration, Video dimensions/FPS, and Audio stream.
 */
export function parseFfmpegProbeOutput(logs: string[]): ProbedStreamInfo {
  const text = logs.join('\n');

  let duration = 0;
  const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (durMatch) {
    const hrs = Number(durMatch[1]);
    const mins = Number(durMatch[2]);
    const secs = Number(durMatch[3]);
    if (Number.isFinite(hrs) && Number.isFinite(mins) && Number.isFinite(secs)) {
      duration = hrs * 3600 + mins * 60 + secs;
    }
  }

  let width = 0;
  let height = 0;
  let fps = 30;
  let videoCodec: string | null = null;
  const videoLineMatch = text.match(/Stream\s+#\d+:\d+[^:]*:\s*Video:\s*([^\n]+)/i);
  if (videoLineMatch) {
    const line = videoLineMatch[1];
    const codecMatch = line.match(/^([a-z0-9_.-]+)/i);
    if (codecMatch) videoCodec = codecMatch[1];

    const dimMatch = line.match(/(?:,\s*|\s)(\d{2,5})x(\d{2,5})(?:\s|\[|,|$)/);
    if (dimMatch) {
      width = Number(dimMatch[1]);
      height = Number(dimMatch[2]);
    }

    const fpsMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:fps|tbr)/i);
    if (fpsMatch) {
      const parsedFps = Number(fpsMatch[1]);
      if (Number.isFinite(parsedFps) && parsedFps > 0 && parsedFps <= 240) {
        fps = parsedFps;
      }
    }
  }

  let hasAudio = false;
  let audioCodec: string | null = null;
  const audioMatch = text.match(/Stream\s+#\d+:\d+[^:]*:\s*Audio:\s*([a-z0-9_.-]+)/i);
  if (audioMatch) {
    hasAudio = true;
    audioCodec = audioMatch[1];
  }

  return {
    duration,
    width,
    height,
    fps,
    hasAudio,
    videoCodec,
    audioCodec,
    source: 'ffmpeg',
  };
}

export async function enrichVideoMetadata(
  file: File,
  html5Info: { duration: number; width: number; height: number; playable: boolean },
  fallbackFfmpegProbe: (file: File) => Promise<ProbedStreamInfo | null>
): Promise<VideoMetadata> {
  const mb = await probeWithMediabunny(file);

  let duration = html5Info.duration > 0 ? html5Info.duration : mb?.duration ?? 0;
  let width = html5Info.width > 0 ? html5Info.width : mb?.width ?? 0;
  let height = html5Info.height > 0 ? html5Info.height : mb?.height ?? 0;
  let fps = mb?.fps && mb.fps > 0 ? mb.fps : 30;
  let hasAudio = mb ? mb.hasAudio : true;
  let videoCodec = mb?.videoCodec ?? null;
  let audioCodec = mb?.audioCodec ?? null;
  let probeSource: VideoMetadata['probeSource'] = html5Info.playable
    ? 'html5'
    : mb && mb.duration > 0
      ? 'mediabunny'
      : 'ffmpeg';

  // If HTML5 failed (e.g. MKV/HEVC) and Mediabunny couldn't get duration/dimensions, fall back to FFmpeg probe
  if ((!html5Info.playable || duration <= 0 || width <= 0) && (duration <= 0 || width <= 0)) {
    const ff = await fallbackFfmpegProbe(file);
    if (ff) {
      if (duration <= 0 && ff.duration > 0) duration = ff.duration;
      if (width <= 0 && ff.width > 0) width = ff.width;
      if (height <= 0 && ff.height > 0) height = ff.height;
      if (ff.fps > 0) fps = ff.fps;
      hasAudio = ff.hasAudio;
      videoCodec = videoCodec || ff.videoCodec;
      audioCodec = audioCodec || ff.audioCodec;
      probeSource = 'ffmpeg';
    }
  }

  return {
    file,
    name: file.name,
    size: file.size,
    duration,
    width,
    height,
    fps,
    hasAudio,
    videoCodec,
    audioCodec,
    browserPlayable: html5Info.playable,
    probeSource,
  };
}
