const MAX_WAVEFORM_FILE_BYTES = 150 * 1024 * 1024; // 150 MB safety limit

/**
 * Decodes normalized peak amplitudes [0..1] for timeline waveform visualization.
 * Automatically skips files over 150 MB to preserve browser memory.
 */
export async function generateAudioWaveform(
  file: File,
  bucketCount = 160,
  signal?: AbortSignal
): Promise<number[] | null> {
  if (!file || file.size > MAX_WAVEFORM_FILE_BYTES) return null;
  if (signal?.aborted) return null;

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await file.arrayBuffer();
    if (signal?.aborted) return null;

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    if (signal?.aborted) return null;

    const channelData = audioBuffer.getChannelData(0);
    if (!channelData || channelData.length === 0) return null;

    const buckets = Math.max(32, Math.min(320, bucketCount));
    const blockSize = Math.max(1, Math.floor(channelData.length / buckets));
    const peaks: number[] = [];
    let maxPeak = 0.001;

    for (let i = 0; i < buckets; i++) {
      const start = i * blockSize;
      const end = Math.min(channelData.length, start + blockSize);
      const step = Math.max(1, Math.floor((end - start) / 64));
      let peak = 0;
      for (let j = start; j < end; j += step) {
        const abs = Math.abs(channelData[j]);
        if (abs > peak) peak = abs;
      }
      peaks.push(peak);
      if (peak > maxPeak) maxPeak = peak;
    }

    return peaks.map((p) => Math.min(1, p / maxPeak));
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}
