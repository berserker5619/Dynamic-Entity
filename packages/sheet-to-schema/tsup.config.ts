import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entries (docs/phase2-plan.md):
  // - the main one is browser-safe and has no runtime dependencies;
  // - `/node` reads files and serves HTTP, so it may use Node and its optional peers.
  entry: { index: 'src/index.ts', 'node/index': 'src/node/index.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // `/node` imports the main entry by the package's own name, and it stays an import: bundling
  // it in would give `/node` a second copy of the engine. The peers are the consumer's.
  external: ['sheet-to-schema', 'exceljs', 'busboy', 'express'],
});
