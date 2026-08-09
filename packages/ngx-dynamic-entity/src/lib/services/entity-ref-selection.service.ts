import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import type { ReferenceOption } from '@dynamic-entity/core';

export interface EntityRefSelection {
  fieldId: string;
  /** The chosen option, or `null` when the selection was cleared. */
  option: ReferenceOption | null;
}

/**
 * EntityRefSelectionService — the channel an entity-ref field uses to publish *which record*
 * the user picked, so the owning form can run `autoPatch` against it.
 *
 * The control value alone is not enough: `autoPatch` copies fields out of the selected
 * record, which only the field component has after loading its options.
 *
 * Provided at `DynamicFormComponent` level so each form instance gets its own channel;
 * the `root` fallback keeps standalone field components injectable in isolation.
 */
@Injectable({ providedIn: 'root' })
export class EntityRefSelectionService {
  private readonly subject = new Subject<EntityRefSelection>();

  readonly selection$ = this.subject.asObservable();

  emit(fieldId: string, option: ReferenceOption | null): void {
    this.subject.next({ fieldId, option });
  }
}
