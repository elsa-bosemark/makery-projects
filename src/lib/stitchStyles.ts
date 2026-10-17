// Independently implemented image-layer adaptations of StitchLab's Fills & textures
// collection: https://github.com/jacobramirezsf/stitchlab/blob/main/src/stitchlab/sections.ts
export const STITCH_STYLES = [
  { id: 'fill', label: 'Tatami fill', group: 'Solid stitches', description: 'Staggered rows of short stitches fill the shape.' },
  { id: 'satin', label: 'Satin fill', group: 'Solid stitches', description: 'Alternating edge-to-edge stitches, best for narrow columns. Wide spans use staggered split stitches; Tatami is better for broad shapes.' },
  { id: 'running', label: 'Outline', group: 'Outlines', description: 'A single line follows the outer edge and holes.' },
  { id: 'bean', label: 'Bean outline', group: 'Outlines', description: 'Each outline stitch goes forward, back, then forward for a stronger line.' },
  { id: 'cross', label: 'Cross-stitch', group: 'Patterned fills', description: 'A grid of X-shaped stitches follows the image shape.' },
  { id: 'blackwork', label: 'Blackwork', group: 'Patterned fills', description: 'Open diamonds and small crosses make a repeating geometric fill.' },
  { id: 'fermat', label: 'Fermat spiral', group: 'Patterned fills', description: 'Two curved spiral arms are clipped to the shape.' },
  { id: 'quilting', label: 'Quilting contours', group: 'Patterned fills', description: 'Nested contour paths echo the shape’s outline.' },
  { id: 'meander', label: 'Meander', group: 'Patterned fills', description: 'A winding, rounded path fills the area with open stitching.' },
  { id: 'flowfield', label: 'Flow field', group: 'Patterned fills', description: 'Curving streams follow a smooth directional field.' },
  { id: 'crosshatch', label: 'Crosshatch', group: 'Patterned fills', description: 'Two sets of diagonal lines create an open hatch.' },
  { id: 'plaid', label: 'Plaid', group: 'Patterned fills', description: 'Bands of horizontal and vertical stitches form checks in this layer’s color.' },
  { id: 'moire', label: 'Moiré rings', group: 'Patterned fills', description: 'Two offset sets of rings create an overlapping texture.' },
  { id: 'honeycomb', label: 'Honeycomb', group: 'Patterned fills', description: 'A hexagonal mesh is clipped to the shape.' },
  { id: 'waves', label: 'Waves', group: 'Patterned fills', description: 'Parallel wave-shaped lines form an open fill.' },
  { id: 'dotgrid', label: 'Dot grid', group: 'Patterned fills', description: 'A grid of tiny stitched marks leaves fabric visible.' },
] as const;
export type StitchStyle = typeof STITCH_STYLES[number]['id'];
export type FillTexture = 'brick' | 'twill' | 'diamond' | 'random';
export const styleInfo = (id: string) => STITCH_STYLES.find(style => style.id === id) ?? STITCH_STYLES[0];
export const patternedStyle = (id: string) => styleInfo(id).group === 'Patterned fills';
export type PatternPoint = { x: number; y: number };
type Bounds = { x: number; y: number; width: number; height: number };

export function fillPhase(row: number, length: number, texture: FillTexture) {
  if (texture === 'twill') return (row % 8) / 8 * length;
  if (texture === 'diamond') return Math.abs((row % 8) - 4) / 4 * length;
  if (texture === 'random') {
    // Stable integer hash: re-exporting does not change needle positions.
    let hash = Math.imul(row + 1, 1597334677); hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296 * length;
  }
  return row % 4 / 4 * length;
}

export function patternPaths(kind: StitchStyle, bounds: Bounds, size: number, vertical: boolean, outlines: PatternPoint[][] = []): PatternPoint[][] {
  const paths: PatternPoint[][] = [], cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
  const w = vertical ? bounds.height : bounds.width, h = vertical ? bounds.width : bounds.height;
  const left = -w / 2, top = -h / 2, right = w / 2, bottom = h / 2;
  const place = (x: number, y: number) => vertical ? { x: cx + y, y: cy + x } : { x: cx + x, y: cy + y };
  let generated = 0;
  const add = (points: PatternPoint[], alreadyPlaced = false) => {
    generated += points.length;
    if (generated > 100000) throw new Error('Increase pattern spacing to reduce the number of needle points.');
    if (points.length > 1) paths.push(alreadyPlaced ? points : points.map(p => place(p.x, p.y)));
  };
  const line = (x: number, y: number, xx: number, yy: number) => add([{ x, y }, { x: xx, y: yy }]);
  const sample = (from: number, to: number, step: number, point: (v: number) => PatternPoint) => {
    const count = Math.max(1, Math.ceil((to - from) / step));
    return Array.from({ length: count + 1 }, (_, i) => point(from + (to - from) * i / count));
  };
  if (kind === 'cross' || kind === 'blackwork' || kind === 'dotgrid') {
    for (let y = top + Math.min(size / 2, h / 2); y < bottom; y += size) for (let x = left + Math.min(size / 2, w / 2); x < right; x += size) {
      const r = size * .43;
      if (kind === 'cross') { line(x - r, y - r, x + r, y + r); line(x + r, y - r, x - r, y + r); }
      else if (kind === 'blackwork') {
        add([{ x, y: y - r }, { x: x + r, y }, { x, y: y + r }, { x: x - r, y }, { x, y: y - r }]);
        line(x - r / 3, y, x + r / 3, y); line(x, y - r / 3, x, y + r / 3);
      } else {
        const d = Math.min(.3, size / 5);
        add([{ x: x - d, y }, { x: x + d, y }, { x, y: y - d }, { x, y: y + d }, { x: x - d, y }]);
      }
    }
  } else if (kind === 'crosshatch') {
    const extent = w + h;
    for (let offset = -Math.ceil(extent / (size * Math.SQRT2)) * size * Math.SQRT2; offset <= extent; offset += size * Math.SQRT2) {
      line(left - h, left - h + offset, right + h, right + h + offset);
      line(left - h, -(left - h) + offset, right + h, -(right + h) + offset);
    }
  } else if (kind === 'plaid') {
    for (let y = top + Math.min(size / 2, h / 2); y < bottom; y += size) for (const gap of [-.5, 0, .5]) line(left, y + gap, right, y + gap);
    for (let x = left + Math.min(size / 2, w / 2); x < right; x += size) for (const gap of [-.5, 0, .5]) line(x + gap, top, x + gap, bottom);
  } else if (kind === 'waves' || kind === 'meander') {
    const rows: PatternPoint[][] = [];
    for (let y = top + Math.min(size / 2, h / 2), row = 0; y < bottom; y += size, row++) {
      const path = sample(left - size, right + size, .3, x => ({ x, y: y + Math.sin(x / size * 2 + (kind === 'meander' ? row * .8 : 0)) * size * (kind === 'meander' ? .3 : .2) }));
      if (kind === 'meander' && row % 2) path.reverse();
      rows.push(path);
    }
    if (kind === 'waves') rows.forEach(path => add(path));
    else {
      const continuous: PatternPoint[] = [];
      rows.forEach((path, i) => {
        if (i) {
          const a = continuous[continuous.length - 1], b = path[0], sign = i % 2 ? 1 : -1;
          const midY = (a.y + b.y) / 2;
          continuous.push(...sample(0, Math.PI, .2, t => ({ x: a.x + sign * Math.sin(t) * size / 2, y: midY - Math.cos(t) * (b.y - a.y) / 2 })));
        }
        continuous.push(...path);
      });
      add(continuous);
    }
  } else if (kind === 'flowfield') {
    for (let y = top + Math.min(size / 2, h / 2); y <= bottom; y += size) {
      const path: PatternPoint[] = [{ x: left, y }];
      for (let i = 0; i < Math.ceil((w + size) / .35); i++) {
        const p = path[path.length - 1], angle = .55 * Math.sin(p.x / (size * 2)) + .3 * Math.sin(p.y / (size * 2));
        path.push({ x: p.x + .35 * Math.cos(angle), y: p.y + .35 * Math.sin(angle) });
      }
      add(path);
    }
  } else if (kind === 'honeycomb') {
    const radius = size / 2, hexHeight = Math.sqrt(3) * radius, edges = new Set<string>();
    for (let column = 0, x = left - radius; x <= right + radius; x += 1.5 * radius, column++) {
      for (let y = top - hexHeight + (column % 2) * hexHeight / 2; y < bottom + hexHeight; y += hexHeight) {
        const corners = Array.from({ length: 6 }, (_, i) => ({ x: x + radius * Math.cos(i * Math.PI / 3), y: y + radius * Math.sin(i * Math.PI / 3) }));
        for (let i = 0; i < 6; i++) {
          const a = corners[i], b = corners[(i + 1) % 6];
          const key = [a, b].map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).sort().join(':');
          if (!edges.has(key)) { edges.add(key); add([a, b]); }
        }
      }
    }
  } else if (kind === 'moire') {
    const maxRadius = Math.hypot(w, h) / 2 + size;
    const shift = Math.min(size / 3, w / 6, h / 6);
    for (const offset of [-shift, shift]) for (let r = Math.min(size / 2, Math.min(w, h) / 4); r <= maxRadius; r += size) {
      add(sample(0, Math.PI * 2, Math.min(.15, .4 / r), t => ({ x: offset + Math.cos(t) * r, y: Math.sin(t) * r })));
    }
  } else if (kind === 'fermat') {
    const a = size * 1.2, maxRadius = Math.hypot(w, h) / 2, maxTheta = (maxRadius / a) ** 2;
    for (const sign of [1, -1]) {
      const path: PatternPoint[] = [];
      for (let t = 0; t <= maxTheta; t += Math.min(.12, .35 / (a * Math.sqrt(t + .01)))) {
        const r = a * Math.sqrt(t); path.push({ x: sign * r * Math.cos(t), y: sign * r * Math.sin(t) });
      }
      if (path.length === 1) path.push({ x: sign * maxRadius * Math.cos(maxTheta), y: sign * maxRadius * Math.sin(maxTheta) });
      add(sign === -1 ? path.reverse() : path);
    }
  } else if (kind === 'quilting') {
    const extent = Math.max(bounds.width, bounds.height) / 2;
    for (let inset = Math.min(size / 2, extent * .3); inset < extent; inset += size) {
      const ratio = 1 - inset / extent;
      for (const outline of outlines) add(outline.map(p => ({ x: cx + (p.x - cx) * ratio, y: cy + (p.y - cy) * ratio })), true);
    }
  }
  return paths;
}

// Split paths at every raster-cell boundary, then retain only intervals inside
// the selected region. Holes and disconnected islands become jumps, not sewn lines.
export function clipPatternPaths(paths: PatternPoint[][], pixels: Set<number>, width: number, height: number, pixelMm: number): PatternPoint[][] {
  const result: PatternPoint[][] = [];
  const same = (a: PatternPoint, b: PatternPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;
  for (const path of paths) {
    let current: PatternPoint[] = [];
    const flush = () => { if (current.length > 1) result.push(current); current = []; };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y;
      const ax = a.x / pixelMm + width / 2, ay = a.y / pixelMm + height / 2, bx = b.x / pixelMm + width / 2, by = b.y / pixelMm + height / 2;
      const cuts = [0, 1];
      if (Math.abs(bx - ax) > 1e-8) for (let x = Math.floor(Math.min(ax, bx)) + 1; x < Math.max(ax, bx); x++) cuts.push((x - ax) / (bx - ax));
      if (Math.abs(by - ay) > 1e-8) for (let y = Math.floor(Math.min(ay, by)) + 1; y < Math.max(ay, by); y++) cuts.push((y - ay) / (by - ay));
      cuts.sort((x, y) => x - y);
      for (let k = 1; k < cuts.length; k++) {
        const from = cuts[k - 1], to = cuts[k]; if (to - from < 1e-9) continue;
        const mid = (from + to) / 2, x = Math.floor(ax + (bx - ax) * mid), y = Math.floor(ay + (by - ay) * mid);
        if (x < 0 || x >= width || y < 0 || y >= height || !pixels.has(y * width + x)) { flush(); continue; }
        const start = { x: a.x + dx * from, y: a.y + dy * from }, end = { x: a.x + dx * to, y: a.y + dy * to };
        if (current.length && !same(current[current.length - 1], start)) flush();
        if (!current.length) current.push(start);
        current.push(end);
      }
    }
    flush();
  }
  // Cell traversal vertices are collinear inside straight runs. Remove them so
  // they don't become needless penetrations before physical-length resampling.
  return result.map(path => {
    const out = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      const a = out[out.length - 1], b = path[i], c = path[i + 1];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const forward = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (Math.abs(cross) > 1e-8 || forward < 0) out.push(b);
    }
    out.push(path[path.length - 1]); return out;
  });
}
