# Makery Stitch

A standalone embroidery website for preparing PNG, JPG, or WebP artwork, editing smooth SVG shapes, choosing stitches, previewing size and placement, and downloading SVG or Brother PES files.

This repository contains only the embroidery website. It has no dependency on the Makery tool finder.

## Develop

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:8081/.

## Check and build

```sh
npm test
npm run build
npm run preview
```

## Publish

The GitHub Pages workflow builds and publishes `dist/` on pushes to `main`. In repository Settings → Pages, use **GitHub Actions** as the publishing source. The workflow sets `VITE_BASE_PATH=/makery-projects/` so bundled assets, VTracer WebAssembly, example artwork, and navigation work under the repository path.

Uploaded artwork is processed in the browser. No API keys or server are required. Example illustrations are supplied by the project owner. Third-party license notices are retained alongside the bundled assets and VTracer engine.

Typography roles and conventions are documented in [DESIGN.md](DESIGN.md).

Generated stitch files should be reviewed and tested on scrap fabric before sewing a final garment.

## Stitch planning

Satin strokes use paired vector rails. Branches are partitioned into separate regions before rail fitting, with local width limits at junctions and suppression of crowded inner-edge penetrations. Light satin underlay follows the column center; the top stitches return along the column. Broad shape satins and explicitly horizontal/vertical shape satins retain the scanline split-stitch planner.

Outline paths retain corners within a 0.1 mm simplification tolerance before stitch-length subdivision. Centerline running and bean stitches use the same curvature-aware planning. The choices in the interface remain Outline, Satin, and Tatami.

Validation includes automated geometry and export tests plus independent `pystitch` decoding of fill, satin, and running PES fixtures. These checks establish file and path behavior; actual fabric, thread, stabilizer, and machine results still require a test sew.
