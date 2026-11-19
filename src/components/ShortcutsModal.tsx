import { Keyboard, X } from 'lucide-react';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'Space / K', desc: 'Play or pause video preview' },
  { key: 'J / L', desc: 'Step backward / forward 1s (or change playback rate)' },
  { key: ', / .', desc: 'Frame step backward / forward (-1f / +1f)' },
  { key: '← / →', desc: 'Seek backward / forward 1s (or nudge focused trim handle)' },
  { key: 'I / O', desc: 'Set active segment Start / End to playhead' },
  { key: 'S', desc: 'Split active segment at playhead' },
  { key: 'R', desc: 'Rotate video 90° clockwise' },
  { key: 'C', desc: 'Toggle interactive crop overlay' },
  { key: 'M', desc: 'Mute / unmute preview audio' },
];

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-studio-900 border border-zinc-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Keyboard className="w-4 h-4 text-indigo-400" />
            Keyboard Shortcuts
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-2.5">
          {SHORTCUTS.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4 text-xs">
              <span className="text-zinc-300">{item.desc}</span>
              <kbd className="px-2 py-1 rounded-lg bg-studio-950 border border-zinc-700 font-mono text-[11px] text-indigo-300 shrink-0">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
