import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { CropAspectRatio, CropRect } from '../types/studio';

export interface DisplayBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CropOverlayProps {
  displayBox: DisplayBox;
  rotatedWidth: number;
  rotatedHeight: number;
  crop: CropRect | null;
  cropMode: boolean;
  onChange: (next: CropRect) => void;
}

type DragHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const ASPECT_NUMS: Record<CropAspectRatio, number | null> = {
  free: null,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
};

export function createCenteredCropForAspect(
  aspectRatio: CropAspectRatio,
  rotW: number,
  rotH: number
): CropRect {
  const ratio = ASPECT_NUMS[aspectRatio];
  if (!ratio || rotW <= 0 || rotH <= 0) {
    return { x: 0.1, y: 0.1, width: 0.8, height: 0.8, aspectRatio };
  }

  const frameRatio = rotW / rotH;
  let w = 0.85;
  let h = (w * frameRatio) / ratio;
  if (h > 0.85) {
    h = 0.85;
    w = (h * ratio) / frameRatio;
  }
  w = Math.min(1, Math.max(0.08, w));
  h = Math.min(1, Math.max(0.08, h));
  return {
    x: (1 - w) / 2,
    y: (1 - h) / 2,
    width: w,
    height: h,
    aspectRatio,
  };
}

export function CropOverlay({
  displayBox,
  rotatedWidth,
  rotatedHeight,
  crop,
  cropMode,
  onChange,
}: CropOverlayProps) {
  const active = crop ?? { x: 0, y: 0, width: 1, height: 1, aspectRatio: 'free' as CropAspectRatio };
  const dragRef = useRef<{
    handle: DragHandle;
    startClientX: number;
    startClientY: number;
    startCrop: CropRect;
  } | null>(null);

  if (!cropMode && !crop) return null;
  if (displayBox.width <= 4 || displayBox.height <= 4) return null;

  const minNorm = 0.06;
  const frameRatio = rotatedWidth / Math.max(1, rotatedHeight);
  const lockedPixelRatio = ASPECT_NUMS[active.aspectRatio];

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, handle: DragHandle) => {
    if (!cropMode) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCrop: { ...active },
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();

    const dx = (e.clientX - drag.startClientX) / displayBox.width;
    const dy = (e.clientY - drag.startClientY) / displayBox.height;
    const s = drag.startCrop;

    if (drag.handle === 'move') {
      const nextX = Math.max(0, Math.min(1 - s.width, s.x + dx));
      const nextY = Math.max(0, Math.min(1 - s.height, s.y + dy));
      onChange({ ...s, x: nextX, y: nextY });
      return;
    }

    let left = s.x;
    let top = s.y;
    let right = s.x + s.width;
    let bottom = s.y + s.height;

    if (drag.handle.includes('w')) left = Math.min(right - minNorm, Math.max(0, s.x + dx));
    if (drag.handle.includes('e')) right = Math.max(left + minNorm, Math.min(1, s.x + s.width + dx));
    if (drag.handle.includes('n')) top = Math.min(bottom - minNorm, Math.max(0, s.y + dy));
    if (drag.handle.includes('s')) bottom = Math.max(top + minNorm, Math.min(1, s.y + s.height + dy));

    let width = right - left;
    let height = bottom - top;

    if (lockedPixelRatio) {
      const isVerticalEdge = drag.handle === 'n' || drag.handle === 's';
      if (isVerticalEdge) {
        width = (height * lockedPixelRatio) / frameRatio;
        if (left + width > 1) {
          width = 1 - left;
          height = (width * frameRatio) / lockedPixelRatio;
        }
      } else {
        height = (width * frameRatio) / lockedPixelRatio;
        if (drag.handle.includes('n')) {
          top = bottom - height;
          if (top < 0) {
            top = 0;
            height = bottom;
            width = (height * lockedPixelRatio) / frameRatio;
            if (drag.handle.includes('w')) left = right - width;
          }
        } else if (top + height > 1) {
          height = 1 - top;
          width = (height * lockedPixelRatio) / frameRatio;
          if (drag.handle.includes('w')) left = right - width;
        }
      }
      width = Math.max(minNorm, Math.min(1 - left, width));
      height = Math.max(minNorm, Math.min(1 - top, height));
    }

    onChange({
      x: Math.max(0, left),
      y: Math.max(0, top),
      width,
      height,
      aspectRatio: s.aspectRatio,
    });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  const boxLeft = active.x * displayBox.width;
  const boxTop = active.y * displayBox.height;
  const boxW = active.width * displayBox.width;
  const boxH = active.height * displayBox.height;

  const pxW = Math.max(2, Math.round((active.width * rotatedWidth) / 2) * 2);
  const pxH = Math.max(2, Math.round((active.height * rotatedHeight) / 2) * 2);

  const handles: { id: DragHandle; className: string; cursor: string }[] = [
    { id: 'nw', className: '-top-1.5 -left-1.5', cursor: 'cursor-nwse-resize' },
    { id: 'n', className: '-top-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
    { id: 'ne', className: '-top-1.5 -right-1.5', cursor: 'cursor-nesw-resize' },
    { id: 'e', className: 'top-1/2 -translate-y-1/2 -right-1.5', cursor: 'cursor-ew-resize' },
    { id: 'se', className: '-bottom-1.5 -right-1.5', cursor: 'cursor-nwse-resize' },
    { id: 's', className: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
    { id: 'sw', className: '-bottom-1.5 -left-1.5', cursor: 'cursor-nesw-resize' },
    { id: 'w', className: 'top-1/2 -translate-y-1/2 -left-1.5', cursor: 'cursor-ew-resize' },
  ];

  return (
    <div
      className="absolute z-20 pointer-events-none overflow-hidden"
      style={{
        left: `${displayBox.left}px`,
        top: `${displayBox.top}px`,
        width: `${displayBox.width}px`,
        height: `${displayBox.height}px`,
      }}
    >
      {/* Crop box with surrounding dim mask via box-shadow */}
      <div
        onPointerDown={(e) => onPointerDown(e, 'move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        className={`absolute ${
          cropMode
            ? 'pointer-events-auto cursor-move border-2 border-indigo-400'
            : 'pointer-events-none border border-dashed border-indigo-400/75'
        }`}
        style={{
          left: `${boxLeft}px`,
          top: `${boxTop}px`,
          width: `${boxW}px`,
          height: `${boxH}px`,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.58)',
        }}
      >
        {/* Rule-of-thirds guides when editing crop */}
        {cropMode && (
          <>
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/25 pointer-events-none" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/25 pointer-events-none" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/25 pointer-events-none" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/25 pointer-events-none" />
          </>
        )}

        {/* Live crop dimension readout */}
        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 border border-white/15 font-mono text-[10px] text-indigo-200 pointer-events-none">
          {pxW}×{pxH}
        </div>

        {/* 8 interactive drag handles */}
        {cropMode &&
          handles.map((h) => (
            <div
              key={h.id}
              onPointerDown={(e) => onPointerDown(e, h.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className={`absolute w-3.5 h-3.5 rounded-sm bg-white border-2 border-indigo-600 shadow pointer-events-auto ${h.className} ${h.cursor}`}
            />
          ))}
      </div>
    </div>
  );
}
