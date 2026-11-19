import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_TRANSFORM,
  type ExportSettings,
  type TransformSettings,
  type VideoMetadata,
} from '../types/studio';
import { buildFfmpegCommandPlan } from './ffmpegArgs';

function makeMeta(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    file: new File([''], overrides.name ?? 'demo.mp4'),
    name: 'demo.mp4',
    size: 50_000_000,
    duration: 30,
    width: 1920,
    height: 1080,
    fps: 60,
    hasAudio: true,
    videoCodec: 'avc',
    audioCodec: 'aac',
    browserPlayable: true,
    probeSource: 'mediabunny',
    ...overrides,
  };
}

describe('buildFfmpegCommandPlan', () => {
  it('builds 1-pass and 2-pass target size plans cleanly', () => {
    const onePass = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 2, end: 22 }],
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'target', targetMB: 10, twoPass: false },
    });
    expect(onePass.passes).toHaveLength(1);
    expect(onePass.passes[0]).toContain('-b:v');
    expect(onePass.passes[0]).toContain('+faststart');

    const twoPass = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 2, end: 22 }],
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'target', targetMB: 10, twoPass: true },
    });
    expect(twoPass.passes).toHaveLength(2);
    expect(twoPass.passes[0]).toContain('-pass');
    expect(twoPass.passes[0]).toContain('null');
    expect(twoPass.passes[1]).toContain('-movflags');
    expect(twoPass.extraCleanupFiles.length).toBeGreaterThan(0);
  });

  it('preserves source container extension for lossless copy and omits +faststart for webm/mkv', () => {
    const webmPlan = buildFfmpegCommandPlan({
      inputFSPath: '/input/recording.webm',
      fileName: 'recording.webm',
      metadata: makeMeta({ name: 'recording.webm' }),
      segments: [{ id: 's1', start: 0, end: 10 }],
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'quality', qualityMode: 'copy' },
    });
    expect(webmPlan.outExt).toBe('webm');
    expect(webmPlan.outputFSName).toBe('output.webm');
    expect(webmPlan.passes[0]).not.toContain('+faststart');

    const mkvPlan = buildFfmpegCommandPlan({
      inputFSPath: '/input/capture.mkv',
      fileName: 'capture.mkv',
      metadata: makeMeta({ name: 'capture.mkv' }),
      segments: [{ id: 's1', start: 0, end: 10 }],
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'quality', qualityMode: 'copy' },
    });
    expect(mkvPlan.outExt).toBe('mkv');
    expect(mkvPlan.passes[0]).not.toContain('+faststart');

    const mp4Plan = buildFfmpegCommandPlan({
      inputFSPath: '/input/clip.mp4',
      fileName: 'clip.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 0, end: 10 }],
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'quality', qualityMode: 'copy' },
    });
    expect(mp4Plan.outExt).toBe('mp4');
    expect(mp4Plan.passes[0]).toContain('+faststart');
  });

  it('places -t after all -i inputs in GIF Pass 2 and handles boomerang via trim+split+reverse+concat', () => {
    const gifLinear = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 3, end: 8 }],
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'gif', animFormat: 'gif', animMotion: 'normal' },
    });
    const pass2 = gifLinear.passes[1];
    const lastI = pass2.lastIndexOf('-i');
    const tIndex = pass2.indexOf('-t');
    expect(tIndex).toBeGreaterThan(lastI);
    expect(pass2[tIndex + 1]).toBe('5.000');

    const gifBoomerang = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 3, end: 8 }],
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'gif', animFormat: 'gif', animMotion: 'boomerang' },
    });
    expect(gifBoomerang.passes[0]).not.toContain('-t');
    expect(gifBoomerang.passes[1]).not.toContain('-t');
    expect(gifBoomerang.passes[1].join(' ')).toContain('trim=duration=5.000');
    expect(gifBoomerang.passes[1].join(' ')).toContain('split[ba][bb];[bb]reverse[br];[ba][br]concat=n=2:v=1:a=0');
  });

  it('places -t after -i for WebP and scales -t with speed and chains atempo', () => {
    const webpPlan = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 1, end: 5 }],
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'gif', animFormat: 'webp', speed: 2 },
    });
    const wArgs = webpPlan.passes[0];
    expect(wArgs.indexOf('-t')).toBeGreaterThan(wArgs.indexOf('-i'));
    expect(wArgs[wArgs.indexOf('-t') + 1]).toBe('2.000');

    const speed4x = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 0, end: 12 }],
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'quality', qualityMode: 'crf', speed: 4 },
    });
    const args4x = speed4x.passes[0];
    expect(args4x[args4x.indexOf('-t') + 1]).toBe('3.000');
    expect(args4x[args4x.indexOf('-af') + 1]).toContain('atempo=2.0,atempo=2.0');

    const speedHalf = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 0, end: 5 }],
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'quality', qualityMode: 'crf', speed: 0.5 },
    });
    const argsHalf = speedHalf.passes[0];
    expect(argsHalf[argsHalf.indexOf('-t') + 1]).toBe('10.000');
    expect(argsHalf[argsHalf.indexOf('-af') + 1]).toContain('atempo=0.5');
  });

  it('builds even crop+rotate filters and even-dimension safeguard for odd inputs', () => {
    const transform: TransformSettings = {
      rotate: 90,
      flipH: true,
      flipV: false,
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5, aspectRatio: 'free' },
    };
    const plan = buildFfmpegCommandPlan({
      inputFSPath: '/input/odd.mp4',
      fileName: 'odd.mp4',
      metadata: makeMeta({ width: 1081, height: 1921 }),
      segments: [{ id: 's1', start: 0, end: 5 }],
      transform,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'quality', qualityMode: 'crf', resolution: 'original' },
    });
    const vf = plan.passes[0][plan.passes[0].indexOf('-vf') + 1];
    expect(vf).toContain('transpose=1,hflip,crop=');
    expect(vf).toContain('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  });

  it('builds multi-segment concat graphs with and without audio', () => {
    const segs = [
      { id: '1', start: 0, end: 4 },
      { id: '2', start: 8, end: 14 },
    ];
    const withAudio = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta({ hasAudio: true }),
      segments: segs,
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'quality', qualityMode: 'crf' },
    });
    const fcAudio = withAudio.passes[0][withAudio.passes[0].indexOf('-filter_complex') + 1];
    expect(fcAudio).toContain('concat=n=2:v=1:a=1[vcat][acat]');

    const muted = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta({ hasAudio: true }),
      segments: segs,
      transform: DEFAULT_TRANSFORM,
      settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'quality', qualityMode: 'crf', muteOutput: true },
    });
    const fcMuted = muted.passes[0][muted.passes[0].indexOf('-filter_complex') + 1];
    expect(fcMuted).toContain('concat=n=2:v=1:a=0[vcat]');
    expect(muted.passes[0]).toContain('-an');
  });

  it('builds audio extraction commands for MP3, M4A, WAV and rejects silent videos', () => {
    const cases: { fmt: ExportSettings['audioExtractFormat']; codec: string }[] = [
      { fmt: 'mp3', codec: 'libmp3lame' },
      { fmt: 'm4a', codec: 'aac' },
      { fmt: 'wav', codec: 'pcm_s16le' },
    ];
    for (const c of cases) {
      const plan = buildFfmpegCommandPlan({
        inputFSPath: '/input/demo.mp4',
        fileName: 'demo.mp4',
        metadata: makeMeta({ hasAudio: true }),
        segments: [{ id: 's1', start: 1, end: 6 }],
        transform: DEFAULT_TRANSFORM,
        settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'audio', audioExtractFormat: c.fmt },
      });
      expect(plan.outExt).toBe(c.fmt);
      expect(plan.passes[0]).toContain(c.codec);
    }

    expect(() =>
      buildFfmpegCommandPlan({
        inputFSPath: '/input/silent.mp4',
        fileName: 'silent.mp4',
        metadata: makeMeta({ hasAudio: false }),
        segments: [{ id: 's1', start: 0, end: 5 }],
        transform: DEFAULT_TRANSFORM,
        settings: { ...DEFAULT_EXPORT_SETTINGS, mode: 'audio', audioExtractFormat: 'mp3' },
      })
    ).toThrow(/no audio track/i);
  });

  it('emits custom encodingPreset across 1-pass target, 2-pass target, and CRF modes', () => {
    const onePassUltra = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 0, end: 10 }],
      transform: DEFAULT_TRANSFORM,
      settings: {
        ...DEFAULT_EXPORT_SETTINGS,
        mode: 'target',
        twoPass: false,
        encodingPreset: 'ultrafast',
      },
    });
    expect(onePassUltra.passes[0][onePassUltra.passes[0].indexOf('-preset') + 1]).toBe('ultrafast');

    const twoPassFast = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 0, end: 10 }],
      transform: DEFAULT_TRANSFORM,
      settings: {
        ...DEFAULT_EXPORT_SETTINGS,
        mode: 'target',
        twoPass: true,
        encodingPreset: 'fast',
      },
    });
    expect(twoPassFast.passes[0][twoPassFast.passes[0].indexOf('-preset') + 1]).toBe('fast');
    expect(twoPassFast.passes[1][twoPassFast.passes[1].indexOf('-preset') + 1]).toBe('fast');

    const crfUltra = buildFfmpegCommandPlan({
      inputFSPath: '/input/demo.mp4',
      fileName: 'demo.mp4',
      metadata: makeMeta(),
      segments: [{ id: 's1', start: 0, end: 10 }],
      transform: DEFAULT_TRANSFORM,
      settings: {
        ...DEFAULT_EXPORT_SETTINGS,
        mode: 'quality',
        qualityMode: 'crf',
        encodingPreset: 'ultrafast',
      },
    });
    expect(crfUltra.passes[0][crfUltra.passes[0].indexOf('-preset') + 1]).toBe('ultrafast');
  });
});
