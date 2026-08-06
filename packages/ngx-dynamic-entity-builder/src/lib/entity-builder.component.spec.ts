import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { EntityBuilderComponent } from './entity-builder.component';
import { BuilderStore } from './builder-store.service';

describe('EntityBuilderComponent', () => {
  let fixture: ComponentFixture<EntityBuilderComponent>;
  let component: EntityBuilderComponent;
  let store: BuilderStore;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityBuilderComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(EntityBuilderComponent);
    component = fixture.componentInstance;
    store = fixture.debugElement.injector.get(BuilderStore);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  const paletteButtons = (): HTMLButtonElement[] =>
    Array.from(host.querySelector('ngx-field-palette')!.querySelectorAll('button'));
  const fieldRows = (): HTMLElement[] => Array.from(host.querySelectorAll('.deb-field-row'));
  const buttonByText = (text: string): HTMLButtonElement =>
    Array.from(host.querySelectorAll('button')).find(b =>
      (b.textContent || '').includes(text),
    ) as HTMLButtonElement;
  const rowButtonByIcon = (row: HTMLElement, icon: string): HTMLButtonElement =>
    Array.from(row.querySelectorAll('button')).find(
      b => b.querySelector('mat-icon')?.textContent?.trim() === icon,
    ) as HTMLButtonElement;

  it('creates and starts with no field rows', () => {
    expect(component).toBeTruthy();
    expect(fieldRows().length).toBe(0);
  });

  it('adds a field row when a palette type is clicked', () => {
    paletteButtons()[0].click(); // "Text"
    fixture.detectChanges();

    expect(fieldRows().length).toBe(1);
    expect(store.fields()[0].type).toBe('text');
    expect(fieldRows()[0].classList).toContain('deb-field-row--active');
  });

  it('removes a field when its delete button is clicked', () => {
    store.setEntityName('clients');
    store.addField('text');
    fixture.detectChanges();
    expect(fieldRows().length).toBe(1);

    rowButtonByIcon(fieldRows()[0], 'delete').click();
    fixture.detectChanges();

    expect(fieldRows().length).toBe(0);
    expect(store.fields().length).toBe(0);
  });

  it('reorders fields on drop', () => {
    const a = store.addField('text');
    const b = store.addField('number');
    expect(store.fields().map(f => f.id)).toEqual([a, b]);

    (component as unknown as { onDrop(e: unknown): void }).onDrop({
      previousIndex: 0,
      currentIndex: 1,
    });
    fixture.detectChanges();

    expect(store.fields().map(f => f.id)).toEqual([b, a]);
  });

  it('gates the Save button on validity and emits a clean config on save', () => {
    const saved: EntityFormConfig[] = [];
    component.save.subscribe(c => saved.push(c));

    expect(buttonByText('Save').disabled).toBe(true);

    store.setEntityName('clients');
    store.addField('text');
    fixture.detectChanges();

    const saveBtn = buttonByText('Save');
    expect(saveBtn.disabled).toBe(false);

    saveBtn.click();
    expect(saved.length).toBe(1);
    expect(saved[0].entity).toBe('clients');
    expect(saved[0].tabs[0].fields!.length).toBe(1);
  });

  it('emits configChange as the working config changes', () => {
    const emissions: EntityFormConfig[] = [];
    component.configChange.subscribe(c => emissions.push(c));

    store.setEntityName('clients');
    fixture.detectChanges();
    store.addField('text');
    fixture.detectChanges();

    expect(emissions.length).toBeGreaterThan(0);
    expect(emissions[emissions.length - 1].entity).toBe('clients');
  });

  it('loads an @Input config into the canvas', () => {
    const cfg: EntityFormConfig = {
      entity: 'people',
      version: 2,
      tabs: [
        {
          id: 'main',
          label: { en: 'Main' },
          fields: [
            { id: 'firstName', type: 'text', label: { en: 'First name' } },
            { id: 'age', type: 'number', label: { en: 'Age' } },
          ],
        },
      ],
    };
    component.config = cfg;
    component.ngOnChanges({
      config: new SimpleChange(undefined, cfg, true),
    });
    fixture.detectChanges();

    expect(fieldRows().length).toBe(2);
    expect(store.config().version).toBe(2);

    store.addField('text');
    expect(cfg.tabs[0].fields!.length).toBe(2);
  });
});
