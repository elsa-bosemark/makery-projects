import { describe, expect, it } from 'vitest';
import { digitize, writePes, type Raster } from './embroidery';
import { composeImages } from './imageProject';
import { positionImages } from './imageLayout';
import { assertDesignFitsHoop, HOOPS } from './hoops';

function image(id: string, color: number[]) {
  const data = new Uint8ClampedArray(20 * 20 * 4);
  for (let i = 0; i < 400; i++) data.set([...color, 255], i * 4);
  return { id, name: `${id}.png`, raster: { width: 20, height: 20, data } as Raster };
}
const raster = composeImages([image('a', [0, 135, 119]), image('b', [254, 158, 50])], true);
const settings = { widthMm: 80, colors: 2, spacing: .8, removeWhite: true, underlay: false, imageColors: true };
const source = digitize(raster, settings);

function pecPoints(bytes: Uint8Array) {
  let at = new DataView(bytes.buffer).getUint32(8, true) + 528, x = 0, y = 0;
  const points: { x: number; y: number }[] = [];
  const axis = () => {
    const first = bytes[at++];
    if (first & 0x80) { const n = ((first & 15) << 8) | bytes[at++]; return n & 0x800 ? n - 4096 : n; }
    return first & 0x40 ? first - 128 : first;
  };
  while (bytes[at] !== 255 && at < bytes.length) {
    if (bytes[at] === 0xfe && bytes[at + 1] === 0xb0) { at += 3; continue; }
    x += axis(); y += axis(); points.push({ x, y });
  }
  return points;
}

describe('Independent image placement', () => {
  it('moves every layer and needle point of one image while leaving the other in place', () => {
    const placed = positionImages(source, { b: { x: .125, y: .25 } });
    for (let i = 0; i < source.stitches.length; i++) {
      const original = source.stitches[i];
      if (original.command !== 'stitch' && original.command !== 'jump') continue;
      const moved = original.layerId?.startsWith('b-');
      expect(placed.raw.stitches[i].x - original.x).toBe(moved ? 100 : 0);
      expect(placed.raw.stitches[i].y - original.y).toBe(moved ? 200 : 0);
    }
    expect(placed.raw.stitchCount).toBe(source.stitchCount);
    expect(placed.raw.layers.find(layer => layer.itemId === 'b')!.bounds.x - source.layers.find(layer => layer.itemId === 'b')!.bounds.x).toBeCloseTo(10);
    expect(positionImages(source, {}).raw.stitches).toEqual(source.stitches);
  });
  it('scales relative placement with the artwork and preserves color-change anchors', () => {
    const offsets = { b: { x: .125, y: .25 } };
    const smaller = digitize(raster, { ...settings, widthMm: 40 });
    const placed = positionImages(smaller, offsets);
    const index = smaller.stitches.findIndex(stitch => stitch.command === 'jump' && stitch.layerId?.startsWith('b-'));
    expect(placed.raw.stitches[index].x - smaller.stitches[index].x).toBe(50);
    expect(placed.raw.stitches[index].y - smaller.stitches[index].y).toBe(100);
    for (let i = 1; i < placed.raw.stitches.length; i++) {
      if (!['color', 'end'].includes(placed.raw.stitches[i].command)) continue;
      expect(placed.raw.stitches[i].x).toBe(placed.raw.stitches[i - 1].x);
      expect(placed.raw.stitches[i].y).toBe(placed.raw.stitches[i - 1].y);
    }
  });
  it('centers the combined result without changing distances, and checks the actual hoop footprint', () => {
    const placed = positionImages(source, { b: { x: .8, y: 1 } });
    expect(placed.design.widthMm).toBeGreaterThan(source.widthMm);
    expect(() => assertDesignFitsHoop(placed.design, HOOPS[2])).toThrow('larger hoop');
    expect(() => writePes(placed.design)).toThrow('exceeds');
    for (let i = 0; i < placed.design.stitches.length; i++) {
      expect(placed.design.stitches[i].x + Math.round(placed.center.x * 10)).toBe(placed.raw.stitches[i].x);
      expect(placed.design.stitches[i].y + Math.round(placed.center.y * 10)).toBe(placed.raw.stitches[i].y);
      expect(Math.abs(placed.design.stitches[i].x) / 10).toBeLessThanOrEqual(placed.design.widthMm / 2 + 1e-8);
    }
  });
  it('exports the moved composition with the same needle positions shown in the shirt preview', () => {
    const placed = positionImages(source, { b: { x: .1, y: .2 } });
    assertDesignFitsHoop(placed.design, HOOPS[2]);
    const points = pecPoints(writePes(placed.design));
    let at = 0;
    for (const expected of placed.design.stitches.filter(s => s.command === 'jump' || s.command === 'stitch')) {
      while (at < points.length && (points[at].x !== expected.x || points[at].y !== expected.y)) at++;
      expect(at).toBeLessThan(points.length); at++;
    }
  });
  it('excludes hidden images from footprint and handles a fully hidden project', () => {
    const hidden = digitize(raster, settings, Object.fromEntries(source.layers.filter(l => l.itemId === 'b').map(l => [l.id, { visible: false }])));
    const positioned = positionImages(hidden, { b: { x: 10, y: 10 } });
    expect(positioned.images.map(item => item.id)).toEqual(['a']);
    expect(positioned.design.widthMm).toBeLessThan(40);
    const empty = digitize(raster, settings, Object.fromEntries(source.layers.map(l => [l.id, { visible: false }])));
    expect(positionImages(empty, {}).design.stitchCount).toBe(0);
    expect(positionImages(empty, {}).images).toEqual([]);
  });
});
