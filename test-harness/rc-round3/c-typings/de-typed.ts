import express from 'express';
import { createImportRouter } from '@dynamic-entity/server/express';
import type { EntityFormConfig } from '@dynamic-entity/core';

interface TenantRequest extends express.Request { tenant: string }
const customers: EntityFormConfig = {
  entity: 'customers',
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }] }],
};
const app = express();
app.use('/api/import', createImportRouter({
  configs: (entity: string, request: TenantRequest) => (request.tenant && entity === 'customers' ? customers : undefined),
  onImport: async (records, { request }) => void [records, (request as TenantRequest).tenant],
}));
