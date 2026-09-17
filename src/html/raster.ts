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
  /** Capture in measured child coordinates with ancestor group transforms disabled, then restore them. */
  groupSpace?: boolean;
  /** raster density: `deviceScaleFactor = dpi / 96` */
  dpi: number;
  /** viewport in CSS px, needed to re-assert the metrics override */
  viewport: { width: number; height: number };
}

const ISOLATE_ATTR = 'data-deckflip-raster-target';

/**
 * One `requestAnimationFrame` only gets us to the frame before the mutation is painted; the second one
 * observes the frame after it has been composited, which the determinism gate in docs/spec/11-architecture.md
 * and the byte-identity gates in docs/spec/10-* require.
 */
export async function waitForComposited(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * A compositor frame is necessary but not sufficient under load: Chromium may still return an older surface
 * to the first screenshot request. Require two consecutive byte-identical captures rather than letting a
 * transient surface change the content-hashed media part.
 */
export async function captureStablePng(page: Page, capture: () => Promise<string>): Promise<Uint8Array> {
  const maxAttempts = 8;
  let previous: string | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForComposited(page);
    const current = await capture();
    if (current === previous) {
      return Buffer.from(current, 'base64');
    }
    previous = current;
  }
  throw new Error(`Screenshot did not stabilise after ${maxAttempts} captures`);
}

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
    await page.evaluate(isolate, { selector: capture.selector, attr: ISOLATE_ATTR, groupClip: capture.groupSpace ? capture.clip : undefined });
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...metrics, deviceScaleFactor: scale });
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    return await captureStablePng(page, async () => {
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: capture.groupSpace ? 0 : capture.clip.x, y: capture.groupSpace ? 0 : capture.clip.y, width: capture.clip.w, height: capture.clip.h, scale: 1 },
        captureBeyondViewport: true,
      });
      return data;
    });
  } finally {
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', {});
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...metrics, deviceScaleFactor: 1 });
    await page.evaluate(restore, ISOLATE_ATTR);
    await cdp.detach();
  }
}

function isolate({ selector, attr, groupClip }: { selector: string; attr: string; groupClip: Box | undefined }): void {
  const style = document.createElement('style');
  style.setAttribute(attr, '');
  style.textContent = `html, body { visibility: hidden !important; background: transparent !important; } [${attr}="target"] { visibility: visible !important; }`;
  const target = document.querySelector(selector);
  target?.setAttribute(attr, 'target');
  if (groupClip) {
    // Child coordinates may lie outside the Canvas (even at negative positions). Move the capture to the
    // origin rather than baking ancestor transforms into a picture that the native group will transform again.
    for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'SECTION') {
        parent.setAttribute(attr, 'origin');
        break;
      }
      parent.setAttribute(attr, parent.hasAttribute('data-group') ? 'group' : 'ancestor');
    }
    style.textContent += ` [${attr}="group"] { transform: none !important; }
      [${attr}="group"], [${attr}="ancestor"], [${attr}="origin"] { overflow: visible !important; }
      [${attr}="origin"] { transform: translate(${-groupClip.x}px, ${-groupClip.y}px) !important; }`;
  }
  document.head.appendChild(style);
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
