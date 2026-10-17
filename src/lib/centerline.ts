type Point = { x: number; y: number };
type Region = { pixels: number[]; minX: number; maxX: number; minY: number; maxY: number };

// Zhang–Suen topology-preserving thinning, followed by branch graph tracing.
export function centerlines(region: Region, sourceWidth: number): Point[][] {
  const width = region.maxX - region.minX + 3, height = region.maxY - region.minY + 3;
  const mask = new Uint8Array(width * height);
  for (const pixel of region.pixels) mask[(Math.floor(pixel / sourceWidth) - region.minY + 1) * width + pixel % sourceWidth - region.minX + 1] = 1;
  const offsets = [-width, -width + 1, 1, width + 1, width, width - 1, -1, -width - 1];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const remove: number[] = [];
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = y * width + x; if (!mask[i]) continue;
        const n = offsets.map(offset => mask[i + offset]);
        const count = n.reduce((sum, value) => sum + value, 0);
        if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let j = 0; j < 8; j++) if (!n[j] && n[(j + 1) % 8]) transitions++;
        if (transitions !== 1) continue;
        if (pass === 0 ? n[0] * n[2] * n[4] || n[2] * n[4] * n[6] : n[0] * n[2] * n[6] || n[0] * n[4] * n[6]) continue;
        remove.push(i);
      }
      for (const i of remove) mask[i] = 0;
      if (remove.length) changed = true;
    }
  }
  const neighbors = (i: number) => offsets.map(offset => i + offset).filter(j => mask[j] && (Math.abs(j % width - i % width) + Math.abs(Math.floor(j / width) - Math.floor(i / width)) === 1 || (!mask[Math.floor(i / width) * width + j % width] && !mask[Math.floor(j / width) * width + i % width])));
  const nodes = Array.from(mask.keys()).filter(i => mask[i]);
  const visited = new Set<string>(), paths: Point[][] = [];
  const edge = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const toPoint = (i: number) => ({ x: i % width + region.minX - .5, y: Math.floor(i / width) + region.minY - .5 });
  for (const start of [...nodes.filter(i => neighbors(i).length !== 2), ...nodes]) {
    for (const neighbor of neighbors(start)) {
      if (visited.has(edge(start, neighbor))) continue;
      const path = [toPoint(start)]; let previous = start, current = neighbor;
      while (true) {
        visited.add(edge(previous, current)); path.push(toPoint(current));
        const next = neighbors(current);
        if (next.length !== 2 || current === start) break;
        const target = next.find(i => i !== previous)!;
        if (visited.has(edge(current, target))) break;
        previous = current; current = target;
      }
      if (path.length < 3) continue;
      // Smooth only interior points, retaining endpoints and branch connections.
      for (let pass = 0; pass < 2; pass++) {
        const copy = path.map(p => ({ ...p }));
        for (let i = 1; i < path.length - 1; i++) path[i] = { x: (copy[i - 1].x + 2 * copy[i].x + copy[i + 1].x) / 4, y: (copy[i - 1].y + 2 * copy[i].y + copy[i + 1].y) / 4 };
      }
      paths.push(path);
    }
  }
  return paths;
}

export function sampleCenterline(path: Point[], step: number): Point[] {
  if (!path.length) return [];
  const output = [path[0]]; let remaining = step;
  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1]; const b = path[i]; let length = Math.hypot(b.x - a.x, b.y - a.y);
    while (length >= remaining && length > 0) {
      const t = remaining / length;
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; output.push(a);
      length = Math.hypot(b.x - a.x, b.y - a.y); remaining = step;
    }
    remaining -= length;
  }
  const end = path[path.length - 1]; if (Math.hypot(end.x - output.at(-1)!.x, end.y - output.at(-1)!.y) > step * .25) output.push(end);
  return output;
}

// Grow branch labels through the original mask: every source pixel belongs to
// exactly one piece, so exploding cannot remove or duplicate artwork.
export function splitBranches<T extends Region>(region: T, sourceWidth: number): T[] {
  const paths = centerlines(region, sourceWidth).filter(path => path.length >= 4);
  if (paths.length < 2) return [region];
  const pixels = new Set(region.pixels), labels = new Map<number, number>(), queue: number[] = [];
  paths.forEach((path, label) => {
    for (const point of path.slice(1, -1)) {
      const pixel = Math.round(point.y) * sourceWidth + Math.round(point.x);
      if (pixels.has(pixel) && !labels.has(pixel)) { labels.set(pixel, label); queue.push(pixel); }
    }
  });
  if (!queue.length) return [region];
  for (let head = 0; head < queue.length; head++) {
    const pixel = queue[head], x = pixel % sourceWidth;
    for (const neighbor of [x > 0 ? pixel - 1 : -1, x < sourceWidth - 1 ? pixel + 1 : -1, pixel - sourceWidth, pixel + sourceWidth]) {
      if (pixels.has(neighbor) && !labels.has(neighbor)) { labels.set(neighbor, labels.get(pixel)!); queue.push(neighbor); }
    }
  }
  const groups = paths.map(() => [] as number[]);
  for (const pixel of region.pixels) groups[labels.get(pixel) ?? 0].push(pixel);
  return groups.filter(group => group.length).map(group => ({ ...region, pixels: group,
    minX: group.reduce((min,p)=>Math.min(min,p % sourceWidth),Infinity), maxX: group.reduce((max,p)=>Math.max(max,p % sourceWidth),-Infinity),
    minY: group.reduce((min,p)=>Math.min(min,Math.floor(p / sourceWidth)),Infinity), maxY: group.reduce((max,p)=>Math.max(max,Math.floor(p / sourceWidth)),-Infinity) }));
}

export type ShapeCut = { a: Point; b: Point };
export function splitByCuts<T extends Region>(region: T, sourceWidth: number, cuts: ShapeCut[]): T[] {
  const pixels = new Set(region.pixels), barrier = new Set<number>();
  for (const cut of cuts) {
    const dx = cut.b.x-cut.a.x, dy = cut.b.y-cut.a.y, length2 = dx*dx+dy*dy;
    if (!length2) continue;
    for (const pixel of region.pixels) {
      const x = pixel%sourceWidth+.5, y = Math.floor(pixel/sourceWidth)+.5;
      const t = Math.max(0,Math.min(1,((x-cut.a.x)*dx+(y-cut.a.y)*dy)/length2));
      if (Math.hypot(x-cut.a.x-t*dx,y-cut.a.y-t*dy)<=.8) barrier.add(pixel);
    }
  }
  const labels = new Map<number,number>(), groups:number[][]=[];
  const neighbors = (p:number)=>[p%sourceWidth>0?p-1:-1,p%sourceWidth<sourceWidth-1?p+1:-1,p-sourceWidth,p+sourceWidth];
  for (const pixel of region.pixels) {
    if (barrier.has(pixel)||labels.has(pixel)) continue;
    const label=groups.length, group=[pixel];labels.set(pixel,label);
    for(let head=0;head<group.length;head++)for(const next of neighbors(group[head])) {
      if(pixels.has(next)&&!barrier.has(next)&&!labels.has(next)){labels.set(next,label);group.push(next);}
    }
    groups.push(group);
  }
  if(groups.length<2)return [region];
  const queue=groups.flat();
  for(let head=0;head<queue.length;head++)for(const next of neighbors(queue[head])) {
    if(pixels.has(next)&&!labels.has(next)){const label=labels.get(queue[head])!;labels.set(next,label);groups[label].push(next);queue.push(next);}
  }
  return groups.map(group=>({...region,pixels:group,
    minX:group.reduce((min,p)=>Math.min(min,p%sourceWidth),Infinity),maxX:group.reduce((max,p)=>Math.max(max,p%sourceWidth),-Infinity),
    minY:group.reduce((min,p)=>Math.min(min,Math.floor(p/sourceWidth)),Infinity),maxY:group.reduce((max,p)=>Math.max(max,Math.floor(p/sourceWidth)),-Infinity)}));
}
