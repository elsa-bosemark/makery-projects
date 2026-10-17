import type { EmbroideryDesign } from './embroidery';

export type NeedlePoint = { commandIndex: number; number: number; layerId?: string; x: number; y: number; dx: number; dy: number; length: number; color: string };
export function needlePoints(design: EmbroideryDesign): NeedlePoint[] {
  let number = 0;
  return design.stitches.flatMap((stitch, commandIndex) => {
    if (stitch.command !== 'stitch') return [];
    const previous = design.stitches[commandIndex - 1] ?? stitch;
    const dx = (stitch.x - previous.x) / 10, dy = (stitch.y - previous.y) / 10;
    return [{ commandIndex, number: ++number, layerId: stitch.layerId, x: stitch.x / 10, y: stitch.y / 10,
      dx, dy, length: Math.hypot(dx, dy), color: design.threads[stitch.color]?.hex ?? '#201b18' }];
  });
}
export function nearestNeedle(design: EmbroideryDesign, x: number, y: number, tolerance: number, layerId?: string, limit = design.stitches.length) {
  let best = tolerance * tolerance, found: number | undefined;
  for (let i = 0; i < Math.min(limit, design.stitches.length); i++) {
    const stitch = design.stitches[i];
    if (stitch.command !== 'stitch' || (layerId && stitch.layerId !== layerId)) continue;
    const sx = stitch.x / 10, sy = stitch.y / 10;
    let distance = (sx - x) ** 2 + (sy - y) ** 2;
    const previous = design.stitches[i - 1];
    if (previous && previous.color === stitch.color && previous.layerId === stitch.layerId) {
      const px = previous.x / 10, py = previous.y / 10, dx = sx - px, dy = sy - py;
      const t = Math.max(0, Math.min(1, ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy || 1)));
      distance = Math.min(distance, (x - px - t * dx) ** 2 + (y - py - t * dy) ** 2);
    }
    if (distance <= best) { best = distance; found = i; }
  }
  return found;
}
export function coordinateCsv(points: NeedlePoint[]) {
  return ['needle,x_mm,y_mm,delta_x_mm,delta_y_mm,stitch_length_mm,thread_color,file_command',
    ...points.map(p => [p.number, p.x.toFixed(1), p.y.toFixed(1), p.dx.toFixed(1), p.dy.toFixed(1), p.length.toFixed(2), p.color, p.commandIndex + 1].join(','))].join('\n');
}
