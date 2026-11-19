import { test, expect } from 'vitest';
import { frameWidth, hasPixels, farmerOrigin, animalOrigin, animalGeometry } from './farm-animal-frames.mjs';
import sharp from 'sharp';

test('recognizes the measured 24-column animal sheets and rejects other widths', () => {
  expect(frameWidth(768)).toBe(32);
  expect(frameWidth(1536)).toBe(64);
  expect(frameWidth(2304)).toBe(96);
  expect(frameWidth(1658)).toBeNull();
});

test('recognizes the two visually checked irregular sheets only at their measured dimensions', () => {
  expect(animalGeometry('Dogs_Doghouse_Sleeping_32x32.png', 512, 858)).toEqual({ width: 64, height: 96 });
  expect(animalGeometry('Duck_White_32x32.png', 1658, 256)).toEqual({ width: 64, height: 64 });
  expect(animalGeometry('Duck_White_32x32.png', 1659, 256)).toBeNull();
});

test('locates the first occupied row in a farmer sheet', async () => {
  const red = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const sheet = await sharp({ create: { width: 64, height: 160, channels: 4, background: '#00000000' } })
    .composite([{ input: red, top: 96, left: 0 }]).png().toBuffer();
  expect(await farmerOrigin(sheet)).toEqual({ left: 0, top: 96 });
});

test('rejects an empty first cell', async () => {
  const blank = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#00000000' } }).png().toBuffer();
  const filled = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff0000' } }).png().toBuffer();
  expect(await hasPixels(blank, 32)).toBe(false);
  expect(await hasPixels(filled, 32)).toBe(true);
});

test('finds a visible frame among the first four cells', async () => {
  const red = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const sheet = await sharp({ create: { width: 128, height: 32, channels: 4, background: '#00000000' } })
    .composite([{ input: red, top: 0, left: 32 }]).png().toBuffer();
  expect(await animalOrigin(sheet, 32)).toEqual({ left: 32, top: 0 });
});

test('finds the first frame when the first row is empty', async () => {
  const red = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const sheet = await sharp({ create: { width: 128, height: 64, channels: 4, background: '#00000000' } })
    .composite([{ input: red, top: 32, left: 0 }]).png().toBuffer();
  expect(await animalOrigin(sheet, 32)).toEqual({ left: 0, top: 32 });
});

test('skips an opaque sheet label before a sprite', async () => {
  const banner = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#00ff00' } }).png().toBuffer();
  const red = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const sheet = await sharp({ create: { width: 128, height: 32, channels: 4, background: '#00000000' } })
    .composite([{ input: banner, top: 0, left: 0 }, { input: red, top: 0, left: 32 }]).png().toBuffer();
  expect(await animalOrigin(sheet, 32)).toEqual({ left: 32, top: 0 });
});
