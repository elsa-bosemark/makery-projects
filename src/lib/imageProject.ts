import type { Raster } from './embroidery';

export type ProjectImage = { id: string; name: string; raster: Raster };

export function cropImage(raster: Raster, removeWhite: boolean): Raster {
  const { width, height, data } = raster;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128 || (removeWhite && Math.min(data[i], data[i + 1], data[i + 2]) > 238)) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) return raster;
  const w = right - left + 1, h = bottom - top + 1, cropped = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) cropped.set(data.subarray(((top + y) * width + left) * 4, ((top + y) * width + right + 1) * 4), y * w * 4);
  return { width: w, height: h, data: cropped };
}

// Keep transparent gaps between images so each source keeps its own editable parts.
export function composeImages(images: ProjectImage[], removeWhite: boolean, sizes: Record<string, number> = {}): Raster {
  if (!images.length) return { width: 1, height: 1, data: new Uint8ClampedArray(4), sections: [] };
  const crops = images.map(image => cropImage(image.raster, removeWhite));
  if (images.length === 1) return { ...crops[0], sections: [{ id: images[0].id, name: images[0].name, x: 0, y: 0, width: crops[0].width, height: crops[0].height }] };
  const columns = Math.ceil(Math.sqrt(images.length)), rows = Math.ceil(images.length / columns);
  const cell = Math.min(240, Math.floor(1024 / columns)), gap = Math.max(4, Math.round(cell * .05));
  const expansion = Math.max(1,...images.map(image=>sizes[image.id] ?? 1));
  const layoutCell = Math.ceil(cell * expansion);
  const width = columns * layoutCell, height = rows * layoutCell, data = new Uint8ClampedArray(width * height * 4);
  const sections = images.map((image, index) => {
    const crop = crops[index], factor = (cell - gap * 2) / Math.max(crop.width, crop.height) * (sizes[image.id] ?? 1);
    const w = Math.max(1, Math.round(crop.width * factor)), h = Math.max(1, Math.round(crop.height * factor));
    const x = index % columns * layoutCell + Math.floor((layoutCell - w) / 2), y = Math.floor(index / columns) * layoutCell + Math.floor((layoutCell - h) / 2);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const source = (Math.min(crop.height - 1, Math.floor(dy / factor)) * crop.width + Math.min(crop.width - 1, Math.floor(dx / factor))) * 4;
      if (removeWhite && Math.min(crop.data[source], crop.data[source + 1], crop.data[source + 2]) > 238) continue;
      data.set(crop.data.subarray(source, source + 4), ((y + dy) * width + x + dx) * 4);
    }
    return { id: image.id, name: image.name, x, y, width: w, height: h };
  });
  return { width, height, data, sections };
}

/** Stretch the source before digitizing so row spacing and stitch limits remain physical. */
export function stretchRaster(raster: Raster, factor = 1): Raster {
  if (factor === 1) return raster;
  const height = Math.max(1, Math.min(1600, Math.round(raster.height * factor))), data = new Uint8ClampedArray(raster.width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(raster.height - 1, Math.floor(y * raster.height / height));
    data.set(raster.data.subarray(sourceY * raster.width * 4, (sourceY + 1) * raster.width * 4), y * raster.width * 4);
  }
  const scale = height / raster.height;
  return { ...raster, height, data, sections: raster.sections?.map(section => ({ ...section, y: Math.round(section.y * scale), height: Math.max(1,Math.round(section.height * scale)) })) };
}
