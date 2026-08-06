import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FieldInspectorComponent } from './field-inspector.component';
import { BuilderStore } from '../builder-store.service';

describe('FieldInspectorComponent', () => {
  let fixture: ComponentFixture<FieldInspectorComponent>;
  let store: BuilderStore;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FieldInspectorComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(FieldInspectorComponent);
    store = TestBed.inject(BuilderStore);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('shows the empty state when no field is selected', () => {
    expect(host.textContent).toContain('Select a field');
    expect(host.querySelector('input')).toBeNull();
  });

  it('renders the selected field id', () => {
    store.setEntityName('clients');
    const id = store.addField('text'); // auto-selected
    fixture.detectChanges();

    const idInput = host.querySelector('input') as HTMLInputElement;
    expect(idInput.value).toBe(id);
  });

  it('renames the field when the id input changes (commit on blur/change)', () => {
    store.setEntityName('clients');
    store.addField('text');
    fixture.detectChanges();

    const idInput = host.querySelector('input') as HTMLInputElement;
    idInput.value = 'firstName';
    idInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(store.fields()[0].id).toBe('firstName');
  });

  it('adds an option to an option-backed field via the Option button', () => {
    store.setEntityName('clients');
    store.addField('dropdown');
    fixture.detectChanges();

    const optionBtn = Array.from(host.querySelectorAll('button')).find(b =>
      (b.textContent || '').includes('Option'),
    ) as HTMLButtonElement;
    expect(optionBtn).toBeTruthy();

    optionBtn.click();
    fixture.detectChanges();

    expect(store.fields()[0].options?.length).toBe(1);
  });
});
