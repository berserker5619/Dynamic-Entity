import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImportRouter } from '@dynamic-entity/server/express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const customerConfig = {
  entity: 'customers',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      flatData: true,
      fields: [
        { id: 'name', type: 'text', label: { en: 'Full Name' }, validators: { required: true } },
        { id: 'email', type: 'text', label: { en: 'Email Address' }, validators: { required: true } },
        { id: 'city', type: 'text', label: { en: 'City' } }
      ]
    }
  ]
};

const employeeDateConfig = {
  entity: 'employees',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      flatData: true,
      fields: [
        { id: 'name', type: 'text', label: { en: 'Employee Name' }, validators: { required: true } },
        { id: 'joinDate', type: 'date', label: { en: 'Join Date' }, validators: { required: true } }
      ]
    }
  ]
};

// -------------------------------------------------------------
// 1. Backend Server on Port 4321
// -------------------------------------------------------------
const apiApp = express();

apiApp.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const importRouter = createImportRouter({
  configs: {
    customers: customerConfig,
  },
  onImport: async (records, info) => {
    console.log(`[SERVER] Imported ${records.length} customers to backend database.`);
  }
});
apiApp.use('/api/import', importRouter);

const mismatchRouter = createImportRouter({
  configs: {
    employees: employeeDateConfig,
  },
  dateOrder: 'MDY',
  onImport: async (records, info) => {
    console.log(`[SERVER] Imported ${records.length} employees with MDY dateOrder.`);
  }
});
apiApp.use('/api/import-mismatch', mismatchRouter);

const apiServer = http.createServer(apiApp);
await new Promise(resolve => apiServer.listen(4321, resolve));
console.log('Backend API server running on http://localhost:4321');

// -------------------------------------------------------------
// 2. Frontend SPA Static Server on Port 4200
// -------------------------------------------------------------
const spaApp = express();
const distBrowser = path.join(__dirname, 'dist', 'r3-angular-app', 'browser');
spaApp.use(express.static(distBrowser));
spaApp.use((req, res) => {
  res.sendFile(path.join(distBrowser, 'index.html'));
});

const spaServer = http.createServer(spaApp);
await new Promise(resolve => spaServer.listen(4200, resolve));
console.log('Frontend Angular app running on http://localhost:4200');
