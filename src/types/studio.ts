export type OutputMode = 'target' | 'quality' | 'gif' | 'audio';
export type EnginePreference = 'auto' | 'webcodecs' | 'ffmpeg';
export type EngineUsed = 'webcodecs' | 'ffmpeg' | 'canvas';
export type QualitySubMode = 'copy' | 'crf';
export type AnimFormat = 'gif' | 'webp';
export type AnimMotion = 'normal' | 'reverse' | 'boomerang';
export type GifDither = 'bayer' | 'floyd_steinberg' | 'none';
export type ResolutionOption = 'original' | '1080' | '720' | '480' | '360';
export type FpsCapOption = 'original' | 60 | 30 | 24 | 15;
export type AudioExtractFormat = 'mp3' | 'm4a' | 'wav';
export type CropAspectRatio = 'free' | '16:9' | '9:16' | '1:1' | '4:5' | '4:3';
export type RotationDegrees = 0 | 90 | 180 | 270;

export interface VideoMetadata {
  file: File;
  name: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  browserPlayable: boolean;
  probeSource: 'html5' | 'mediabunny' | 'ffmpeg';
}

export interface TrimSegment {
  id: string;
  start: number;
  end: number;
}

export interface CropRect {
  /** Normalized [0..1] relative to post-rotation/flip frame */
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: CropAspectRatio;
}

export interface TransformSettings {
  rotate: RotationDegrees;
  flipH: boolean;
  flipV: boolean;
  crop: CropRect | null;
}

export interface ExportSettings {
  mode: OutputMode;
  enginePreference: EnginePreference;

  // Target Size mode
  targetMB: number;
  twoPass: boolean;

  // Quality / Fast Trim mode
  qualityMode: QualitySubMode;
  crf: number;

  // GIF / WebP mode
  animFormat: AnimFormat;
  gifFps: 10 | 15 | 20 | 24;
  gifWidth: 320 | 480 | 640 | 800;
  gifColors: 64 | 128 | 256;
  gifDither: GifDither;
  webpQuality: number;
  animMotion: AnimMotion;

  // Audio Extract mode
  audioExtractFormat: AudioExtractFormat;
  audioExtractBitrate: 128 | 192 | 256 | 320;

  // Shared Video & Audio adjustments
  resolution: ResolutionOption;
  fpsCap: FpsCapOption;
  speed: number;
  muteOutput: boolean;
  audioMono: boolean;
  audioVolume: number;
  audioNormalize: boolean;
}

export interface QueuedJob {
  id: string;
  label: string;
  segments: TrimSegment[];
  transform: TransformSettings;
  settings: ExportSettings;
  status: 'queued' | 'running' | 'done' | 'error';
  error?: string;
}

export interface ExportHistoryItem {
  id: string;
  createdAt: number;
  downloadName: string;
  mimeType: string;
  ext: string;
  blobUrl: string;
  sizeBytes: number;
  originalSizeBytes: number;
  modeSummary: string;
  engineUsed: EngineUsed;
  targetMB?: number;
  targetHit?: boolean;
  trimDurationSec: number;
  segmentsSnapshot: TrimSegment[];
  transformSnapshot: TransformSettings;
  settingsSnapshot: ExportSettings;
}

export type FFmpegLoadState = 'idle' | 'loading' | 'ready' | 'cached' | 'error';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface BitrateCalculation {
  targetBytes: number;
  totalKbps: number;
  audioKbps: number;
  videoKbps: number;
  effectiveDurationSec: number;
  estimatedTrimBytes: number;
  alreadyFitsTarget: boolean;
}

export type QualityTier = 'crisp' | 'good' | 'tight' | 'blocky';

export interface QualityForecast {
  bpp: number;
  tier: QualityTier;
  label: string;
  outputWidth: number;
  outputHeight: number;
  outputFps: number;
}

export interface OptimizationRecommendation {
  suggestedSettings: ExportSettings;
  changesSummary: string[];
  projectedBpp: number;
  projectedTier: QualityTier;
  projectedVideoKbps: number;
}

export interface PlatformPreset {
  id: string;
  name: string;
  badge: string;
  targetMB: number;
  description: string;
}

export interface CustomPreset {
  id: string;
  name: string;
  createdAt: number;
  settings: ExportSettings;
}

export const DEFAULT_TRANSFORM: TransformSettings = {
  rotate: 0,
  flipH: false,
  flipV: false,
  crop: null,
};

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  mode: 'target',
  enginePreference: 'auto',

  targetMB: 10,
  twoPass: false,

  qualityMode: 'copy',
  crf: 23,

  animFormat: 'gif',
  gifFps: 15,
  gifWidth: 480,
  gifColors: 256,
  gifDither: 'bayer',
  webpQuality: 78,
  animMotion: 'normal',

  audioExtractFormat: 'mp3',
  audioExtractBitrate: 192,

  resolution: 'original',
  fpsCap: 'original',
  speed: 1,
  muteOutput: false,
  audioMono: false,
  audioVolume: 1,
  audioNormalize: false,
};
