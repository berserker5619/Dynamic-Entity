/**
 * json-schema-adapter.ts — a JSON Schema as import targets (spec §7, "Adapters in scope").
 *
 * The schema decides the targets. Each node is read like this:
 * - `properties` recurse into the path.
 * - An array of objects becomes numbered slots, and its children become slot targets.
 * - An array of primitives becomes one `list` target, read from a split cell (§6).
 * - `enum` stores the raw value.
 * - `format` picks `date`, `datetime`, `time`, or a string format.
 * - `required[]` makes a field required. A nested field is required only when every object
 *   above it is too, so an optional `customer` does not force `customer.email`. Inside an
 *   array's items, `required[]` applies per item.
 *
 * Schema composition:
 * - Local `$ref` (`#/...`) is resolved.
 * - `allOf` is merged.
 * - The first non-null branch of `oneOf`/`anyOf` is taken. A `oneOf` of `const` branches is a
 *   labelled enum.
 *
 * Anything a sheet cannot carry is reported in `unsupported` rather than guessed at: an array
 * inside an array (a v2 non-goal), a free-form object, a node with no usable type, or a `$ref`
 * that loops.
 *
 * Positional by default (`positional: true`), as the spec gives generic adapters. Validation is
 * the engine's generic checks, or a caller's `validator` (an Ajv-compiled schema wrapped in a
 * function, say) — Ajv itself is never a dependency.
 */
import type { ImportTarget, RecordProblem, SchemaAdapter, TargetArray, TargetSet, ValueKind } from './adapter.types';

/** The parts of a JSON Schema node this adapter reads. Anything else is ignored. */
export interface JsonSchemaNode {
  $ref?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: readonly unknown[];
  const?: unknown;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  allOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  $defs?: Record<string, JsonSchemaNode>;
  definitions?: Record<string, JsonSchemaNode>;
  $id?: string;
}

export interface JsonSchemaAdapterOptions {
  /** The adapter `id` plans are written for. Default: the schema's `$id`, else `title`, else `json-schema`. */
  id?: string;
  /** Compared with a plan's `schemaVersion`. */
  version?: number;
  /** Replaces the generic checks: given a finished record, return its problems. */
  validator?: (record: Record<string, unknown>) => RecordProblem[];
}

/** The `meta` of a JSON Schema target: the schema node it came from. */
export type JsonSchemaMeta = JsonSchemaNode;

const STRING_FORMATS: Record<string, ValueKind> = {
  date: { kind: 'date' },
  'date-time': { kind: 'datetime' },
  time: { kind: 'time' },
};

/** A copy of `node` without `keys`. */
function omit(node: JsonSchemaNode, ...keys: (keyof JsonSchemaNode)[]): JsonSchemaNode {
  const copy = { ...node };
  for (const key of keys) delete copy[key];
  return copy;
}

/** Resolve a local `$ref` (`#/a/b`) against the root. Remote refs are not followed. */
function resolveRef(root: JsonSchemaNode, ref: string): JsonSchemaNode | undefined {
  if (!ref.startsWith('#')) return undefined;
  let node: unknown = root;
  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node && typeof node === 'object' ? (node as JsonSchemaNode) : undefined;
}

/** The node's own type, ignoring `null`, or `undefined` when it names none. */
function typeOf(node: JsonSchemaNode): string | undefined {
  if (Array.isArray(node.type)) return node.type.find(type => type !== 'null');
  if (node.type !== undefined) return node.type;
  if (node.properties) return 'object';
  if (node.items) return 'array';
  if (node.enum) return 'enum';
  return undefined;
}

/**
 * Wrap a JSON Schema as a `SchemaAdapter`.
 *
 * Throws at construction when the schema's root is not an object with `properties`: a schema
 * that describes no record cannot be imported into.
 */
export function jsonSchemaAdapter(schema: JsonSchemaNode, options: JsonSchemaAdapterOptions = {}): SchemaAdapter<JsonSchemaMeta> {
  /** One node with `$ref`, `allOf` and `oneOf`/`anyOf` taken out. `seen` stops a `$ref` loop. */
  type Flat = { node: JsonSchemaNode; loop: boolean; seen: ReadonlySet<string> };
  const flatten = (node: JsonSchemaNode, seen: ReadonlySet<string> = new Set()): Flat => {
    if (node.$ref !== undefined) {
      if (seen.has(node.$ref)) return { node, loop: true, seen };
      const target = resolveRef(schema, node.$ref);
      if (!target) return { node: {}, loop: false, seen };
      const rest = omit(node, '$ref');
      const resolved = flatten(target, new Set([...seen, node.$ref]));
      return { node: { ...resolved.node, ...rest }, loop: resolved.loop, seen: resolved.seen };
    }
    let out: JsonSchemaNode = { ...node };
    let loop = false;
    let followed = seen;
    if (node.allOf) {
      out = omit(out, 'allOf');
      for (const part of node.allOf) {
        const flat = flatten(part, seen);
        loop ||= flat.loop;
        followed = new Set([...followed, ...flat.seen]);
        out = {
          ...flat.node,
          ...out,
          properties: { ...(flat.node.properties ?? {}), ...(out.properties ?? {}) },
          required: [...(flat.node.required ?? []), ...(out.required ?? [])],
        };
      }
      if (!Object.keys(out.properties ?? {}).length) delete out.properties;
      if (!out.required?.length) delete out.required;
    }
    const branches = node.oneOf ?? node.anyOf;
    if (branches) {
      const rest = omit(out, 'oneOf', 'anyOf');
      // A oneOf of consts is an enum with labels: `{ const: 'open', title: 'Open' }`.
      if (branches.length && branches.every(branch => 'const' in branch)) {
        return { node: { ...rest, enum: branches.map(b => b.const), oneOf: branches }, loop, seen: followed };
      }
      const chosen = branches.find(branch => typeOf(branch) !== 'null' && branch.type !== 'null');
      if (chosen) {
        const flat = flatten(chosen, followed);
        return { node: { ...flat.node, ...rest }, loop: loop || flat.loop, seen: flat.seen };
      }
      out = rest;
    }
    return { node: out, loop, seen: followed };
  };

  /** The value kind of a leaf node, or why it has none. */
  const kindOf = (node: JsonSchemaNode): ValueKind | string => {
    if (node.enum) {
      const labels = node.oneOf?.map(branch => branch.title ?? String(branch.const));
      return { kind: 'enum', values: node.enum, ...(labels ? { labels } : {}) };
    }
    switch (typeOf(node)) {
      case 'string': {
        if (node.format && STRING_FORMATS[node.format]) return STRING_FORMATS[node.format];
        const format = node.format === 'email' ? 'email' : node.format === 'uri' || node.format === 'url' ? 'url' : undefined;
        return {
          kind: 'string',
          ...(node.minLength !== undefined ? { minLength: node.minLength } : {}),
          ...(node.maxLength !== undefined ? { maxLength: node.maxLength } : {}),
          ...(node.pattern !== undefined ? { pattern: node.pattern } : {}),
          ...(format ? { format } : {}),
        };
      }
      case 'number':
      case 'integer':
        return {
          kind: 'number',
          ...(typeOf(node) === 'integer' ? { integer: true } : {}),
          ...(node.minimum !== undefined ? { min: node.minimum } : {}),
          ...(node.maximum !== undefined ? { max: node.maximum } : {}),
        };
      case 'boolean':
        return { kind: 'boolean' };
      default:
        return 'it has no type a cell can hold';
    }
  };

  const titleOf = (node: JsonSchemaNode, name: string): string => node.title ?? name;
  const rootFlat = flatten(schema).node;
  if (typeOf(rootFlat) !== 'object' || !rootFlat.properties) {
    throw new Error('jsonSchemaAdapter: the schema must describe an object with properties.');
  }

  return {
    id: options.id ?? schema.$id ?? schema.title ?? 'json-schema',
    ...(options.version !== undefined ? { version: options.version } : {}),
    adapterVersion: '0.0.0',
    ...(options.validator ? { validate: options.validator } : {}),

    targets({ slots }): TargetSet<JsonSchemaMeta> {
      const targets: ImportTarget<JsonSchemaMeta>[] = [];
      const arrays: TargetArray[] = [];
      const unsupported: { ref: string; reason: string }[] = [];

      /** Walk one object's properties. `inArray` is the array whose items these are, if any. */
      const walk = (
        node: JsonSchemaNode,
        path: string[],
        titles: string[],
        required: boolean,
        inArray: { ref: string; label: string; slot: number } | undefined,
        seen: ReadonlySet<string>,
      ): void => {
        const requiredHere = new Set(node.required ?? []);
        for (const [name, child] of Object.entries(node.properties ?? {})) {
          const { node: flat, loop, seen: below } = flatten(child, seen);
          const childPath = [...path, name];
          const ref = childPath.join('.');
          const childTitles = [...titles, titleOf(flat, name)];
          const childRequired = required && requiredHere.has(name);
          if (loop) {
            unsupported.push({ ref, reason: 'its $ref refers back to itself' });
            continue;
          }
          const type = typeOf(flat);

          if (type === 'object') {
            if (!flat.properties) unsupported.push({ ref, reason: 'it is a free-form object, with no properties' });
            else walk(flat, childPath, childTitles, childRequired, inArray, below);
            continue;
          }

          if (type === 'array') {
            const itemFlat = flatten(flat.items ?? {}, below);
            const items = itemFlat.node;
            const itemType = typeOf(items);
            if (inArray) {
              unsupported.push({ ref, reason: 'it is a list inside a list, which a sheet row cannot hold' });
              continue;
            }
            if (itemType === 'object' && items.properties) {
              const label = titleOf(flat, name);
              arrays.push({ ref, label, itemKind: 'object', required: childRequired, positional: true });
              for (let slot = 0; slot < (slots[ref] ?? 0); slot++) {
                // Item children are required per item, so the item's own required[] applies in full.
                walk(items, [...childPath, String(slot)], childTitles, true, { ref, label, slot }, itemFlat.seen);
              }
              continue;
            }
            const of = kindOf(items);
            if (typeof of === 'string') {
              unsupported.push({ ref, reason: `its items cannot be read from a cell: ${of}` });
              continue;
            }
            const list: ValueKind = {
              kind: 'list',
              of,
              ...(flat.minItems !== undefined ? { minItems: flat.minItems } : {}),
              ...(flat.maxItems !== undefined ? { maxItems: flat.maxItems } : {}),
            };
            targets.push(leaf(ref, ref, childTitles, name, flat, list, childRequired));
            continue;
          }

          const kind = kindOf(flat);
          if (typeof kind === 'string') {
            unsupported.push({ ref, reason: kind });
            continue;
          }
          if (inArray) {
            const shapeRef = ref.replace(`.${inArray.slot}.`, '.');
            targets.push({
              ...leaf(ref, shapeRef, childTitles, name, flat, kind, childRequired),
              // `Guardian / Name 2`, the generated header a template would carry.
              header: `${childTitles.join(' / ')} ${inArray.slot + 1}`,
              arrayRef: inArray.ref,
              arrayLabel: inArray.label,
              arrayIndex: inArray.slot,
            });
          } else {
            targets.push(leaf(ref, ref, childTitles, name, flat, kind, childRequired));
          }
        }
      };

      walk(rootFlat, [], [], true, undefined, new Set());
      return { targets, arrays, unsupported };
    },
  };
}

function leaf(
  ref: string,
  shapeRef: string,
  titles: string[],
  name: string,
  node: JsonSchemaNode,
  value: ValueKind,
  required: boolean,
): ImportTarget<JsonSchemaMeta> {
  const title = titles[titles.length - 1];
  return {
    ref,
    shapeRef,
    header: titles.join(' / '),
    matchKeys: title === name ? [name] : [title, name],
    required,
    value,
    ...(value.kind === 'date' ? { format: 'YYYY-MM-DD' } : value.kind === 'time' ? { format: 'HH:mm' } : {}),
    meta: node,
  };
}
