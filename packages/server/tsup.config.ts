import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // Nothing in `dependencies` or `peerDependencies` is bundled — the consumer owns those
  // versions and needs to be able to patch and audit them.
  external: ['@dynamic-entity/core'],
});
