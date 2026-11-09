import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const r = (p: string) => path.resolve(import.meta.dirname, p);

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': r('web/src'), '@shared': r('shared') } },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: false },
      '/healthz': { target: 'http://localhost:8080' },
    },
  },
  build: { outDir: '../dist', emptyOutDir: true, target: ['safari16.4', 'chrome111', 'firefox128'], sourcemap: false },
});
