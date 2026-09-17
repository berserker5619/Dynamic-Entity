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
