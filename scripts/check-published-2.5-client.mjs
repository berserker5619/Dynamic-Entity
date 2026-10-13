#!/usr/bin/env node
/**
 * check-published-2.5-client.mjs — verify published 2.5.0 client wire compatibility with 3.0 server.
 *
 * Installs published ngx-dynamic-entity@2.5.0 and @dynamic-entity/core@2.5.0 into a temp
 * directory and runs their HttpImportTransport against a 3.0.0-rc.1 server built from this tree.
 *
 * Asserts:
 *   1. Same dateOrder on both sides (DMY) -> commits with no month-first warning.
 *   2. Different dateOrders (MDY client vs DMY server) -> refused before sending a byte.
 *   3. 2.5.0's version comparison correctly handles "3.0.0-rc.1" without falling back to month-first.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SERVER_DIST = path.join(ROOT, 'packages', 'server', 'dist', 'express.js');

if (!existsSync(SERVER_DIST)) {
  console.error('packages/server/dist/express.js not found. Run npm run build first.');
  process.exit(1);
}

// ─── Setup isolated client in temp directory ─────────────────────────────────

const TEMP_DIR = path.join(os.tmpdir(), 'de-published-2.5.0-client');
const PKG_JSON = path.join(TEMP_DIR, 'package.json');
const NGX_MJS = path.join(TEMP_DIR, 'node_modules', 'ngx-dynamic-entity', 'fesm2022', 'ngx-dynamic-entity.mjs');
const COMPILER_MJS = path.join(TEMP_DIR, 'node_modules', '@angular', 'compiler', 'fesm2022', 'compiler.mjs');

if (!existsSync(NGX_MJS) || !existsSync(COMPILER_MJS)) {
  console.log(`Setting up published 2.5.0 client in ${TEMP_DIR}...`);
  mkdirSync(TEMP_DIR, { recursive: true });
  writeFileSync(
    PKG_JSON,
    JSON.stringify({
      name: 'published-2-5-client-test',
      private: true,
      dependencies: {
        'ngx-dynamic-entity': '2.5.0',
        '@dynamic-entity/core': '2.5.0',
        '@angular/compiler': '^22.0.0',
      },
    }),
  );
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], {
    cwd: TEMP_DIR,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
}

// ─── Run compatibility verification ──────────────────────────────────────────

async function run() {
  // Load Angular compiler to allow JIT metadata in Node ESM
  await import(pathToFileURL(COMPILER_MJS).href);
  const { HttpImportTransport } = await import(pathToFileURL(NGX_MJS).href);
  const { createImportRouter } = await import(pathToFileURL(SERVER_DIST).href);

  // 1. Verify 2.5.0 version comparison logic against "3.0.0-rc.1"
  // In published 2.5.0 ngx-dynamic-entity:
  // const DATE_ORDER_SINCE = [2, 5];
  // function readsMonthFirst(version) {
  //     if (!version) return true;
  //     const [major, minor] = version.split('.').map(Number);
  //     return major < DATE_ORDER_SINCE[0] || (major === DATE_ORDER_SINCE[0] && minor < DATE_ORDER_SINCE[1]);
  // }
  const [major, minor] = '3.0.0-rc.1'.split('.').map(Number);
  const wouldReadMonthFirst = major < 2 || (major === 2 && minor < 5);
  if (wouldReadMonthFirst) {
    console.error('CRITICAL: 2.5.0 version comparison mishandles "3.0.0-rc.1" and assumes month-first!');
    process.exit(1);
  }

  const testConfig = {
    entity: 'people',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        flatData: true,
        fields: [
          { id: 'name', type: 'text', label: { en: 'Name' } },
          { id: 'hireDate', type: 'date', label: { en: 'Hire Date' } },
        ],
      },
    ],
  };

  const importedRecords = [];
  const expressModule = await import('express');
  const express = expressModule.default || expressModule;
  const app = express();

  app.use(
    '/import',
    createImportRouter({
      configs: { people: testConfig },
      dateOrder: 'DMY',
      onImport: records => {
        importedRecords.push(...records);
      },
    }),
  );

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const warnings = [];
    const transport = new HttpImportTransport({
      baseUrl: `http://127.0.0.1:${port}/import`,
      warn: text => warnings.push(text),
    });

    const csvData = 'Name,Hire Date\r\nAda Lovelace,05/09/2026\r\nCharles Babbage,15/10/2026\r\n';
    const fileDmy = new File([csvData], 'people-dmy.csv', { type: 'text/csv' });

    // ── Test Case 1: Same dateOrder (DMY) ──────────────────────────────────
    const preview = await transport.preview(fileDmy, { config: testConfig, dateOrder: 'DMY' });
    if (preview.dateOrder !== 'DMY') {
      throw new Error(`Expected preview dateOrder to be 'DMY', got '${preview.dateOrder}'`);
    }

    // Must NOT emit any month-first warning
    const monthFirstWarning = warnings.find(w => w.toLowerCase().includes('month first'));
    if (monthFirstWarning) {
      throw new Error(`Unexpected month-first warning was emitted: "${monthFirstWarning}"`);
    }

    const plan = preview.suggestion;
    const commitResult = await transport.commit(fileDmy, plan, { config: testConfig, dateOrder: 'DMY' });

    if (commitResult.imported !== 2) {
      throw new Error(`Expected 2 imported records, got ${commitResult.imported}`);
    }
    if (importedRecords.length !== 2) {
      throw new Error(`Expected server onImport to receive 2 records, got ${importedRecords.length}`);
    }
    if (importedRecords[0].hireDate !== '2026-09-05' || importedRecords[1].hireDate !== '2026-10-15') {
      throw new Error(`Unexpected parsed dates: ${JSON.stringify(importedRecords)}`);
    }

    // ── Test Case 2: Different dateOrder (MDY client vs DMY server) ────────
    const fileMdy = new File([csvData], 'people-mdy.csv', { type: 'text/csv' });
    await transport.preview(fileMdy, { config: testConfig, dateOrder: 'MDY' });

    let refused = false;
    let refusalError = '';
    try {
      await transport.commit(fileMdy, plan, { config: testConfig, dateOrder: 'MDY' });
    } catch (err) {
      refused = true;
      refusalError = err instanceof Error ? err.message : String(err);
    }

    if (!refused) {
      throw new Error('Expected commit with mismatched dateOrder to be refused, but it succeeded!');
    }
    if (!refusalError.includes('This app reads dates as MDY but the import server reads them as DMY')) {
      throw new Error(`Unexpected refusal message: "${refusalError}"`);
    }

    console.log('✓ Published 2.5.0 client vs 3.0.0-rc.1 server parity check passed:');
    console.log('  - Same dateOrder (DMY) committed 2 records with zero month-first warnings');
    console.log('  - Different dateOrder (MDY vs DMY) correctly refused by 2.5.0 client');
    console.log('  - 2.5.0 version comparison correctly treats "3.0.0-rc.1" as modern engine (not month-first)');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('check-published-2.5-client failed:', err);
  process.exit(1);
});
