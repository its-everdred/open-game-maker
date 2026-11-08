import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { Offers } from './Offers';

afterEach(cleanup);

it('says why the build was refused above its options', () => {
  render(
    <Offers
      offers={['ask_admin']}
      message="This build needs more Energy than is left this week."
      onChoose={() => {}}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('This build needs more Energy than is left this week.');
  expect(screen.getByRole('button', { name: 'Ask an admin' })).toBeVisible();
});
