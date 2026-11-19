import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDecimalMB,
  formatTime,
  getTotalSegmentsDuration,
  parseTime,
} from './timecode';

describe('timecode utilities', () => {
  it('formats seconds in tenths and hundredths including hours', () => {
    expect(formatTime(0)).toBe('00:00.0');
    expect(formatTime(5.43)).toBe('00:05.4');
    expect(formatTime(65.99)).toBe('01:05.9');
    expect(formatTime(3661.25)).toBe('01:01:01.2');
    expect(formatTime(12.345, true)).toBe('00:12.34');
    expect(formatTime(3661.25, true)).toBe('01:01:01.25');
    expect(formatTime(-5)).toBe('00:00.0');
    expect(formatTime(Number.NaN)).toBe('00:00.0');
  });

  it('parses numeric seconds, MM:SS.d, and HH:MM:SS.d accurately', () => {
    expect(parseTime('42.5')).toBe(42.5);
    expect(parseTime('01:30.2')).toBeCloseTo(90.2, 5);
    expect(parseTime('01:02:03.5')).toBeCloseTo(3723.5, 5);
    expect(parseTime('')).toBeNaN();
    expect(parseTime('invalid')).toBeNaN();
    expect(parseTime('01:75')).toBeNaN();
    expect(parseTime('-5')).toBeNaN();
  });

  it('formats binary bytes and decimal MB', () => {
    expect(formatBytes(0)).toBe('0.00 MB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(48 * 1024)).toBe('48.0 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.00 MB');
    expect(formatDecimalMB(9_850_000)).toBe('9.85 MB');
  });

  it('sums multi-segment duration cleanly', () => {
    expect(
      getTotalSegmentsDuration([
        { id: '1', start: 2, end: 8 },
        { id: '2', start: 12, end: 20.5 },
      ])
    ).toBeCloseTo(14.5, 5);
  });
});
