import { FolderOpen, UploadCloud } from 'lucide-react';

interface DropZoneProps {
  onSelectFileClick: () => void;
  onDropFile: (file: File) => void;
}

export function DropZone({ onSelectFileClick, onDropFile }: DropZoneProps) {
  return (
    <section className="flex-1 flex flex-col items-center justify-center py-8 sm:py-14">
      <div
        onClick={onSelectFileClick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer?.files?.[0];
          if (file) onDropFile(file);
        }}
        className="w-full max-w-3xl rounded-3xl border-2 border-dashed border-zinc-800 hover:border-indigo-500/60 bg-studio-900/60 hover:bg-studio-900 transition-all duration-200 p-8 sm:p-12 text-center cursor-pointer group relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-zinc-800/80 group-hover:bg-indigo-500/15 border border-zinc-700/80 group-hover:border-indigo-500/40 flex items-center justify-center mb-5 transition-colors">
            <UploadCloud className="w-8 h-8 text-zinc-400 group-hover:text-indigo-400 transition-colors" />
          </div>

          <h2 className="text-xl sm:text-2xl font-semibold text-white mb-2">
            Drop a video anywhere to start editing
          </h2>
          <p className="text-sm text-zinc-400 max-w-lg mb-6">
            Supports <span className="text-zinc-200 font-medium">MP4, WebM, MOV, MKV, AVI</span>.
            Runs privately inside your browser with GPU WebCodecs &amp; WORKERFS FFmpeg.wasm — zero
            uploads.
          </p>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectFileClick();
            }}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition inline-flex items-center gap-2"
          >
            <FolderOpen className="w-4 h-4" />
            Choose Video File
          </button>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full text-left">
            <div className="p-3 rounded-xl bg-studio-950/75 border border-zinc-800/80">
              <div className="text-xs font-semibold text-indigo-300 mb-0.5">
                Target-Size &amp; 2-Pass
              </div>
              <div className="text-[11px] text-zinc-400">
                Hit 10 MB Discord/GitHub caps accurately with BPP quality forecasting.
              </div>
            </div>
            <div className="p-3 rounded-xl bg-studio-950/75 border border-zinc-800/80">
              <div className="text-xs font-semibold text-emerald-300 mb-0.5">
                GPU Fast Path
              </div>
              <div className="text-[11px] text-zinc-400">
                Hardware WebCodecs acceleration with automatic FFmpeg.wasm fallback.
              </div>
            </div>
            <div className="p-3 rounded-xl bg-studio-950/75 border border-zinc-800/80">
              <div className="text-xs font-semibold text-sky-300 mb-0.5">
                Crop, Rotate &amp; Multi-Cut
              </div>
              <div className="text-[11px] text-zinc-400">
                Visual crop overlay, filmstrip + waveform timeline, and multi-clip batching.
              </div>
            </div>
            <div className="p-3 rounded-xl bg-studio-950/75 border border-zinc-800/80">
              <div className="text-xs font-semibold text-fuchsia-300 mb-0.5">
                GIF, WebP &amp; Audio
              </div>
              <div className="text-[11px] text-zinc-400">
                2-pass palette GIFs, boomerangs, animated WebP, and MP3/M4A/WAV extract.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
