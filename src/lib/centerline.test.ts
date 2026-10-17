import { describe,it,expect } from 'vitest';
import { stitchSvg } from './stitchSvg';
import { centerlines, splitBranches, splitByCuts } from './centerline';
import { digitize,writePes,type Raster,type Settings } from './embroidery';
const config:Settings={widthMm:20,colors:1,spacing:.4,removeWhite:true,underlay:false};
function image(test:(x:number,y:number)=>boolean):Raster{
 const width=80,height=80,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(test(x,y))data.set([0,0,0,255],(y*width+x)*4);
 return {width,height,data};
}
describe('centerline strokes',()=>{
 it('exports centerline SVG paths and perimeter SVG paths separately',()=>{
  const raster=image((x,y)=>x>30&&x<40&&y>10&&y<70);
  const middle=digitize(raster,{...config,svgGeometry:'centerline'});
  expect(middle.layers[0].centerlinePath).toContain('Q');
  expect(stitchSvg(middle)).toContain('fill="none"');
  expect(stitchSvg(middle)).toContain(middle.layers[0].centerlinePath);
  const edge=digitize(raster,{...config,svgGeometry:'perimeter'});
  expect(edge.layers[0].stitchType).toBe('running');
  expect(edge.layers[0].centerline).toBe(false);
  expect(stitchSvg(edge)).toContain(edge.layers[0].previewPath);
 });
 it('lets Textile restore original fill after any SVG geometry selection',()=>{
  const raster=image((x,y)=>x>25&&x<45&&y>10&&y<70);
  const solid=digitize(raster,config);
  for(const svgGeometry of ['perimeter','centerline'] as const){
   const changed=digitize(raster,{...config,svgGeometry},{[solid.layers[0].id]:{stitchType:'fill',centerline:false}});
   expect(changed.stitches).toEqual(solid.stitches);
   expect(changed.layers[0].previewPath).toEqual(solid.layers[0].previewPath);
  }
 });
 it('excludes a hidden palette color from stitches and SVG, then restores it',()=>{
  const raster=image((x,y)=>x>25&&x<45&&y>10&&y<70);
  const visible=digitize(raster,config);
  const hidden=digitize(raster,config,{}, {limit:1,colors:{},hiddenSlots:[0]});
  expect(hidden.layers.every(layer=>!layer.visible)).toBe(true);
  expect(hidden.stitchCount).toBe(0);
  expect(stitchSvg(hidden)).not.toContain('<path');
  expect(digitize(raster,config,{}, {limit:1,colors:{},hiddenSlots:[]}).stitches).toEqual(visible.stitches);
 });
 it('retains the closed centerline around a hole',()=>{
  const width=40,pixels:number[]=[];
  for(let y=0;y<40;y++)for(let x=0;x<40;x++)if(Math.hypot(x-20,y-20)>10&&Math.hypot(x-20,y-20)<15)pixels.push(y*width+x);
  const paths=centerlines({pixels,minX:5,maxX:35,minY:5,maxY:35},width);
  expect(paths.length).toBeGreaterThan(0);
  for(const path of paths)for(const p of path)expect(Math.hypot(p.x-20,p.y-20)).toBeGreaterThan(9);
 });
 it('sets the width perpendicular to a curved letter rather than tracing its edges',()=>{
  const raster=image((x,y)=>Math.hypot(x-40,y-40)>22&&Math.hypot(x-40,y-40)<30);
  const id=digitize(raster,config).layers[0].id;
  const stroke=digitize(raster,config,{[id]:{centerline:true,strokeWidth:1,stitchType:'satin',stitchLength:7}});
  expect(stroke.stitchCount).toBeGreaterThan(100);
  expect(stroke.jumps).toBeLessThan(10);
  for(const s of stroke.stitches.filter(s=>s.command==='stitch'))expect(Math.hypot(s.x,s.y)).toBeGreaterThan(35);
  expect(writePes(stroke).slice(0,8)).toEqual(new TextEncoder().encode('#PES0001'));
 });
 it('changing stroke width changes needle positions',()=>{
  const raster=image((x,y)=>x>30&&x<40&&y>10&&y<70),id=digitize(raster,config).layers[0].id;
  const exportWidth=(strokeWidth:number)=>digitize(raster,config,{[id]:{centerline:true,strokeWidth,stitchType:'satin',stitchLength:7}}).stitches.filter(s=>s.command==='stitch');
  const extent=(stitches:ReturnType<typeof exportWidth>)=>Math.max(...stitches.map(s=>s.x))-Math.min(...stitches.map(s=>s.x));
  expect(extent(exportWidth(2))-extent(exportWidth(1))).toBeGreaterThanOrEqual(9);
 });
});

describe('editable satin branches',()=>{
 it('partitions branching artwork without losing or duplicating pixels',()=>{
  const raster=image((x,y)=>(x>=35&&x<=44&&y>5&&y<75)||(y>=25&&y<=34&&x>10&&x<70));
  const pixels=Array.from({length:6400},(_,i)=>i).filter(i=>raster.data[i*4+3]);
  const pieces=splitBranches({pixels,minX:10,maxX:70,minY:5,maxY:75},80);
  expect(pieces.length).toBeGreaterThan(1);
  const joined=pieces.flatMap(p=>p.pixels);
  expect(joined.length).toBe(pixels.length);
  expect(new Set(joined)).toEqual(new Set(pixels));
 });
 it('creates stable editable pieces and preserves unrelated layer ids',()=>{
  const raster=image((x,y)=>(x>=35&&x<=44&&y>5&&y<75)||(y>=25&&y<=34&&x>10&&x<70)||(x<5&&y<5));
  const before=digitize(raster,config),target=before.layers.find(l=>l.areaMm2!>5)!;
  const split=digitize(raster,config,{[target.id]:{explode:true}});
  const branches=split.layers.filter(l=>l.id.startsWith(target.id+'-branch-'));
  expect(branches.length).toBeGreaterThan(1);
  for(const layer of before.layers.filter(l=>l.id!==target.id))expect(split.layers.some(l=>l.id===layer.id)).toBe(true);
  const changed=digitize(raster,config,{[target.id]:{explode:true},[branches[0].id]:{satinDirection:'horizontal'}});
  expect(changed.layers.find(l=>l.id===branches[0].id)!.satinDirection).toBe('horizontal');
  expect(changed.stitches.filter(s=>s.layerId===branches[1].id)).toEqual(split.stitches.filter(s=>s.layerId===branches[1].id));
  expect(digitize(raster,config).layers).toEqual(before.layers);
 });
});

describe('manual cuts',()=>{
 it('splits at a drawn cut, preserving the complete original mask',()=>{
  const pixels:number[]=[];for(let y=10;y<30;y++)for(let x=10;x<30;x++)pixels.push(y*40+x);
  const region={pixels,minX:10,maxX:29,minY:10,maxY:29};
  const pieces=splitByCuts(region,40,[{a:{x:20,y:5},b:{x:20,y:35}}]);
  expect(pieces).toHaveLength(2);
  expect(pieces.flatMap(p=>p.pixels).length).toBe(pixels.length);
  expect(new Set(pieces.flatMap(p=>p.pixels))).toEqual(new Set(pixels));
  expect(splitByCuts(region,40,[{a:{x:20,y:15},b:{x:20,y:25}}])).toEqual([region]);
 });
 it('allows a manually cut piece to be cut again and independently edited',()=>{
  const raster=image((x,y)=>x>15&&x<65&&y>15&&y<65),id=digitize(raster,config).layers[0].id;
  const cuts=[{a:{x:.5,y:-.1},b:{x:.5,y:1.1}}];
  const first=digitize(raster,config,{[id]:{cuts}});
  expect(first.layers).toHaveLength(2);
  const child=first.layers[0].id;
  const second=digitize(raster,config,{[id]:{cuts},[child]:{cuts:[{a:{x:-.1,y:.5},b:{x:1.1,y:.5}}]}});
  expect(second.layers).toHaveLength(3);
  expect(second.layers.some(layer=>layer.id.startsWith(child+'-branch-'))).toBe(true);
 });
});

describe('fill follows stroke',()=>{
 it('defaults fill direction to follow and produces different needle paths from straight rows',()=>{
  const raster=image((x,y)=>Math.abs(y-x)<7&&x>10&&x<65);
  const source=digitize(raster,config),id=source.layers[0].id;
  const follow=digitize(raster,config,{[id]:{centerline:false,stitchType:'fill'}});
  const horizontal=digitize(raster,config,{[id]:{centerline:false,stitchType:'fill',fillDirection:'horizontal'}});
  expect(follow.layers[0].fillDirection).toBe('follow');
  expect(horizontal.layers[0].fillDirection).toBe('horizontal');
  expect(follow.stitches).not.toEqual(horizontal.stitches);
  expect(writePes(follow).slice(0,8)).toEqual(new TextEncoder().encode('#PES0001'));
 });
});

it('scopes SVG appearance and detail to individual layers',()=>{
 const raster=image((x,y)=>(x>5&&x<25&&y>10&&y<60)||(x>45&&x<70&&y>20&&y<65));
 const before=digitize(raster,config),[first,second]=before.layers;
 const after=digitize(raster,config,{[first.id]:{svgGeometry:'perimeter',svgDetail:'simple',stitchType:'running',centerline:false}});
 expect(after.layers.find(l=>l.id===first.id)!.svgGeometry).toBe('perimeter');
 expect(after.layers.find(l=>l.id===first.id)!.svgDetail).toBe('simple');
 expect(after.layers.find(l=>l.id===second.id)).toEqual(second);
 expect(after.stitches.filter(s=>s.layerId===second.id)).toEqual(before.stitches.filter(s=>s.layerId===second.id));
});
