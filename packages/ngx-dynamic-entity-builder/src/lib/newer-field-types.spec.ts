import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BuilderStore } from './builder-store.service';
import { FieldInspectorComponent } from './components/field-inspector.component';
import { FieldPaletteComponent } from './components/field-palette.component';

/**
 * The builder authors every part of the six newer types that the renderer reads: the url and
 * phone format flags, a slider's step, and a place in the palette. A property the builder
 * cannot set can only be reached by editing the JSON, which is how `colSpan` spent a release.
 */
describe('the builder and the newer field types', () => {
  let store: BuilderStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FieldInspectorComponent, FieldPaletteComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();
    store = TestBed.inject(BuilderStore);
    store.setEntityName('clients');
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('format flags', () => {
    for (const flag of ['url', 'phone'] as const) {
      it(`toggles the ${flag} check on its own key, leaving any pattern alone`, () => {
        const id = store.addField(flag);
        store.setPatternValidator(id, '^x$');

        store.toggleFlagValidator(id, flag, true);
        let field = store.fields().find(f => f.id === id)!;
        expect(field.validators?.[flag]).toBe(true);
        expect(store.hasFlagValidator(field, flag)).toBe(true);
        expect(field.validators?.pattern).toBe('^x$');

        store.toggleFlagValidator(id, flag, false);
        field = store.fields().find(f => f.id === id)!;
        expect(field.validators?.[flag]).toBeUndefined();
        expect(store.hasFlagValidator(field, flag)).toBe(false);
      });
    }
  });

  describe('slider step', () => {
    let fixture: ComponentFixture<FieldInspectorComponent>;
    const stepInput = () =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="field-step"]') as HTMLInputElement | null;

    function inspect(type: 'slider' | 'number'): string {
      const id = store.addField(type);
      fixture = TestBed.createComponent(FieldInspectorComponent);
      fixture.detectChanges();
      return id;
    }

    async function typeStep(value: string): Promise<void> {
      stepInput()!.value = value;
      stepInput()!.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();
    }

    it('is offered for a slider only', () => {
      inspect('number');
      expect(stepInput()).toBeNull();
      inspect('slider');
      expect(stepInput()).not.toBeNull();
    });

    it('writes a positive step and clears anything else', async () => {
      const id = inspect('slider');
      await typeStep('0.5');
      expect(store.fields().find(f => f.id === id)!.step).toBe(0.5);

      await typeStep('0');
      expect(store.fields().find(f => f.id === id)!.step).toBeUndefined();
    });
  });

  describe('palette', () => {
    it('files each newer type in a named group, not in Other', () => {
      const fixture = TestBed.createComponent(FieldPaletteComponent);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      const groupOf = (type: string) =>
        host
          .querySelector(`[data-testid="palette-${type}"]`)!
          .closest('.deb-palette__section')!
          .querySelector('.deb-section-title')!
          .textContent!.trim();

      expect(
        Object.fromEntries(['url', 'phone', 'slider', 'color', 'rating', 'tags'].map(t => [t, groupOf(t)])),
      ).toEqual({
        url: 'Basic',
        phone: 'Basic',
        slider: 'Basic',
        color: 'Basic',
        rating: 'Choice',
        tags: 'Choice',
      });
    });
  });
});
