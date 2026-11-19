import type {
  ExportSettings,
  FpsCapOption,
  OptimizationRecommendation,
  QualityForecast,
  QualityTier,
  ResolutionOption,
  TransformSettings,
  VideoMetadata,
} from '../types/studio';
import { calculateTargetBitrates } from './bitrate';
import { computeEffectiveDimensions } from './filters';

export interface ForecastInput {
  videoKbps: number;
  outputWidth: number;
  outputHeight: number;
  sourceFps: number;
  fpsCap: FpsCapOption;
}

export function getEffectiveFps(sourceFps: number, fpsCap: FpsCapOption): number {
  const baseFps = sourceFps > 1 ? sourceFps : 30;
  if (fpsCap === 'original') return baseFps;
  return Math.min(baseFps, fpsCap);
}

export function classifyBpp(bpp: number): { tier: QualityTier; label: string } {
  if (bpp >= 0.10) return { tier: 'crisp', label: 'Crisp' };
  if (bpp >= 0.06) return { tier: 'good', label: 'Good' };
  if (bpp >= 0.035) return { tier: 'tight', label: 'Tight' };
  return { tier: 'blocky', label: 'Blocky' };
}

export function evaluateQualityForecast(input: ForecastInput): QualityForecast {
  const outputFps = getEffectiveFps(input.sourceFps, input.fpsCap);
  const pixelsPerSec =
    Math.max(2, input.outputWidth) * Math.max(2, input.outputHeight) * Math.max(1, outputFps);
  const bpp = (Math.max(1, input.videoKbps) * 1000) / pixelsPerSec;
  const { tier, label } = classifyBpp(bpp);

  return {
    bpp,
    tier,
    label,
    outputWidth: input.outputWidth,
    outputHeight: input.outputHeight,
    outputFps,
  };
}

const RESOLUTION_LADDER: ResolutionOption[] = ['original', '1080', '720', '480', '360'];

export function recommendOptimalSettings(
  metadata: VideoMetadata,
  trimDurationSec: number,
  transform: TransformSettings,
  settings: ExportSettings
): OptimizationRecommendation | null {
  if (settings.mode !== 'target') return null;

  const currentDims = computeEffectiveDimensions(
    metadata.width,
    metadata.height,
    transform,
    settings.resolution
  );
  const currentBitrate = calculateTargetBitrates({
    targetMB: settings.targetMB,
    trimDurationSec,
    totalDurationSec: metadata.duration,
    originalFileSize: metadata.size,
    speed: settings.speed,
    muteOutput: settings.muteOutput,
    audioMono: settings.audioMono,
    hasAudio: metadata.hasAudio,
    twoPass: settings.twoPass,
  });
  const currentForecast = evaluateQualityForecast({
    videoKbps: currentBitrate.videoKbps,
    outputWidth: currentDims.outputWidth,
    outputHeight: currentDims.outputHeight,
    sourceFps: metadata.fps,
    fpsCap: settings.fpsCap,
  });

  if (currentForecast.tier === 'crisp' || currentForecast.tier === 'good') {
    return null;
  }

  const candidate: ExportSettings = { ...settings };
  const changes: string[] = [];

  const evalCandidate = () => {
    const dims = computeEffectiveDimensions(
      metadata.width,
      metadata.height,
      transform,
      candidate.resolution
    );
    const br = calculateTargetBitrates({
      targetMB: candidate.targetMB,
      trimDurationSec,
      totalDurationSec: metadata.duration,
      originalFileSize: metadata.size,
      speed: candidate.speed,
      muteOutput: candidate.muteOutput,
      audioMono: candidate.audioMono,
      hasAudio: metadata.hasAudio,
      twoPass: candidate.twoPass,
    });
    const fc = evaluateQualityForecast({
      videoKbps: br.videoKbps,
      outputWidth: dims.outputWidth,
      outputHeight: dims.outputHeight,
      sourceFps: metadata.fps,
      fpsCap: candidate.fpsCap,
    });
    return { dims, br, fc };
  };

  // Step 1: Cap FPS to 30 if source/current FPS is higher than 30
  const effectiveSrcFps = metadata.fps > 1 ? metadata.fps : 30;
  if (
    effectiveSrcFps > 32 &&
    (candidate.fpsCap === 'original' || candidate.fpsCap > 30)
  ) {
    candidate.fpsCap = 30;
    changes.push('Cap FPS to 30');
  }

  let check = evalCandidate();
  if (check.fc.bpp >= 0.065) {
    return buildResult(candidate, changes, check.fc, check.br.videoKbps);
  }

  // Step 2: Enable 2-pass VBR for better bit efficiency & sizing
  if (!candidate.twoPass) {
    candidate.twoPass = true;
    changes.push('Enable 2-Pass VBR');
    check = evalCandidate();
    if (check.fc.bpp >= 0.065) {
      return buildResult(candidate, changes, check.fc, check.br.videoKbps);
    }
  }

  // Step 3: Mono audio if audio is active and bitrate is tight
  if (!candidate.muteOutput && metadata.hasAudio && !candidate.audioMono) {
    candidate.audioMono = true;
    changes.push('Mono audio (64k)');
    check = evalCandidate();
    if (check.fc.bpp >= 0.065) {
      return buildResult(candidate, changes, check.fc, check.br.videoKbps);
    }
  }

  // Step 4: Step down resolution along ladder until bpp >= 0.065
  const startIdx = Math.max(0, RESOLUTION_LADDER.indexOf(candidate.resolution));
  for (let i = startIdx + 1; i < RESOLUTION_LADDER.length; i++) {
    const nextRes = RESOLUTION_LADDER[i];
    const nextH = Number(nextRes);
    const baseDims = computeEffectiveDimensions(metadata.width, metadata.height, transform, 'original');
    if (baseDims.outputHeight <= nextH) continue;

    candidate.resolution = nextRes;
    // Replace previous resolution label if already stepped once
    const resIdx = changes.findIndex((c) => c.startsWith('Downscale to '));
    const label = `Downscale to ${nextRes}p`;
    if (resIdx >= 0) changes[resIdx] = label;
    else changes.push(label);

    check = evalCandidate();
    if (check.fc.bpp >= 0.065) {
      return buildResult(candidate, changes, check.fc, check.br.videoKbps);
    }
  }

  // Step 5: Cap FPS to 24 if still tight
  if (getEffectiveFps(metadata.fps, candidate.fpsCap) > 25) {
    candidate.fpsCap = 24;
    const fpsIdx = changes.findIndex((c) => c.startsWith('Cap FPS to '));
    if (fpsIdx >= 0) changes[fpsIdx] = 'Cap FPS to 24';
    else changes.push('Cap FPS to 24');
    check = evalCandidate();
  }

  if (changes.length === 0) return null;
  return buildResult(candidate, changes, check.fc, check.br.videoKbps);
}

function buildResult(
  suggestedSettings: ExportSettings,
  changesSummary: string[],
  forecast: QualityForecast,
  projectedVideoKbps: number
): OptimizationRecommendation {
  return {
    suggestedSettings,
    changesSummary,
    projectedBpp: forecast.bpp,
    projectedTier: forecast.tier,
    projectedVideoKbps,
  };
}
