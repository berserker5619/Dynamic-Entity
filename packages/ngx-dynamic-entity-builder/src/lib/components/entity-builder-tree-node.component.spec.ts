import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { NestedFieldConfig } from '@dynamic-entity/core';
import { EntityBuilderTreeNodeComponent } from './entity-builder-tree-node.component';
import { BuilderStore } from '../builder-store.service';

describe('EntityBuilderTreeNodeComponent', () => {
  let fixture: ComponentFixture<EntityBuilderTreeNodeComponent>;
  let store: BuilderStore;
  let host: HTMLElement;

  const field = (over: Partial<NestedFieldConfig> = {}): NestedFieldConfig =>
    ({ id: 'email', type: 'email', label: { en: 'Email', de: 'E-Mail' }, ...over }) as NestedFieldConfig;

  const render = (f: NestedFieldConfig, index = 0, totalCount = 2): void => {
    fixture.componentRef.setInput('field', f);
    fixture.componentRef.setInput('index', index);
    fixture.componentRef.setInput('totalCount', totalCount);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityBuilderTreeNodeComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(EntityBuilderTreeNodeComponent);
    store = TestBed.inject(BuilderStore);
    host = fixture.nativeElement as HTMLElement;
  });

  it('shows the catalog label and icon for a known type', () => {
    render(field());
    expect(host.querySelector('[data-testid="row-id-email"]')!.textContent).toContain('email');
    expect(host.querySelector('.deb-field-type')!.textContent!.trim()).toBe('email');
  });

  // The `?? type` and `?? 'help_outline'` fallbacks: a config can name a type registered by
  // the consumer, which the built-in catalog knows nothing about.
  it('falls back to the raw type and a generic icon for a type outside the catalog', () => {
    render(field({ id: 'sig', type: 'signature' as NestedFieldConfig['type'] }));

    expect(host.querySelector('.deb-field-type')!.textContent).toContain('help_outline');
    expect(host.querySelector('.deb-type-badge')!.textContent).toContain('signature');
  });

  it('resolves the label in the active language, and falls back to the id', () => {
    render(field());
    expect(host.querySelector('[data-testid="row-label-email"]')!.textContent).toContain('Email');

    store.setActiveLanguage('de');
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="row-label-email"]')!.textContent).toContain('E-Mail');

    render(field({ id: 'nolabel', label: undefined }));
    expect(host.querySelector('[data-testid="row-label-nolabel"]')!.textContent).toContain('nolabel');
  });

  it('disables Move up on the first row and Move down on the last', () => {
    render(field(), 0, 2);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="row-up-email"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="row-down-email"]')!.disabled).toBe(false);

    render(field(), 1, 2);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="row-up-email"]')!.disabled).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="row-down-email"]')!.disabled).toBe(true);
  });

  it('marks the row pressed when it is the selected field', () => {
    render(field());
    const row = host.querySelector('[data-testid="builder-field-row"]')!;
    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(row.getAttribute('aria-label')).toBe('Select field Email');

    store.selectField('email');
    fixture.detectChanges();
    expect(row.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the required marker, the reference link, and the drift warning', () => {
    render(field({ validators: { required: true }, isReferenced: true, hasDrift: true }));

    expect(host.querySelector('.deb-req')).not.toBeNull();
    expect(host.querySelector('[data-testid="drift-warning-icon"]')).not.toBeNull();
    expect(host.textContent).toContain('link');
  });

  it('renders a nested row for each child', () => {
    render(field({ id: 'address', type: 'group', children: [field({ id: 'city' }), field({ id: 'zip' })] }));

    const ids = Array.from(host.querySelectorAll('[data-testid^="row-id-"]')).map(e => e.textContent!.trim());
    expect(ids).toEqual(expect.arrayContaining(['address', 'city', 'zip']));
  });
});
