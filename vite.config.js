import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  css: {
    postcss: {
      plugins: []
    }
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three']
        }
      }
    }
  },
  server: {
    port: 3006,
    host: true
  }
});
