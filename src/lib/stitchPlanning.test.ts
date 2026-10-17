import { describe, expect, it } from 'vitest';
import { digitize, writePes, type Raster, type Settings } from './embroidery';
import { simplifyOutline } from './stitchPlanning';

const settings: Settings = { widthMm: 80, colors: 4, spacing: .4, removeWhite: true, underlay: true, imageColors: true };
function image(w: number, h: number, pixel: (x: number, y: number) => number[]): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(pixel(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}

describe('Detailed image stitch planning', () => {
  it('reduces tiny fragmented parts while retaining large shapes and transparent gaps', () => {
    const raster = image(200, 200, (x, y) => {
      if (x >= 90 && x < 110 && y >= 90 && y < 110) return [255, 255, 255, 0];
      if (x < 45) return [25, 60, 170, 255];
      if (x >= 55 && x < 190 && y >= 10 && y < 145 && (x - 55) % 15 < 4 && (y - 10) % 15 < 4) return [25, 25, 25, 255];
      return [225, 160, 35, 255];
    });
    const detailed = digitize(raster, { ...settings, detail: 'original' });
    const simple = digitize(raster, { ...settings, detail: 'simple' });
    expect(detailed.layers.length).toBeGreaterThan(20);
    expect(simple.layers.length).toBeLessThan(detailed.layers.length / 2);
    expect(simple.stitchCount).toBeLessThan(detailed.stitchCount);
    expect(simple.layers.some(layer => layer.bounds.width >= 17 && layer.bounds.height >= 79)).toBe(true);
    for (const stitch of simple.stitches.filter(s => s.command === 'stitch')) {
      expect(stitch.x > -40 && stitch.x < 40 && stitch.y > -40 && stitch.y < 40).toBe(false);
    }
  });
  it('creates a lighter plan with fewer actual stitches and lets individual shapes override it', () => {
    const raster = image(80, 80, x => x < 40 ? [220, 160, 30, 255] : [15, 100, 135, 255]);
    const solid = digitize(raster, settings);
    const light = digitize(raster, { ...settings, coverage: 'light' });
    const patterns = digitize(raster, { ...settings, coverage: 'pattern' });
    expect(light.stitchCount).toBeLessThan(solid.stitchCount * .6);
    expect(patterns.stitchCount).toBeLessThan(solid.stitchCount);
    expect(new Set(patterns.layers.map(layer => layer.stitchType)).size).toBe(2);
    const id = patterns.layers[0].id;
    const mixed = digitize(raster, { ...settings, coverage: 'pattern' }, { [id]: { stitchType: 'fill', spacing: .5, underlay: true } });
    expect(mixed.layers.find(layer => layer.id === id)?.stitchType).toBe('fill');
    expect(mixed.layers.filter(layer => layer.id !== id).every(layer => layer.stitchType !== 'fill')).toBe(true);
  });
  it('alternates two shared pattern threads without duplicating full coverage or layer metadata', () => {
    const raster = image(80, 80, () => [210, 150, 30, 255]);
    const source = digitize(raster, settings), id = source.layers[0].id;
    const one = digitize(raster, settings, { [id]: { stitchType: 'crosshatch', patternSize: 5 } }, { limit: 3, colors: { 1: '#203a75' } });
    const two = digitize(raster, settings, { [id]: { stitchType: 'crosshatch', patternSize: 5, accentSlot: 1 } }, { limit: 3, colors: { 1: '#203a75' } });
    expect(two.layers).toHaveLength(1);
    expect(two.threads).toHaveLength(2);
    expect(two.threads.some(thread => thread.hex === '#203a75')).toBe(true);
    const points = (design: typeof two) => new Set(design.stitches.filter(s => s.command === 'stitch').map(s => `${s.x},${s.y}`));
    expect(points(two)).toEqual(points(one));
    expect(two.stitchCount).toBeLessThan(one.stitchCount * 1.05);
    expect(two.layers[0].stitchCount).toBe(two.stitchCount);
    const pes = writePes(two, 'Two pattern threads');
    const pec = new DataView(pes.buffer).getUint32(8, true);
    expect(pes[pec + 48]).toBe(1);
    expect(new Set(two.stitches.filter(s => s.command === 'stitch').map(s => s.color)).size).toBe(2);
  });
  it('shares thread blocks across several accented layers and respects a reduced palette', () => {
    const raster = image(80, 80, x => x < 30 ? [210, 150, 30, 255] : x > 50 ? [15, 100, 135, 255] : [255, 255, 255, 0]);
    const source = digitize(raster, settings);
    const overrides = Object.fromEntries(source.layers.map(layer => [layer.id, { stitchType: 'waves' as const, accentSlot: 2, patternSize: 6 }]));
    const result = digitize(raster, settings, overrides, { limit: 3, colors: { 2: '#943738' } });
    expect(result.layers).toHaveLength(source.layers.length);
    expect(result.threads.length).toBeLessThanOrEqual(3);
    expect(result.stitches.filter(s => s.command === 'color').length).toBe(result.threads.length - 1);
    expect(() => writePes(result, 'Shared accent')).not.toThrow();
    const reduced = digitize(raster, settings, overrides, { limit: 1, colors: {} });
    expect(reduced.threads).toHaveLength(1);
    expect(reduced.layers.every(layer => layer.accentSlot == null)).toBe(true);
  });
  it('rejects unsupported plans and malformed accent assignments', () => {
    const raster = image(80, 80, () => [15, 100, 135, 255]);
    expect(() => digitize(raster, { ...settings, detail: 'unknown' as never })).toThrow('detail level');
    const id = digitize(raster, settings).layers[0].id;
    expect(() => digitize(raster, settings, { [id]: { accentSlot: 1.5 } })).toThrow('accent');
  });
  it('retains a lightweight closed outline around a sparse pattern and its holes', () => {
    const square = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 })).concat([{ x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 }]);
    expect(simplifyOutline(square)).toHaveLength(5);
    const raster = image(80, 80, (x, y) => x >= 25 && x < 55 && y >= 25 && y < 55 ? [255, 255, 255, 0] : [210, 150, 30, 255]);
    const source = digitize(raster, settings), id = source.layers[0].id;
    const plain = digitize(raster, settings, { [id]: { stitchType: 'dotgrid', patternSize: 8 } });
    const outlined = digitize(raster, settings, { [id]: { stitchType: 'dotgrid', patternSize: 8, outline: true } });
    expect(outlined.stitchCount).toBeGreaterThan(plain.stitchCount);
    expect(outlined.stitchCount).toBeLessThan(source.stitchCount / 2);
    for (const s of outlined.stitches.filter(s => s.command === 'stitch')) {
      expect(s.x > -150 && s.x < 150 && s.y > -150 && s.y < 150).toBe(false);
    }
    expect(outlined.stitches.some(s => s.command === 'stitch' && s.x === -400 && s.y === -400)).toBe(true);
    expect(outlined.stitches.some(s => s.command === 'stitch' && Math.abs(s.x) === 150 && Math.abs(s.y) === 150)).toBe(true);
  });
});
