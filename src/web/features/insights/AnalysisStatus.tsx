import { LoaderCircle } from 'lucide-react';
import type { InsightStatus } from '../../../shared/insights';
import { analysisStatus } from './analysis-status';

export function AnalysisStatus({ data }: { data: InsightStatus }) {
  const status = analysisStatus(data);
  if ('blocked' in status)
    return (
      <div className="small muted insight-generating" role="status">
        <span>
          <strong>{status.title}.</strong> {status.detail}
        </span>
      </div>
    );
  const mcp = !data.runner || data.runner.provider === 'mcp-sampling';
  if (
    (mcp && data.connection?.state === 'disconnected') ||
    (data.reportStatus === 'ready' && data.pending === 0)
  )
    return null;
  const failed =
    data.worker?.timedOut ||
    data.reportStatus === 'failed' ||
    data.failed > 0 ||
    data.embeddingStatus === 'failed';
  const message = failed
    ? 'Couldn’t update your recommendations.'
    : status.busy
      ? 'Updating recommendations…'
      : data.total === 0
        ? 'Complete a practice attempt to get recommendations.'
        : 'Waiting for your tutor…';
  return (
    <div className="small muted insight-generating" role="status">
      {status.busy && !failed && (
        <LoaderCircle className="icon insight-spinner" aria-hidden="true" />
      )}
      <span>{message}</span>
    </div>
  );
}
