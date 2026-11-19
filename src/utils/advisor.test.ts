import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_TRANSFORM,
  type VideoMetadata,
} from '../types/studio';
import { evaluateQualityForecast, recommendOptimalSettings } from './advisor';

const sampleMeta: VideoMetadata = {
  file: new File([''], 'clip.mp4', { type: 'video/mp4' }),
  name: 'clip.mp4',
  size: 120_000_000,
  duration: 180,
  width: 1920,
  height: 1080,
  fps: 60,
  hasAudio: true,
  videoCodec: 'avc',
  audioCodec: 'aac',
  browserPlayable: true,
  probeSource: 'mediabunny',
};

describe('quality advisor', () => {
  it('classifies BPP tiers accurately', () => {
    const crisp = evaluateQualityForecast({
      videoKbps: 7000,
      outputWidth: 1920,
      outputHeight: 1080,
      sourceFps: 30,
      fpsCap: 'original',
    });
    expect(crisp.tier).toBe('crisp');

    const blocky = evaluateQualityForecast({
      videoKbps: 350,
      outputWidth: 1920,
      outputHeight: 1080,
      sourceFps: 60,
      fpsCap: 'original',
    });
    expect(blocky.tier).toBe('blocky');
  });

  it('recommends downscale, fps cap, 2-pass, and mono to rescue tight 1080p60 clips', () => {
    const tightSettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      mode: 'target' as const,
      targetMB: 10,
      twoPass: false,
      resolution: 'original' as const,
      fpsCap: 'original' as const,
    };

    const rec = recommendOptimalSettings(sampleMeta, 180, DEFAULT_TRANSFORM, tightSettings);
    expect(rec).not.toBeNull();
    expect(rec!.changesSummary.length).toBeGreaterThan(0);
    expect(rec!.suggestedSettings.fpsCap).not.toBe('original');
    expect(rec!.suggestedSettings.resolution).not.toBe('original');
    expect(rec!.projectedBpp).toBeGreaterThan(0.035);
  });

  it('returns null when quality is already good or crisp', () => {
    const easySettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      mode: 'target' as const,
      targetMB: 25,
    };
    const rec = recommendOptimalSettings(sampleMeta, 10, DEFAULT_TRANSFORM, easySettings);
    expect(rec).toBeNull();
  });
});
