import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { DropdownOption, NestedFieldConfig } from '@dynamic-entity/core';
import { resolveLabel, resolveOptionLabel, toRefToken } from '@dynamic-entity/core';
import { fieldPathOptions, withExistingOptions, type FieldPathOption } from '../field-path-options';
import { BuilderStore } from '../builder-store.service';
import { getFieldTypeMeta, type FieldTypeMeta } from '../field-catalog';
import { EntityReferenceConfigComponent } from './entity-reference-config.component';
import { FieldRulesListComponent } from './field-rules-list.component';
import { ReferencedFieldConfigComponent } from './referenced-field-config.component';
import { BuilderTextService } from '../builder-text';

/**
 * FieldInspectorComponent — edits every property of the currently selected field.
 */
@Component({
  selector: 'ngx-field-inspector',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
    EntityReferenceConfigComponent,
    FieldRulesListComponent,
    ReferencedFieldConfigComponent,
  ],
  templateUrl: './field-inspector.component.html',
  styles: [
    `
      .deb-inspector {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .deb-inspector__empty {
        color: var(--deb-muted, #6b7280);
        text-align: center;
        padding: 24px 8px;
      }
      .deb-full {
        width: 100%;
      }
      .deb-row > * {
        flex: 1;
      }
      /*
       * The type chip is a label, not a field.
       *
       * The rule above gave it an equal share of the identity row, so the chip took half the
       * inspector's width and squeezed the field id into a column narrow enough to wrap its
       * hint over three lines.
       */
      .deb-row > .deb-chip {
        flex: 0 0 auto;
      }
      .deb-row--split > * {
        flex: 0 0 auto;
      }
      .deb-toggles {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 12px;
      }
      .deb-option-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .deb-chip {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 12px;
        background: var(--deb-accent-soft, #eef2ff);
        color: var(--deb-accent, #6366f1);
        font-size: 12px;
        font-weight: 600;
      }
    `,
  ],
})
export class FieldInspectorComponent {
  /** Builder chrome, overridable via BUILDER_TEXT. */
  protected readonly ui = inject(BuilderTextService);
  protected readonly store = inject(BuilderStore);

  protected readonly field = this.store.selectedField;
  protected readonly meta = computed<FieldTypeMeta | undefined>(() => {
    const f = this.field();
    return f ? getFieldTypeMeta(f.type) : undefined;
  });

  /**
   * The offered widths, as fractions of the 12-column row.
   *
   * Five steps rather than all twelve: a free 1–12 spinner is a layout system, and what an
   * author actually wants is "these two side by side" or "this one across the row". The
   * fractions that divide twelve evenly cover that, and anything finer stays authorable in
   * the JSON for the rare case that needs it.
   */
  protected readonly spanChoices = [
    { span: 3, textKey: 'widthQuarter' },
    { span: 4, textKey: 'widthThird' },
    { span: 6, textKey: 'widthHalf' },
    { span: 8, textKey: 'widthTwoThirds' },
    { span: 12, textKey: 'widthFull' },
  ] as const;

  protected lang(): string {
    return this.store.activeLanguage();
  }

  /**
   * How many validators this field actually has, for the section's badge.
   *
   * `false` and an empty `custom: []` are both "not set" written the long way — a toggle
   * switched off leaves the key behind — so neither counts. `0` does: `minLength: 0` is a
   * value somebody typed.
   */
  protected validatorCount(field: NestedFieldConfig): number {
    return Object.values(field.validators ?? {}).filter(value => {
      if (value === undefined || value === null || value === false) return false;
      return Array.isArray(value) ? value.length > 0 : true;
    }).length;
  }

  /**
   * How many display flags are set away from their default.
   *
   * `visibility` counts when it is *false* and the rest when they are true, because the badge
   * is meant to say "something here is not the default" — counting `visibility: true` would
   * put a 1 on every field in the config and tell the author nothing.
   */
  protected displayFlagCount(field: NestedFieldConfig): number {
    const flags = [
      field.visibility === false,
      field.table?.visible === true,
      field.readonly === true,
      field.disabled === true,
      field.maskData === true,
      field.criticalField === true,
      field.showOnMinimize === true,
    ];
    return flags.filter(Boolean).length;
  }

  protected toNum(value: unknown): number | null {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }

  protected labelValue(field: NestedFieldConfig): string {
    return resolveLabel(field.label, this.lang());
  }

  protected placeholderValue(field: NestedFieldConfig): string {
    return resolveLabel(field.placeholder, this.lang());
  }

  protected hintValue(field: NestedFieldConfig): string {
    return resolveLabel(field.hint, this.lang());
  }

  protected optionLabel(option: DropdownOption): string {
    return resolveOptionLabel(option, this.lang());
  }

  /**
   * Every tab a field can live on, sub-tabs included.
   *
   * `moveFieldToTab` existed on the store with nothing calling it, so a field authored on the
   * wrong tab had to be deleted and rebuilt — losing its validators, options and every rule
   * aimed at it.
   */
  protected readonly tabOptions = computed<{ id: string; label: string }[]>(() =>
    this.store
      .fieldGroups()
      .map(group => ({ id: group.tabId, label: resolveLabel(group.label, this.lang()) || group.tabId }))
      .concat(
        this.store
          .tabs()
          .flatMap(tab => [tab, ...(tab.children ?? [])])
          .map(tab => ({ id: tab.id, label: resolveLabel(tab.label, this.lang()) || tab.id })),
      )
      .filter((tab, i, all) => all.findIndex(t => t.id === tab.id) === i),
  );

  /**
   * The tab the selected field currently sits on.
   *
   * Looked up by identity rather than parsed out of the path: the scope of
   * `incident.incidentDetails.incidentTime` is two segments and the field belongs to the
   * *last* of them, while a field inside a group has the group id in that position and
   * belongs to no tab of that name at all.
   */
  protected currentTabId(field: NestedFieldConfig): string {
    return this.store.fieldGroups().find(group => group.fields.includes(field))?.tabId ?? '';
  }

  protected moveToTab(field: NestedFieldConfig, tabId: string): void {
    if (tabId && tabId !== this.currentTabId(field)) this.store.moveFieldToTab(this.store.keyOf(field), tabId);
  }

  /**
   * Fields offered wherever this inspector names one — the `showWhen` key and both ends of a
   * `patchOnTrue` mapping. All three were free text, which is the one way left to write a
   * reference that names two fields at once.
   */
  protected readonly fieldOptions = computed<FieldPathOption[]>(() =>
    fieldPathOptions(this.store.config(), this.store.activeLanguage()),
  );

  /** Options plus whatever is already selected, so an unknown reference is never dropped. */
  protected optionsWith(...current: (string | undefined)[]): FieldPathOption[] {
    return withExistingOptions(this.fieldOptions(), current);
  }

  // ─── showWhen editing ───────────────────────────────────────────────────────

  protected showWhenEntries(field: NestedFieldConfig): { key: string; display: string }[] {
    return Object.entries(field.showWhen ?? {}).map(([key, value]) => ({
      key,
      display: this.stringifyShowWhen(value),
    }));
  }

  /**
   * Seeds a new condition with the first field not already watched.
   *
   * It used to seed the literal string `field`, which is not a field id at all — so a new
   * condition started out referencing nothing and silently hid the field until it was edited.
   */
  protected addShowWhen(field: NestedFieldConfig): void {
    const next = { ...(field.showWhen ?? {}) };
    const self = toRefToken(field.refererField ?? field.id);
    const candidate = this.fieldOptions().find(o => o.value !== self && !(o.value in next));

    // Falls back to the old placeholder only when there is genuinely nothing else to watch —
    // a config with one field. Otherwise a new condition starts on a real field instead of
    // the literal string `field`, which is not an id at all and hid the field until edited.
    let key = candidate?.value ?? 'field';
    let n = 1;
    while (key in next) key = `field_${++n}`;
    next[key] = true;
    this.store.setShowWhen(this.store.keyOf(field), next);
  }

  protected renameShowWhen(field: NestedFieldConfig, oldKey: string, newKey: string): void {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed === oldKey) return;
    const current = field.showWhen ?? {};
    if (trimmed in current) return;
    const next: Record<string, unknown> = {};
    // Rebuild in order so the row does not jump while the user is typing.
    for (const [k, v] of Object.entries(current)) next[k === oldKey ? trimmed : k] = v;
    this.store.setShowWhen(this.store.keyOf(field), next);
  }

  protected setShowWhenValue(field: NestedFieldConfig, key: string, raw: string): void {
    this.store.setShowWhen(this.store.keyOf(field), { ...(field.showWhen ?? {}), [key]: this.parseShowWhen(raw) });
  }

  protected removeShowWhen(field: NestedFieldConfig, key: string): void {
    const next = { ...(field.showWhen ?? {}) };
    delete next[key];
    this.store.setShowWhen(this.store.keyOf(field), next);
  }

  /**
   * `showWhen` compares with `!==`, so the authored type has to survive the round trip:
   * "true"/"false" become booleans and numeric text becomes a number.
   */
  private parseShowWhen(raw: string): unknown {
    const trimmed = raw.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
    return raw;
  }

  private stringifyShowWhen(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
