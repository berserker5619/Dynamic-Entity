import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import {
  buildTemplateSpec,
  collectLeafTargets,
  formatConfigProblems,
  type EntityFormConfig,
  type FormRule,
  type ImportLookups,
  type ImportResult,
  type MappingPlan,
} from '@dynamic-entity/core';
import { IMPORT_TRANSPORT } from '../tokens/injection-tokens';
import { UiTextService } from '../services/ui-text.service';
import { LookupRegistryService } from '../services/lookup-registry.service';
import { LocalImportTransport } from './local-import-transport';
import { ImportErrorsComponent } from './import-errors.component';
import { ImportMapperComponent } from './import-mapper.component';
import { ImportPreviewComponent } from './import-preview.component';
import { ImportTemplateComponent } from './import-template.component';
import type { ImportContext, ImportTransport, TemplateFormat } from './import-contracts';

type Step = 'upload' | 'map' | 'review' | 'done';

/**
 * The import wizard: choose a file, match its columns, look at what that produced, commit.
 *
 * It holds no import logic of its own. Everything it does goes through an `ImportTransport`,
 * which by default is the in-browser one built on `@dynamic-entity/core` — so the wizard
 * works with no backend, and a consumer who registers a server transport gets the same
 * screens over the same mapping rules rather than a second implementation of them.
 *
 * The review step exists because the expensive mistake here is not a file that fails to
 * import, it is one that imports *successfully into the wrong fields*. That is invisible in a
 * summary and obvious in five rendered rows.
 */
@Component({
  selector: 'ngx-entity-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ImportTemplateComponent,
    ImportMapperComponent,
    ImportPreviewComponent,
    ImportErrorsComponent,
  ],
  template: `
    <div class="ngx-import" data-testid="entity-import">
      <ol class="ngx-import__steps" data-testid="import-steps">
        @for (name of steps; track name) {
          <li
            class="ngx-import__step"
            [class.ngx-import__step--current]="step() === name"
            [attr.aria-current]="step() === name ? 'step' : null"
            [attr.data-testid]="'import-step-' + name"
          >
            {{ stepLabel(name) }}
          </li>
        }
      </ol>

      @if (problem(); as text) {
        <p class="ngx-import__problem" role="alert" data-testid="import-problem">{{ text }}</p>
      }

      @switch (step()) {
        @case ('upload') {
          <ngx-import-template
            [config]="config"
            [language]="language"
            (download)="downloadTemplate($event)"
          />

          <label class="ngx-import__file">
            <span>{{ ui.text('importChooseFile', language) }}</span>
            <input type="file" data-testid="import-file" (change)="chooseFile($event)" />
          </label>

          @if (busy()) {
            <p data-testid="import-reading">{{ ui.text('importReading', language) }}</p>
          }
          @if (fileName()) {
            <p data-testid="import-file-chosen">
              {{ ui.text('importFileChosen', language, { name: fileName(), rows: rowCount() }) }}
            </p>
          }
        }

        @case ('map') {
          <ngx-import-mapper
            [config]="config"
            [headers]="headers()"
            [plan]="plan()"
            [language]="language"
            (planChange)="plan.set($event)"
          />
          <button type="button" data-testid="import-to-review" (click)="step.set('review')">
            {{ ui.text('importReview', language) }}
          </button>
        }

        @case ('review') {
          @if (plan(); as current) {
            <ngx-import-preview
              [config]="config"
              [plan]="current"
              [rows]="sample()"
              [lookups]="resolvedLookups()"
              [rules]="rules"
              [language]="language"
            />
          }
          <button
            type="button"
            data-testid="import-commit"
            [disabled]="busy()"
            (click)="commit()"
          >
            {{
              busy()
                ? ui.text('importImporting', language)
                : ui.text('importRunImport', language, { count: rowCount() })
            }}
          </button>
          <button type="button" data-testid="import-back" (click)="step.set('map')">
            {{ ui.text('importMap', language) }}
          </button>
        }

        @case ('done') {
          @if (result(); as done) {
            <p data-testid="import-succeeded">
              {{ ui.text('importSucceeded', language, { count: importedCount(done) }) }}
            </p>
            @if (done.skipped) {
              <p data-testid="import-skipped">
                {{ ui.text('importSkippedRows', language, { count: done.skipped }) }}
              </p>
            }
            @if (failedRowCount(done)) {
              <p data-testid="import-failed">
                {{ ui.text('importFailedRows', language, { count: failedRowCount(done) }) }}
              </p>
            }
            @if (done.truncated) {
              <p data-testid="import-errors-truncated">
                {{
                  ui.text('importErrorsTruncated', language, {
                    shown: done.errors.length,
                    count: done.errorCount ?? done.errors.length,
                  })
                }}
              </p>
            }
            <ngx-import-errors [errors]="done.errors" [language]="language" />
          }
          <button type="button" data-testid="import-restart" (click)="restart()">
            {{ ui.text('importStartOver', language) }}
          </button>
        }
      }
    </div>
  `,
  styles: [
    `
      .ngx-import {
        display: flex;
        flex-direction: column;
        gap: var(--ngx-gap, 16px);
        color: var(--ngx-color-text, #1f2937);
        font-size: var(--ngx-font-size, 14px);
      }
      .ngx-import__steps {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .ngx-import__step {
        padding: 4px 12px;
        border: 1px solid var(--ngx-color-border, #e5e7eb);
        border-radius: var(--ngx-radius-sm, 6px);
        color: var(--ngx-color-muted, #6b7280);
        background: var(--ngx-color-surface-alt, #f9fafb);
      }
      .ngx-import__step--current {
        color: var(--ngx-color-accent, #4f46e5);
        border-color: var(--ngx-color-accent, #4f46e5);
        background: var(--ngx-color-accent-soft, #e0e7ff);
        font-weight: 600;
      }
      .ngx-import__problem {
        margin: 0;
        padding: 10px 12px;
        border: 1px solid var(--ngx-color-border, #fecaca);
        border-radius: var(--ngx-radius-sm, 6px);
        background: var(--ngx-color-error-soft, #fef2f2);
        color: var(--ngx-color-error, #b91c1c);
        /* A parser message can be a whole sentence with a filename in it. */
        overflow-wrap: anywhere;
      }
      .ngx-import__file {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 14px;
        border: 1px dashed var(--ngx-color-border, #d1d5db);
        border-radius: var(--ngx-radius-sm, 6px);
        background: var(--ngx-color-surface, #ffffff);
      }
      .ngx-import button {
        align-self: flex-start;
        padding: 8px 16px;
        border: 1px solid var(--ngx-color-border, #d1d5db);
        border-radius: var(--ngx-radius-sm, 6px);
        background: var(--ngx-color-surface, #ffffff);
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .ngx-import button:hover:not(:disabled) {
        border-color: var(--ngx-color-accent, #4f46e5);
        background: var(--ngx-color-accent-soft, #e0e7ff);
      }
      .ngx-import button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
    `,
  ],
})
export class EntityImportComponent {
  @Input({ required: true }) config!: EntityFormConfig;
  /**
   * The rules the form is rendered with.
   *
   * Pass them, or the import checks field validators only — which is not what the form
   * enforces, and a required field hidden by a rule will fail every row.
   */
  @Input() rules?: readonly FormRule[];
  /**
   * Named lists, overriding what the wizard already resolves from `LOOKUP_REGISTRY`.
   *
   * Not something a host has to supply: every `listName` a config mentions is loaded from the
   * registry the renderer is already holding. Pass this only to override one.
   */
  @Input() lookups?: ImportLookups;
  @Input() language = 'en';
  /** Format asked of the transport when a template is downloaded. */
  @Input() templateFormat: TemplateFormat = 'csv';

  /** The finished import, once it has run. */
  @Output() readonly importComplete = new EventEmitter<ImportResult>();
  /** A template the transport produced, for a host that would rather save it its own way. */
  @Output() readonly templateReady = new EventEmitter<Blob>();

  protected readonly ui = inject(UiTextService);
  protected readonly steps: Step[] = ['upload', 'map', 'review', 'done'];

  protected readonly step = signal<Step>('upload');
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly headers = signal<string[]>([]);
  protected readonly sample = signal<string[][]>([]);
  protected readonly rowCount = signal(0);
  protected readonly fileName = signal('');
  protected readonly plan = signal<MappingPlan | null>(null);
  protected readonly result = signal<ImportResult | null>(null);

  private readonly registered = inject(IMPORT_TRANSPORT, { optional: true });
  private readonly local = inject(LocalImportTransport);
  private readonly lookupRegistry = inject(LookupRegistryService);
  private file: File | null = null;

  /** Named lists resolved from `LOOKUP_REGISTRY`, merged under the `lookups` input. */
  protected readonly resolvedLookups = signal<ImportLookups>({});

  private get transport(): ImportTransport {
    return this.registered ?? this.local;
  }

  private context(): ImportContext {
    return {
      config: this.config,
      rules: this.rules,
      lookups: this.resolvedLookups(),
      lang: this.language,
    };
  }

  /**
   * Load every named list this config's fields refer to.
   *
   * `@dynamic-entity/core` is framework-agnostic and cannot reach `LOOKUP_REGISTRY`, so
   * `coerceCell` takes the values as an argument. That is a reason for *core* to ask, not a
   * reason for the host to be asked — this package is holding the registry, and making the
   * consumer re-supply what the library already has is how a `listName` column ends up
   * storing the raw text `"Gold"` instead of the option object. Such a record renders
   * correctly and then matches no rule, which is the exact failure the option-shape contract
   * exists to prevent.
   *
   * The `lookups` input still wins where it names a list, so a host can override one without
   * having to provide all of them.
   */
  private async loadLookups(): Promise<void> {
    const fromRegistry: ImportLookups = {};

    const names = new Set<string>();
    for (const target of collectLeafTargets(this.config)) {
      if (target.field.listName) names.add(target.field.listName);
    }

    for (const listName of names) {
      // A list that fails to load is not a reason to refuse the import: the field falls back
      // to passing its text through, which is what happens today for an unregistered list.
      try {
        const options = await this.lookupRegistry.resolveOptions(
          { id: listName, type: 'dropdown', label: {}, listName },
          this.language,
        );
        if (options.length) fromRegistry[listName] = options;
      } catch {
        /* left out, so the field passes its text through */
      }
    }

    this.resolvedLookups.set({ ...fromRegistry, ...(this.lookups ?? {}) });
  }

  protected stepLabel(step: Step): string {
    // One key per step rather than an index, so a translator sees words and not positions.
    const keys = {
      upload: 'importUpload',
      map: 'importMap',
      review: 'importReview',
      done: 'importDone',
    } as const;
    return this.ui.text(keys[step], this.language);
  }

  protected async chooseFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) {
      this.problem.set(this.ui.text('importNeedFile', this.language));
      return;
    }

    this.problem.set(null);
    this.busy.set(true);

    try {
      await this.loadLookups();
      const preview = await this.transport.preview(file, this.context());
      // Assigned only once the file has been read: holding a file whose headers describe the
      // previous one is an invariant worth not having to reason about.
      this.file = file;
      this.fileName.set(file.name);
      this.headers.set(preview.headers);
      this.sample.set(preview.sample);
      this.rowCount.set(preview.rowCount);
      this.plan.set(preview.suggestion);
      this.step.set('map');
    } catch (error) {
      // A parser refusing a format, or a file that is not what it claims, is ordinary user
      // input rather than a defect — it is reported where the user is looking.
      this.problem.set(messageOf(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async commit(): Promise<void> {
    const plan = this.plan();
    if (!this.file || !plan) {
      this.problem.set(this.ui.text('importNeedFile', this.language));
      return;
    }

    this.busy.set(true);
    this.problem.set(null);

    try {
      const result = await this.transport.commit(this.file, plan, this.context());

      // A plan-level error means nothing was imported, and saying "imported 0 records" would
      // describe that as a successful run of an empty file.
      const fatal = result.planProblems?.filter(p => p.level === 'error') ?? [];
      if (fatal.length) {
        this.problem.set(
          this.ui.text('importPlanProblem', this.language, {
            message: formatConfigProblems(fatal),
          }),
        );
        this.step.set('map');
        return;
      }

      this.result.set(result);
      this.step.set('done');
      this.importComplete.emit(result);
    } catch (error) {
      this.problem.set(messageOf(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async downloadTemplate(fields: string[]): Promise<void> {
    this.problem.set(null);
    try {
      const spec = buildTemplateSpec(this.config, { lang: this.language, fields });
      const blob = await this.transport.template(spec, this.templateFormat, this.context());
      this.templateReady.emit(blob);
      saveBlob(blob, `${this.config?.entity || 'import'}-template.${this.templateFormat}`);
    } catch (error) {
      this.problem.set(messageOf(error));
    }
  }

  /**
   * How many records were written.
   *
   * `records.length` for the in-browser transport, which returns every record it built, and
   * `imported` for a server one, which streamed the file precisely so that fifty thousand
   * records never had to exist at once and therefore has a number rather than a list. Reading
   * `records.length` alone would report a successful import of nothing.
   */
  protected importedCount(result: ImportResult): number {
    return result.imported ?? result.records.length;
  }

  /**
   * How many distinct rows failed, not how many problems they had between them.
   *
   * `failed` when the transport reports it, and the distinct rows in `errors` only when it does
   * not. Counting the errors alone was wrong the moment a transport started capping them: a run
   * of a thousand rows where two hundred failed said **seven**, because seven was how many
   * distinct rows fitted inside the first twenty retained problems. This is the number a user
   * acts on — which rows do I go and fix — so a confident wrong answer is the worst of the
   * available ones. The in-browser transport returns every error, so counting them there is
   * exact and `failed` is absent.
   */
  protected failedRowCount(result: ImportResult): number {
    return result.failed ?? new Set(result.errors.map(error => error.row)).size;
  }

  protected restart(): void {
    this.file = null;
    this.fileName.set('');
    this.headers.set([]);
    this.sample.set([]);
    this.rowCount.set(0);
    this.plan.set(null);
    this.result.set(null);
    this.problem.set(null);
    this.step.set('upload');
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Hand a generated file to the browser.
 *
 * The object URL is revoked on the next turn rather than immediately: revoking it in the same
 * task can cancel the download that was just started, and the leak of waiting one tick is a
 * single URL.
 */
function saveBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url));
}
