import { useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  Cpu,
  ListPlus,
  Play,
  Sparkles,
  Trash2,
  Wand2,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import type {
  AudioExtractFormat,
  CustomPreset,
  EncodingPreset,
  EnginePreference,
  ExportSettings,
  FpsCapOption,
  OutputMode,
  ResolutionOption,
  TransformSettings,
  TrimSegment,
  VideoMetadata,
} from '../types/studio';
import { evaluateQualityForecast, recommendOptimalSettings } from '../utils/advisor';
import { calculateTargetBitrates } from '../utils/bitrate';
import { computeEffectiveDimensions, hasActiveTransform } from '../utils/filters';
import { PLATFORM_PRESETS } from '../utils/presets';
import { formatBytes, getTotalSegmentsDuration } from '../utils/timecode';
import { canUseMultiThread } from '../engine/ffmpegEngine';
import { canUseWebCodecs } from '../engine/mediabunnyEngine';

interface ControlsPanelProps {
  metadata: VideoMetadata;
  segments: TrimSegment[];
  transform: TransformSettings;
  settings: ExportSettings;
  customPresets: CustomPreset[];
  isProcessing: boolean;
  onChangeSettings: (next: ExportSettings) => void;
  onSavePreset: (name: string) => void;
  onApplyPreset: (preset: CustomPreset) => void;
  onDeletePreset: (id: string) => void;
  onStartExport: () => void;
  onQueueClip: () => void;
  onCancelExport: () => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const TIER_STYLES = {
  crisp: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  good: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  tight: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  blocky: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export function ControlsPanel({
  metadata,
  segments,
  transform,
  settings,
  customPresets,
  isProcessing,
  onChangeSettings,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
  onStartExport,
  onQueueClip,
  onCancelExport,
}: ControlsPanelProps) {
  const [presetName, setPresetName] = useState('');
  const [showPresetForm, setShowPresetForm] = useState(false);

  const trimDur = getTotalSegmentsDuration(segments);
  const srcW = metadata.width > 0 ? metadata.width : 1920;
  const srcH = metadata.height > 0 ? metadata.height : 1080;

  const effDims = computeEffectiveDimensions(srcW, srcH, transform, settings.resolution);
  const bitrateCalc = calculateTargetBitrates({
    targetMB: settings.targetMB,
    trimDurationSec: trimDur,
    totalDurationSec: metadata.duration,
    originalFileSize: metadata.size,
    speed: settings.speed,
    muteOutput: settings.muteOutput,
    audioMono: settings.audioMono,
    hasAudio: metadata.hasAudio,
    twoPass: settings.twoPass,
  });

  const forecast = evaluateQualityForecast({
    videoKbps: bitrateCalc.videoKbps,
    outputWidth: effDims.outputWidth,
    outputHeight: effDims.outputHeight,
    sourceFps: metadata.fps,
    fpsCap: settings.fpsCap,
  });

  const recommendation = recommendOptimalSettings(metadata, trimDur, transform, settings);
  const wcStatus = canUseWebCodecs(metadata, segments, transform, settings);

  const editsPreventCopy =
    segments.length > 1 ||
    hasActiveTransform(transform) ||
    settings.resolution !== 'original' ||
    settings.fpsCap !== 'original' ||
    Math.abs(settings.speed - 1) > 1e-4 ||
    settings.audioMono ||
    Math.abs(settings.audioVolume - 1) > 1e-2 ||
    settings.audioNormalize;

  const isLosslessCopy = settings.mode === 'quality' && settings.qualityMode === 'copy';
  const showVideoControls = settings.mode === 'target' || settings.mode === 'quality';
  const showAudioControls = settings.mode !== 'gif';
  const disableExport =
    isProcessing || (settings.mode === 'audio' && !metadata.hasAudio);

  const getCtaLabel = () => {
    if (settings.mode === 'target') return `Compress to ${settings.targetMB} MB MP4`;
    if (settings.mode === 'quality') {
      return settings.qualityMode === 'copy' && !editsPreventCopy
        ? 'Fast Lossless Trim'
        : `Re-encode MP4 (CRF ${settings.qualityMode === 'copy' ? 18 : settings.crf})`;
    }
    if (settings.mode === 'gif') {
      return settings.animFormat === 'gif' ? 'Convert Clip to GIF' : 'Convert Clip to WebP';
    }
    return `Extract Audio (.${settings.audioExtractFormat.toUpperCase()})`;
  };

  const update = <K extends keyof ExportSettings>(key: K, val: ExportSettings[K]) => {
    onChangeSettings({ ...settings, [key]: val });
  };

  const handleSavePreset = () => {
    if (!presetName.trim()) return;
    onSavePreset(presetName.trim());
    setPresetName('');
    setShowPresetForm(false);
  };

  return (
    <div className="rounded-2xl bg-studio-900 border border-zinc-800/90 p-4 sm:p-5 flex flex-col gap-5 shadow-xl">
      {/* Mode Tabs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Output Mode
          </span>
          <button
            type="button"
            onClick={() => setShowPresetForm((v) => !v)}
            className="text-[11px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            Save Preset
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-studio-950 border border-zinc-800">
          {(
            [
              { id: 'target', label: 'Target MB' },
              { id: 'quality', label: 'Fast / CRF' },
              { id: 'gif', label: 'GIF / WebP' },
              { id: 'audio', label: 'Audio' },
            ] as { id: OutputMode; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => update('mode', tab.id)}
              className={`py-2 px-1.5 rounded-lg text-xs font-semibold transition text-center ${
                settings.mode === tab.id
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Save Preset Inline Form */}
        {showPresetForm && (
          <div className="mt-2.5 flex items-center gap-2">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
              placeholder="Preset name (e.g. Discord 720p30)"
              className="flex-1 bg-studio-950 border border-zinc-700 focus:border-indigo-500 focus:outline-none rounded-lg px-2.5 py-1.5 text-xs text-white"
            />
            <button
              type="button"
              onClick={handleSavePreset}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
            >
              Save
            </button>
          </div>
        )}

        {/* Saved Custom Presets Chips */}
        {customPresets.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {customPresets.map((p) => (
              <div
                key={p.id}
                className="inline-flex items-center gap-1 bg-studio-950 border border-zinc-800 hover:border-indigo-500/40 rounded-lg pl-2.5 pr-1.5 py-1 text-[11px] text-zinc-300"
              >
                <button
                  type="button"
                  onClick={() => onApplyPreset(p)}
                  className="hover:text-white font-medium"
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  onClick={() => onDeletePreset(p.id)}
                  aria-label={`Delete preset ${p.name}`}
                  className="text-zinc-500 hover:text-rose-400 p-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODE A: TARGET FILE SIZE */}
      {settings.mode === 'target' && (
        <div className="flex flex-col gap-3.5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-zinc-300">Platform Caps &amp; Target</span>
              <span className="text-[11px] text-zinc-500">
                {settings.twoPass ? '3% 2-pass safety margin' : '6% 1-pass safety margin'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 mb-2.5">
              {PLATFORM_PRESETS.map((preset) => {
                const active = settings.targetMB === preset.targetMB;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => update('targetMB', preset.targetMB)}
                    title={preset.description}
                    className={`py-1.5 px-2 rounded-xl text-xs font-semibold border transition text-center ${
                      active
                        ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
                        : 'border-zinc-800 bg-studio-950 hover:border-indigo-500/50 text-zinc-300'
                    }`}
                  >
                    <span className="block text-[11px]">{preset.name}</span>
                    <span className="block text-[10px] font-mono text-zinc-400">
                      {preset.badge}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  min={0.5}
                  max={2000}
                  step={0.5}
                  value={settings.targetMB}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (Number.isFinite(val) && val > 0) update('targetMB', val);
                  }}
                  className="w-full bg-studio-950 border border-zinc-700/80 focus:border-indigo-500 focus:outline-none rounded-xl px-3.5 py-2 pr-12 text-sm font-mono text-white"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-zinc-400">
                  MB
                </span>
              </div>

              {/* 1-Pass vs 2-Pass Toggle */}
              <div className="grid grid-cols-2 p-1 rounded-xl bg-studio-950 border border-zinc-800 shrink-0">
                <button
                  type="button"
                  onClick={() => update('twoPass', false)}
                  title="Fast single-pass bitrate encode (supports WebCodecs GPU)"
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                    !settings.twoPass ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  1-Pass
                </button>
                <button
                  type="button"
                  onClick={() => update('twoPass', true)}
                  title="2-pass VBR via FFmpeg.wasm for maximum accuracy and quality"
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                    settings.twoPass ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  2-Pass
                </button>
              </div>
            </div>
          </div>

          {/* Already-Fits Shortcut Banner */}
          {bitrateCalc.alreadyFitsTarget && !editsPreventCopy && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between gap-2">
              <div className="text-[11px] text-emerald-200 leading-relaxed">
                <CheckCircle2 className="w-3.5 h-3.5 inline mr-1 text-emerald-400" />
                Clip already fits (~{formatBytes(bitrateCalc.estimatedTrimBytes)}).
              </div>
              <button
                type="button"
                onClick={() =>
                  onChangeSettings({
                    ...settings,
                    mode: 'quality',
                    qualityMode: 'copy',
                  })
                }
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[11px] font-semibold text-white shrink-0"
              >
                Use Lossless Copy
              </button>
            </div>
          )}

          {/* Live Bitrate + Quality Forecast Box */}
          <div className="rounded-xl bg-studio-950 border border-zinc-800/90 p-3.5 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Video Bitrate Budget</span>
              <span className="font-mono font-semibold text-indigo-300">
                {bitrateCalc.videoKbps.toLocaleString()} kbps
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Audio Allocation</span>
              <span className="font-mono text-zinc-300">
                {bitrateCalc.audioKbps === 0
                  ? '0 kbps (Muted)'
                  : `${bitrateCalc.audioKbps} kbps${settings.audioMono ? ' Mono' : ''}`}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-800/80">
              <span className="text-zinc-400">
                Quality Forecast ({forecast.outputWidth}×{forecast.outputHeight} @{' '}
                {Math.round(forecast.outputFps)}fps)
              </span>
              <span
                className={`px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold ${TIER_STYLES[forecast.tier]}`}
              >
                {forecast.label} ({forecast.bpp.toFixed(3)} BPP)
              </span>
            </div>

            {/* Smart Auto-Optimize Banner */}
            {recommendation && (
              <div className="mt-1 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col gap-2">
                <div className="text-[11px] text-amber-200 leading-relaxed">
                  Bitrate is {forecast.tier}. Recommended:{' '}
                  <span className="font-semibold text-amber-100">
                    {recommendation.changesSummary.join(' + ')}
                  </span>{' '}
                  → {recommendation.projectedBpp.toFixed(3)} BPP ({recommendation.projectedTier}).
                </div>
                <button
                  type="button"
                  onClick={() => onChangeSettings(recommendation.suggestedSettings)}
                  className="self-start px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-[11px] inline-flex items-center gap-1.5 transition"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Auto-Optimize for {settings.targetMB} MB
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODE B: QUALITY / FAST TRIM */}
      {settings.mode === 'quality' && (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => update('qualityMode', 'copy')}
              className={`p-3 rounded-xl border text-left transition ${
                settings.qualityMode === 'copy'
                  ? 'border-indigo-500 bg-indigo-500/15'
                  : 'border-zinc-800 bg-studio-950 hover:border-zinc-700'
              }`}
            >
              <div className="text-xs font-semibold text-indigo-200">Lossless Copy</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                Instant keyframe trim, preserves container
              </div>
            </button>
            <button
              type="button"
              onClick={() => update('qualityMode', 'crf')}
              className={`p-3 rounded-xl border text-left transition ${
                settings.qualityMode === 'crf'
                  ? 'border-indigo-500 bg-indigo-500/15'
                  : 'border-zinc-800 bg-studio-950 hover:border-zinc-700'
              }`}
            >
              <div className="text-xs font-semibold text-zinc-200">Re-encode (CRF)</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                Constant quality + crop/scale/speed
              </div>
            </button>
          </div>

          {settings.qualityMode === 'copy' ? (
            editsPreventCopy ? (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2">
                <div className="text-[11px] text-amber-200 leading-relaxed">
                  Crop, rotate, speed, scaling, or multi-cut edits require re-encoding (automatically
                  switches to CRF 18 on export).
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChangeSettings({ ...settings, qualityMode: 'crf', crf: 20 })
                  }
                  className="px-2.5 py-1 rounded-lg bg-amber-500 text-zinc-950 font-semibold text-[11px] shrink-0"
                >
                  Use CRF 20
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-studio-950 border border-zinc-800 text-xs text-zinc-400 leading-relaxed">
                Stream copy cuts near keyframes in milliseconds with zero quality loss and keeps
                the original container format when compatible.
              </div>
            )
          ) : (
            <div className="p-3.5 rounded-xl bg-studio-950 border border-zinc-800 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">CRF Quality</span>
                <span className="font-mono text-xs font-semibold text-indigo-300">
                  CRF {settings.crf}{' '}
                  <span className="text-zinc-400 font-sans font-normal">
                    (
                    {settings.crf <= 20
                      ? 'High Quality'
                      : settings.crf >= 29
                        ? 'High Compression'
                        : 'Balanced'}
                    )
                  </span>
                </span>
              </div>
              <input
                type="range"
                min={18}
                max={35}
                step={1}
                value={settings.crf}
                onChange={(e) => update('crf', Number(e.target.value))}
                className="studio-slider w-full"
              />
              <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>18 (Sharpest)</span>
                <span>23 (Balanced)</span>
                <span>35 (Smallest)</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODE C: GIF / WEBP */}
      {settings.mode === 'gif' && (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => update('animFormat', 'gif')}
              className={`py-2 px-3 rounded-xl border text-xs font-semibold transition ${
                settings.animFormat === 'gif'
                  ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
                  : 'border-zinc-800 bg-studio-950 text-zinc-300'
              }`}
            >
              GIF (2-Pass Palette)
            </button>
            <button
              type="button"
              onClick={() => update('animFormat', 'webp')}
              className={`py-2 px-3 rounded-xl border text-xs font-semibold transition ${
                settings.animFormat === 'webp'
                  ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
                  : 'border-zinc-800 bg-studio-950 text-zinc-300'
              }`}
            >
              Animated WebP
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">FPS</label>
              <select
                value={settings.gifFps}
                onChange={(e) => update('gifFps', Number(e.target.value) as 10 | 15 | 20 | 24)}
                className="w-full bg-studio-950 border border-zinc-700/80 rounded-xl px-2.5 py-2 text-xs text-white font-mono"
              >
                <option value={10}>10 fps</option>
                <option value={15}>15 fps</option>
                <option value={20}>20 fps</option>
                <option value={24}>24 fps</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Max Width</label>
              <select
                value={settings.gifWidth}
                onChange={(e) =>
                  update('gifWidth', Number(e.target.value) as 320 | 480 | 640 | 800)
                }
                className="w-full bg-studio-950 border border-zinc-700/80 rounded-xl px-2.5 py-2 text-xs text-white font-mono"
              >
                <option value={320}>320 px</option>
                <option value={480}>480 px</option>
                <option value={640}>640 px</option>
                <option value={800}>800 px</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Motion</label>
              <select
                value={settings.animMotion}
                onChange={(e) =>
                  update('animMotion', e.target.value as ExportSettings['animMotion'])
                }
                className="w-full bg-studio-950 border border-zinc-700/80 rounded-xl px-2.5 py-2 text-xs text-white"
              >
                <option value="normal">Normal</option>
                <option value="reverse">Reverse</option>
                <option value="boomerang">Boomerang</option>
              </select>
            </div>
          </div>

          {settings.animFormat === 'gif' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Palette Colors</label>
                <select
                  value={settings.gifColors}
                  onChange={(e) => update('gifColors', Number(e.target.value) as 64 | 128 | 256)}
                  className="w-full bg-studio-950 border border-zinc-700/80 rounded-xl px-2.5 py-2 text-xs text-white font-mono"
                >
                  <option value={256}>256 (Richest)</option>
                  <option value={128}>128 (Balanced)</option>
                  <option value={64}>64 (Smallest)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Dithering</label>
                <select
                  value={settings.gifDither}
                  onChange={(e) => update('gifDither', e.target.value as ExportSettings['gifDither'])}
                  className="w-full bg-studio-950 border border-zinc-700/80 rounded-xl px-2.5 py-2 text-xs text-white"
                >
                  <option value="bayer">Bayer (Clean)</option>
                  <option value="floyd_steinberg">Floyd-Steinberg</option>
                  <option value="none">None (Sharp Text)</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-studio-950 border border-zinc-800 flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">WebP Quality</span>
                <span className="font-mono text-indigo-300">{settings.webpQuality}</span>
              </div>
              <input
                type="range"
                min={50}
                max={95}
                step={5}
                value={settings.webpQuality}
                onChange={(e) => update('webpQuality', Number(e.target.value))}
                className="studio-slider w-full"
              />
            </div>
          )}
        </div>
      )}

      {/* MODE D: AUDIO EXTRACT */}
      {settings.mode === 'audio' && (
        <div className="flex flex-col gap-3">
          {!metadata.hasAudio && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              No audio stream detected in this video.
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {(['mp3', 'm4a', 'wav'] as AudioExtractFormat[]).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => update('audioExtractFormat', fmt)}
                className={`py-2.5 rounded-xl border text-xs font-semibold uppercase transition ${
                  settings.audioExtractFormat === fmt
                    ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
                    : 'border-zinc-800 bg-studio-950 text-zinc-300'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          {settings.audioExtractFormat !== 'wav' && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-300">Audio Bitrate</span>
              <select
                value={settings.audioExtractBitrate}
                onChange={(e) =>
                  update('audioExtractBitrate', Number(e.target.value) as 128 | 192 | 256 | 320)
                }
                className="bg-studio-950 border border-zinc-700/80 rounded-xl px-3 py-1.5 text-xs font-mono text-white"
              >
                <option value={128}>128 kbps</option>
                <option value={192}>192 kbps</option>
                <option value={256}>256 kbps</option>
                <option value={320}>320 kbps</option>
              </select>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-zinc-800/80" />

      {/* SHARED VIDEO & AUDIO ADJUSTMENTS */}
      <div className="flex flex-col gap-3">
        {showVideoControls && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Resolution</label>
                <select
                  value={settings.resolution}
                  disabled={isLosslessCopy && !editsPreventCopy}
                  onChange={(e) => update('resolution', e.target.value as ResolutionOption)}
                  className="w-full bg-studio-950 border border-zinc-700/80 disabled:opacity-45 rounded-xl px-2.5 py-2 text-xs text-white"
                >
                  <option value="original">Original</option>
                  <option value="1080">1080p</option>
                  <option value="720">720p</option>
                  <option value="480">480p</option>
                  <option value="360">360p</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">FPS Cap</label>
                <select
                  value={String(settings.fpsCap)}
                  onChange={(e) =>
                    update(
                      'fpsCap',
                      e.target.value === 'original'
                        ? 'original'
                        : (Number(e.target.value) as FpsCapOption)
                    )
                  }
                  className="w-full bg-studio-950 border border-zinc-700/80 rounded-xl px-2.5 py-2 text-xs text-white font-mono"
                >
                  <option value="original">Orig ({Math.round(metadata.fps || 30)})</option>
                  <option value="60">60 fps</option>
                  <option value="30">30 fps</option>
                  <option value="24">24 fps</option>
                  <option value="15">15 fps</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Speed</label>
                <select
                  value={settings.speed}
                  onChange={(e) => update('speed', Number(e.target.value))}
                  className="w-full bg-studio-950 border border-zinc-700/80 rounded-xl px-2.5 py-2 text-xs text-white font-mono"
                >
                  {SPEED_OPTIONS.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}x
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="select-encode-preset"
                className="text-xs text-zinc-300"
                title="Controls x264 compression speed vs efficiency when encoding via FFmpeg.wasm"
              >
                FFmpeg Encode Speed
              </label>
              <select
                id="select-encode-preset"
                value={settings.encodingPreset}
                disabled={isLosslessCopy && !editsPreventCopy}
                onChange={(e) => update('encodingPreset', e.target.value as EncodingPreset)}
                className="bg-studio-950 border border-zinc-700/80 disabled:opacity-45 rounded-xl px-3 py-1.5 text-xs text-white"
              >
                <option value="ultrafast">Ultrafast (2× faster)</option>
                <option value="veryfast">Veryfast (Default)</option>
                <option value="fast">Fast (Best quality)</option>
              </select>
            </div>
          </>
        )}

        {settings.mode === 'gif' && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-300">Playback Speed</span>
            <select
              value={settings.speed}
              onChange={(e) => update('speed', Number(e.target.value))}
              className="bg-studio-950 border border-zinc-700/80 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
            >
              {SPEED_OPTIONS.map((sp) => (
                <option key={sp} value={sp}>
                  {sp}x
                </option>
              ))}
            </select>
          </div>
        )}

        {showAudioControls && (
          <div className="flex flex-col gap-2.5 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {settings.mode !== 'audio' && (
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={settings.muteOutput}
                    onChange={(e) => update('muteOutput', e.target.checked)}
                    className="rounded border-zinc-700 bg-studio-950 text-rose-500 focus:ring-0"
                  />
                  Remove Audio
                </label>
              )}

              {(!settings.muteOutput || settings.mode === 'audio') && metadata.hasAudio && (
                <>
                  <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={settings.audioMono}
                      onChange={(e) => update('audioMono', e.target.checked)}
                      className="rounded border-zinc-700 bg-studio-950 text-indigo-500 focus:ring-0"
                    />
                    Mono Mix
                  </label>

                  <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={settings.audioNormalize}
                      onChange={(e) => update('audioNormalize', e.target.checked)}
                      className="rounded border-zinc-700 bg-studio-950 text-indigo-500 focus:ring-0"
                    />
                    Normalize
                  </label>
                </>
              )}
            </div>

            {(!settings.muteOutput || settings.mode === 'audio') && metadata.hasAudio && (
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-zinc-400 shrink-0">
                  Volume {Math.round(settings.audioVolume * 100)}%
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={settings.audioVolume}
                  onChange={(e) => update('audioVolume', Number(e.target.value))}
                  className="studio-slider flex-1"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ENGINE SELECTOR */}
      <div className="rounded-xl bg-studio-950 border border-zinc-800/90 p-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-zinc-300 min-w-0">
          {settings.enginePreference !== 'ffmpeg' && wcStatus.supported ? (
            <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          )}
          <span className="truncate">
            {settings.enginePreference === 'ffmpeg'
              ? `FFmpeg.wasm (${canUseMultiThread() ? 'Multi-Thread' : 'Single-Thread'})`
              : wcStatus.supported
                ? 'GPU WebCodecs Ready'
                : `FFmpeg ${canUseMultiThread() ? 'MT' : 'ST'} (${wcStatus.reason})`}
          </span>
        </div>
        <select
          value={settings.enginePreference}
          onChange={(e) => update('enginePreference', e.target.value as EnginePreference)}
          className="bg-studio-900 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-200 shrink-0"
        >
          <option value="auto">Auto (GPU → FFmpeg)</option>
          <option value="webcodecs">WebCodecs GPU</option>
          <option value="ffmpeg">
            {canUseMultiThread() ? 'FFmpeg.wasm (MT)' : 'FFmpeg.wasm (ST)'}
          </option>
        </select>
      </div>

      {/* PRIMARY ACTIONS */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disableExport}
            onClick={onStartExport}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 transition flex items-center justify-center gap-2"
          >
            {settings.enginePreference !== 'ffmpeg' && wcStatus.supported ? (
              <Sparkles className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            <span className="truncate">{getCtaLabel()}</span>
          </button>

          <button
            type="button"
            disabled={disableExport}
            onClick={onQueueClip}
            title="Add current trim & settings to the batch export queue"
            className="px-3.5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-45 border border-zinc-700/80 text-xs font-semibold text-zinc-100 transition inline-flex items-center gap-1.5 shrink-0"
          >
            <ListPlus className="w-4 h-4 text-indigo-400" />
            Queue
          </button>
        </div>

        {isProcessing && (
          <button
            type="button"
            onClick={onCancelExport}
            className="w-full py-2.5 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 font-semibold text-xs transition"
          >
            Cancel Processing
          </button>
        )}
      </div>
    </div>
  );
}
