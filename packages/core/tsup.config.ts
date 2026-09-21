import { defineConfig } from 'tsup';

export default defineConfig({
  /*
   * Two entries, because the CLI is not part of the library.
   *
   * `cli.ts` was re-exported from the root barrel, so `runValidateCli` and its I/O port were
   * published API and every browser bundle that imported this package carried them. Its own
   * entry keeps it reachable — `@dynamic-entity/core/cli` — and keeps it out of the root by
   * construction rather than by a bundler being clever.
   */
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
