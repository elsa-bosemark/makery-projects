export type CanvasFrame = { x: number; y: number; width: number; height: number };

// Expand the world window to the drawing area's aspect ratio. Both axes retain
// the same millimeter scale, with no SVG letterboxing to misalign the rulers.
export function fitCanvasFrame(frame: CanvasFrame, widthPx: number, heightPx: number): CanvasFrame {
  const aspect = Math.max(1, widthPx) / Math.max(1, heightPx);
  const width = Math.max(frame.width, frame.height * aspect);
  const height = width / aspect;
  return { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height };
}

// Keep labels readable at any canvas size or inspection zoom.
export function canvasRulerTicks(start: number, extent: number, pixels: number) {
  const minimumStep = extent * 50 / Math.max(1, pixels);
  const power = 10 ** Math.floor(Math.log10(Math.max(.01, minimumStep)));
  const step = [1, 2, 5, 10].map(n => n * power).find(n => n >= minimumStep) ?? 10 * power;
  const first = Math.ceil(start / step), last = Math.floor((start + extent) / step);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => {
    const value = Number(((first + i) * step).toFixed(4));
    return { value, pixel: (value - start) / extent * pixels };
  });
}
