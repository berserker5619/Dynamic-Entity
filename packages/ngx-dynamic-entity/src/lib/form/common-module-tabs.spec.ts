import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { DynamicFormComponent } from './dynamic-form.component';
import { provideBuiltInFieldTypes } from '../providers/provide-field-types';
import { COMMON_MODULES_REGISTRY } from '../tokens/injection-tokens';

/**
 * A tab can be a host-supplied component rather than a set of fields.
 *
 * This is how a record grows a Documents or an Audit tab: the config names a module, the
 * application registers a real component under that name, and the renderer mounts it beside
 * the generated tabs. The two halves are deliberately separate — a config is data and cannot
 * carry a class reference — which means the lookup between them is the whole feature.
 *
 * Both of its "nothing to show" paths were covered; the path where a module actually
 * resolves and renders was not, so the feature's happy case rested on the demo.
 */
@Component({
  selector: 'test-documents',
  standalone: true,
  template: `<p data-testid="module-body">Documents for {{ recordId }}</p>`,
})
class TestDocumentsComponent {
  @Input() recordId = '(none)';
}

describe('a tab that renders a registered module', () => {
  afterEach(() => jest.restoreAllMocks());

  const config = (over: Partial<EntityFormConfig> = {}): EntityFormConfig =>
    ({
      entity: 'clients',
      version: 1,
      tabs: [
        { id: 'main', label: { en: 'Main' }, fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }] },
        { id: 'docs', label: { en: 'Docs' }, fields: [], moduleName: 'documents-view' },
      ],
      ...over,
    }) as EntityFormConfig;

  function mount(registry: unknown[], cfg: EntityFormConfig = config()) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DynamicFormComponent, ReactiveFormsModule],
      providers: [provideBuiltInFieldTypes(), { provide: COMMON_MODULES_REGISTRY, useValue: registry }],
    });
    const fixture = TestBed.createComponent(DynamicFormComponent);
    fixture.componentRef.setInput('config', cfg);
    fixture.detectChanges();
    return fixture;
  }

  const REGISTRY = [{ id: 'documents-view', label: { en: 'Documents' }, component: TestDocumentsComponent }];

  it('mounts the registered component when its tab is active', () => {
    const fixture = mount(REGISTRY);
    fixture.componentInstance.setActiveTab('docs');
    fixture.detectChanges();

    expect(fixture.componentInstance.activeTabModuleComponent).toBe(TestDocumentsComponent);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="module-body"]')).not.toBeNull();
  });

  it('shows nothing of the module while another tab is active', () => {
    const fixture = mount(REGISTRY);
    fixture.componentInstance.setActiveTab('main');
    fixture.detectChanges();

    expect(fixture.componentInstance.activeTabModuleComponent).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="module-body"]')).toBeNull();
  });

  it('matches on the entry component as well as its id', () => {
    // `moduleName` in an older config holds what the registry called `component`, so both
    // are accepted as the match key. Dropping either silently empties somebody's tab.
    const fixture = mount([{ id: 'other-id', label: { en: 'Documents' }, component: TestDocumentsComponent }], {
      ...config(),
      tabs: [{ id: 'docs', label: { en: 'Docs' }, fields: [], moduleName: 'other-id' }],
    } as EntityFormConfig);
    fixture.componentInstance.setActiveTab('docs');
    fixture.detectChanges();

    expect(fixture.componentInstance.activeTabModuleComponent).toBe(TestDocumentsComponent);
  });

  describe('an entry registered with a selector string rather than a class', () => {
    // This is what the token's own example showed, and what `COMMON_MODULES` — the
    // catalogue the builder's picker offers — is made of. `ngComponentOutlet` mounts a
    // component type, so the string reached it and Angular threw. Following the documented
    // shape broke the feature.
    const SELECTOR_REGISTRY = [{ id: 'documents-view', label: { en: 'Documents' }, component: 'app-documents-view' }];

    it('renders nothing rather than throwing', () => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fixture = mount(SELECTOR_REGISTRY);

      expect(() => {
        fixture.componentInstance.setActiveTab('docs');
        fixture.detectChanges();
      }).not.toThrow();
      expect(fixture.componentInstance.activeTabModuleComponent).toBeNull();
    });

    it('says why, naming the module and the fix', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fixture = mount(SELECTOR_REGISTRY);
      fixture.componentInstance.setActiveTab('docs');
      fixture.detectChanges();

      expect(warn).toHaveBeenCalled();
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain('documents-view');
      expect(message).toContain('component class');
    });

    it('warns once, not once per change-detection pass', () => {
      // A getter read from the template runs on every pass; an unguarded warning would fill
      // the console within a second of opening the tab.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fixture = mount(SELECTOR_REGISTRY);
      fixture.componentInstance.setActiveTab('docs');
      for (let i = 0; i < 5; i++) fixture.detectChanges();

      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it('forwards the tab moduleInputs to the mounted component', () => {
    const fixture = mount(REGISTRY, {
      ...config(),
      tabs: [
        {
          id: 'docs',
          label: { en: 'Docs' },
          fields: [],
          moduleName: 'documents-view',
          moduleInputs: { recordId: 'client-7' },
        },
      ],
    } as EntityFormConfig);
    fixture.componentInstance.setActiveTab('docs');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Documents for client-7');
  });

  it('renders nothing rather than throwing when no registry is provided at all', () => {
    const fixture = mount([]);
    fixture.componentInstance.setActiveTab('docs');
    fixture.detectChanges();

    expect(fixture.componentInstance.activeTabModuleComponent).toBeNull();
  });
});
