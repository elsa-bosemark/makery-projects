import { describe, it, expect } from 'vitest';
import { scanSpans, clipSmoothPaths } from './smoothGeometry';
import { traceRegions } from './vtracer';
import { digitize, type Raster } from './embroidery';

describe('shared curved embroidery geometry', () => {
  it('reduces a pixel circle to curves and uses that contour for the fill stitches', () => {
    const raster: Raster = { width: 80, height: 80, data: new Uint8ClampedArray(80 * 80 * 4) };
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (Math.hypot(x - 40, y - 40) < 30) raster.data.set([180, 20, 20, 255], (y * 80 + x) * 4);
    const design = digitize(raster, { widthMm: 40, colors: 1, spacing: .4, removeWhite: false, underlay: false });
    const path = design.layers[0].previewPath;
    expect(path).toMatch(/[Cc]/);
    expect((path.match(/[Cc]/g) ?? []).length).toBeLessThan(120);
    expect(path).not.toContain('v1');
    expect(design.stitchCount).toBeGreaterThan(100);
    const outline = digitize(raster, { widthMm: 40, colors: 1, spacing: .4, removeWhite: false, underlay: false }, { [design.layers[0].id]: { stitchType: 'running' } });
    expect(outline.layers[0].previewPath).toBe(path);
    expect(outline.stitchCount).toBeLessThan(100);
  });
  it('preserves square corners and clips fill and pattern paths around a hole', () => {
    const square = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10},{x:0,y:0}];
    const hole = [{x:3,y:3},{x:7,y:3},{x:7,y:7},{x:3,y:7},{x:3,y:3}];
    const geometry = { path: '', loops: [square, hole] };
    expect(geometry.path).not.toContain('Q');
    expect(scanSpans(geometry.loops, 5)).toEqual([[0,3],[7,10]]);
    expect(clipSmoothPaths([[{x:-1,y:5},{x:11,y:5}]], geometry.loops)).toEqual([[{x:0,y:5},{x:3,y:5}],[{x:7,y:5},{x:10,y:5}]]);
  });
});
