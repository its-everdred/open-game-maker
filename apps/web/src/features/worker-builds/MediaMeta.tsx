import type { MediaMeta as MediaMetaValue } from '@ogm/contracts';
import './media-meta.css';

export function MediaMeta({ meta }: { meta: MediaMetaValue }) {
  const parts = [
    meta.kind,
    meta.model,
    meta.cost_usd === null ? 'free' : meta.cost_usd === undefined ? undefined : `$${meta.cost_usd.toFixed(2)}`,
    meta.skill,
    meta.tool,
  ];
  const created = meta.created_at ? new Date(meta.created_at) : undefined;
  if (created && !Number.isNaN(created.getTime()))
    parts.push(`${String(created.getUTCHours()).padStart(2, '0')}:${String(created.getUTCMinutes()).padStart(2, '0')}`);
  if (meta.ai_generated) parts.push('AI');
  return <span className="media-meta">{parts.filter(Boolean).join(' · ')}</span>;
}
