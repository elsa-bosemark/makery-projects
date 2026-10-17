import {expect,it} from 'vitest';
import {satinColumns,boundaryDistance} from './satinColumns';
import {runningPath} from './runningPath';
import {traceRegions} from './vtracer';
import {digitize,type Raster} from './embroidery';
function shape(test:(x:number,y:number)=>boolean){const width=90,height=90,pixels:number[]=[],data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(test(x,y)){pixels.push(y*width+x);data.set([0,0,0,255],(y*width+x)*4);}return {width,height,data,pixels,minX:Math.min(...pixels.map(p=>p%width)),maxX:Math.max(...pixels.map(p=>p%width)),minY:Math.min(...pixels.map(p=>Math.floor(p/width))),maxY:Math.max(...pixels.map(p=>Math.floor(p/width)))};}
it('computes exact first intersections rather than stepping beyond vector edges',()=>{
 const square=[[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10},{x:0,y:0}]];
 expect(boundaryDistance({x:3,y:5},{x:1,y:0},square)).toBe(7);
 expect(boundaryDistance({x:3,y:5},{x:-1,y:0},square)).toBe(3);
});
it('fits two consistently spaced rails on a straight column',()=>{
 const region=shape((x,y)=>x>=35&&x<45&&y>5&&y<85),loops=traceRegions([region],90,90,.2)[0].loops;
 const columns=satinColumns(region,90,loops,.2,.4);
 expect(columns.length).toBe(1);expect(columns[0].center.length).toBeGreaterThan(60);
 for(let i=5;i<columns[0].left.length-5;i++)expect(Math.hypot(columns[0].left[i].x-columns[0].right[i].x,columns[0].left[i].y-columns[0].right[i].y)*.2).toBeCloseTo(2,0);
});
it('separates a branching shape into bounded columns without junction spikes',()=>{
 const region=shape((x,y)=>(x>=40&&x<48&&y>8&&y<82)||(y>=30&&y<38&&x>8&&x<82)),loops=traceRegions([region],90,90,.2)[0].loops;
 const columns=satinColumns(region,90,loops,.2,.4);
 expect(columns.length).toBeGreaterThan(2);
 for(const column of columns)for(let i=0;i<column.left.length;i++)expect(Math.hypot(column.left[i].x-column.right[i].x,column.left[i].y-column.right[i].y)*.2).toBeLessThan(3.5);
});
it('retains sharp line corners and bounds needle movement',()=>{
 const result=runningPath([{x:0,y:0},{x:20,y:0},{x:20,y:20}],7,.1);
 expect(result).toContainEqual({x:20,y:0});
 for(let i=1;i<result.length;i++)expect(Math.hypot(result[i].x-result[i-1].x,result[i].y-result[i-1].y)).toBeLessThanOrEqual(7);
});
it('exports bounded satin movements and keeps bean backtracking on centerlines',()=>{
 const region=shape((x,y)=>x>=35&&x<45&&y>5&&y<85),raster:Raster=region;
 const settings={widthMm:20,colors:1,spacing:.4,removeWhite:true,underlay:true},id=digitize(raster,settings).layers[0].id;
 const satin=digitize(raster,settings,{[id]:{centerline:true,stitchType:'satin'}});
 for(let i=1;i<satin.stitches.length;i++)if(satin.stitches[i].command==='stitch')expect(Math.hypot(satin.stitches[i].x-satin.stitches[i-1].x,satin.stitches[i].y-satin.stitches[i-1].y)).toBeLessThanOrEqual(70.15);
 const line=digitize(raster,settings,{[id]:{centerline:true,stitchType:'running'}}),bean=digitize(raster,settings,{[id]:{centerline:true,stitchType:'bean'}});
 expect(bean.stitchCount).toBeGreaterThan(line.stitchCount*2);
});
