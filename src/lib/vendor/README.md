VTracer browser adapter

Source: https://github.com/visioncortex/vtracer
Package: @visioncortex/vtracer 1.0.0-alpha.4
npm tarball SHA1: bca168228cfa27fba1b25fefac4650a36c089503

vtracer.js is the package's generated wasm-bindgen JavaScript, adapted only to
export ESM functions and initialize from supplied WebAssembly bytes rather than
Node filesystem calls. The tracing engine WASM is unmodified and lives in
public/vtracer/vtracer_wasm_bg.wasm. License: public/vtracer/LICENSE.txt.

Region masks are traced together using spline + cutout, with temporary region
labels and an explicit background label. Background paths are discarded.
The original VTracer cubic paths drive SVG preview/export; adaptive flattening
at 0.02 mm drives stitch fills, outlines and pattern clipping. The previous
polygon simplification and corner-rounding implementation is removed.
