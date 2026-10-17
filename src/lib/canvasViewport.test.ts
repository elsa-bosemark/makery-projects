import { describe, expect, it } from 'vitest';
import { fitCanvasFrame, canvasRulerTicks } from './canvasViewport';

describe('Canvas edge rulers', () => {
  it.each([[900, 500], [320, 700], [480, 480]])('fills a %s × %s drawing area at a uniform physical scale', (w, h) => {
    const source = { x: -65, y: -90, width: 130, height: 180 };
    const view = fitCanvasFrame(source, w, h);
    expect(view.width / w).toBeCloseTo(view.height / h);
    expect(view.x + view.width / 2).toBeCloseTo(0);
    expect(view.y + view.height / 2).toBeCloseTo(0);
    expect(view.width).toBeGreaterThanOrEqual(source.width);
    expect(view.height).toBeGreaterThanOrEqual(source.height);
  });
  it('places signed coordinate labels at the actual projected needle positions', () => {
    const ticks = canvasRulerTicks(-100, 200, 800);
    expect(ticks.find(t => t.value === 0)?.pixel).toBe(400);
    expect(ticks.find(t => t.value === -100)?.pixel).toBe(0);
    expect(ticks.find(t => t.value === 100)?.pixel).toBe(800);
  });
  it('adapts label spacing without overcrowding narrow canvases or magnified layers', () => {
    for (const [start, extent, pixels] of [[-200, 400, 260], [-2, 4, 900], [-65, 130, 500]]) {
      const ticks = canvasRulerTicks(start, extent, pixels);
      expect(ticks.every(t => t.pixel >= 0 && t.pixel <= pixels)).toBe(true);
      for (let i = 1; i < ticks.length; i++) expect(ticks[i].pixel - ticks[i - 1].pixel).toBeGreaterThanOrEqual(49.99);
    }
  });
});
