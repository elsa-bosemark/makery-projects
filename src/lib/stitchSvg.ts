import type { EmbroideryDesign } from './embroidery';

/** Solid detected regions, positioned in millimeters like the composed design. */
export function stitchSvg(design: EmbroideryDesign): string {
  const paths = design.layers.filter(layer => layer.visible && layer.previewPath).slice().reverse().map(layer => {
    const [x, y, width, height] = layer.previewBox.split(/\s+/).map(Number);
    const sx = layer.bounds.width / width, sy = layer.bounds.height / height;
    const tx = layer.bounds.x - x * sx, ty = layer.bounds.y - y * sy;
    const color = /^#[0-9a-f]{6}$/i.test(layer.color) ? layer.color : '#333333';
    const isLine = layer.svgGeometry === 'perimeter' || layer.svgGeometry === 'centerline';
    const path = layer.svgGeometry === 'centerline' ? layer.centerlinePath || layer.previewPath : layer.previewPath;
    const paint = isLine ? `fill="none" stroke="${color}" stroke-width="${.35 / Math.max(sx,sy)}" stroke-linecap="round" stroke-linejoin="round"` : `fill="${color}" fill-rule="evenodd"`;
    return `<path d="${path}" ${paint} transform="matrix(${sx} 0 0 ${sy} ${tx} ${ty})"/>`;
  });
  const width = Math.max(.1, design.widthMm), height = Math.max(.1, design.heightMm);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${-width / 2} ${-height / 2} ${width} ${height}"><title>Embroidery artwork</title>${paths.join('')}</svg>`;
}
