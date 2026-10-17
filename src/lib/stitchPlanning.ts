import type { StitchStyle } from './stitchStyles';

export type ImageDetail = 'original' | 'balanced' | 'simple';
export type StitchCoverage = 'solid' | 'outline' | 'combined' | 'light' | 'pattern';
export const DETAIL_LEVELS = [
  { id: 'original', label: 'Detailed', area: .2, description: 'Keep small details.' },
  { id: 'balanced', label: 'Balanced', area: 1.2, description: 'Merge small color fragments into neighboring shapes.' },
  { id: 'simple', label: 'Simple', area: 4, description: 'Keep the main shapes and remove more tiny details.' },
] as const;
export const COVERAGE_PLANS = [
  { id: 'solid', label: 'Solid fill', description: 'Fill each shape with Tatami stitches.' },
  { id: 'outline', label: 'Outline', description: 'Stitch only the edges, leaving the inside open.' },
  { id: 'combined', label: 'Combined', description: 'Fill each shape, then stitch its outline.' },
] as const;

export function stitchRecipe(coverage: StitchCoverage, areaMm2: number, color: number, spacing: number, underlay: boolean) {
  if (coverage === 'outline') return { stitchType: 'running' as const, spacing, stitchLength: 2.5, underlay: false, outline: false, patternSize: 4, direction: 'horizontal' as const };
  if (coverage === 'pattern') {
    const patterns: StitchStyle[] = ['waves', 'honeycomb', 'crosshatch', 'dotgrid'];
    return { stitchType: areaMm2 < 12 ? 'running' as const : patterns[color % patterns.length], spacing, stitchLength: 3.5, underlay: false, outline: true, patternSize: 5, direction: color % 2 ? 'vertical' as const : 'horizontal' as const };
  }
  return { stitchType: 'fill' as const, spacing: coverage === 'light' ? Math.max(.9, spacing) : spacing, stitchLength: coverage === 'light' ? 3.5 : 2.5, underlay: coverage === 'light' ? false : underlay, outline: coverage === 'combined', patternSize: 4, direction: 'horizontal' as const };
}

// Remove raster stair steps within a small physical tolerance. Keep corners,
// closure, and separated hole loops, then let the stitch engine split long runs.
export function simplifyOutline(points: { x: number; y: number }[], tolerance = .2) {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]), pending = [[0, points.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop()!, a = points[first], b = points[last];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    let furthest = -1, maxDistance = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = points[i], t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
      const distance = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
      if (distance > maxDistance) { furthest = i; maxDistance = distance; }
    }
    if (furthest >= 0) { keep.add(furthest); pending.push([first, furthest], [furthest, last]); }
  }
  return [...keep].sort((a, b) => a - b).map(index => points[index]);
}
