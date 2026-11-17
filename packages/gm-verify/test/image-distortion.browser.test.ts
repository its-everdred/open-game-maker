import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { measureImageDistortion, trackShadowRoots } from '../app-capture/image-distortion.js';
import { SOFTWARE_ARGS } from '../src/browser.js';

it('reports stretched raster images and sprites, but accepts 9-slice and hidden images', async () => {
  const browser = await chromium.launch({ headless: true, args: SOFTWARE_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 90;
      canvas.height = 30;
      return canvas.toDataURL();
    });
    await page.setContent(
      `<img id="bad" src="${png}" style="width:30px;height:30px"><div style="display:none"><img src="${png}" style="width:30px;height:30px"></div><div id="slice" style="width:30px;height:30px;border:10px solid transparent;border-image:url(${png}) 1 fill / 10px stretch"></div><div id="background" style="width:30px;height:30px;background-image:url(${png});background-size:100% 100%"></div><div style="width:30px;height:30px;background-image:url(${png});background-size:contain"></div>`,
    );
    await page.locator('#bad').evaluate((image: HTMLImageElement) => image.decode());
    await page.evaluate(() => {
      (window as unknown as { __gm: unknown }).__gm = {
        imageDrawsReady: () => true,
        imageDraws: () => [
          { id: 'sprite', file: 'sprite.png', source: { width: 90, height: 30 }, drawn: { width: 30, height: 30 } },
          { id: 'broken', file: 'broken.png', source: { width: 0, height: 30 }, drawn: { width: 30, height: 30 } },
        ],
      };
    });
    const findings = await measureImageDistortion(page.mainFrame(), '390x844', 'play');
    expect(findings.map((item) => item.element)).toEqual(['#bad', '#background', 'sprite', 'broken']);
    expect(findings.find((item) => item.element === 'broken')?.error).toContain('invalid SDK');
    expect(findings[0]).toMatchObject({ natural: 3, drawn: 1, viewport: '390x844' });
  } finally {
    await browser.close();
  }
});

it('inspects shadow roots, pseudo-elements and stylesheet-resistant size probes', async () => {
  const browser = await chromium.launch({ headless: true, args: SOFTWARE_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.evaluate(trackShadowRoots);
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 30;
      return canvas.toDataURL();
    });
    await page.route('https://example.test/button(1).png', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(png.split(',')[1]!, 'base64') }),
    );
    await page.setContent(
      `<style>div { width: 100px !important; } #pseudo::before {content:'';display:block;width:90px;height:30px;background:url("${png}") 0 0 / 100% 100%}</style><div id="probe" style="height:100px;background:url('https://example.test/button(1).png') 0 0 / 90px 30px"></div><div id="pseudo"></div><div id="host"></div>`,
    );
    await page.evaluate((image) => {
      const root = document.querySelector('#host')!.attachShadow({ mode: 'closed' });
      root.innerHTML = `<img id="shadow-image" src="${image}" style="width:90px;height:30px">`;
    }, png);
    await page.waitForFunction(() => (document.querySelector('#probe') as HTMLElement).offsetWidth > 0);
    const findings = await measureImageDistortion(page.mainFrame(), '390x844', 'play');
    expect(findings.map((item) => item.element)).toEqual(
      expect.arrayContaining(['#probe', '#pseudo::before', '#shadow-image']),
    );
    expect(findings.find((item) => item.element === '#probe')?.file).toContain('button(1).png');
    expect(findings.find((item) => item.element === '#pseudo::before')).toMatchObject({ natural: 1, drawn: 3 });
  } finally {
    await browser.close();
  }
});

it('detects calculated sizes and transforms and reports unsupported image sets', async () => {
  const browser = await chromium.launch({ headless: true, args: SOFTWARE_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 90;
      canvas.height = 30;
      return canvas.toDataURL();
    });
    await page.setContent(
      `<img id="transform" src="${png}" style="width:90px;height:30px;object-fit:contain;transform:scale(2,1)"><div id="calc" style="width:90px;height:30px;background-image:url(${png});background-size:calc(100% - 10px) 100%"></div><div id="set" style="width:90px;height:30px;background-image:image-set(url(${png}) 1x, url(${png}) 2x)"></div><canvas width="90" height="30"></canvas>`,
    );
    await page.locator('#transform').evaluate((image: HTMLImageElement) => image.decode());
    await page.evaluate(() => {
      (window as unknown as { __gm: unknown }).__gm = { imageDraws: () => [], imageDrawsReady: () => false };
    });
    const findings = await measureImageDistortion(page.mainFrame(), '390x844', 'play', true);
    expect(findings.map((item) => item.element)).toEqual(
      expect.arrayContaining(['#transform', '#calc', '#set', 'canvas']),
    );
    expect(findings.find((item) => item.element === '#set')?.error).toContain('image-set');
    expect(findings.find((item) => item.element === 'canvas')?.error).toContain('unavailable');
  } finally {
    await browser.close();
  }
});

it('accepts exactly two percent but reports a larger change', async () => {
  const browser = await chromium.launch({ headless: true, args: SOFTWARE_ARGS });
  try {
    const page = await browser.newPage();
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 100;
      return canvas.toDataURL();
    });
    await page.setContent(
      `<img id="edge" src="${png}" style="width:102px;height:100px"><img id="over" src="${png}" style="width:103px;height:100px"><img id="fraction" src="${png}" style="width:24.49px;height:24px">`,
    );
    await page.locator('#edge').evaluate((image: HTMLImageElement) => image.decode());
    await page.locator('#over').evaluate((image: HTMLImageElement) => image.decode());
    await page.locator('#fraction').evaluate((image: HTMLImageElement) => image.decode());
    expect((await measureImageDistortion(page.mainFrame(), '390x844', 'play')).map((item) => item.element)).toEqual([
      '#over',
      '#fraction',
    ]);
  } finally {
    await browser.close();
  }
});
