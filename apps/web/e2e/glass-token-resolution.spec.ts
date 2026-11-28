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

test('chat controls use one blue accent and embedded buttons have no raised edge', async ({ page }) => {
  await page.setContent(`
    <div class="ogm-glass-composer"><aiur-composer></aiur-composer></div>
    <div class="ogm-glass-message ogm-message-self">Hello</div>
    <button class="ogm-glass-button ogm-tone-glassy">Outside</button>
    <button class="ogm-glass-button ogm-tone-glassy ogm-embedded">Inside</button>
    <input class="ogm-glass-input" />
    <span id="chat-accent" style="color: var(--ogm-role-chat)"></span>
  `);
  await page.addStyleTag({ content: `${tokens}\n${componentCss}` });
  const result = await page.evaluate(() => {
    const outside = getComputedStyle(document.querySelector('.ogm-glass-button:not(.ogm-embedded)')!);
    const inside = getComputedStyle(document.querySelector('.ogm-embedded')!);
    const field = getComputedStyle(document.querySelector('.ogm-glass-input')!);
    const chat = getComputedStyle(document.querySelector('.ogm-glass-composer')!);
    const bubble = getComputedStyle(document.querySelector('.ogm-message-self')!);
    return {
      outside: [outside.borderTopColor, outside.borderLeftColor, outside.boxShadow, outside.borderTopWidth],
      inside: [inside.borderTopWidth, inside.boxShadow],
      field: [field.borderTopColor, field.borderLeftColor, field.boxShadow],
      chat: chat.getPropertyValue('--aiur-composer-accent').trim(),
      bubble: bubble.backgroundColor,
      blue: chat.getPropertyValue('--ogm-role-working').trim(),
      blueRgb: getComputedStyle(document.querySelector('#chat-accent')!).color,
    };
  });
  expect(result.outside[0]).not.toBe(result.outside[1]);
  expect(result.outside[2]).not.toBe('none');
  expect(result.outside[3]).toBe('1px');
  expect(result.inside).toEqual(['0px', 'none']);
  expect(result.field[0]).not.toBe(result.field[1]);
  expect(result.field[2]).not.toBe('none');
  expect(result.chat).toBe(result.blue);
  expect(result.bubble).toBe(result.blueRgb);
});
