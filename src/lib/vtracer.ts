import { initialize, vectorize_rgba } from './vendor/vtracer.js';
import type { Point } from './smoothGeometry';
let ready = false, loading: Promise<void> | undefined;
export function initializeVTracer(bytes: BufferSource) { if (!ready) { initialize(bytes); ready = true; } }
export function loadVTracer() {
  if (ready) return Promise.resolve();
  return loading ??= fetch(`${import.meta.env.BASE_URL}vtracer/vtracer_wasm_bg.wasm`).then(response => {
    if (!response.ok) throw new Error('Could not load the VTracer design engine. Refresh and try again.');
    return response.arrayBuffer();
  }).then(initializeVTracer).catch(error => { loading = undefined; throw error; });
}
export type VectorGeometry = { path: string; loops: Point[][] };

// Flatten cubic segments to <= 0.02 mm error for sewing computations only.
// Preview/export keep the original cubic commands and control points intact.
export function flattenSvgPath(path: string, tolerance: number): Point[][] {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0, command = '', current: Point = { x: 0, y: 0 }, start = current, loop: Point[] = [];
  const loops: Point[][] = [];
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const cubic = (a: Point, b: Point, c: Point, d: Point, depth = 0) => {
    if (depth > 16 || Math.max(distance(b, a, d), distance(c, a, d)) <= tolerance) { loop.push(d); return; }
    const ab = mid(a,b), bc = mid(b,c), cd = mid(c,d), abc = mid(ab,bc), bcd = mid(bc,cd), center = mid(abc,bcd);
    cubic(a,ab,abc,center,depth+1); cubic(center,bcd,cd,d,depth+1);
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase(), op = command.toUpperCase(), origin = { ...current };
    const n = () => { const value = Number(tokens[i++]); if (!Number.isFinite(value)) throw new Error('Invalid VTracer path.'); return value; };
    const point = () => ({ x: n() + (relative ? origin.x : 0), y: n() + (relative ? origin.y : 0) });
    if (op === 'Z') { loop.push(start); if (loop.length > 3) loops.push(loop); loop = []; current = start; command = ''; }
    else if (op === 'M') { if (loop.length > 3) loops.push(loop); current = point(); start = current; loop = [current]; command = relative ? 'l' : 'L'; }
    else if (op === 'L') { current = point(); loop.push(current); }
    else if (op === 'H') { current = { x: n() + (relative ? origin.x : 0), y: origin.y }; loop.push(current); }
    else if (op === 'V') { current = { x: origin.x, y: n() + (relative ? origin.y : 0) }; loop.push(current); }
    else if (op === 'C') { const a = point(), b = point(), end = point(); cubic(current,a,b,end); current = end; }
    else if (op === 'Q') { const control = point(), end = point(); cubic(current, {x:current.x+(control.x-current.x)*2/3,y:current.y+(control.y-current.y)*2/3}, {x:end.x+(control.x-end.x)*2/3,y:end.y+(control.y-end.y)*2/3}, end); current = end; }
    else throw new Error(`Unsupported VTracer curve command ${command}.`);
  }
  if (loop.length > 3) loops.push(loop);
  return loops;
}

export function traceRegions(regions: { pixels: number[] }[], width: number, height: number, pixelMm: number, detail: 'simple'|'balanced'|'original' = 'balanced'): VectorGeometry[] {
  if (!ready) throw new Error('VTracer is not ready.');
  const rgba = new Uint8Array(width * height * 4), colors = new Map<string, number>();
  // Explicit background label keeps enclosed transparent holes in VTracer cutout mode.
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  regions.forEach((region, index) => {
    // Distinct temporary labels preserve editable region ownership and shared edges.
    const code = ((index + 1) * 2654435761) & 0xffffff;
    const rgb = [code >> 16, code >> 8 & 255, code & 255];
    const hex = `#${code.toString(16).padStart(6,'0')}`; colors.set(hex, index);
    for (const p of region.pixels) rgba.set([...rgb,255], p * 4);
  });
  const svg = vectorize_rgba(rgba, width, height, {
    mode: 'spline', hierarchical: 'cutout', colorPrecision: 8,
    layerDifference: 0, filterSpeckle: 0, simplify: Math.max(.6, .15 / pixelMm) * (detail==='simple'?2.5:detail==='original'?.5:1),
    pathPrecision: 5, optimize: 0, palette: ['#000000', ...colors.keys()]
  });
  const result: VectorGeometry[] = regions.map(() => ({path:'',loops:[]}));
  for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
    const color = tag.match(/\bfill="([^"]+)"/)?.[1].toLowerCase();
    const index = color && colors.get(color), path = tag.match(/\bd="([^"]+)"/)?.[1];
    if (index === undefined || !path) continue;
    if (/\btransform=/.test(tag)) throw new Error('Unexpected VTracer transform.');
    result[index].path += path;
    result[index].loops.push(...flattenSvgPath(path, .02 / pixelMm));
  }
  if (result.some(geometry => !geometry.path)) throw new Error('VTracer could not trace every artwork part. Try a larger or simpler image.');
  return result;
}
