import { Layers, Play, Trash2, X } from 'lucide-react';
import type { QueuedJob } from '../types/studio';
import { formatTime, getTotalSegmentsDuration } from '../utils/timecode';

interface BatchQueueProps {
  queue: QueuedJob[];
  isProcessing: boolean;
  onRunQueue: () => void;
  onRemoveJob: (id: string) => void;
  onClearQueue: () => void;
}

const STATUS_BADGE: Record<QueuedJob['status'], string> = {
  queued: 'bg-zinc-800 text-zinc-300',
  running: 'bg-indigo-500/20 text-indigo-300 animate-pulse',
  done: 'bg-emerald-500/20 text-emerald-300',
  error: 'bg-rose-500/20 text-rose-300',
};

export function BatchQueue({
  queue,
  isProcessing,
  onRunQueue,
  onRemoveJob,
  onClearQueue,
}: BatchQueueProps) {
  if (queue.length === 0) return null;

  const pendingCount = queue.filter((j) => j.status === 'queued' || j.status === 'error').length;

  return (
    <div className="rounded-2xl bg-studio-900 border border-zinc-800/90 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Layers className="w-4 h-4 text-indigo-400" />
          Batch Clip Queue ({queue.length})
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onClearQueue}
            className="text-[11px] text-zinc-400 hover:text-rose-300 disabled:opacity-40 inline-flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
          <button
            type="button"
            disabled={isProcessing || pendingCount === 0}
            onClick={onRunQueue}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-45 text-[11px] font-semibold text-white inline-flex items-center gap-1.5"
          >
            <Play className="w-3 h-3 fill-current" />
            Export Queue ({pendingCount})
          </button>
        </div>
      </div>

      <div className="divide-y divide-zinc-800/70 max-h-52 overflow-y-auto">
        {queue.map((job) => {
          const dur = getTotalSegmentsDuration(job.segments);
          return (
            <div key={job.id} className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-zinc-200 truncate">{job.label}</div>
                <div className="text-[11px] font-mono text-zinc-500">
                  {job.segments.length > 1 ? `${job.segments.length} segments • ` : ''}
                  {formatTime(dur)} • {job.settings.mode.toUpperCase()}
                </div>
                {job.error && (
                  <div className="text-[11px] text-rose-400 mt-0.5 truncate">{job.error}</div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${STATUS_BADGE[job.status]}`}>
                  {job.status}
                </span>
                {job.status !== 'running' && (
                  <button
                    type="button"
                    onClick={() => onRemoveJob(job.id)}
                    aria-label="Remove queued job"
                    className="p-1 text-zinc-500 hover:text-rose-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
