import { describe, it, expect } from 'vitest';
import { digitize, writePes, type Raster, type Settings } from './embroidery';
import { COVERAGE_PLANS } from './stitchPlanning';
const raster: Raster = { width: 30, height: 30, data: new Uint8ClampedArray(3600) };
for(let y=3;y<27;y++)for(let x=3;x<27;x++) raster.data.set([180,20,20,255],(y*30+x)*4);
const settings: Settings = { widthMm:30, colors:1, spacing:.4, removeWhite:true, underlay:false, detail:'balanced' };
describe('simple stitch coverage',()=>{
  it('offers only solid fill, outline and combined coverage',()=>{
    expect(COVERAGE_PLANS.map(p=>p.id)).toEqual(['solid','outline','combined']);
  });
  it('adds actual outline stitches after fill and supports satin plus outline',()=>{
    const fill=digitize(raster,{...settings,coverage:'solid'});
    const outline=digitize(raster,{...settings,coverage:'outline'});
    const both=digitize(raster,{...settings,coverage:'combined'});
    expect(outline.layers[0].stitchType).toBe('running');
    expect(outline.stitchCount).toBeLessThan(fill.stitchCount);
    expect(both.layers[0].outline).toBe(true);
    expect(both.stitchCount).toBeGreaterThan(fill.stitchCount);
    expect(both.stitches.some(stitch => stitch.command === 'stitch' && stitch.kind === 'outline')).toBe(true);
    expect(fill.stitches.some(stitch => stitch.kind === 'outline')).toBe(false);
    expect(both.layers[0].previewPath).toBe(fill.layers[0].previewPath);
    const id=fill.layers[0].id;
    const satin=digitize(raster,{...settings,coverage:'solid'},{[id]:{stitchType:'satin'}});
    const satinBoth=digitize(raster,{...settings,coverage:'combined'},{[id]:{stitchType:'satin'}});
    expect(satinBoth.stitchCount).toBeGreaterThan(satin.stitchCount);
    expect(new TextDecoder().decode(writePes(both).slice(0,8))).toBe('#PES0001');
  });
});
