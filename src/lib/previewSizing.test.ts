import { describe, expect, it } from 'vitest';
import { shirtLayout, PREVIEW_MM_SCALE, widthFromCornerDrag, rulerTicks } from './previewSizing';

describe('Preview physical sizing', () => {
  it('grows the shirt at a fixed physical scale without shrinking embroidery', () => {
    const small = shirtLayout(40), large = shirtLayout(65);
    expect((small.right - small.left) / small.scale).toBeCloseTo(400);
    expect((large.right - large.left) / large.scale).toBeCloseTo(650);
    expect(small.scale * 80).toBe(large.scale * 80);
    expect(large.bottom).toBeGreaterThan(small.bottom);
    expect(small.scale).toBe(PREVIEW_MM_SCALE);
  });
  it('resizes from corner movement in both directions while preserving proportions', () => {
    const corner = { x: 40, y: 60 };
    expect(widthFromCornerDrag(80, 20, 30, corner, 10, 125)).toBe(120);
    expect(widthFromCornerDrag(80, -20, -30, corner, 10, 125)).toBe(40);
    expect(widthFromCornerDrag(80, 60, -40, corner, 10, 125)).toBe(80);
  });
  it('bounds drag sizes to supported garment and design ranges', () => {
    expect(widthFromCornerDrag(52, 1000, 1000, { x: 245, y: 700 }, 40, 65)).toBe(65);
    expect(widthFromCornerDrag(52, -1000, -1000, { x: 245, y: 700 }, 40, 65)).toBe(40);
    expect(widthFromCornerDrag(80, 999, 999, { x: 40, y: 60 }, 10, 97.5)).toBe(97.5);
    expect(widthFromCornerDrag(80, -999, -999, { x: 40, y: 60 }, 10, 125)).toBe(10);
  });
  it('handles zero-sized corners and lays out signed millimeter ruler ticks', () => {
    expect(widthFromCornerDrag(80, 10, 10, { x: 0, y: 0 }, 10, 125)).toBe(80);
    expect(rulerTicks(-65, 65, 10)).toEqual([-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60]);
    expect(rulerTicks(0, 52.4, 10)).toEqual([0, 10, 20, 30, 40, 50]);
  });
});
