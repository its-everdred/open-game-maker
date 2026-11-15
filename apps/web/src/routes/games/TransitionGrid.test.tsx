import { createRef } from 'react';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TransitionGrid } from './TransitionGrid';

it('captures the old order before React rearranges the grid', () => {
  const gridRef = createRef<HTMLDivElement>();
  const snapshots: string[] = [];
  const capture = () => snapshots.push(gridRef.current?.textContent ?? '');
  const first = ['A', 'B'];
  const renderGrid = (order: string[]) => (
    <TransitionGrid gridRef={gridRef} order={order} selectedId={null} onSnapshot={capture} onKeyDown={vi.fn()}>
      {order.map((item) => (
        <div key={item}>{item}</div>
      ))}
    </TransitionGrid>
  );
  const view = render(renderGrid(first));
  view.rerender(renderGrid(['B', 'A']));
  expect(snapshots).toEqual(['AB']);
  expect(gridRef.current).toHaveTextContent('BA');
});
