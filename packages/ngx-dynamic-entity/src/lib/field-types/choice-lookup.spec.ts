/**
 * Named lookup lists in the three choice components (parity plan §6.1–6.3).
 * Kept out of the per-component specs so the registry provider is set up once, and so the
 * feature's behaviour reads in one place.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { LookupListSource, NestedFieldConfig } from '@dynamic-entity/core';
import { LOOKUP_REGISTRY } from '../tokens/injection-tokens';
import { LookupRegistryService } from '../services/lookup-registry.service';
import { DropdownFieldComponent } from './dropdown-field.component';
import { MultiSelectFieldComponent } from './multi-select-field.component';
import { RadioFieldComponent } from './radio-field.component';

/** Flush pending microtasks & timers. Handles multi-hop microtask resolution cleanly. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
};

const STATUS_LIST = [
  { name: { en: 'Active', de: 'Aktiv' }, sortOrder: 1 },
  { name: { en: 'On Leave', de: 'Beurlaubt' }, sortOrder: 2 },
];

function configure(lists: Record<string, LookupListSource> = { employeeStatus: STATUS_LIST }): void {
  TestBed.configureTestingModule({
    imports: [
      DropdownFieldComponent,
      RadioFieldComponent,
      MultiSelectFieldComponent,
      ReactiveFormsModule,
    ],
    providers: [{ provide: LOOKUP_REGISTRY, useValue: new Map(Object.entries(lists)) }],
  });
}

function mount<T extends { field: NestedFieldConfig; control: any; readonly: boolean }>(
  type: new (...args: any[]) => T,
  field: Partial<NestedFieldConfig>,
  value: unknown = null,
  readonly = false,
): ComponentFixture<T> {
  const fixture = TestBed.createComponent(type);
  fixture.componentRef.setInput('control', new FormControl(value));
  fixture.componentRef.setInput('readonly', readonly);
  fixture.componentInstance.field = {
    id: 'status',
    type: 'dropdown',
    label: { en: 'Status' },
    ...field,
  } as NestedFieldConfig;
  fixture.detectChanges();
  return fixture;
}

describe('choice fields — named lookup lists', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('DropdownFieldComponent', () => {
    it('renders options resolved from the named list', async () => {
      configure();
      const fixture = mount(DropdownFieldComponent, { listName: 'employeeStatus' });

      await settle();
      fixture.detectChanges();

      const options = fixture.nativeElement.querySelectorAll('option');
      // +1 for the placeholder.
      expect(options.length).toBe(3);
      expect([...options].map((o: HTMLOptionElement) => o.textContent)).toEqual([
        'Select...',
        'Active',
        'On Leave',
      ]);
    });

    it('honours the list order, not the incoming order', async () => {
      configure({
        employeeStatus: [
          { name: { en: 'Second' }, sortOrder: 2 },
          { name: { en: 'First' }, sortOrder: 1 },
        ],
      });
      const fixture = mount(DropdownFieldComponent, { listName: 'employeeStatus' });
      await settle();
      fixture.detectChanges();

      const options = [...fixture.nativeElement.querySelectorAll('option')];
      expect(options.map((o: HTMLOptionElement) => o.textContent)).toEqual([
        'Select...',
        'First',
        'Second',
      ]);
    });

    it('inline options win over a named list, and never trigger a load', async () => {
      const loader = jest.fn().mockReturnValue(STATUS_LIST);
      configure({ employeeStatus: loader });

      const fixture = mount(DropdownFieldComponent, {
        listName: 'employeeStatus',
        options: [{ en: 'Inline' }],
      });
      await settle();
      fixture.detectChanges();

      const options = [...fixture.nativeElement.querySelectorAll('option')];
      expect(options.map((o: HTMLOptionElement) => o.textContent)).toEqual(['Select...', 'Inline']);
      expect(loader).not.toHaveBeenCalled();
    });

    it('renders a stored value on first paint when the list is already warm (§6.2)', async () => {
      configure();
      // Another field on the page loaded this list first — the common case.
      await TestBed.inject(LookupRegistryService).load('employeeStatus', 'en');

      const fixture = mount(
        DropdownFieldComponent,
        { listName: 'employeeStatus' },
        { en: 'Active', de: 'Aktiv' },
        true,
      );

      // No await: the read-only path must not need one.
      expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toBe('Active');
    });

    it('resolves a value stored under another language once the list is warm', async () => {
      configure();
      await TestBed.inject(LookupRegistryService).load('employeeStatus', 'en');

      const fixture = mount(DropdownFieldComponent, { listName: 'employeeStatus' }, 'Aktiv', true);

      expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toBe('Active');
    });

    it('falls back to the stored text on a cold list rather than an em dash', () => {
      configure();
      const fixture = mount(
        DropdownFieldComponent,
        { listName: 'employeeStatus' },
        { en: 'Active' },
        true,
      );

      expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toBe('Active');
    });

    it('renders an empty list when no LOOKUP_REGISTRY is provided', async () => {
      TestBed.configureTestingModule({ imports: [DropdownFieldComponent, ReactiveFormsModule] });
      const fixture = mount(DropdownFieldComponent, { listName: 'employeeStatus' });
      await settle();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelectorAll('option').length).toBe(1);
    });

    it('drops a late load when the field changed while it was in flight', async () => {
      let release: (values: unknown[]) => void = () => undefined;
      configure({
        employeeStatus: () => new Promise<any[]>(resolve => (release = resolve)),
      });

      const fixture = mount(DropdownFieldComponent, { listName: 'employeeStatus' });
      fixture.componentInstance.field = {
        id: 'status',
        type: 'dropdown',
        label: { en: 'Status' },
        options: [{ en: 'Inline' }],
      } as NestedFieldConfig;

      release(STATUS_LIST);
      await settle();
      fixture.detectChanges();

      const options = [...fixture.nativeElement.querySelectorAll('option')];
      expect(options.map((o: HTMLOptionElement) => o.textContent)).toEqual(['Select...', 'Inline']);
    });
  });

  describe('RadioFieldComponent', () => {
    it('renders radios resolved from the named list', async () => {
      configure();
      const fixture = mount(RadioFieldComponent, { type: 'radio', listName: 'employeeStatus' });

      await settle();
      fixture.detectChanges();

      const labels = [...fixture.nativeElement.querySelectorAll('.ngx-field__radio-label')];
      expect(labels.map((l: HTMLElement) => l.textContent)).toEqual(['Active', 'On Leave']);
    });

    it('resolves the selected label synchronously from a warm list', async () => {
      configure();
      await TestBed.inject(LookupRegistryService).load('employeeStatus', 'en');

      const fixture = mount(
        RadioFieldComponent,
        { type: 'radio', listName: 'employeeStatus' },
        'Aktiv',
        true,
      );

      expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toBe('Active');
    });
  });

  describe('MultiSelectFieldComponent', () => {
    it('renders options resolved from the named list', async () => {
      configure();
      const fixture = mount(MultiSelectFieldComponent, {
        type: 'multiSelect',
        listName: 'employeeStatus',
      });

      await settle();
      fixture.detectChanges();

      const options = [...fixture.nativeElement.querySelectorAll('option')];
      expect(options.map((o: HTMLOptionElement) => o.textContent)).toEqual(['Active', 'On Leave']);
    });

    it('joins read-only labels from a warm list', async () => {
      configure();
      await TestBed.inject(LookupRegistryService).load('employeeStatus', 'en');

      const fixture = mount(
        MultiSelectFieldComponent,
        { type: 'multiSelect', listName: 'employeeStatus' },
        ['Aktiv', { en: 'On Leave' }],
        true,
      );

      expect(fixture.nativeElement.querySelector('.ngx-field__value').textContent).toBe(
        'Active, On Leave',
      );
    });
  });

  it('loads one list once for many fields sharing it', async () => {
    const loader = jest.fn().mockResolvedValue(STATUS_LIST);
    configure({ employeeStatus: loader });

    // Mounted for their side effect: both resolve the same named list.
    mount(DropdownFieldComponent, { listName: 'employeeStatus' });
    mount(RadioFieldComponent, { type: 'radio', listName: 'employeeStatus' });
    await settle();

    expect(loader).toHaveBeenCalledTimes(1);
  });
});
