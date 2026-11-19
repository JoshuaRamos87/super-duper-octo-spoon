export interface FilmstripFrame {
  time: number;
  dataUrl: string;
}

/**
 * Extracts evenly spaced thumbnail frames from a playable video ObjectURL.
 * Aborts cleanly if signal triggers or browser cannot decode the video.
 */
export async function generateFilmstrip(
  videoUrl: string,
  duration: number,
  frameCount = 14,
  signal?: AbortSignal
): Promise<FilmstripFrame[]> {
  if (!videoUrl || !Number.isFinite(duration) || duration <= 0.1) return [];
  if (signal?.aborted) return [];

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = videoUrl;

  const cleanup = () => {
    video.removeAttribute('src');
    video.load();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onLoaded = () => resolve();
      const onError = () => reject(new Error('Failed to decode video for thumbnails'));
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));

      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
      signal?.addEventListener('abort', onAbort, { once: true });
    });

    const vw = video.videoWidth || 160;
    const vh = video.videoHeight || 90;
    const thumbW = 128;
    const thumbH = Math.max(36, Math.round((thumbW * vh) / vw));

    const canvas = document.createElement('canvas');
    canvas.width = thumbW;
    canvas.height = thumbH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const frames: FilmstripFrame[] = [];
    const safeCount = Math.max(4, Math.min(20, frameCount));

    for (let i = 0; i < safeCount; i++) {
      if (signal?.aborted) break;
      const ratio = (i + 0.5) / safeCount;
      const targetTime = Math.min(Math.max(0.01, duration * ratio), Math.max(0.01, duration - 0.05));

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const timer = window.setTimeout(finish, 900);
        video.addEventListener(
          'seeked',
          () => {
            window.clearTimeout(timer);
            finish();
          },
          { once: true }
        );
        video.currentTime = targetTime;
      });

      if (signal?.aborted) break;
      ctx.drawImage(video, 0, 0, thumbW, thumbH);
      frames.push({
        time: targetTime,
        dataUrl: canvas.toDataURL('image/jpeg', 0.62),
      });
    }

    return frames;
  } catch {
    return [];
  } finally {
    cleanup();
  }
}
