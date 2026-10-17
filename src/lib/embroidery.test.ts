import { describe, expect, it } from 'vitest';
import { digitize, writePes, colorDifference, recolorThread, estimateSewingTime, type Raster, type Settings } from './embroidery';

const settings: Settings = { widthMm: 80, colors: 3, spacing: .55, removeWhite: true, underlay: true };
function image(w: number, h: number, pixel: (x: number, y: number) => number[]): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(pixel(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}

describe('Image digitizing for the PE900', () => {
  it('creates separate color blocks and bounded stitches from artwork', () => {
    const raster = image(80, 80, (x, y) => x < 35 ? [0, 135, 119, 255] : x > 44 ? [254, 158, 50, 255] : [255, 255, 255, 255]);
    const design = digitize(raster, settings);
    expect(design.threads).toHaveLength(2);
    expect(design.stitches.filter(s => s.command === 'color')).toHaveLength(1);
    expect(design.stitchCount).toBeGreaterThan(500);
    design.stitches.forEach((s, i) => {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(400);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(400);
      if (s.command === 'stitch' && i > 0) {
        const prev = design.stitches[i - 1];
        expect(Math.hypot(s.x - prev.x, s.y - prev.y)).toBeLessThanOrEqual(26);
      }
    });
    const pes = writePes(design, 'Two colors');
    expect(new TextDecoder().decode(pes.slice(0, 8))).toBe('#PES0001');
    const pointer = new DataView(pes.buffer).getUint32(8, true);
    expect(new TextDecoder().decode(pes.slice(pointer, pointer + 3))).toBe('LA:');
    expect(pes[pointer + 48]).toBe(1);
    expect(pes.length).toBeGreaterThan(2000);
  });
  it('jumps across disconnected shapes rather than filling the blank gap', () => {
    const raster = image(80, 40, x => x < 20 || x > 59 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
    const design = digitize(raster, settings);
    expect(design.regions).toBe(2);
    expect(design.threads).toHaveLength(1);
    expect(design.jumps).toBeGreaterThan(1);
    for (let i = 1; i < design.stitches.length; i++) {
      const s = design.stitches[i], p = design.stitches[i - 1];
      if (s.command === 'stitch') expect(Math.sign(s.x) === Math.sign(p.x)).toBe(true);
    }
  });
  it('rejects oversized designs and images with no visible artwork', () => {
    const black = image(20, 80, () => [0, 0, 0, 255]);
    expect(() => digitize(black, settings)).toThrow('hoop');
    const white = image(40, 40, () => [255, 255, 255, 255]);
    expect(() => digitize(white, settings)).toThrow('No artwork');
    expect(digitize(white, { ...settings, removeWhite: false }).stitchCount).toBeGreaterThan(0);
  });
  it('respects transparency and reduces stitch count with wider spacing', () => {
    const raster = image(80, 80, x => x < 40 ? [0, 135, 119, 255] : [250, 0, 0, 0]);
    const dense = digitize(raster, { ...settings, spacing: .4 });
    const open = digitize(raster, { ...settings, spacing: 1.0 });
    expect(dense.threads).toHaveLength(1);
    expect(open.stitchCount).toBeLessThan(dense.stitchCount);
    expect(dense.stitches.filter(s => s.command === 'stitch').every(s => s.x <= 0)).toBe(true);
  });
});

// Numerical reference from Sharma, Wu & Dalal, Color Research & Application (2005).
// https://doi.org/10.1002/col.20070
describe('Fill quality and routing', () => {
  it('matches published perceptual color-difference reference values', () => {
    expect(colorDifference([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(colorDifference([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
    expect(colorDifference([50, -1, 2], [50, 0, 0])).toBeCloseTo(2.3669, 4);
  });
  it('places dense rows between source pixels instead of repeating rounded rows', () => {
    const design = digitize(image(20, 20, () => [0, 0, 0, 255]), { ...settings, spacing: .4, underlay: false });
    const rows = new Set(design.stitches.filter(s => s.command === 'stitch').map(s => s.y));
    expect(rows.size).toBeGreaterThanOrEqual(190);
    expect(design.jumps).toBe(1);
  });
  it('routes around a hole without jumping across it on every fill row', () => {
    const raster = image(80, 80, (x, y) => x >= 25 && x < 55 && y >= 25 && y < 55 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
    const design = digitize(raster, { ...settings, spacing: .4, underlay: false });
    expect(design.jumps).toBeLessThanOrEqual(6);
    for (let i = 1; i < design.stitches.length; i++) {
      const p = design.stitches[i - 1], s = design.stitches[i];
      if (s.command !== 'stitch') continue;
      for (let t = 0; t <= 1; t += .1) {
        const x = (p.x + (s.x - p.x) * t) / 10 + 40, y = (p.y + (s.y - p.y) * t) / 10 + 40;
        expect(x >= 25.1 && x < 54.9 && y >= 25.1 && y < 54.9).toBe(false);
      }
    }
  });
  it('adds a perpendicular support layer under the top fill', () => {
    const raster = image(60, 60, () => [0, 135, 119, 255]);
    const directions = (underlay: boolean) => {
      const d = digitize(raster, { ...settings, underlay });
      return d.stitches.filter((s, i) => i && s.command === 'stitch' && s.x === d.stitches[i - 1].x && Math.abs(s.y - d.stitches[i - 1].y) > 10).length;
    };
    expect(directions(true)).toBeGreaterThan(100);
    expect(directions(false)).toBe(0);
  });
  it('keeps photo tones distinct even when the machine uses the same catalogue label', () => {
    const raster = image(80, 80, x => x < 40 ? [210, 171, 154, 255] : [225, 198, 184, 255]);
    const d = digitize(raster, { ...settings, colors: 8, imageColors: true, removeWhite: false });
    expect(d.threads).toHaveLength(2);
    expect(d.threads.map(t => t.hex)).toEqual(expect.arrayContaining(['#d2ab9a', '#e1c6b8']));
    expect(d.stitches.filter(s => s.command === 'color')).toHaveLength(1);
    const pes = writePes(d, 'Photo tones');
    const pointer = new DataView(pes.buffer).getUint32(8, true);
    expect(pes[pointer + 48]).toBe(1);
    let changes = 0;
    for (let i = pointer + 512; i < pes.length - 2; i++) if (pes[i] === 0xfe && pes[i + 1] === 0xb0) changes++;
    expect(changes).toBe(1);
  });
});


describe('Thread color editing', () => {
  it('exports the new thread match while preserving geometry and sewing stops', () => {
    const design = digitize(image(40, 40, x => x < 20 ? [0, 135, 119, 255] : [254, 158, 50, 255]), settings);
    const thread = recolorThread(design.threads[0], '#ed171f');
    expect(thread.index).toBe(5);
    expect(thread.rgb).toEqual([237, 23, 31]);
    expect(thread.hex).toBe('#ed171f');
    expect(thread.matchName).toBe('Red');
    const recolored = { ...design, threads: [thread, ...design.threads.slice(1)] };
    expect(recolored.stitches).toBe(design.stitches);
    expect(recolored.threads).toHaveLength(design.threads.length);
    const pes = writePes(recolored);
    const pointer = new DataView(pes.buffer).getUint32(8, true);
    expect(pes[pointer + 49]).toBe(5);
    expect(pes[pointer + 48]).toBe(design.threads.length - 1);
    expect(design.threads[0].hex).not.toBe('#ed171f');
  });
});


describe('Sewing time estimate', () => {
  it('uses actual needle commands, excludes jumps, and accounts for selected speed', () => {
    const base = digitize(image(20, 20, () => [0, 0, 0, 255]), settings);
    const stitches = Array.from({ length: 650 }, () => ({ x: 0, y: 0, color: 0, command: 'stitch' as const }));
    const design = { ...base, stitchCount: 9999, stitches: [...stitches, { x: 0, y: 0, color: 0, command: 'jump' as const }, { x: 0, y: 0, color: 0, command: 'color' as const }, { x: 0, y: 0, color: 0, command: 'end' as const }] };
    expect(estimateSewingTime(design)).toEqual({ minutes: 1, stitchCount: 650, colorChanges: 1 });
    expect(estimateSewingTime(design, 500).minutes).toBe(1.3);
    expect(estimateSewingTime(design, 400).minutes).toBe(1.625);
  });
  it('rejects zero, nonfinite, and unsupported machine speeds', () => {
    const design = digitize(image(20, 20, () => [0, 0, 0, 255]), settings);
    for (const speed of [0, -1, NaN, Infinity, 651]) expect(() => estimateSewingTime(design, speed)).toThrow('PE900 speed');
  });
});

describe('Editable shape layers', () => {
  const parts = () => image(80, 40, x => x < 20 || x > 59 ? [0, 135, 119, 255] : [255, 255, 255, 255]);
  it('splits disconnected items of the same color and preserves IDs during resizing', () => {
    const first = digitize(parts(), settings), resized = digitize(parts(), { ...settings, widthMm: 60 });
    expect(first.layers).toHaveLength(2);
    expect(first.layers.map(l => l.id)).toEqual(resized.layers.map(l => l.id));
    expect(first.layers.every(l => l.stitchCount > 0 && l.previewPath.length > 0)).toBe(true);
    expect(first.stitches.filter(s => s.command === 'stitch').every(s => first.layers.some(l => l.id === s.layerId))).toBe(true);
  });
  it('changes one item color and hiding it removes only its stitches from PES', () => {
    const first = digitize(parts(), settings), id = first.layers[0].id;
    const edited = digitize(parts(), settings, { [id]: { name: 'Left leaf', paletteSlot: 1 } }, { limit: 3, colors: { 1: '#ed171f' } });
    expect(edited.layers[0].name).toBe('Left leaf');
    expect(edited.layers[0].color).toBe('#ed171f');
    expect(edited.layers[1].color).toBe(first.layers[1].color);
    expect(edited.threads).toHaveLength(2);
    const pes = writePes(edited);
    const pointer = new DataView(pes.buffer).getUint32(8, true);
    expect([...pes.slice(pointer + 49, pointer + 49 + edited.threads.length)]).toContain(5);
    const hidden = digitize(parts(), settings, { [id]: { visible: false } });
    expect(hidden.layers).toHaveLength(2);
    expect(hidden.layers[0].stitchCount).toBe(0);
    expect(hidden.stitches.some(s => s.layerId === id)).toBe(false);
    expect(hidden.threads).toHaveLength(1);
    expect(hidden.widthMm).toBe(first.widthMm);
    expect(writePes(hidden).length).toBeGreaterThan(500);
    const allHidden = digitize(parts(), settings, Object.fromEntries(first.layers.map(l => [l.id, { visible: false }])));
    expect(allHidden.stitchCount).toBe(0);
    expect(() => writePes(allHidden)).toThrow('Generate');
  });
  it('applies fill spacing, direction, stitch length and underlay per layer', () => {
    const first = digitize(parts(), { ...settings, underlay: false });
    const [left, right] = first.layers;
    const edited = digitize(parts(), { ...settings, underlay: false }, { [left.id]: { spacing: 1.1, direction: 'vertical', stitchLength: 1.5, underlay: true } });
    expect(edited.layers[0].stitchCount).not.toBe(left.stitchCount);
    // Routing may approach the next shape from a different end; its settings and coverage stay intact.
    expect(edited.layers[1]).toMatchObject({ id: right.id, spacing: right.spacing, direction: right.direction, stitchLength: right.stitchLength, underlay: right.underlay, bounds: right.bounds, stitchCount: right.stitchCount });
    edited.stitches.forEach((s, i) => { if (i && s.layerId === left.id && s.command === 'stitch') expect(Math.hypot(s.x - edited.stitches[i - 1].x, s.y - edited.stitches[i - 1].y)).toBeLessThanOrEqual(16.5); });
  });
  it('creates closed running outlines around the shape and its hole, with repeat passes', () => {
    const raster = image(40, 40, (x, y) => x >= 12 && x < 28 && y >= 12 && y < 28 ? [255,255,255,255] : [0,0,0,255]);
    const first = digitize(raster, { ...settings, underlay: false });
    const id = first.layers[0].id;
    const one = digitize(raster, settings, { [id]: { stitchType: 'running', stitchLength: 2, passes: 1 } });
    const two = digitize(raster, settings, { [id]: { stitchType: 'running', stitchLength: 2, passes: 2 } });
    expect(one.jumps).toBe(2);
    expect(one.stitchCount).toBeLessThan(first.stitchCount / 4);
    expect(two.stitchCount).toBeGreaterThan(one.stitchCount * 1.8);
    for (let i = 1; i < one.stitches.length; i++) {
      const s = one.stitches[i], p = one.stitches[i-1];
      if (s.command === 'stitch') expect(Math.hypot(s.x-p.x,s.y-p.y)).toBeLessThanOrEqual(21.5);
    }
    expect(new TextDecoder().decode(writePes(one).slice(0, 8))).toBe('#PES0001');
  });
});


describe('Useful part detection', () => {
  it('absorbs nearby tiny edge artifacts while keeping a separate small item', () => {
    const raster = image(80, 60, (x, y) => {
      if (x < 20 && y < 40) return [0, 0, 0, 255];
      if ((x === 20 || x === 21) && y === 10) return [237, 23, 31, 255];
      if (x >= 65 && x < 68 && y >= 40 && y < 43) return [237, 23, 31, 255];
      return [255, 255, 255, 255];
    });
    const design = digitize(raster, { ...settings, underlay: false });
    expect(design.layers).toHaveLength(2);
    expect(design.layers.some(layer => layer.bounds.x >= 25 && layer.bounds.width <= 3)).toBe(true);
    expect(design.layers.find(layer => layer.bounds.x < 0)?.bounds.width).toBe(22);
  });
});


describe('Shared project palette', () => {
  const raster = image(80, 40, x => x < 20 ? [254,158,50,255] : x < 40 ? [78,41,144,255] : [0,135,119,255]);
  it('provides exactly the allowed number of editable slots, including unused slots', () => {
    const d = digitize(image(40,40,()=>[0,0,0,255]), settings);
    expect(d.palette).toHaveLength(3);
    expect(d.threads).toHaveLength(1);
    expect(d.layers[0].paletteSlot).toBe(0);
  });
  it('shares one color across parts, edits that color globally, and groups the export stops', () => {
    const base = digitize(raster, settings);
    const overrides = Object.fromEntries(base.layers.map(layer => [layer.id, { paletteSlot: 1 }]));
    const shared = digitize(raster, settings, overrides, { limit: 3, colors: { 1: '#ed171f' } });
    expect(shared.layers).toHaveLength(base.layers.length);
    expect(shared.layers.every(layer => layer.paletteSlot === 1 && layer.color === '#ed171f')).toBe(true);
    expect(shared.threads).toHaveLength(1);
    expect(shared.stitches.filter(stitch => stitch.command === 'color')).toHaveLength(0);
    expect(shared.layers.map(layer => layer.stitchCount)).toEqual(base.layers.map(layer => layer.stitchCount));
    const bytes = writePes(shared); const pointer = new DataView(bytes.buffer).getUint32(8, true);
    expect(bytes[pointer+48]).toBe(0); expect(bytes[pointer+49]).toBe(5);
  });
  it('keeps parts and stitch settings when shrinking the limit, and never exports extra colors', () => {
    const base = digitize(raster, settings), target = base.layers[2];
    const edits = { [target.id]: { name: 'Leaf', paletteSlot: 2, stitchType: 'running' as const, stitchLength: 1.5 } };
    const small = digitize(raster, settings, edits, { limit: 1, colors: { 0: '#008777' } });
    expect(small.palette).toHaveLength(1);
    expect(small.layers.map(layer => layer.id)).toEqual(base.layers.map(layer => layer.id));
    expect(small.layers.find(layer => layer.id === target.id)).toMatchObject({ name: 'Leaf', stitchType: 'running', stitchLength: 1.5, paletteSlot: 0 });
    expect(small.threads).toHaveLength(1);
    expect(small.layers.every(layer => layer.color === '#008777')).toBe(true);
  });
  it('merges equal-colored slots into one thread while retaining editable slot assignments', () => {
    const base = digitize(raster, settings);
    const edits = Object.fromEntries(base.layers.map((layer,i)=>[layer.id,{paletteSlot:i%2}]));
    const d = digitize(raster, settings, edits, { limit: 2, colors: { 0:'#008777', 1:'#008777' } });
    expect(d.palette).toHaveLength(2); expect(d.threads).toHaveLength(1);
    expect(new Set(d.layers.map(layer=>layer.paletteSlot)).size).toBe(2);
  });
});
