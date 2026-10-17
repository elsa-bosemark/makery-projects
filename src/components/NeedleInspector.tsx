import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Crosshair } from 'lucide-react';
import { needlePoints, coordinateCsv, type NeedlePoint } from '@/lib/stitchInspection';
import type { EmbroideryDesign } from '@/lib/embroidery';

export default function NeedleInspector({ design, layerId, name, selectedIndex, onSelect, onInspect }: {
  design: EmbroideryDesign; layerId: string; name: string; selectedIndex?: number;
  onSelect: (index: number) => void; onInspect: () => void;
}) {
  const points = useMemo(() => needlePoints(design).filter(point => point.layerId === layerId), [design, layerId]);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const selectedPosition = points.findIndex(point => point.commandIndex === selectedIndex);
  const selected = points[selectedPosition];
  useEffect(() => { if (selectedPosition >= 0) { setPage(Math.floor(selectedPosition / 50)); setOpen(true); } }, [selectedIndex, selectedPosition]);
  const choose = (point: NeedlePoint) => { onInspect(); onSelect(point.commandIndex); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([coordinateCsv(points)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}-needle-coordinates.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const pageCount = Math.max(1, Math.ceil(points.length / 50)), activePage = Math.min(page, pageCount - 1);
  return <section className="ms-needle-inspector" aria-label={`Needle coordinates for ${name}`}>
    <button className="ms-needle-heading" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) { onInspect(); if (points.length) onSelect(points[0].commandIndex); } }}><Crosshair size={14} /><span>Needle coordinates</span><small>{points.length.toLocaleString()} points</small></button>
    {open && <>
      <p className="ms-layer-help">Hoop center = (0, 0) · millimeters.<br />X → right · Y ↓ down. Jumps do not pierce fabric.</p>
      {selected && <div className="ms-needle-current" role="status"><strong>Needle #{selected.number.toLocaleString()}</strong><span>X {selected.x.toFixed(1)} · Y {selected.y.toFixed(1)} mm</span><small>{selected.length.toFixed(2)} mm from the previous position</small><div><button aria-label="Previous needle point" disabled={selectedPosition <= 0} onClick={() => choose(points[selectedPosition - 1])}><ChevronLeft size={14} /> Previous</button><button aria-label="Next needle point" disabled={selectedPosition >= points.length - 1} onClick={() => choose(points[selectedPosition + 1])}>Next <ChevronRight size={14} /></button></div></div>}
      {!points.length ? <p className="ms-layer-help">This layer has no needle points. Show the layer to generate them.</p> : <>
        <div className="ms-coordinate-table"><table><thead><tr><th>Needle</th><th>X mm</th><th>Y mm</th></tr></thead><tbody>{points.slice(activePage * 50, (activePage + 1) * 50).map(point => <tr key={point.commandIndex} className={point.commandIndex === selectedIndex ? 'is-selected' : ''}><td><button aria-label={`Select needle ${point.number}`} aria-pressed={point.commandIndex === selectedIndex} onClick={() => choose(point)}>#{point.number.toLocaleString()}</button></td><td>{point.x.toFixed(1)}</td><td>{point.y.toFixed(1)}</td></tr>)}</tbody></table></div>
        <div className="ms-coordinate-pages"><button aria-label="Previous coordinate page" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}><ChevronLeft size={13} /></button><span>{activePage * 50 + 1}–{Math.min(points.length, (activePage + 1) * 50)} of {points.length.toLocaleString()}</span><button aria-label="Next coordinate page" disabled={activePage === pageCount - 1} onClick={() => setPage(activePage + 1)}><ChevronRight size={13} /></button></div>
        <button className="ms-coordinate-download" onClick={download}><Download size={13} /> Download layer coordinates</button>
      </>}
    </>}
  </section>;
}
