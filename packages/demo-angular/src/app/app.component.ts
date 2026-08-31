import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DynamicFormComponent,
  DynamicRecordFormComponent,
  EntityFormConfig,
  LocalizedText,
  VersionedRecord,
  resolveLabel
} from 'ngx-dynamic-entity';
import { BuilderPageComponent } from './builder-page.component';
import { LocalStore } from './mock/local-store.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, DynamicFormComponent, DynamicRecordFormComponent, BuilderPageComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  private readonly store = inject(LocalStore);
  protected readonly JSON = JSON;

  // ─── Signals ──────────────────────────────────────────────────────────────
  readonly selectedEntity = signal<string>('clients');
  readonly userRoles = signal<string[]>(['admin']);
  readonly view = signal<'list' | 'form' | 'config' | 'builder'>('list');
  readonly config = signal<EntityFormConfig | null>(null);
  readonly allConfigs = signal<EntityFormConfig[]>([]);
  readonly records = signal<VersionedRecord[]>([]);
  readonly selectedRecord = signal<VersionedRecord | null>(null);
  /**
   * Renders the record editor instead of the plain form.
   *
   * `ngx-dynamic-record-form` is the only component with the summary panel and its quick-jump
   * links, so without a way to reach it here nothing in the demo exercised `jumpToField`.
   */
  readonly recordView = signal(false);
  readonly selectedConfig = signal<Partial<EntityFormConfig> | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly totalRecords = signal<number>(0);
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(20);
  readonly sortField = signal<string>('');
  readonly sortDir = signal<'asc' | 'desc'>('desc');
  readonly searchTerm = signal<string>('');

  // ─── Computed ─────────────────────────────────────────────────────────────
  readonly currentRole = computed(() => this.userRoles()[0]);

  ngOnInit() {
    this.loadAllConfigs();
    this.loadEntity(this.selectedEntity());
  }

  // ─── Data Loading ──────────────────────────────────────────────────────────

  loadAllConfigs() {
    this.allConfigs.set(this.store.listConfigs() as EntityFormConfig[]);
  }

  onEntityChange(entityKey: string) {
    this.selectedEntity.set(entityKey);
    this.currentPage.set(1);
    this.searchTerm.set('');
    // Switching entity while a record was open kept that record selected and swapped the
    // config underneath it, leaving the form bound to a record the new schema knows nothing
    // about — every field blank under a heading naming the new entity. A different entity
    // means a different list.
    this.selectedRecord.set(null);
    if (this.view() === 'form') this.view.set('list');
    this.loadEntity(entityKey);
  }

  loadEntity(entityKey: string) {
    const config = this.store.getConfig(entityKey) as EntityFormConfig | null;
    if (config) {
      this.config.set(config);
    }
    this.loadRecords();
  }

  loadRecords() {
    this.loading.set(true);
    const res = this.store.getRecords(this.selectedEntity(), {
      page: this.currentPage(),
      pageSize: this.pageSize(),
      search: this.searchTerm() || undefined,
      sortField: this.sortField() || undefined,
      sortDir: this.sortDir(),
      roles: this.userRoles(),
    });
    this.records.set(res.data as VersionedRecord[]);
    this.totalRecords.set(res.total);
    this.loading.set(false);
  }

  // ─── Event Handlers ────────────────────────────────────────────────────────

  onPageChange(page: number) {
    this.currentPage.set(page);
    this.loadRecords();
  }

  onSortChange(event: { field: string; dir: 'asc' | 'desc' }) {
    this.sortField.set(event.field);
    this.sortDir.set(event.dir);
    this.loadRecords();
  }

  onSearchChange(term: string) {
    this.searchTerm.set(term);
    this.currentPage.set(1);
    this.loadRecords();
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  setRole(role: string) {
    this.userRoles.set([role]);
    this.loadRecords();
  }

  setView(view: 'list' | 'form' | 'config' | 'builder') {
    this.view.set(view);
    if (view === 'config') {
      this.selectedConfig.set(null);
    }
  }

  onRowClick(record: VersionedRecord) {
    // List rows may be a masked copy (`XXXXXXXXX` in place of real values). The form must
    // open the stored record — masking is a render concern, not a data one.
    const id = record['_id'] as string | undefined;
    const stored = id
      ? (this.store.getAllRecords(this.selectedEntity()).find(r => r['_id'] === id) as VersionedRecord | undefined)
      : undefined;
    this.selectedRecord.set(stored ?? record);
    this.view.set('form');
  }

  onCreateNew() {
    this.selectedRecord.set(null);
    this.view.set('form');
  }

  onFormSubmit(data: any) {
    const entity = this.selectedEntity();
    if (this.selectedRecord()) {
      this.store.updateRecord(entity, this.selectedRecord()!['_id'] as string, data);
    } else {
      this.store.createRecord(entity, data);
    }
    this.loadRecords();
    this.view.set('list');
  }

  onConfigSubmit(config: any) {
    const existing = this.selectedConfig();
    if (existing && existing.entity) {
      this.store.updateConfig(config.entity, config);
    } else {
      this.store.saveConfig(config);
    }
    this.loadAllConfigs();
    this.onEntityChange(config.entity);
    this.view.set('list');
  }

  onBuilderSave(entityKey: string) {
    this.loadAllConfigs();
    this.onEntityChange(entityKey);
  }

  onCancel() {
    this.view.set('list');
  }

  /** Render any cell value as text, resolving language-keyed dropdown values. */
  private asText(value: unknown): string {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return resolveLabel(value as LocalizedText, 'en');
    }
    return String(value ?? '');
  }

  /** The field a config marks as its display name, if any. */
  private nameFieldId(): string | null {
    const walk = (fields: any[] | undefined): string | null => {
      for (const f of fields ?? []) {
        if (f?.table?.isName) return f.id as string;
        const nested = walk(f?.children);
        if (nested) return nested;
      }
      return null;
    };
    const walkTabs = (tabs: any[] | undefined): string | null => {
      for (const t of tabs ?? []) {
        const found = walk(t?.fields) ?? walkTabs(t?.children);
        if (found) return found;
      }
      return null;
    };
    return walkTabs((this.config() as any)?.tabs);
  }

  getRecordLabel(rec: VersionedRecord): string {
    if (!rec) return 'Record';

    // `table.isName` is how a config declares its display field. Honouring it first means a
    // new entity labels its rows correctly without being added to the guesswork below.
    const nameField = this.nameFieldId();
    if (nameField) {
      const direct = rec[nameField];
      if (direct) return this.asText(direct);
      for (const val of Object.values(rec)) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const nested = (val as Record<string, unknown>)[nameField];
          if (nested) return this.asText(nested);
        }
      }
    }

    if (rec['name'] && rec['company'] && rec['status']) {
      // A dropdown value is a language-keyed object — resolve it before interpolating,
      // or the row reads "[object Object]".
      return `${rec['name']} — ${rec['company']} · ${this.asText(rec['status'])}`;
    }
    const keys = ['name', 'fullName', 'firstName', 'title', 'company', 'organizationName', 'studentName', 'patientName', 'description'];
    for (const k of keys) {
      if (rec[k]) return String(rec[k]);
      for (const val of Object.values(rec)) {
        if (val && typeof val === 'object' && !Array.isArray(val) && (val as Record<string, unknown>)[k]) {
          return String((val as Record<string, unknown>)[k]);
        }
      }
    }
    return `Record (${rec['_id'] || 'new'})`;
  }
}
