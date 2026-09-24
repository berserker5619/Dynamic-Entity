import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { RuleDependencyGraphComponent } from './rule-dependency-graph.component';
import { BuilderStore } from '../builder-store.service';

describe('RuleDependencyGraphComponent', () => {
  let fixture: ComponentFixture<RuleDependencyGraphComponent>;
  let component: RuleDependencyGraphComponent;
  let store: BuilderStore;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RuleDependencyGraphComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(RuleDependencyGraphComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(BuilderStore);
    host = fixture.nativeElement as HTMLElement;

    store.load(
      {
        entity: 'patients',
        tabs: [
          {
            id: 'main',
            label: { en: 'Main' },
            fields: [
              {
                id: 'hasSymptoms',
                type: 'boolean',
                label: { en: 'Has Symptoms' },
                patchOnTrue: [{ from: 'defaultNotes', to: 'symptomsDescription' }],
              },
              {
                id: 'defaultNotes',
                type: 'text',
                label: { en: 'Default Notes' },
              },
              {
                id: 'symptomsDescription',
                type: 'textarea',
                label: { en: 'Symptoms Description' },
                showWhen: { hasSymptoms: true },
              },
              {
                id: 'dept',
                type: 'entity-ref',
                label: { en: 'Department' },
              },
              {
                id: 'doctor',
                type: 'dropdown',
                label: { en: 'Doctor' },
                entityReference: {
                  enabled: true,
                  parentField: 'dept',
                },
              },
            ],
          },
        ],
      },
      [
        {
          id: 'r1',
          formConfigId: 'patients',
          fieldId: 'hasSymptoms',
          action: { type: 'visibility', value: true },
          conditions: [{ operator: 'EQUAL', compareType: 'value', value: true }],
          targets: [{ id: 'symptomsDescription', type: 'field' }],
          enabled: true,
          priority: 1,
        },
      ],
    );
    fixture.detectChanges();
  });

  it('renders the dialog title and summary metrics', () => {
    const dialog = host.querySelector('[data-testid="rule-graph-dialog"]');
    expect(dialog).toBeTruthy();

    const title = host.querySelector('.deb-graph-title');
    expect(title?.textContent).toContain('Rule & Dependency Graph');

    const metrics = host.querySelectorAll('.deb-metric-pill');
    expect(metrics.length).toBe(4);
  });

  it('renders dependency cards for rules, showWhen, cascades, and patches', () => {
    const edgesContainer = host.querySelector('[data-testid="rule-graph-edges"]');
    expect(edgesContainer).toBeTruthy();

    const cards = host.querySelectorAll('.deb-edge-card');
    expect(cards.length).toBe(4);
  });

  it('filters dependencies by search input', () => {
    const searchInput = host.querySelector('[data-testid="filter-dependencies-input"]') as HTMLInputElement;
    expect(searchInput).toBeTruthy();

    searchInput.value = 'doctor';
    searchInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const cards = host.querySelectorAll('.deb-edge-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Doctor');
  });

  it('emits selectField and dismiss when a node chip is clicked', () => {
    const selectSpy = jest.spyOn(component.selectField, 'emit');
    const dismissSpy = jest.spyOn(component.dismiss, 'emit');

    const nodeChip = host.querySelector('.deb-node-chip--source') as HTMLButtonElement;
    expect(nodeChip).toBeTruthy();

    nodeChip.click();
    expect(selectSpy).toHaveBeenCalled();
    expect(dismissSpy).toHaveBeenCalled();
  });

  it('emits dismiss when the close button is clicked', () => {
    const dismissSpy = jest.spyOn(component.dismiss, 'emit');
    const closeBtn = host.querySelector('[data-testid="close-rule-graph"]') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();

    closeBtn.click();
    expect(dismissSpy).toHaveBeenCalled();
  });

  it('filters dependencies by type and displays empty state when nothing matches', () => {
    const filterBtns = host.querySelectorAll('.deb-filter-btn') as NodeListOf<HTMLButtonElement>;
    expect(filterBtns.length).toBe(5); // All, Rule, Show When, Cascade, Patch

    // Click Rule filter
    const ruleBtn = Array.from(filterBtns).find(b => b.textContent?.includes('Rule'));
    ruleBtn?.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.deb-edge-card').length).toBe(1);

    // Click Cascade filter
    const cascadeBtn = Array.from(filterBtns).find(b => b.textContent?.includes('Cascade'));
    cascadeBtn?.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.deb-edge-card').length).toBe(1);

    // Click ShowWhen filter
    const showWhenBtn = Array.from(filterBtns).find(b => b.textContent?.includes('Show When'));
    showWhenBtn?.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.deb-edge-card').length).toBe(1);

    // Click Patch filter
    const patchBtn = Array.from(filterBtns).find(b => b.textContent?.includes('Copy on True'));
    patchBtn?.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.deb-edge-card').length).toBe(1);

    // Switch back to All
    const allBtn = Array.from(filterBtns).find(b => b.textContent?.includes('All'));
    allBtn?.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.deb-edge-card').length).toBe(4);

    // Search for non-existent text to trigger empty state
    const searchInput = host.querySelector('[data-testid="filter-dependencies-input"]') as HTMLInputElement;
    searchInput.value = 'nonexistentxyz';
    searchInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const empty = host.querySelector('[data-testid="no-dependencies-found"]');
    expect(empty).toBeTruthy();

    // Clear search
    const clearBtn = host.querySelector('mat-form-field button') as HTMLButtonElement;
    clearBtn?.click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.deb-edge-card').length).toBe(4);
  });

  it('handles backdrop click dismissal and ignores dialog inner click', () => {
    const dismissSpy = jest.spyOn(component.dismiss, 'emit');

    // Click inner dialog: should NOT dismiss
    const dialog = host.querySelector('.deb-graph-dialog') as HTMLElement;
    dialog.click();
    expect(dismissSpy).not.toHaveBeenCalled();

    // Click backdrop: should dismiss
    const backdrop = host.querySelector('.deb-graph-backdrop') as HTMLElement;
    backdrop.click();
    expect(dismissSpy).toHaveBeenCalled();
  });

  it('handles node click with empty key safely', () => {
    const selectSpy = jest.spyOn(component.selectField, 'emit');
    (component as any).onNodeClick('');
    expect(selectSpy).not.toHaveBeenCalled();
  });
});
