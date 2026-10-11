/**
 * example-json-adapter.ts — a sample record as import targets (spec §7, "Adapters in scope").
 *
 * For a schema nobody wrote down: hand over one record, or several, and its shape becomes the
 * targets. Each value is read like this:
 * - An object recurses into the path.
 * - An array of objects becomes numbered slots. Its children are every key any item has, and
 *   its longest length is the fewest slots it is offered.
 * - An array of primitives becomes one `list` target, read from a split cell (§6).
 * - A number is a `number`, a boolean a `boolean`. A string shaped like an ISO date, date-time
 *   or time is that kind, and any other string is a `string`.
 *
 * Where samples disagree, the field is a `string`, since any cell can be read as text. A `null`
 * is skipped when another sample has a value. Nothing is `required`: a sample shows what a
 * record can hold, not what it must. Arrays are positional (`positional: true`), as the spec
 * gives generic adapters.
 *
 * What a sample cannot answer is reported in `unsupported`, not guessed at: a field that is only
 * ever `null`, an empty object or array, an array inside an array (a v2 non-goal), and a field
 * that is an object in one sample and a value in another.
 */
import type { ImportTarget, RecordProblem, SchemaAdapter, TargetArray, TargetSet, ValueKind } from './adapter.types';

export interface ExampleJsonAdapterOptions {
  /** The adapter `id` plans are written for. Default: `example-json`. */
  id?: string;
  /** Compared with a plan's `schemaVersion`. */
  version?: number;
  /** Replaces the generic checks: given a finished record, return its problems. */
  validator?: (record: Record<string, unknown>) => RecordProblem[];
}

/** The `meta` of an example target: the first sample value seen for it. */
export interface ExampleJsonMeta {
  sample: unknown;
}

/** What the samples say one field is. */
type Shape =
  | { is: 'value'; kind: ValueKind; sample: unknown }
  | { is: 'object'; fields: Map<string, Shape> }
  | { is: 'objects'; item: Map<string, Shape>; length: number }
  | { is: 'list'; of: ValueKind; sample: unknown }
  | { is: 'null' }
  | { is: 'unsupported'; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;
const ISO_TIME = /^\d{2}:\d{2}(?::\d{2})?$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The kind of one primitive value, or `undefined` for anything that is not one. */
function kindOfValue(value: unknown): ValueKind | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? { kind: 'number' } : undefined;
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (typeof value !== 'string') return undefined;
  if (ISO_DATE.test(value)) return { kind: 'date' };
  if (ISO_DATETIME.test(value)) return { kind: 'datetime' };
  if (ISO_TIME.test(value)) return { kind: 'time' };
  return { kind: 'string' };
}

/** Two samples' kinds as one: the same kind stays, and any disagreement is text. */
function mergeKinds(a: ValueKind, b: ValueKind): ValueKind {
  return a.kind === b.kind ? a : { kind: 'string' };
}

/** The shape of every key across `items`, merged. */
function shapeOfObjects(items: readonly Record<string, unknown>[], inArray: boolean): Map<string, Shape> {
  const fields = new Map<string, Shape>();
  for (const item of items) {
    for (const [name, value] of Object.entries(item)) {
      const shape = shapeOf(value, inArray);
      const known = fields.get(name);
      fields.set(name, known ? merge(known, shape) : shape);
    }
  }
  return fields;
}

/** What one sample value is. `inArray` is whether it sits inside an array's items. */
function shapeOf(value: unknown, inArray: boolean): Shape {
  if (value === null || value === undefined) return { is: 'null' };
  if (isPlainObject(value)) {
    if (!Object.keys(value).length) return { is: 'unsupported', reason: 'its sample is an empty object, which names no fields' };
    return { is: 'object', fields: shapeOfObjects([value], inArray) };
  }
  if (Array.isArray(value)) {
    if (inArray) return { is: 'unsupported', reason: 'it is a list inside a list, which a sheet row cannot hold' };
    const present = value.filter(item => item !== null && item !== undefined);
    if (!present.length) return { is: 'unsupported', reason: 'its sample is an empty array, so its items are unknown' };
    if (present.every(isPlainObject)) {
      return { is: 'objects', item: shapeOfObjects(present, true), length: value.length };
    }
    const kinds = present.map(kindOfValue);
    if (kinds.some(kind => kind === undefined)) {
      return { is: 'unsupported', reason: 'its items mix objects, arrays and values, which no one cell can hold' };
    }
    return { is: 'list', of: (kinds as ValueKind[]).reduce(mergeKinds), sample: value };
  }
  const kind = kindOfValue(value);
  return kind ? { is: 'value', kind, sample: value } : { is: 'unsupported', reason: 'its sample value cannot be held in a cell' };
}

/** Two samples of one field as one shape. */
function merge(a: Shape, b: Shape): Shape {
  if (a.is === 'null') return b;
  if (b.is === 'null' || a.is === 'unsupported') return a;
  if (b.is === 'unsupported') return b;
  if (a.is === 'value' && b.is === 'value') return { ...a, kind: mergeKinds(a.kind, b.kind) };
  if (a.is === 'list' && b.is === 'list') return { ...a, of: mergeKinds(a.of, b.of) };
  if (a.is === 'object' && b.is === 'object') return { is: 'object', fields: mergeFields(a.fields, b.fields) };
  if (a.is === 'objects' && b.is === 'objects') {
    return { is: 'objects', item: mergeFields(a.item, b.item), length: Math.max(a.length, b.length) };
  }
  return { is: 'unsupported', reason: 'its samples disagree on whether it is an object, a list or a value' };
}

function mergeFields(a: Map<string, Shape>, b: Map<string, Shape>): Map<string, Shape> {
  const fields = new Map(a);
  for (const [name, shape] of b) {
    const known = fields.get(name);
    fields.set(name, known ? merge(known, shape) : shape);
  }
  return fields;
}

/**
 * Wrap a sample record, or an array of them, as a `SchemaAdapter`.
 *
 * Throws at construction when the sample is not an object with at least one key, or an array
 * of such objects: a sample that shows no fields cannot be imported into.
 */
export function exampleJsonAdapter(sample: unknown, options: ExampleJsonAdapterOptions = {}): SchemaAdapter<ExampleJsonMeta> {
  const records = Array.isArray(sample) ? sample : [sample];
  if (!records.length || !records.every(record => isPlainObject(record) && Object.keys(record).length)) {
    throw new Error('exampleJsonAdapter: the sample must be an object with at least one field, or an array of them.');
  }
  const root = shapeOfObjects(records as Record<string, unknown>[], false);

  return {
    id: options.id ?? 'example-json',
    ...(options.version !== undefined ? { version: options.version } : {}),
    adapterVersion: '0.0.0',
    ...(options.validator ? { validate: options.validator } : {}),

    targets({ slots }): TargetSet<ExampleJsonMeta> {
      const targets: ImportTarget<ExampleJsonMeta>[] = [];
      const arrays: TargetArray[] = [];
      const unsupported: { ref: string; reason: string }[] = [];

      const walk = (
        fields: Map<string, Shape>,
        path: string[],
        titles: string[],
        inArray: { ref: string; label: string; slot: number } | undefined,
      ): void => {
        for (const [name, shape] of fields) {
          const childPath = [...path, name];
          const ref = childPath.join('.');
          const childTitles = [...titles, name];
          const shapeRef = inArray ? ref.replace(`.${inArray.slot}.`, '.') : ref;
          switch (shape.is) {
            case 'null':
              // Reported once, for the shape, not once per slot.
              if (!inArray || inArray.slot === 0) unsupported.push({ ref: shapeRef, reason: 'its sample is only ever null, so its type is unknown' });
              break;
            case 'unsupported':
              if (!inArray || inArray.slot === 0) unsupported.push({ ref: shapeRef, reason: shape.reason });
              break;
            case 'object':
              walk(shape.fields, childPath, childTitles, inArray);
              break;
            case 'objects': {
              arrays.push({ ref, label: name, itemKind: 'object', required: false, positional: true });
              // The sample's length seeds the slots: never fewer than it shows.
              const count = Math.max(slots[ref] ?? 0, shape.length);
              for (let slot = 0; slot < count; slot++) {
                walk(shape.item, [...childPath, String(slot)], childTitles, { ref, label: name, slot });
              }
              break;
            }
            case 'list':
              targets.push(leaf(ref, shapeRef, childTitles, { kind: 'list', of: shape.of }, shape.sample));
              break;
            case 'value':
              targets.push({
                ...leaf(ref, shapeRef, childTitles, shape.kind, shape.sample),
                ...(inArray
                  ? {
                      // `guardians / name 2`, the generated header a template would carry.
                      header: `${childTitles.join(' / ')} ${inArray.slot + 1}`,
                      arrayRef: inArray.ref,
                      arrayLabel: inArray.label,
                      arrayIndex: inArray.slot,
                    }
                  : {}),
              });
              break;
          }
        }
      };

      walk(root, [], [], undefined);
      return { targets, arrays, unsupported };
    },
  };
}

function leaf(ref: string, shapeRef: string, titles: string[], value: ValueKind, sample: unknown): ImportTarget<ExampleJsonMeta> {
  return {
    ref,
    shapeRef,
    header: titles.join(' / '),
    matchKeys: [titles[titles.length - 1]],
    required: false,
    value,
    ...(value.kind === 'date' ? { format: 'YYYY-MM-DD' } : value.kind === 'time' ? { format: 'HH:mm' } : {}),
    meta: { sample },
  };
}
