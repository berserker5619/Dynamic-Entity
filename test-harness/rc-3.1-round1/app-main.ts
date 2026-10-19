// The rc.1 round's Angular app (docs/3.1-rc-feedback.md). One source, two builds:
// - csv-app: this file with XLSX = false, and no ngx-dynamic-entity/xlsx import at all;
// - full-app: XLSX = true, with exceljs installed.
// The page is driven by its query string, and the driver hands it a config through
// window.__CONFIG__ (addInitScript) and reads window.__RESULT__ after a commit.
//
//   ?parser=xlsx              provideSheetFileParser()           (full-app only)
//   ?plan=grouped             each suggestion becomes a grouped plan, from code
//   ?transport=http&api=/api/on   HttpImportTransport at that base URL
import { Component, inject, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import type { AnyMappingPlan, EntityFormConfig, ImportResult, MappingEntry, MappingPlan } from '@dynamic-entity/core';
import {
  EntityImportComponent,
  HttpImportTransport,
  IMPORT_TRANSPORT,
  LocalImportTransport,
  provideNgxDynamicEntity,
  type ImportTransport,
} from 'ngx-dynamic-entity';
//__XLSX_IMPORT__

declare global {
  interface Window {
    __CONFIG__?: EntityFormConfig;
    __RESULT__?: ImportResult;
  }
}

const query = new URLSearchParams(location.search);
const SLOT = /^(.+?)\.(\d+)\.(.+)$/;

/** Rows grouped by the first non-array column; each numbered-column array collected from slot 0. */
function groupedPlanOf(suggestion: AnyMappingPlan): AnyMappingPlan {
  const plan = suggestion as MappingPlan;
  const collect = new Set<string>();
  const entries: MappingEntry[] = [];
  for (const entry of plan.entries ?? []) {
    const slot = SLOT.exec(entry.ref);
    if (!slot) entries.push(entry);
    else if (slot[2] === '0') {
      collect.add(slot[1]);
      entries.push({ ...entry, ref: `${slot[1]}.${slot[3]}` });
    }
  }
  const key = (plan.entries ?? []).find(entry => !SLOT.test(entry.ref) && entry.column !== undefined)?.column;
  return key === undefined || !collect.size ? suggestion : { ...plan, planVersion: 2, entries, group: { key: [key], collect: [...collect] } };
}
const grouping = (base: ImportTransport): ImportTransport => ({
  accept: base.accept,
  preview: async (file, context) => {
    const preview = await base.preview(file, context);
    return { ...preview, suggestion: groupedPlanOf(preview.suggestion) };
  },
  commit: (file, plan, context) => base.commit(file, plan, context),
  template: (spec, format, context, fields) => base.template(spec, format, context, fields),
});

@Component({
  selector: 'app-root',
  imports: [EntityImportComponent],
  template: '<ngx-entity-import [config]="config" (importComplete)="done($event)" />',
})
class App {
  protected readonly config: EntityFormConfig = window.__CONFIG__ ?? { entity: 'people', tabs: [{ id: 'main', label: { en: 'Main' }, flatData: true, fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }] }] };
  protected done(result: ImportResult): void {
    window.__RESULT__ = result;
  }
}

const http = query.get('transport') === 'http';
const transport = () => {
  const base: ImportTransport = http ? new HttpImportTransport({ baseUrl: query.get('api') ?? '/api/on' }) : inject(LocalImportTransport);
  return query.get('plan') === 'grouped' ? grouping(base) : base;
};

bootstrapApplication(App, {
  providers: [
    provideZonelessChangeDetection(),
    provideNgxDynamicEntity({}),
    //__XLSX_PROVIDER__
    ...(http || query.get('plan') === 'grouped' ? [{ provide: IMPORT_TRANSPORT, useFactory: transport }] : []),
  ],
}).catch(console.error);
document.title = 'ready';
