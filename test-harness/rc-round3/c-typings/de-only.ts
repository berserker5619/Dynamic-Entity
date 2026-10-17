import { createImportRouter } from '@dynamic-entity/server/express';
import type { EntityFormConfig } from '@dynamic-entity/core';
const customers: EntityFormConfig = { entity: 'customers', tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }] }] };
export const router = createImportRouter({ configs: { customers }, onImport: async () => {} });
