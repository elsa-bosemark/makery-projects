import { centerlines, sampleCenterline, splitBranches, splitByCuts, type ShapeCut } from './centerline';
import { STITCH_STYLES, patternedStyle, patternPaths, fillPhase, type StitchStyle, type FillTexture } from './stitchStyles';
import { DETAIL_LEVELS, stitchRecipe, type ImageDetail, type StitchCoverage } from './stitchPlanning';
import { scanSpans, insideGeometry, clipSmoothPaths } from './smoothGeometry';
import { traceRegions } from './vtracer';
import brotherPalette from './brotherThreadPalette.json';

export type Thread = typeof brotherPalette[number] & { matchName?: string; paletteSlot?: number };
export type Stitch = { x: number; y: number; command: 'stitch' | 'jump' | 'color' | 'end'; color: number; layerId?: string; kind?: 'outline' };
export type Raster = { width: number; height: number; data: Uint8ClampedArray; sections?: { id: string; name: string; x: number; y: number; width: number; height: number }[] };
export type Settings = { layerOrder?: string[]; imageSettings?: Record<string, {size?: number; colors?: number; detail?: ImageDetail; svgGeometry?: 'shape' | 'perimeter' | 'centerline'}>; stretchY?: number; widthMm: number; colors: number; spacing: number; removeWhite: boolean; underlay: boolean; imageColors?: boolean; detail?: ImageDetail; coverage?: StitchCoverage; svgGeometry?: 'shape' | 'perimeter' | 'centerline' };
export type StitchType = StitchStyle;
export type LayerOptions = { svgGeometry?: Settings['svgGeometry']; svgDetail?: ImageDetail; flattenMembers?: string[]; fillDirection?: 'follow' | 'horizontal' | 'vertical'; manualCut?: boolean; cuts?: ShapeCut[]; explode?: boolean; satinDirection?: 'follow' | 'horizontal' | 'vertical'; centerline?: boolean; strokeWidth?: number; outline?: boolean; accentSlot?: number | null; name?: string; paletteSlot?: number; stitchType?: StitchType; spacing?: number; stitchLength?: number; direction?: 'horizontal' | 'vertical'; underlay?: boolean; visible?: boolean; passes?: number; texture?: FillTexture; patternSize?: number };
export type PaletteSettings = { hiddenSlots?: number[]; limit: number; colors: Record<number, string> };
export type LayerOverrides = Record<string, LayerOptions>;
export type EmbroideryLayer = { svgDetail?: ImageDetail; flattenMembers?: string[]; fillDirection?: 'follow' | 'horizontal' | 'vertical'; satinDirection?: 'follow' | 'horizontal' | 'vertical'; centerlinePath?: string; svgGeometry?: Settings['svgGeometry']; centerline?: boolean; strokeWidth?: number; outline?: boolean; accentSlot?: number | null; areaMm2?: number; id: string; name: string; itemId?: string; itemName?: string; sourceColor: string; color: string; paletteSlot: number; threadIndex: number; stitchType: StitchType; spacing: number; stitchLength: number; direction: 'horizontal' | 'vertical'; underlay: boolean; visible: boolean; passes: number; texture: FillTexture; patternSize: number; stitchCount: number; previewPath: string; previewBox: string; bounds: { x: number; y: number; width: number; height: number } };
export type EmbroideryDesign = {
  stitches: Stitch[]; threads: Thread[]; palette: Thread[]; widthMm: number; heightMm: number;
  stitchCount: number; jumps: number; regions: number; removed: number; layers: EmbroideryLayer[];
};

// PE900 maximum speed: https://www.brother-usa.com/p/sewing-embroidery/PE900
// This measures needle-running time only; pauses, travel, trimming, and setup are excluded.
export function estimateSewingTime(design: EmbroideryDesign, stitchesPerMinute = 650) {
  if (!Number.isFinite(stitchesPerMinute) || stitchesPerMinute < 1 || stitchesPerMinute > 650) throw new Error('Choose a PE900 speed between 1 and 650 stitches per minute.');
  let stitchCount = 0, colorChanges = 0;
  for (const stitch of design.stitches) {
    if (stitch.command === 'stitch') stitchCount++;
    if (stitch.command === 'color') colorChanges++;
  }
  return { minutes: stitchCount / stitchesPerMinute, stitchCount, colorChanges };
}

function distance(a: number[], b: number[]) { return a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0); }

// Compare colors in CIELAB, including lightness, rather than raw RGB channels.
function toLab(rgb: number[]) {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  const f = (v: number) => v > .008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  const x = f((r * .4124564 + g * .3575761 + b * .1804375) / .95047);
  const y = f(r * .2126729 + g * .7151522 + b * .072175);
  const z = f((r * .0193339 + g * .119192 + b * .9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// CIEDE2000 weights hue/chroma differences as well as perceptual lightness.
export function colorDifference(a: number[], b: number[]) {
  const radians = (v: number) => v * Math.PI / 180;
  const c1 = Math.hypot(a[1], a[2]), c2 = Math.hypot(b[1], b[2]), c = (c1 + c2) / 2;
  const g = .5 * (1 - Math.sqrt(c ** 7 / (c ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a[1], ap2 = (1 + g) * b[1], cp1 = Math.hypot(ap1, a[2]), cp2 = Math.hypot(ap2, b[2]);
  const hue = (x: number, y: number) => (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const h1 = cp1 ? hue(ap1, a[2]) : 0, h2 = cp2 ? hue(ap2, b[2]) : 0;
  let dh = h2 - h1; if (!cp1 || !cp2) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dl = b[0] - a[0], dc = cp2 - cp1, dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(radians(dh / 2));
  const l = (a[0] + b[0]) / 2, cc = (cp1 + cp2) / 2;
  const hh = !cp1 || !cp2 ? h1 + h2 : Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2;
  const t = 1 - .17 * Math.cos(radians(hh - 30)) + .24 * Math.cos(radians(2 * hh)) + .32 * Math.cos(radians(3 * hh + 6)) - .20 * Math.cos(radians(4 * hh - 63));
  const sl = 1 + .015 * (l - 50) ** 2 / Math.sqrt(20 + (l - 50) ** 2), sc = 1 + .045 * cc, sh = 1 + .015 * cc * t;
  const rt = -2 * Math.sqrt(cc ** 7 / (cc ** 7 + 25 ** 7)) * Math.sin(radians(60 * Math.exp(-(((hh - 275) / 25) ** 2))));
  return Math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dH / sh) ** 2 + rt * (dc / sc) * (dH / sh));
}
const threadLabs = brotherPalette.map(t => toLab(t.rgb));
// Recolor one sewing block without changing its stitches or its position in the sequence.
export function recolorThread(thread: Thread, hex: string): Thread {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Choose a valid thread color.');
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const lab = toLab(rgb);
  const matched = brotherPalette[threadLabs.reduce((best, candidate, i) => colorDifference(lab, candidate) < colorDifference(lab, threadLabs[best]) ? i : best, 0)];
  return { ...thread, index: matched.index, name: `Custom ${hex.toUpperCase()}`, matchName: matched.name, hex: hex.toLowerCase(), rgb };
}

export function nearestPaletteSlot(hex: string, palette: Thread[]): number {
  if (!palette.length || !/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Choose an available palette color.');
  const source = toLab([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
  return palette.reduce((best, thread, i) => colorDifference(source, toLab(thread.rgb)) < colorDifference(source, toLab(palette[best].rgb)) ? i : best, 0);
}

function projectPalette(source: Thread[], settings: PaletteSettings): Thread[] {
  if (!Number.isInteger(settings.limit) || settings.limit < 1 || settings.limit > 10) throw new Error('Choose a palette of 1 to 10 colors.');
  const colors = [...source.slice(0, settings.limit)];
  for (const thread of brotherPalette) {
    if (colors.length >= settings.limit) break;
    if (!colors.some(color => color.hex === thread.hex)) colors.push(thread);
  }
  return colors.map((thread, slot) => ({ ...(settings.colors[slot] ? recolorThread(thread, settings.colors[slot]) : thread), paletteSlot: slot }));
}

type Region = { color: number; pixels: number[]; minX: number; maxX: number; minY: number; maxY: number };
type Point = { x: number; y: number };
type Span = { low: number; high: number; scan: number; row: number };

function connectedRegions(mask: Int16Array, width: number, height: number): Region[] {
  const visited = new Uint8Array(mask.length), regions: Region[] = [];
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] < 0 || visited[p]) continue;
    const region: Region = { color: mask[p], pixels: [p], minX: width, maxX: 0, minY: height, maxY: 0 }; visited[p] = 1;
    for (let head = 0; head < region.pixels.length; head++) {
      const q = region.pixels[head], x = q % width, y = Math.floor(q / width);
      region.minX = Math.min(region.minX, x); region.maxX = Math.max(region.maxX, x);
      region.minY = Math.min(region.minY, y); region.maxY = Math.max(region.maxY, y);
      for (const n of [x > 0 ? q - 1 : -1, x < width - 1 ? q + 1 : -1, y > 0 ? q - width : -1, y < height - 1 ? q + width : -1]) {
        if (n >= 0 && !visited[n] && mask[n] === region.color) { visited[n] = 1; region.pixels.push(n); }
      }
    }
    regions.push(region);
  }
  return regions;
}

// Attach tiny antialias fragments to a nearby substantial shape. Prefer its color on ties.
// Use source-pixel thresholds so resizing does not arbitrarily regroup parts.
function groupEdgeFragments(regions: Region[], width: number): Region[] {
  const totals = new Map<number, number>();
  for (const region of regions) totals.set(region.color, (totals.get(region.color) ?? 0) + region.pixels.length);
  const substantial = regions.filter(region => region.pixels.length >= Math.max(12, (totals.get(region.color) ?? 0) * .005)).map(region => ({ ...region, pixels: [...region.pixels] }));
  const result = [...substantial], pixelSets = new Map(substantial.map(part => [part, new Set(part.pixels)]));
  for (const region of regions) {
    if (region.pixels.length >= Math.max(12, (totals.get(region.color) ?? 0) * .005)) continue;
    const candidates = substantial.filter(part => Math.max(0, part.minX - region.maxX, region.minX - part.maxX) <= 3 && Math.max(0, part.minY - region.maxY, region.minY - part.maxY) <= 3).map(part => {
      let distance = Infinity;
      for (const p of region.pixels) {
        const x = p % width, y = Math.floor(p / width);
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          if (x + dx < 0 || x + dx >= width || y + dy < 0) continue;
          if (pixelSets.get(part)!.has((y + dy) * width + x + dx)) distance = Math.min(distance, Math.hypot(dx, dy));
        }
      }
      return { part, distance };
    }).sort((a, b) => a.distance - b.distance || Number(b.part.color === region.color) - Number(a.part.color === region.color));
    const nearest = candidates[0];
    if (!nearest || nearest.distance > 3) { result.push(region); continue; }
    nearest.part.pixels.push(...region.pixels);
    nearest.part.minX = Math.min(nearest.part.minX, region.minX); nearest.part.maxX = Math.max(nearest.part.maxX, region.maxX);
    nearest.part.minY = Math.min(nearest.part.minY, region.minY); nearest.part.maxY = Math.max(nearest.part.maxY, region.maxY);
  }
  return result.sort((a, b) => a.color - b.color || b.pixels.length - a.pixels.length);
}

export function digitize(raster: Raster, settings: Settings, overrides: LayerOverrides = {}, paletteSettings: PaletteSettings = { limit: settings.colors, colors: {} }): EmbroideryDesign {
  if (settings.imageSettings && raster.sections?.length) {
    const canonical = digitize(raster,{...settings,colors:Math.max(settings.colors,...Object.values(settings.imageSettings).map(options=>options.colors ?? settings.colors)),imageSettings:undefined},overrides,paletteSettings).palette;
    const sharedPalette = {...paletteSettings,colors:{...Object.fromEntries(canonical.map((color,slot)=>[slot,color.hex])),...paletteSettings.colors}};
    const parts = raster.sections.map(section => {
      const data = new Uint8ClampedArray(raster.data.length);
      for(let y=section.y;y<section.y+section.height;y++) data.set(raster.data.subarray((y*raster.width+section.x)*4,(y*raster.width+section.x+section.width)*4),(y*raster.width+section.x)*4);
      return digitize({...raster,data,sections:[section]}, {...settings,...settings.imageSettings![section.id],imageSettings:undefined},overrides,sharedPalette);
    });
    const palette = canonical;
    const threads: Thread[] = [], stitches: Stitch[] = [], layers: EmbroideryLayer[] = [];
    for(const part of parts){
      const colorOffset=threads.length;
      if(stitches.length && part.stitches.some(s=>s.command==='stitch')) stitches.push({...stitches.at(-1)!,command:'color'});
      threads.push(...part.threads);
      layers.push(...part.layers.map(layer=>({...layer,threadIndex:layer.threadIndex<0 ? -1 : layer.threadIndex+colorOffset})));
      stitches.push(...part.stitches.filter(s=>s.command!=='end').map(s=>({...s,color:s.color+colorOffset})));
    }
    if(stitches.length)stitches.push({...stitches.at(-1)!,command:'end'});
    return { ...parts[0],palette,threads,stitches,layers:sortLayerOrder(layers,settings.layerOrder),stitchCount:stitches.filter(s=>s.command==='stitch').length,jumps:parts.reduce((sum,p)=>sum+p.jumps,0),regions:parts.reduce((sum,p)=>sum+p.regions,0),removed:parts.reduce((sum,p)=>sum+p.removed,0) };
  }
  const { width, height, data } = raster;
  if (!width || !height || data.length !== width * height * 4) throw new Error('This image could not be read. Try a PNG or JPG.');
  const heightMm = settings.widthMm * height / width;
  if (!Number.isFinite(settings.widthMm) || settings.widthMm < 10 || settings.widthMm > 125 || heightMm > 175) throw new Error('Resize the design to fit the PE900 hoop: up to 125 × 175 mm with a small margin.');
  if (!Number.isFinite(settings.spacing) || settings.spacing < .3 || settings.spacing > 1.2 || !Number.isInteger(settings.colors) || settings.colors < 1 || settings.colors > 10) throw new Error('Choose a supported stitch spacing and color count.');
  const detail = DETAIL_LEVELS.find(level => level.id === (settings.detail ?? 'original'));
  if (!detail || !['solid', 'outline', 'combined', 'light', 'pattern'].includes(settings.coverage ?? 'solid')) throw new Error('Choose a supported detail level and stitch plan.');
  const scale = settings.widthMm * 10 / width, pixelMm = scale / 10;
  const bins = new Map<string, { rgb: number[]; count: number }>();
  const visible = new Uint8Array(width * height);
  for (let p = 0; p < visible.length; p++) {
    const o = p * 4;
    if (data[o + 3] < 128 || (settings.removeWhite && Math.min(data[o], data[o + 1], data[o + 2]) > 238)) continue;
    visible[p] = 1;
    const rgb = [data[o], data[o + 1], data[o + 2]], key = rgb.map(c => Math.floor(c / 16)).join(',');
    const bin = bins.get(key);
    if (bin) { bin.count++; rgb.forEach((v, i) => { bin.rgb[i] += v; }); } else bins.set(key, { rgb, count: 1 });
  }
  const samples = [...bins.values()].map(b => ({ lab: toLab(b.rgb.map(v => v / b.count)), rgb: b.rgb.map(v => v / b.count), count: b.count })).sort((a, b) => b.count - a.count);
  if (!samples.length) throw new Error('No artwork found. Turn off “Skip white background” or choose an image with visible shapes.');
  const centers: number[][] = [[...samples[0].lab]];
  const centerRGB: number[][] = [[...samples[0].rgb]];
  while (centers.length < settings.colors && centers.length < samples.length) {
    const candidate = samples.reduce((a, b) => Math.min(...centers.map(c => distance(b.lab, c))) * Math.sqrt(b.count) > Math.min(...centers.map(c => distance(a.lab, c))) * Math.sqrt(a.count) ? b : a);
    if (Math.min(...centers.map(c => distance(candidate.lab, c))) < 9) break;
    centers.push([...candidate.lab]); centerRGB.push([...candidate.rgb]);
  }
  for (let iteration = 0; iteration < 10; iteration++) {
    const sums = centers.map(() => ({ lab: [0, 0, 0], rgb: [0, 0, 0], count: 0 }));
    for (const sample of samples) {
      const index = centers.reduce((best, c, i) => distance(sample.lab, c) < distance(sample.lab, centers[best]) ? i : best, 0);
      sums[index].count += sample.count; sample.lab.forEach((v, i) => { sums[index].lab[i] += v * sample.count; sums[index].rgb[i] += sample.rgb[i] * sample.count; });
    }
    sums.forEach((s, i) => { if (s.count) { centers[i] = s.lab.map(v => v / s.count); centerRGB[i] = s.rgb.map(v => Math.round(v / s.count)); } });
  }
  const threads: Thread[] = centers.map((c, i) => {
    const matched = brotherPalette[threadLabs.reduce((best, lab, j) => colorDifference(c, lab) < colorDifference(c, threadLabs[best]) ? j : best, 0)];
    if (!settings.imageColors) return matched;
    const rgb = centerRGB[i], hex = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
    return { ...matched, name: `Image color ${i + 1}`, matchName: matched.name, rgb, hex };
  });
  const uniqueThreads = settings.imageColors ? threads : threads.filter((t, i) => threads.findIndex(a => a.index === t.index) === i);
  const centerColors = threads.map((t, i) => settings.imageColors ? i : uniqueThreads.findIndex(u => u.index === t.index));
  const mask = new Int16Array(visible.length).fill(-1);
  for (let p = 0; p < visible.length; p++) if (visible[p]) {
    const lab = toLab([data[p * 4], data[p * 4 + 1], data[p * 4 + 2]]);
    mask[p] = centerColors[centers.reduce((best, c, i) => distance(lab, c) < distance(lab, centers[best]) ? i : best, 0)];
  }
  // Correct isolated quantization speckles without filling transparent or white gaps.
  const cleaned = mask.slice();
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = y * width + x; if (mask[p] < 0) continue;
    const votes = new Uint8Array(uniqueThreads.length);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const color = mask[p + dy * width + dx]; if (color >= 0) votes[color]++; }
    const winner = votes.reduce((best, v, i) => v > votes[best] ? i : best, 0);
    if (votes[winner] >= 6) cleaned[p] = winner;
  }
  mask.set(cleaned);
  const minPixels = Math.max(2, Math.ceil(detail.area / (pixelMm * pixelMm)));
  let removed = 0;
  for (const region of connectedRegions(mask, width, height)) {
    if (region.pixels.length >= minPixels) continue;
    const neighbors = new Map<number, number>();
    for (const p of region.pixels) {
      const x = p % width, y = Math.floor(p / width);
      for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (n >= 0 && mask[n] >= 0 && mask[n] !== region.color) neighbors.set(mask[n], (neighbors.get(mask[n]) || 0) + 1);
      }
    }
    const replacement = [...neighbors].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    region.pixels.forEach(p => { mask[p] = replacement; }); removed += region.pixels.length;
  }
  const rawRegions = connectedRegions(mask, width, height);
  const sectionFor = (region: Region) => raster.sections?.find(section => {
    const x = region.pixels[0] % width, y = Math.floor(region.pixels[0] / width);
    return x >= section.x && x < section.x + section.width && y >= section.y && y < section.y + section.height;
  });
  const originalRegions = raster.sections?.length ? raster.sections.flatMap(section => groupEdgeFragments(rawRegions.filter(region => sectionFor(region)?.id === section.id), width)) : groupEdgeFragments(rawRegions, width);
  const sourceCounts = new Map<string, number>();
  const expandedRegions = originalRegions.flatMap((region, index) => {
    const section = sectionFor(region);
    const number = section ? (sourceCounts.get(section.id) ?? 0) + 1 : index + 1;
    if (section) sourceCounts.set(section.id, number);
    const parentId = section ? `${section.id}-part-${number}` : `part-${region.color}-${region.pixels[0]}`;
    const expand = (piece: Region, id: string, inherited: LayerOptions, depth = 0): (Region & { parentId: string; partNumber: number; pieceIndex?: number; inherited: LayerOptions })[] => {
      const edit = { ...inherited, ...overrides[id] }, cuts = overrides[id]?.cuts;
      const parts = depth > 8 ? [piece] : cuts?.length ? splitByCuts(piece,width,cuts.map(cut=>({a:{x:piece.minX+cut.a.x*(piece.maxX-piece.minX+1),y:piece.minY+cut.a.y*(piece.maxY-piece.minY+1)},b:{x:piece.minX+cut.b.x*(piece.maxX-piece.minX+1),y:piece.minY+cut.b.y*(piece.maxY-piece.minY+1)}}))) : overrides[id]?.explode ? splitBranches(piece,width) : [piece];
      if(parts.length===1)return [{...piece,parentId:id,partNumber:number,inherited:edit}];
      return parts.flatMap((part,i)=>expand(part,`${id}-branch-${i+1}`,{...edit,cuts:undefined,explode:undefined,...(cuts?.length ? {} : {centerline:true,stitchType:'satin' as const}),name:`Part ${number} · Piece ${i+1}`},depth+1));
    };
    return expand(region,parentId,{});
  });
  const owners = new Map<string,string>();
  for(const region of expandedRegions)for(const member of overrides[region.parentId]?.flattenMembers ?? []) {
    const other=expandedRegions.find(candidate=>candidate.parentId===member);
    if(other && sectionFor(other)?.id===sectionFor(region)?.id && member!==region.parentId)owners.set(member,region.parentId);
  }
  const regions=expandedRegions.filter(region=>!owners.has(region.parentId)).map(region=>{
    const members=expandedRegions.filter(other=>owners.get(other.parentId)===region.parentId);
    if(!members.length)return region;
    return {...region,pixels:[...region.pixels,...members.flatMap(member=>member.pixels)],
      minX:Math.min(region.minX,...members.map(m=>m.minX)),maxX:Math.max(region.maxX,...members.map(m=>m.maxX)),
      minY:Math.min(region.minY,...members.map(m=>m.minY)),maxY:Math.max(region.maxY,...members.map(m=>m.maxY))};
  });
  const partCounts = new Map<string, number>();
  const palette = projectPalette(uniqueThreads, paletteSettings);
  const vectorRegions = traceRegions(regions, width, height, pixelMm);
  for(const detail of ['simple','original'] as const){
    if(!regions.some(region=>region.inherited.svgDetail===detail))continue;
    const traced=traceRegions(regions,width,height,pixelMm,detail);
    regions.forEach((region,index)=>{if(region.inherited.svgDetail===detail)vectorRegions[index]=traced[index];});
  }
  const planned = regions.flatMap((region, regionIndex) => {
    const section = sectionFor(region);
    const partNumber = region.partNumber;
    const id = region.pieceIndex == null ? region.parentId : `${region.parentId}-branch-${region.pieceIndex + 1}`;
    const edit = { ...region.inherited, ...overrides[id] }, sourceThread = uniqueThreads[region.color];
    if (edit.paletteSlot !== undefined && (!Number.isInteger(edit.paletteSlot) || edit.paletteSlot < 0 || edit.paletteSlot > 9)) throw new Error('Assign each part to an available palette color.');
    const previousSlot = edit.paletteSlot ?? (raster.sections?.length ? nearestPaletteSlot(sourceThread.hex, palette) : region.color);
    const previousColor = paletteSettings.colors[previousSlot] ?? uniqueThreads[previousSlot]?.hex ?? sourceThread.hex;
    const slot = previousSlot < palette.length ? previousSlot : nearestPaletteSlot(previousColor, palette);
    const thread = palette[slot], group = palette.findIndex(color => color.hex === thread.hex);
    if (edit.accentSlot !== undefined && edit.accentSlot !== null && (!Number.isInteger(edit.accentSlot) || edit.accentSlot < 0 || edit.accentSlot > 7)) throw new Error('Choose an available accent thread color.');
    const recipe = stitchRecipe(settings.coverage ?? 'solid', region.pixels.length * pixelMm * pixelMm, region.color, settings.spacing, settings.underlay);
    const accentSlot = edit.accentSlot !== undefined && edit.accentSlot !== null && edit.accentSlot < palette.length ? edit.accentSlot : null;
    const hasAccent = patternedStyle(edit.stitchType ?? recipe.stitchType) && accentSlot !== null && palette[accentSlot].hex !== thread.hex;
    const part = { region, regionIndex, id, edit, sourceThread, slot, thread, group, section, partNumber, recipe, accentSlot, hasAccent, accentPass: false };
    return hasAccent ? [part, { ...part, thread: palette[accentSlot!], group: palette.findIndex(color => color.hex === palette[accentSlot!].hex), accentPass: true }] : [part];
  }).sort((a, b) => a.group - b.group || a.regionIndex - b.regionIndex);
  const stitches: Stitch[] = [], usedThreads: Thread[] = [], layers: EmbroideryLayer[] = [];
  let current = '', jumps = 0, activeLayer = '', stitchLength = 25;
  let stitchKind: 'outline' | undefined;
  const point = (x: number, y: number): Point => ({ x: Math.round((x - width / 2) * scale), y: Math.round((y - height / 2) * scale) });
  const append = (p: Point, command: Stitch['command'], layerId = activeLayer) => {
    const last = stitches[stitches.length - 1];
    if (command === 'stitch' && last?.command === 'stitch' && last.x === p.x && last.y === p.y && last.layerId === layerId) return;
    stitches.push({ ...p, command, color: usedThreads.length - 1, layerId, ...(stitchKind ? {kind:stitchKind} : {}) });
    if (stitches.length > 65000) throw new Error('This image creates too many stitches. Try Outline, increase row spacing, or reduce the design size.');
  };
  const stitchLine = (a: Point, b: Point) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / stitchLength));
    let previous = a;
    for (let i = 1; i <= steps; i++) {
      const next = { x: Math.round(a.x + (b.x - a.x) * i / steps), y: Math.round(a.y + (b.y - a.y) * i / steps) };
      // Integer machine coordinates can round a diagonal just past its length limit.
      if (Math.hypot(next.x - previous.x, next.y - previous.y) > stitchLength + 1e-8) append({ x: Math.round((previous.x + next.x) / 2), y: Math.round((previous.y + next.y) / 2) }, 'stitch');
      append(next, 'stitch'); previous = next;
    }
  };
  const tieOff = () => {
    const last = stitches[stitches.length - 1], prev = stitches[stitches.length - 2];
    if (!last || !prev || last.command !== 'stitch' || prev.color !== last.color || last.layerId !== activeLayer) return;
    const len = Math.hypot(prev.x - last.x, prev.y - last.y), t = Math.min(1, 5 / (len || 1));
    append({ x: Math.round(last.x + (prev.x - last.x) * t), y: Math.round(last.y + (prev.y - last.y) * t) }, 'stitch', last.layerId); append(last, 'stitch', last.layerId);
  };
  const fillLine = (a: Point, b: Point, row: number, vertical: boolean, texture: FillTexture) => {
    const from = vertical ? a.y : a.x, to = vertical ? b.y : b.x, direction = Math.sign(to - from), phase = fillPhase(row, stitchLength, texture);
    const stops: number[] = [];
    for (let v = Math.ceil((Math.min(from, to) - phase) / stitchLength) * stitchLength + phase; v < Math.max(from, to); v += stitchLength) {
      if (Math.abs(v - from) >= 5 && Math.abs(v - to) >= 5) stops.push(v);
    }
    if (direction < 0) stops.reverse();
    let last = a;
    for (const stop of stops) { const next = vertical ? { x: a.x, y: Math.round(stop) } : { x: Math.round(stop), y: a.y }; stitchLine(last, next); last = next; }
    stitchLine(last, b);
  };
  for (const { region, regionIndex, id, edit, sourceThread, slot, thread, section, partNumber, recipe, accentSlot, hasAccent, accentPass } of planned) {
    const svgGeometry = edit.svgGeometry ?? settings.svgGeometry;
    const geometry = vectorRegions[regionIndex];
    const existingLayer = layers.find(layer => layer.id === id);
    const useCenterline = edit.centerline ?? (edit.stitchType == null && svgGeometry === 'centerline' || (svgGeometry !== 'perimeter' && edit.stitchType == null && settings.coverage !== 'outline' && (Math.max(region.maxX-region.minX+1,region.maxY-region.minY+1) / Math.max(1,Math.min(region.maxX-region.minX+1,region.maxY-region.minY+1)) > 6 || regions.filter(other => other !== region && other.color === region.color && Math.abs((other.minY + other.maxY) - (region.minY + region.maxY)) < (region.maxY - region.minY + 1) * .5 && (other.maxY - other.minY + 1) / (region.maxY - region.minY + 1) > .65 && (other.maxY - other.minY + 1) / (region.maxY - region.minY + 1) < 1.5).length >= 4)));
    const layer: EmbroideryLayer = existingLayer ?? {
      centerline: useCenterline, svgGeometry, svgDetail: edit.svgDetail ?? settings.detail ?? 'balanced',
      centerlinePath: svgGeometry === 'centerline' ? centerlines(region,width).map(path => {
        const points = sampleCenterline(path, 2);
        if (points.length < 2) return '';
        return `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}` + points.slice(1,-1).map((p,i) => `Q${p.x.toFixed(2)} ${p.y.toFixed(2)} ${((p.x+points[i+2].x)/2).toFixed(2)} ${((p.y+points[i+2].y)/2).toFixed(2)}`).join('') + `L${points.at(-1)!.x.toFixed(2)} ${points.at(-1)!.y.toFixed(2)}`;
      }).join('') : undefined,
      flattenMembers: edit.flattenMembers, fillDirection: edit.fillDirection ?? edit.direction ?? 'follow', satinDirection: edit.satinDirection ?? 'follow', strokeWidth: edit.strokeWidth,
      outline: edit.outline ?? recipe.outline, areaMm2: region.pixels.length * pixelMm * pixelMm, accentSlot, id, name: edit.name?.trim() || `Part ${partNumber}`, itemId: section?.id, itemName: section?.name, sourceColor: sourceThread.hex, color: palette[slot].hex, paletteSlot: slot, threadIndex: -1,
      stitchType: edit.stitchType ?? (svgGeometry === 'perimeter' ? 'running' : useCenterline ? 'satin' : recipe.stitchType), spacing: edit.spacing ?? recipe.spacing, stitchLength: edit.stitchLength ?? (edit.stitchType === 'satin' || useCenterline ? 7 : recipe.stitchLength),
      direction: edit.fillDirection && edit.fillDirection !== 'follow' ? edit.fillDirection : edit.direction ?? recipe.direction, underlay: edit.underlay ?? recipe.underlay, visible: (edit.visible ?? true) && !paletteSettings.hiddenSlots?.includes(slot), passes: edit.passes ?? 1, texture: edit.texture ?? 'brick', patternSize: edit.patternSize ?? recipe.patternSize, stitchCount: 0,
      previewPath: geometry.path, previewBox: `${region.minX} ${region.minY} ${region.maxX - region.minX + 1} ${region.maxY - region.minY + 1}`,
      bounds: { x: (region.minX - width / 2) * pixelMm, y: (region.minY - height / 2) * pixelMm, width: (region.maxX - region.minX + 1) * pixelMm, height: (region.maxY - region.minY + 1) * pixelMm }
    };
    if (!STITCH_STYLES.some(style => style.id === layer.stitchType) || !Number.isFinite(layer.spacing) || layer.spacing < .3 || layer.spacing > 1.2 || !Number.isFinite(layer.stitchLength) || layer.stitchLength < 1 || layer.stitchLength > (layer.stitchType === 'satin' ? 7 : 4) || !['brick', 'twill', 'diamond', 'random'].includes(layer.texture) || !Number.isFinite(layer.patternSize) || layer.patternSize < 1 || layer.patternSize > 12 || !Number.isInteger(layer.passes) || layer.passes < 1 || layer.passes > 3) throw new Error('Choose supported stitch properties for each layer.');
    if (!existingLayer) layers.push(layer);
    if (!layer.visible) continue;
    activeLayer = id; stitchLength = layer.stitchLength * 10;
    let began = false;
    const begin = () => {
      if (began) return;
      const key = thread.hex;
      if (current !== key) {
        if (stitches.length) { tieOff(); append(stitches[stitches.length - 1], 'color'); }
        usedThreads.push(thread); current = key;
      }
      if (!accentPass) layer.threadIndex = usedThreads.length - 1; began = true;
    };
    const sewOutline = () => {
      stitchKind = 'outline';
      for (const outline of geometry.loops) {
        begin(); tieOff();
        const points = outline.map(p => point(p.x, p.y));
        append(points[0], 'jump'); jumps++; append(points[0], 'stitch');
        const outlineStitch = (p: Point) => {
          const previous = stitches[stitches.length - 1]; append(p, 'stitch');
          if (layer.stitchType === 'bean' && previous && (previous.x !== p.x || previous.y !== p.y)) { append(previous, 'stitch'); append(p, 'stitch'); }
        };
        for (let repeat = 0; repeat < layer.passes; repeat++) {
          // Resample along the contour so image pixels do not become tiny needle steps.
          let remaining = stitchLength;
          for (let i = 1; i < points.length; i++) {
            let a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
            while (length >= remaining && length > 0) {
              const t = remaining / length, next = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
              outlineStitch({ x: Math.round(next.x), y: Math.round(next.y) });
              a = next; length = Math.hypot(b.x - a.x, b.y - a.y); remaining = stitchLength;
            }
            remaining -= length;
          }
          outlineStitch(points[points.length - 1]);
        }
        tieOff();
      }
    };
    const fillPaths = layer.stitchType === 'fill' && layer.fillDirection === 'follow' && geometry.loops.length === 1 && (region.pixels.length / ((region.maxX-region.minX+1)*(region.maxY-region.minY+1)) < .5 || Math.max(region.maxX-region.minX+1,region.maxY-region.minY+1)/Math.max(1,Math.min(region.maxX-region.minX+1,region.maxY-region.minY+1)) > 2) ? centerlines(region,width) : [];
    const followFill = fillPaths.some(path=>path.slice(1).reduce((length,p,i)=>length+Math.hypot(p.x-path[i].x,p.y-path[i].y),0)>Math.sqrt(region.pixels.length)*1.5);
    if (layer.centerline || followFill) {
      if (layer.strokeWidth != null && (!Number.isFinite(layer.strokeWidth) || layer.strokeWidth < .3 || layer.strokeWidth > 7)) throw new Error('Stroke width must be between 0.3 and 7 mm.');
      const paths = followFill ? fillPaths : centerlines(region, width);
      if (paths.length) {
        const edgeDistance = (p: Point, dx: number, dy: number) => {
          let distance = 0;
          const step = Math.max(.15, .04 / pixelMm);
          while (distance < (followFill ? Math.max(width,height) : 7 / pixelMm) && insideGeometry(geometry.loops, { x: p.x + dx * (distance + step), y: p.y + dy * (distance + step) })) distance += step;
          return distance;
        };
        for (const path of paths) {
          const samples = sampleCenterline(path, Math.max(.25, layer.spacing / pixelMm / (followFill ? 1 : 2)));
          if (samples.length < 2) continue;
          begin(); tieOff(); append(point(samples[0].x, samples[0].y), 'jump'); jumps++;
          append(point(samples[0].x, samples[0].y), 'stitch');
          if (layer.stitchType === 'running' || layer.stitchType === 'bean') {
            for (let pass = 0; pass < layer.passes; pass++) {
              const points = sampleCenterline(pass % 2 ? path.slice().reverse() : path, layer.stitchLength / pixelMm);
              for (const p of points.slice(1)) stitchLine(stitches[stitches.length-1],point(p.x,p.y));
            }
            tieOff(); continue;
          }
          if (layer.underlay) {
            const support = sampleCenterline(path, 2 / pixelMm);
            for (const p of support.slice(1)) { const last = stitches[stitches.length - 1]; stitchLine(last, point(p.x, p.y)); }
            for (const p of support.slice().reverse().slice(1)) { const last = stitches[stitches.length - 1]; stitchLine(last, point(p.x, p.y)); }
          }
          for (let i = 0; i < samples.length; i++) {
            const p = samples[i], before = samples[Math.max(0,i-1)], after = samples[Math.min(samples.length-1,i+1)];
            const length = Math.hypot(after.x-before.x, after.y-before.y); if (!length) continue;
            const nx = layer.satinDirection === 'horizontal' ? 1 : layer.satinDirection === 'vertical' ? 0 : -(after.y-before.y)/length, ny = layer.satinDirection === 'horizontal' ? 0 : layer.satinDirection === 'vertical' ? 1 : (after.x-before.x)/length;
            const side = i % 2 ? -1 : 1;
            const radius = layer.strokeWidth != null ? layer.strokeWidth / pixelMm / 2 : edgeDistance(p,nx*side,ny*side);
            const target = point(p.x + nx * side * radius, p.y + ny * side * radius);
            if(followFill){
              const otherRadius=edgeDistance(p,-nx*side,-ny*side);
              const other=point(p.x-nx*side*otherRadius,p.y-ny*side*otherRadius);
              stitchLine(stitches[stitches.length-1],other);
              stitchLine(stitches[stitches.length-1],target);
            } else stitchLine(stitches[stitches.length-1],target);
          }
          tieOff();
        }
        if (layer.outline) sewOutline();
        stitchKind = undefined; continue;
      }
    }
    if (layer.stitchType === 'running' || layer.stitchType === 'bean') { sewOutline(); stitchKind = undefined; continue; }
    if (patternedStyle(layer.stitchType)) {
      const outlines = geometry.loops.map(path => path.map(p => ({ x: (p.x - width / 2) * pixelMm, y: (p.y - height / 2) * pixelMm })));
      // Split alternating pattern paths between two shared colors before clipping.
      // This adds variety without sewing a second full fill over the same shape.
      const pattern = patternPaths(layer.stitchType, layer.bounds, layer.patternSize, layer.direction === 'vertical', outlines);
      const coloredPaths = hasAccent ? pattern.filter((_, index) => (index % 2 === 1) === accentPass) : pattern;
      const paths = [...(layer.outline && !accentPass ? outlines : []), ...clipSmoothPaths(coloredPaths, outlines)];
      for (const path of paths) {
        const pts = path.map(p => ({ x: Math.round(p.x * 10), y: Math.round(p.y * 10) }));
        if (pts.length < 2 || pts.every(p => p.x === pts[0].x && p.y === pts[0].y)) continue;
        begin(); tieOff(); append(pts[0], 'jump'); jumps++; append(pts[0], 'stitch');
        let previous = pts[0];
        for (const p of pts.slice(1)) { stitchLine(previous, p); previous = p; }
        tieOff();
      }
      continue;
    }
    // The support layer is perpendicular to the top fill, rather than duplicating its rows.
    for (const pass of layer.underlay ? [{ vertical: layer.stitchType === 'satin' ? layer.direction === 'vertical' : layer.direction !== 'vertical', spacing: 2.4, support: true }, { vertical: layer.direction === 'vertical', spacing: layer.spacing, support: false }] : [{ vertical: layer.direction === 'vertical', spacing: layer.spacing, support: false }]) {
      stitchLength = (pass.support ? Math.min(2.5, layer.stitchLength) : layer.stitchLength) * 10;
      // Track overlapping runs down successive rows. A hole splits tracks, avoiding
      // the old left/right/left/right jumps across a gap on every row.
      const tracks: Span[][] = []; let active: number[] = [];
      const step = pass.spacing * (layer.stitchType === 'satin' && !pass.support ? 5 : 10) / scale, min = pass.vertical ? region.minX : region.minY, max = pass.vertical ? region.maxX : region.maxY;
      for (let scan = min + Math.min(.5, step / 2), row = 0; scan < max + 1; scan += step, row++) {
        const runs = scanSpans(geometry.loops, scan, pass.vertical).filter(([low, high]) => (high - low) * scale >= 4), spans = runs.map(([low, high]) => ({ low, high, scan, row }));
        const candidates: { track: number; span: number; overlap: number }[] = [];
        for (const track of active) {
          const prev = tracks[track][tracks[track].length - 1];
          spans.forEach((span, i) => { const overlap = Math.min(prev.high, span.high) - Math.max(prev.low, span.low); if (overlap > 0) candidates.push({ track, span: i, overlap }); });
        }
        candidates.sort((a, b) => b.overlap - a.overlap);
        const matchedTracks = new Set<number>(), assigned = new Map<number, number>();
        for (const c of candidates) if (!matchedTracks.has(c.track) && !assigned.has(c.span)) { matchedTracks.add(c.track); assigned.set(c.span, c.track); }
        active = spans.map((span, i) => { const track = assigned.get(i) ?? tracks.push([]) - 1; tracks[track].push(span); return track; });
      }
      const endpoints = (span: Span) => pass.vertical ? [point(span.scan, span.low), point(span.scan, span.high)] : [point(span.low, span.scan), point(span.high, span.scan)];
      const remaining = new Set(tracks.map((_, i) => i));
      while (remaining.size) {
        const previous = stitches[stitches.length - 1] ?? { x: 0, y: 0 };
        let best = -1, flip = false, reverse = false, bestDistance = Infinity;
        for (const i of remaining) for (const bottom of [false, true]) {
          const span = bottom ? tracks[i][tracks[i].length - 1] : tracks[i][0];
          endpoints(span).forEach((p, side) => { const d = Math.hypot(p.x - previous.x, p.y - previous.y); if (d < bestDistance) { bestDistance = d; best = i; flip = bottom; reverse = side === 1; } });
        }
        remaining.delete(best); const track = flip ? [...tracks[best]].reverse() : tracks[best];
        let previousSpan: Span | undefined;
        for (const span of track) {
          let [a, b] = endpoints(span); if (reverse) [a, b] = [b, a];
          begin();
          const last = stitches[stitches.length - 1];
          const inside = (from: Point, to: Point) => {
            const samples = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (scale * .25)));
            for (let i = 0; i <= samples; i++) {
              const x = (from.x + (to.x - from.x) * i / samples) / scale + width / 2;
              const y = (from.y + (to.y - from.y) * i / samples) / scale + height / 2;
              if (!insideGeometry(geometry.loops, { x, y })) return false;
            }
            return true;
          };
          if (layer.stitchType === 'satin' && pass.support) {
            // Center-walk support follows the column instead of filling across it.
            const center = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
            if (previousSpan && last?.command === 'stitch' && last.layerId === id && inside(last, center)) stitchLine(last, center);
            else { tieOff(); append(center, 'jump'); jumps++; append(center, 'stitch'); }
            previousSpan = span; continue;
          }
          if (layer.stitchType === 'satin' && !pass.support) {
            const satinLine = (from: Point, to: Point) => {
              const length = Math.hypot(to.x - from.x, to.y - from.y);
              if (length <= stitchLength) { stitchLine(from, to); return; }
              // Stagger split penetrations rather than making a groove down the middle.
              const divisions = Math.ceil(length / (stitchLength * .85));
              let previous = from;
              for (let i = 1; i < divisions; i++) {
                const offset = (span.row % 3 - 1) * .15;
                const t = (i + offset) / divisions;
                const next = { x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) };
                stitchLine(previous, next); previous = next;
              }
              stitchLine(previous, to);
            };
            if (last?.command === 'stitch' && last.layerId === id && last.color === usedThreads.length - 1 && previousSpan && inside(last, b)) satinLine(last, b);
            else { tieOff(); append(a, 'jump'); jumps++; append(a, 'stitch'); satinLine(a, b); }
            reverse = !reverse; previousSpan = span; continue;
          }
          let connection: Point[] | null = null;
          if (last?.command === 'stitch' && last.layerId === id && last.color === usedThreads.length - 1) {
            if (Math.hypot(a.x - last.x, a.y - last.y) <= 50 && inside(last, a)) connection = [a];
            else if (previousSpan) {
              const low = Math.max(previousSpan.low, span.low), high = Math.min(previousSpan.high, span.high);
              const lastColumn = (pass.vertical ? last.y : last.x) / scale + (pass.vertical ? height : width) / 2;
              const column = Math.max(low, Math.min(high, lastColumn));
              const turn1 = pass.vertical ? point(previousSpan.scan, column) : point(column, previousSpan.scan);
              const turn2 = pass.vertical ? point(span.scan, column) : point(column, span.scan);
              const length = Math.hypot(turn1.x - last.x, turn1.y - last.y) + Math.hypot(turn2.x - turn1.x, turn2.y - turn1.y) + Math.hypot(a.x - turn2.x, a.y - turn2.y);
              if (high > low && length <= 80 && inside(last, turn1) && inside(turn1, turn2) && inside(turn2, a)) connection = [turn1, turn2, a];
            }
          }
          if (connection && last) { let from: Point = last; for (const to of connection) { stitchLine(from, to); from = to; } } else {
            tieOff(); append(a, 'jump'); jumps++; append(a, 'stitch');
            const len = Math.hypot(b.x - a.x, b.y - a.y), t = Math.min(1, 5 / (len || 1));
            append({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) }, 'stitch'); append(a, 'stitch');
          }
          fillLine(a, b, span.row, pass.vertical, pass.support ? 'brick' : layer.texture); reverse = !reverse; previousSpan = span;
        }
      }
    }
    if (began) tieOff();
    if (layer.outline && (layer.stitchType === 'fill' || layer.stitchType === 'satin')) { stitchLength = Math.min(2.5, layer.stitchLength) * 10; sewOutline(); stitchKind = undefined; }
  }
  if (!usedThreads.length && layers.some(layer => layer.visible)) throw new Error('The artwork is too small or detailed to stitch. Try larger, simpler shapes.');
  if (stitches.length) append(stitches[stitches.length - 1], 'end');
  const layerMap = new Map(layers.map(layer => [layer.id, layer]));
  for (const stitch of stitches) if (stitch.command === 'stitch') { const layer = layerMap.get(stitch.layerId); if (layer) layer.stitchCount++; }
  const sourceOrder = new Map(planned.map(part => [part.id, part.regionIndex]));
  layers.sort((a, b) => sourceOrder.get(a.id)! - sourceOrder.get(b.id)!);
  if (usedThreads.length > paletteSettings.limit) throw new Error('The design exceeds the selected palette size. Assign parts to shared colors.');
  return { stitches, threads: usedThreads, palette, widthMm: settings.widthMm, heightMm, stitchCount: stitches.filter(s => s.command === 'stitch').length, jumps, regions: regions.length, removed, layers:sortLayerOrder(layers,settings.layerOrder) };
}

// PES v1 + embedded PEC encoder, adapted from MIT-licensed EmbroidePy/pyembroidery.
// Copyright (c) 2018. Full license: public/embroidery/THIRD-PARTY-LICENSE.txt.
class Bytes {
  data: number[] = [];
  u8(n: number) { this.data.push(n & 255); }
  u16(n: number) { this.u8(n); this.u8(n >> 8); }
  u24(n: number) { this.u16(n); this.u8(n >> 16); }
  u32(n: number) { this.u24(n); this.u8(n >> 24); }
  text(s: string) { this.data.push(...new TextEncoder().encode(s)); }
  zeros(n: number) { for (let i = 0; i < n; i++) this.u8(0); }
  f32(n: number) { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, n, true); this.data.push(...new Uint8Array(b)); }
  patch(pos: number, n: number, bytes: number) { for (let i = 0; i < bytes; i++) this.data[pos + i] = (n >> (i * 8)) & 255; }
}

export function writePes(design: EmbroideryDesign, name = 'Makery'): Uint8Array {
  const { stitches, threads } = design;
  if (!stitches.length || !threads.length) throw new Error('Generate a design before exporting.');
  const xs = stitches.map(s => s.x), ys = stitches.map(s => s.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  if (w > 1300 || h > 1800) throw new Error('The stitch design exceeds the PE900 hoop.');
  const f = new Bytes();
  f.text('#PES0001'); const pecPointer = f.data.length; f.u32(0);
  f.u16(1); f.u16(1); f.u16(1); f.u16(0xffff); f.u16(0);
  f.u16(7); f.text('CEmbOne'); f.zeros(16);
  [1, 0, 0, 1, 1000 - w / 2, 1000 + h / 2].forEach(n => f.f32(n));
  f.u16(1); f.u16(0); f.u16(0); f.u16(w); f.u16(h); f.zeros(8);
  const sectionPointer = f.data.length; f.u16(0); f.u16(0xffff); f.u16(0);
  f.u16(7); f.text('CSewSeg');
  const log: [number, number][] = [];
  let section = 0, previousColor = -1, last = { x: 0, y: 0 };
  for (let i = 0; i < stitches.length;) {
    const first = stitches[i];
    if (first.command !== 'stitch' && first.command !== 'jump') { i++; continue; }
    const block: Stitch[] = [];
    while (i < stitches.length && stitches[i].command === first.command && stitches[i].color === first.color) block.push(stitches[i++]);
    const points = first.command === 'jump' ? [last, block[block.length - 1]] : block;
    const code = threads[first.color].index;
    if (section) f.u16(0x8003);
    if (first.color !== previousColor) { log.push([section, code]); previousColor = first.color; }
    f.u16(first.command === 'jump' ? 1 : 0); f.u16(code); f.u16(points.length);
    for (const p of points) { f.u16(p.x - minX); f.u16(p.y - maxY); }
    if (first.command === 'stitch') last = block[block.length - 1];
    section++;
  }
  f.u16(log.length); log.forEach(([s, c]) => { f.u16(s); f.u16(c); });
  f.patch(sectionPointer, section, 2); f.zeros(4);
  const pecStart = f.data.length; f.patch(pecPointer, pecStart, 4);
  const label = name.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 8) || 'Makery';
  f.text(`LA:${label.padEnd(16, ' ')}\r`); f.text(' '.repeat(12)); f.u8(255); f.u8(0); f.u8(6); f.u8(38);
  f.text(' '.repeat(12)); f.u8(threads.length - 1); threads.forEach(t => f.u8(t.index));
  f.text(' '.repeat(463 - threads.length));
  const stitchStart = f.data.length; f.zeros(2); f.u24(0); f.u8(0x31); f.u8(255); f.u8(0xf0);
  f.u16(w); f.u16(h); f.u16(0x1e0); f.u16(0x1b0);
  const value = (n: number, flag = 0) => {
    if (!flag && n > -64 && n < 63) f.u8(n & 127);
    else { const encoded = (n & 4095) | 0x8000 | (flag << 8); f.u8(encoded >> 8); f.u8(encoded); }
  };
  let x = 0, y = 0, alternate = true, init = true, jumping = true;
  for (const s of stitches) {
    const dx = s.x - x, dy = s.y - y; x = s.x; y = s.y;
    if (s.command === 'stitch') {
      if (jumping && dx !== 0 && dy !== 0) { value(0); value(0); }
      jumping = false; value(dx); value(dy);
    } else if (s.command === 'jump') { jumping = true; value(dx, init ? 0x10 : 0x20); value(dy, init ? 0x10 : 0x20); }
    else if (s.command === 'color') {
      if (jumping) { value(0); value(0); jumping = false; }
      f.u8(0xfe); f.u8(0xb0); f.u8(alternate ? 2 : 1); alternate = !alternate;
    } else { f.u8(255); break; }
    init = false;
  }
  f.patch(stitchStart + 2, f.data.length - stitchStart, 3);
  // Each PEC thumbnail is 48×38 bits. Include the full pattern and each color block.
  const icon = (color?: number) => {
    const image = new Uint8Array(228), scale = Math.min(40 / (w || 1), 30 / (h || 1));
    let prev: Stitch | undefined;
    const dot = (xx: number, yy: number) => { const px = Math.round((xx - (minX + maxX) / 2) * scale + 23), py = Math.round((yy - (minY + maxY) / 2) * scale + 18); if (px >= 0 && px < 48 && py >= 0 && py < 38) image[py * 6 + Math.floor(px / 8)] |= 1 << (px % 8); };
    for (const s of stitches) {
      if (s.command === 'stitch' && (color === undefined || s.color === color)) {
        if (prev && prev.command === 'stitch' && prev.color === s.color) { const steps = Math.max(1, Math.ceil(Math.hypot(s.x - prev.x, s.y - prev.y) * scale)); for (let i = 0; i <= steps; i++) dot(prev.x + (s.x - prev.x) * i / steps, prev.y + (s.y - prev.y) * i / steps); }
        dot(s.x, s.y);
      }
      prev = s;
    }
    image.forEach(b => f.u8(b));
  };
  icon(); threads.forEach((_, i) => icon(i));
  return new Uint8Array(f.data);
}

export function sortLayerOrder<T extends {id:string}>(layers:T[],order:string[]=[]):T[]{
 const rank=new Map(order.map((id,i)=>[id,i]));
 return [...layers].sort((a,b)=>(rank.get(a.id)??order.length)-(rank.get(b.id)??order.length));
}
