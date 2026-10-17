import type { EmbroideryDesign } from './embroidery';

// Offsets are fractions of the original project width, so resizing also scales placement.
export type ImageOffsets = Record<string, { x: number; y: number }>;
export type ImageBounds = { id: string; name: string; x: number; y: number; width: number; height: number };
export function positionImages(source: EmbroideryDesign, offsets: ImageOffsets) {
  const layers = source.layers.map(layer => {
    const offset = offsets[layer.itemId ?? ''] ?? { x: 0, y: 0 };
    const dx = Math.round(offset.x * source.widthMm * 10) / 10;
    const dy = Math.round(offset.y * source.widthMm * 10) / 10;
    return { ...layer, bounds: { ...layer.bounds, x: layer.bounds.x + dx, y: layer.bounds.y + dy } };
  });
  const shifts = new Map(layers.map((layer, index) => [layer.id, {
    x: Math.round((layer.bounds.x - source.layers[index].bounds.x) * 10),
    y: Math.round((layer.bounds.y - source.layers[index].bounds.y) * 10)
  }]));
  const stitches = source.stitches.map((stitch, index) => {
    // Color changes stay at the preceding needle position, even when their layerId
    // belongs to the next image. They must not introduce a movement into that image.
    const previous = source.stitches[index - 1];
    const anchor = (stitch.command === 'color' || stitch.command === 'end') && previous ? previous : stitch;
    const shift = shifts.get(anchor.layerId ?? '') ?? { x: 0, y: 0 };
    return { ...stitch, x: stitch.x + shift.x, y: stitch.y + shift.y };
  });
  const images: ImageBounds[] = [];
  for (const layer of layers.filter(layer => layer.visible)) {
    const id = layer.itemId ?? 'artwork', b = layer.bounds;
    const item = images.find(image => image.id === id);
    if (!item) images.push({ id, name: layer.itemName ?? 'Artwork', ...b });
    else {
      const right = Math.max(item.x + item.width, b.x + b.width), bottom = Math.max(item.y + item.height, b.y + b.height);
      item.x = Math.min(item.x, b.x); item.y = Math.min(item.y, b.y);
      item.width = right - item.x; item.height = bottom - item.y;
    }
  }
  if (!images.length) return { raw: source, design: source, images, center: { x: 0, y: 0 } };
  // Include both artwork edges and actual needle positions in the fit calculation.
  let left = Math.min(...images.map(image => image.x)), top = Math.min(...images.map(image => image.y));
  let right = Math.max(...images.map(image => image.x + image.width)), bottom = Math.max(...images.map(image => image.y + image.height));
  for (const stitch of stitches) {
    left = Math.min(left, stitch.x / 10); top = Math.min(top, stitch.y / 10);
    right = Math.max(right, stitch.x / 10); bottom = Math.max(bottom, stitch.y / 10);
  }
  const center = { x: Math.round((left + right) * 5) / 10, y: Math.round((top + bottom) * 5) / 10 };
  const widthMm = Math.ceil((2 * Math.max(center.x - left, right - center.x) - 1e-8) * 10) / 10;
  const heightMm = Math.ceil((2 * Math.max(center.y - top, bottom - center.y) - 1e-8) * 10) / 10;
  const raw = { ...source, stitches, layers, widthMm, heightMm };
  // Center the whole composition in the chosen hoop, keeping images' relative positions.
  const design = { ...raw,
    stitches: stitches.map(stitch => ({ ...stitch, x: stitch.x - Math.round(center.x * 10), y: stitch.y - Math.round(center.y * 10) })),
    layers: layers.map(layer => ({ ...layer, bounds: { ...layer.bounds, x: layer.bounds.x - center.x, y: layer.bounds.y - center.y } }))
  };
  return { raw, design, images, center };
}
