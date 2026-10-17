import { describe, expect, it } from 'vitest';
import { composeImages } from './imageProject';
import { digitize, writePes, type Raster } from './embroidery';

function square(color: number[], width = 40, height = 40): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color, i * 4);
  return { width, height, data };
}
const first = { id: 'first', name: 'First.png', raster: square([0, 135, 119, 255]) };
const second = { id: 'second', name: 'Second.png', raster: square([254, 158, 50, 255], 20, 40) };
const settings = { widthMm: 80, colors: 8, spacing: .55, removeWhite: true, underlay: false, imageColors: true };

describe('Multiple image projects', () => {
  it('changes geometry for selected images without changing other images needle paths',()=>{
    const raster=composeImages([first,second],true);
    const before=digitize(raster,{...settings,imageSettings:{first:{svgGeometry:'shape'},second:{svgGeometry:'shape'}}});
    const after=digitize(raster,{...settings,imageSettings:{first:{svgGeometry:'perimeter'},second:{svgGeometry:'shape'}}});
    const path=(design:typeof before)=>design.stitches.filter(s=>s.layerId?.startsWith('second-')&&s.command==='stitch').map(s=>({x:s.x,y:s.y}));
    expect(path(after)).toEqual(path(before));
    expect(after.layers.find(layer=>layer.itemId==='first')!.stitchType).toBe('running');
    expect(after.layers.find(layer=>layer.itemId==='second')!.stitchType).toBe('fill');
  });
  it('resizes selected artwork relative to other images without clipping it',()=>{
    const base=composeImages([first,second],true);
    const smaller=composeImages([first,second],true,{first:.5});
    expect(smaller.sections![0].width).toBeCloseTo(base.sections![0].width/2,0);
    expect(smaller.sections![1]).toEqual(base.sections![1]);
    const larger=composeImages([first,second],true,{first:2});
    expect(larger.sections![0].width).toBe(base.sections![0].width*2);
    expect(larger.sections![1].width).toBe(base.sections![1].width);
    expect(larger.sections![0].x+larger.sections![0].width).toBeLessThan(larger.width);
  });
  it('keeps a single image at its original resolution and aspect ratio', () => {
    const result = composeImages([second], true);
    expect([result.width, result.height]).toEqual([20, 40]);
    expect(result.sections?.[0].id).toBe('second');
  });
  it('preserves proportions and transparent separation between images', () => {
    const result = composeImages([first, second], true);
    const [a, b] = result.sections!;
    expect(a.width).toBe(a.height);
    expect(b.width / b.height).toBeCloseTo(.5);
    expect(a.x + a.width).toBeLessThan(b.x);
    expect(result.data[((a.y + 10) * result.width + a.x + a.width + 1) * 4 + 3]).toBe(0);
  });
  it('exports both images with editable ownership and a bounded shared palette', () => {
    const design = digitize(composeImages([first, second], true), settings, {}, { limit: 2, colors: {} });
    expect(new Set(design.layers.map(layer => layer.itemId))).toEqual(new Set(['first', 'second']));
    expect(design.threads.length).toBeLessThanOrEqual(2);
    expect(design.layers.every(layer => layer.stitchCount > 0)).toBe(true);
    const hidden = digitize(composeImages([first, second], true), settings, { [design.layers.find(layer => layer.itemId === 'first')!.id]: { visible: false } }, { limit: 2, colors: {} });
    expect(hidden.stitches.filter(stitch => stitch.command === 'stitch').every(stitch => stitch.layerId?.startsWith('second-'))).toBe(true);
    expect(new TextDecoder().decode(writePes(design, 'Multi').slice(0, 8))).toBe('#PES0001');
  });
  it('keeps separate parts for images using the same thread color', () => {
    const design = digitize(composeImages([first, { ...first, id: 'copy', name: 'Copy.png' }], true), settings, {}, { limit: 1, colors: {} });
    expect(design.layers).toHaveLength(2);
    expect(design.threads).toHaveLength(1);
  });
  it('supports background removal and an empty project after removal', () => {
    const white = { id: 'white', name: 'White.png', raster: square([255, 255, 255, 255]) };
    const included = composeImages([first, white], false), removed = composeImages([first, white], true);
    const box = included.sections![1], pixel = (box.y * included.width + box.x) * 4;
    expect(included.data[pixel + 3]).toBe(255);
    expect(removed.data[pixel + 3]).toBe(0);
    expect(composeImages([], true).sections).toEqual([]);
  });
});
