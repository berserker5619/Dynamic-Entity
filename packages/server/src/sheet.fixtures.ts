/**
 * sheet.fixtures.ts — one config, one plan, and the stream helpers every spec here needs.
 *
 * Not a spec, and excluded from coverage: this file exists so no test invents its own config
 * and then proves something about that config rather than about the package.
 */

import v8 from 'node:v8';
import vm from 'node:vm';
import type { EntityFormConfig, ImportLookups, MappingPlan } from '@dynamic-entity/core';

/**
 * Heap in use after a collection, which is the only number worth asserting on.
 *
 * An uncollected heap grows past a hundred megabytes on a ten-megabyte file however the code
 * is written — a number that would pass whatever it was asserting. `global.gc` exists only
 * under `--expose-gc` and the test script is a plain `jest`, so the flag is turned on from
 * inside the process, used, and turned off again.
 */
export function collectedHeap(): number {
  v8.setFlagsFromString('--expose-gc');
  try {
    (vm.runInNewContext('gc') as () => void)();
  } finally {
    v8.setFlagsFromString('--no-expose-gc');
  }
  return process.memoryUsage().heapUsed;
}

/**
 * Deliberately mixed types, because the whole risk of a streaming reader is the cells that are
 * not text: a number, a boolean, a date, and a `listName` dropdown a server cannot resolve
 * without being handed the list.
 */
export const CONFIG: EntityFormConfig = {
  entity: 'employee',
  version: 3,
  tabs: [
    {
      id: 'personal',
      label: { en: 'Personal' },
      fields: [
        { id: 'firstName', type: 'text', label: { en: 'First Name' }, validators: { required: true } },
        { id: 'age', type: 'number', label: { en: 'Age' }, validators: { min: 0, max: 150 } },
        { id: 'startDate', type: 'date', label: { en: 'Start Date' } },
        { id: 'active', type: 'checkbox', label: { en: 'Active' } },
        { id: 'status', type: 'dropdown', label: { en: 'Status' }, listName: 'statuses' },
      ],
    },
  ],
};

export const LOOKUPS: ImportLookups = {
  statuses: [{ en: 'Active', de: 'Aktiv' }, { en: 'Inactive', de: 'Inaktiv' }],
};

export const HEADERS = ['First Name', 'Age', 'Start Date', 'Active', 'Status'];

export const PLAN: MappingPlan = {
  entity: 'employee',
  configVersion: 3,
  sourceHeaders: [...HEADERS],
  entries: [
    { ref: 'personal.firstName', column: 0 },
    { ref: 'personal.age', column: 1 },
    { ref: 'personal.startDate', column: 2 },
    { ref: 'personal.active', column: 3 },
    { ref: 'personal.status', column: 4 },
  ],
};

/** A small file with a quoted field, a blank line and a row that ends early. */
export const CSV_TEXT =
  'First Name,Age,Start Date,Active,Status\r\n' +
  'Alice,34,2024-03-07,true,Active\r\n' +
  '"Bo, Jr.",41,2024-01-01,no,Inactive\r\n' +
  '\r\n' +
  'Carol,29\r\n';

/** Bytes, in chunks of `size`, the way a socket would deliver them. */
export function chunked(source: string | Uint8Array, size = 7): AsyncGenerator<Uint8Array> {
  const bytes = typeof source === 'string' ? Buffer.from(source, 'utf8') : Buffer.from(source);
  return (async function* () {
    for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
  })();
}

/**
 * A stream that records whether anything destroyed it.
 *
 * Every guard in this package is supposed to close the request body on its way out — refusing
 * an upload and then leaving the socket half-read is how a rejected upload still costs a
 * handle, which is the failure mode the guard was added to prevent.
 */
export function trackedStream(source: string | Uint8Array, size = 64): {
  stream: AsyncIterable<Uint8Array> & { destroy(): void };
  destroyed: () => boolean;
} {
  let destroyed = false;
  const inner = chunked(source, size);
  const stream = {
    [Symbol.asyncIterator]: () => inner,
    destroy: () => {
      destroyed = true;
    },
  };
  return { stream, destroyed: () => destroyed };
}

/** The first bytes of a pre-2007 .xls, which is a compound file rather than a zip. */
export const OLE2_HEAD = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** The first bytes of any zip, and therefore of every .xlsx. */
export const ZIP_HEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

/** A CSV of `rows` data rows, produced lazily so the fixture itself is never held in memory. */
export async function* generatedCsv(rows: number, columns = HEADERS.length): AsyncGenerator<Uint8Array> {
  const header = HEADERS.slice(0, columns).join(',') + '\r\n';
  yield Buffer.from(header, 'utf8');

  // Batched into chunks so the generator is not one yield per row, which would measure the
  // harness rather than the reader.
  let buffer = '';
  for (let i = 0; i < rows; i++) {
    const cells = [`Name${i}`, String(20 + (i % 40)), '2024-03-07', 'true', 'Active'];
    buffer += cells.slice(0, columns).join(',') + '\r\n';
    if (buffer.length >= 64 * 1024) {
      yield Buffer.from(buffer, 'utf8');
      buffer = '';
    }
  }
  if (buffer) yield Buffer.from(buffer, 'utf8');
}
