import { LoaderCircle } from 'lucide-react';
import type { InsightStatus } from '../../../shared/insights';
import { analysisStatus } from './analysis-status';

const statusClass = 'flex items-center gap-2 text-xs text-muted-foreground';

export function AnalysisStatus({ data }: { data: InsightStatus }) {
  const status = analysisStatus(data);
  if ('blocked' in status)
    return (
      <div className={statusClass} role="status">
        <span>
          <strong>{status.title}.</strong> {status.detail}
        </span>
      </div>
    );
  if (data.reportStatus === 'ready' && data.pending === 0) return null;
  const failed =
    data.worker?.timedOut ||
    data.reportStatus === 'failed' ||
    data.failed > 0 ||
    data.embeddingStatus === 'failed';
  const message = failed
    ? `Couldn’t update your recommendations. ${status.detail}`
    : status.busy
      ? (data.reportActivity ?? 'Updating recommendations…')
      : data.total === 0
        ? 'Complete a practice attempt to get recommendations.'
        : 'Waiting for your tutor…';
  return (
    <div className={statusClass} role="status">
      {status.busy && !failed && (
        <LoaderCircle
          className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      <span>{message}</span>
    </div>
  );
}
