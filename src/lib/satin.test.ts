import { describe, it, expect } from 'vitest';
import { digitize, type Raster, type Settings } from './embroidery';
function rectangle(width: number, height: number): Raster {
 const data=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<data.length;i+=4)data.set([180,20,20,255],i);
 return {width,height,data};
}
const settings:Settings={widthMm:10,colors:1,spacing:.4,removeWhite:false,underlay:false};
function satin(width=10,underlay=false){const raster=rectangle(width,20);const base=digitize(raster,{...settings,widthMm:width});return digitize(raster,{...settings,widthMm:width,underlay},{[base.layers[0].id]:{stitchType:'satin',direction:'vertical'}});}
describe('satin sewing geometry',()=>{
 it('alternates edge penetrations at half the same-side spacing on narrow columns',()=>{
   const raster=rectangle(20,4), config={...settings,widthMm:20};
   const id=digitize(raster,config).layers[0].id;
   const d=digitize(raster,config,{[id]:{stitchType:'satin',direction:'vertical'}});
   const top=d.stitches.filter(s=>s.command==='stitch'&&Math.abs(s.y)===20&&Math.abs(s.x)<80);
   expect(top.length).toBeGreaterThan(70);
   for(let i=2;i<top.length-3;i++) {
     expect(top[i].y).toBe(-top[i-1].y);
     expect(Math.abs(top[i].x-top[i-1].x)).toBeLessThanOrEqual(2.1);
   }
 });
 it('uses center-walk underlay and bounds every split stitch',()=>{
   const d=satin(10,true);
   const firstJump=d.stitches.findIndex(s=>s.command==='jump');
   const nextJump=d.stitches.findIndex((s,i)=>i>firstJump&&s.command==='jump');
   expect(nextJump).toBeGreaterThan(firstJump+2);
   expect(d.stitches.slice(firstJump,nextJump).every(s=>s.y===0)).toBe(true);
   for(let i=1;i<d.stitches.length;i++)if(d.stitches[i].command==='stitch')expect(Math.hypot(d.stitches[i].x-d.stitches[i-1].x,d.stitches[i].y-d.stitches[i-1].y)).toBeLessThanOrEqual(70.15);
 });
 it('staggers interior split positions on wide columns',()=>{
   const d=satin(20);
   const interiors=d.stitches.filter(s=>s.command==='stitch'&&Math.abs(s.y)<95);
   expect(new Set(interiors.map(s=>s.y)).size).toBeGreaterThan(3);
 });
});
