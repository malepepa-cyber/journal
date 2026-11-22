import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: '/',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: false, chunkSizeWarningLimit: 2000, target: 'es2022' },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:47123', changeOrigin: true } },
  },
});
