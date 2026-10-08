// Group coordinate spaces in CSS px: how a `p:grpSp`'s `off/ext` and `chOff/chExt` (plus rotation and flips)
// map its children onto the Slide. Shared by measurement, which classifies grouped children in Canvas
// coordinates, and Verification, which compares both sides of a conversion there.

import type { Box, GroupElement } from './index.js';

export type Matrix2d = { a: number; b: number; c: number; d: number; e: number; f: number };

/** Compose the group's child-to-parent mapping with its ancestors, including axis reflections. */
export function groupToCanvas(group: Pick<GroupElement, 'box' | 'childBox' | 'rotation' | 'flipH' | 'flipV'>, parent?: Matrix2d): Matrix2d {
  const { box, childBox } = group;
  const angle = group.rotation * Math.PI / 180;
  const sx = (childBox.w === 0 ? 1 : box.w / childBox.w) * (group.flipH ? -1 : 1);
  const sy = (childBox.h === 0 ? 1 : box.h / childBox.h) * (group.flipV ? -1 : 1);
  const a = Math.cos(angle) * sx;
  const b = Math.sin(angle) * sx;
  const c = -Math.sin(angle) * sy;
  const d = Math.cos(angle) * sy;
  const cx = childBox.x + childBox.w / 2;
  const cy = childBox.y + childBox.h / 2;
  const e = box.x + box.w / 2 - a * cx - c * cy;
  const f = box.y + box.h / 2 - b * cx - d * cy;
  if (!parent) return { a, b, c, d, e, f };
  return {
    a: parent.a * a + parent.c * b, b: parent.b * a + parent.d * b,
    c: parent.a * c + parent.c * d, d: parent.b * c + parent.d * d,
    e: parent.a * e + parent.c * f + parent.e, f: parent.b * e + parent.d * f + parent.f,
  };
}

/** Axis-aligned Canvas bounds of a rotated child rectangle under all ancestor transforms. */
export function transformedBounds(box: Box, rotation: number, transform: Matrix2d): Box {
  const { a, b, c, d, e, f } = transform;
  const angle = rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = a * (box.x + box.w / 2) + c * (box.y + box.h / 2) + e;
  const cy = b * (box.x + box.w / 2) + d * (box.y + box.h / 2) + f;
  const w = Math.abs(a * cos + c * sin) * box.w + Math.abs(c * cos - a * sin) * box.h;
  const h = Math.abs(b * cos + d * sin) * box.w + Math.abs(d * cos - b * sin) * box.h;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
