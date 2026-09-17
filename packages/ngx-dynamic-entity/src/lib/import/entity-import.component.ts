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
  formatConfigProblems,
  type EntityFormConfig,
  type FormRule,
  type ImportLookups,
  type ImportResult,
  type MappingPlan,
} from '@dynamic-entity/core';
import { IMPORT_TRANSPORT } from '../tokens/injection-tokens';
import { UiTextService } from '../services/ui-text.service';
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
              [lookups]="lookups"
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
              {{ ui.text('importSucceeded', language, { count: done.records.length }) }}
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
            <ngx-import-errors [errors]="done.errors" [language]="language" />
          }
          <button type="button" data-testid="import-restart" (click)="restart()">
            {{ ui.text('importStartOver', language) }}
          </button>
        }
      }
    </div>
  `,
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
  /** Values for any `listName` field; core cannot reach `LOOKUP_REGISTRY` itself. */
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
  private file: File | null = null;

  private get transport(): ImportTransport {
    return this.registered ?? this.local;
  }

  private get context(): ImportContext {
    return {
      config: this.config,
      rules: this.rules,
      lookups: this.lookups,
      lang: this.language,
    };
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

    this.file = file;
    this.fileName.set(file.name);
    this.problem.set(null);
    this.busy.set(true);

    try {
      const preview = await this.transport.preview(file, this.context);
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
      const result = await this.transport.commit(this.file, plan, this.context);

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
      const blob = await this.transport.template(spec, this.templateFormat, this.context);
      this.templateReady.emit(blob);
      saveBlob(blob, `${this.config?.entity || 'import'}-template.${this.templateFormat}`);
    } catch (error) {
      this.problem.set(messageOf(error));
    }
  }

  /** How many distinct rows failed, not how many problems they had between them. */
  protected failedRowCount(result: ImportResult): number {
    return new Set(result.errors.map(error => error.row)).size;
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
