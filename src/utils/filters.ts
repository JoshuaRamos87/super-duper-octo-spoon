import type { CropRect, ResolutionOption, RotationDegrees, TransformSettings } from '../types/studio';

export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EffectiveDimensions {
  rotatedWidth: number;
  rotatedHeight: number;
  pixelCrop: PixelCrop | null;
  outputWidth: number;
  outputHeight: number;
}

/**
 * Builds valid chained FFmpeg `atempo` filters for any speed in [0.25, 8.0].
 */
export function buildAtempoChain(speed: number): string[] {
  if (!Number.isFinite(speed) || Math.abs(speed - 1) < 1e-4) return [];
  let rem = Math.max(0.25, Math.min(8.0, speed));
  const filters: string[] = [];

  while (rem > 2.0 + 1e-4) {
    filters.push('atempo=2.0');
    rem /= 2.0;
  }
  while (rem < 0.5 - 1e-4) {
    filters.push('atempo=0.5');
    rem /= 0.5;
  }
  if (Math.abs(rem - 1.0) > 1e-4) {
    const clean = Number(rem.toFixed(4));
    filters.push(`atempo=${Number.isInteger(clean) ? clean.toFixed(1) : clean}`);
  }
  return filters;
}

export function getRotatedDimensions(
  srcW: number,
  srcH: number,
  rotate: RotationDegrees
): { width: number; height: number } {
  const safeW = Math.max(2, Math.round(srcW) || 1920);
  const safeH = Math.max(2, Math.round(srcH) || 1080);
  if (rotate === 90 || rotate === 270) {
    return { width: safeH, height: safeW };
  }
  return { width: safeW, height: safeH };
}

/**
 * Converts normalized crop [0..1] into clamped even pixel coordinates for the rotated frame.
 */
export function computePixelCrop(
  rotW: number,
  rotH: number,
  crop: CropRect | null
): PixelCrop | null {
  if (!crop) return null;

  const nx = Math.max(0, Math.min(0.98, crop.x));
  const ny = Math.max(0, Math.min(0.98, crop.y));
  const nw = Math.max(0.02, Math.min(1 - nx, crop.width));
  const nh = Math.max(0.02, Math.min(1 - ny, crop.height));

  // Treat full-frame crop as no-op
  if (nx < 0.002 && ny < 0.002 && nw > 0.996 && nh > 0.996) {
    return null;
  }

  let x = Math.floor((nx * rotW) / 2) * 2;
  let y = Math.floor((ny * rotH) / 2) * 2;
  x = Math.max(0, Math.min(rotW - 2, x));
  y = Math.max(0, Math.min(rotH - 2, y));

  let width = Math.round((nw * rotW) / 2) * 2;
  let height = Math.round((nh * rotH) / 2) * 2;

  width = Math.max(2, Math.min(Math.floor((rotW - x) / 2) * 2, width));
  height = Math.max(2, Math.min(Math.floor((rotH - y) / 2) * 2, height));

  if (width >= rotW - 1 && height >= rotH - 1 && x === 0 && y === 0) {
    return null;
  }

  return { x, y, width, height };
}

/**
 * Computes exact post-rotate -> post-crop -> post-scale even pixel dimensions.
 */
export function computeEffectiveDimensions(
  srcW: number,
  srcH: number,
  transform: TransformSettings,
  resolution: ResolutionOption
): EffectiveDimensions {
  const rotated = getRotatedDimensions(srcW, srcH, transform.rotate);
  const pixelCrop = computePixelCrop(rotated.width, rotated.height, transform.crop);

  const croppedW = pixelCrop ? pixelCrop.width : rotated.width;
  const croppedH = pixelCrop ? pixelCrop.height : rotated.height;

  let outputWidth = Math.max(2, Math.floor(croppedW / 2) * 2);
  let outputHeight = Math.max(2, Math.floor(croppedH / 2) * 2);

  if (resolution !== 'original') {
    const targetH = Number(resolution);
    if (Number.isFinite(targetH) && outputHeight > targetH) {
      const evenTargetH = Math.max(2, Math.floor(targetH / 2) * 2);
      outputWidth = Math.max(2, Math.round((croppedW * evenTargetH) / croppedH / 2) * 2);
      outputHeight = evenTargetH;
    }
  }

  return {
    rotatedWidth: rotated.width,
    rotatedHeight: rotated.height,
    pixelCrop,
    outputWidth,
    outputHeight,
  };
}

export function hasActiveTransform(transform: TransformSettings): boolean {
  return (
    transform.rotate !== 0 ||
    transform.flipH ||
    transform.flipV ||
    transform.crop !== null
  );
}
