import { readFileSync } from 'node:fs';
import { initializeVTracer } from './vtracer';
initializeVTracer(readFileSync(new URL('../../public/vtracer/vtracer_wasm_bg.wasm', import.meta.url)));
