import type { Job } from '@ogm/contracts';

import { formatUsage } from './units';

const KIND_LABELS: Record<Job['kind'], string> = {
  new_game: 'New game',
  feature: 'Feature',
  repair: 'Repair',
  scope: 'Scope',
};

export function JobRow({
  job,
  unitLabel,
  onOpen,
  onEdit,
  onCancel,
  cancelAvailable = true,
}: {
  job: Job;
  unitLabel: string;
  onOpen(): void;
  onEdit(): void;
  onCancel(): void;
  cancelAvailable?: boolean;
}) {
  const progress = job.state === 'done' ? 100 : (job.progressPercent ?? 0);
  const queuedAtReset = job.state === 'queued' && job.start === 'at_reset';
  const phase =
    job.state === 'queued' && job.start === 'now' && job.position !== undefined
      ? `Waiting for a build slot: #${job.position}`
      : (job.stageText ?? (job.state === 'done' ? 'Ready to try' : 'Waiting to start'));

  return (
    <li className={`build-chat-job ${job.state}`}>
      <button className="build-chat-job-main" type="button" onClick={onOpen}>
        <span className={`build-chat-kind ${job.kind}`}>{KIND_LABELS[job.kind]}</span>
        <strong>{job.plan.title}</strong>
        <span className="build-chat-job-phase">{phase}</span>
        <span className="build-chat-job-progress">{progress}%</span>
        <span className="build-chat-bar" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
        <small>{formatUsage(job.usageMicroUsd, job.reservation.amountMicroUsd, unitLabel)}</small>
      </button>
      {queuedAtReset ? (
        <div className="build-chat-queued-actions">
          <span>{job.startAt ? `Starts ${formatStart(job.startAt)}` : 'Starts at the daily reset'}</span>
          <button className="tap-secondary" type="button" onClick={onEdit}>
            Edit
          </button>
          {cancelAvailable ? (
            <button className="tap-secondary" type="button" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function formatStart(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
