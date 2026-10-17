import { describe, expect, it } from 'vitest';
import { digitize, type Raster } from './embroidery';
import { positionImages } from './imageLayout';
import { stitchSvg } from './stitchSvg';

describe('solid SVG export', () => {
  it('preserves region geometry, holes, color and physical placement while omitting hidden layers', () => {
    const raster: Raster = { width: 10, height: 10, data: new Uint8ClampedArray(400) };
    for (let i = 0; i < 400; i += 4) raster.data.set([180, 20, 20, 255], i);
    // Transparent hole must remain a gap in the original region path.
    raster.data.fill(0, (5 * 10 + 5) * 4, (5 * 10 + 5) * 4 + 4);
    const source = digitize(raster, { widthMm: 20, colors: 1, spacing: .4, removeWhite: false, underlay: false });
    const design = positionImages(source, {}).design;
    const layer = design.layers[0];
    const svg = stitchSvg(design);
    expect(svg).toContain(`width="${design.widthMm}mm"`);
    expect(svg).toContain(`d="${layer.previewPath}"`);
    expect(svg).toContain(`fill="${layer.color}"`);
    const [x, y, w, h] = layer.previewBox.split(' ').map(Number);
    expect(svg).toContain(`matrix(${layer.bounds.width / w} 0 0 ${layer.bounds.height / h} ${layer.bounds.x - x * layer.bounds.width / w} ${layer.bounds.y - y * layer.bounds.height / h})`);
    expect(svg).not.toContain('stroke=');
    expect(svg).not.toContain('<image');
    layer.visible = false;
    expect(stitchSvg(design)).not.toContain('<path');
  });
});
