import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import type { ImportRowError } from '@dynamic-entity/core';
import { UiTextService } from '../services/ui-text.service';

/**
 * The rows an import could not take, and why.
 *
 * Grouped by row rather than listed flat: a row with four problems is one row to go and fix,
 * and four separate lines invite the reader to think there are four. The row number is the
 * one the spreadsheet shows in its gutter — header counted as row 1 — because that is the
 * number they will scroll to.
 */
@Component({
  selector: 'ngx-import-errors',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    @if (errors.length) {
      <section class="ngx-import-errors" data-testid="import-errors">
        <h4 class="ngx-import-errors__heading">{{ ui.text('importErrorsHeading', language) }}</h4>
        <table class="ngx-import-errors__table">
          <thead>
            <tr>
              <th scope="col">{{ ui.text('importErrorRow', language, { row: '#' }) }}</th>
              <th scope="col">{{ ui.text('importErrorField', language) }}</th>
              <th scope="col">{{ ui.text('importErrorReason', language) }}</th>
            </tr>
          </thead>
          <tbody>
            @for (group of grouped(); track group.row) {
              @for (problem of group.problems; track $index) {
                <tr [attr.data-testid]="'import-error-row-' + group.row">
                  @if ($first) {
                    <th scope="row" [attr.rowspan]="group.problems.length">
                      {{ ui.text('importErrorRow', language, { row: group.row }) }}
                    </th>
                  }
                  <td>{{ problem.ref }}</td>
                  <td>{{ problem.message }}</td>
                </tr>
              }
            }
          </tbody>
        </table>
      </section>
    }
  `,
  styles: [
    `
      .ngx-import-errors__heading {
        margin: 0 0 8px;
        font-size: var(--ngx-font-size, 14px);
        color: var(--ngx-color-error, #b91c1c);
      }
      .ngx-import-errors__table {
        width: 100%;
        border-collapse: collapse;
      }
      .ngx-import-errors__table th,
      .ngx-import-errors__table td {
        text-align: left;
        padding: 6px 10px;
        border-bottom: 1px solid var(--ngx-color-border, #e5e7eb);
        vertical-align: top;
      }
      .ngx-import-errors__table thead th {
        color: var(--ngx-color-muted, #6b7280);
      }
      .ngx-import-errors__table tbody th {
        white-space: nowrap;
        color: var(--ngx-color-error, #b91c1c);
      }
    `,
  ],
})
export class ImportErrorsComponent {
  @Input() errors: readonly ImportRowError[] = [];
  @Input() language = 'en';

  protected readonly ui = inject(UiTextService);

  /** Row number → its problems, in the order the rows appear in the file. */
  protected grouped(): { row: number; problems: ImportRowError[] }[] {
    const byRow = new Map<number, ImportRowError[]>();
    for (const error of this.errors) {
      const list = byRow.get(error.row) ?? [];
      list.push(error);
      byRow.set(error.row, list);
    }
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([row, problems]) => ({ row, problems }));
  }
}
