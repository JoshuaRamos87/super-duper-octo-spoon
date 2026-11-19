import type { BitrateCalculation } from '../types/studio';

export interface TargetBitrateParams {
  targetMB: number;
  trimDurationSec: number;
  totalDurationSec: number;
  originalFileSize: number;
  speed: number;
  muteOutput: boolean;
  audioMono: boolean;
  hasAudio: boolean;
  twoPass: boolean;
}

/**
 * Computes exact decimal video & audio bitrates (kbps) to fit under targetMB (1 MB = 1,000,000 bytes).
 * Fixes the prototype's binary/decimal mismatch so FFmpeg `-b:v ...k` stays safely below upload limits.
 */
export function calculateTargetBitrates(params: TargetBitrateParams): BitrateCalculation {
  const safeTargetMB = Math.max(0.5, Number(params.targetMB) || 10);
  const targetBytes = safeTargetMB * 1_000_000;

  // 2-pass VBR hits target size much more accurately than 1-pass ABR
  const safetyMargin = params.twoPass ? 0.97 : 0.94;
  const speed = Math.max(0.25, Math.min(8, Number(params.speed) || 1));
  const trimDurationSec = Math.max(0.1, Number(params.trimDurationSec) || 0.1);
  const effectiveDurationSec = Math.max(0.1, trimDurationSec / speed);

  // FFmpeg `k` suffix is decimal kilobits/sec (1,000 bits/s)
  const totalKbpsRaw = (targetBytes * safetyMargin * 8) / 1000 / effectiveDurationSec;

  let audioKbps = 0;
  if (!params.muteOutput && params.hasAudio) {
    if (params.audioMono) {
      audioKbps = totalKbpsRaw >= 220 ? 64 : 48;
    } else if (totalKbpsRaw >= 500) {
      audioKbps = 128;
    } else if (totalKbpsRaw >= 250) {
      audioKbps = 96;
    } else if (totalKbpsRaw >= 150) {
      audioKbps = 64;
    } else {
      audioKbps = 48;
    }
  }

  const videoKbps = Math.max(50, Math.floor(totalKbpsRaw - audioKbps));

  const estimatedTrimBytes =
    params.totalDurationSec > 0
      ? params.originalFileSize * Math.min(1, trimDurationSec / params.totalDurationSec)
      : params.originalFileSize;

  const alreadyFitsTarget =
    params.originalFileSize > 0 &&
    params.totalDurationSec > 0 &&
    estimatedTrimBytes <= targetBytes * 0.96;

  return {
    targetBytes,
    totalKbps: Math.floor(totalKbpsRaw),
    audioKbps,
    videoKbps,
    effectiveDurationSec,
    estimatedTrimBytes,
    alreadyFitsTarget,
  };
}
