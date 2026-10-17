import exampleArtworks from '@/lib/exampleArtworks.json';
import { flattenSvgPath } from '@/lib/vtracer';
import { applyArtworkEdits, type ArtworkEdit } from '@/lib/artworkEdits';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, Eye, ImagePlus, RefreshCw, Scissors, Upload, Users, EyeOff, Layers, X, PanelLeftClose, PanelLeftOpen, ChevronDown, ArrowLeft, MousePointer2, Paintbrush, Eraser, PaintBucket, Copy, Settings2, Trash2, Folder, Undo2, Redo2, Lock, Unlock, Play, Pause } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { digitize, writePes, recolorThread, nearestPaletteSlot, estimateSewingTime, type Thread, type EmbroideryLayer, type LayerOptions, type LayerOverrides, type EmbroideryDesign, type Raster, type Settings } from '@/lib/embroidery';
import { HOOPS, fitsHoop, smallestFittingHoop, assertDesignFitsHoop, type Hoop } from '@/lib/hoops';
import { composeImages, stretchRaster } from '@/lib/imageProject';
import { positionImages, type ImageOffsets, type ImageBounds } from '@/lib/imageLayout';
import { shirtLayout, widthFromCornerDrag, rulerTicks, SHIRT_MIN_CM, SHIRT_MAX_CM } from '@/lib/previewSizing';
import { fitCanvasFrame, canvasRulerTicks } from '@/lib/canvasViewport';
import { STITCH_STYLES, styleInfo, patternedStyle, patternPaths } from '@/lib/stitchStyles';
import MakerySetup from '@/components/MakerySetup';
import { DETAIL_LEVELS, COVERAGE_PLANS, type ImageDetail, type StitchCoverage } from '@/lib/stitchPlanning';
import { loadVTracer } from '@/lib/vtracer';
import { stitchSvg } from '@/lib/stitchSvg';
import './MakeryStitch.css';
import './MakeryTypography.css';

type Artwork = { id: string; url: string; name: string; raster: Raster; example?: boolean };
type LayerGroup = { id: string; name: string; members: string[] };
type Placement = { x: number; y: number };
const defaults: Settings = { widthMm: 80, colors: 3, spacing: .4, removeWhite: true, underlay: true, imageColors: true, detail: 'balanced', coverage: 'solid' };
const shirtColors = [{ name: 'White', value: '#f8f7f3' }, { name: 'Charcoal', value: '#35363f' }, { name: 'Navy', value: '#243451' }, { name: 'Teal', value: '#4f8d86' }, { name: 'Pink', value: '#e9b8bc' }];

function ColorChoices({ label, value, choices, onChange }: { label: string; value: string; choices: { name: string; value: string }[]; onChange: (value: string) => void }) {
  const id = `ms-${label.toLowerCase().replace(/ /g, '-')}`;
  return <div className="ms-mock-color"><span id={`${id}-label`}>{label}</span><div className="ms-mock-swatches" role="group" aria-labelledby={`${id}-label`}>{choices.map(choice => <button key={choice.name} type="button" aria-label={`${label}: ${choice.name}`} aria-pressed={value === choice.value} title={choice.name} style={{ backgroundColor: choice.value }} onClick={() => onChange(choice.value)}>{value === choice.value && <Check size={13} color={['#35363f', '#243451', '#4d5160'].includes(value) ? '#fff' : '#292942'} />}</button>)}<label className="ms-custom-color" title={`Custom ${label.toLowerCase()}`}><input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={value} onChange={e => onChange(e.target.value)} /><span>+</span></label></div></div>;
}

function ShirtPreview({ surfaceHeightCm = 60, previewSurface = 'shirt', reservedWidth = 0, pan = { x: 0, y: 0 }, zoom = 1, readOnly = false, focusLayerId, hoop, design, widthMm, heightMm, shirtColor, shirtWidthCm, busy, placement, onPlacementChange, onShirtWidthChange, onDesignWidthChange, maxDesignWidth = 125 }: { surfaceHeightCm?:number; previewSurface?: 'shirt' | 'rectangle'; reservedWidth?: number; pan?: Placement; zoom?: number; readOnly?: boolean; focusLayerId?: string; hoop: Hoop; design: EmbroideryDesign | null; widthMm: number; heightMm: number; shirtColor: string; shirtWidthCm: number; busy: boolean; placement: Placement; onPlacementChange: (position: Placement) => void; onShirtWidthChange?: (width: number) => void; onDesignWidthChange?: (width: number) => void; maxDesignWidth?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const shirtSurfaceRef = useRef<HTMLDivElement>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 600, height: 600 });
  useEffect(() => {
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; setSurfaceSize({ width, height: Math.max(1, height - 46) }); });
    observer.observe(shirtSurfaceRef.current!); return () => observer.disconnect();
  }, []);
  const drag = useRef<{ pointerId: number; start: Placement; center: Placement } | null>(null);
  const [moving, setMoving] = useState(false);
  const [artworkSelected, setArtworkSelected] = useState(false);
  useEffect(() => {
    if (readOnly) return;
    const select = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !shirtSurfaceRef.current?.contains(target)) return;
      setArtworkSelected(!!target.closest('.ms-movable-hoop,.ms-resize-design'));
    };
    window.addEventListener('pointerdown', select, true);
    return () => window.removeEventListener('pointerdown', select, true);
  }, [readOnly]);
  // Fixed millimeter scale: growing the shirt does not shrink the embroidery.
  const layout = shirtLayout(shirtWidthCm);
  const { factor, scale, left, right } = layout;
  const bottom = previewSurface==='rectangle'?90+surfaceHeightCm*10*scale:layout.bottom;
  const centerY = previewSurface==='rectangle'?(90+bottom)/2:layout.centerY;
  const rulerX = previewSurface==='rectangle'?left-40:layout.rulerX;
  const previewLeft = Math.min(previewSurface==='rectangle'?left:450 - 405 * factor, rulerX - 45) - 20;
  const previewRight = (previewSurface==='rectangle'?right:450 + 405 * factor) + 20;
  const previewTop = 55, previewBottom = bottom + (readOnly ? 25 : 90);
  const previewWidth = previewRight - previewLeft, previewHeight = previewBottom - previewTop;
  const safeShirtWidth = Math.max(80, surfaceSize.width - reservedWidth);
  const shirtFrame = fitCanvasFrame({ x: previewLeft, y: previewTop, width: previewWidth, height: previewHeight }, safeShirtWidth, surfaceSize.height);
  const shirtViewport = { x: shirtFrame.x + shirtFrame.width * (1 - 1 / zoom) / 2 - pan.x, y: shirtFrame.y + shirtFrame.height * (1 - 1 / zoom) / 2 - pan.y, width: shirtFrame.width * surfaceSize.width / safeShirtWidth / zoom, height: shirtFrame.height / zoom };
  const canvasWidth = Math.max(130, design?.widthMm ?? widthMm), canvasHeight = Math.max(180, design?.heightMm ?? heightMm);
  const needleScale = scale * (design ? widthMm / design.widthMm : 1);
  const rectangleWidth = widthMm * scale, rectangleHeight = heightMm * scale;
  const hoopWidth = hoop.widthMm * scale, hoopHeight = hoop.heightMm * scale;
  const boundsWidth = Math.max(hoopWidth, rectangleWidth), boundsHeight = Math.max(hoopHeight, rectangleHeight);
  const constrain = (x: number, y: number) => ({ x: Math.max(left + boundsWidth / 2, Math.min(right - boundsWidth / 2, x)), y: Math.max(90 + (previewSurface==='rectangle'?0:100 * factor) + boundsHeight / 2, Math.min(bottom - 5 * factor - boundsHeight / 2, y)) });
  const { x: cx, y: cy } = constrain(450 + placement.x * scale, centerY + placement.y * scale);
  const moveTo = (x: number, y: number) => {
    const next = constrain(x, y);
    onPlacementChange({ x: (next.x - 450) / scale, y: (next.y - centerY) / scale });
  };
  const pointOnShirt = (event: PointerEvent<SVGGElement | SVGSVGElement>) => {
    const svg = svgRef.current, matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  };
  const startMove = (event: PointerEvent<SVGGElement>) => {
    if (event.button !== 0) return;
    const point = pointOnShirt(event); if (!point) return;
    event.preventDefault(); event.currentTarget.focus(); svgRef.current!.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, start: point, center: { x: cx, y: cy } }; setMoving(true);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    const point = pointOnShirt(event); if (point) moveTo(current.center.x + point.x - current.start.x, current.center.y + point.y - current.start.y);
  };
  const stopMove = () => { drag.current = null; resize.current = null; setMoving(false); setResizing(false); };
  const moveWithKeys = (event: KeyboardEvent<SVGGElement>) => {
    const directions: Record<string, Placement> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    if (event.key === 'Home') { event.preventDefault(); onPlacementChange({ x: 0, y: 0 }); return; }
    const direction = directions[event.key]; if (!direction) return;
    event.preventDefault(); const step = (event.shiftKey ? 1 : 5) * scale;
    moveTo(cx + direction.x * step, cy + direction.y * step);
  };
  const resize = useRef<{ kind: 'shirt' | 'design'; pointerId: number; start: Placement; width: number; corner: Placement; inverse: DOMMatrix } | null>(null);
  const [resizing, setResizing] = useState(false);
  const startResize = (event: PointerEvent<SVGGElement>, kind: 'shirt' | 'design') => {
    if (event.button !== 0 || readOnly || (kind === 'design' && (busy || !design))) return;
    const matrix = svgRef.current?.getScreenCTM(); if (!matrix) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); svgRef.current!.setPointerCapture(event.pointerId);
    const inverse = matrix.inverse(), p = svgRef.current!.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    resize.current = { kind, pointerId: event.pointerId, start: p.matrixTransform(inverse), width: kind === 'shirt' ? shirtWidthCm : widthMm,
      corner: kind === 'shirt' ? { x: right - 450, y: bottom - 90 } : { x: rectangleWidth / 2, y: rectangleHeight / 2 }, inverse };
    setResizing(true);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const r = resize.current;
    if (!r) { move(event); return; }
    if (r.pointerId !== event.pointerId) return;
    const p = svgRef.current!.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    const next = p.matrixTransform(r.inverse);
    const width = widthFromCornerDrag(r.width, next.x - r.start.x, next.y - r.start.y, r.corner,
      r.kind === 'shirt' ? SHIRT_MIN_CM : Math.min(10, maxDesignWidth), r.kind === 'shirt' ? SHIRT_MAX_CM : maxDesignWidth);
    if (r.kind === 'shirt') onShirtWidthChange?.(Math.round(width * 10) / 10);
    else onDesignWidthChange?.(Math.round(width * 10) / 10);
  };
  const resizeKeys = (event: KeyboardEvent<SVGGElement>, kind: 'shirt' | 'design') => {
    if (readOnly || (kind === 'design' && busy)) return;
    const direction = ['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowDown', 'ArrowLeft'].includes(event.key) ? -1 : 0;
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    if (kind === 'shirt') onShirtWidthChange?.(Math.max(SHIRT_MIN_CM, Math.min(SHIRT_MAX_CM, shirtWidthCm + direction * (event.shiftKey ? .1 : 1))));
    else onDesignWidthChange?.(Math.max(Math.min(10, maxDesignWidth), Math.min(maxDesignWidth, widthMm + direction * (event.shiftKey ? 1 : 5))));
  };
  const handle = (kind: 'shirt' | 'design', x: number, y: number) => <g className={`ms-preview-resize ms-resize-${kind}`} role="slider" tabIndex={0} aria-label={kind === 'shirt' ? 'Resize shirt' : 'Resize embroidery'} aria-valuemin={kind === 'shirt' ? SHIRT_MIN_CM : Math.min(10, maxDesignWidth)} aria-valuemax={kind === 'shirt' ? SHIRT_MAX_CM : maxDesignWidth} aria-valuenow={kind === 'shirt' ? shirtWidthCm : widthMm} aria-valuetext={kind === 'shirt' ? `${shirtWidthCm} centimeters wide` : `${widthMm} millimeters wide`} aria-describedby="ms-resize-help" onPointerDown={e => startResize(e, kind)} onKeyDown={e => resizeKeys(e, kind)}>
    <rect x={x - 30} y={y - 30} width="60" height="60" fill="transparent" />
    <circle cx={x} cy={y} r="12" fill="#fbf7ee" stroke="#8e1515" strokeWidth="2.5" />
    <path d={`M${x - 5} ${y + 5}L${x + 5} ${y - 5}M${x - 5} ${y}V${y + 5}H${x}M${x} ${y - 5}H${x + 5}V${y}`} fill="none" stroke="#8e1515" strokeWidth="2" />
    <title>{kind === 'shirt' ? 'Drag to resize the shirt' : 'Drag to resize the embroidery'}</title>
  </g>;
  return <div ref={shirtSurfaceRef} className={`ms-shirt-surface${readOnly ? ' ms-readonly-shirt' : ''}${artworkSelected ? ' ms-artwork-selected' : ''}${resizing ? ' ms-preview-resizing' : ''}`}>
    <svg ref={svgRef} className="ms-shirt-svg" viewBox={`${shirtViewport.x} ${shirtViewport.y} ${shirtViewport.width} ${shirtViewport.height}`} onPointerMove={readOnly ? undefined : onPointerMove} onPointerUp={readOnly ? undefined : stopMove} onPointerCancel={readOnly ? undefined : stopMove} onLostPointerCapture={readOnly ? undefined : stopMove} role="group" aria-label={previewSurface==='rectangle'?`Rectangle preview: ${shirtWidthCm} by ${surfaceHeightCm} centimeters`:`Shirt preview: ${hoop.widthMm} by ${hoop.heightMm} millimeter hoop on a shirt with ${shirtWidthCm} centimeter flat body width`}>
      <defs><filter id="ms-shirt-shadow" x="-20%" y="-20%" width="140%" height="145%"><feDropShadow dx="0" dy="12" stdDeviation="14" floodColor="#121528" floodOpacity=".13" /></filter><linearGradient id="ms-shirt-light" x1="0" x2="1" y1="0" y2=".2"><stop offset="0" stopColor="#000" stopOpacity=".06" /><stop offset=".3" stopColor="#fff" stopOpacity=".08" /><stop offset=".7" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".08" /></linearGradient><clipPath id="ms-shirt-clip"><path d="M335 90 220 135 45 300 165 400 205 345V790Q450 815 695 790V345L735 400 855 300 680 135 565 90Q450 175 335 90Z" /></clipPath></defs>
      {previewSurface === 'rectangle' ? <rect className="ms-fabric-rectangle" x={left} y={90} width={right-left} height={bottom-90} rx={4} fill={shirtColor} stroke="#20223430" strokeWidth={2}/> : <>      <g className="ms-shirt-body" transform={`translate(450 90) scale(${factor}) translate(-450 -90)`}><g filter="url(#ms-shirt-shadow)"><path d="M335 90 220 135 45 300 165 400 205 345V790Q450 815 695 790V345L735 400 855 300 680 135 565 90Q450 175 335 90Z" fill={shirtColor} stroke="#20223430" strokeWidth="2" /><path d="M335 90Q450 175 565 90L573 106Q450 197 327 106Z" fill="#00000013" /><g clipPath="url(#ms-shirt-clip)"><rect x="0" y="0" width="900" height="900" fill="url(#ms-shirt-light)" /></g><path d="m66 311 102 72M733 383 834 311M213 776Q450 800 687 776M220 135Q185 235 205 345M680 135Q715 235 695 345" stroke="#20223420" strokeWidth="2" fill="none" /></g></g></>}

      <g className={`ms-movable-hoop${moving ? ' ms-hoop-moving' : ''}`} role={readOnly ? undefined : 'button'} tabIndex={readOnly ? undefined : 0} aria-label={readOnly ? undefined : 'Move embroidery hoop'} aria-describedby={readOnly ? undefined : 'ms-placement-help'} onPointerDown={readOnly ? undefined : startMove} onKeyDown={readOnly ? undefined : moveWithKeys}>
      <rect className="ms-hoop-hit-area" x={cx - boundsWidth / 2 - 12} y={cy - boundsHeight / 2 - 38} width={boundsWidth + 55} height={boundsHeight + 58} fill="transparent" />
      {design && <foreignObject className="ms-placed-stitches" x={cx - canvasWidth / 2 * needleScale} y={cy - canvasHeight / 2 * needleScale} width={canvasWidth * needleScale} height={canvasHeight * needleScale}><div className="ms-shirt-stitches"><StitchPreview frame={{ x: -canvasWidth / 2, y: -canvasHeight / 2, width: canvasWidth, height: canvasHeight }} design={design} progress={100} paths={false} focusLayerId={focusLayerId} /></div></foreignObject>}
      <rect className="ms-hoop-halo" x={cx - hoopWidth / 2} y={cy - hoopHeight / 2} width={hoopWidth} height={hoopHeight} rx={Math.min(18, hoop.heightMm / 3) * scale} fill="none" stroke="#fbf7ee" strokeWidth="6" />
      <rect className="ms-shirt-hoop-boundary" data-width-mm={hoop.widthMm} data-height-mm={hoop.heightMm} x={cx - hoopWidth / 2} y={cy - hoopHeight / 2} width={hoopWidth} height={hoopHeight} rx={Math.min(18, hoop.heightMm / 3) * scale} fill="none" stroke="#6b5e52" strokeWidth="2.5" />
      <g className="ms-hoop-measurements" fill="#201b18" fontSize="20" textAnchor="middle"><rect x={cx - 54} y={cy - hoopHeight / 2 - 36} width="108" height="27" rx="3" fill="#fbf7ee" /><text x={cx} y={cy - hoopHeight / 2 - 15}>{hoop.widthMm} mm</text><g transform={`translate(${cx + hoopWidth / 2 + 23},${cy}) rotate(90)`}><rect x="-54" y="-19" width="108" height="27" rx="3" fill="#fbf7ee" /><text y="2">{hoop.heightMm} mm</text></g></g>
      <rect className="ms-design-boundary-halo" x={cx - rectangleWidth / 2} y={cy - rectangleHeight / 2} width={rectangleWidth} height={rectangleHeight} rx="2" fill="none" stroke="#fbf7ee" strokeWidth="4" strokeDasharray="7 5" />
      <rect className="ms-design-boundary" data-width-mm={widthMm} data-height-mm={heightMm.toFixed(1)} x={cx - rectangleWidth / 2} y={cy - rectangleHeight / 2} width={rectangleWidth} height={rectangleHeight} rx="2" fill="#8e151509" stroke="#8e1515" strokeWidth="2" strokeDasharray="7 5" />
      </g>
      {!readOnly && <g className="ms-shirt-rulers" aria-label="Shirt rulers in centimeters" pointerEvents="none">
        <path d={`M${left} ${bottom + 40}H${right}M${rulerX} 90V${bottom}`} fill="none" stroke="#9b8b7c" strokeWidth="1.2" />
        {rulerTicks(0, shirtWidthCm, 1).map(cm => <g key={`w${cm}`}><path d={`M${left + cm * 10 * scale} ${bottom + 40}v${cm % 10 === 0 ? 12 : cm % 5 === 0 ? 8 : 4}`} stroke="#9b8b7c" strokeWidth="1.2" />{cm % 10 === 0 && <text x={left + cm * 10 * scale} y={bottom + 72} textAnchor="middle">{cm}</text>}</g>)}
        {rulerTicks(0, (bottom - 90) / scale / 10, 1).map(cm => <g key={`h${cm}`}><path d={`M${rulerX} ${90 + cm * 10 * scale}h${cm % 10 === 0 ? -12 : cm % 5 === 0 ? -8 : -4}`} stroke="#9b8b7c" strokeWidth="1.2" />{cm % 10 === 0 && <text x={rulerX - 18} y={90 + cm * 10 * scale + 5} textAnchor="end">{cm}</text>}</g>)}
        <text x={rulerX - 10} y="76">cm</text>
        <rect x="335" y={bottom + 20} width="230" height="29" rx="14" fill="#fbf7ee" /><text x="450" y={bottom + 40} textAnchor="middle">{previewSurface==='rectangle'?'Rectangle width':'Shirt width'} · {shirtWidthCm} cm</text>
      </g>}
      {!readOnly && previewSurface==='shirt' && handle('shirt', right, bottom)}
      {!readOnly && artworkSelected && design && handle('design', cx + rectangleWidth / 2, cy + rectangleHeight / 2)}
    </svg>{busy && <div className="ms-shirt-updating">Updating stitches…</div>}
  </div>;
}

function exampleArtwork(kind: 'bloom' | 'leaves' | 'sun' | 'heart' = 'bloom'): Artwork {
  const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 340;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 300, 340);
  if (kind === 'bloom') {
  ctx.strokeStyle = '#008777'; ctx.lineWidth = 15; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(151, 167); ctx.bezierCurveTo(140, 222, 169, 261, 152, 300); ctx.stroke();
  ctx.fillStyle = '#008777';
  ctx.beginPath(); ctx.ellipse(119, 242, 32, 13, .55, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(184, 267, 29, 12, -.65, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fe9e32';
  for (let i = 0; i < 6; i++) { const angle = i * Math.PI / 3; ctx.beginPath(); ctx.ellipse(150 + Math.cos(angle) * 47, 125 + Math.sin(angle) * 47, 32, 28, angle, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#4e2990'; ctx.beginPath(); ctx.arc(150, 125, 31, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'leaves') {
    ctx.strokeStyle = '#008777'; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(150, 290); ctx.quadraticCurveTo(132, 185, 157, 55); ctx.stroke();
    for (const [x, y, angle, color] of [[118, 236, .65, '#008777'], [177, 201, -.6, '#4f8d86'], [125, 160, .65, '#4f8d86'], [178, 116, -.65, '#008777']] as const) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, 42, 18, angle, 0, Math.PI * 2); ctx.fill();
    }
  } else if (kind === 'sun') {
    ctx.strokeStyle = '#fe9e32'; ctx.lineWidth = 13; ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const angle = i * Math.PI / 6; ctx.beginPath(); ctx.moveTo(150 + Math.cos(angle) * 81, 170 + Math.sin(angle) * 81); ctx.lineTo(150 + Math.cos(angle) * 111, 170 + Math.sin(angle) * 111); ctx.stroke(); }
    ctx.fillStyle = '#fe9e32'; ctx.beginPath(); ctx.arc(150, 170, 64, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8e1515'; for (const x of [132, 168]) { ctx.beginPath(); ctx.arc(x, 160, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#8e1515'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(150, 177, 22, .2, Math.PI - .2); ctx.stroke();
  } else {
    ctx.fillStyle = '#8e1515'; ctx.beginPath(); ctx.moveTo(150, 269); ctx.bezierCurveTo(119, 237, 53, 188, 53, 132); ctx.bezierCurveTo(53, 74, 119, 58, 150, 110); ctx.bezierCurveTo(181, 58, 247, 74, 247, 132); ctx.bezierCurveTo(247, 188, 181, 237, 150, 269); ctx.fill();
    ctx.strokeStyle = '#e9b8bc'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(88, 139); ctx.quadraticCurveTo(82, 102, 115, 104); ctx.stroke();
  }
  const name = { bloom: 'Bloom', leaves: 'Botanical', sun: 'Sunny', heart: 'Heart' }[kind];
  return { id: `example-${kind}`, url: canvas.toDataURL('image/png'), name: `${name}.png`, raster: ctx.getImageData(0, 0, 300, 340), example: true };
}

async function loadArtwork(file: File): Promise<Artwork> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG, or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('This image is very large. Resize it and try again.');
    const factor = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * factor)); canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { id: crypto.randomUUID(), url, name: file.name, raster: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

function StitchPreview({ design, progress, paths, focusLayerId, frame = { x: -65, y: -90, width: 130, height: 180 } }: { design: EmbroideryDesign; progress: number; paths: boolean; focusLayerId?: string; frame?: { x: number; y: number; width: number; height: number } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current!; const ctx = canvas.getContext('2d')!;
    const scale = Math.min(32, 1200 / Math.max(frame.width, frame.height));
    canvas.width = Math.ceil(frame.width * scale); canvas.height = Math.ceil(frame.height * scale); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = -frame.x * scale, cy = -frame.y * scale;
    let previous: typeof design.stitches[number] | undefined;
    const limit = Math.ceil(design.stitches.length * progress / 100);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < limit; i++) {
      const stitch = design.stitches[i];
      if (focusLayerId && stitch.layerId !== focusLayerId) { previous = stitch; continue; }
      if (previous && stitch.command === 'stitch' && previous.color === stitch.color) {
        const outline = stitch.kind === 'outline';
        ctx.strokeStyle = outline ? '#201b1870' : '#201b1824'; ctx.lineWidth = scale * (outline ? .6 : .36);
        ctx.beginPath(); ctx.moveTo(cx + previous.x * scale / 10, cy + previous.y * scale / 10); ctx.lineTo(cx + stitch.x * scale / 10, cy + stitch.y * scale / 10); ctx.stroke();
        ctx.strokeStyle = design.threads[stitch.color].hex; ctx.lineWidth = scale * (outline ? .42 : .32); ctx.stroke();
        if (!outline && !paths && Math.hypot(stitch.x - previous.x, stitch.y - previous.y) > 4) {
          // A short glint follows each actual stitch; it doesn't paint over empty fabric.
          ctx.strokeStyle = '#ffffff2b'; ctx.lineWidth = .3;
          ctx.beginPath(); ctx.moveTo(cx + (previous.x * .85 + stitch.x * .15) * scale / 10, cy + (previous.y * .85 + stitch.y * .15) * scale / 10);
          ctx.lineTo(cx + (previous.x * .2 + stitch.x * .8) * scale / 10, cy + (previous.y * .2 + stitch.y * .8) * scale / 10); ctx.stroke();
        }
      }
      if (paths && previous && stitch.command === 'jump') {
        ctx.strokeStyle = '#d7868baa'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(cx + previous.x * scale / 10, cy + previous.y * scale / 10); ctx.lineTo(cx + stitch.x * scale / 10, cy + stitch.y * scale / 10); ctx.stroke(); ctx.setLineDash([]);
      }
      previous = stitch;
    }
  }, [design, progress, paths, focusLayerId, frame.x, frame.y, frame.width, frame.height]);
  return <canvas ref={canvasRef} className="ms-stitch-canvas" aria-label={`Stitch preview: ${design.stitchCount.toLocaleString()} stitches, ${design.threads.length} thread colors`} />;
}

function StitchRulers({ frame, width, height }: { frame: { x: number; y: number; width: number; height: number }; width: number; height: number }) {
  const w = Math.max(1, width - 32), h = Math.max(1, height - 52);
  return <svg className="ms-canvas-edge-rulers" viewBox={`0 0 ${width} ${height}`} aria-label="Canvas edge rulers in millimeters" pointerEvents="none">
    <path d={`M32 28H${width}M32 28V${height - 24}`} fill="none" stroke="#b8a58c" />
    {canvasRulerTicks(frame.x, frame.width, w).map(tick => <g key={`x${tick.value}`}><path d={`M${32 + tick.pixel} 22v6`} stroke="#9b8b7c" />{tick.pixel > 14 && tick.pixel < w - 14 && <text x={32 + tick.pixel} y="16" textAnchor="middle">{tick.value}</text>}</g>)}
    {canvasRulerTicks(frame.y, frame.height, h).map(tick => <g key={`y${tick.value}`}><path d={`M26 ${28 + tick.pixel}h6`} stroke="#9b8b7c" />{tick.pixel > 14 && tick.pixel < h - 14 && <text transform={`translate(17 ${28 + tick.pixel}) rotate(-90)`} textAnchor="middle">{tick.value}</text>}</g>)}
    <text x="14" y="16" textAnchor="middle">mm</text>
  </svg>;
}

function StitchesSurface({ selectedSvgLayer, paint, onPaint, cuttingLayer, onCut, onCancelCut, selectedImages, onDeleteImage, reservedWidth = 0, pan = { x: 0, y: 0 }, zoom = 1, solid = false, widthMm, heightMm, maxWidthMm, pendingScale, center, onWidthChange, focusLayerId, design, imageBounds, selectedImage, offsets, onSelectImage, onMoveImage, busy, error, progress, paths }: { selectedSvgLayer?: string; paint?: {allImages?:boolean;imageId:string;tool:'paint'|'erase'|'bucket';color:string;radius:number}; onPaint:(edit:ArtworkEdit)=>void; cuttingLayer?: string; onCut: (id:string,a:Placement,b:Placement)=>void; onCancelCut:()=>void; selectedImages: string[]; onDeleteImage: (id: string) => void; reservedWidth?: number; pan?: Placement; zoom?: number; solid?: boolean; widthMm: number; heightMm: number; maxWidthMm: number; pendingScale: number; center: Placement; onWidthChange: (width: number) => void; design: EmbroideryDesign | null; imageBounds: ImageBounds[]; selectedImage?: string; offsets: ImageOffsets; onSelectImage: (id: string, multiple?: boolean) => void; onMoveImage: (id: string, offset: Placement) => void; busy: boolean; error: string; progress: number; paths: boolean; focusLayerId?: string }) {
  const paintPoints=useRef<Placement[]>([]);
  const [paintPreview,setPaintPreview]=useState<Placement[]>([]);
  const [cutLine,setCutLine] = useState<{a:Placement;b:Placement}>();
  const cutStart = useRef<Placement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const resize = useRef<{ pointer: number; start: Placement; width: number; corner: Placement; inverse: DOMMatrix } | null>(null);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    const surface = surfaceRef.current!;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ width: Math.max(1, width), height: Math.max(1, height) });
    });
    observer.observe(surface); return () => observer.disconnect();
  }, []);
  const drag = useRef<{ id: string; pointer: number; start: Placement; offset: Placement; inverse: DOMMatrix } | null>(null);
  const [moving, setMoving] = useState(false);
  const fittedProject = useRef<string>();
  const [frame, setFrame] = useState({ x: -65, y: -90, width: 130, height: 180 });
  useEffect(() => {
    if (moving || resizing || busy || !design) return;
    const projectKey = `${focusLayerId ?? 'whole'}:${imageBounds.map(bounds => bounds.id).join(',')}`;
    if (fittedProject.current === projectKey) return;
    const focused = focusLayerId ? design.layers.find(layer => layer.id === focusLayerId)?.bounds : undefined;
    const bounds = focused ? [focused] : imageBounds;
    if (!bounds.length) return;
    const left = Math.min(...bounds.map(b => b.x)), top = Math.min(...bounds.map(b => b.y));
    const right = Math.max(...bounds.map(b => b.x + b.width)), bottom = Math.max(...bounds.map(b => b.y + b.height));
    fittedProject.current = projectKey;
    const padding = Math.max(2, Math.max(right - left, bottom - top) * .055);
    const next = { x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2 };
    setFrame(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
  }, [imageBounds, moving, resizing, busy, focusLayerId, design]);
  const drawingWidth = Math.max(1, size.width - (solid ? 0 : 32));
  const availableWidth = Math.max(80, drawingWidth - reservedWidth);
  const fitted = fitCanvasFrame(frame, availableWidth, size.height - (solid ? 0 : 46));
  const viewport = { x: fitted.x + fitted.width * (1 - 1 / zoom) / 2 - pan.x, y: fitted.y + fitted.height * (1 - 1 / zoom) / 2 - pan.y, width: fitted.width * drawingWidth / availableWidth / zoom, height: fitted.height / zoom };
  const mmPerPixel = viewport.width / Math.max(1, size.width - 32);
  const liveDesign = useMemo(() => design && pendingScale !== 1 ? { ...design, stitches: design.stitches.map(stitch => ({ ...stitch, x: stitch.x * pendingScale, y: stitch.y * pendingScale })) } : design, [design, pendingScale]);
  const liveBounds = imageBounds.map(bounds => ({ ...bounds, x: bounds.x * pendingScale, y: bounds.y * pendingScale, width: bounds.width * pendingScale, height: bounds.height * pendingScale }));
  const liveCenter = { x: center.x * pendingScale, y: center.y * pendingScale };
  const point = (event: PointerEvent<SVGGElement | SVGSVGElement>, inverse: DOMMatrix) => {
    const p = svgRef.current!.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; return p.matrixTransform(inverse);
  };
  const stop = () => { drag.current = null; resize.current = null; setMoving(false); setResizing(false); };
  const startResize = (event: PointerEvent<SVGGElement>) => {
    if (event.button !== 0 || !design) return;
    const matrix = svgRef.current?.getScreenCTM(); if (!matrix) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
    const inverse = matrix.inverse();
    resize.current = { pointer: event.pointerId, start: point(event, inverse), width: widthMm, corner: { x: widthMm / 2, y: heightMm / 2 }, inverse };
    svgRef.current!.setPointerCapture(event.pointerId); setResizing(true);
  };
  const resizeKeys = (event: KeyboardEvent<SVGGElement>) => {
    const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
    if (!direction) return;
    event.preventDefault(); onWidthChange(Math.max(10, Math.min(maxWidthMm, widthMm + direction * (event.shiftKey ? 1 : 5))));
  };
  const start = (event: PointerEvent<SVGGElement>, id: string) => {
    if (event.button !== 0 || busy || focusLayerId || !design) return;
    const matrix = svgRef.current?.getScreenCTM(); if (!matrix) return;
    event.preventDefault(); event.currentTarget.focus(); svgRef.current!.setPointerCapture(event.pointerId);
    const inverse = matrix.inverse();
    drag.current = { id, pointer: event.pointerId, start: point(event, inverse), offset: offsets[id] ?? { x: 0, y: 0 }, inverse };
    onSelectImage(id,event.shiftKey || event.metaKey || event.ctrlKey); setMoving(true);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const r = resize.current;
    if (r && r.pointer === event.pointerId) {
      const p = point(event, r.inverse);
      onWidthChange(widthFromCornerDrag(r.width, p.x - r.start.x, p.y - r.start.y, r.corner, 10, maxWidthMm)); return;
    }
    const d = drag.current; if (!d || d.pointer !== event.pointerId || !design) return;
    const p = point(event, d.inverse);
    onMoveImage(d.id, { x: d.offset.x + (p.x - d.start.x) / design.widthMm, y: d.offset.y + (p.y - d.start.y) / design.widthMm });
  };
  const keys = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); onDeleteImage(id); return; }
    if (busy || focusLayerId || !design) return;
    const directions: Record<string, Placement> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    if (event.key === 'Home') { event.preventDefault(); onMoveImage(id, { x: 0, y: 0 }); return; }
    const direction = directions[event.key]; if (!direction) return;
    event.preventDefault(); onSelectImage(id); const offset = offsets[id] ?? { x: 0, y: 0 }, step = (event.shiftKey ? 1 : 5) / design.widthMm;
    onMoveImage(id, { x: offset.x + direction.x * step, y: offset.y + direction.y * step });
  };
  return <div ref={surfaceRef} className={`ms-hoop-surface ms-stitches-surface${solid ? ' ms-solid-svg-surface' : ''}${resizing ? ' is-resizing' : ''}`} aria-label={solid ? "SVG artwork on checkered canvas" : "Stitches on dotted canvas"}>
    {design ? <div className="ms-stitch-drawing-area"><svg ref={svgRef} className="ms-hoop-svg ms-stitches-svg" viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} aria-label={solid ? "SVG artwork" : "Embroidery stitches"} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
      {solid ? <g pointerEvents="none">{design.layers.filter(layer=>layer.visible).slice().reverse().map(layer=>{
        const [x,y,w,h]=layer.previewBox.split(/\s+/).map(Number), sx=layer.bounds.width/w*pendingScale, sy=layer.bounds.height/h*pendingScale;
        return <path key={layer.id} opacity={selectedSvgLayer && layer.id!==selectedSvgLayer ? .2 : 1} d={layer.svgGeometry === 'centerline' ? layer.centerlinePath || layer.previewPath : layer.previewPath} fill={layer.svgGeometry && layer.svgGeometry !== 'shape' ? 'none' : layer.color} stroke={layer.svgGeometry && layer.svgGeometry !== 'shape' ? layer.color : undefined} strokeWidth={.35/Math.max(sx,sy)} strokeLinecap="round" strokeLinejoin="round" fillRule="evenodd" transform={`matrix(${sx} 0 0 ${sy} ${layer.bounds.x*pendingScale-x*sx} ${layer.bounds.y*pendingScale-y*sy})`}/>;
      })}</g> : <foreignObject x={viewport.x} y={viewport.y} width={viewport.width} height={viewport.height} pointerEvents="none"><div className="ms-shirt-stitches"><StitchPreview frame={viewport} design={liveDesign!} progress={progress} paths={paths} focusLayerId={focusLayerId} /></div></foreignObject>}

      {paint && <g>
        <rect data-cut-tool="true" x={viewport.x} y={viewport.y} width={viewport.width} height={viewport.height} fill="transparent" style={{cursor:'crosshair'}} onPointerDown={event=>{event.stopPropagation();const matrix=svgRef.current?.getScreenCTM()?.inverse();if(!matrix)return;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix);paintPoints.current=[{x:p.x,y:p.y}];setPaintPreview(paintPoints.current);event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(!paintPoints.current.length||paint.tool==='bucket')return;const matrix=svgRef.current?.getScreenCTM()?.inverse();if(!matrix)return;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix);paintPoints.current=[...paintPoints.current,{x:p.x,y:p.y}];setPaintPreview(paintPoints.current);}} onPointerUp={event=>{event.stopPropagation();const image=liveBounds.find(image=>image.id===paint.imageId),points=paintPoints.current;paintPoints.current=[];setPaintPreview([]);if(!image||!points.length)return;for(const target of paint.allImages?liveBounds:[image])onPaint({...paint,imageId:target.id,points:points.map(p=>({x:(p.x-target.x)/target.width,y:(p.y-target.y)/target.height}))});}} onPointerCancel={()=>{paintPoints.current=[];setPaintPreview([]);}}/>
        {paintPreview.length>0 && paint.tool!=='bucket' && <polyline points={paintPreview.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={paint.tool==='erase'?'#fbf7ee':paint.color} opacity={.7} strokeWidth={2*paint.radius*Math.min(liveBounds.find(i=>i.id===paint.imageId)?.width??10,liveBounds.find(i=>i.id===paint.imageId)?.height??10)} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none"/>}
      </g>}
      {cuttingLayer && <g>
        <rect x={viewport.x} y={viewport.y} width={viewport.width} height={viewport.height} fill="transparent" data-cut-tool="true" style={{cursor:'crosshair'}} onPointerDown={event=>{event.stopPropagation();const svg=svgRef.current!;const matrix=svg.getScreenCTM()?.inverse();if(!matrix)return;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix);cutStart.current={x:p.x,y:p.y};setCutLine({a:cutStart.current,b:cutStart.current});event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(!cutStart.current)return;event.stopPropagation();const matrix=svgRef.current?.getScreenCTM()?.inverse();if(!matrix)return;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix);setCutLine({a:cutStart.current,b:{x:p.x,y:p.y}});}} onPointerUp={event=>{event.stopPropagation();const a=cutStart.current;cutStart.current=undefined;setCutLine(undefined);const matrix=svgRef.current?.getScreenCTM()?.inverse();const layer=design.layers.find(layer=>layer.id===cuttingLayer);if(!a||!matrix||!layer)return;const b=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix);const normalize=(p:Placement)=>({x:(p.x/pendingScale-layer.bounds.x)/layer.bounds.width,y:(p.y/pendingScale-layer.bounds.y)/layer.bounds.height});if(Math.hypot(b.x-a.x,b.y-a.y)>1)onCut(cuttingLayer,normalize(a),normalize(b));}} onPointerCancel={()=>{cutStart.current=undefined;setCutLine(undefined);}}/>
        {cutLine && <line x1={cutLine.a.x} y1={cutLine.a.y} x2={cutLine.b.x} y2={cutLine.b.y} stroke="#8e1515" strokeWidth={2} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
      </g>}
      {!paint && !focusLayerId && [...liveBounds].sort((a, b) => Number(a.id === selectedImage) - Number(b.id === selectedImage)).map(image => <g key={image.id} className={`ms-movable-image${selectedImages.includes(image.id) ? ' is-selected' : ''}${moving && selectedImage === image.id ? ' is-moving' : ''}`} role="button" tabIndex={busy ? -1 : 0} aria-label={`Move ${image.name}`} aria-pressed={selectedImages.includes(image.id)} data-image-id={image.id} onPointerDown={e => start(e, image.id)} onKeyDown={e => keys(e, image.id)}>
        <rect x={image.x - 1.5} y={image.y - 1.5} width={image.width + 3} height={image.height + 3} fill="transparent" strokeWidth="1" vectorEffect="non-scaling-stroke" rx="1" />
      </g>)}
      {!paint && !solid && !focusLayerId && <g className="ms-canvas-design-size">
        <rect pointerEvents="none" x={liveCenter.x - widthMm / 2} y={liveCenter.y - heightMm / 2} width={widthMm} height={heightMm} fill="none" stroke="#8e151570" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <g transform={`translate(${liveCenter.x + widthMm / 2} ${liveCenter.y + heightMm / 2})`} className="ms-preview-resize" role="slider" tabIndex={0} aria-label="Resize embroidery on canvas" aria-valuemin={10} aria-valuemax={maxWidthMm} aria-valuenow={Math.round(widthMm * 10) / 10} aria-valuetext={`${widthMm} by ${Math.round(heightMm)} millimeters`} onPointerDown={startResize} onKeyDown={resizeKeys}>
          <circle r={20 * mmPerPixel} fill="transparent" /><circle r={7 * mmPerPixel} fill="#fbf7ee" stroke="#8e1515" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d={`M${-3 * mmPerPixel} ${3 * mmPerPixel}L${3 * mmPerPixel} ${-3 * mmPerPixel}`} fill="none" stroke="#8e1515" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </g>
      </g>}
    </svg></div> : <div className="ms-empty"><Scissors size={28} /><p>{error || (busy ? 'Creating stitches…' : 'Upload images to start your project.')}</p></div>}
    {design && !solid && <StitchRulers frame={viewport} width={size.width} height={size.height} />}

    {cuttingLayer && <div className="ms-cut-instructions">Drag across the shape to split it <button onClick={onCancelCut}>Cancel</button></div>}
    {busy && design && <div className="ms-shirt-updating">Updating stitches…</div>}
  </div>;
}

function StitchStyleSwatch({ centerline = false, style, color, accent }: { centerline?: boolean; style: LayerOptions['stitchType']; color: string; accent?: string }) {
  const paths = useMemo(() => {
    if (style === 'running' || style === 'bean') return [centerline ? 'M3 18Q16 0 29 18' : 'M3 3H29V21H3Z'];
    if (style === 'fill') return Array.from({ length: 9 }, (_, i) => `M2 ${2 + i * 2.5}H30`);
    if (style === 'satin') return ['M2 2L30 4L2 6L30 8L2 10L30 12L2 14L30 16L2 18L30 20L2 22'];
    return patternPaths(style!, { x: 0, y: 0, width: 32, height: 24 }, 6, false, [[{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 24 }, { x: 0, y: 24 }, { x: 0, y: 0 }]]).map(path => path.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(''));
  }, [style, centerline]);
  return <svg viewBox="0 0 32 24" aria-hidden="true">{paths.map((path, index) => <path key={index} d={path} fill="none" stroke={accent && index % 2 ? accent : color} strokeWidth={style === 'bean' ? 1.8 : 1} />)}</svg>;
}

function DimensionControls({ width, height, locked, onLock, onWidth, onHeight }: { width: number; height: number; locked: boolean; onLock: () => void; onWidth: (value: number) => void; onHeight: (value: number) => void }) {
  const [w, setW] = useState(String(width)), [h, setH] = useState(String(Math.round(height*10)/10));
  useEffect(()=>setW(String(width)),[width]); useEffect(()=>setH(String(Math.round(height*10)/10)),[height]);
  const commit = (value: string, change: (value:number)=>void) => { const number=Number(value); if(Number.isFinite(number) && number>0)change(number); };
  return <div className="ms-dimensions"><label>Width (mm)<input type="number" aria-label="Embroidery width" min={10} max={125} step={.1} value={w} onChange={e=>setW(e.target.value)} onBlur={()=>commit(w,onWidth)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label><button aria-label={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'} aria-pressed={locked} onClick={onLock}>{locked ? <Lock size={16}/> : <Unlock size={16}/>}</button><label>Height (mm)<input type="number" aria-label="Embroidery height" min={1} max={175} step={.1} value={h} onChange={e=>setH(e.target.value)} onBlur={()=>commit(h,onHeight)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label></div>;
}

function PaletteControls({ hidden, onToggleColor, onMergeColor, count, palette, onCountChange, onColorChange }: { onMergeColor: (from: number, to: number) => void; hidden: number[]; onToggleColor: (slot: number) => void; count: number; palette: Thread[]; onCountChange: (count: number) => void; onColorChange: (slot: number, color: string) => void }) {
  const [activeSlot, setActiveSlot] = useState<number>();
  return <section className="ms-palette-controls" aria-label="Color controls"><div className="ms-control-label"><span>Colors</span><span>{count}</span></div><div className="ms-color-slider"><Slider aria-label="Number of colors" min={1} max={10} step={1} value={[count]} onValueChange={([value]) => onCountChange(value)}/><div className="ms-track-ticks" aria-hidden="true">{Array.from({length:10},(_,index)=><i key={index} className={index+1 <= count ? 'is-filled' : ''}/>)}</div></div><div className="ms-color-range ms-color-labels" aria-hidden="true"><span>1</span><span>5</span><span>10</span></div><div className="ms-color-swatches" role="group" aria-label="Palette colors">{palette.map((thread, slot) => <div key={slot} className={`ms-color-option${hidden.includes(slot) ? ' is-hidden' : ''}`}><button type="button" className="ms-color-swatch-button" aria-label={`Change color ${slot+1}`} aria-expanded={activeSlot===slot} onClick={()=>setActiveSlot(previous=>previous===slot ? undefined : slot)}><span style={{background:thread.hex}}/><small>{slot+1}</small></button><button type="button" aria-label={`${hidden.includes(slot) ? 'Show' : 'Hide'} color ${slot + 1}`} aria-pressed={!hidden.includes(slot)} onClick={() => onToggleColor(slot)}>{hidden.includes(slot) ? <EyeOff size={14}/> : <Eye size={14}/>}</button></div>)}</div>{activeSlot != null && palette[activeSlot] && <div className="ms-color-assign" aria-label={`Change color ${activeSlot+1}`}><div className="ms-color-assign-heading"><strong>Move color {activeSlot+1} to</strong><button aria-label="Close color choices" onClick={()=>setActiveSlot(undefined)}><X size={14}/></button></div><div className="ms-color-swatches">{palette.map((color,slot)=>slot===activeSlot ? null : <button key={slot} className="ms-color-swatch-button" aria-label={`Move color ${activeSlot+1} to color ${slot+1}`} onClick={()=>{onMergeColor(activeSlot,slot);setActiveSlot(undefined);}}><span style={{background:color.hex}}/><small>{slot+1}</small></button>)}</div><label className="ms-color-custom">Custom color<input type="color" aria-label={`Edit color ${activeSlot+1}`} value={palette[activeSlot].hex} onChange={event=>onColorChange(activeSlot,event.target.value)}/></label>{count<10 && <button className="ms-color-add" onClick={()=>{onCountChange(count+1);setActiveSlot(undefined);}}>+ Add color</button>}</div>}</section>;
}

function LayerStitchChoices({ layer, palette, onChange }: { layer: EmbroideryLayer; palette: Thread[]; onChange: (edit: LayerOptions) => void }) {
  const common = layer.centerline ? ['satin','running'] : ['fill', 'satin', 'running'];
  const choice = (style: typeof STITCH_STYLES[number]) => <button key={style.id} type="button" aria-label={`Use ${style.label} for ${layer.name}`} aria-pressed={layer.stitchType === style.id} onClick={() => onChange({ stitchType: style.id, centerline: !!layer.centerline, stitchLength: undefined })}><StitchStyleSwatch centerline={!!layer.centerline} style={style.id} color={layer.color} accent={layer.accentSlot == null ? undefined : palette[layer.accentSlot]?.hex} /><span>{layer.centerline && style.id === 'satin' ? 'Satin stroke' : layer.centerline && style.id === 'running' ? 'Running stitch' : style.label}</span></button>;
  return <div className="ms-layer-stitch-choices"><span className="ms-layer-field-title">Stitch style</span><div className="ms-style-grid" role="group" aria-label={`Stitch styles for ${layer.name}`}>{STITCH_STYLES.filter(style => common.includes(style.id)).map(choice)}</div>
    {layer.stitchType === 'fill' || layer.stitchType === 'satin' ? <div className="ms-layer-open-pattern"><div className="ms-control-label"><label htmlFor="ms-layer-density">{layer.stitchType === 'satin' ? 'Satin spacing (same side)' : 'Row spacing'}</label><span>{layer.spacing.toFixed(2)} mm</span></div><Slider id="ms-layer-density" aria-label="Layer row spacing" min={.3} max={1.2} step={.05} value={[layer.spacing]} onValueChange={([spacing]) => onChange({ spacing })} />{!layer.centerline && <div className="ms-switch-row"><label htmlFor="ms-fill-outline">Add outline</label><Switch id="ms-fill-outline" checked={layer.outline ?? false} onCheckedChange={outline => onChange({ outline })} /></div>}</div> : null}
  </div>;
}

function ProjectLayers({ images, selectedImage, onSelectImage, onResetImage, onPaletteColorChange, palette, layers, selectedId, onSelect, onChange, focus, onFocusChange, groups, onGroup, onUngroup, onBulkChange, onDelete, onUndo, canUndo }: { images: Artwork[]; selectedImage?: string; onSelectImage: (id: string) => void; onResetImage: (id: string) => void; onPaletteColorChange: (slot: number, color: string) => void; palette: Thread[]; layers: EmbroideryLayer[]; selectedId?: string; onSelect: (id?: string) => void; onChange: (id: string, edit: LayerOptions) => void; focus: boolean; onFocusChange: (value: boolean) => void; groups: LayerGroup[]; onGroup: (ids: string[]) => void; onUngroup: (id: string) => void; onBulkChange: (ids: string[], edit: LayerOptions) => void; onDelete: (ids: string[]) => void; onUndo: () => void; canUndo: boolean }) {
  const [selection, setSelection] = useState<string[]>([]);
  const [editing, setEditing] = useState<string>();
  const [bulkEditing, setBulkEditing] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const knownLayerIds = useRef(new Set<string>());
  useEffect(() => {
    const incoming = layers.filter(layer => !knownLayerIds.current.has(layer.id)).map(layer => layer.id);
    knownLayerIds.current = new Set(layers.map(layer => layer.id));
    if (incoming.length) setSelection(previous => [...new Set([...previous.filter(id => knownLayerIds.current.has(id)), ...incoming])]);
  }, [layers]);
  const selected = selection.filter(id => layers.some(layer => layer.id === id));
  const commonValue = (key: 'stitchType' | 'paletteSlot' | 'centerline') => {
    const values = new Set(layers.filter(layer => selected.includes(layer.id)).map(layer => String(layer[key])));
    return values.size === 1 ? [...values][0] : '';
  };
  const toggle = (ids: string[]) => setSelection(previous => ids.every(id => previous.includes(id)) ? previous.filter(id => !ids.includes(id)) : [...new Set([...previous, ...ids])]);
  const activeGroups = groups.map(group => ({ ...group, members: group.members.filter(id => layers.some(layer => layer.id === id)) })).filter(group => group.members.length);
  const grouped = new Set(activeGroups.flatMap(group => group.members));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => { if (selectedImage) setExpanded(previous => ({ ...previous, [selectedImage]: true })); }, [selectedImage]);
  const inspector = (layer: EmbroideryLayer) => (<div className="ms-layer-inspector" key={layer.id}>
      <label className="ms-layer-field">Part name<input aria-label="Layer name" value={layer.name} maxLength={60} onChange={e => onChange(layer.id, { name: e.target.value })} /></label>
      <div className="ms-layer-palette"><span id="ms-layer-color-label">Thread color <small>{palette.length} available</small></span><div role="group" aria-labelledby="ms-layer-color-label" className="ms-layer-palette-swatches">{palette.map((thread, slot) => <button key={slot} type="button" aria-label={`Assign color ${slot + 1} to ${layer.name}`} aria-pressed={layer.paletteSlot === slot} title={`Color ${slot + 1} · ${thread.hex.toUpperCase()}`} style={{ backgroundColor: thread.hex }} onClick={() => onChange(layer.id, { paletteSlot: slot })}><span>{slot + 1}</span>{layer.paletteSlot === slot && <Check size={12} />}</button>)}</div><label className="ms-layer-palette-edit"><input type="color" aria-label={`Edit shared color ${layer.paletteSlot + 1} for all parts`} value={palette[layer.paletteSlot]?.hex ?? layer.color} onInput={e => onPaletteColorChange(layer.paletteSlot, e.currentTarget.value)} /><span>Edit shared color {layer.paletteSlot + 1}</span></label></div>
      <fieldset className="ms-control-choice"><legend>Geometry</legend><div className="ms-segmented"><label><input type="radio" name={`geometry-${layer.id}`} checked={!layer.centerline} onChange={() => onChange(layer.id,{centerline:false})}/><span>Shape</span></label><label><input type="radio" name={`geometry-${layer.id}`} checked={!!layer.centerline} onChange={() => onChange(layer.id,{centerline:true,stitchType:'satin',stitchLength:7})}/><span>Stroke</span></label></div></fieldset>
      {layer.centerline && <label className="ms-layer-field">Stroke width<select aria-label="Stroke width" value={layer.strokeWidth ?? ''} onChange={event => onChange(layer.id,{strokeWidth:event.target.value ? Number(event.target.value) : undefined})}><option value="">Match image</option>{[.5,1,1.5,2,2.5,3,4,5,6,7].map(width=><option key={width} value={width}>{width} mm</option>)}</select></label>}
      {layer.centerline && layer.stitchType === 'satin' && <label className="ms-layer-field">Satin direction<select aria-label="Satin direction" value={layer.satinDirection ?? 'follow'} onChange={e => onChange(layer.id,{satinDirection:e.target.value as LayerOptions['satinDirection']})}><option value="follow">Follow stroke</option><option value="horizontal">Horizontal stitches</option><option value="vertical">Vertical stitches</option></select></label>}
      <LayerStitchChoices layer={layer} palette={palette} onChange={edit => onChange(layer.id, edit)} />
      <p className="ms-layer-sew-time">{layer.visible ? `About ${Math.max(.1, Math.round(layer.stitchCount / 650 * 10) / 10)} min at 650 stitches/min` : 'Hidden from export'}</p>
      <div className="ms-layer-properties">
        <label className="ms-layer-field ms-layer-number">Maximum stitch length <span><input type="number" aria-label="Layer stitch length" min="1" max={layer.stitchType === 'satin' ? 7 : 4} step=".1" value={layer.stitchLength} onChange={e => { const value = Number(e.target.value); if (value >= 1 && value <= (layer.stitchType === 'satin' ? 7 : 4)) onChange(layer.id, { stitchLength: value }); }} /> mm</span></label>
        {layer.stitchType === 'fill' || layer.stitchType === 'satin' ? <>

          {!layer.centerline && <label className="ms-layer-field">Fill direction<select aria-label="Layer fill direction" value={layer.stitchType==='fill' ? layer.fillDirection ?? 'follow' : layer.direction} onChange={e => onChange(layer.id, layer.stitchType==='fill' ? {fillDirection:e.target.value as LayerOptions['fillDirection']} : {direction:e.target.value as LayerOptions['direction']})}>{layer.stitchType==='fill' && <option value="follow">Follow stroke</option>}<option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label>}
          <div className="ms-switch-row"><label htmlFor="ms-layer-underlay">Light underlay</label><Switch id="ms-layer-underlay" checked={layer.underlay} onCheckedChange={underlay => onChange(layer.id, { underlay })} /></div>
        </> : patternedStyle(layer.stitchType) ? <><label className="ms-layer-field">Pattern direction<select aria-label="Pattern direction" value={layer.direction} onChange={e => onChange(layer.id, { direction: e.target.value as LayerOptions['direction'] })}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></label></> : <label className="ms-layer-field">Outline passes<select aria-label="Layer outline passes" value={layer.passes} onChange={e => onChange(layer.id, { passes: Number(e.target.value) })}><option value={1}>1 pass</option><option value={2}>2 passes</option><option value={3}>3 passes</option></select></label>}
        <button className="ms-layer-reset" onClick={() => onChange(layer.id, { stitchType: 'fill', spacing: undefined, stitchLength: undefined, direction: undefined, fillDirection: undefined, underlay: undefined, passes: undefined, texture: undefined, patternSize: undefined, outline: undefined, accentSlot: null })}><RefreshCw size={12} /> Reset stitch properties</button>
      </div>
      <div className="ms-switch-row"><label htmlFor="ms-focus-layer">Preview only this layer</label><Switch id="ms-focus-layer" checked={focus} onCheckedChange={onFocusChange} /></div>
      
    </div>);
  if (!images.length) return null;
  const row = (item: EmbroideryLayer) => {
    const image = images.find(image => image.id === item.itemId);
    return <div className="ms-inline-layer" key={item.id}><div className={`ms-compact-layer${!item.visible ? ' is-hidden' : ''}${selected.includes(item.id) ? ' is-selected' : ''}`} key={item.id}>
      <input type="checkbox" aria-label={`Select ${item.name} in ${image?.name ?? 'project'}`} checked={selected.includes(item.id)} onChange={() => toggle([item.id])} />
      <svg viewBox={item.previewBox} aria-hidden="true"><path d={item.previewPath} fill={item.color} fillRule="evenodd" /></svg>
      <button className="ms-compact-layer-name" aria-expanded={editing === item.id} aria-controls={`settings-${item.id}`} onClick={() => { if (item.itemId) onSelectImage(item.itemId); onSelect(item.id); setEditing(previous => previous === item.id ? undefined : item.id); }}><strong>{item.name}</strong><small>{item.centerline ? 'Satin stroke' : styleInfo(item.stitchType).label}{item.outline && item.stitchType !== 'running' ? ' + outline' : ''}{!item.visible ? ' · Hidden' : ''}</small></button>
      <button className="ms-compact-edit" aria-expanded={editing === item.id} aria-controls={`settings-${item.id}`} aria-label={`Edit ${item.name} in ${image?.name ?? 'project'}`} onClick={() => { onSelect(item.id); setEditing(previous => previous === item.id ? undefined : item.id); }}><Settings2 size={15} /></button>
    </div>{editing === item.id && <div id={`settings-${item.id}`} role="region" aria-label={`Settings for ${item.name}`}>{inspector(item)}</div>}</div>;
  };
  return <section className="ms-layer-panel" aria-label="Project layers">
    <div className="ms-layer-heading"><Layers size={18} /><h3>Layers</h3><span>{layers.length} parts</span></div>
    <div className="ms-selection-bar"><button disabled={!layers.length} onClick={() => setSelection(layers.map(layer => layer.id))}>Select all</button><button disabled={!selected.length} onClick={() => setSelection([])}>Clear</button><span role="status">{selected.length} selected</span></div>
    {!!selected.length && <div className="ms-layer-quick-actions" aria-label="Selected layer actions"><button className="ms-edit-selected-toggle" aria-expanded={bulkEditing} aria-controls="ms-selected-layer-settings" onClick={() => { setBulkEditing(previous => !previous); setEditing(undefined); }}><span>Edit selected</span><ChevronDown size={16} /></button></div>}
    {bulkEditing && !!selected.length && <section id="ms-selected-layer-settings" className="ms-inline-bulk" aria-label="Selected layer settings"><h4>Edit {selected.length} selected layers</h4>
      <fieldset className="ms-control-choice"><legend>Geometry</legend><div className="ms-segmented"><label><input type="radio" name="selected-geometry" checked={layers.filter(layer=>selected.includes(layer.id)).every(layer=>!layer.centerline)} onChange={()=>onBulkChange(selected,{centerline:false})}/><span>Shape</span></label><label><input type="radio" name="selected-geometry" checked={layers.filter(layer=>selected.includes(layer.id)).every(layer=>!!layer.centerline)} onChange={()=>onBulkChange(selected,{centerline:true,stitchType:'satin',stitchLength:7})}/><span>Stroke</span></label></div></fieldset>
      <div className="ms-layer-stitch-choices"><span className="ms-layer-field-title">Stitch style</span><div className="ms-style-grid" role="group" aria-label="Selected layers stitch styles">{(commonValue('centerline') === 'true' ? ['satin','running'] : ['fill','satin','running']).map(id => {
        const style=STITCH_STYLES.find(style=>style.id===id)!;
        const stroke=commonValue('centerline')==='true';
        const checked=commonValue('stitchType')===id;
        return <button key={id} type="button" aria-label={`Use ${stroke && id==='satin' ? 'Satin stroke' : stroke && id==='running' ? 'Running stitch' : style.label} for selected layers`} aria-pressed={checked} onClick={()=>onBulkChange(selected,{stitchType:style.id,centerline:stroke,stitchLength:undefined})}><StitchStyleSwatch centerline={stroke} style={style.id} color={palette[0]?.hex ?? '#8e1515'}/><span>{stroke && id==='satin' ? 'Satin stroke' : stroke && id==='running' ? 'Running stitch' : style.label}</span></button>;
      })}</div></div>

      <label className="ms-layer-field">Thread color<select aria-label="Selected layers thread color" value={commonValue('paletteSlot')} onChange={event => onBulkChange(selected, {paletteSlot:Number(event.target.value)})}><option value="" disabled>Mixed colors</option>{palette.map((color,slot)=><option key={slot} value={slot}>Color {slot+1} · {color.hex}</option>)}</select></label>

      <button className="ms-bulk-done" onClick={() => setBulkEditing(false)}>Done</button>
    </section>}
    {canUndo && <button className="ms-layer-undo" onClick={onUndo}><Undo2 size={14} /> Undo delete</button>}
    {activeGroups.map(group => <section className="ms-custom-layer-group" key={group.id} aria-label={group.name}><div className="ms-custom-group-heading"><input type="checkbox" aria-label={`Select ${group.name}`} checked={group.members.every(id => selected.includes(id))} onChange={() => toggle(group.members)} /><button aria-expanded={!!openGroups[group.id]} onClick={() => setOpenGroups(previous => ({...previous,[group.id]:!previous[group.id]}))}><Folder size={15} /><strong>{group.name}</strong><small>{group.members.length} parts</small><ChevronDown size={14}/></button><button aria-label={`Ungroup ${group.name}`} onClick={() => onUngroup(group.id)}>Ungroup</button></div>{openGroups[group.id] && group.members.map(id => row(layers.find(layer => layer.id === id)!))}</section>)}
    <div className="ms-image-groups">{images.map((image, index) => {
      const parts = layers.filter(layer => layer.itemId === image.id && !grouped.has(layer.id)), open = expanded[image.id] ?? index === 0;
      if (!parts.length) return null;
      return <section key={image.id} className="ms-image-group" aria-label={`${image.name} layers`}>
        <div className="ms-image-group-heading"><button className="ms-image-group-toggle" aria-expanded={open} aria-label={`Layers for ${image.name}`} onClick={() => setExpanded(previous => ({ ...previous, [image.id]: !open }))}><img src={image.url} alt="" /><span><strong>{image.name}</strong><small>{parts.length} parts</small></span><ChevronDown size={15} /></button></div>
        {open && <div className="ms-layer-list" role="group" aria-label={`Parts of ${image.name}`}>{parts.map(row)}</div>}
      </section>;
    })}</div>
    

  </section>;

}

export default function MakeryStitch() {
  const [images, setImages] = useState<Artwork[]>([]);
  const examples = useMemo(() => exampleArtworks.map(example=>({...example,url:`${import.meta.env.BASE_URL}${example.url}`})), []);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [artworkEdits,setArtworkEdits] = useState<ArtworkEdit[]>([]);
  const [svgEditScope,setSvgEditScope]=useState<'all'|'layer'>('all');
  const [svgPaintColor,setSvgPaintColor]=useState('#8e1515');
  const [svgTool,setSvgTool] = useState<'select'|'paint'|'erase'|'bucket'>('select');
  const [brushSize,setBrushSize] = useState(4);
  const [svgLayerSelection,setSvgLayerSelection]=useState<string[]>([]);
  const [svgLayerColorOpen,setSvgLayerColorOpen]=useState<string>();
  const [svgLayerStyleOpen,setSvgLayerStyleOpen]=useState<string>();
  const [svgEditTarget,setSvgEditTarget] = useState<{imageId:string;color:string;sourceColor:string}>();
  const projectRaster = useMemo(() => stretchRaster(applyArtworkEdits(composeImages(images, settings.removeWhite, Object.fromEntries(Object.entries(settings.imageSettings ?? {}).map(([id,options])=>[id,options.size ?? 1]))),artworkEdits), settings.stretchY), [images, settings.removeWhite, settings.stretchY, settings.imageSettings,artworkEdits]);
  const projectName = images.length === 1 ? images[0].name : 'Makery-project';
  const imageUrls = useRef(new Set<string>());
  const [uploading, setUploading] = useState(false);
  const [layerOverrides, setLayerOverrides] = useState<LayerOverrides>({});
  const [layerGroups, setLayerGroups] = useState<LayerGroup[]>([]);
  const [deletedLayers, setDeletedLayers] = useState<string[]>([]);
  const [lastDeleted, setLastDeleted] = useState<string[]>([]);
  const [selectedLayer, setSelectedLayer] = useState<string>();
  const [cuttingLayer,setCuttingLayer] = useState<string>();
  const [focusLayer, setFocusLayer] = useState(false);
  const [baseDesign, setBaseDesign] = useState<EmbroideryDesign | null>(null);
  const [paletteLimit, setPaletteLimit] = useState(3);
  const [paletteColors, setPaletteColors] = useState<Record<number, string>>({});
  const [hiddenColors, setHiddenColors] = useState<number[]>([]);
  const toggleColor = (slot: number) => {
    if (imageSelection.length !== images.length) {
      const affected=editableLayers.filter(layer=>imageSelection.includes(layer.itemId ?? '') && layer.paletteSlot===slot);
      const hide=affected.some(layer=>layer.visible);
      editSelectedLayers(affected.map(layer=>layer.id),{visible:!hide}); return;
    }
    setHiddenColors(previous => previous.includes(slot) ? previous.filter(value => value !== slot) : [...previous, slot]); setBusy(true); setDownloaded(false); };
  const [imageOffsets, setImageOffsets] = useState<ImageOffsets>({});
  const [selectedImage, setSelectedImage] = useState<string>();
  const [selectedImages,setSelectedImages] = useState<string[] | undefined>();
  const selectedImageIds = (selectedImages ?? []).filter(id=>images.some(image=>image.id===id));
  const imageSelection = selectedImages == null ? images.map(image=>image.id) : selectedImageIds;

  const positioned = useMemo(() => baseDesign ? positionImages(baseDesign, imageOffsets) : null, [baseDesign, imageOffsets]);
  const design = positioned?.design ?? null;
  const activeImage = images.some(image => image.id === selectedImage) ? selectedImage : images[0]?.id;
  const moveImage = (id: string, offset: Placement) => { setImageOffsets(previous => ({ ...previous, [id]: offset })); setDownloaded(false); };
  const selectImage = (id: string, multiple = false) => { setSelectedImages(previous=>multiple ? (previous ?? images.map(image=>image.id)).includes(id) ? (previous ?? images.map(image=>image.id)).filter(value=>value!==id) : [...(previous ?? []),id] : [id]); setSelectedImage(id); if (baseDesign?.layers.find(layer => layer.id === selectedLayer)?.itemId !== id) { setSelectedLayer(undefined); setFocusLayer(false); } };
  const palette = useMemo(() => (baseDesign?.palette ?? []).slice(0, paletteLimit).map((thread, slot) => paletteColors[slot] ? recolorThread(thread, paletteColors[slot]) : thread), [baseDesign, paletteColors, paletteLimit]);
  const selectedLayerId = baseDesign?.layers.find(layer => layer.id === selectedLayer)?.id;
  const editableLayers = useMemo(() => baseDesign?.layers.filter(layer => !deletedLayers.includes(layer.id)).map(layer => {
    const edit = layerOverrides[layer.id] ?? {};
    const requestedSlot = edit.paletteSlot ?? layer.paletteSlot;
    const slot = requestedSlot < palette.length ? requestedSlot : palette.length ? nearestPaletteSlot(layer.color, palette) : 0;
    return { ...layer, ...Object.fromEntries(Object.entries(edit).filter(([, value]) => value !== undefined)), visible: (edit.visible ?? layer.visible) && !hiddenColors.includes(slot), paletteSlot: slot, color: palette[slot]?.hex ?? layer.color };
  }) ?? [], [baseDesign, layerOverrides, palette, deletedLayers, hiddenColors]);
  const usedColorCount = new Set(editableLayers.filter(layer => layer.visible).flatMap(layer => [layer.color, ...(patternedStyle(layer.stitchType) && layer.accentSlot != null && palette[layer.accentSlot] ? [palette[layer.accentSlot].hex] : [])])).size;
  const resizeSelectedImages = (percent: number) => {
    setSettings(previous=>{
      const sizes={...previous.imageSettings};
      const before=Math.max(1,...images.map(image=>sizes[image.id]?.size ?? 1));
      for(const id of imageSelection)sizes[id]={...sizes[id],size:Math.max(.25,Math.min(2,percent/100,125/previous.widthMm*before))};
      const after=Math.max(1,...images.map(image=>sizes[image.id]?.size ?? 1));
      return {...previous,imageSettings:sizes,widthMm:Math.min(125,previous.widthMm*after/before)};
    });setBusy(true);setDownloaded(false);
  };
  const imageSizeControl = images.length>1 ? <section className="ms-image-size"><div className="ms-control-label"><span>Selected image size</span><span>{Math.round((settings.imageSettings?.[imageSelection[0]]?.size ?? 1)*100)}%</span></div><Slider aria-label="Selected image size" min={25} max={200} step={5} value={[(settings.imageSettings?.[imageSelection[0]]?.size ?? 1)*100]} onValueChange={([value])=>resizeSelectedImages(value)}/><div className="ms-color-range"><span>25%</span><span>100%</span><span>200%</span></div></section> : null;
  const updateSvgShapes = (change: Partial<Settings>) => {
    setSettings(previous => ({...previous,imageSettings:{...Object.fromEntries(images.map(image=>[image.id,previous.imageSettings?.[image.id] ?? {colors:previous.colors,detail:previous.detail,svgGeometry:previous.svgGeometry}])),...Object.fromEntries(imageSelection.map(id=>[id,{...previous.imageSettings?.[id],...change}]))}}));
    if (change.colors !== undefined) setPaletteLimit(Math.max(change.colors,...images.filter(image=>!imageSelection.includes(image.id)).map(image=>settings.imageSettings?.[image.id]?.colors ?? settings.colors)));
    setLayerOverrides(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>!imageSelection.some(image=>id.startsWith(`${image}-part-`)))));
    setSelectedLayer(undefined); setFocusLayer(false); setBusy(true); setDownloaded(false);
  };
  const applyCoverage = (coverage: StitchCoverage) => {
    setBusy(true); setSettings(previous => ({ ...previous, coverage }));
    // A project plan replaces stitch properties but preserves names, thread
    // assignments, visibility and independent image placement.
    setLayerOverrides(previous => Object.fromEntries(editableLayers.map(layer => {
      const edit = previous[layer.id] ?? {};
      return [layer.id, { name: edit.name, paletteSlot: edit.paletteSlot, visible: edit.visible, centerline: false, stitchType: coverage === 'outline' ? 'running' : 'fill' }];
    })));

  };
  const mergeColor = (from: number, to: number) => {
    setLayerOverrides(previous => ({ ...previous, ...Object.fromEntries(editableLayers.filter(layer=>imageSelection.includes(layer.itemId ?? '') && (layer.paletteSlot===from || layer.accentSlot===from)).map(layer=>[layer.id,{...previous[layer.id], ...(layer.paletteSlot===from ? {paletteSlot:to} : {}), ...(layer.accentSlot===from ? {accentSlot:to} : {})}])) }));
    setHiddenColors(previous=>previous.filter(slot=>slot!==to)); setBusy(true); setDownloaded(false);
  };
  const changePaletteLimit = (limit: number) => {
    if (limit === paletteLimit) return;
    const remaining = palette.slice(0, limit);
    if (remaining.length) setLayerOverrides(previous => {
      const next = { ...previous };
      for (const layer of editableLayers) {
        if (layer.paletteSlot >= limit) next[layer.id] = { ...next[layer.id], paletteSlot: nearestPaletteSlot(layer.color, remaining) };
        if (layer.accentSlot != null && layer.accentSlot >= limit) next[layer.id] = { ...next[layer.id], accentSlot: nearestPaletteSlot(palette[layer.accentSlot]?.hex ?? layer.color, remaining) };
      }
      return next;
    });
    setPaletteLimit(limit); setSettings(previous=>({...previous,colors:limit})); setBusy(true); setDownloaded(false);
  };
  const changePaletteColor = (slot: number, color?: string) => {
    if(color && imageSelection.length !== images.length){
      const affected=editableLayers.filter(layer=>imageSelection.includes(layer.itemId ?? '') && layer.paletteSlot===slot);
      const used=new Set(editableLayers.map(layer=>layer.paletteSlot));
      const target=Array.from({length:10},(_,index)=>index).find(index=>!used.has(index));
      if(target==null){setError('All 10 colors are in use. Merge a color first.');return;}
      setPaletteLimit(previous=>Math.max(previous,target+1));setPaletteColors(previous=>({...previous,[target]:color}));
      editSelectedLayers(affected.map(layer=>layer.id),{paletteSlot:target});return;
    }
    setLayerOverrides(previous => ({ ...previous, ...Object.fromEntries(editableLayers.map(layer => [layer.id, { ...previous[layer.id], paletteSlot: layer.paletteSlot }])) }));
    setPaletteColors(previous => { const next = { ...previous }; if (color) next[slot] = color; else delete next[slot]; return next; });
    setBusy(true); setDownloaded(false);
  };
  const editLayer = (id: string, edit: LayerOptions) => {
    if(edit.manualCut){setCuttingLayer(id);setFocusLayer(true);setSelectedLayer(id);return;}
    setLayerOverrides(previous => ({ ...previous, [id]: { ...previous[id], ...edit } }));
    setBusy(true); setDownloaded(false);
  };
  const moveSvgLayers = (direction:'up'|'down') => {
    const order=editableLayers.map(layer=>layer.id), selected=new Set(svgLayerSelection);
    if(direction==='up')for(let i=1;i<order.length;i++){if(selected.has(order[i])&&!selected.has(order[i-1]))[order[i-1],order[i]]=[order[i],order[i-1]];}
    else for(let i=order.length-2;i>=0;i--){if(selected.has(order[i])&&!selected.has(order[i+1]))[order[i],order[i+1]]=[order[i+1],order[i]];}
    setSettings(previous=>({...previous,layerOrder:order}));setDownloaded(false);
  };
  const changeSvgLayerColor = (layer:EmbroideryLayer,color:string) => {
    const usedElsewhere=new Set(editableLayers.filter(other=>other.id!==layer.id).map(other=>other.paletteSlot));
    const slot=!usedElsewhere.has(layer.paletteSlot)?layer.paletteSlot:Array.from({length:10},(_,i)=>i).find(i=>!usedElsewhere.has(i)&&!editableLayers.some(other=>other.paletteSlot===i));
    if(slot==null){setError('All 10 colors are in use. Choose an existing color or merge colors first.');return;}
    setPaletteLimit(previous=>Math.max(previous,slot+1));setPaletteColors(previous=>({...previous,[slot]:color}));editLayer(layer.id,{paletteSlot:slot});
    if(selectedLayerId===layer.id)setSvgEditTarget({imageId:layer.itemId!,sourceColor:layer.sourceColor,color});
  };
  const editSelectedLayers = (ids: string[], edit: LayerOptions) => {
    setLayerOverrides(previous => ({...previous,...Object.fromEntries(ids.map(id => [id,{...previous[id],...edit}]))}));
    setBusy(true); setDownloaded(false);
  };
  const groupLayers = (ids: string[]) => setLayerGroups(previous => [
    ...previous.map(group => ({...group,members:group.members.filter(id=>!ids.includes(id))})).filter(group=>group.members.length),
    {id:crypto.randomUUID(),name:`Group ${previous.length+1}`,members:ids}
  ]);
  const deleteLayers = (ids: string[]) => { setDeletedLayers(previous => [...new Set([...previous,...ids])]); setLastDeleted(ids); setBusy(true); setDownloaded(false); setFocusLayer(false); };
  const undoDelete = () => { setDeletedLayers(previous => previous.filter(id=>!lastDeleted.includes(id))); setLastDeleted([]); setBusy(true); setDownloaded(false); };
  const [sewingSpeed, setSewingSpeed] = useState(650);
  const sewingTime = useMemo(() => design ? estimateSewingTime(design, sewingSpeed) : null, [design, sewingSpeed]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [step, setStep] = useState('upload');
  const sidebarScrollRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{sidebarScrollRef.current?.scrollTo({top:0});},[step]);
  const [canvasZoom, setCanvasZoom] = useState<Record<string, number>>({});
  const zoom = canvasZoom[step] ?? 1;
  const changeZoom = (value: number) => setCanvasZoom(previous=>({...previous,[step]:Math.max(.5,Math.min(4,Math.round(value*100)/100))}));
  const view = step === 'preview' ? 'shirt' : 'stitches';
  const [canvasPan, setCanvasPan] = useState<Record<string, Placement>>({});
  const pan = canvasPan[step] ?? { x: 0, y: 0 };
  const panRef = useRef(pan); panRef.current = pan;
  const workspaceRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || !['svg', 'stitches', 'preview'].includes(step)) return;
    const onCanvas = (event: Event) => event.target instanceof Element && !!event.target.closest('.ms-stitches-surface, .ms-shirt-surface');
    const update = (value: number) => {
      const next = Math.max(.5, Math.min(4, value));
      zoomRef.current = next;
      setCanvasZoom(previous => ({ ...previous, [step]: next }));
    };
    const canvasScale = (event: Event) => {
      const surface = (event.target as Element).closest('.ms-stitches-surface,.ms-shirt-surface');
      const svg = surface?.querySelector<SVGSVGElement>('svg.ms-stitches-svg,svg.ms-shirt-svg');
      return svg?.getScreenCTM()?.a ?? 1;
    };
    const shiftPan = (x: number, y: number) => {
      const next = { x: panRef.current.x + x, y: panRef.current.y + y };
      panRef.current = next; setCanvasPan(previous => ({ ...previous, [step]: next }));
    };
    const wheel = (event: WheelEvent) => {
      if (!onCanvas(event)) return;
      event.preventDefault();
      if (event.ctrlKey) update(zoomRef.current * Math.exp(-event.deltaY * .01));
      else {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? workspace.clientHeight : 1;
        const scale = canvasScale(event);
        shiftPan(-event.deltaX * unit / scale, -event.deltaY * unit / scale);
      }
    };
    let pinch: { distance: number; zoom: number; center: Placement } | null = null;
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const midpoint = (touches: TouchList) => ({ x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 });
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !onCanvas(event)) return;
      event.preventDefault();
      pinch = { distance: distance(event.touches), zoom: zoomRef.current, center: midpoint(event.touches) };
    };
    const touchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault(); event.stopPropagation();
      const center = midpoint(event.touches), scale = canvasScale(event);
      shiftPan((center.x - pinch.center.x) / scale, (center.y - pinch.center.y) / scale);
      pinch.center = center;
      update(pinch.zoom * distance(event.touches) / Math.max(1, pinch.distance));
    };
    const touchEnd = () => { pinch = null; };
    const pointerMove = (event: globalThis.PointerEvent) => { if (pinch) { event.preventDefault(); event.stopPropagation(); } };
    let space = false;
    let panning: { id: number; x: number; y: number; origin: Placement; scale: number } | null = null;
    const keyDown = (event: globalThis.KeyboardEvent) => { if (event.code === 'Space' && !(event.target instanceof Element && event.target.closest('input,textarea,select,button,[role="slider"]'))) { space = true; event.preventDefault(); workspace.classList.add('ms-pan-ready'); } };
    const keyUp = (event: globalThis.KeyboardEvent) => { if (event.code === 'Space') { space = false; workspace.classList.remove('ms-pan-ready'); } };
    const panStart = (event: globalThis.PointerEvent) => {
      if ((event.target instanceof Element && event.target.closest('[data-cut-tool]')) || !onCanvas(event) || !event.isPrimary || ![0,1].includes(event.button)) return;
      const target = event.target as Element;
      if (!space && event.button !== 1 && target.closest('[role="button"],[role="slider"],button')) return;
      const svg = target.closest('svg') ?? target.closest('.ms-stitches-surface,.ms-shirt-surface')?.querySelector('svg.ms-stitches-svg,svg.ms-shirt-svg');
      if (!(svg instanceof SVGSVGElement)) return;
      const matrix = svg.getScreenCTM(); if (!matrix) return;
      event.preventDefault(); event.stopPropagation();
      panning = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: panRef.current, scale: matrix.a };
      workspace.setPointerCapture(event.pointerId); workspace.classList.add('ms-is-panning');
    };
    const panMove = (event: globalThis.PointerEvent) => {
      if (pinch || !panning || event.pointerId !== panning.id) return;
      event.preventDefault(); event.stopPropagation();
      const next = { x: panning.origin.x + (event.clientX - panning.x) / panning.scale, y: panning.origin.y + (event.clientY - panning.y) / panning.scale };
      panRef.current = next; setCanvasPan(previous => ({ ...previous, [step]: next }));
    };
    const panEnd = () => { panning = null; workspace.classList.remove('ms-is-panning'); };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', panEnd);
    workspace.addEventListener('pointerdown', panStart, true); workspace.addEventListener('pointermove', panMove, true);
    workspace.addEventListener('pointerup', panEnd, true); workspace.addEventListener('pointercancel', panEnd, true);
    let gestureZoom = 1;
    const gestureStart = (event: Event) => { if (!onCanvas(event)) return; event.preventDefault(); gestureZoom = zoomRef.current; };
    const gestureChange = (event: Event) => { if (!onCanvas(event)) return; event.preventDefault(); update(gestureZoom * (event as Event & { scale: number }).scale); };
    workspace.addEventListener('wheel', wheel, { passive: false });
    workspace.addEventListener('touchstart', touchStart, { passive: false, capture: true });
    workspace.addEventListener('touchmove', touchMove, { passive: false, capture: true });
    workspace.addEventListener('touchend', touchEnd); workspace.addEventListener('touchcancel', touchEnd);
    workspace.addEventListener('pointermove', pointerMove, true);
    workspace.addEventListener('gesturestart', gestureStart); workspace.addEventListener('gesturechange', gestureChange);
    return () => {
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', panEnd);
      workspace.removeEventListener('pointerdown', panStart, true); workspace.removeEventListener('pointermove', panMove, true); workspace.removeEventListener('pointerup', panEnd, true); workspace.removeEventListener('pointercancel', panEnd, true);
      workspace.classList.remove('ms-pan-ready','ms-is-panning');
      workspace.removeEventListener('wheel', wheel);
      workspace.removeEventListener('touchstart', touchStart, true); workspace.removeEventListener('touchmove', touchMove, true);
      workspace.removeEventListener('touchend', touchEnd); workspace.removeEventListener('touchcancel', touchEnd);
      workspace.removeEventListener('pointermove', pointerMove, true);
      workspace.removeEventListener('gesturestart', gestureStart); workspace.removeEventListener('gesturechange', gestureChange);
    };
  }, [step]);
  const [outputView, setOutputView] = useState('upload');
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [canvasOnly, setCanvasOnly] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => { const resize = () => setWindowWidth(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const reservedWidth = !canvasOnly && (windowWidth > 1080 || rightOpen) ? 316 : 0;
  const [paths, setPaths] = useState(false);
  const svgPreview = step === 'svg';
  const svgMarkup = useMemo(() => design ? stitchSvg(design) : '', [design]);
  const svgPreviewUrl = useMemo(() => svgMarkup ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}` : '', [svgMarkup]);
  const [progress, setProgress] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [dimensionsLocked, setDimensionsLocked] = useState(true);
  useEffect(() => {
    if (!playing || busy || step !== 'stitches' || !design) { setPlaying(false); return; }
    const duration=Math.max(5000,Math.min(30000,design.stitchCount*2));
    const timer=window.setInterval(()=>setProgress(previous=>Math.min(100,previous+100*50/duration)),50);
    return ()=>window.clearInterval(timer);
  },[playing,busy,step,design]);
  useEffect(()=>{if(progress>=100)setPlaying(false);},[progress]);
  const [dragging, setDragging] = useState(false);
  const [review, setReview] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [previewSurface,setPreviewSurface] = useState<'shirt' | 'rectangle'>('shirt');
  const [shirtColor, setShirtColor] = useState(shirtColors[0].value);
  const [shirtWidthCm, setShirtWidthCm] = useState(52);
  const [rectangleSize,setRectangleSize] = useState({width:52,height:60});
  const [autoHoop, setAutoHoop] = useState(true);
  const [manualHoopId, setManualHoopId] = useState<Hoop['id']>('large');
  const [placement, setPlacement] = useState<Placement>({ x: 0, y: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageToDelete, setImageToDelete] = useState<string>();
  const [replacementId, setReplacementId] = useState<string>();
  const editSnapshot = { rectangleSize, artworkEdits, hiddenColors, settings, layerOverrides, layerGroups, deletedLayers, paletteLimit, paletteColors, imageOffsets, placement, shirtWidthCm, shirtColor, autoHoop, manualHoopId };
  type EditSnapshot = typeof editSnapshot;
  const history = useRef<{ entries: EditSnapshot[]; index: number; images: Artwork[] }>({ entries: [], index: -1, images });
  const restoringHistory = useRef(false);
  const historyGesture = useRef(false);
  const [historyCommit, setHistoryCommit] = useState(0);
  useEffect(() => {
    const begin = (event: globalThis.PointerEvent) => {
      const target=event.target;
      if(target instanceof Element && target.closest('.ms-canvas-workspace') && target.closest('.ms-stitches-surface,.ms-shirt-surface,[role="slider"]')) historyGesture.current=true;
    };
    const finish = () => { if(historyGesture.current){historyGesture.current=false;setHistoryCommit(previous=>previous+1);} };
    const keyStart = (event: globalThis.KeyboardEvent) => {
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) && event.target instanceof Element && event.target.closest('[role="slider"],.ms-movable-image,.ms-movable-hoop'))historyGesture.current=true;
    };
    window.addEventListener('pointerdown',begin,true); window.addEventListener('pointerup',finish,true); window.addEventListener('pointercancel',finish,true);
    window.addEventListener('keydown',keyStart,true);window.addEventListener('keyup',finish,true);window.addEventListener('blur',finish);
    return()=>{window.removeEventListener('pointerdown',begin,true);window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',finish,true);window.removeEventListener('keydown',keyStart,true);window.removeEventListener('keyup',finish,true);window.removeEventListener('blur',finish);};
  }, []);
  const [historyPosition, setHistoryPosition] = useState({ index: -1, count: 0 });
  useEffect(() => {
    const h = history.current;
    if (h.images !== images) { h.entries = []; h.index = -1; h.images = images; }
    if (restoringHistory.current) { restoringHistory.current = false; return; }
    if (historyGesture.current) return;
    const previous = h.entries[h.index];
    if (previous && Object.keys(editSnapshot).every(key => previous[key as keyof EditSnapshot] === editSnapshot[key as keyof EditSnapshot])) return;
    h.entries = [...h.entries.slice(0, h.index + 1), editSnapshot].slice(-60);
    h.index = h.entries.length - 1;
    setHistoryPosition({ index: h.index, count: h.entries.length });
  }, [historyCommit, rectangleSize, artworkEdits, images, hiddenColors, settings, layerOverrides, layerGroups, deletedLayers, paletteLimit, paletteColors, imageOffsets, placement, shirtWidthCm, shirtColor, autoHoop, manualHoopId]);
  const restoreEdit = (direction: number) => {
    const h = history.current, index = h.index + direction, snapshot = h.entries[index];
    if (!snapshot) return;
    restoringHistory.current = true; h.index = index;
    setRectangleSize(snapshot.rectangleSize); setArtworkEdits(snapshot.artworkEdits); setHiddenColors(snapshot.hiddenColors); setSettings(snapshot.settings); setLayerOverrides(snapshot.layerOverrides); setLayerGroups(snapshot.layerGroups); setDeletedLayers(snapshot.deletedLayers);
    setPaletteLimit(snapshot.paletteLimit); setPaletteColors(snapshot.paletteColors); setImageOffsets(snapshot.imageOffsets); setPlacement(snapshot.placement);
    setShirtWidthCm(snapshot.shirtWidthCm); setShirtColor(snapshot.shirtColor); setAutoHoop(snapshot.autoHoop); setManualHoopId(snapshot.manualHoopId);
    setLastDeleted([]); setDownloaded(false); setHistoryPosition({ index, count: h.entries.length });
  };
  useEffect(() => { const previous = document.title; document.title = 'Makery Stitch — Image to embroidery'; return () => { document.title = previous; }; }, []);
  useEffect(() => {
    const current = new Set(images.filter(image => image.url.startsWith('blob:')).map(image => image.url));
    for (const url of imageUrls.current) if (!current.has(url)) URL.revokeObjectURL(url);
    imageUrls.current = current;
  }, [images]);
  useEffect(() => () => { for (const url of imageUrls.current) URL.revokeObjectURL(url); }, []);
  useEffect(() => {
    setBusy(true); setError(''); setDownloaded(false); setProgress(100);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        if (images.length) await loadVTracer();
        if (cancelled) return;
        setBaseDesign(images.length ? digitize(projectRaster, settings, { ...layerOverrides, ...Object.fromEntries(deletedLayers.map(id => [id, { ...layerOverrides[id], visible: false }])) }, { limit: paletteLimit, colors: paletteColors, hiddenSlots: hiddenColors }) : null);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not create stitches. Try a simpler image.'); }
      if (!cancelled) setBusy(false);
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [images, projectRaster, settings, layerOverrides, paletteLimit, paletteColors, deletedLayers, hiddenColors]);
  useEffect(() => { setPaletteColors({}); setLayerOverrides({}); setSelectedLayer(undefined); setFocusLayer(false); }, [settings.removeWhite]);
  const receiveFiles = async (files: File[]) => {
    if (!files.length || uploading) return;
    setUploadError(''); setUploading(true);
    const results = await Promise.allSettled(files.map(loadArtwork));
    const loaded: Artwork[] = [], failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') loaded.push(result.value);
      else failures.push(`${files[index].name}: ${result.reason instanceof Error ? result.reason.message : 'Could not open image.'}`);
    });
    if (loaded.length) {
      const starting = step === 'upload' || !images.length;
      const next = [...(starting ? [] : images), ...loaded];
      const raster = composeImages(next, settings.removeWhite);
      const width = Math.max(10, Math.min(settings.widthMm, Math.floor(175 * raster.width / raster.height), 125));
      setImages(next); setSettings(s => ({ ...s, widthMm: width, stretchY: starting ? undefined : s.stretchY })); setPaths(false); setStep(step === 'upload' ? 'svg' : step); setBusy(true); setOutputView('upload'); setLeftOpen(false); setRightOpen(step === 'upload'); setCanvasOnly(false);
      if (starting) { setArtworkEdits([]); setSvgTool('select'); setSelectedImages(loaded.map(image=>image.id)); setHiddenColors([]); setLayerGroups([]); setDeletedLayers([]); setLastDeleted([]); setImageOffsets({}); setSelectedImage(undefined); setLayerOverrides({}); setPaletteColors({}); setSelectedLayer(undefined); setFocusLayer(false); setBaseDesign(null); }
      else setLayerOverrides(previous => ({ ...previous, ...Object.fromEntries(editableLayers.map(layer => [layer.id, { ...previous[layer.id], paletteSlot: layer.paletteSlot }])) }));
      // Keep the shared palette and existing part assignments as more images are added.
      if (!starting && images.length && palette.length) setPaletteColors(previous => ({ ...Object.fromEntries(palette.map((color, slot) => [slot, color.hex])), ...previous }));
    }
    setUploadError(failures.join(' ')); setUploading(false);
  };
  const replaceArtwork = async (id: string, file: File) => {
    setUploading(true); setUploadError('');
    try {
      const replacement = await loadArtwork(file);
      const next = images.map(image=>image.id===id ? {...replacement,id} : image);
      const raster = composeImages(next, settings.removeWhite);
      setImages(next); setSettings(previous=>({...previous,widthMm:Math.max(10,Math.min(previous.widthMm,Math.floor(175*raster.width/raster.height),125))}));
      setLayerOverrides(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>!key.startsWith(`${id}-part-`))));
      setLayerGroups(previous=>previous.map(group=>({...group,members:group.members.filter(key=>!key.startsWith(`${id}-part-`))})).filter(group=>group.members.length));
      setDeletedLayers(previous=>previous.filter(key=>!key.startsWith(`${id}-part-`))); setLastDeleted([]);
      setSelectedLayer(undefined); setFocusLayer(false); setBusy(true); setDownloaded(false);
    } catch (error) { setUploadError(error instanceof Error ? error.message : 'Could not replace image.'); }
    setUploading(false); setReplacementId(undefined);
  };
  const removeImage = (id: string) => {
    setImageOffsets(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id)));
    setImages(previous => previous.filter(image => image.id !== id)); setBusy(true); setDownloaded(false);
    setLayerOverrides(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(`${id}-part-`))));
  };
  const duplicateImage = (image: Artwork) => {
    const copy = { ...image, id: crypto.randomUUID(), name: `${image.name.replace(/\.[^.]+$/, '')} copy.png` };
    setImages(previous => [...previous, copy]); setSelectedImage(copy.id); setSelectedLayer(undefined); setFocusLayer(false);
    setPaletteColors(previous => ({ ...Object.fromEntries(palette.map((color, slot) => [slot, color.hex])), ...previous }));
    setLayerOverrides(previous => ({ ...previous, ...Object.fromEntries(editableLayers.map(layer => [layer.id, { ...previous[layer.id], paletteSlot: layer.paletteSlot }])) }));
    setBusy(true); setDownloaded(false);
  };
  const pendingScale = settings.widthMm / (baseDesign?.widthMm ?? settings.widthMm);
  const composedWidth = design ? Math.round(design.widthMm * pendingScale * 10) / 10 : settings.widthMm;
  const maxArtworkWidth = Math.max(10, Math.min(125, Math.floor(175 * projectRaster.width / projectRaster.height)));
  const maxComposedWidth = Math.min(125, maxArtworkWidth * composedWidth / settings.widthMm);
  const resizeComposition = (width: number) => {
    const target=Math.max(10,Math.min(dimensionsLocked ? maxComposedWidth : 125,width)), ratio=target/composedWidth;
    setSettings(previous=>({...previous,widthMm:Math.max(10,Math.min(125,previous.widthMm*ratio)),stretchY:dimensionsLocked ? previous.stretchY : (previous.stretchY ?? 1)/ratio}));
  };
  const expectedHeight = design ? design.heightMm * pendingScale : settings.widthMm * projectRaster.height / projectRaster.width;
  const resizeHeight = (height: number) => {
    const target=Math.max(1,Math.min(175,height));
    if(dimensionsLocked)resizeComposition(composedWidth*target/expectedHeight);
    else setSettings(previous=>({...previous,stretchY:(previous.stretchY ?? 1)*target/expectedHeight}));
  };
  const dimensions = <DimensionControls width={composedWidth} height={expectedHeight} locked={dimensionsLocked} onLock={()=>setDimensionsLocked(previous=>!previous)} onWidth={resizeComposition} onHeight={resizeHeight}/>;
  const hoop = autoHoop ? smallestFittingHoop(composedWidth, expectedHeight) ?? HOOPS[2] : HOOPS.find(option => option.id === manualHoopId)!;
  const hoopFits = fitsHoop(composedWidth, expectedHeight, hoop);
  const download = () => {
    if (!design || !design.stitchCount || busy || uploading || !hoopFits || error) return false;
    try {
      // Build the file from the current project inputs, never a previous preview.
      const current = digitize(projectRaster, settings, { ...layerOverrides, ...Object.fromEntries(deletedLayers.map(id => [id, { ...layerOverrides[id], visible: false }])) }, { limit: paletteLimit, colors: paletteColors, hiddenSlots: hiddenColors });
      const exportDesign = positionImages(current, imageOffsets).design;
      assertDesignFitsHoop(exportDesign, hoop);
      const filename = projectName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'makery-design';
      const bytes = writePes(exportDesign, filename);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = `${filename}-PE900.pes`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setDownloaded(true); return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed. Try regenerating the design.'); return false; }
  };
  const downloadSvg = () => {
    if (!design || !design.stitchCount || busy || uploading || error) return;
    const filename = projectName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'makery-design';
    const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${filename}-artwork.svg`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const stageOrder = ['upload', 'svg', 'stitches', 'preview', 'setup'];
  const stageCircle = (stage: string, number: number) => <span className="ms-step-number">{stageOrder.indexOf(stage) < stageOrder.indexOf(step) ? <Check size={12} aria-label="Completed" /> : number}</span>;
  const goToStep = (next: string) => {
    setStep(next); setLeftOpen(false); setRightOpen(false); setCanvasOnly(false);
    if (next === 'upload' || next === 'svg') setOutputView('upload');
    if (next === 'preview') setOutputView('export');
    if (next === 'setup') { setFocusLayer(false); setProgress(100); }
  };
  const loadExample = async (example:typeof examples[number]) => {
    setUploading(true);setUploadError('');
    try{const response=await fetch(example.url);if(!response.ok)throw new Error('This example could not be opened. Try again.');const blob=await response.blob();const artwork=await loadArtwork(new File([blob],example.name,{type:'image/png'}));startExample({...artwork,id:example.id,example:true});}
    catch(error){setUploadError(error instanceof Error?error.message:'Could not open the example.');}
    finally{setUploading(false);}
  };
  const startExample = (example: Artwork) => {
    const next = [...images,{...example,id:crypto.randomUUID()}];
    const raster=composeImages(next,settings.removeWhite);
    setImages(next); setSettings(previous=>({...previous,widthMm:Math.max(10,Math.min(previous.widthMm,Math.floor(175*raster.width/raster.height),125))}));
    setUploadError(''); setError(''); setBusy(true); setDownloaded(false); if (step === 'upload') { setStep('svg'); setRightOpen(true); }
  };
  return <main className={`ms-app ms-canvas-app ms-step-${step}`}>
    <header className="ms-header"><Link to="/" className="ms-brand"><img className="ms-logo" src={`${import.meta.env.BASE_URL}embroidery/makery-bulb-cat.png`} alt="" /><span className="ms-brand-copy"><strong>GSE Makery</strong><span>EMBROIDERY STUDIO</span></span></Link>
      <div className="ms-header-actions"><button className="ms-mobile-panel-toggle" aria-label="Open stage controls" aria-expanded={rightOpen} onClick={() => { setRightOpen(!rightOpen); setCanvasOnly(false); }}><Settings2 size={16} /> Controls</button><button className="ms-focus-canvas" aria-label={canvasOnly ? 'Show panels' : 'Hide panels'} aria-pressed={canvasOnly} onClick={() => { setCanvasOnly(!canvasOnly); setLeftOpen(false); setRightOpen(false); }}>{canvasOnly ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}<span>{canvasOnly ? 'Show panels' : 'Hide panels'}</span></button></div>
    </header>
    <h1 className="sr-only">Makery Stitch workspace</h1>
    {(uploading || (busy && !!images.length)) && <div className="ms-processing" role="status" aria-live="polite"><span>{uploading ? 'Opening images…' : step === 'svg' ? 'Creating SVG…' : 'Updating stitches…'}</span><div className="ms-processing-track" role="progressbar" aria-label="Processing artwork"><div className="ms-processing-fill"/></div></div>}
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload images" className="ms-file-input" multiple onChange={e => { if (replacementId && e.target.files?.[0]) void replaceArtwork(replacementId, e.target.files[0]); else void receiveFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    <div ref={workspaceRef} className={`ms-workspace ms-canvas-workspace${canvasOnly ? ' ms-canvas-only' : ''}`}>
      <section className="ms-preview" aria-label="Design preview">
        <div className="ms-preview-toolbar"><Tabs value={step} onValueChange={goToStep}><TabsList aria-label="Making process"><TabsTrigger value="upload">{stageCircle('upload', 1)} Upload</TabsTrigger><TabsTrigger value="svg" disabled={!images.length}>{stageCircle('svg', 2)} SVG</TabsTrigger><TabsTrigger value="stitches" disabled={!images.length}>{stageCircle('stitches', 3)} Textile</TabsTrigger><TabsTrigger value="preview" disabled={!images.length}>{stageCircle('preview', 4)} <span className="ms-stage-label-long">Size &amp; preview</span><span className="ms-stage-label-short">Preview</span></TabsTrigger><TabsTrigger value="setup" disabled={!design || !design.stitchCount || busy || !hoopFits || !!error}>{stageCircle('setup', 5)} Setup</TabsTrigger></TabsList></Tabs>
        </div>
        {step === 'upload' ? <section className="ms-start-screen" aria-label="Start a project">
          <div className="ms-start-content"><h2>Start with an image.</h2><p className="ms-start-description">Upload your images or choose a premade artwork. Review the smooth SVG, then choose your textile stitches.</p>
            <button className={`ms-start-upload${dragging ? ' ms-dragging' : ''}`} disabled={uploading} onClick={() => fileRef.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void receiveFiles(Array.from(event.dataTransfer.files)); }}><Upload size={28} /><strong>{uploading ? 'Opening your images…' : 'Upload images'}</strong><span>Choose files or drop them here</span><small>PNG, JPG, WebP · multiple images · 15 MB each</small></button>
            {uploadError && <p className="ms-error" role="alert">{uploadError}</p>}
            {!!images.length && <div className="ms-upload-image-queue" aria-label="Uploaded images">{images.map(image=><div className="ms-file-card" key={image.id}><img src={image.url} alt=""/><strong>{image.name}</strong><button aria-label={`Remove ${image.name}`} onClick={()=>removeImage(image.id)}><X size={15}/></button></div>)}<p>{images.length} {images.length===1?'image':'images'} selected</p></div>}
            {!!images.length && <button className="ms-start-resume" disabled={busy || uploading || !!error} onClick={() => goToStep('svg')}>Continue to SVG →</button>}
            <div className="ms-start-gallery-heading"><h3>Or choose a premade artwork</h3></div>
            <div className="ms-start-gallery" aria-label="Premade artworks">{examples.map(example => <button key={example.id} disabled={uploading} onClick={() => void loadExample(example)} aria-label={`Use ${example.name.replace('.png', '')} artwork`}><div className="ms-example-image"><img src={example.url} alt={`${example.name.replace('.png', '')} artwork`} loading="lazy" decoding="async" /></div><div className="ms-example-name"><strong>{example.name.replace('.png', '')}</strong><span aria-hidden="true">→</span></div></button>)}</div>
          </div>
        </section> : step === 'setup' ? <MakerySetup design={design} hoop={hoop} ready={!!design && !!design.stitchCount && !busy && !uploading && hoopFits && !error} busy={busy} downloaded={downloaded} error={error} onDownload={download} onDownloadSvg={downloadSvg} onReview={() => setReview(true)} onEditPlacement={() => goToStep('preview')} shirtPreview={<ShirtPreview previewSurface={previewSurface} readOnly hoop={hoop} design={design} widthMm={composedWidth} heightMm={expectedHeight} shirtColor={shirtColor} shirtWidthCm={previewSurface==='rectangle'?rectangleSize.width:shirtWidthCm} surfaceHeightCm={rectangleSize.height} busy={busy} placement={placement} onPlacementChange={setPlacement} />} /> : view === 'shirt' ? <ShirtPreview previewSurface={previewSurface} reservedWidth={reservedWidth} pan={pan} zoom={zoom} onShirtWidthChange={setShirtWidthCm} onDesignWidthChange={resizeComposition} maxDesignWidth={maxComposedWidth} focusLayerId={focusLayer ? selectedLayerId : undefined} hoop={hoop} design={design} widthMm={composedWidth} heightMm={expectedHeight} shirtColor={shirtColor} shirtWidthCm={previewSurface==='rectangle'?rectangleSize.width:shirtWidthCm} surfaceHeightCm={rectangleSize.height} busy={busy} placement={placement} onPlacementChange={setPlacement} /> : <StitchesSurface selectedSvgLayer={svgPreview && svgEditScope==='layer' ? selectedLayerId : undefined} paint={svgPreview && svgTool!=='select' && (svgEditScope==='all'||svgEditTarget) ? {allImages:svgEditScope==='all',imageId:svgEditScope==='all' ? activeImage! : svgEditTarget!.imageId,tool:svgTool,color:svgEditScope==='all'?svgPaintColor:svgEditTarget!.sourceColor,radius:brushSize/100} : undefined} onPaint={edit=>{
      const section=projectRaster.sections?.find(s=>s.id===edit.imageId),layer=baseDesign?.layers.find(l=>l.id===selectedLayerId);
      const targetLoops=svgEditScope==='layer'&&section&&layer?flattenSvgPath(layer.previewPath,.5).map(loop=>loop.map(p=>({x:(p.x-section.x)/section.width,y:(p.y-section.y)/section.height}))):undefined;
      if(svgEditScope==='layer'&&!targetLoops)return;
      setArtworkEdits(previous=>[...previous,{...edit,scope:svgEditScope,targetLoops,removeWhite:settings.removeWhite}]);setBusy(true);setDownloaded(false);
    }} cuttingLayer={cuttingLayer} onCancelCut={()=>{setCuttingLayer(undefined);setFocusLayer(false);}} onCut={(id,a,b)=>{editLayer(id,{cuts:[...(layerOverrides[id]?.cuts ?? []),{a,b}]});setCuttingLayer(undefined);setFocusLayer(false);setSelectedLayer(undefined);}} selectedImages={imageSelection} onDeleteImage={setImageToDelete} reservedWidth={reservedWidth} pan={pan} zoom={zoom} solid={svgPreview} widthMm={composedWidth} heightMm={expectedHeight} maxWidthMm={maxComposedWidth} pendingScale={pendingScale} center={positioned?.center ?? { x: 0, y: 0 }} onWidthChange={resizeComposition} imageBounds={positioned?.images ?? []} selectedImage={activeImage} offsets={imageOffsets} onSelectImage={selectImage} onMoveImage={moveImage} focusLayerId={focusLayer ? selectedLayerId : undefined} design={positioned ? { ...positioned.raw, widthMm: baseDesign!.widthMm } : null} busy={busy} error={error} progress={progress} paths={paths} />}
      </section>
      <aside key={step === 'preview' ? 'preview-controls' : 'stitch-controls'} className={`ms-float-panel ms-layers-panel${rightOpen ? ' is-open' : ''}`} aria-label="Stage controls">
        <div ref={sidebarScrollRef} className="ms-sidebar-scroll">
        <div className="ms-panel-heading"><h2><span className="ms-panel-step">{step === 'upload' ? 1 : step === 'svg' ? 2 : step === 'stitches' ? 3 : step === 'preview' ? 4 : 5}</span> {step === 'upload' ? 'Upload' : step === 'svg' ? 'SVG settings' : step === 'stitches' ? 'Textile settings' : step === 'preview' ? 'Size & placement' : 'Download'}</h2><button className="ms-panel-close" aria-label="Close stage controls" onClick={() => setRightOpen(false)}><X size={17} /></button></div>

      {step === 'upload' && <section aria-label="Upload controls"><button className="ms-upload" disabled={uploading} onClick={() => fileRef.current?.click()}><Upload size={20}/><strong>Upload images</strong><small>PNG, JPG, WebP</small></button></section>}
      {step === 'setup' && <section aria-label="Final downloads"><button className="ms-download" disabled={!design || !design.stitchCount || busy || uploading || !!error} onClick={downloadSvg}><Download size={16}/>Download SVG</button><button className="ms-download" disabled={!design || !design.stitchCount || busy || uploading || !hoopFits || !!error} onClick={download}><Download size={16}/>Download PES</button></section>}
      {step !== 'setup' && step !== 'upload' && (step === 'svg' ? <section className="ms-svg-settings" aria-label="SVG shape controls">
        <section className="ms-svg-images"><h3>Project images · {imageSelection.length} selected</h3><button className="ms-add-svg-image" disabled={uploading} onClick={()=>{setReplacementId(undefined);fileRef.current?.click();}}><ImagePlus size={15}/>Add images</button>{images.map(image=><div className={`ms-svg-image-row${imageSelection.includes(image.id)?' is-selected':''}`} key={image.id}><input type="checkbox" aria-label={`Select image ${image.name}`} checked={imageSelection.includes(image.id)} onChange={()=>selectImage(image.id,true)}/><button className="ms-svg-image-name" onClick={event=>selectImage(image.id,event.shiftKey || event.metaKey || event.ctrlKey)}><img src={image.url} alt=""/><span>{image.name}</span></button><button aria-label={`Replace ${image.name}`} disabled={uploading} onClick={()=>{setReplacementId(image.id);fileRef.current?.click();}}><RefreshCw size={14}/></button><button aria-label={`Delete ${image.name}`} disabled={uploading} onClick={()=>removeImage(image.id)}><Trash2 size={14}/></button></div>)}{activeImage && <button className="ms-layer-reset" onClick={()=>moveImage(activeImage,{x:0,y:0})}>Reset position</button>}{uploadError && <p className="ms-error">{uploadError}</p>}</section>

<section className="ms-svg-edit-card" aria-label="Image conversion">        {imageSizeControl}
<section className="ms-svg-artwork-colors" aria-label="Artwork colors"><h3>Artwork colors</h3>        <PaletteControls onMergeColor={mergeColor} hidden={hiddenColors} onToggleColor={toggleColor} count={settings.imageSettings?.[imageSelection[0]]?.colors ?? settings.colors} palette={palette} onCountChange={colors => updateSvgShapes({colors})} onColorChange={changePaletteColor} /></section></section>
        <section className="ms-svg-edit-card" aria-label="Edit artwork"><h3>Edit artwork</h3><label className="ms-svg-field-label">Edit target</label><div className="ms-segmented"><label><input type="radio" name="svg-edit-scope" checked={svgEditScope==='all'} onChange={()=>{setSvgEditScope('all');setSelectedLayer(undefined);}}/><span>All layers</span></label><label><input type="radio" name="svg-edit-scope" checked={svgEditScope==='layer'} onChange={()=>setSvgEditScope('layer')}/><span>Selected layer</span></label></div>        <fieldset className="ms-control-choice"><legend>Appearance</legend><div className="ms-segmented ms-appearance-options">{([{id:'shape',label:'Fill'},{id:'perimeter',label:'Contour'},{id:'centerline',label:'Centerline'}] as const).map(option=><label key={option.id}><input type="radio" name="svg-geometry" checked={(svgEditScope==='layer'?editableLayers.find(layer=>layer.id===selectedLayerId)?.svgGeometry ?? 'shape':editableLayers[0]?.svgGeometry ?? 'shape')===option.id} disabled={svgEditScope==='layer'&&!selectedLayerId} onChange={()=>editSelectedLayers(svgEditScope==='layer'&&selectedLayerId?[selectedLayerId]:editableLayers.map(layer=>layer.id),{svgGeometry:option.id,centerline:option.id==='centerline',stitchType:option.id==='perimeter'?'running':option.id==='centerline'?'satin':'fill'})}/><span><svg viewBox="0 0 24 24" aria-hidden="true">{option.id==='centerline'?<path d="M5 19Q5 5 19 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>:<rect x="4" y="4" width="16" height="16" rx="3" fill={option.id==='shape'?'currentColor':'none'} stroke="currentColor" strokeWidth="1.5"/>}</svg>{option.label}</span></label>)}</div></fieldset>

        <fieldset className="ms-control-choice ms-detail-slider"><legend>Shape detail</legend><Slider aria-label="Shape detail" min={0} max={2} step={1} disabled={svgEditScope==='layer'&&!selectedLayerId} value={[(['simple','balanced','original'] as const).indexOf((svgEditScope==='layer'?editableLayers.find(layer=>layer.id===selectedLayerId)?.svgDetail:editableLayers[0]?.svgDetail)??'balanced')]} onValueChange={([value])=>editSelectedLayers(svgEditScope==='layer'&&selectedLayerId?[selectedLayerId]:editableLayers.map(layer=>layer.id),{svgDetail:(['simple','balanced','original'] as const)[value]})}/><div className="ms-detail-stops" aria-hidden="true"><span>Simple</span><span>Balanced</span><span>Detailed</span></div></fieldset>
<h4 className="ms-svg-field-label">Tools</h4>{svgEditScope==='layer'&&!selectedLayerId&&<p className="ms-layer-selection-hint">Choose a layer below to edit it.</p>}<div className="ms-svg-edit-tools" role="group" aria-label="Shape editing tools">{([{id:'select',label:'Select'},{id:'paint',label:'Fill brush'},{id:'erase',label:'Erase'},{id:'bucket',label:'Bucket fill'}] as const).map(tool=><button key={tool.id} aria-pressed={svgTool===tool.id} disabled={tool.id!=='select'&&svgEditScope==='layer'&&!svgEditTarget} onClick={()=>{setSvgTool(tool.id);setFocusLayer(false);}}>{tool.id==='select'?<MousePointer2 size={16}/>:tool.id==='paint'?<Paintbrush size={16}/>:tool.id==='erase'?<Eraser size={16}/>:<PaintBucket size={16}/>}<span>{tool.label}</span></button>)}</div>{svgEditScope==='all'&&(svgTool==='paint'||svgTool==='bucket')&&<div className="ms-brush-colors"><label>Brush color</label><div className="ms-color-swatches" role="group" aria-label="Brush color">{palette.map((color,i)=><button className="ms-color-swatch-button" key={i} aria-label={`Brush color ${i+1}`} aria-pressed={svgPaintColor===color.hex} onClick={()=>setSvgPaintColor(color.hex)}><span style={{background:color.hex}}/>{svgPaintColor===color.hex&&<Check size={12}/>}</button>)}</div></div>}{svgTool!=='select'&&svgTool!=='bucket'&&<><div className="ms-control-label"><label>Brush size</label><span>{brushSize}%</span></div><Slider aria-label="Brush size" min={1} max={20} step={1} value={[brushSize]} onValueChange={([size])=>setBrushSize(size)}/></>}</section>
        <section className="ms-svg-layer-editor" aria-label="SVG layers"><h3>Layers</h3>{(svgLayerSelection.length>0||!!editableLayers.find(layer=>layer.id===selectedLayerId)?.flattenMembers?.length)&&<div className="ms-svg-flatten-actions"><button disabled={!svgLayerSelection.length} onClick={()=>moveSvgLayers('up')}>Move up</button><button disabled={!svgLayerSelection.length} onClick={()=>moveSvgLayers('down')}>Move down</button><button disabled={svgLayerSelection.filter(id=>editableLayers.some(layer=>layer.id===id)).length<2} onClick={()=>{const chosen=editableLayers.filter(layer=>svgLayerSelection.includes(layer.id));const first=chosen[0];if(!first)return;const sameImage=chosen.filter(layer=>layer.itemId===first.itemId);if(sameImage.length<2)return;editLayer(first.id,{flattenMembers:[...(first.flattenMembers??[]),...sameImage.slice(1).flatMap(layer=>[layer.id,...(layer.flattenMembers??[])])],name:'Flattened layer',centerline:false});setSvgLayerSelection([first.id]);setSelectedLayer(first.id);}}>Combine</button><button disabled={!editableLayers.find(layer=>layer.id===selectedLayerId)?.flattenMembers?.length} onClick={()=>{if(selectedLayerId)editLayer(selectedLayerId,{flattenMembers:undefined,name:undefined});}}>Separate</button></div>}<div className="ms-svg-layer-list">{editableLayers.filter(layer=>imageSelection.includes(layer.itemId??'')).map(layer=><div className="ms-svg-layer-row" key={layer.id}><input type="checkbox" aria-label={`Select ${layer.name} for flattening`} checked={svgLayerSelection.includes(layer.id)} onChange={()=>setSvgLayerSelection(previous=>previous.includes(layer.id)?previous.filter(id=>id!==layer.id):[...previous,layer.id])}/><button aria-pressed={selectedLayerId===layer.id} onClick={()=>{if(selectedLayerId===layer.id){setSelectedLayer(undefined);setSvgEditTarget(undefined);setSvgTool('select');}else{setSvgEditScope('layer');setSelectedLayer(layer.id);setSvgEditTarget({imageId:layer.itemId!,color:layer.color,sourceColor:layer.sourceColor});}setFocusLayer(false);}}><svg viewBox={layer.previewBox} aria-hidden="true"><path d={layer.previewPath} fill={layer.color} fillRule="evenodd"/></svg><span className="ms-sr-only">{layer.name}</span></button><button className="ms-svg-layer-style-button" aria-label={`Change appearance of ${layer.name}`} aria-expanded={svgLayerStyleOpen===layer.id} title={layer.svgGeometry==='perimeter'?'Contour':layer.svgGeometry==='centerline'?'Centerline':'Fill'} onClick={()=>{setSvgLayerStyleOpen(previous=>previous===layer.id?undefined:layer.id);setSvgLayerColorOpen(undefined);}}><svg viewBox="0 0 24 24" aria-hidden="true">{layer.svgGeometry==='centerline'?<path d="M5 18Q5 5 19 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>:<rect x="4" y="4" width="16" height="16" rx="3" fill={layer.svgGeometry==='perimeter'?'none':'currentColor'} stroke="currentColor" strokeWidth="1.5"/>}</svg><ChevronDown size={14}/></button><button className="ms-svg-layer-color-button" aria-label={`Change color of ${layer.name}`} aria-expanded={svgLayerColorOpen===layer.id} onClick={()=>{setSvgLayerColorOpen(previous=>previous===layer.id?undefined:layer.id);setSvgLayerStyleOpen(undefined);}}><i style={{backgroundColor:layer.color}}/><ChevronDown size={14}/></button>{svgLayerStyleOpen===layer.id&&<div className="ms-svg-layer-styles" role="group" aria-label={`Appearance for ${layer.name}`}>{([{id:'shape',label:'Fill'},{id:'perimeter',label:'Contour'},{id:'centerline',label:'Centerline'}] as const).map(option=><button key={option.id} aria-label={`Use ${option.label} for ${layer.name}`} aria-pressed={(layer.svgGeometry??'shape')===option.id} onClick={()=>{editLayer(layer.id,{svgGeometry:option.id,centerline:option.id==='centerline',stitchType:option.id==='perimeter'?'running':option.id==='centerline'?'satin':'fill'});setSvgLayerStyleOpen(undefined);}}><svg viewBox="0 0 24 24" aria-hidden="true">{option.id==='centerline'?<path d="M5 18Q5 5 19 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>:<rect x="4" y="4" width="16" height="16" rx="3" fill={option.id==='shape'?'currentColor':'none'} stroke="currentColor" strokeWidth="1.5"/>}</svg><span>{option.label}</span></button>)}</div>}{svgLayerColorOpen===layer.id&&<div className="ms-svg-layer-palette" role="group" aria-label={`Available colors for ${layer.name}`}>{palette.map((color,slot)=><button key={slot} aria-label={`Use color ${slot+1} for ${layer.name}`} aria-pressed={layer.paletteSlot===slot} onClick={()=>{editLayer(layer.id,{paletteSlot:slot});if(selectedLayerId===layer.id)setSvgEditTarget({imageId:layer.itemId!,sourceColor:layer.sourceColor,color:color.hex});setSvgLayerColorOpen(undefined);}}><i style={{backgroundColor:color.hex}}/>{layer.paletteSlot===slot&&<Check size={12}/>}</button>)}</div>}</div>)}</div></section>
        <p className="ms-plan-result" role="status">{busy ? 'Updating SVG and stitches…' : error || `${design?.layers.filter(layer=>layer.visible).length ?? 0} shapes · ${usedColorCount} colors`}</p>
      </section> : step === 'preview' ? <section className="ms-hoop-choices" aria-label="Hoop sizes"><fieldset className="ms-control-choice"><legend>Preview surface</legend><div className="ms-segmented ms-surface-choices">{(['shirt','rectangle'] as const).map(value=><label key={value}><input type="radio" name="preview-surface" checked={previewSurface===value} onChange={()=>setPreviewSurface(value)}/><span><svg viewBox="0 0 80 72" aria-hidden="true">{value==='shirt' ? <><path d="M28 9 18 13 5 28 16 37 23 31V63H57V31L64 37 75 28 62 13 52 9Q40 20 28 9Z" fill="#fbf7ee" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M28 9Q40 20 52 9" fill="none" stroke="currentColor" strokeWidth="2"/></> : <rect x="15" y="9" width="50" height="54" rx="2" fill="#fbf7ee" stroke="currentColor" strokeWidth="2"/>}</svg>{value==='shirt' ? 'Shirt' : 'Rectangle'}</span></label>)}</div></fieldset><div className="ms-surface-dimensions">{previewSurface==='rectangle'?<><label>Width <span><input type="number" aria-label="Rectangle width" min={10} max={150} step={1} key={`rectangle-width-${rectangleSize.width}`} defaultValue={rectangleSize.width} onBlur={event=>{const value=Number(event.target.value);if(value>=10&&value<=150)setRectangleSize(previous=>({...previous,width:value}));}}/> cm</span></label><label>Height <span><input type="number" aria-label="Rectangle height" min={10} max={150} step={1} key={`rectangle-height-${rectangleSize.height}`} defaultValue={rectangleSize.height} onBlur={event=>{const value=Number(event.target.value);if(value>=10&&value<=150)setRectangleSize(previous=>({...previous,height:value}));}}/> cm</span></label></>:<><div className="ms-control-label"><label htmlFor="ms-shirt-width">Flat shirt width</label><span>{shirtWidthCm} cm</span></div><Slider id="ms-shirt-width" aria-label="Flat shirt width in centimeters" min={40} max={65} step={1} value={[shirtWidthCm]} onValueChange={([w])=>setShirtWidthCm(w)}/></>}</div><h3 className="ms-hoop-title">Hoop</h3>
          
          <div className="ms-hoop-choice-grid">{HOOPS.map(option => <button className="ms-hoop-choice" key={option.id} aria-label={`Choose ${option.name} hoop`} aria-pressed={hoop.id === option.id} onClick={() => { setManualHoopId(option.id); setAutoHoop(false); setDownloaded(false); }}>
            <svg viewBox="0 0 150 195" aria-hidden="true"><rect x={75 - option.widthMm / 2} y={97.5 - option.heightMm / 2} width={option.widthMm} height={option.heightMm} rx={Math.min(18, option.heightMm / 3)} fill="none" stroke="currentColor" strokeWidth="3" /></svg>
            <strong>{option.name}</strong><span>{option.widthMm} × {option.heightMm} mm</span><small>{fitsHoop(composedWidth, expectedHeight, option) ? 'Fits design' : 'Too small'}</small>
          </button>)}</div>
          <div className="ms-switch-row"><label htmlFor="ms-auto-hoop">Auto-fit hoop</label><Switch id="ms-auto-hoop" checked={autoHoop} onCheckedChange={value => { setAutoHoop(value); setManualHoopId(hoop.id); setDownloaded(false); }} /></div>
          
          <section className="ms-shirt-options" aria-label="Shirt preview controls"><div className="ms-shirt-colors"><ColorChoices label="Fabric color" value={shirtColor} choices={shirtColors} onChange={setShirtColor} /><button className="ms-center-hoop" onClick={() => setPlacement({ x: 0, y: 0 })}><RefreshCw size={14} /> Reset placement</button></div><div className="ms-preview-design-size">{dimensions}<p className={`ms-preview-fit${hoopFits ? '' : ' is-outside'}`} role="status">{composedWidth} × {Math.round(expectedHeight)} mm · {hoopFits ? 'Fits hoop' : 'Choose a larger hoop or reduce width'}</p></div></section>
        </section> : <>
        {imageSizeControl}
        <section className="ms-abstract-settings" aria-label="Canvas controls"><h3>Canvas controls</h3>        <section className="ms-stitch-preview-controls" aria-label="Stitch preview settings">
          
          {dimensions}
          <div className="ms-control-label ms-sequence-row"><label htmlFor="ms-progress">Stitch sequence</label><span>{Math.round(progress)}%</span><button className="ms-sequence-play" disabled={!design || busy} onClick={()=>{if(playing)setPlaying(false);else{if(progress>=100)setProgress(0);setPlaying(true);}}}>{playing ? <Pause size={16}/> : <Play size={16}/>} {playing ? 'Pause' : 'Play'}</button></div>
          <Slider id="ms-progress" aria-label="Preview stitch sequence" min={0} max={100} step={1} value={[Math.round(progress)]} onValueChange={([value]) => {setPlaying(false);setProgress(value);}} disabled={!design || busy} />
          <div className="ms-switch-row"><label htmlFor="ms-paths">Travel lines</label><Switch id="ms-paths" checked={paths} onCheckedChange={setPaths} /></div>
        </section></section>

        <PaletteControls onMergeColor={mergeColor} hidden={hiddenColors} onToggleColor={toggleColor} count={settings.imageSettings?.[imageSelection[0]]?.colors ?? settings.colors} palette={palette} onCountChange={colors=>updateSvgShapes({colors})} onColorChange={changePaletteColor} />

                  <section className="ms-advanced ms-stitch-defaults" aria-label="Stitch defaults"><h3>Stitch defaults</h3><div className="ms-control-label"><label htmlFor="ms-spacing">Fill row spacing</label><span>{settings.spacing.toFixed(2)} mm</span></div><Slider id="ms-spacing" aria-label="Fill row spacing" min={.3} max={1.2} step={.05} value={[settings.spacing]} onValueChange={([spacing]) => setSettings(s => ({ ...s, spacing }))} /><div className="ms-switch-row"><label htmlFor="ms-underlay">Light underlay</label><Switch id="ms-underlay" checked={settings.underlay} onCheckedChange={underlay => setSettings(s => ({ ...s, underlay }))} /></div></section>
        <ProjectLayers groups={layerGroups} onGroup={groupLayers} onUngroup={id => setLayerGroups(previous => previous.filter(group => group.id !== id))} onBulkChange={editSelectedLayers} onDelete={deleteLayers} onUndo={undoDelete} canUndo={!!lastDeleted.length} images={images} selectedImage={activeImage} onSelectImage={selectImage} onResetImage={id => moveImage(id, { x: 0, y: 0 })} onPaletteColorChange={changePaletteColor} palette={palette} layers={editableLayers.filter(layer=>imageSelection.includes(layer.itemId ?? ''))} selectedId={selectedLayerId} onSelect={setSelectedLayer} onChange={editLayer} focus={focusLayer} onFocusChange={setFocusLayer} />
        </>)}
      </div><div className="ms-sidebar-footer">
      {['svg', 'stitches', 'preview'].includes(step) && <div className="ms-stage-secondary-row"><button className="ms-previous-stage" onClick={()=>goToStep(stageOrder[stageOrder.indexOf(step)-1])}><ArrowLeft size={15}/><span>{step==='svg'?'Upload':step==='stitches'?'SVG':'Textile'}</span></button><div className="ms-edit-history" role="group" aria-label="Edit history"><button disabled={historyPosition.index <= 0} onClick={() => restoreEdit(-1)}><Undo2 size={15}/>Undo</button><button disabled={historyPosition.index >= historyPosition.count - 1} onClick={() => restoreEdit(1)}><Redo2 size={15}/>Redo</button></div></div>}
      {step === 'preview' && <div className="ms-preview-export-action" aria-label="Export and setup action"><button className="ms-process-action" disabled={!design || !design.stitchCount || busy || uploading || !hoopFits || !!error} onClick={() => goToStep('setup')}><Check size={16} /> Continue to Setup <span aria-hidden="true">→</span></button></div>}
      {step === 'svg' && <div className="ms-process-next" aria-label="Next making step"><button className="ms-process-action" disabled={!design || !design.stitchCount || busy || uploading || !!error} onClick={() => goToStep('stitches')}><Scissors size={16} />Continue to Textile<span aria-hidden="true">→</span></button></div>}
      {step === 'stitches' && <div className="ms-process-next" aria-label="Next making step"><button className="ms-process-action" disabled={!design || !design.stitchCount || busy || uploading} onClick={() => goToStep('preview')}><Eye size={16} />Check size & placement<span aria-hidden="true">→</span></button></div>}
      {step === 'svg' && <button className="ms-stage-secondary" disabled={!design || !design.stitchCount || busy || uploading || !!error} onClick={downloadSvg}><Download size={15}/>Download SVG</button>}
      {step === 'stitches' && <button className="ms-stage-secondary" disabled={!design || !design.stitchCount || busy || uploading || !hoopFits || !!error} onClick={download}><Download size={15}/>Download PES</button>}
      </div></aside>
      {['svg','stitches','preview'].includes(step) && <div className="ms-canvas-zoom" role="group" aria-label="Canvas zoom"><button aria-label="Zoom out" disabled={zoom <= .5} onClick={()=>changeZoom(zoom / 1.25)}>−</button><span aria-live="polite">{Math.round(zoom*100)}%</span><button aria-label="Zoom in" disabled={zoom >= 4} onClick={()=>changeZoom(zoom * 1.25)}>+</button><button aria-label="Reset canvas zoom" onClick={()=>{changeZoom(1);setCanvasPan(previous=>({...previous,[step]:{x:0,y:0}}));}}>Reset</button></div>}


    </div>
    <Dialog open={!!imageToDelete} onOpenChange={open=>{if(!open)setImageToDelete(undefined);}}><DialogContent className="ms-layer-edit-dialog"><DialogHeader><DialogTitle>Delete image?</DialogTitle><DialogDescription>Remove {images.find(image=>image.id===imageToDelete)?.name} and its layers from this project?</DialogDescription></DialogHeader><div className="ms-confirm-actions"><button onClick={()=>setImageToDelete(undefined)}>Cancel</button><button className="ms-confirm-delete" onClick={()=>{if(imageToDelete)removeImage(imageToDelete);setImageToDelete(undefined);}}>Delete image</button></div></DialogContent></Dialog>
    <Dialog open={review} onOpenChange={setReview}><DialogContent className="ms-review-dialog"><DialogHeader><DialogTitle>Ready for a test sew?</DialogTitle><DialogDescription>Bring your design and fabric to a Makery mentor.</DialogDescription></DialogHeader><ul><li><Check size={18} /> Confirm the design fits your installed hoop.</li><li><Check size={18} /> Match the stabilizer and needle to your fabric.</li><li><Check size={18} /> Review dense areas, small details, and travel paths.</li><li><Check size={18} /> Load thread and bobbin, and check placement.</li><li><Check size={18} /> Test on scrap before stitching the final piece.</li></ul><p>Review the selected fill and outline on scrap fabric before making the final piece. Adjust density and stabilizer with a mentor.</p></DialogContent></Dialog>
  </main>;
}
