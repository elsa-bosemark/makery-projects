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
