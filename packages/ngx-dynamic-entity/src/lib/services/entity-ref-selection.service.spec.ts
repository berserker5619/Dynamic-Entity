import { TestBed } from '@angular/core/testing';
import { EntityRefSelectionService, type EntityRefSelection } from './entity-ref-selection.service';

describe('EntityRefSelectionService', () => {
  let service: EntityRefSelectionService;
  let seen: EntityRefSelection[];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EntityRefSelectionService);
    seen = [];
  });

  afterEach(() => TestBed.resetTestingModule());

  it('publishes a selection with its record', () => {
    service.selection$.subscribe(s => seen.push(s));
    service.emit('company', { value: 'acme', label: 'Acme', record: { vat: 'DE1' } });

    expect(seen).toEqual([
      { fieldId: 'company', option: { value: 'acme', label: 'Acme', record: { vat: 'DE1' } } },
    ]);
  });

  it('publishes a cleared selection as null', () => {
    service.selection$.subscribe(s => seen.push(s));
    service.emit('company', null);

    expect(seen).toEqual([{ fieldId: 'company', option: null }]);
  });

  it('is hot — late subscribers do not replay earlier selections', () => {
    service.emit('company', null);
    service.selection$.subscribe(s => seen.push(s));

    expect(seen).toEqual([]);
  });

  it('delivers to every subscriber', () => {
    const other: EntityRefSelection[] = [];
    service.selection$.subscribe(s => seen.push(s));
    service.selection$.subscribe(s => other.push(s));

    service.emit('x', null);

    expect(seen.length).toBe(1);
    expect(other.length).toBe(1);
  });

  it('is scoped per injector, so concurrent forms do not cross-talk', () => {
    const scoped = TestBed.runInInjectionContext(() => new EntityRefSelectionService());
    scoped.selection$.subscribe(s => seen.push(s));

    service.emit('company', null); // the root instance, not the scoped one

    expect(seen).toEqual([]);
  });
});
