import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { measureImageDistortion } from '../app-capture/image-distortion.js';
import { frameCovered, frameTransform } from '../app-capture/frame-geometry.js';
import { trackShadowRoots } from '../app-capture/capture-instrumentation.js';
import { GPU_ARGS, SOFTWARE_ARGS } from '../src/browser.js';

const browserArgs = process.env.GM_VERIFY_SOFTWARE_GL === '1' ? SOFTWARE_ARGS : GPU_ARGS;

it('reports stretched raster images and sprites, but accepts 9-slice and hidden images', async () => {
  const browser = await chromium.launch({ headless: true, args: browserArgs });
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

it('honours visibility, clipping, occlusion, fixed backgrounds and small pseudo anchors', async () => {
  const browser = await chromium.launch({ headless: true, args: browserArgs });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 30;
      return canvas.toDataURL();
    });
    await page.setContent(
      `<style>#anchor::before, #offscreen::before { content:''; display:block; width:90px; height:30px; background:url("${png}") 0 0 / 100% 100%; } #offscreen::before { position:absolute; left:0; top:0; }</style><div style="visibility:hidden"><img id="visible" src="${png}" style="visibility:visible;width:90px;height:30px"></div><div style="width:1px;height:1px;overflow:hidden"><canvas width="90" height="30" style="position:relative;left:100px"></canvas></div><canvas width="10" height="10"></canvas><div id="anchor" style="width:1px;height:1px"></div><div id="offscreen" style="position:fixed;left:-500px;top:0;width:30px;height:30px"></div><div id="fixed" style="width:100px;height:100px;background:url('${png}') 0 0 / 100% 100% fixed"></div><span id="badge" style="background:url('${png}') 0 0 / 20px 20px">long enough badge</span><img id="covered" src="${png}" style="position:fixed;left:10px;top:500px;width:90px;height:30px"><div style="position:fixed;left:0;top:490px;width:120px;height:50px;background:rgb(0,0,0)"></div>`,
    );
    await page.locator('#visible').evaluate((image: HTMLImageElement) => image.decode());
    const findings = await measureImageDistortion(page.mainFrame(), '390x844', 'play', true);
    expect(findings.map((item) => item.element)).toEqual(
      expect.arrayContaining(['#visible', '#anchor::before', '#fixed']),
    );
    expect(findings.map((item) => item.element)).not.toContain('#covered');
    expect(findings.map((item) => item.element)).not.toContain('#offscreen::before');
    expect(findings.map((item) => item.element)).not.toContain('#badge');
    expect(findings.map((item) => item.element)).not.toContain('canvas');
  } finally {
    await browser.close();
  }
});

it('composes standalone rotation with the embedding iframe transform', async () => {
  const browser = await chromium.launch({ headless: true, args: browserArgs });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 30;
      return canvas.toDataURL();
    });
    await page.setContent(
      '<iframe style="width:300px;height:300px;transform:scale(2,1);transform-origin:top left"></iframe>',
    );
    const frame = page.frames()[1]!;
    await frame.setContent(
      `<img id="rotated" src="${png}" style="width:100px;height:200px;rotate:90deg"><img id="small" src="${png}" style="width:20px;height:10px">`,
    );
    await frame.locator('#rotated').evaluate((image: HTMLImageElement) => image.decode());
    const findings = await measureImageDistortion(frame, '800x600', 'play', false, await frameTransform(frame));
    expect(findings).toContainEqual(expect.objectContaining({ element: '#rotated' }));
    expect(findings).toContainEqual(expect.objectContaining({ element: '#small' }));
    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:#000';
      document.body.append(overlay);
    });
    expect(await frameCovered(frame)).toBe(true);
  } finally {
    await browser.close();
  }
});

it('detects an unreported dynamic canvas draw even when the SDK attests an empty frame', async () => {
  const browser = await chromium.launch({ headless: true, args: browserArgs });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.evaluate(trackShadowRoots);
    await page.setContent('<canvas id="ui" width="90" height="90" style="width:90px;height:90px"></canvas>');
    await page.evaluate(() => {
      const source = document.createElement('canvas');
      source.width = 90;
      source.height = 30;
      const canvas = document.querySelector<HTMLCanvasElement>('#ui')!;
      canvas.getContext('2d')!.drawImage(source, 0, 0, 30, 30);
      (window as unknown as { __gm: unknown }).__gm = { imageDraws: () => [], imageDrawsReady: () => true };
    });
    const findings = await measureImageDistortion(page.mainFrame(), '390x844', 'play', true);
    expect(findings).toContainEqual(expect.objectContaining({ element: '#ui', natural: 3, drawn: 1 }));
  } finally {
    await browser.close();
  }
});

it('ignores invisible canvas draws and forgets draws after a restored clip and clear', async () => {
  const browser = await chromium.launch({ headless: true, args: browserArgs });
  try {
    const page = await browser.newPage();
    await page.evaluate(trackShadowRoots);
    await page.setContent('<canvas id="ui" width="90" height="90"></canvas>');
    await page.evaluate(() => {
      const source = document.createElement('canvas');
      source.width = 90;
      source.height = 30;
      const ctx = document.querySelector<HTMLCanvasElement>('#ui')!.getContext('2d')!;
      ctx.drawImage(source, -100, -100, 30, 30);
      ctx.globalAlpha = 0;
      ctx.drawImage(source, 0, 0, 30, 30);
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(60, 60, 10, 10);
      ctx.clip();
      ctx.drawImage(source, 0, 0, 30, 30);
      ctx.restore();
    });
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play')).toEqual([]);
    await page.evaluate(() => {
      const source = document.createElement('canvas');
      source.width = 90;
      source.height = 30;
      const ctx = document.querySelector<HTMLCanvasElement>('#ui')!.getContext('2d')!;
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.rect(0, 0, 30, 30);
      ctx.clip();
      ctx.drawImage(source, 0, 0, 30, 30);
      ctx.restore();
    });
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play')).toContainEqual(
      expect.objectContaining({ element: '#ui', natural: 3, drawn: 1 }),
    );
    await page.locator('#ui').evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.clearRect(0, 0, 90, 90));
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play')).toEqual([]);
    await page.evaluate(() => {
      const source = document.createElement('canvas');
      source.width = 90;
      source.height = 30;
      const ctx = document.querySelector<HTMLCanvasElement>('#ui')!.getContext('2d')!;
      ctx.drawImage(source, 0, 0, 30, 30);
    });
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play')).toContainEqual(
      expect.objectContaining({ element: '#ui', natural: 3, drawn: 1 }),
    );
    await page.evaluate(() => {
      const ctx = document.querySelector<HTMLCanvasElement>('#ui')!.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 90, 90);
    });
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play')).toEqual([]);
    await page.evaluate(() => {
      const source = document.createElement('canvas');
      source.width = 90;
      source.height = 30;
      const ctx = document.querySelector<HTMLCanvasElement>('#ui')!.getContext('2d')!;
      ctx.drawImage(source, 0, 0, 30, 30);
      const gradient = ctx.createLinearGradient(0, 0, 90, 0);
      gradient.addColorStop(0, '#000');
      gradient.addColorStop(1, '#fff');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 90, 90);
    });
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play')).toEqual([]);
  } finally {
    await browser.close();
  }
});

it('does not accept an empty UI report for a WebGL canvas', async () => {
  const browser = await chromium.launch({ headless: true, args: browserArgs });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.evaluate(trackShadowRoots);
    await page.setContent('<canvas id="webgl" width="90" height="90"></canvas>');
    const available = await page.evaluate(() => {
      (window as unknown as { __gm: unknown }).__gm = { imageDraws: () => [], imageDrawsReady: () => true };
      const gl = document.querySelector<HTMLCanvasElement>('#webgl')!.getContext('webgl');
      gl?.drawArrays(gl.TRIANGLES, 0, 6);
      return !!gl;
    });
    expect(available).toBe(true);
    await page.evaluate(() => (window as unknown as { __gmBeginUiFrame: () => void }).__gmBeginUiFrame());
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play', true)).toContainEqual(
      expect.objectContaining({ error: expect.stringContaining('WebGL UI coverage') }),
    );
    await page.evaluate(() => {
      (window as unknown as { __gm: unknown }).__gm = {
        imageDraws: () => [
          { id: 'unrelated', file: 'a.png', source: { width: 30, height: 30 }, drawn: { width: 30, height: 30 } },
        ],
        imageDrawsReady: () => true,
      };
    });
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play', true)).toContainEqual(
      expect.objectContaining({ error: expect.stringContaining('WebGL UI coverage') }),
    );
    await page.evaluate(() => {
      (window as unknown as { __gm: unknown }).__gm = {
        imageDraws: () => [
          {
            id: 'only-one',
            canvasId: 'webgl',
            file: 'a.png',
            source: { width: 30, height: 30 },
            drawn: { width: 30, height: 30 },
          },
        ],
        imageDrawsReady: () => true,
      };
    });
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play', true)).toEqual([]);
    await page.evaluate(() => {
      const gl = document.querySelector<HTMLCanvasElement>('#webgl')!.getContext('webgl')!;
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      (window as unknown as { __gm: unknown }).__gm = {
        imageDraws: () => [
          {
            id: 'only-one',
            canvasId: 'webgl',
            file: 'a.png',
            source: { width: 30, height: 30 },
            drawn: { width: 30, height: 30 },
          },
        ],
        imageDrawsReady: () => true,
      };
    });
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play', true)).toContainEqual(
      expect.objectContaining({ error: expect.stringContaining('WebGL UI coverage') }),
    );
    await page.evaluate(() => {
      const gl = document.querySelector<HTMLCanvasElement>('#webgl')!.getContext('webgl')!;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 12);
      (window as unknown as { __gm: unknown }).__gm = {
        imageDraws: () =>
          ['a', 'b'].map((id) => ({
            id,
            canvasId: 'webgl',
            file: 'a.png',
            source: { width: 30, height: 30 },
            drawn: { width: 30, height: 30 },
          })),
        imageDrawsReady: () => true,
      };
    });
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play', true)).toEqual([]);
    await page.locator('#webgl').evaluate((canvas: HTMLCanvasElement) => {
      canvas.dataset.gmWorldCanvas = 'true';
    });
    await page.evaluate(() => {
      (window as unknown as { __gm: unknown }).__gm = { imageDraws: () => [], imageDrawsReady: () => true };
    });
    expect(await measureImageDistortion(page.mainFrame(), '390x844', 'play', true)).toEqual([]);
  } finally {
    await browser.close();
  }
});

it('reports canvas patterns and transferred canvases as unverified', async () => {
  const browser = await chromium.launch({ headless: true, args: browserArgs });
  try {
    const page = await browser.newPage();
    await page.evaluate(trackShadowRoots);
    await page.setContent(
      '<canvas id="pattern" width="90" height="90"></canvas><canvas id="worker" width="90" height="90"></canvas>',
    );
    await page.evaluate(() => {
      const image = document.createElement('canvas');
      image.width = 90;
      image.height = 30;
      const ctx = document.querySelector<HTMLCanvasElement>('#pattern')!.getContext('2d')!;
      ctx.fillStyle = ctx.createPattern(image, 'repeat')!;
      ctx.fillRect(0, 0, 90, 90);
      document.querySelector<HTMLCanvasElement>('#worker')!.transferControlToOffscreen();
    });
    const findings = await measureImageDistortion(page.mainFrame(), '390x844', 'play');
    expect(findings).toContainEqual(expect.objectContaining({ error: 'canvas pattern rendering cannot be verified' }));
    expect(findings).toContainEqual(expect.objectContaining({ error: 'worker canvas rendering cannot be verified' }));
  } finally {
    await browser.close();
  }
});

it('tracks DOM mutations that can invalidate a capture measurement', async () => {
  const browser = await chromium.launch({ headless: true, args: browserArgs });
  try {
    const page = await browser.newPage();
    await page.evaluate(trackShadowRoots);
    const versions = await page.evaluate(() => {
      const version = (window as unknown as { __gmCaptureVersion: () => number }).__gmCaptureVersion;
      const before = version();
      document.body.append(document.createElement('img'));
      return [before, version()];
    });
    expect(versions[1]).toBeGreaterThan(versions[0]!);
    const stylesheetVersions = await page.evaluate(() => {
      const style = document.createElement('style');
      document.head.append(style);
      const version = (window as unknown as { __gmCaptureVersion: () => number }).__gmCaptureVersion;
      const before = version();
      style.sheet!.insertRule('body { transform: scale(2, 1) }');
      return [before, version()];
    });
    expect(stylesheetVersions[1]).toBeGreaterThan(stylesheetVersions[0]!);
  } finally {
    await browser.close();
  }
});

it('inspects shadow roots, pseudo-elements and stylesheet-resistant size probes', async () => {
  const browser = await chromium.launch({ headless: true, args: browserArgs });
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
      expect.arrayContaining(['#probe', '#pseudo::before', '#host >>> #shadow-image']),
    );
    expect(findings.find((item) => item.element === '#probe')?.file).toContain('button(1).png');
    expect(findings.find((item) => item.element === '#pseudo::before')).toMatchObject({ natural: 1, drawn: 3 });
  } finally {
    await browser.close();
  }
});

it('detects calculated sizes and transforms and reports unsupported image sets', async () => {
  const browser = await chromium.launch({ headless: true, args: browserArgs });
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
  const browser = await chromium.launch({ headless: true, args: browserArgs });
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
