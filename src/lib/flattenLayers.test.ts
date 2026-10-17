import { it,expect } from 'vitest';
import { digitize,type Raster } from './embroidery';
import { stitchSvg } from './stitchSvg';
it('flattens selected shapes into one compound layer and separates reversibly',()=>{
 const data=new Uint8ClampedArray(40*20*4);for(let y=3;y<17;y++)for(let x=3;x<37;x++)if(x<15||x>25)data.set(x<15?[0,0,0,255]:[200,30,30,255],(y*40+x)*4);
 const raster:Raster={width:40,height:20,data,sections:[{id:'image',name:'Image',x:0,y:0,width:40,height:20}]};
 const settings={widthMm:40,colors:2,spacing:.4,removeWhite:true,underlay:false};
 const before=digitize(raster,settings);expect(before.layers.length).toBe(2);
 const [first,second]=before.layers;
 const flattened=digitize(raster,settings,{[first.id]:{flattenMembers:[second.id],centerline:false}});
 expect(flattened.layers.length).toBe(1);expect(flattened.layers[0].areaMm2).toBeCloseTo(first.areaMm2!+second.areaMm2!);
 expect(flattened.layers[0].flattenMembers).toEqual([second.id]);
 expect(stitchSvg(flattened).match(/<path /g)?.length).toBe(1);
 const recolored=digitize(raster,settings,{[first.id]:{paletteSlot:second.paletteSlot}});
 expect(recolored.layers.find(layer=>layer.id===first.id)!.color).toBe(second.color);
 expect(digitize(raster,settings,{[first.id]:{flattenMembers:undefined}}).layers).toEqual(before.layers);
});
it('keeps explicit layer order with unknown new pieces appended',async()=>{
 const {sortLayerOrder}=await import('./embroidery');
 expect(sortLayerOrder([{id:'a'},{id:'b'},{id:'c'},{id:'new'}],['c','a','b']).map(l=>l.id)).toEqual(['c','a','b','new']);
});
