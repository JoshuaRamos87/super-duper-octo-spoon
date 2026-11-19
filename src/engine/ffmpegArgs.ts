import type {
  ExportSettings,
  TrimSegment,
  TransformSettings,
  VideoMetadata,
} from '../types/studio';
import { calculateTargetBitrates } from '../utils/bitrate';
import {
  buildAtempoChain,
  computeEffectiveDimensions,
  hasActiveTransform,
} from '../utils/filters';
import { getTotalSegmentsDuration } from '../utils/timecode';

export interface FfmpegJobInput {
  inputFSPath: string;
  fileName: string;
  metadata: VideoMetadata;
  segments: TrimSegment[];
  transform: TransformSettings;
  settings: ExportSettings;
}

export interface FfmpegCommandPlan {
  passes: string[][];
  outputFSName: string;
  extraCleanupFiles: string[];
  outExt: string;
  mimeType: string;
  downloadName: string;
  modeSummary: string;
  phaseWeights: number[];
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

const COPY_SUPPORTED_EXTS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv']);
const FASTSTART_EXTS = new Set(['mp4', 'm4v', 'mov']);

function getCleanExtension(fileName: string): string {
  const raw = (fileName.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
  return raw || 'mp4';
}

function getBaseName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '') || 'clip';
}

export function buildVideoFilterChain(
  metadata: VideoMetadata,
  transform: TransformSettings,
  settings: ExportSettings,
  options: { ensureEvenDimensions: boolean; includeScaleAndFps: boolean }
): string[] {
  const filters: string[] = [];

  // 1. Rotation & Flip (must precede crop to match visual overlay)
  if (transform.rotate === 90) filters.push('transpose=1');
  else if (transform.rotate === 180) filters.push('transpose=2,transpose=2');
  else if (transform.rotate === 270) filters.push('transpose=2');
  if (transform.flipH) filters.push('hflip');
  if (transform.flipV) filters.push('vflip');

  // 2. Crop (even integer coordinates inside rotated frame)
  const dims = computeEffectiveDimensions(
    metadata.width,
    metadata.height,
    transform,
    settings.resolution
  );
  if (dims.pixelCrop) {
    const { width, height, x, y } = dims.pixelCrop;
    filters.push(`crop=${width}:${height}:${x}:${y}`);
  }

  // 3. Scale + even-dimension safeguard for libx264/yuv420p
  if (options.includeScaleAndFps) {
    if (settings.resolution !== 'original') {
      const targetH = Number(settings.resolution);
      filters.push(`scale=-2:'min(trunc(ih/2)*2,${targetH})'`);
    } else if (options.ensureEvenDimensions) {
      filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
    }

    if (settings.fpsCap !== 'original') {
      filters.push(`fps=${settings.fpsCap}`);
    }
  }

  // 4. Speed
  if (Math.abs(settings.speed - 1) > 1e-4) {
    filters.push(`setpts=PTS/${Number(settings.speed.toFixed(4))}`);
  }

  return filters;
}

export function buildAudioFilterChain(
  metadata: VideoMetadata,
  settings: ExportSettings
): string[] {
  if (settings.muteOutput || !metadata.hasAudio) return [];
  const filters: string[] = [];
  filters.push(...buildAtempoChain(settings.speed));
  if (Math.abs(settings.audioVolume - 1) > 1e-2) {
    filters.push(`volume=${settings.audioVolume.toFixed(2)}`);
  }
  if (settings.audioNormalize) {
    filters.push('loudnorm');
  }
  return filters;
}

function buildMultiSegmentConcatGraph(
  segments: TrimSegment[],
  includeVideo: boolean,
  includeAudio: boolean,
  videoPostFilters: string[],
  audioPostFilters: string[]
): { filterComplex: string; videoMap: string | null; audioMap: string | null } {
  const parts: string[] = [];
  const vInputs: string[] = [];
  const aInputs: string[] = [];

  segments.forEach((seg, idx) => {
    const start = Math.max(0, seg.start).toFixed(3);
    const end = Math.max(seg.start + 0.05, seg.end).toFixed(3);
    if (includeVideo) {
      parts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${idx}]`);
      vInputs.push(`[v${idx}]`);
    }
    if (includeAudio) {
      parts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${idx}]`);
      aInputs.push(`[a${idx}]`);
    }
  });

  const n = segments.length;
  let videoMap: string | null = null;
  let audioMap: string | null = null;

  if (includeVideo && includeAudio) {
    const pairs = segments.map((_, i) => `[v${i}][a${i}]`).join('');
    parts.push(`${pairs}concat=n=${n}:v=1:a=1[vcat][acat]`);
    if (videoPostFilters.length > 0) {
      parts.push(`[vcat]${videoPostFilters.join(',')}[vout]`);
      videoMap = '[vout]';
    } else {
      videoMap = '[vcat]';
    }
    if (audioPostFilters.length > 0) {
      parts.push(`[acat]${audioPostFilters.join(',')}[aout]`);
      audioMap = '[aout]';
    } else {
      audioMap = '[acat]';
    }
  } else if (includeVideo) {
    parts.push(`${vInputs.join('')}concat=n=${n}:v=1:a=0[vcat]`);
    if (videoPostFilters.length > 0) {
      parts.push(`[vcat]${videoPostFilters.join(',')}[vout]`);
      videoMap = '[vout]';
    } else {
      videoMap = '[vcat]';
    }
  } else if (includeAudio) {
    parts.push(`${aInputs.join('')}concat=n=${n}:v=0:a=1[acat]`);
    if (audioPostFilters.length > 0) {
      parts.push(`[acat]${audioPostFilters.join(',')}[aout]`);
      audioMap = '[aout]';
    } else {
      audioMap = '[acat]';
    }
  }

  return {
    filterComplex: parts.join(';'),
    videoMap,
    audioMap,
  };
}

function appendAudioCodecArgs(
  args: string[],
  includeAudio: boolean,
  audioKbps: number,
  audioMono: boolean,
  audioFilterChain: string[]
) {
  if (!includeAudio) {
    args.push('-an');
    return;
  }
  if (audioFilterChain.length > 0) {
    args.push('-af', audioFilterChain.join(','));
  }
  args.push('-c:a', 'aac', '-b:a', `${audioKbps}k`);
  if (audioMono) {
    args.push('-ac', '1');
  }
}

export function buildFfmpegCommandPlan(job: FfmpegJobInput): FfmpegCommandPlan {
  const { inputFSPath, fileName, metadata, segments, transform, settings } = job;
  const safeSegments =
    segments.length > 0
      ? segments
      : [{ id: 'seg_0', start: 0, end: Math.max(0.1, metadata.duration) }];

  const isMultiSeg = safeSegments.length > 1;
  const singleSeg = safeSegments[0];
  const startSec = Math.max(0, singleSeg.start).toFixed(3);
  const singleDurSec = Math.max(0.05, singleSeg.end - singleSeg.start).toFixed(3);
  const effectiveSingleOutDurSec = Math.max(
    0.05,
    (singleSeg.end - singleSeg.start) / Math.max(0.25, settings.speed)
  ).toFixed(3);
  const totalTrimDur = getTotalSegmentsDuration(safeSegments);

  const origExt = getCleanExtension(fileName);
  const baseName = getBaseName(fileName);

  // -------------------------------------------------------------------------
  // MODE: AUDIO EXTRACT (MP3 / M4A / WAV)
  // -------------------------------------------------------------------------
  if (settings.mode === 'audio') {
    if (!metadata.hasAudio) {
      throw new Error('Cannot extract audio: source video has no audio track.');
    }
    const fmt = settings.audioExtractFormat;
    const outputFSName = `output.${fmt}`;
    const mimeType = MIME_BY_EXT[fmt] || 'audio/mpeg';
    const downloadName = `${baseName}_audio.${fmt}`;
    const audioFilters = buildAudioFilterChain(metadata, { ...settings, muteOutput: false });

    const codecArgs =
      fmt === 'mp3'
        ? ['-c:a', 'libmp3lame', '-b:a', `${settings.audioExtractBitrate}k`]
        : fmt === 'm4a'
          ? ['-c:a', 'aac', '-b:a', `${settings.audioExtractBitrate}k`, '-movflags', '+faststart']
          : ['-c:a', 'pcm_s16le'];

    const args: string[] = [];
    if (isMultiSeg) {
      const graph = buildMultiSegmentConcatGraph(safeSegments, false, true, [], audioFilters);
      args.push('-i', inputFSPath, '-filter_complex', graph.filterComplex, '-map', graph.audioMap!);
    } else {
      args.push('-ss', startSec, '-i', inputFSPath, '-t', effectiveSingleOutDurSec, '-vn');
      if (audioFilters.length > 0) {
        args.push('-af', audioFilters.join(','));
      }
    }

    if (settings.audioMono) args.push('-ac', '1');
    args.push(...codecArgs, '-y', outputFSName);

    return {
      passes: [args],
      outputFSName,
      extraCleanupFiles: [],
      outExt: fmt,
      mimeType,
      downloadName,
      modeSummary:
        fmt === 'wav'
          ? 'WAV Uncompressed Audio'
          : `${fmt.toUpperCase()} (${settings.audioExtractBitrate} kbps)`,
      phaseWeights: [1],
    };
  }

  // -------------------------------------------------------------------------
  // MODE: GIF / ANIMATED WEBP
  // -------------------------------------------------------------------------
  if (settings.mode === 'gif') {
    const fps = settings.gifFps;
    const maxW = settings.gifWidth;
    const preFilters = buildVideoFilterChain(metadata, transform, settings, {
      ensureEvenDimensions: false,
      includeScaleAndFps: false,
    });
    const baseGifFilters = [
      ...preFilters,
      `fps=${fps}`,
      `scale='min(iw,${maxW})':-1:flags=lanczos`,
    ];
    if (settings.animMotion === 'reverse') {
      baseGifFilters.push('reverse');
    }

    const isBoomerang = settings.animMotion === 'boomerang';
    const buildVisualInputToLabel = (
      inputLabel: string,
      outLabel: string,
      prependTrim = false
    ): string => {
      const trimPrefix = prependTrim
        ? `trim=duration=${singleDurSec},setpts=PTS-STARTPTS,`
        : '';
      const chain = `${trimPrefix}${baseGifFilters.join(',')}`;
      if (!isBoomerang) {
        return `${inputLabel}${chain}${outLabel}`;
      }
      return `${inputLabel}${chain},split[ba][bb];[bb]reverse[br];[ba][br]concat=n=2:v=1:a=0${outLabel}`;
    };

    if (settings.animFormat === 'gif') {
      const outputFSName = 'output.gif';
      const paletteFSName = 'palette.png';
      const ditherArg =
        settings.gifDither === 'bayer'
          ? 'bayer:bayer_scale=3'
          : settings.gifDither === 'floyd_steinberg'
            ? 'floyd_steinberg'
            : 'none';
      const paletteFilter = `palettegen=max_colors=${settings.gifColors}:stats_mode=diff`;

      let pass1: string[];
      let pass2: string[];

      if (isMultiSeg) {
        const graph1 = buildMultiSegmentConcatGraph(safeSegments, true, false, [], []);
        const p1Chain = `${graph1.filterComplex};${buildVisualInputToLabel(graph1.videoMap!, '[gifsrc]')};[gifsrc]${paletteFilter}[pout]`;
        pass1 = ['-i', inputFSPath, '-filter_complex', p1Chain, '-map', '[pout]', '-y', paletteFSName];

        const graph2 = buildMultiSegmentConcatGraph(safeSegments, true, false, [], []);
        const p2Chain = `${graph2.filterComplex};${buildVisualInputToLabel(graph2.videoMap!, '[x]')};[x][1:v]paletteuse=dither=${ditherArg}[gout]`;
        pass2 = [
          '-i',
          inputFSPath,
          '-i',
          paletteFSName,
          '-filter_complex',
          p2Chain,
          '-map',
          '[gout]',
          '-y',
          outputFSName,
        ];
      } else if (isBoomerang) {
        const p1Chain = `${buildVisualInputToLabel('[0:v]', '[gifsrc]', true)};[gifsrc]${paletteFilter}[pout]`;
        pass1 = [
          '-ss',
          startSec,
          '-i',
          inputFSPath,
          '-filter_complex',
          p1Chain,
          '-map',
          '[pout]',
          '-y',
          paletteFSName,
        ];

        const p2Chain = `${buildVisualInputToLabel('[0:v]', '[x]', true)};[x][1:v]paletteuse=dither=${ditherArg}[gout]`;
        pass2 = [
          '-ss',
          startSec,
          '-i',
          inputFSPath,
          '-i',
          paletteFSName,
          '-filter_complex',
          p2Chain,
          '-map',
          '[gout]',
          '-y',
          outputFSName,
        ];
      } else {
        // Linear single-segment GIF (-t after -i / after both -i inputs!)
        const linear = baseGifFilters.join(',');
        pass1 = [
          '-ss',
          startSec,
          '-i',
          inputFSPath,
          '-t',
          effectiveSingleOutDurSec,
          '-vf',
          `${linear},${paletteFilter}`,
          '-y',
          paletteFSName,
        ];
        pass2 = [
          '-ss',
          startSec,
          '-i',
          inputFSPath,
          '-i',
          paletteFSName,
          '-t',
          effectiveSingleOutDurSec,
          '-lavfi',
          `${linear} [x]; [x][1:v] paletteuse=dither=${ditherArg}`,
          '-y',
          outputFSName,
        ];
      }

      return {
        passes: [pass1, pass2],
        outputFSName,
        extraCleanupFiles: [paletteFSName],
        outExt: 'gif',
        mimeType: 'image/gif',
        downloadName: `${baseName}_${fps}fps.gif`,
        modeSummary: `GIF ${fps}fps • ${maxW}px${isBoomerang ? ' • Boomerang' : ''}`,
        phaseWeights: [0.35, 0.65],
      };
    }

    // Animated WebP
    const outputFSName = 'output.webp';
    const webpArgs: string[] = [];
    if (isMultiSeg) {
      const graph = buildMultiSegmentConcatGraph(safeSegments, true, false, [], []);
      const chain = `${graph.filterComplex};${buildVisualInputToLabel(graph.videoMap!, '[wout]')}`;
      webpArgs.push('-i', inputFSPath, '-filter_complex', chain, '-map', '[wout]');
    } else if (isBoomerang) {
      const chain = buildVisualInputToLabel('[0:v]', '[wout]', true);
      webpArgs.push(
        '-ss',
        startSec,
        '-i',
        inputFSPath,
        '-filter_complex',
        chain,
        '-map',
        '[wout]'
      );
    } else {
      webpArgs.push(
        '-ss',
        startSec,
        '-i',
        inputFSPath,
        '-t',
        effectiveSingleOutDurSec,
        '-vf',
        baseGifFilters.join(',')
      );
    }

    webpArgs.push(
      '-c:v',
      'libwebp',
      '-lossless',
      '0',
      '-compression_level',
      '4',
      '-q:v',
      String(settings.webpQuality),
      '-loop',
      '0',
      '-preset',
      'default',
      '-an',
      '-y',
      outputFSName
    );

    return {
      passes: [webpArgs],
      outputFSName,
      extraCleanupFiles: [],
      outExt: 'webp',
      mimeType: 'image/webp',
      downloadName: `${baseName}_${fps}fps.webp`,
      modeSummary: `Animated WebP ${fps}fps • Q${settings.webpQuality}`,
      phaseWeights: [1],
    };
  }

  // -------------------------------------------------------------------------
  // MODE: LOSSLESS STREAM COPY (Quality -> Copy)
  // -------------------------------------------------------------------------
  const canStreamCopy =
    settings.mode === 'quality' &&
    settings.qualityMode === 'copy' &&
    !isMultiSeg &&
    !hasActiveTransform(transform) &&
    settings.resolution === 'original' &&
    settings.fpsCap === 'original' &&
    Math.abs(settings.speed - 1) < 1e-4 &&
    !settings.audioMono &&
    Math.abs(settings.audioVolume - 1) < 1e-2 &&
    !settings.audioNormalize;

  if (canStreamCopy) {
    const outExt = COPY_SUPPORTED_EXTS.has(origExt) ? origExt : 'mp4';
    const outputFSName = `output.${outExt}`;
    const mimeType = MIME_BY_EXT[outExt] || 'video/mp4';
    const args = ['-ss', startSec, '-i', inputFSPath, '-t', singleDurSec];

    if (settings.muteOutput) {
      args.push('-c:v', 'copy', '-an');
    } else {
      args.push('-c', 'copy');
    }

    args.push('-avoid_negative_ts', 'make_zero');
    if (FASTSTART_EXTS.has(outExt)) {
      args.push('-movflags', '+faststart');
    }
    args.push('-y', outputFSName);

    return {
      passes: [args],
      outputFSName,
      extraCleanupFiles: [],
      outExt,
      mimeType,
      downloadName: `${baseName}_trimmed.${outExt}`,
      modeSummary: `Lossless Copy (.${outExt})`,
      phaseWeights: [1],
    };
  }

  // -------------------------------------------------------------------------
  // MODE: MP4 RE-ENCODE (Target Size 1-pass / 2-pass OR CRF)
  // -------------------------------------------------------------------------
  const outputFSName = 'output.mp4';
  const includeAudio = !settings.muteOutput && metadata.hasAudio;
  const videoFilters = buildVideoFilterChain(metadata, transform, settings, {
    ensureEvenDimensions: true,
    includeScaleAndFps: true,
  });
  const audioFilters = buildAudioFilterChain(metadata, settings);

  // Target Size Mode
  if (settings.mode === 'target') {
    const calc = calculateTargetBitrates({
      targetMB: settings.targetMB,
      trimDurationSec: totalTrimDur,
      totalDurationSec: metadata.duration,
      originalFileSize: metadata.size,
      speed: settings.speed,
      muteOutput: settings.muteOutput,
      audioMono: settings.audioMono,
      hasAudio: metadata.hasAudio,
      twoPass: settings.twoPass,
    });

    const videoCodecArgs = [
      '-c:v',
      'libx264',
      '-b:v',
      `${calc.videoKbps}k`,
      '-maxrate',
      `${Math.round(calc.videoKbps * 1.15)}k`,
      '-bufsize',
      `${Math.round(calc.videoKbps * 2)}k`,
      '-preset',
      settings.encodingPreset || 'veryfast',
      '-pix_fmt',
      'yuv420p',
    ];

    const buildPassInputAndFilters = (withAudio: boolean): string[] => {
      const args: string[] = [];
      if (isMultiSeg) {
        const graph = buildMultiSegmentConcatGraph(
          safeSegments,
          true,
          withAudio,
          videoFilters,
          withAudio ? audioFilters : []
        );
        args.push('-i', inputFSPath, '-filter_complex', graph.filterComplex);
        if (graph.videoMap) args.push('-map', graph.videoMap);
        if (withAudio && graph.audioMap) args.push('-map', graph.audioMap);
      } else {
        args.push('-ss', startSec, '-i', inputFSPath, '-t', effectiveSingleOutDurSec);
        if (videoFilters.length > 0) {
          args.push('-vf', videoFilters.join(','));
        }
        if (withAudio && audioFilters.length > 0) {
          args.push('-af', audioFilters.join(','));
        }
      }
      return args;
    };

    if (settings.twoPass) {
      const passLogPrefix = 'clipshrink_pass';
      const pass1 = [
        ...buildPassInputAndFilters(false),
        ...videoCodecArgs,
        '-pass',
        '1',
        '-passlogfile',
        passLogPrefix,
        '-an',
        '-f',
        'null',
        '-',
      ];

      const pass2 = [
        ...buildPassInputAndFilters(includeAudio),
        ...videoCodecArgs,
        '-pass',
        '2',
        '-passlogfile',
        passLogPrefix,
      ];
      if (!includeAudio) {
        pass2.push('-an');
      } else {
        pass2.push('-c:a', 'aac', '-b:a', `${calc.audioKbps}k`);
        if (settings.audioMono) pass2.push('-ac', '1');
      }
      pass2.push('-movflags', '+faststart', '-y', outputFSName);

      return {
        passes: [pass1, pass2],
        outputFSName,
        extraCleanupFiles: [`${passLogPrefix}-0.log`, `${passLogPrefix}-0.log.mbtree`],
        outExt: 'mp4',
        mimeType: 'video/mp4',
        downloadName: `${baseName}_${settings.targetMB}MB.mp4`,
        modeSummary: `Target ${settings.targetMB} MB (2-Pass • ${calc.videoKbps}k)`,
        phaseWeights: [0.45, 0.55],
      };
    }

    // 1-pass target size
    const args = [...buildPassInputAndFilters(includeAudio), ...videoCodecArgs];
    if (!includeAudio) {
      args.push('-an');
    } else {
      args.push('-c:a', 'aac', '-b:a', `${calc.audioKbps}k`);
      if (settings.audioMono) args.push('-ac', '1');
    }
    args.push('-movflags', '+faststart', '-y', outputFSName);

    return {
      passes: [args],
      outputFSName,
      extraCleanupFiles: [],
      outExt: 'mp4',
      mimeType: 'video/mp4',
      downloadName: `${baseName}_${settings.targetMB}MB.mp4`,
      modeSummary: `Target ${settings.targetMB} MB (${calc.videoKbps}k)`,
      phaseWeights: [1],
    };
  }

  // Quality CRF Re-encode (or fallback when Copy wasn't possible due to cuts/transforms)
  const crfValue = settings.qualityMode === 'copy' ? 18 : settings.crf;
  const args: string[] = [];

  if (isMultiSeg) {
    const graph = buildMultiSegmentConcatGraph(
      safeSegments,
      true,
      includeAudio,
      videoFilters,
      includeAudio ? audioFilters : []
    );
    args.push('-i', inputFSPath, '-filter_complex', graph.filterComplex);
    if (graph.videoMap) args.push('-map', graph.videoMap);
    if (includeAudio && graph.audioMap) args.push('-map', graph.audioMap);
  } else {
    args.push('-ss', startSec, '-i', inputFSPath, '-t', effectiveSingleOutDurSec);
    if (videoFilters.length > 0) args.push('-vf', videoFilters.join(','));
  }

  args.push(
    '-c:v',
    'libx264',
    '-crf',
    String(crfValue),
    '-preset',
    settings.encodingPreset || 'veryfast',
    '-pix_fmt',
    'yuv420p'
  );

  if (isMultiSeg) {
    if (!includeAudio) {
      args.push('-an');
    } else {
      args.push('-c:a', 'aac', '-b:a', settings.audioMono ? '64k' : '128k');
      if (settings.audioMono) args.push('-ac', '1');
    }
  } else {
    appendAudioCodecArgs(
      args,
      includeAudio,
      settings.audioMono ? 64 : 128,
      settings.audioMono,
      audioFilters
    );
  }

  args.push('-movflags', '+faststart', '-y', outputFSName);

  return {
    passes: [args],
    outputFSName,
    extraCleanupFiles: [],
    outExt: 'mp4',
    mimeType: 'video/mp4',
    downloadName: `${baseName}_crf${crfValue}.mp4`,
    modeSummary: `MP4 Re-encode (CRF ${crfValue})`,
    phaseWeights: [1],
  };
}
