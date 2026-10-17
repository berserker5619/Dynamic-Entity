import { Component, Injectable, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  EntityImportComponent,
  LocalImportTransport,
  provideHttpImportTransport,
  IMPORT_TRANSPORT
} from 'ngx-dynamic-entity';
import type { EntityFormConfig, ImportResult } from '@dynamic-entity/core';

export const customerConfig: EntityFormConfig = {
  entity: 'customers',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      flatData: true,
      fields: [
        { id: 'name', type: 'text', label: { en: 'Full Name' }, validators: { required: true } },
        { id: 'email', type: 'text', label: { en: 'Email Address' }, validators: { required: true } },
        { id: 'city', type: 'text', label: { en: 'City' } }
      ]
    }
  ]
};

export const employeeDateConfig: EntityFormConfig = {
  entity: 'employees',
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      flatData: true,
      fields: [
        { id: 'name', type: 'text', label: { en: 'Employee Name' }, validators: { required: true } },
        { id: 'joinDate', type: 'date', label: { en: 'Join Date' }, validators: { required: true } }
      ]
    }
  ]
};

export const storedPlan25: any = {
  entity: 'customers',
  configVersion: 1,
  entries: [
    { ref: 'name', column: 0 },
    { ref: 'email', column: 1 },
    { ref: 'city', column: 2 }
  ]
};

@Component({
  selector: 'app-local-import',
  standalone: true,
  imports: [CommonModule, EntityImportComponent],
  template: `
    <div class="mode-section" data-testid="mode-local-section">
      <h3>Local Import Transport (In-Browser)</h3>
      <ngx-entity-import
        [config]="config"
        (importComplete)="onComplete($event)"
      />
      @if (importedCount() !== null) {
        <div class="status-card" data-testid="local-import-status">
          Import finished! Saved {{ importedCount() }} records in browser memory.
        </div>
      }
    </div>
  `
})
export class LocalImportPageComponent {
  readonly config = customerConfig;
  readonly importedCount = signal<number | null>(null);

  onComplete(res: ImportResult) {
    this.importedCount.set(res.records?.length ?? 0);
  }
}

@Component({
  selector: 'app-http-import',
  standalone: true,
  imports: [CommonModule, EntityImportComponent],
  providers: [
    provideHttpImportTransport({ baseUrl: 'http://localhost:4321/api/import' })
  ],
  template: `
    <div class="mode-section" data-testid="mode-http-section">
      <h3>HTTP Import Transport (Server Router over HTTP)</h3>
      <ngx-entity-import
        [config]="config"
        (importComplete)="onComplete($event)"
      />
      @if (importedCount() !== null) {
        <div class="status-card" data-testid="http-import-status">
          Server import complete! Imported {{ importedCount() }} records to backend.
        </div>
      }
    </div>
  `
})
export class HttpImportPageComponent {
  readonly config = customerConfig;
  readonly importedCount = signal<number | null>(null);

  onComplete(res: ImportResult) {
    this.importedCount.set(res.records?.length ?? 0);
  }
}

@Component({
  selector: 'app-mismatch-import',
  standalone: true,
  imports: [CommonModule, EntityImportComponent],
  providers: [
    provideHttpImportTransport({ baseUrl: 'http://localhost:4321/api/import-mismatch' })
  ],
  template: `
    <div class="mode-section" data-testid="mode-mismatch-section">
      <h3>Date-Order Mismatch Check (Wizard: DMY vs Server: MDY)</h3>
      <ngx-entity-import
        [config]="config"
        [dateOrder]="'DMY'"
        (importComplete)="onComplete($event)"
      />
    </div>
  `
})
export class MismatchImportPageComponent {
  readonly config = employeeDateConfig;
  onComplete(_res: ImportResult) {}
}

@Injectable()
export class StoredPlanTransport extends LocalImportTransport {
  override async preview(file: File, context: any) {
    const prev = await super.preview(file, context);
    return {
      ...prev,
      suggestion: storedPlan25
    };
  }
}

@Component({
  selector: 'app-stored-plan-import',
  standalone: true,
  imports: [CommonModule, EntityImportComponent],
  providers: [
    StoredPlanTransport,
    { provide: IMPORT_TRANSPORT, useExisting: StoredPlanTransport }
  ],
  template: `
    <div class="mode-section" data-testid="mode-stored-plan-section">
      <h3>Stored 2.5 Plan Reopened in 3.0 Wizard</h3>
      <ngx-entity-import
        [config]="config"
        (importComplete)="onComplete($event)"
      />
      @if (importedCount() !== null) {
        <div class="status-card" data-testid="stored-plan-import-status">
          2.5 Plan import complete! Imported {{ importedCount() }} records.
        </div>
      }
    </div>
  `
})
export class StoredPlanImportPageComponent {
  readonly config = customerConfig;
  readonly importedCount = signal<number | null>(null);

  onComplete(res: ImportResult) {
    this.importedCount.set(res.records?.length ?? 0);
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    LocalImportPageComponent,
    HttpImportPageComponent,
    MismatchImportPageComponent,
    StoredPlanImportPageComponent
  ],
  template: `
    <div class="app-container">
      <header class="app-header">
        <h1 class="app-title">Fresh Angular RC Import App</h1>
        <p class="app-subtitle">Testing published <code>ngx-dynamic-entity@next</code> and <code>@dynamic-entity/core@next</code></p>
      </header>

      <nav class="nav-tabs" role="tablist">
        <button
          class="nav-tab-btn"
          [class.active]="tab() === 'local'"
          data-testid="tab-local"
          (click)="tab.set('local')"
        >
          1. Local Transport
        </button>
        <button
          class="nav-tab-btn"
          [class.active]="tab() === 'http'"
          data-testid="tab-http"
          (click)="tab.set('http')"
        >
          2. HTTP Transport
        </button>
        <button
          class="nav-tab-btn"
          [class.active]="tab() === 'mismatch'"
          data-testid="tab-mismatch"
          (click)="tab.set('mismatch')"
        >
          3. Date-Order Mismatch
        </button>
        <button
          class="nav-tab-btn"
          [class.active]="tab() === 'stored-plan'"
          data-testid="tab-stored-plan"
          (click)="tab.set('stored-plan')"
        >
          4. Stored 2.5 Plan
        </button>
      </nav>

      <main class="main-content">
        @switch (tab()) {
          @case ('local') {
            <app-local-import />
          }
          @case ('http') {
            <app-http-import />
          }
          @case ('mismatch') {
            <app-mismatch-import />
          }
          @case ('stored-plan') {
            <app-stored-plan-import />
          }
        }
      </main>
    </div>
  `
})
export class AppComponent {
  readonly tab = signal<'local' | 'http' | 'mismatch' | 'stored-plan'>('local');
}
