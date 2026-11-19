import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  Camera,
  Crop,
  FlipHorizontal,
  FlipVertical,
  Play,
  RotateCw,
  Undo2,
  AlertTriangle,
} from 'lucide-react';
import type { CropAspectRatio, TransformSettings, VideoMetadata } from '../types/studio';
import {
  computeEffectiveDimensions,
  getRotatedDimensions,
  hasActiveTransform,
} from '../utils/filters';
import { formatTime } from '../utils/timecode';
import {
  CropOverlay,
  createCenteredCropForAspect,
  type DisplayBox,
} from './CropOverlay';

interface VideoPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoUrl: string;
  metadata: VideoMetadata;
  isPlaying: boolean;
  totalTrimDuration: number;
  transform: TransformSettings;
  cropMode: boolean;
  onTogglePlay: () => void;
  onToggleCropMode: () => void;
  onChangeTransform: (next: TransformSettings) => void;
  onCaptureFrame: (fmt: 'image/png' | 'image/jpeg') => void;
}

const ASPECT_OPTIONS: { id: CropAspectRatio; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
  { id: '4:3', label: '4:3' },
];

export function VideoPreview({
  videoRef,
  videoUrl,
  metadata,
  isPlaying,
  totalTrimDuration,
  transform,
  cropMode,
  onTogglePlay,
  onToggleCropMode,
  onChangeTransform,
  onCaptureFrame,
}: VideoPreviewProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 640, height: 360 });

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setStageSize({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const srcW = metadata.width > 0 ? metadata.width : 1920;
  const srcH = metadata.height > 0 ? metadata.height : 1080;
  const rotated = getRotatedDimensions(srcW, srcH, transform.rotate);
  const scale = Math.min(stageSize.width / rotated.width, stageSize.height / rotated.height);
  const dispW = Math.max(1, rotated.width * scale);
  const dispH = Math.max(1, rotated.height * scale);

  const displayBox: DisplayBox = {
    left: (stageSize.width - dispW) / 2,
    top: (stageSize.height - dispH) / 2,
    width: dispW,
    height: dispH,
  };

  const isQuarterTurn = transform.rotate === 90 || transform.rotate === 270;
  const videoElemW = isQuarterTurn ? dispH : dispW;
  const videoElemH = isQuarterTurn ? dispW : dispH;
  const cssTransform = `scaleX(${transform.flipH ? -1 : 1}) scaleY(${
    transform.flipV ? -1 : 1
  }) rotate(${transform.rotate}deg)`;

  const effDims = computeEffectiveDimensions(srcW, srcH, transform, 'original');
  const currentAspect = transform.crop?.aspectRatio ?? 'free';

  const handleRotate = () => {
    const nextRotate = ((transform.rotate + 90) % 360) as TransformSettings['rotate'];
    onChangeTransform({ ...transform, rotate: nextRotate });
  };

  const handleSelectAspect = (ratio: CropAspectRatio) => {
    if (!cropMode) onToggleCropMode();
    if (ratio === 'free' && transform.crop) {
      onChangeTransform({
        ...transform,
        crop: { ...transform.crop, aspectRatio: 'free' },
      });
    } else {
      onChangeTransform({
        ...transform,
        crop: createCenteredCropForAspect(ratio, rotated.width, rotated.height),
      });
    }
  };

  return (
    <div className="flex flex-col">
      {/* Video Display Stage */}
      <div
        ref={stageRef}
        onClick={() => {
          if (!cropMode && metadata.browserPlayable) onTogglePlay();
        }}
        className="relative bg-black aspect-video flex items-center justify-center overflow-hidden select-none cursor-pointer"
      >
        <video
          ref={videoRef}
          src={videoUrl}
          playsInline
          preload="metadata"
          style={{
            width: `${videoElemW}px`,
            height: `${videoElemH}px`,
            transform: cssTransform,
          }}
          className={`max-w-none max-h-none object-fill transition-transform duration-150 ${
            metadata.browserPlayable ? 'opacity-100' : 'opacity-20'
          }`}
        />

        {/* Unplayable Codec Fallback Banner */}
        {!metadata.browserPlayable && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-black/70">
            <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
            <div className="text-sm font-semibold text-amber-100">
              Browser cannot preview {metadata.videoCodec || 'this codec'} directly
            </div>
            <p className="text-xs text-zinc-300 max-w-sm mt-1">
              Probed {srcW}×{srcH} • {formatTime(metadata.duration)} via {metadata.probeSource}.
              Timeline trimming &amp; FFmpeg.wasm export still work normally.
            </p>
          </div>
        )}

        {/* Interactive Crop Overlay */}
        <CropOverlay
          displayBox={displayBox}
          rotatedWidth={rotated.width}
          rotatedHeight={rotated.height}
          crop={transform.crop}
          cropMode={cropMode}
          onChange={(nextCrop) => onChangeTransform({ ...transform, crop: nextCrop })}
        />

        {/* Center Play Overlay */}
        {metadata.browserPlayable && !cropMode && !isPlaying && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            aria-label="Play Video"
            className="absolute inset-0 m-auto z-10 w-14 h-14 rounded-full bg-black/60 hover:bg-indigo-600/90 text-white backdrop-blur-sm border border-white/20 flex items-center justify-center transition-all duration-150"
          >
            <Play className="w-6 h-6 ml-0.5 fill-current" />
          </button>
        )}

        {/* Selected Clip Duration Floating Pill */}
        <div className="absolute top-3 right-3 z-20 px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 text-[11px] font-mono text-zinc-200 pointer-events-none">
          Clip:{' '}
          <span className="text-indigo-300 font-semibold">
            {formatTime(totalTrimDuration)}
          </span>
        </div>
      </div>

      {/* Transform, Crop & Snapshot Toolbar */}
      <div className="px-4 py-2.5 bg-studio-950/80 border-y border-zinc-800/80 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleRotate}
            title="Rotate 90° clockwise (R)"
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition inline-flex items-center gap-1.5 ${
              transform.rotate !== 0
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>{transform.rotate === 0 ? 'Rotate' : `${transform.rotate}°`}</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeTransform({ ...transform, flipH: !transform.flipH })}
            title="Flip Horizontally"
            className={`p-1.5 rounded-lg border transition ${
              transform.flipH
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onChangeTransform({ ...transform, flipV: !transform.flipV })}
            title="Flip Vertically"
            className={`p-1.5 rounded-lg border transition ${
              transform.flipV
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <FlipVertical className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (!cropMode && !transform.crop) {
                onChangeTransform({
                  ...transform,
                  crop: { x: 0.08, y: 0.08, width: 0.84, height: 0.84, aspectRatio: 'free' },
                });
              }
              onToggleCropMode();
            }}
            title="Toggle Interactive Crop Overlay (C)"
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition inline-flex items-center gap-1.5 ${
              cropMode
                ? 'bg-indigo-600 border-indigo-500 text-white shadow'
                : transform.crop
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <Crop className="w-3.5 h-3.5" />
            <span>{cropMode ? 'Done Crop' : 'Crop'}</span>
          </button>

          {(cropMode || transform.crop) && (
            <div className="flex items-center gap-1 ml-1">
              {ASPECT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectAspect(opt.id)}
                  className={`px-2 py-1 rounded-md text-[11px] font-mono transition ${
                    currentAspect === opt.id
                      ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/40'
                      : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {hasActiveTransform(transform) && (
            <button
              type="button"
              onClick={() => {
                if (cropMode) onToggleCropMode();
                onChangeTransform({ rotate: 0, flipH: false, flipV: false, crop: null });
              }}
              title="Reset rotate, flip & crop"
              className="px-2 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-800 transition inline-flex items-center gap-1"
            >
              <Undo2 className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>

        {/* Dimensions Readout + Frame Snapshot */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="font-mono text-[11px] text-zinc-400">
            {effDims.outputWidth}×{effDims.outputHeight}
          </span>
          {metadata.browserPlayable && (
            <div className="inline-flex rounded-lg border border-zinc-800 overflow-hidden bg-zinc-900">
              <button
                type="button"
                onClick={() => onCaptureFrame('image/png')}
                title="Save current video frame as PNG"
                className="px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition inline-flex items-center gap-1"
              >
                <Camera className="w-3 h-3 text-indigo-400" />
                PNG
              </button>
              <button
                type="button"
                onClick={() => onCaptureFrame('image/jpeg')}
                title="Save current video frame as JPG"
                className="px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 border-l border-zinc-800 transition"
              >
                JPG
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
