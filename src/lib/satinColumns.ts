import { traceRegions } from './vtracer';
import { centerlines, sampleCenterline, splitBranches } from './centerline';
import { insideGeometry, type Point } from './smoothGeometry';
type Region={pixels:number[];minX:number;maxX:number;minY:number;maxY:number};
export type SatinColumn={left:Point[];right:Point[];center:Point[]};
const cross=(a:Point,b:Point)=>a.x*b.y-a.y*b.x;
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]??0;};
/** First boundary hit along a ray. No stepping beyond the actual vector edge. */
export function boundaryDistance(origin:Point,direction:Point,loops:Point[][]):number{
 let nearest=Infinity;
 for(const loop of loops)for(let i=1;i<loop.length;i++){
  const a=loop[i-1],b=loop[i],edge={x:b.x-a.x,y:b.y-a.y},delta={x:a.x-origin.x,y:a.y-origin.y};
  const determinant=cross(direction,edge);if(Math.abs(determinant)<1e-9)continue;
  const distance=cross(delta,edge)/determinant,along=cross(delta,direction)/determinant;
  if(distance>=-1e-7&&along>=-1e-7&&along<=1+1e-7)nearest=Math.min(nearest,Math.max(0,distance));
 }
 return Number.isFinite(nearest)?nearest:0;
}
/** Independently authored rail planner: stable tangents, paired vector edges,
 * bounded junction widths and suppressed inner-curve crowding. Units are source pixels. */
function planColumn(region:Region,width:number,loops:Point[][],pixelMm:number,spacingMm:number,strokeWidth?:number,direction:'follow'|'horizontal'|'vertical'='follow'):SatinColumn[]{
 const columns:SatinColumn[]=[];
 for(const path of centerlines(region,width)){
  const pathLength=path.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-path[i].x,p.y-path[i].y),0);
  // Tiny skeleton spurs are not independent stitchable columns.
  if(pathLength*pixelMm<.6)continue;
  const step=spacingMm/pixelMm/2,points=sampleCenterline(path,step);
  const tangentWindow=Math.max(1,Math.round(.6/pixelMm/step));
  const pairs=points.map((p,i)=>{
   const before=points[Math.max(0,i-tangentWindow)],after=points[Math.min(points.length-1,i+tangentWindow)];
   const length=Math.hypot(after.x-before.x,after.y-before.y)||1;
   const normal=direction==='horizontal'?{x:1,y:0}:direction==='vertical'?{x:0,y:1}:{x:-(after.y-before.y)/length,y:(after.x-before.x)/length};
   const left=boundaryDistance(p,normal,loops),right=boundaryDistance(p,{x:-normal.x,y:-normal.y},loops);
   return {p,normal,left,right};
  });
  const nominal=median(pairs.slice(Math.floor(pairs.length*.2),Math.ceil(pairs.length*.8)).map(pair=>Math.min(pair.left,pair.right)).filter(value=>value*pixelMm>.1));
  let column:SatinColumn={left:[],right:[],center:[]};
  const finish=()=>{if(column.center.length>2)columns.push(column);column={left:[],right:[],center:[]};};
  for(const pair of pairs){
   if(!insideGeometry(loops,pair.p)||Math.min(pair.left,pair.right)*pixelMm<.08){finish();continue;}
   // At branch junctions a ray can enter another arm. Cap by this column's
   // characteristic width; keep left/right rails paired instead of fanning out.
   const cap=strokeWidth!=null?strokeWidth/pixelMm/2:nominal*1.35;
   const l=strokeWidth!=null?cap:Math.min(pair.left,cap),r=strokeWidth!=null?cap:Math.min(pair.right,cap);
   if(l+r<.2/pixelMm){finish();continue;}
   const left={x:pair.p.x+pair.normal.x*l,y:pair.p.y+pair.normal.y*l},right={x:pair.p.x-pair.normal.x*r,y:pair.p.y-pair.normal.y*r};
   const previous=column.center.at(-1);
   if(previous){
    const lastLeft=column.left.at(-1)!,lastRight=column.right.at(-1)!;
    // Crossed rails indicate a hairpin or unstable direction. Start a new column.
    const advance={x:pair.p.x-previous.x,y:pair.p.y-previous.y};
    const leftAdvance=(left.x-lastLeft.x)*advance.x+(left.y-lastLeft.y)*advance.y;
    const rightAdvance=(right.x-lastRight.x)*advance.x+(right.y-lastRight.y)*advance.y;
    if(leftAdvance<-.1||rightAdvance<-.1){finish();}
   }
   column.left.push(left);column.right.push(right);column.center.push({x:(left.x+right.x)/2,y:(left.y+right.y)/2});
  }
  finish();
 }
 return columns;
}

/** Each graph branch owns a disjoint filled region before rail fitting. */
export function satinColumns(region:Region,width:number,loops:Point[][],pixelMm:number,spacingMm:number,strokeWidth?:number,direction:'follow'|'horizontal'|'vertical'='follow'):SatinColumn[]{
 const pieces=splitBranches(region,width,Math.max(4,1/pixelMm));
 if(pieces.length===1)return planColumn(region,width,loops,pixelMm,spacingMm,strokeWidth,direction);
 const vectors=traceRegions(pieces,width,region.maxY+2,pixelMm);
 return pieces.flatMap((piece,i)=>planColumn(piece,width,vectors[i].loops,pixelMm,spacingMm,strokeWidth,direction));
}
