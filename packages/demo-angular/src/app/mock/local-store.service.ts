import { Injectable } from '@angular/core';
import type { EntityFormConfig } from 'ngx-dynamic-entity';
import { shouldMaskField } from '@dynamic-entity/core';
import {
  CLIENTS_CONFIG,
  CLIENTS_RECORDS,
  EMPLOYEES_CONFIG,
  EMPLOYEES_RECORDS,
  MASKED_ROLES,
  ORDERS_CONFIG,
  ORDERS_RECORDS,
  TEST_DATA_CONFIGS,
} from './sample-data';
import { DEMO_MASK } from './demo-mask';
import { EXTENSIONS_CONFIG, EXTENSIONS_RECORDS } from './extensions-entity';
import {
  COMPLEX_FULL_TEST_RECORDS,
  INSURANCE_CLAIMS_RECORDS,
  ORGANIZATIONS_RECORDS,
  PEOPLE_RECORDS,
  VISIT_NOTES_RECORDS,
} from './seed-records';

const CONFIGS_KEY = 'de_demo_configs';
const recordsKey = (entity: string) => `de_demo_records_${entity}`;
/**
 * What a withheld value looks like in a list row.
 *
 * Shared with the renderer's `MASKED_PLACEHOLDER` (see `DEMO_MASK`) on purpose: this is a
 * mock server declining to send a value, that is a form declining to display one, and the
 * two rendering differently would suggest they are the same mechanism.
 */
const MASK = DEMO_MASK;

export interface RecordQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  roles?: string[];
}
export interface RecordPage {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

type AnyConfig = Record<string, any>;

/**
 * LocalStore — the demo's persistence layer using real-world `test_data.json` entity configs.
 * Supports all 12 entities: individuals, organizations, clients, payerProfiles, visitNotes,
 * student, patientDetailsForm, expence, employees, deals, connections, nizamKT.
 */
@Injectable({ providedIn: 'root' })
export class LocalStore {
  /** Monotonic within a session, so two writes in the same millisecond still differ. */
  private sequence = 0;

  constructor() {
    this.ensureSeed();
  }

  // ─── Configs ────────────────────────────────────────────────────────────────
  listConfigs(): AnyConfig[] {
    return this.read<AnyConfig[]>(CONFIGS_KEY, []);
  }
  getConfig(entity: string): AnyConfig | null {
    return this.listConfigs().find(c => c['entity'] === entity) ?? null;
  }
  saveConfig(config: AnyConfig): AnyConfig {
    const cfg: AnyConfig = { ...config, version: (config['version'] ?? 0) + 1 };
    this.write(CONFIGS_KEY, [...this.listConfigs().filter(c => c['entity'] !== cfg['entity']), cfg]);
    if (!localStorage.getItem(recordsKey(cfg['entity']))) this.write(recordsKey(cfg['entity']), []);
    return cfg;
  }
  updateConfig(entity: string, updates: AnyConfig): AnyConfig {
    const existing = this.getConfig(entity);
    const merged: AnyConfig = { ...(existing ?? { entity }), ...updates, version: (existing?.['version'] ?? 0) + 1 };
    this.write(CONFIGS_KEY, [...this.listConfigs().filter(c => c['entity'] !== entity), merged]);
    return merged;
  }

  // ─── Records ────────────────────────────────────────────────────────────────
  getAllRecords(entity: string): Record<string, unknown>[] {
    return this.read<Record<string, unknown>[]>(recordsKey(entity), []);
  }

  private extractFields(config: AnyConfig | null): AnyConfig[] {
    if (!config) return [];
    if (config['tabs']) {
      return (config['tabs'] as AnyConfig[]).flatMap(t => t['fields'] ?? []);
    }
    return config['fields'] ?? [];
  }

  /** Paginated/sorted/searched/masked query. */
  getRecords(entity: string, q: RecordQuery = {}): RecordPage {
    const config = this.getConfig(entity);
    const masked = this.maskedFieldIds(config, q.roles ?? []);
    let rows = this.getAllRecords(entity);

    const search = (q.search ?? '').trim().toLowerCase();
    if (search) {
      const allFields = this.extractFields(config);
      const stringFields = allFields
        .filter((f: AnyConfig) => f['type'] === 'text' || f['type'] === 'textarea' || f['type'] === 'email')
        .map((f: AnyConfig) => f['id']);
      rows = rows.filter(r =>
        stringFields.some((fid: string) => String(r[fid] ?? '').toLowerCase().includes(search)),
      );
    }
    if (q.sortField) {
      const dir = q.sortDir === 'asc' ? 1 : -1;
      const field = q.sortField;
      rows = [...rows].sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
      });
    }

    const total = rows.length;
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.max(1, q.pageSize ?? 20);
    const start = (page - 1) * pageSize;
    const paged = rows.slice(start, start + pageSize);

    const data = paged.map(r => this.applyMask(r, masked));
    return { data, total, page, pageSize };
  }

  createRecord(entity: string, data: Record<string, unknown>): Record<string, unknown> {
    return this.createRecords(entity, [data])[0];
  }

  /**
   * Insert many records in one pass.
   *
   * `createRecord` in a loop is O(n²): every call re-reads the whole table, re-serialises it
   * and writes it back, so a thousand-row import spends its time on JSON rather than on the
   * import. Measured through the demo's wizard on the 35-column `insuranceClaims` sheet:
   * 1,200 rows took **13.2s** in the tab against **3.6s** for the same file on the server,
   * and most of that gap was this method rather than anything the library does.
   *
   * It also closes an id collision that only a bulk insert could expose. `_id` was
   * `${entity}_${Date.now()}`, which is unique enough for a person clicking Save and not at
   * all unique for a loop writing a thousand records inside the same millisecond — they all
   * got the same id, and the demo's own list then treated them as one record.
   */
  createRecords(
    entity: string,
    rows: readonly Record<string, unknown>[],
  ): Record<string, unknown>[] {
    if (!rows.length) return [];

    const existing = this.getAllRecords(entity);
    const version = this.getConfig(entity)?.['version'] ?? 1;
    const stamp = Date.now();
    const created: Record<string, unknown>[] = rows.map(data => ({
      _id: `${entity}_${stamp}_${this.sequence++}`,
      _configVersion: version,
      ...data,
    }));

    // Newest first, which is what a loop of `createRecord` prepends produced — so the order
    // the demo's list shows does not change just because the write got faster.
    this.write(recordsKey(entity), [...created].reverse().concat(existing));
    return created;
  }

  updateRecord(entity: string, id: string, updates: Record<string, unknown>): Record<string, unknown> | null {
    const rows = this.getAllRecords(entity);
    const idx = rows.findIndex(r => r['_id'] === id);
    if (idx === -1) return null;
    const merged = { ...rows[idx], ...updates };
    rows[idx] = merged;
    this.write(recordsKey(entity), rows);
    return merged;
  }

  // ─── LocalStorage helpers ──────────────────────────────────────────────────
  private read<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage is unavailable or full (private browsing, quota). This is demo persistence:
      // losing it is acceptable, breaking the interaction that triggered the write is not.
    }
  }

  /**
   * Which fields this role sees masked in the list view.
   *
   * The decision itself comes from core's `shouldMaskField`, so the demo table honours the
   * same three-level rule (form → tab → field) as the renderer instead of its own
   * field-only approximation. Only the row rendering is the demo's own — the library
   * ships no data table.
   */
  private maskedFieldIds(config: AnyConfig | null, roles: string[]): Set<string> {
    if (!config) return new Set();
    const formConfig = config as unknown as EntityFormConfig;
    const masked = new Set<string>();

    for (const tab of formConfig.tabs ?? []) {
      for (const field of tab.fields ?? []) {
        if (shouldMaskField(field, tab, formConfig, roles, MASKED_ROLES)) masked.add(field.id);
      }
    }
    return masked;
  }

  private applyMask(row: Record<string, unknown>, ids: Set<string>): Record<string, unknown> {
    if (ids.size === 0) return row;
    const out = { ...row };
    ids.forEach(id => (out[id] = MASK));
    return out;
  }

  private ensureSeed(): void {
    const existing = this.read<AnyConfig[]>(CONFIGS_KEY, []);
    const mergedMap = new Map<string, AnyConfig>();

    // Seed test_data.json configurations first
    for (const cfg of TEST_DATA_CONFIGS) {
      if (cfg && cfg['entity']) {
        mergedMap.set(cfg['entity'], cfg);
      }
    }

    // Demo sample configs take precedence for clients and employees (so demo tests remain deterministic)
    mergedMap.set(CLIENTS_CONFIG.entity, CLIENTS_CONFIG);
    mergedMap.set(EMPLOYEES_CONFIG.entity, EMPLOYEES_CONFIG);
    mergedMap.set(ORDERS_CONFIG.entity, ORDERS_CONFIG);
    // The entity that exercises the extension points nothing else here reaches — custom
    // validators, a custom field type, hooks, migrations, uploads. Adding it is four edits
    // in this file; editing test_data.json instead would put the eight existing entities and
    // every spec that asserts on them at risk for nothing.
    mergedMap.set(EXTENSIONS_CONFIG.entity, EXTENSIONS_CONFIG);

    // User modifications take precedence
    for (const ex of existing) {
      if (ex && ex['entity']) {
        mergedMap.set(ex['entity'], ex);
      }
    }

    this.write(CONFIGS_KEY, Array.from(mergedMap.values()));
    // Every entity offered in the picker gets records. Seeding only the three demo entities
    // left the five that come from test_data.json rendering an empty list — including
    // insuranceClaims, the richest config here and the first thing a visitor is likely to
    // open. The guard is per entity, so a list a user has since emptied stays empty.
    const seeds: [string, Record<string, unknown>[]][] = [
      ['clients', CLIENTS_RECORDS],
      ['employees', EMPLOYEES_RECORDS],
      ['orders', ORDERS_RECORDS],
      ['organizations', ORGANIZATIONS_RECORDS],
      ['visitNotes', VISIT_NOTES_RECORDS],
      ['people', PEOPLE_RECORDS],
      ['complexFullTest', COMPLEX_FULL_TEST_RECORDS],
      ['insuranceClaims', INSURANCE_CLAIMS_RECORDS],
      ['extensions', EXTENSIONS_RECORDS],
    ];
    for (const [entity, records] of seeds) {
      if (!localStorage.getItem(recordsKey(entity))) this.write(recordsKey(entity), records);
    }
  }
}
