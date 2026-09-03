// CSS values for IDM primitives, written the way html/browser-script.ts reads them back: colours as
// `#RRGGBB`/`rgba()`, one fill layer, one shadow layer with zero spread, borders per side.

import type { Box, Color, Fill, Geometry, Line, Shadow } from '../model/index.js';

/**
 * Chromium lays out in 1/64 px and truncates a CSS length to it, so a measured value that came back through
 * EMU with sub-EMU noise (826.484375 -> 826.48399) would land one LayoutUnit short. Values within EMU noise
 * of a 1/64 multiple snap to it; others keep 5 decimals (under one EMU). `-0` normalised.
 */
export function num(value: number): string {
  const snapped = Math.round(value * 64) / 64;
  if (Math.abs(snapped - value) < 0.0001) {
    return String(snapped || 0);
  }
  return String(Math.round(value * 100000) / 100000 || 0);
}

/**
 * A layout-derived value (line box height, paragraph gap) that came back through hundredths of a point (a
 * 1/75 px grid, error under 1/150): the 1/64 multiple it was measured as, which is unique since 1/150 < 1/128.
 */
export function layoutPx(value: number): number {
  return Math.round(value * 64) / 64;
}

export function pxv(value: number): string {
  return `${num(value)}px`;
}

export function color(value: Color): string {
  if (value.alpha >= 1) {
    return `#${value.hex}`;
  }
  const channel = (offset: number): number => parseInt(value.hex.slice(offset, offset + 2), 16);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${num(value.alpha)})`;
}

/** `left/top/width/height` of an absolutely positioned border box, plus its rotation about the centre. */
export function boxCss(box: Box, rotation: number): string[] {
  const out = [`position: absolute`, `left: ${pxv(box.x)}`, `top: ${pxv(box.y)}`, `width: ${pxv(box.w)}`, `height: ${pxv(box.h)}`];
  if (rotation !== 0) {
    out.push(`transform: rotate(${num(rotation)}deg)`);
  }
  return out;
}

export function geometryCss(geometry: Geometry): string[] {
  switch (geometry.preset) {
    case 'rect':
      return [];
    case 'roundRect':
      return [`border-radius: ${pxv(geometry.radius)}`];
    case 'ellipse':
      return ['border-radius: 50%'];
    case 'custom': {
      const corners = [geometry.radii.tl, geometry.radii.tr, geometry.radii.br, geometry.radii.bl];
      return [`border-radius: ${corners.map((r) => pxv(r.x)).join(' ')} / ${corners.map((r) => pxv(r.y)).join(' ')}`];
    }
  }
}

/** Solid and gradient fills; image fills are placed by the caller, which owns the asset path. */
export function fillCss(fill: Exclude<Fill, { type: 'image' }>): string[] {
  if (fill.type === 'solid') {
    return [`background-color: ${color(fill.color)}`];
  }
  const stops = fill.stops.map((stop) => `${color(stop.color)} ${num(stop.position * 100)}%`).join(', ');
  if (fill.kind === 'radial') {
    return [`background-image: radial-gradient(circle, ${stops})`];
  }
  return [`background-image: linear-gradient(${num(fill.angle)}deg, ${stops})`];
}

export function lineValue(line: Line): string {
  const style = line.dash === 'dash' ? 'dashed' : line.dash === 'dot' ? 'dotted' : 'solid';
  return `${pxv(line.width)} ${style} ${color(line.color)}`;
}

export function borderCss(line: Line | undefined, borders: { top?: Line; right?: Line; bottom?: Line; left?: Line } | undefined): string[] {
  if (line) {
    return [`border: ${lineValue(line)}`];
  }
  if (!borders) {
    return [];
  }
  const out: string[] = [];
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const edge = borders[side];
    if (edge) {
      out.push(`border-${side}: ${lineValue(edge)}`);
    }
  }
  return out;
}

export function shadowCss(shadow: Shadow | undefined): string[] {
  if (!shadow) {
    return [];
  }
  return [`box-shadow: ${shadow.inset ? 'inset ' : ''}${pxv(shadow.offsetX)} ${pxv(shadow.offsetY)} ${pxv(shadow.blur)} 0 ${color(shadow.color)}`];
}
