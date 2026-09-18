import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/express.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // Nothing in `dependencies` or `peerDependencies` is bundled: exceljs and busboy stay
  // separate packages a consumer can patch and audit, and express is theirs entirely.
  external: ['@dynamic-entity/core', 'exceljs', 'busboy', 'express'],
});
