#!/usr/bin/env node
/**
 * import-server.mjs — the demo's backend, and the only place the server transport is real.
 *
 * `@dynamic-entity/server` is unit-tested against streams and `verify-server-consumer.mjs`
 * drives its four routes against a listener — but neither of those is a browser, and the claim
 * the whole package rests on is about a *user's* import producing the same records whichever
 * side does the work. That claim needs the wizard, a network, and a server, at once.
 *
 * So this is what `e2e/import-server.spec.ts` points at. It is a demo backend and reads like
 * one: configs come from the same `test_data.json` the demo seeds from, records go into a Map,
 * and there is no authentication — which is the consumer's job and is said out loud in
 * SECURITY.md rather than left as an omission someone might copy.
 *
 * Started by Playwright alongside `ng serve`, and reached through the dev server's proxy at
 * `/api/import`, so the browser sees one origin exactly as it would in production. A CORS
 * header here would work and would teach a pattern the library does not need.
 */
import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupValuesToOptions, normalizeLookupValues } from '@dynamic-entity/core';
import { createImportRouter } from '@dynamic-entity/server/express';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = path => JSON.parse(readFileSync(join(HERE, path), 'utf8'));

const PORT = Number(process.env['IMPORT_PORT'] ?? 4300);

/**
 * Every entity the demo offers, from the same files the browser seeds itself from.
 *
 * `local-store.service.ts` seeds test_data.json and then *overrides* four entities with the
 * demo's own configs. This file used to serve only the entities that were not overridden and
 * 404 the rest, because serving them from a second copy would hand the browser one schema and
 * the server another — an import mapping a sheet against a config the user never saw, which
 * is the exact failure the whole feature exists to avoid.
 *
 * Those four are now JSON in `src/app/mock/configs/`, read here and imported by
 * `sample-data.ts` there, so there is one source and nothing left to diverge. Refusing them
 * was the right answer to two copies; one copy is a better answer than either.
 *
 * The order matters: the demo's own configs win, exactly as they do in `ensureSeed`.
 */
const DEMO_CONFIGS = ['clients', 'employees', 'orders', 'extensions'].map(name =>
  read(`src/app/mock/configs/${name}.json`),
);

const configs = Object.fromEntries(
  [...read('../../test_data.json'), ...DEMO_CONFIGS].map(config => [config.entity, config]),
);

/**
 * clientTier, resolved exactly the way the browser resolves it.
 *
 * insuranceClaims has a field that names this list, and createImportRouter refuses to start
 * without it — which is how this was found: the server would not boot, rather than booting and
 * storing the raw cell text as a value that renders correctly and matches nothing.
 *
 * The renderer sorts a lookup list and then converts it to options; both functions are core own,
 * so calling them here is sharing the decision rather than reimplementing it. Resolving it any
 * other way would make the same cell produce a different record on each side, which is exactly
 * what the parity spec is looking for.
 */
const lookups = {
  clientTier: lookupValuesToOptions(normalizeLookupValues(read('src/app/mock/client-tier-list.json'))),
};

/** Where imported records go. A Map, because this is a demo and nothing here outlives it. */
const imported = new Map();

const app = express();

app.use(
  '/api/import',
  createImportRouter({
    configs,
    lookups,
    onImport(records, { entity }) {
      const existing = imported.get(entity) ?? [];
      imported.set(entity, [...existing, ...records]);
    },
  }),
);

/**
 * Test surface, and deliberately outside the router.
 *
 * The E2E needs to see what actually landed — asserting on the wizard's own summary would only
 * prove the wizard believed itself. These two routes are the demo's, not the library's, and a
 * consumer copying this file should delete them.
 */
app.get('/api/imported/:entity', (request, response) => {
  response.json(imported.get(request.params.entity) ?? []);
});

app.delete('/api/imported', (_request, response) => {
  imported.clear();
  response.json({ cleared: true });
});

app.listen(PORT, () => {
  console.log(`demo import server on http://localhost:${PORT}`);
  console.log(`  entities: ${Object.keys(configs).join(', ')}`);
});
