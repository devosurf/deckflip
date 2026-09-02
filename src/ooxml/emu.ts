export const EMU_PER_PX = 9525;

export function pxToEmu(px: number): number {
  return Math.round(px * EMU_PER_PX);
}

export function pxToHundredthsPt(px: number): number {
  return Math.round(px * 75);
}

export function emuToPx(emu: number): number {
  return emu / EMU_PER_PX;
}
