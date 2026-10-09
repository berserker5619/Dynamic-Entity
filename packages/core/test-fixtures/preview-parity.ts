/**
 * preview-parity.ts — one set of sheets both import paths must read the same way.
 *
 * The browser previews a file through `LocalImportTransport.preview` (ngx) and the server
 * through `previewSheet` (server). They cannot run in one test — one needs Angular's injector,
 * the other Node streams — so each package runs every case here through its own entry point and
 * asserts the same `expected`. Equal to the same expectation means equal to each other, and a
 * case edited here changes what both sides are held to at once, which copies in two spec files
 * could not do.
 *
 * Not under `src/`, so it is neither published (`files` is `dist` and the schema) nor counted
 * by core's per-file coverage gate. Imported by relative path, the way `test_data.json` is.
 */

import type { CsvDelimiter, EntityFormConfig, MappingPlan, NestedFieldConfig } from '../src/index';

/** What a preview must report for a case, on both sides. */
export interface ExpectedPreview {
  headers: string[];
  sample: string[][];
  rowCount: number;
  /** Absent for a workbook; every case here is delimited text. */
  delimiter: CsvDelimiter;
  arrayBound: number;
  /** Suggested entries, sorted by ref (see `suggestedEntries`). */
  suggestion: SuggestedEntry[];
}

export interface SuggestedEntry {
  ref: string;
  column: number;
  confidence: 'exact' | 'guess' | undefined;
}

export interface PreviewParityCase {
  name: string;
  /** The upload's name. The browser reads `.tsv` by it; the server reads content only. */
  filename: string;
  text: string;
  config: EntityFormConfig;
  /** A stored plan, for the cases that are also committed. */
  plan?: MappingPlan;
  expected: ExpectedPreview;
  /**
   * A difference between the two paths that a test has exposed and nobody has fixed yet. The
   * named side runs as `it.failing`, so the case starts failing — and has to be cleaned up —
   * the day the difference is fixed.
   */
  knownDifference?: { side: 'browser' | 'server'; reason: string };
}

/** A suggestion's entries in a comparable form: ref, column and confidence, sorted by ref. */
export function suggestedEntries(plan: MappingPlan): SuggestedEntry[] {
  return plan.entries
    .map(entry => ({ ref: entry.ref, column: entry.column as number, confidence: entry.confidence }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

const text = (id: string, label: string): NestedFieldConfig => ({ id, type: 'text', label: { en: label } });
const number = (id: string, label: string): NestedFieldConfig => ({ id, type: 'number', label: { en: label } });
const array = (id: string, label: string, children: NestedFieldConfig[]): NestedFieldConfig => ({
  id,
  type: 'array',
  label: { en: label },
  children,
});

/** One flat tab, so refs are bare ids and the cases stay about reading, not addressing. */
const flat = (entity: string, ...fields: NestedFieldConfig[]): EntityFormConfig => ({
  entity,
  tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields }],
});

const PEOPLE = flat('people', text('name', 'Name'), text('email', 'Email'), number('amount', 'Amount'));
const CLAIMS = flat('claims', text('name', 'Name'), number('amount', 'Amount'));
const PHONES = flat(
  'people',
  text('name', 'Name'),
  array('phones', 'Phone', [text('number', 'Number'), text('kind', 'Type')]),
);
const ONE_CHILD = flat('people', text('name', 'Name'), array('phones', 'Phone', [text('number', 'Number')]));
const PHONES_AND_FAXES = flat(
  'people',
  text('name', 'Name'),
  array('phones', 'Phone', [text('number', 'Number')]),
  array('faxes', 'Fax', [text('number', 'Number')]),
);

export const PREVIEW_PARITY_CASES: readonly PreviewParityCase[] = [
  {
    name: 'comma CSV',
    filename: 'people.csv',
    text: 'Name,Email,Amount\nAda,ada@example.com,12.5\nBo,bo@example.com,3\n',
    config: PEOPLE,
    expected: {
      headers: ['Name', 'Email', 'Amount'],
      sample: [
        ['Ada', 'ada@example.com', '12.5'],
        ['Bo', 'bo@example.com', '3'],
      ],
      rowCount: 2,
      delimiter: ',',
      arrayBound: 3,
      suggestion: [
        { ref: 'amount', column: 2, confidence: 'exact' },
        { ref: 'email', column: 1, confidence: 'exact' },
        { ref: 'name', column: 0, confidence: 'exact' },
      ],
    },
  },
  {
    // Excel's CSV in a decimal-comma locale: `;` between fields, `,` in numbers, and a quoted
    // `;` inside a cell that must not split it.
    name: 'semicolon CSV with decimal commas',
    filename: 'claims.csv',
    text: 'Name;Amount\r\n"Rao; Jr.";1,500\r\nAda;1.234,5\r\nBo;1,5\r\nCy;1.5\r\n',
    config: CLAIMS,
    plan: {
      entity: 'claims',
      entries: [
        { ref: 'name', column: 0 },
        { ref: 'amount', column: 1 },
      ],
    },
    expected: {
      headers: ['Name', 'Amount'],
      sample: [
        ['Rao; Jr.', '1,500'],
        ['Ada', '1.234,5'],
        ['Bo', '1,5'],
        ['Cy', '1.5'],
      ],
      rowCount: 4,
      delimiter: ';',
      arrayBound: 3,
      suggestion: [
        { ref: 'amount', column: 1, confidence: 'exact' },
        { ref: 'name', column: 0, confidence: 'exact' },
      ],
    },
  },
  {
    name: 'a .tsv',
    filename: 'claims.tsv',
    text: 'Name\tAmount\nAda\t2\n',
    config: CLAIMS,
    expected: {
      headers: ['Name', 'Amount'],
      sample: [['Ada', '2']],
      rowCount: 1,
      delimiter: '\t',
      arrayBound: 3,
      suggestion: [
        { ref: 'amount', column: 1, confidence: 'exact' },
        { ref: 'name', column: 0, confidence: 'exact' },
      ],
    },
  },
  {
    // The CHANGELOG [2.3.0] promises "`.tsv` always means tab". The browser keeps that by
    // name (`sheet-parser.ts`); the server decides by content alone (`read-sheet.ts`, whose
    // `filename` "decides nothing"), and this header has more commas than tabs.
    name: 'a .tsv whose header line has more commas than tabs',
    filename: 'notes.tsv',
    text: 'Name\tNote, if any, here\nAda\tfine\n',
    config: flat('notes', text('name', 'Name'), text('note', 'Note, if any, here')),
    expected: {
      headers: ['Name', 'Note, if any, here'],
      sample: [['Ada', 'fine']],
      rowCount: 1,
      delimiter: '\t',
      arrayBound: 3,
      suggestion: [
        { ref: 'name', column: 0, confidence: 'exact' },
        { ref: 'note', column: 1, confidence: 'exact' },
      ],
    },
    knownDifference: {
      side: 'server',
      reason:
        'readSheet ignores the filename, so a .tsv is split by whichever separator its header ' +
        'line uses most; the browser always reads .tsv by tabs.',
    },
  },
  {
    // Moved here from local-import-transport.spec.ts and run-import.spec.ts, which each kept a copy.
    name: 'numbered array headers up to slot 6',
    filename: 'people.csv',
    text: 'Name,Phone 1 Number,Phone 6 Number,phone_6_type\nAda,1,6,home\n',
    config: PHONES,
    expected: {
      headers: ['Name', 'Phone 1 Number', 'Phone 6 Number', 'phone_6_type'],
      sample: [['Ada', '1', '6', 'home']],
      rowCount: 1,
      delimiter: ',',
      arrayBound: 6,
      suggestion: [
        { ref: 'name', column: 0, confidence: 'exact' },
        { ref: 'phones.0.number', column: 1, confidence: 'guess' },
        { ref: 'phones.5.kind', column: 3, confidence: 'guess' },
        { ref: 'phones.5.number', column: 2, confidence: 'guess' },
      ],
    },
  },
  {
    name: 'a one-child array named by its label alone ("Phone 2")',
    filename: 'people.csv',
    text: 'Name,Phone 1,Phone 2\nAda,111,222\n',
    config: ONE_CHILD,
    expected: {
      headers: ['Name', 'Phone 1', 'Phone 2'],
      sample: [['Ada', '111', '222']],
      rowCount: 1,
      delimiter: ',',
      arrayBound: 3,
      suggestion: [
        { ref: 'name', column: 0, confidence: 'exact' },
        { ref: 'phones.0.number', column: 1, confidence: 'guess' },
        { ref: 'phones.1.number', column: 2, confidence: 'guess' },
      ],
    },
  },
  {
    // `Number 1` is row 1 of phones and of faxes alike, so it must match neither.
    name: 'a header two arrays answer to',
    filename: 'people.csv',
    text: 'Name,Number 1,Fax 1 Number\nAda,111,222\n',
    config: PHONES_AND_FAXES,
    expected: {
      headers: ['Name', 'Number 1', 'Fax 1 Number'],
      sample: [['Ada', '111', '222']],
      rowCount: 1,
      delimiter: ',',
      arrayBound: 3,
      suggestion: [
        { ref: 'faxes.0.number', column: 2, confidence: 'guess' },
        { ref: 'name', column: 0, confidence: 'exact' },
      ],
    },
  },
  {
    // Counted naively the header has three `;` and one `,`. Outside quotes it has one `,` and
    // no `;`, and outside quotes is the only place a separator can be.
    name: 'a header line with quoted delimiters',
    filename: 'people.csv',
    text: '"Name; Surname; Initials",Amount\n"Rao; Jr.; R",4\n',
    config: CLAIMS,
    expected: {
      headers: ['Name; Surname; Initials', 'Amount'],
      sample: [['Rao; Jr.; R', '4']],
      rowCount: 1,
      delimiter: ',',
      arrayBound: 3,
      suggestion: [{ ref: 'amount', column: 1, confidence: 'exact' }],
    },
  },
];
