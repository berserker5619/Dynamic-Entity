import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig, NestedFieldConfig } from '@dynamic-entity/core';
import { DynamicRecordFormComponent } from './dynamic-record-form.component';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { UI_TEXT } from '../tokens/injection-tokens';

/**
 * The row drawer's heading — "Add Contacts row" / "Edit Contacts row".
 *
 * Two keys rather than one with a conditional verb, and the field name a parameter rather
 * than a fragment either side of it: both words and word order move between languages, and a
 * heading assembled in the template can only ever be English with a noun dropped in the
 * middle.
 *
 * The heading also has to follow the *edit* state, not just the field — the same drawer
 * serves both, and reading the wrong one tells the author they are adding a row when they
 * are about to overwrite one.
 */
describe('the array row drawer heading', () => {
  const CONTACTS: NestedFieldConfig = {
    id: 'contacts',
    type: 'array',
    label: { en: 'Contacts', de: 'Kontakte' },
    fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
  } as NestedFieldConfig;

  const CONFIG: EntityFormConfig = {
    entity: 'clients',
    version: 1,
    tabs: [{ id: 'main', label: { en: 'Main' }, fields: [CONTACTS] }],
  } as EntityFormConfig;

  function mount(language = 'en', uiText?: unknown) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DynamicRecordFormComponent, ReactiveFormsModule],
      providers: [provideBuiltInFieldTypes(), ...(uiText ? [{ provide: UI_TEXT, useValue: uiText }] : [])],
    });
    const fixture = TestBed.createComponent(DynamicRecordFormComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('initialData', { main: { contacts: [{ name: 'Ada' }] } });
    fixture.componentRef.setInput('language', language);
    fixture.detectChanges();
    // The record view renders each tab read-only until its section is opened for editing,
    // and `openAddRow` / `openEditRow` both no-op while it is. Without this the drawer never
    // opens and every assertion below passes on the default state instead.
    fixture.componentInstance.editSection();
    fixture.detectChanges();
    return fixture;
  }

  const title = (fixture: ReturnType<typeof mount>) => fixture.componentInstance.rowDrawerTitle(CONTACTS);

  it('says Add while no row is being edited', () => {
    const fixture = mount();
    fixture.componentInstance.openAddRow(CONTACTS);
    fixture.detectChanges();

    expect(title(fixture)).toBe('Add Contacts row');
  });

  it('says Edit once a row is open, and index 0 counts as a row', () => {
    // `inlineRowIndex() === null` rather than a falsy check: row 0 is a row, and a falsy
    // test would call editing the first row an add.
    const fixture = mount();
    fixture.componentInstance.openEditRow(CONTACTS, 0);
    fixture.detectChanges();

    expect(title(fixture)).toBe('Edit Contacts row');
  });

  it('goes back to Add after the drawer is cancelled and reopened', () => {
    const fixture = mount();
    fixture.componentInstance.openEditRow(CONTACTS, 0);
    fixture.componentInstance.cancelRow();
    fixture.componentInstance.openAddRow(CONTACTS);
    fixture.detectChanges();

    expect(title(fixture)).toBe('Add Contacts row');
  });

  it('names the field in the form language', () => {
    const fixture = mount('de');
    fixture.componentInstance.openAddRow(CONTACTS);
    fixture.detectChanges();

    expect(title(fixture)).toContain('Kontakte');
  });

  it('lets a translation put the field name first', () => {
    const fixture = mount('de', {
      addRowTitle: { de: '{field}: neue Zeile' },
      editRowTitle: { de: '{field}: Zeile bearbeiten' },
    });
    fixture.componentInstance.openAddRow(CONTACTS);
    fixture.detectChanges();
    expect(title(fixture)).toBe('Kontakte: neue Zeile');

    fixture.componentInstance.openEditRow(CONTACTS, 0);
    fixture.detectChanges();
    expect(title(fixture)).toBe('Kontakte: Zeile bearbeiten');
  });

  it('renders the heading into the drawer, not just from the method', () => {
    const fixture = mount('de', { addRowTitle: { de: 'NEUE ZEILE für {field}' } });
    fixture.componentInstance.openAddRow(CONTACTS);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('NEUE ZEILE für Kontakte');
  });
});
