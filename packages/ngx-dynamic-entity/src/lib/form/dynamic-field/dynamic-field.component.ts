import {
  Component,
  ComponentRef,
  Injector,
  Input,
  OnChanges, OnDestroy,
  SimpleChanges,
  ViewChild,
  ViewContainerRef,
  inject,
  isDevMode,
} from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import type { NestedFieldConfig, EntityFormConfig, NestedTabConfig } from '@dynamic-entity/core';
import { findTab } from '@dynamic-entity/core';
import { FieldRegistryService } from '../../services/field-registry.service';
import { RbacService } from '../../services/rbac.service';

/**
 * DynamicFieldComponent — mounts the correct field component for a given NestedFieldConfig.
 * Uses ViewContainerRef.createComponent() and passes inputs via setInput(); see
 * DynamicFieldComponentContract for the five inputs every field component receives.
 * Never add field-type-specific logic here — this component must remain generic.
 *
 * The 5 inputs (field, control, language, readonly, masked) are passed to every mounted
 * component uniformly — no special-casing per type.
 */
@Component({
  selector: 'ngx-dynamic-field',
  standalone: true,
  template: `<ng-container #fieldHost></ng-container>`,
})
export class DynamicFieldComponent implements OnChanges, OnDestroy {
  @Input() field!: NestedFieldConfig;
  @Input() control!: AbstractControl;
  @Input() config!: EntityFormConfig;
  @Input() currentTabId?: string;
  @Input() language: string = 'en';
  @Input() readonly: boolean = false;
  @Input() userRoles: string[] = [];

  @ViewChild('fieldHost', { read: ViewContainerRef, static: true })
  private readonly fieldHost!: ViewContainerRef;

  private readonly fieldRegistry = inject(FieldRegistryService);
  private readonly rbacService = inject(RbacService);
  /**
   * Passed into `createComponent` so a hosted field sees this host's injector — including
   * `DynamicFormComponent`'s scoped `EntityRefSelectionService`. Without it, a standalone
   * field resolves the root bus and `autoPatch` never runs.
   */
  private readonly injector = inject(Injector);

  private componentRef: ComponentRef<unknown> | null = null;

  ngOnChanges(_changes: SimpleChanges): void {
    this.mountField();
  }

  private mountField(): void {
    if (!this.field || !this.control) return;

    const ComponentClass = this.fieldRegistry.resolve(this.field.type);
    if (!ComponentClass) {
      this.warnUnresolved(this.field.type);
      return; // Unknown field type — render nothing
    }

    // Determine masking for this specific field
    const tab: NestedTabConfig | null = this.currentTabId ? findTab(this.config?.tabs, this.currentTabId) : null;
    const masked = this.rbacService.shouldMaskField(this.field, tab ?? undefined, this.config, this.userRoles);

    // Re-use existing component if same type, otherwise recreate
    if (this.componentRef && this.componentRef.instance instanceof ComponentClass) {
      this.setInputs(this.componentRef, masked);
      return;
    }

    this.fieldHost.clear();
    this.componentRef = this.fieldHost.createComponent(ComponentClass, {
      injector: this.injector,
    });
    this.setInputs(this.componentRef, masked);
    this.watchControl();
    this.componentRef.changeDetectorRef.detectChanges();
  }

  /**
   * Field types are opt-in (see `provideFieldTypes` / `provideBuiltInFieldTypes`), so an
   * unregistered type renders nothing. Say so once per type in dev builds rather than
   * leaving a silently blank slot.
   */
  private warnUnresolved(type: string): void {
    if (!isDevMode() || DynamicFieldComponent.warnedTypes.has(type)) return;
    DynamicFieldComponent.warnedTypes.add(type);
    console.warn(
      `[ngx-dynamic-entity] No component registered for field type "${type}" — the field was not rendered. ` +
        `Register it with provideFieldTypes({ '${type}': MyComponent }) or provideBuiltInFieldTypes().`,
    );
  }

  private static readonly warnedTypes = new Set<string>();

  /**
   * Re-check the hosted field component.
   *
   * The field components are OnPush, so they re-render on an input change, an event from
   * their own template, or a signal they read. `form.markAllAsTouched()` is none of those —
   * it flips `touched` from outside, and every field's error message depends on it. Without
   * this, a blocked submit would mark the form touched and no error would appear.
   */
  refresh(): void {
    this.componentRef?.changeDetectorRef.detectChanges();
  }

  /**
   * Re-check the hosted component whenever its control changes from outside.
   *
   * The field components are OnPush, so they re-render on an input change or an event from
   * their own template. A control mutated externally is neither — and that is not an edge
   * case: patchForm, reset, autoPatch and patchOnTrue all do exactly that. Without this, a
   * field patched from a record would keep rendering its previous value.
   *
   * `detectChanges()` rather than `markForCheck()`: a selection that arrives from a native
   * `change` event (or Playwright) may not be followed by another Angular tick, so a dirty
   * flag would never be flushed. Running CD on the hosted component now is the copy showing up.
   *
   * Done here rather than in each of the eighteen field components: the host owns the
   * component reference, so one subscription covers every type including custom ones.
   */
  private watchControl(): void {
    this.controlSub?.unsubscribe();
    if (!this.control) return;

    this.controlSub = this.control.valueChanges.subscribe(() => this.refresh());
  }

  private controlSub?: Subscription;

  ngOnDestroy(): void {
    this.controlSub?.unsubscribe();
  }

  /**
   * Pass all 5 contract inputs via ComponentRef.setInput() — uniform for all types.
   * The public shape is DynamicFieldComponentContract.
   * Must use setInput(), not property assignment: the field components declare inputs with
   * definite assignment and no initializer, and the lib compiles with
   * useDefineForClassFields:false, so `'field' in instance` is false until first set.
   */
  private setInputs(ref: ComponentRef<unknown>, masked: boolean): void {
    ref.setInput('field', this.field);
    ref.setInput('control', this.control);
    ref.setInput('language', this.language);
    ref.setInput('readonly', this.readonly || !!this.field.readonly);
    ref.setInput('masked', masked);
  }
}
