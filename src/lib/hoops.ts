import type { EmbroideryDesign } from './embroidery';

// Brother PE900 optional frames: https://support.brother.com/g/b/colist.aspx?c=us&cao=hfemba&lang=en&pfs=1&prod=hf_pe900eus
// Dimensions are sewing areas, not outer frame dimensions. No automatic rotation.
export const HOOPS = [
  { id: 'small', name: 'Small', label: '2½ × 1 in', widthMm: 60, heightMm: 20, model: 'SA442' },
  { id: 'medium', name: 'Medium', label: '4 × 4 in', widthMm: 100, heightMm: 100, model: 'SA443' },
  { id: 'large', name: 'Large', label: '5 × 7 in', widthMm: 130, heightMm: 180, model: 'SA444' },
] as const;
export type Hoop = typeof HOOPS[number];
export const HOOP_MARGIN_MM = 2.5;
export function fitsHoop(widthMm: number, heightMm: number, hoop: Hoop) {
  return Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm > 0 && heightMm > 0 &&
    widthMm + 2 * HOOP_MARGIN_MM <= hoop.widthMm + 1e-8 && heightMm + 2 * HOOP_MARGIN_MM <= hoop.heightMm + 1e-8;
}
export function smallestFittingHoop(widthMm: number, heightMm: number): Hoop | null {
  return HOOPS.find(hoop => fitsHoop(widthMm, heightMm, hoop)) ?? null;
}
export function assertDesignFitsHoop(design: EmbroideryDesign, hoop: Hoop) {
  if (!fitsHoop(design.widthMm, design.heightMm, hoop)) throw new Error(`Choose a larger hoop or reduce the design to fit the ${hoop.widthMm} × ${hoop.heightMm} mm hoop.`);
}
