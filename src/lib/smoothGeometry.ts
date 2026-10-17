export type Point = { x: number; y: number };
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function scanSpans(loops: Point[][], scan: number, vertical = false): [number, number][] {
  const hits: number[] = [];
  for (const loop of loops) for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1], b = loop[i], ay = vertical ? a.x : a.y, by = vertical ? b.x : b.y;
    if ((ay > scan) === (by > scan)) continue;
    const ax = vertical ? a.y : a.x, bx = vertical ? b.y : b.x;
    hits.push(ax + (bx - ax) * (scan - ay) / (by - ay));
  }
  hits.sort((a, b) => a - b);
  const spans: [number, number][] = [];
  for (let i = 1; i < hits.length; i += 2) if (hits[i] > hits[i - 1] + 1e-8) spans.push([hits[i - 1], hits[i]]);
  return spans;
}
export function insideGeometry(loops: Point[][], p: Point) {
  // Boundary points belong to the shape, including the upper/right rails.
  for (const loop of loops) for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1], b = loop[i], dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    if (!length) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
    if (Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 1e-7) return true;
  }
  return scanSpans(loops, p.y).some(([a, b]) => p.x >= a - 1e-7 && p.x <= b + 1e-7);
}

// Intersect segments with the same curved contour approximation used by fills.
export function clipSmoothPaths(paths: Point[][], loops: Point[][]): Point[][] {
  const result: Point[][] = [];
  for (const path of paths) {
    let current: Point[] = [];
    const flush = () => { if (current.length > 1) result.push(current); current = []; };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y, cuts = [0, 1];
      for (const loop of loops) for (let j = 1; j < loop.length; j++) {
        const c = loop[j - 1], d = loop[j], ex = d.x - c.x, ey = d.y - c.y, det = dx * ey - dy * ex;
        if (Math.abs(det) < 1e-10) continue;
        const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / det;
        const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / det;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
      }
      cuts.sort((a, b) => a - b);
      for (let j = 1; j < cuts.length; j++) {
        const from = cuts[j - 1], to = cuts[j]; if (to - from < 1e-8) continue;
        if (!insideGeometry(loops, lerp(a, b, (from + to) / 2))) { flush(); continue; }
        const start = lerp(a, b, from), end = lerp(a, b, to);
        if (current.length && Math.hypot(current[current.length - 1].x - start.x, current[current.length - 1].y - start.y) > 1e-6) flush();
        if (!current.length) current.push(start); current.push(end);
      }
    }
    flush();
  }
  return result;
}
