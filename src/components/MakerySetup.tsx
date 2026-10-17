import { type ReactNode } from 'react';
import { ArrowRight, Check, Download, Usb, Users } from 'lucide-react';
import type { EmbroideryDesign } from '@/lib/embroidery';
import type { Hoop } from '@/lib/hoops';

const manual = 'https://download.brother.com/welcome/doch102511/888_k80_l80_l82_om01en.pdf';

export default function MakerySetup({ design, hoop, shirtPreview, ready, busy, downloaded, error, onDownload, onDownloadSvg, onReview, onEditPlacement }: {
  design: EmbroideryDesign | null; hoop: Hoop; shirtPreview: ReactNode; ready: boolean; busy: boolean; downloaded: boolean; error: string;
  onDownload: () => void; onDownloadSvg: () => void; onReview: () => void; onEditPlacement: () => void;
}) {
  const threads = design?.threads ?? [];
  const steps = [
    { label: 'Save to USB', title: 'Save your design to USB for embroidery', page: 47, instructions: [
      'Download your PES file, then copy it to a USB stick.',
      'Insert the USB into the PE900 and open the USB pattern source.',
      'Select your file and check its size and position before a test sew.'
    ] },
    { label: 'Hoop the shirt', title: 'Clamp the shirt at your chosen position', page: 29, instructions: [
      'Mark the planned center on the shirt.',
      `Place stabilizer behind one fabric layer, then secure it in the ${hoop.name.toLowerCase()} hoop.`,
      'Keep fabric taut without stretching. Keep the shirt back outside the hoop.'
    ] },
    { label: 'Attach the hoop', title: 'Place the hoop in the embroiderer', page: 30, instructions: [
      'Initialize the embroidery unit without the hoop, and install a filled bobbin.',
      'Raise the presser foot. Align both frame brackets with the holder pins and seat them securely.',
      'Keep loose shirt fabric clear of the stitching area.'
    ] },
    { label: 'Prepare the colors', title: 'Load the first thread color', page: 22, instructions: [
      `Gather these ${threads.length} thread colors in sewing order.`,
      'Load color 1, following the PE900 threading guide.',
      'The machine pauses after each color. Rethread with the next color, then resume.'
    ] },

  ];
  return <section className="ms-setup-surface ms-setup-overview" aria-label="Machine setup tutorial">
    <div className="ms-setup-intro"><p className="ms-setup-eyebrow">BROTHER PE900 · SETUP GUIDE</p><h2>From your screen to your shirt.</h2><p>{hoop.name} hoop · {hoop.widthMm} × {hoop.heightMm} mm<span> / </span>{threads.length} thread colors<span> / </span>{Math.round(design?.widthMm ?? 0)} × {Math.round(design?.heightMm ?? 0)} mm design</p></div>
    <div className="ms-setup-layout">
      {steps.map((current, active) => <article key={current.label} className="ms-setup-card" aria-label={current.title}>
        <div className="ms-setup-card-heading"><span>STEP {active + 1}</span><h3>{current.title}</h3></div>
        <div className="ms-setup-content">
          <div className={`ms-setup-visual ms-setup-visual-${active}`}>
            {active === 1 && <div className="ms-setup-shirt">{shirtPreview}<button className="ms-setup-edit" onClick={onEditPlacement}>Edit planned placement</button></div>}
            {active === 2 && <figure className="ms-setup-machine"><img src={`${import.meta.env.BASE_URL}embroidery/brother-pe900-3d.png`} alt="Brother PE900 embroidery machine with its frame holder" /><figcaption>{hoop.name} hoop · {hoop.widthMm} × {hoop.heightMm} mm</figcaption></figure>}
            {active === 3 && <ol className="ms-setup-thread-order" aria-label="Sewing thread order">{threads.map((thread, index) => <li key={index}><span className="ms-setup-spool" style={{ color: thread.hex }} aria-hidden="true"><svg viewBox="0 0 60 70"><rect x="12" y="10" width="36" height="50" rx="8" fill="currentColor" /><path d="M8 10H52M8 60H52" stroke="#d7cbbb" strokeWidth="7" strokeLinecap="round" /><path d="M15 21H45M15 29H45M15 37H45M15 45H45M15 53H45" stroke="#ffffff70" strokeWidth="2" /></svg></span><div><strong>{index === 0 ? 'Load first' : `Then color ${index + 1}`}</strong><span>{thread.hex.toUpperCase()}</span></div><b>{index + 1}</b></li>)}</ol>}
            {active === 0 && <div className="ms-setup-usb"><div className="ms-setup-file"><Download size={26} /><strong>.PES</strong><span>Your stitch file</span></div><ArrowRight size={20} /><div className="ms-setup-file"><Usb size={36} /><strong>USB</strong><span>To the PE900</span></div></div>}
          </div>
          <div className="ms-setup-instructions"><ol>{current.instructions.map(instruction => <li key={instruction}>{instruction}</li>)}</ol>
            {active === 3 && <p className="ms-setup-note">Match physical thread to these swatches. Machine color names may be approximate.</p>}
            {active === 0 && <><button className="ms-process-action ms-setup-download" disabled={!ready} onClick={onDownload}>{downloaded ? <Check size={16} /> : <Download size={16} />}{busy ? 'Preparing file…' : downloaded ? 'Download PES again' : 'Download PES for USB'}</button><button className="ms-setup-edit" onClick={onDownloadSvg} disabled={!ready}>Download SVG artwork</button>{downloaded && <p className="ms-setup-note" role="status">Saved to your computer. Copy the file to your USB stick.</p>}</>}
            {active === 0 && error && <p className="ms-error" role="alert">{error}</p>}
            <a className="ms-setup-manual" href={`${manual}#page=${current.page}`} target="_blank" rel="noreferrer">PE900 instructions for this step ↗</a>
          </div>
        </div>
      </article>)}
    </div>
    <div className="ms-setup-page-footer"><p>Review your setup with a Makery mentor.</p><button className="ms-process-action" onClick={onReview}><Users size={15} /> Test-sew checklist</button></div>
  </section>;
}
