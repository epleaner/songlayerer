import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: 'ui',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'ui/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5174',
      '/output': 'http://localhost:5174',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
