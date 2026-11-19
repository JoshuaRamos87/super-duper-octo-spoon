import type { TransformSettings } from '../types/studio';
import { computePixelCrop, getRotatedDimensions } from './filters';

/**
 * Captures the current frame from a HTMLVideoElement with rotation, flips, and crop baked in.
 */
export async function captureTransformedFrame(
  video: HTMLVideoElement,
  transform: TransformSettings,
  format: 'image/png' | 'image/jpeg' = 'image/png'
): Promise<Blob | null> {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) return null;

  const rotated = getRotatedDimensions(srcW, srcH, transform.rotate);

  // Match FFmpeg's exact filter order: rotate onto rotCanvas, then flip on stage, then crop.
  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = rotated.width;
  rotCanvas.height = rotated.height;
  const rctx = rotCanvas.getContext('2d');
  if (!rctx) return null;

  rctx.save();
  rctx.translate(rotated.width / 2, rotated.height / 2);
  rctx.rotate((transform.rotate * Math.PI) / 180);
  rctx.drawImage(video, -srcW / 2, -srcH / 2, srcW, srcH);
  rctx.restore();

  const stage = document.createElement('canvas');
  stage.width = rotated.width;
  stage.height = rotated.height;
  const sctx = stage.getContext('2d');
  if (!sctx) return null;

  sctx.save();
  sctx.translate(rotated.width / 2, rotated.height / 2);
  sctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
  sctx.drawImage(rotCanvas, -rotated.width / 2, -rotated.height / 2);
  sctx.restore();

  const pixelCrop = computePixelCrop(rotated.width, rotated.height, transform.crop);
  const outCanvas = document.createElement('canvas');
  if (pixelCrop) {
    outCanvas.width = pixelCrop.width;
    outCanvas.height = pixelCrop.height;
    const octx = outCanvas.getContext('2d');
    if (!octx) return null;
    octx.drawImage(
      stage,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );
  } else {
    outCanvas.width = rotated.width;
    outCanvas.height = rotated.height;
    const octx = outCanvas.getContext('2d');
    if (!octx) return null;
    octx.drawImage(stage, 0, 0);
  }

  return new Promise((resolve) => {
    outCanvas.toBlob((blob) => resolve(blob), format, format === 'image/jpeg' ? 0.92 : undefined);
  });
}
