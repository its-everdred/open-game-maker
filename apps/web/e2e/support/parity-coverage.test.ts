import { expect, it } from 'vitest';
import { missingParityCoverage, missingSelectedParityCoverage, requiredParityArtboards } from './parity-coverage';

it('requires every reference and selected capture before all-artboard parity can pass', () => {
  const required = ['Title-780x1688', 'Home-780x1688'];
  const captures = [
    { name: 'Title-780x1688', screen: 'Title', width: 390, height: 844, scale: 2 },
    { name: 'Home-780x1688', screen: 'Home', width: 390, height: 844, scale: 2 },
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

it('requires landscape references for phone screens without an exported landscape artboard', () => {
  for (const name of ['SignInLandscape-844x390', 'SettingsLandscape-844x390', 'PauseLandscape-844x390']) {
    expect(requiredParityArtboards).toContain(name);
  }
  const result = missingParityCoverage(requiredParityArtboards, ['SignIn-780x1688.png'], [], new Set());
  expect(result.missingReferences).toContain('SignInLandscape-844x390');
});

it('requires landscape coverage for each selected screen, without requiring unrelated screens', () => {
  const capture = { name: 'Settings-780x1688', screen: 'Settings', width: 390, height: 844, scale: 2 };
  const reference = ['Settings-780x1688.png'];
  const selected = new Set(['Settings']);
  expect(missingSelectedParityCoverage(reference, [capture], selected)).toEqual({
    missingReferences: ['SettingsLandscape-844x390'],
    missingCaptures: ['SettingsLandscape-844x390'],
  });
  const landscape = { name: 'SettingsLandscape-844x390', screen: 'Settings', width: 844, height: 390, scale: 1 };
  expect(
    missingSelectedParityCoverage([...reference, `${landscape.name}.png`], [capture, landscape], selected),
  ).toEqual({
    missingReferences: [],
    missingCaptures: [],
  });
});

it('does not count a capture whose viewport or scale differs from its reference', () => {
  const reference = ['Home-780x1688.png'];
  const target = { name: 'Home-780x1688', screen: 'Home', width: 390, height: 844, scale: 2 };
  for (const wrong of [{ width: 391 }, { height: 845 }, { scale: 1 }]) {
    expect(missingParityCoverage(['Home-780x1688'], reference, [{ ...target, ...wrong }], new Set(['Home']))).toEqual({
      missingReferences: [],
      missingCaptures: ['Home-780x1688'],
    });
  }
});
