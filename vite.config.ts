import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
export default defineConfig({ base: process.env.VITE_BASE_PATH || '/', plugins: [react()], server: { host: '127.0.0.1', port: 8081, strictPort: true }, resolve: { alias: { '@': path.resolve(__dirname, './src') } } });
