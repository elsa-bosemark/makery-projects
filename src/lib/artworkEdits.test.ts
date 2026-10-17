import { it, expect } from 'vitest';
import { applyArtworkEdits } from './artworkEdits';
import type { Raster } from './embroidery';
function raster():Raster{const data=new Uint8ClampedArray(20*20*4);for(let y=0;y<20;y++)data.set([0,0,0,255],(y*20+10)*4);return {width:20,height:20,data,sections:[{id:'one',name:'One',x:0,y:0,width:20,height:20}]};}
it('bucket fills only a connected area and preserves the original raster',()=>{const source=raster(),edited=applyArtworkEdits(source,[{imageId:'one',tool:'bucket',color:'#ff0000',radius:.1,points:[{x:.2,y:.5}]}]);expect(edited.data[(10*20+2)*4]).toBe(255);expect(edited.data[(10*20+15)*4+3]).toBe(0);expect(source.data[(10*20+2)*4+3]).toBe(0);});
it('interpolates brush gestures and erases only the selected color',()=>{const source=raster(),paint=applyArtworkEdits(source,[{imageId:'one',tool:'paint',color:'#ff0000',radius:.1,points:[{x:.1,y:.5},{x:.9,y:.5}]}]);expect(paint.data[(10*20+5)*4]).toBe(255);const erased=applyArtworkEdits(paint,[{imageId:'one',tool:'erase',color:'#ff0000',radius:.1,points:[{x:.25,y:.5}]}]);expect(erased.data[(10*20+5)*4+3]).toBe(0);expect(erased.data[(2*20+10)*4+3]).toBe(255);});
it('limits editing to the chosen image',()=>{const source=raster();source.sections![0].width=10;const changed=applyArtworkEdits(source,[{imageId:'one',tool:'paint',color:'#ff0000',radius:.5,points:[{x:1,y:.5}]}]);expect(changed.data[(10*20+11)*4+3]).toBe(0);});
it('all-layer erase removes every color while layer erase protects other shapes',()=>{
 const source=raster();source.data.set([255,0,0,255],(10*20+5)*4);
 const points=[{x:.1,y:.5},{x:.9,y:.5}], targetLoops=[[{x:0,y:0},{x:.4,y:0},{x:.4,y:1},{x:0,y:1},{x:0,y:0}]];
 const local=applyArtworkEdits(source,[{imageId:'one',scope:'layer',targetLoops,tool:'erase',color:'#ff0000',radius:.1,points}]);
 expect(local.data[(10*20+5)*4+3]).toBe(0);expect(local.data[(10*20+10)*4+3]).toBe(255);
 const all=applyArtworkEdits(source,[{imageId:'one',scope:'all',tool:'erase',color:'#ff0000',radius:.1,points}]);
 expect(all.data[(10*20+10)*4+3]).toBe(0);
 const added=applyArtworkEdits(source,[{imageId:'one',scope:'layer',targetLoops,tool:'paint',color:'#ff0000',radius:.1,points}]);
 expect(added.data[(10*20+7)*4]).toBe(255);expect(added.data[(10*20+10)*4]).toBe(0);
});
