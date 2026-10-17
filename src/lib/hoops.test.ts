import { describe, expect, it } from 'vitest';
import { HOOPS, fitsHoop, smallestFittingHoop, assertDesignFitsHoop } from './hoops';
import { digitize } from './embroidery';

describe('PE900 hoop selection', () => {
  it('switches up and down across both width and height limits with a margin', () => {
    expect(smallestFittingHoop(55, 15)?.id).toBe('small');
    expect(smallestFittingHoop(55, 15.01)?.id).toBe('medium');
    expect(smallestFittingHoop(95, 95)?.id).toBe('medium');
    expect(smallestFittingHoop(95.01, 95)?.id).toBe('large');
    expect(smallestFittingHoop(80, 129)?.id).toBe('large');
    expect(smallestFittingHoop(60, 97)?.id).toBe('large');
    expect(smallestFittingHoop(58, 94)?.id).toBe('medium');
    expect(smallestFittingHoop(125, 175)?.id).toBe('large');
    expect(smallestFittingHoop(126, 175)).toBeNull();
    expect(smallestFittingHoop(125, 175.01)).toBeNull();
    expect(smallestFittingHoop(15, 55)?.id).toBe('medium');
  });
  it('rejects invalid dimensions', () => {
    for (const value of [0, -1, NaN, Infinity]) {
      expect(fitsHoop(value, 10, HOOPS[2])).toBe(false);
      expect(fitsHoop(10, value, HOOPS[2])).toBe(false);
    }
  });
  it('blocks an export that is too large for the selected hoop without resizing stitches', () => {
    const data = new Uint8ClampedArray(20 * 20 * 4).fill(255);
    for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 0;
    const design = digitize({ width: 20, height: 20, data }, { widthMm: 96, colors: 1, spacing: .4, removeWhite: true, underlay: false });
    const coordinates = design.stitches.map(s => [s.x, s.y]);
    expect(() => assertDesignFitsHoop(design, HOOPS[1])).toThrow('larger hoop');
    expect(() => assertDesignFitsHoop(design, HOOPS[2])).not.toThrow();
    expect(design.stitches.map(s => [s.x, s.y])).toEqual(coordinates);
  });
});
