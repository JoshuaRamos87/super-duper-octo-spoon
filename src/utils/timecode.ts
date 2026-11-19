import type { TrimSegment } from '../types/studio';

/**
 * Formats seconds as MM:SS.d (or HH:MM:SS.d if >= 1 hour).
 * Pass showHundredths=true for centisecond precision.
 */
export function formatTime(sec: number, showHundredths = false): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;

  if (showHundredths) {
    const totalCs = Math.floor(sec * 100 + 1e-6);
    const cs = totalCs % 100;
    const totalWhole = Math.floor(totalCs / 100);
    const hrs = Math.floor(totalWhole / 3600);
    const mins = Math.floor((totalWhole % 3600) / 60);
    const secs = totalWhole % 60;
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    const cc = String(cs).padStart(2, '0');
    return hrs > 0 ? `${String(hrs).padStart(2, '0')}:${mm}:${ss}.${cc}` : `${mm}:${ss}.${cc}`;
  }

  const totalTenths = Math.floor(sec * 10 + 1e-6);
  const tenths = totalTenths % 10;
  const totalWhole = Math.floor(totalTenths / 10);
  const hrs = Math.floor(totalWhole / 3600);
  const mins = Math.floor((totalWhole % 3600) / 60);
  const secs = totalWhole % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${mm}:${ss}.${tenths}`;
  }
  return `${mm}:${ss}.${tenths}`;
}

/**
 * Parses MM:SS.d, HH:MM:SS.d, or plain seconds string into numeric seconds.
 * Returns NaN if invalid.
 */
export function parseTime(str: string): number {
  if (!str) return Number.NaN;
  const cleaned = str.trim();
  if (!cleaned) return Number.NaN;

  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned);
  }

  const rawParts = cleaned.split(':');
  if (rawParts.length !== 2 && rawParts.length !== 3) return Number.NaN;
  if (rawParts.some((p) => !/^\d+(\.\d+)?$/.test(p.trim()))) return Number.NaN;

  const parts = rawParts.map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return Number.NaN;

  if (parts.length === 2) {
    if (parts[1] >= 60) return Number.NaN;
    return parts[0] * 60 + parts[1];
  }

  if (parts[1] >= 60 || parts[2] >= 60) return Number.NaN;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/**
 * Formats byte count into readable B / KB / MB string.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.00 MB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 100) return `${kb.toFixed(1)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

/**
 * Formats decimal MB strictly (1 MB = 1,000,000 bytes, matching Discord/platform upload caps).
 */
export function formatDecimalMB(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.00 MB';
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

export function getTotalSegmentsDuration(segments: TrimSegment[]): number {
  if (!segments.length) return 0;
  const total = segments.reduce((sum, seg) => sum + Math.max(0, seg.end - seg.start), 0);
  return Math.max(0.05, total);
}

export function clampTime(t: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, t));
}
