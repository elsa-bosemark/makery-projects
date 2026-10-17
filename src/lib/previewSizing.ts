export const PREVIEW_MM_SCALE = 490 / 520;
export const SHIRT_MIN_CM = 40;
export const SHIRT_MAX_CM = 65;
export function shirtLayout(widthCm: number) {
  const factor = widthCm / 52;
  return { factor, scale: PREVIEW_MM_SCALE, left: 450 - 245 * factor, right: 450 + 245 * factor,
    top: 90, bottom: 90 + 700 * factor, centerY: 90 + 275 * factor, rulerX: 450 - 405 * factor - 40 };
}
// Project the pointer movement onto the original corner vector to preserve proportions.
export function widthFromCornerDrag(width: number, dx: number, dy: number, corner: { x: number; y: number }, min: number, max: number) {
  const lengthSquared = corner.x ** 2 + corner.y ** 2;
  const next = lengthSquared ? width * (1 + (dx * corner.x + dy * corner.y) / lengthSquared) : width;
  return Math.max(min, Math.min(max, next));
}
export function rulerTicks(start: number, end: number, step: number) {
  return Array.from({ length: Math.max(0, Math.floor(end / step) - Math.ceil(start / step) + 1) }, (_, i) => (Math.ceil(start / step) + i) * step);
}
