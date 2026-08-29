import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { EntityBuilderCanvasComponent } from './entity-builder-canvas.component';
import { BuilderStore } from '../builder-store.service';

describe('EntityBuilderCanvasComponent', () => {
  let fixture: ComponentFixture<EntityBuilderCanvasComponent>;
  let store: BuilderStore;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntityBuilderCanvasComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(EntityBuilderCanvasComponent);
    store = TestBed.inject(BuilderStore);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('shows the empty hint and a zero count with no fields', () => {
    expect(host.textContent).toContain('No fields yet');
    expect(host.textContent).toContain('Fields (0)');
    expect(host.querySelectorAll('[data-testid="builder-field-row"]').length).toBe(0);
  });

  it('renders one row per field and drops the hint', () => {
    store.addField('text');
    store.addField('number');
    fixture.detectChanges();

    expect(host.textContent).toContain('Fields (2)');
    expect(host.textContent).not.toContain('No fields yet');
    expect(host.querySelectorAll('[data-testid="builder-field-row"]').length).toBe(2);
  });

  // The drop handler is the canvas's only behaviour, and reaching it through a real CDK drag
  // is not something jsdom can do — so the handler is invoked with the event it would receive.
  it('reorders the store when a drag is dropped', () => {
    const first = store.addField('text');
    const second = store.addField('number');
    fixture.detectChanges();

    const reorder = jest.spyOn(store, 'reorderField');
    (fixture.componentInstance as any).onDrop('main', {
      previousIndex: 1,
      currentIndex: 0,
    } as CdkDragDrop<unknown>);
    fixture.detectChanges();

    expect(reorder).toHaveBeenCalledWith(1, 0, 'main');
    expect(store.fields().map(f => f.id)).toEqual([second, first]);
  });

  /**
   * A config with sub-tabs is the case the canvas used to drop on the floor: the store's
   * structural operations walked the whole tree, but this view stopped at top-level tabs, so
   * a nested field could not be seen, selected or restructured.
   */
  describe('a config with sub-tabs', () => {
    beforeEach(() => {
      store.load({
        entity: 'claims',
        version: 1,
        tabs: [
          { id: 'claimant', label: { en: 'Claimant' }, fields: [{ id: 'topLevel', type: 'text', label: { en: 'Top' } }] },
          {
            id: 'incident',
            label: { en: 'Incident' },
            children: [
              {
                id: 'details',
                label: { en: 'Details' },
                fields: [
                  { id: 'nestedA', type: 'text', label: { en: 'Nested A' } },
                  { id: 'nestedB', type: 'text', label: { en: 'Nested B' } },
                ],
              },
            ],
          },
        ],
      });
      fixture.detectChanges();
    });

    it('renders a row for a field inside a sub-tab', () => {
      const ids = Array.from(host.querySelectorAll('[data-testid^="row-id-"]')).map(e => e.textContent!.trim());
      expect(ids).toEqual(['topLevel', 'nestedA', 'nestedB']);
      expect(host.textContent).toContain('Fields (3)');
    });

    it('gives each tab its own drop list, headed by the tab', () => {
      expect(host.querySelector('[data-testid="builder-field-list-claimant"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="builder-field-list-details"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="builder-group-details"]')!.textContent).toContain('Details');
    });

    // The whole point of the per-tab drop lists: an index is only meaningful inside the tab
    // that owns it. Reordering the sub-tab must not touch the top-level one.
    it('reorders within the sub-tab that was dragged', () => {
      (fixture.componentInstance as any).onDrop('details', {
        previousIndex: 0,
        currentIndex: 1,
      } as CdkDragDrop<unknown>);
      fixture.detectChanges();

      expect(store.config().tabs![1].children![0].fields!.map(f => f.id)).toEqual(['nestedB', 'nestedA']);
      expect(store.config().tabs![0].fields!.map(f => f.id)).toEqual(['topLevel']);
    });

    // A tab authored without a label still has to be identifiable, or the heading is blank
    // and two groups look the same.
    it('falls back to the tab id when the tab has no label', () => {
      store.load({
        entity: 'claims',
        version: 1,
        tabs: [
          { id: 'named', label: { en: 'Named' }, fields: [{ id: 'a', type: 'text', label: { en: 'A' } }] },
          { id: 'unlabelled', fields: [{ id: 'b', type: 'text', label: { en: 'B' } }] } as never,
        ],
      });
      fixture.detectChanges();

      expect(host.querySelector('[data-testid="builder-group-unlabelled"]')!.textContent).toContain('unlabelled');
    });

    it('hides the tab headings when every field lives in one tab', () => {
      store.load({
        entity: 'clients',
        version: 1,
        tabs: [{ id: 'only', label: { en: 'Only' }, fields: [{ id: 'a', type: 'text', label: { en: 'A' } }] }],
      });
      fixture.detectChanges();

      expect(host.querySelector('[data-testid="builder-group-only"]')).toBeNull();
    });
  });
});
