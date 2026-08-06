import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DynamicFormComponent,
  EntityFormConfig,
  VersionedRecord
} from 'ngx-dynamic-entity';
import { BuilderPageComponent } from './builder-page.component';
import { LocalStore } from './mock/local-store.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, DynamicFormComponent, BuilderPageComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  private readonly store = inject(LocalStore);
  protected readonly JSON = JSON;

  // ─── Signals ──────────────────────────────────────────────────────────────
  readonly userRoles = signal<string[]>(['admin']);
  readonly view = signal<'list' | 'form' | 'config' | 'builder'>('list');
  readonly config = signal<EntityFormConfig | null>(null);
  readonly allConfigs = signal<EntityFormConfig[]>([]);
  readonly records = signal<VersionedRecord[]>([]);
  readonly selectedRecord = signal<VersionedRecord | null>(null);
  readonly selectedConfig = signal<EntityFormConfig | null>(null);
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
    this.loadConfig();
    this.loadRecords();
  }

  // ─── Data Loading (localStorage — no API) ──────────────────────────────────

  loadAllConfigs() {
    this.allConfigs.set(this.store.listConfigs() as EntityFormConfig[]);
  }

  loadConfig() {
    const config = this.store.getConfig('clients') as EntityFormConfig | null;
    if (config) this.config.set(config);
  }

  loadRecords() {
    this.loading.set(true);
    const res = this.store.getRecords('clients', {
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
    this.currentPage.set(1); // Reset to first page on search
    this.loadRecords();
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  setRole(role: string) {
    this.userRoles.set([role]);
    this.loadRecords(); // Reload to see server-side masking change
  }

  setView(view: 'list' | 'form' | 'config' | 'builder') {
    this.view.set(view);
    if (view === 'config') {
      this.selectedConfig.set(null);
    }
  }

  onRowClick(record: VersionedRecord) {
    this.selectedRecord.set(record);
    this.view.set('form');
  }

  onCreateNew() {
    this.selectedRecord.set(null);
    this.view.set('form');
  }

  onFormSubmit(data: any) {
    if (this.selectedRecord()) {
      this.store.updateRecord('clients', this.selectedRecord()!['_id'] as string, data);
    } else {
      this.store.createRecord('clients', data);
    }
    this.loadRecords();
    this.view.set('list');
  }

  onConfigSubmit(config: any) {
    if (this.selectedConfig()) {
      this.store.updateConfig(config.entity, config);
    } else {
      this.store.saveConfig(config);
    }
    this.loadAllConfigs();
    this.view.set('list');
  }

  onCancel() {
    this.view.set('list');
  }
}
