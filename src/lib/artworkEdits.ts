import { insideGeometry } from './smoothGeometry';
import type { Raster } from './embroidery';
export type ArtworkEdit = { imageId:string; scope?:'all'|'layer'; targetLoops?:{x:number;y:number}[][]; removeWhite?:boolean; tool:'paint'|'erase'|'bucket'; color:string; radius:number; points:{x:number;y:number}[] };
export function applyArtworkEdits(raster:Raster, edits:ArtworkEdit[]):Raster {
  if(!edits.length)return raster;
  const data=new Uint8ClampedArray(raster.data), width=raster.width;
  for(const edit of edits){
    const section=raster.sections?.find(s=>s.id===edit.imageId);if(!section)continue;
    const color=[1,3,5].map(i=>parseInt(edit.color.slice(i,i+2),16));
    const inside=(x:number,y:number)=>x>=section.x&&x<section.x+section.width&&y>=section.y&&y<section.y+section.height;
    const allowed=(x:number,y:number)=>{if(edit.scope!=='layer')return true;const i=(y*width+x)*4,inLayer=!!edit.targetLoops&&insideGeometry(edit.targetLoops,{x:(x+.5-section.x)/section.width,y:(y+.5-section.y)/section.height});return edit.tool==='erase'?inLayer:inLayer||data[i+3]===0||(edit.removeWhite&&Math.min(data[i],data[i+1],data[i+2])>238);};
    const write=(x:number,y:number)=>{if(!allowed(x,y))return;const i=(y*width+x)*4;data.set([...color,edit.tool==='erase'?0:255],i);};
    const points=edit.points.map(p=>({x:section.x+p.x*section.width,y:section.y+p.y*section.height}));
    if(edit.tool==='bucket'){
      const p=points[0];if(!p)continue;const x=Math.floor(p.x),y=Math.floor(p.y);if(!inside(x,y)||!allowed(x,y))continue;
      const start=y*width+x, source=Array.from(data.slice(start*4,start*4+4)), queue=[start], seen=new Set([start]);
      const matches=(pixel:number)=>source[3]===0?data[pixel*4+3]===0:data[pixel*4+3]>0&&[0,1,2].every(c=>Math.abs(data[pixel*4+c]-source[c])<=24);
      for(let head=0;head<queue.length;head++){const pixel=queue[head],xx=pixel%width,yy=Math.floor(pixel/width);for(const [nx,ny] of [[xx-1,yy],[xx+1,yy],[xx,yy-1],[xx,yy+1]]){const next=ny*width+nx;if(inside(nx,ny)&&allowed(nx,ny)&&!seen.has(next)&&matches(next)){seen.add(next);queue.push(next);}}}
      for(const pixel of queue)write(pixel%width,Math.floor(pixel/width));continue;
    }
    const radius=Math.max(1,edit.radius*Math.min(section.width,section.height));
    const dab=(p:{x:number;y:number})=>{for(let y=Math.max(section.y,Math.floor(p.y-radius));y<Math.min(section.y+section.height,Math.ceil(p.y+radius));y++)for(let x=Math.max(section.x,Math.floor(p.x-radius));x<Math.min(section.x+section.width,Math.ceil(p.x+radius));x++){if(Math.hypot(x+.5-p.x,y+.5-p.y)<=radius){const index=(y*width+x)*4;if(edit.scope==='all'||edit.scope==='layer'||edit.tool!=='erase'||[0,1,2].every(c=>Math.abs(data[index+c]-color[c])<70))write(x,y);}}};
    points.forEach((point,i)=>{if(!i){dab(point);return;}const before=points[i-1],count=Math.max(1,Math.ceil(Math.hypot(point.x-before.x,point.y-before.y)/(radius*.4)));for(let j=1;j<=count;j++)dab({x:before.x+(point.x-before.x)*j/count,y:before.y+(point.y-before.y)*j/count});});
  }
  return {...raster,data};
}
