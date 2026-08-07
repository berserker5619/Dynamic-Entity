import { Injectable } from '@angular/core';
import {
  CLIENTS_CONFIG,
  CLIENTS_RECORDS,
  EMPLOYEES_CONFIG,
  EMPLOYEES_RECORDS,
  MASKED_ROLES,
  TEST_DATA_CONFIGS,
} from './sample-data';

const CONFIGS_KEY = 'de_demo_configs';
const recordsKey = (entity: string) => `de_demo_records_${entity}`;
const MASK = 'XXXXXXXXX';

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
 * LocalStore — the demo's persistence layer. No API/HTTP: configs and records live in
 * localStorage, seeded with sample data on first use. All demo features (clients CRUD,
 * entity manager, form builder saves, data table) talk to this directly.
 */
@Injectable({ providedIn: 'root' })
export class LocalStore {
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
    const cfg: AnyConfig = { ...config, version: 1, history: [] };
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

  /** Paginated/sorted/searched/masked query (used by the simple clients table). */
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
      rows = rows.filter(r => stringFields.some((fid: string) => String(r[fid] ?? '').toLowerCase().includes(search)));
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
    const data = rows.slice(start, start + pageSize).map(r => this.applyMask(r, masked));
    return { data, total, page, pageSize };
  }

  createRecord(entity: string, data: Record<string, unknown>): Record<string, unknown> {
    const config = this.getConfig(entity);
    const created = { ...data, _id: `${entity}_${Date.now()}`, _configVersion: config?.['version'] ?? 1 };
    this.write(recordsKey(entity), [created, ...this.getAllRecords(entity)]);
    return created;
  }
  updateRecord(entity: string, id: string, data: Record<string, unknown>): Record<string, unknown> | null {
    const rows = this.getAllRecords(entity);
    const idx = rows.findIndex(r => r['_id'] === id);
    if (idx < 0) return null;
    rows[idx] = { ...rows[idx], ...data };
    this.write(recordsKey(entity), rows);
    return rows[idx];
  }
  deleteRecord(entity: string, id: string): void {
    this.write(recordsKey(entity), this.getAllRecords(entity).filter(r => r['_id'] !== id));
  }

  /** Wipe all demo data and re-seed the samples. */
  reset(): void {
    Object.keys(localStorage)
      .filter(k => k.startsWith('de_demo_'))
      .forEach(k => localStorage.removeItem(k));
    this.ensureSeed();
  }

  // ─── Internals ──────────────────────────────────────────────────────────────
  private read<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  private write(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value));
  }
  private maskedFieldIds(config: AnyConfig | null, roles: string[]): Set<string> {
    const isMasked = roles.some(r => MASKED_ROLES.includes(r));
    if (!config || !isMasked) return new Set();
    const allFields = this.extractFields(config);
    return new Set(allFields.filter((f: AnyConfig) => f['maskData']).map((f: AnyConfig) => f['id']));
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

    // User modifications take precedence
    for (const ex of existing) {
      if (ex && ex['entity']) {
        mergedMap.set(ex['entity'], ex);
      }
    }

    this.write(CONFIGS_KEY, Array.from(mergedMap.values()));
    if (!localStorage.getItem(recordsKey('clients'))) this.write(recordsKey('clients'), CLIENTS_RECORDS);
    if (!localStorage.getItem(recordsKey('employees'))) this.write(recordsKey('employees'), EMPLOYEES_RECORDS);
  }
}
