// Isolated raster capture (docs/spec/05-raster.md): one PNG per rasterised subtree, taken from the measured page
// with everything but the target hidden, at `--raster-dpi`. Chromium's layout is unchanged by the device scale
// factor, so the capture is taken on the measurement page itself.

import type { Page } from 'playwright-core';
import type { Box } from '../model/index.js';

export interface RasterCapture {
  /** CSS selector of the subtree root, unique within the page */
  selector: string;
  /** clip rectangle in page coordinates, CSS px */
  clip: Box;
  /** raster density: `deviceScaleFactor = dpi / 96` */
  dpi: number;
  /** viewport in CSS px, needed to re-assert the metrics override */
  viewport: { width: number; height: number };
}

const ISOLATE_ATTR = 'data-deckflip-raster-target';

/**
 * PNG with alpha of `clip`, showing only the target subtree: the root element and body are made invisible
 * (their backgrounds included) and the target is made visible again, so ancestors and overlapping siblings
 * never bleed into the picture. Descendants that hide themselves stay hidden. Animations are already frozen
 * by the measurement page.
 */
export async function captureRaster(page: Page, capture: RasterCapture): Promise<Uint8Array> {
  const scale = capture.dpi / 96;
  const cdp = await page.context().newCDPSession(page);
  const metrics = { width: capture.viewport.width, height: capture.viewport.height, mobile: false };
  try {
    await page.evaluate(isolate, { selector: capture.selector, attr: ISOLATE_ATTR });
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...metrics, deviceScaleFactor: scale });
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: capture.clip.x, y: capture.clip.y, width: capture.clip.w, height: capture.clip.h, scale: 1 },
      captureBeyondViewport: true,
    });
    return new Uint8Array(Buffer.from(data, 'base64'));
  } finally {
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', {});
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...metrics, deviceScaleFactor: 1 });
    await page.evaluate(restore, ISOLATE_ATTR);
    await cdp.detach();
  }
}
function isolate({ selector, attr }: { selector: string; attr: string }): void {
  const style = document.createElement('style');
  style.setAttribute(attr, '');
  style.textContent = `html, body { visibility: hidden !important; background: transparent !important; } [${attr}] { visibility: visible !important; }`;
  document.head.appendChild(style);
  document.querySelector(selector)?.setAttribute(attr, '');
}

function restore(attr: string): void {
  for (const node of Array.from(document.querySelectorAll(`[${attr}]`))) {
    if (node.tagName === 'STYLE') {
      node.remove();
    } else {
      node.removeAttribute(attr);
    }
  }
}
