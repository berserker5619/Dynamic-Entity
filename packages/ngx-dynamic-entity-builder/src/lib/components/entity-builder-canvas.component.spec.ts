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
    (fixture.componentInstance as any).onDrop({
      previousIndex: 1,
      currentIndex: 0,
    } as CdkDragDrop<unknown>);
    fixture.detectChanges();

    expect(reorder).toHaveBeenCalledWith(1, 0);
    expect(store.fields().map(f => f.id)).toEqual([second, first]);
  });
});
