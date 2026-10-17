import { describe, expect, it } from 'vitest';
import { digitize, writePes, type Raster, type Settings } from './embroidery';
import { STITCH_STYLES, patternedStyle, fillPhase, clipPatternPaths } from './stitchStyles';
import { positionImages } from './imageLayout';

const settings: Settings = { widthMm: 40, colors: 1, spacing: .6, removeWhite: true, underlay: false, imageColors: true };
function raster(hole = false): Raster {
  const data = new Uint8ClampedArray(60 * 60 * 4);
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) data.set(hole && x > 21 && x < 38 && y > 21 && y < 38 ? [255, 255, 255, 255] : [0, 135, 119, 255], (y * 60 + x) * 4);
  return { width: 60, height: 60, data };
}

describe('Layer stitch styles', () => {
  for (const style of STITCH_STYLES) it(`generates real ${style.label} needle paths and a PES file`, () => {
    const input = raster(), id = digitize(input, settings).layers[0].id;
    const design = digitize(input, settings, { [id]: { stitchType: style.id, patternSize: 4 } });
    expect(design.stitchCount).toBeGreaterThan(8);
    expect(design.layers[0].stitchType).toBe(style.id);
    const max = style.id === 'satin' ? 70.15 : 25.15;
    for (let i = 1; i < design.stitches.length; i++) {
      const stitch = design.stitches[i], previous = design.stitches[i - 1];
      if (stitch.command === 'stitch') expect(Math.hypot(stitch.x - previous.x, stitch.y - previous.y)).toBeLessThanOrEqual(max);
      expect(Math.abs(stitch.x)).toBeLessThanOrEqual(201);
      expect(Math.abs(stitch.y)).toBeLessThanOrEqual(201);
    }
    expect(new TextDecoder().decode(writePes(positionImages(design, {}).design).slice(0, 8))).toBe('#PES0001');
  });
  for (const style of STITCH_STYLES.filter(s => patternedStyle(s.id) || s.id === 'satin')) it(`${style.label} leaves a hole unsewn`, () => {
    const input = raster(true), id = digitize(input, settings).layers[0].id;
    const design = digitize(input, settings, { [id]: { stitchType: style.id } });
    expect(design.stitchCount).toBeGreaterThan(8);
    for (let i = 1; i < design.stitches.length; i++) {
      const stitch = design.stitches[i], previous = design.stitches[i - 1]; if (stitch.command !== 'stitch') continue;
      for (const fraction of [.2, .5, .8]) {
        const x = (previous.x + (stitch.x - previous.x) * fraction) / 10 + 20, y = (previous.y + (stitch.y - previous.y) * fraction) / 10 + 20;
        // Hole is 22..38 px (14.67..25.33 mm); allow rounding at the exact pixel edge.
        expect(x > 14.8 && x < 25.2 && y > 14.8 && y < 25.2).toBe(false);
      }
    }
  });
  it('makes bean segments stronger and satin rails different from tatami', () => {
    const input = raster(), id = digitize(input, settings).layers[0].id;
    const run = digitize(input, settings, { [id]: { stitchType: 'running' } });
    const bean = digitize(input, settings, { [id]: { stitchType: 'bean' } });
    expect(bean.stitchCount).toBeGreaterThan(run.stitchCount * 2.5);
    const satin = digitize(input, settings, { [id]: { stitchType: 'satin' } });
    const lengths = satin.stitches.slice(1).filter(s => s.command === 'stitch').map(s => { const i = satin.stitches.indexOf(s), p = satin.stitches[i - 1]; return Math.hypot(s.x - p.x, s.y - p.y); });
    expect(lengths.some(length => length > 40)).toBe(true);
  });
  it('creates deterministic, distinct tatami texture phases', () => {
    expect(fillPhase(2, 25, 'brick')).not.toBe(fillPhase(2, 25, 'twill'));
    expect(fillPhase(1, 25, 'diamond')).not.toBe(fillPhase(1, 25, 'brick'));
    expect(fillPhase(17, 25, 'random')).toBe(fillPhase(17, 25, 'random'));
    const input = raster(), id = digitize(input, settings).layers[0].id;
    const brick = digitize(input, settings), twill = digitize(input, settings, { [id]: { texture: 'twill' } });
    expect(brick.stitches).not.toEqual(twill.stitches);
  });
  it('clips a long line into separate islands instead of sewing the empty gap', () => {
    const pixels = new Set([0, 1, 4, 5]);
    const paths = clipPatternPaths([[{ x: -3, y: 0 }, { x: 3, y: 0 }]], pixels, 6, 1, 1);
    expect(paths).toHaveLength(2);
    expect(paths[0][paths[0].length - 1].x).toBe(-1);
    expect(paths[1][0].x).toBe(1);
  });
});
