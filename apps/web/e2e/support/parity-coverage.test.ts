import { expect, it } from 'vitest';
import { missingParityCoverage } from './parity-coverage';

it('requires every reference and selected capture before all-artboard parity can pass', () => {
  const required = ['Title-780x1688', 'Home-780x1688'];
  const captures = [
    { name: 'Title-780x1688', screen: 'Title' },
    { name: 'Home-780x1688', screen: 'Home' },
  ];
  expect(missingParityCoverage(required, ['Title-780x1688.png'], captures, new Set(['Title']))).toEqual({
    missingReferences: ['Home-780x1688'],
    missingCaptures: ['Home-780x1688'],
  });
  expect(
    missingParityCoverage(required, ['Title-780x1688.png', 'Home-780x1688.png'], captures, new Set(['Title', 'Home'])),
  ).toEqual({ missingReferences: [], missingCaptures: [] });
  expect(
    missingParityCoverage(
      required,
      ['Title-780x1688.png', 'Home-780x1688.png', 'New-780x1688.png'],
      captures,
      new Set(['Title', 'Home']),
    ),
  ).toEqual({ missingReferences: [], missingCaptures: ['New-780x1688'] });
});
