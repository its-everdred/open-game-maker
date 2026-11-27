import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const tokens = readFileSync(new URL('../src/glass-tokens.css', import.meta.url), 'utf8');
const componentCss = readFileSync(new URL('../src/components/glass/glass.css', import.meta.url), 'utf8').replace(
  /^@import[^;]+;\s*/,
  '',
);

test('accent tokens resolve on each control', async ({ page }) => {
  await page.setContent(
    '<button class="ogm-glass-option ogm-tone-warn" aria-pressed="true">Adventure</button><button class="ogm-glass-button ogm-tone-go">Play</button><div class="ogm-glass-pane ogm-tint ogm-tone-warn"></div>',
  );
  await page.addStyleTag({ content: `${tokens}\n${componentCss}` });
  const values = await page.evaluate(() => {
    const option = document.querySelector('.ogm-glass-option')!;
    return {
      edge: getComputedStyle(option, '::before').backgroundImage,
      shadow: getComputedStyle(option).boxShadow,
      actionShadow: getComputedStyle(document.querySelector('.ogm-glass-button')!).boxShadow,
      tintEdge: getComputedStyle(document.querySelector('.ogm-glass-pane')!, '::before').backgroundImage,
    };
  });
  expect(values.edge).toContain('gradient');
  expect(values.shadow).not.toBe('none');
  expect(values.actionShadow).not.toBe('none');
  expect(values.tintEdge).toContain('gradient');
});

test('slider track resolves the control fill', async ({ page }) => {
  await page.setContent('<input class="ogm-glass-slider" type="range" style="--ogm-slider-fill: 40%" />');
  await page.addStyleTag({ content: `${tokens}\n${componentCss}` });
  const track = await page
    .locator('input')
    .evaluate((slider) => getComputedStyle(slider).getPropertyValue('--ogm-component-slider-track'));
  expect(track).toContain('gradient');
  expect(track).toContain('40%');
});

test('display typography retains the approved fallback order', async ({ page }) => {
  await page.setContent('<p style="font-family: var(--ogm-font-display)">Title</p>');
  await page.addStyleTag({ content: tokens });
  const family = await page.locator('p').evaluate((element) => getComputedStyle(element).fontFamily);
  expect(family).toMatch(/Fredoka.*Nunito.*system-ui.*sans-serif/i);
});
