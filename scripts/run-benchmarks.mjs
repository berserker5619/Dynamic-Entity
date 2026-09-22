#!/usr/bin/env node
/**
 * Automated Performance Benchmark Suite for Dynamic Entity Core.
 *
 * Measures throughput and latency across key computational workflows:
 * 1. Rule Evaluation (evaluateFormRules) across small (10), medium (50), and large (200) rule sets
 * 2. Schema Validation (validateConfig) on complex nested multi-tab configs with 100+ fields
 * 3. Record Migrations (migrateRecord) chained across 25,000 versioned records
 * 4. CSV Parsing & Data Transformation (parseCsv) across 20,000 tabular rows
 *
 * Usage: node scripts/run-benchmarks.mjs
 */
import { performance } from 'node:perf_hooks';
import {
  evaluateFormRules,
  validateConfig,
  migrateRecord,
  parseCsv,
} from '../packages/core/dist/index.mjs';

// Table formatting helper
function formatRow(cols, widths) {
  return cols.map((c, i) => String(c).padEnd(widths[i])).join(' | ');
}

const RESULTS = [];

function recordBenchmark(name, iterations, durationMs, minFloorOpsSec = 0) {
  const opsSec = Math.round((iterations / (durationMs / 1000)));
  const avgLatencyUs = ((durationMs / iterations) * 1000).toFixed(2);
  const passed = minFloorOpsSec > 0 ? opsSec >= minFloorOpsSec : true;

  RESULTS.push({
    name,
    iterations,
    durationMs: durationMs.toFixed(1),
    opsSec,
    avgLatencyUs,
    passed,
    minFloorOpsSec,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Rule Evaluation Benchmarks
// ─────────────────────────────────────────────────────────────────────────────
console.log('Running Benchmark: Rule Evaluation (evaluateFormRules)...');

function generateRules(count) {
  const rules = [];
  const operators = ['EQUAL', 'NOT_EQUAL', 'CONTAINS', 'IN', 'DATE_BEFORE'];
  const actions = [
    { type: 'visibility', value: false },
    { type: 'visibility', value: true },
    { type: 'validation', value: 'Field is invalid per rule' },
    { type: 'info', value: 'Informational banner' },
  ];

  for (let i = 0; i < count; i++) {
    const op = operators[i % operators.length];
    const act = actions[i % actions.length];
    rules.push({
      formConfigId: 'benchmarkEntity',
      fieldId: `[main.field_${i % 20}]`,
      conditions: [
        {
          operator: op,
          compareType: 'value',
          value: op === 'IN' ? ['opt1', 'opt2', 'opt3'] : op === 'DATE_BEFORE' ? '2026-12-31' : 'targetValue',
        },
      ],
      action: act,
      targets: [{ id: `[main.target_${(i + 1) % 20}]`, type: 'field' }],
      enabled: true,
      priority: (i % 10) + 1,
    });
  }
  return rules;
}

const formRecord = {
  main: {
    field_0: 'targetValue',
    field_1: 'otherValue',
    field_2: 'opt2',
    field_3: '2025-06-15',
    field_4: 'substring-targetValue-end',
  },
};

for (let i = 5; i < 25; i++) {
  formRecord.main[`field_${i}`] = `value_${i}`;
  formRecord.main[`target_${i}`] = `initial_${i}`;
}

const rules10 = generateRules(10);
const rules50 = generateRules(50);
const rules200 = generateRules(200);

// Warmup
for (let i = 0; i < 500; i++) {
  evaluateFormRules(rules50, formRecord);
}

// Benchmark 10 rules (10,000 iterations)
{
  const ITERS = 10000;
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    evaluateFormRules(rules10, formRecord);
  }
  const elapsed = performance.now() - start;
  recordBenchmark('evaluateFormRules (10 rules)', ITERS, elapsed, 40000);
}

// Benchmark 50 rules (5,000 iterations)
{
  const ITERS = 5000;
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    evaluateFormRules(rules50, formRecord);
  }
  const elapsed = performance.now() - start;
  recordBenchmark('evaluateFormRules (50 rules)', ITERS, elapsed, 10000);
}

// Benchmark 200 rules (2,000 iterations)
{
  const ITERS = 2000;
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    evaluateFormRules(rules200, formRecord);
  }
  const elapsed = performance.now() - start;
  recordBenchmark('evaluateFormRules (200 rules)', ITERS, elapsed, 2500);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Schema Validation Benchmarks (validateConfig)
// ─────────────────────────────────────────────────────────────────────────────
console.log('Running Benchmark: Schema Validation (validateConfig)...');

function generateComplexConfig(fieldsPerTab = 25, tabsCount = 4) {
  const tabs = [];
  for (let t = 0; t < tabsCount; t++) {
    const fields = [];
    for (let f = 0; f < fieldsPerTab; f++) {
      fields.push({
        id: `tab_${t}_field_${f}`,
        type: f % 5 === 0 ? 'dropdown' : f % 3 === 0 ? 'number' : 'text',
        label: { en: `Field ${t}-${f}`, de: `Feld ${t}-${f}` },
        visibility: true,
        validators: f % 2 === 0 ? { required: true } : undefined,
        options: f % 5 === 0 ? [{ en: 'A' }, { en: 'B' }, { en: 'C' }] : undefined,
      });
    }
    // Add nested group
    fields.push({
      id: `group_${t}`,
      type: 'group',
      label: { en: `Group ${t}` },
      fields: [
        { id: `group_inner_1`, type: 'text', label: { en: 'Inner 1' }, visibility: true },
        { id: `group_inner_2`, type: 'email', label: { en: 'Inner 2' }, visibility: true },
      ],
      visibility: true,
    });
    tabs.push({
      id: `tab_${t}`,
      label: { en: `Tab ${t}` },
      visibility: true,
      fields,
    });
  }

  return {
    entity: 'benchmarkEntity',
    version: 1,
    name: { en: 'Benchmark Entity Schema' },
    tabs,
  };
}

const complexConfig = generateComplexConfig(25, 4); // > 100 fields

// Warmup
for (let i = 0; i < 200; i++) {
  validateConfig(complexConfig);
}

{
  const ITERS = 3000;
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    validateConfig(complexConfig);
  }
  const elapsed = performance.now() - start;
  recordBenchmark('validateConfig (100+ fields)', ITERS, elapsed, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Record Migration Benchmarks (migrateRecord)
// ─────────────────────────────────────────────────────────────────────────────
console.log('Running Benchmark: Record Migration (migrateRecord)...');

const migrations = [
  {
    from: 1,
    to: 2,
    description: 'Split fullName into firstName and lastName',
    migrate: r => {
      const [first = '', ...rest] = String(r.fullName ?? '').split(' ');
      return { ...r, firstName: first, lastName: rest.join(' ') };
    },
  },
  {
    from: 2,
    to: 3,
    description: 'Coerce phone to numeric format',
    migrate: r => ({ ...r, phone: String(r.phone ?? '').replace(/\\D/g, '') }),
  },
  {
    from: 3,
    to: 4,
    description: 'Wrap metadata',
    migrate: r => ({ ...r, meta: { migratedAt: '2026-09-22', active: true } }),
  },
];

const sampleRecord = {
  _configVersion: 1,
  fullName: 'Ada Lovelace Developer',
  phone: '+1 (555) 019-2834',
  role: 'engineer',
  department: 'Computing',
};

// Warmup
for (let i = 0; i < 500; i++) {
  migrateRecord(sampleRecord, { migrations, targetVersion: 4 });
}

{
  const ITERS = 25000;
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    migrateRecord(sampleRecord, { migrations, targetVersion: 4 });
  }
  const elapsed = performance.now() - start;
  recordBenchmark('migrateRecord (chain 3 steps)', ITERS, elapsed, 40000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CSV Spreadsheet Parsing Benchmarks (parseCsv)
// ─────────────────────────────────────────────────────────────────────────────
console.log('Running Benchmark: CSV Spreadsheet Parsing (parseCsv)...');

const csvRows = ['id,firstName,lastName,email,status,salary,department'];
for (let i = 0; i < 500; i++) {
  csvRows.push(`${i},FirstName${i},LastName${i},user${i}@example.com,Active,${50000 + i * 100},Engineering`);
}
const csvPayload = csvRows.join('\n');

// Warmup
for (let i = 0; i < 20; i++) {
  parseCsv(csvPayload);
}

{
  const ITERS = 500; // 500 runs of 500 rows = 250,000 rows parsed
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    parseCsv(csvPayload);
  }
  const elapsed = performance.now() - start;
  recordBenchmark('parseCsv (500 rows/run)', ITERS, elapsed, 300);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary Report
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(90));
console.log('                    DYNAMIC ENTITY BENCHMARK RESULTS                     ');
console.log('='.repeat(90));

const headers = ['Benchmark Target', 'Iterations', 'Time (ms)', 'Throughput (ops/s)', 'Avg Latency', 'Status'];
const widths = [34, 12, 11, 20, 13, 8];

console.log(formatRow(headers, widths));
console.log('-'.repeat(90));

let allPassed = true;
for (const res of RESULTS) {
  const status = res.passed ? 'PASS' : 'FAIL';
  if (!res.passed) allPassed = false;
  const row = [
    res.name,
    res.iterations.toLocaleString(),
    res.durationMs,
    `${res.opsSec.toLocaleString()} ops/s`,
    `${res.avgLatencyUs} µs`,
    status,
  ];
  console.log(formatRow(row, widths));
}

console.log('='.repeat(90));

const mem = process.memoryUsage();
console.log(`Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB | RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB\n`);

if (!allPassed) {
  console.error('FAIL: One or more benchmark thresholds were not met.');
  process.exit(1);
} else {
  console.log('PASS: All benchmark performance thresholds successfully met.');
}
