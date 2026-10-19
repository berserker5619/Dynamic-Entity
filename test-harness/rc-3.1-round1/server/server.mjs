// The rc.1 round's servers, as published: DE 3.1 (grouping on and off) and DE 3.0.0, beside the
// built full-app on one origin, and the csv-app on another port.
//   /api/on   @dynamic-entity/server@<rc> with grouping: true
//   /api/off  @dynamic-entity/server@<rc>, the default
//   /api/v30  @dynamic-entity/server@3.0.0 (installed in a project of its own, DE30_DIR)
// Configs come from configs.json beside this file, read on each request, so the driver can set
// the config a case imports into. What each server writes is at GET /written/:api/:entity, and
// DELETE /written clears it.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createImportRouter } from '@dynamic-entity/server/express';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
// The published 3.0.0 server, in a project of its own: it peers on @dynamic-entity/core ^3.0.0,
// which a prerelease core does not satisfy, so it cannot share this one.
const D30 = process.env.DE30_DIR ?? path.join(os.tmpdir(), 'de-published-server-3.0.0');
const { createImportRouter: createImportRouter30 } = await import(pathToFileURL(createRequire(D30 + '/package.json').resolve('@dynamic-entity/server/express')).href);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const configs = entity => JSON.parse(readFileSync(path.join(HERE, 'configs.json'), 'utf8'))[entity];
const written = {};
const writer = api => (records, { entity }) => {
  (written[api] ??= {})[entity] = [...(written[api]?.[entity] ?? []), ...records];
};

const full = express();
full.use('/api/on', createImportRouter({ configs, grouping: true, onImport: writer('on') }));
full.use('/api/off', createImportRouter({ configs, onImport: writer('off') }));
full.use('/api/v30', createImportRouter30({ configs, onImport: writer('v30') }));
full.get('/written/:api/:entity', (req, res) => res.json(written[req.params.api]?.[req.params.entity] ?? []));
full.delete('/written', (_req, res) => {
  for (const key of Object.keys(written)) delete written[key];
  res.json({ ok: true });
});
full.use(express.static(path.join(HERE, '../full-app/dist/browser')));
full.listen(4611, () => console.log('full-app and APIs on http://127.0.0.1:4611'));

const csv = express();
csv.use(express.static(path.join(HERE, '../csv-app/dist/browser')));
csv.listen(4612, () => console.log('csv-app on http://127.0.0.1:4612'));
