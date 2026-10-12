/**
 * This package's version, for the `engineVersion` a server stamps on what it answers (spec §9).
 * A client compares it with its own at major.minor, to notice that the two halves of an import
 * have moved apart. `version.spec.ts` holds it equal to `package.json`.
 */
export const IMPORTER_VERSION = '1.0.0-rc.1';

/** The plan versions this package reads: v1, with no `planVersion`, and v2. */
export const PLAN_VERSIONS: readonly number[] = [1, 2];
