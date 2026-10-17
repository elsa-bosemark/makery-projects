import { describe, expect, it } from 'vitest';
import { traceRegions, flattenSvgPath } from './vtracer';
import { scanSpans } from './smoothGeometry';

describe('VTracer shared curves', () => {
  it('keeps transparent interior holes even when the shape touches image edges', () => {
    const pixels: number[] = [];
    for (let y=0;y<60;y++) for(let x=0;x<60;x++) if (!(x>=22&&x<38&&y>=22&&y<38)) pixels.push(y*60+x);
    const [geometry] = traceRegions([{pixels}],60,60,2/3);
    expect(geometry.path).toMatch(/[Cc]/);
    expect(geometry.loops).toHaveLength(2);
    expect(scanSpans(geometry.loops,30)).toEqual([[0,22],[38,60]]);
  });
  it('traces neighboring regions together with matching shared edges and stable ownership', () => {
    const left: number[] = [], right: number[] = [];
    for(let y=0;y<40;y++) for(let x=0;x<40;x++) (x<20?left:right).push(y*40+x);
    const regions = traceRegions([{pixels:left},{pixels:right}],40,40,1);
    expect(regions).toHaveLength(2);
    for(const scan of [2,10,20,38]) {
      expect(scanSpans(regions[0].loops,scan)).toEqual([[0,20]]);
      expect(scanSpans(regions[1].loops,scan)).toEqual([[20,40]]);
    }
  });
  it('samples relative cubic commands without changing their coordinate origin', () => {
    const loops=flattenSvgPath('M0,0c0,10,10,10,10,0L0,0Z',.01);
    expect(loops[0]).toContainEqual({x:10,y:0});
    expect(Math.max(...loops[0].map(p=>p.y))).toBeCloseTo(7.5);
  });
});
