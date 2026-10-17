import express from 'express';
import { jsonSchemaAdapter } from 'sheet-to-schema';
import { createImportRouter, type ImportBinding } from 'sheet-to-schema/node';

interface TenantRequest extends express.Request { tenant: string }
const people: ImportBinding = { adapter: jsonSchemaAdapter({ type: 'object', properties: { name: { type: 'string' } } }), ctx: undefined };
const app = express();
const router: express.Router = createImportRouter(express.Router(), {
  bindings: (name, request: TenantRequest) => (request.tenant && name === 'people' ? people : undefined),
  onImport: async (records, { request }) => void [records, request.tenant],
});
app.use('/api/import', router);
