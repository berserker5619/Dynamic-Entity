import { defineConfig } from 'tsup';

export default defineConfig({
  // The browser entry. It has no runtime dependencies (spec, "Package boundaries"); the Node-only
  // readers and runner arrive later behind a separate `/node` entry.
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
