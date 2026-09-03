import { TestBed } from '@angular/core/testing';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { DynamicRecordFormComponent } from './dynamic-record-form.component';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { provideNgxDynamicEntity } from '../providers/provide-ngx-dynamic-entity';

/**
 * A `beforeSave` hook must govern every route out of the record editor.
 *
 * Two faults, both invisible because each looked like the other working:
 *
 *   1. **`saveSection` went around the hook.** The record editor saves one tab at a time,
 *      and that button emitted `sectionSave` directly. The payload is `extractRecord()` —
 *      the *whole* record, the same object the Save button sends — so the identical data
 *      reached persistence through two buttons, only one of which asked the hook. A veto
 *      hook is a data-integrity mechanism; a second route around it made it advisory.
 *   2. **The veto was silent.** The embedded `ngx-dynamic-form` did run the hook on a
 *      whole-record save and did refuse it, but this component never re-emitted
 *      `saveRejected`. The abort worked and was indistinguishable from a dead button —
 *      exactly the failure `saveRejected` was added to prevent, one layer up.
 */
describe('the record editor puts every save to beforeSave', () => {
  const CONFIG: EntityFormConfig = {
    entity: 'widgets',
    version: 1,
    tabs: [
      {
        id: 'main',
        flatData: true,
        label: { en: 'Main' },
        fields: [{ id: 'title', type: 'text', label: { en: 'Title' }, visibility: true }],
      },
    ],
  };

  function mount(hook: (data: any) => unknown) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DynamicRecordFormComponent],
      providers: [
        provideNgxDynamicEntity({ hooks: { 'widgets:beforeSave': hook } }),
        provideBuiltInFieldTypes(),
      ],
    });
    const fixture = TestBed.createComponent(DynamicRecordFormComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('initialData', { title: 'original' });
    fixture.componentRef.setInput('userRoles', ['admin']);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const rejected: { reason: string }[] = [];
    const sections: { tabId: string; record: Record<string, any> }[] = [];
    component.saveRejected.subscribe(e => rejected.push(e));
    component.sectionSave.subscribe(e => sections.push(e));
    return { fixture, component, rejected, sections };
  }

  /** Put the editor into the per-tab editing state `saveSection` expects. */
  function editMainTab(component: DynamicRecordFormComponent, fixture: { detectChanges(): void }) {
    component.editSection();
    fixture.detectChanges();
  }

  it('emits sectionSave when the hook accepts', async () => {
    const { fixture, component, rejected, sections } = mount(data => data);
    editMainTab(component, fixture);

    await component.saveSection();

    expect(rejected).toEqual([]);
    expect(sections.length).toBe(1);
    expect(sections[0].record['title']).toBe('original');
  });

  it('does not emit sectionSave when the hook returns false', async () => {
    const { fixture, component, rejected, sections } = mount(() => false);
    editMainTab(component, fixture);

    await component.saveSection();

    expect(sections).toEqual([]);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toContain('beforeSave');
  });

  it('leaves the section open when the hook refuses, so the refused values are still on screen', async () => {
    const { fixture, component } = mount(() => false);
    editMainTab(component, fixture);

    await component.saveSection();

    expect(component.editingTabId()).toBe('main');
  });

  it('emits the replacement payload a hook returns', async () => {
    const { fixture, component, sections } = mount(data => ({ ...data, title: 'rewritten by the hook' }));
    editMainTab(component, fixture);

    await component.saveSection();

    expect(sections[0].record['title']).toBe('rewritten by the hook');
  });

  it('reports a hook that throws rather than letting it escape', async () => {
    const { fixture, component, rejected, sections } = mount(() => {
      throw new Error('the server said no');
    });
    editMainTab(component, fixture);

    await component.saveSection();

    expect(sections).toEqual([]);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBe('the server said no');
  });

  it('has no hook to run when none is registered, and saves normally', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DynamicRecordFormComponent],
      providers: [provideNgxDynamicEntity(), provideBuiltInFieldTypes()],
    });
    const fixture = TestBed.createComponent(DynamicRecordFormComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('initialData', { title: 'original' });
    fixture.componentRef.setInput('userRoles', ['admin']);
    fixture.detectChanges();

    const sections: unknown[] = [];
    fixture.componentInstance.sectionSave.subscribe(e => sections.push(e));
    fixture.componentInstance.editSection();
    fixture.detectChanges();

    await fixture.componentInstance.saveSection();

    expect(sections.length).toBe(1);
  });

  it('re-emits the inner form saveRejected, so a whole-record veto is not silent', () => {
    const { fixture, component, rejected } = mount(() => false);

    // The embedded form is what runs the hook for a whole-record save. What is asserted here
    // is the wiring out of this component, which is the half that was missing.
    component.dynamicFormComp!.saveRejected.emit({ reason: 'beforeSave returned false' });
    fixture.detectChanges();

    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBe('beforeSave returned false');
  });
});
