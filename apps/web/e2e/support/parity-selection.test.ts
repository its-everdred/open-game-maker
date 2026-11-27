import { expect, it } from 'vitest';
import { paritySelection } from './parity-selection';

it('selects multiple known screens without accepting unknown entries', () => {
  expect([...paritySelection(undefined)]).toEqual([]);
  expect([...paritySelection('Home,GameSheet,Home')]).toEqual(['Home', 'GameSheet']);
  expect(paritySelection('all').has('Editor')).toBe(true);
  expect(() => paritySelection('Home,Unknown')).toThrow('Unknown glass parity screen');
});
