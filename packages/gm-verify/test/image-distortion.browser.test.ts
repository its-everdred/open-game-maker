import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { measureImageDistortion } from '../app-capture/image-distortion.js';
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
        imageDraws: () => [
          { id: 'sprite', file: 'sprite.png', source: { width: 90, height: 30 }, drawn: { width: 30, height: 30 } },
        ],
      };
    });
    const findings = await measureImageDistortion(page.mainFrame(), '390x844', 'play');
    expect(findings.map((item) => item.element)).toEqual(['#bad', '#background', 'sprite']);
    expect(findings[0]).toMatchObject({ natural: 3, drawn: 1, viewport: '390x844' });
  } finally {
    await browser.close();
  }
});
