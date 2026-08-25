import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BuilderStore } from '../builder-store.service';
import { ConnectionSourceConfigComponent } from './connection-source-config.component';

/**
 * Note: `connectionSource` is not part of `NestedFieldConfig` and nothing in the renderer
 * reads it — this editor writes a property no form consumes. It is exported from the
 * package's public API, so it is covered here rather than removed; the orphan status is a
 * separate decision.
 */
describe('ConnectionSourceConfigComponent', () => {
  let fixture: ComponentFixture<ConnectionSourceConfigComponent>;
  let store: BuilderStore;

  const field = () => store.fields()[0] as Record<string, any>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectionSourceConfigComponent],
      providers: [BuilderStore, provideNoopAnimations()],
    }).compileComponents();

    store = TestBed.inject(BuilderStore);
    store.setEntityName('clients');
    const id = store.addField('text');
    store.selectField(id);

    fixture = TestBed.createComponent(ConnectionSourceConfigComponent);
    fixture.detectChanges();
  });

  const component = () => fixture.componentInstance as unknown as {
    connectionSourceEntity(f: unknown): string;
    setConnectionSourceEntity(f: unknown, v: string): void;
    connectionTargetField(f: unknown): string;
    setConnectionTargetField(f: unknown, v: string): void;
  };

  it('reports empty strings before anything is configured', () => {
    expect(component().connectionSourceEntity(field())).toBe('');
    expect(component().connectionTargetField(field())).toBe('');
  });

  it('stores a trimmed source entity', () => {
    component().setConnectionSourceEntity(field(), '  organizations  ');
    expect(field()['connectionSource']).toEqual({ entity: 'organizations' });
    expect(component().connectionSourceEntity(field())).toBe('organizations');
  });

  it('stores a trimmed target field alongside the entity', () => {
    component().setConnectionSourceEntity(field(), 'organizations');
    component().setConnectionTargetField(field(), ' orgId ');

    expect(field()['connectionSource']).toEqual({ entity: 'organizations', targetField: 'orgId' });
  });

  it('drops the block entirely once both halves are cleared', () => {
    component().setConnectionSourceEntity(field(), 'organizations');
    component().setConnectionSourceEntity(field(), '');

    expect(field()['connectionSource']).toBeUndefined();
  });

  it('keeps the block while the other half still has a value', () => {
    component().setConnectionSourceEntity(field(), 'organizations');
    component().setConnectionTargetField(field(), 'orgId');
    component().setConnectionSourceEntity(field(), '');

    expect(field()['connectionSource']).toEqual({ entity: '', targetField: 'orgId' });
  });
});
