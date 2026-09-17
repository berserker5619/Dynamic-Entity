import { Component, Input, inject, signal } from '@angular/core';
import { EntityImportComponent } from 'ngx-dynamic-entity';
import type { EntityFormConfig, FormRule, ImportResult } from '@dynamic-entity/core';
import { LocalStore } from './mock/local-store.service';

/**
 * Demo host for `<ngx-entity-import>`.
 *
 * It does what a real host does and no more: hand the wizard a config and the rules that
 * config is rendered with, then save what comes back. Saving is the host's job — the wizard
 * produces records and has no opinion about where they go, which is why `importComplete`
 * exists rather than the component writing anywhere itself.
 *
 * Passing `[rules]` is the part worth copying. Without them an import checks field validators
 * only, which is not what the form enforces: a rule can attach an error, and a rule that hides
 * a field has to relax its `required`. A wizard given no rules will reject rows the form
 * would have accepted.
 */
@Component({
  selector: 'app-import-page',
  standalone: true,
  imports: [EntityImportComponent],
  template: `
    <section class="import-page">
      <h2>Import records</h2>
      @if (config) {
        <ngx-entity-import
          [config]="config"
          [rules]="rules"
          [language]="uiLanguage"
          (importComplete)="onImported($event)"
        />
        @if (saved()) {
          <p class="import-page__saved" data-testid="demo-import-saved">
            Saved {{ saved() }} record(s) to the demo store.
          </p>
        }
      } @else {
        <p data-testid="demo-import-no-config">Pick an entity first.</p>
      }
    </section>
  `,
  styles: [
    `
      .import-page {
        padding: 16px;
      }
      .import-page__saved {
        margin-top: 12px;
        font-weight: 600;
      }
    `,
  ],
})
export class ImportPageComponent {
  @Input() config: EntityFormConfig | null = null;
  @Input() uiLanguage: 'en' | 'de' = 'en';
  /**
   * The rules the form is rendered with.
   *
   * Empty in this demo because its sample entities carry none. It is an input rather than an
   * omission so the wiring a real host needs is visible here: leave it out and an import
   * checks field validators only, which is not what the form enforces.
   */
  @Input() rules: readonly FormRule[] = [];

  private readonly store = inject(LocalStore);
  readonly saved = signal(0);

  onImported(result: ImportResult): void {
    for (const record of result.records) {
      this.store.createRecord(this.config?.entity ?? '', record);
    }
    this.saved.set(result.records.length);
  }
}
