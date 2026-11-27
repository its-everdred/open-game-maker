import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivityRing } from './ActivityRing';
import type { WorkerBuild } from './BuildTracker';

const worker = (percent: number | null, state = 'in-progress'): WorkerBuild => ({
  ticket: 'game:1',
  title: 'Build',
  percent,
  state,
  etaSeconds: null,
});

describe('ActivityRing', () => {
  it('renders the aggregate progress as a decorative arc', () => {
    const { container } = render(<ActivityRing workers={[worker(20), worker(80)]} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.activity-ring-fill')).toHaveAttribute('stroke-dasharray', '50 100');
  });

  it('shows no invented percentage for unknown progress and disappears without active workers', () => {
    const { container, rerender } = render(<ActivityRing workers={[worker(null)]} />);
    expect(container.querySelector('.activity-ring-track')).not.toBeNull();
    expect(container.querySelector('.activity-ring-fill')).toBeNull();
    rerender(<ActivityRing workers={[worker(100, 'human-review')]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
