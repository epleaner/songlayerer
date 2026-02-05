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
    host: '127.0.0.1',
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
