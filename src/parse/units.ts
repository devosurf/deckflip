import { emuToPx } from '../ooxml/emu.js';

/** EMU -> CSS px, exact (so re-emission reproduces the EMU); `-0` normalised. */
export function px(emu: string | undefined): number {
  return emuToPx(Number(emu ?? 0)) || 0;
}

/** Hundredths of a point -> CSS px (`1 px = 0.75 pt`), exact. */
export function ptHundredthsToPx(value: string | undefined): number {
  return Number(value ?? 0) / 75 || 0;
}

/** Normalises floating-point noise from px arithmetic (sums, trigonometry) to 1/100000 px, well under one EMU. */
export function exact(value: number): number {
  return Math.round(value * 100000) / 100000 || 0;
}
