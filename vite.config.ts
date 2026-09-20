import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
  // The conversion worker uses dynamic import, which rules out the default
  // 'iife' worker format: code-splitting builds require an ES module worker.
  worker: {
    format: 'es',
  },
});
