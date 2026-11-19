import { describe, expect, it } from 'vitest';
import { calculateTargetBitrates } from './bitrate';

describe('calculateTargetBitrates', () => {
  it('computes decimal kbps so a 10 MB target fits strictly under 10,000,000 bytes', () => {
    const res = calculateTargetBitrates({
      targetMB: 10,
      trimDurationSec: 40,
      totalDurationSec: 40,
      originalFileSize: 50_000_000,
      speed: 1,
      muteOutput: false,
      audioMono: false,
      hasAudio: true,
      twoPass: false,
    });

    // Total effective kbps * duration / 8 * 1000 must stay under 10_000_000 bytes
    const projectedBytes = ((res.videoKbps + res.audioKbps) * 1000 * 40) / 8;
    expect(projectedBytes).toBeLessThanOrEqual(10_000_000 * 0.94 + 1000);
    expect(res.audioKbps).toBe(128);
    expect(res.alreadyFitsTarget).toBe(false);
  });

  it('gives higher bitrate budget in 2-pass mode than 1-pass mode', () => {
    const onePass = calculateTargetBitrates({
      targetMB: 10,
      trimDurationSec: 60,
      totalDurationSec: 60,
      originalFileSize: 40_000_000,
      speed: 1,
      muteOutput: false,
      audioMono: false,
      hasAudio: true,
      twoPass: false,
    });
    const twoPass = calculateTargetBitrates({
      targetMB: 10,
      trimDurationSec: 60,
      totalDurationSec: 60,
      originalFileSize: 40_000_000,
      speed: 1,
      muteOutput: false,
      audioMono: false,
      hasAudio: true,
      twoPass: true,
    });
    expect(twoPass.videoKbps).toBeGreaterThan(onePass.videoKbps);
  });

  it('doubles effective video bitrate when playback speed is 2x', () => {
    const normal = calculateTargetBitrates({
      targetMB: 10,
      trimDurationSec: 60,
      totalDurationSec: 60,
      originalFileSize: 40_000_000,
      speed: 1,
      muteOutput: true,
      audioMono: false,
      hasAudio: true,
      twoPass: false,
    });
    const fast = calculateTargetBitrates({
      targetMB: 10,
      trimDurationSec: 60,
      totalDurationSec: 60,
      originalFileSize: 40_000_000,
      speed: 2,
      muteOutput: true,
      audioMono: false,
      hasAudio: true,
      twoPass: false,
    });
    expect(fast.effectiveDurationSec).toBeCloseTo(30, 5);
    expect(fast.videoKbps).toBeGreaterThan(normal.videoKbps * 1.95);
  });

  it('reallocates audio bitrate when muted or downmixed to mono', () => {
    const stereo = calculateTargetBitrates({
      targetMB: 10,
      trimDurationSec: 60,
      totalDurationSec: 60,
      originalFileSize: 30_000_000,
      speed: 1,
      muteOutput: false,
      audioMono: false,
      hasAudio: true,
      twoPass: false,
    });
    const mono = calculateTargetBitrates({
      targetMB: 10,
      trimDurationSec: 60,
      totalDurationSec: 60,
      originalFileSize: 30_000_000,
      speed: 1,
      muteOutput: false,
      audioMono: true,
      hasAudio: true,
      twoPass: false,
    });
    const muted = calculateTargetBitrates({
      targetMB: 10,
      trimDurationSec: 60,
      totalDurationSec: 60,
      originalFileSize: 30_000_000,
      speed: 1,
      muteOutput: true,
      audioMono: false,
      hasAudio: true,
      twoPass: false,
    });
    expect(stereo.audioKbps).toBe(128);
    expect(mono.audioKbps).toBe(64);
    expect(muted.audioKbps).toBe(0);
    expect(muted.videoKbps).toBeGreaterThan(mono.videoKbps);
    expect(mono.videoKbps).toBeGreaterThan(stereo.videoKbps);
  });

  it('detects when trimmed clip already fits under target MB', () => {
    const res = calculateTargetBitrates({
      targetMB: 10,
      trimDurationSec: 10,
      totalDurationSec: 100,
      originalFileSize: 40_000_000,
      speed: 1,
      muteOutput: false,
      audioMono: false,
      hasAudio: true,
      twoPass: false,
    });
    expect(res.estimatedTrimBytes).toBe(4_000_000);
    expect(res.alreadyFitsTarget).toBe(true);
  });
});
