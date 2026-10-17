import { describe, expect, it } from 'vitest';
import { digitize, writePes, type Raster } from './embroidery';
import { composeImages } from './imageProject';
import { positionImages } from './imageLayout';
import { STITCH_STYLES } from './stitchStyles';
import { needlePoints, nearestNeedle, coordinateCsv } from './stitchInspection';
function image(id: string) {
  const data = new Uint8ClampedArray(20 * 20 * 4); for (let p = 0; p < 400; p++) data.set([0, 135, 119, 255], p * 4);
  return { id, name: `${id}.png`, raster: { width: 20, height: 20, data } as Raster };
}
const source = digitize(composeImages([image('a'), image('b')], true), { widthMm: 50, colors: 1, spacing: .8, removeWhite: true, underlay: false });

describe('Needle coordinate inspection', () => {
  it('lists every needle-down, including repeated points, and excludes travel commands', () => {
    const points = needlePoints(source);
    expect(points).toHaveLength(source.stitchCount);
    expect(points[0].number).toBe(1); expect(points[points.length - 1].number).toBe(source.stitchCount);
    for (const point of points) { expect(source.stitches[point.commandIndex].command).toBe('stitch'); expect(point.x).toBe(source.stitches[point.commandIndex].x / 10); }
  });
  it('uses actual centered file coordinates after independent image movement', () => {
    const { design } = positionImages(source, { b: { x: .1, y: .2 } });
    const point = needlePoints(design).find(p => p.layerId?.startsWith('b-'))!;
    expect(nearestNeedle(design, point.x, point.y, .05, point.layerId)).toBeDefined();
    const csv = coordinateCsv(needlePoints(design));
    const rows = csv.split('\n'); expect(rows).toHaveLength(design.stitchCount + 1);
    const row = rows[point.number].split(','); expect(Number(row[1])).toBe(point.x); expect(Number(row[2])).toBe(point.y);
  });
  it('selects a stitch segment but does not select a travel line, another layer, or future stitches', () => {
    const points = needlePoints(source), p = points.find(point => point.length > 1)!;
    expect(nearestNeedle(source, p.x - p.dx / 2, p.y - p.dy / 2, .01, p.layerId)).toBeDefined();
    expect(nearestNeedle(source, 999, 999, 1)).toBeUndefined();
    expect(nearestNeedle(source, p.x, p.y, .01, 'missing')).toBeUndefined();
    expect(nearestNeedle(source, points[0].x, points[0].y, .01, undefined, 0)).toBeUndefined();
  });
});

// Read the embedded PEC records to check actual machine needle commands,
// including the distinction between jump movements and needle-downs.
function encodedNeedles(bytes: Uint8Array) {
  let at = new DataView(bytes.buffer).getUint32(8, true) + 528, x = 0, y = 0;
  const points: { x: number; y: number }[] = [];
  const axis = () => {
    const first = bytes[at++];
    if (first & 0x80) { const raw = ((first & 15) << 8) | bytes[at++]; return { value: raw & 0x800 ? raw - 4096 : raw, flag: first & 0x30 }; }
    return { value: first & 0x40 ? first - 128 : first, flag: 0 };
  };
  while (bytes[at] !== 255 && at < bytes.length) {
    if (bytes[at] === 0xfe && bytes[at + 1] === 0xb0) { at += 3; continue; }
    const dx = axis(), dy = axis(); x += dx.value; y += dy.value;
    if (!(dx.flag || dy.flag)) points.push({ x: x / 10, y: y / 10 });
  }
  return points;
}
describe('Coordinates in the exported machine file', () => {
  for (const style of STITCH_STYLES) it(`matches every encoded needle-down for ${style.label}`, () => {
    const overrides = Object.fromEntries(source.layers.map(layer => [layer.id, { stitchType: style.id }]));
    const generated = digitize(composeImages([image('a'), image('b')], true), { widthMm: 50, colors: 1, spacing: .8, removeWhite: true, underlay: false }, overrides);
    const { design } = positionImages(generated, { b: { x: .1, y: .15 } });
    expect(encodedNeedles(writePes(design))).toEqual(needlePoints(design).map(point => ({ x: point.x, y: point.y })));
  });
});
