type Point={x:number;y:number};
/** Keep corners/curves within tolerance, then bound every needle movement.
 * This avoids long chords across tight bends and pixel-by-pixel needle drops. */
export function runningPath(points:Point[],maxLength:number,tolerance:number):Point[]{
 if(points.length<2)return points;
 const keep=new Set([0,points.length-1]),pending=[[0,points.length-1]];
 while(pending.length){const [start,end]=pending.pop()!,a=points[start],b=points[end],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;let distance=tolerance,index=-1;
  for(let i=start+1;i<end;i++){const p=points[i],t=l2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2)):0,d=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);if(d>distance){distance=d;index=i;}}
  if(index>=0){keep.add(index);pending.push([start,index],[index,end]);}
 }
 const simplified=[...keep].sort((a,b)=>a-b).map(i=>points[i]),result=[simplified[0]];
 for(let i=1;i<simplified.length;i++){const a=simplified[i-1],b=simplified[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/maxLength));for(let j=1;j<=steps;j++)result.push({x:a.x+(b.x-a.x)*j/steps,y:a.y+(b.y-a.y)*j/steps});}
 return result;
}
