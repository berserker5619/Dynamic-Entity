import { TestBed } from '@angular/core/testing';
import type { EntityFormConfig } from '@dynamic-entity/core';
import { BuilderStore } from './builder-store.service';

/**
 * Undo / redo.
 *
 * History records the `{config, rules}` pair, because undoing one without the other could
 * leave a rule pointing at a field that no longer exists.
 */
describe('BuilderStore — undo / redo', () => {
  let store: BuilderStore;

  const config = (): EntityFormConfig => ({
    entity: 'clients',
    version: 1,
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
      },
    ],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [BuilderStore] });
    store = TestBed.inject(BuilderStore);
    store.load(config());
  });

  afterEach(() => TestBed.resetTestingModule());

  const fieldIds = () => store.fields().map(f => f.id);

  it('has nothing to undo when a config is first loaded', () => {
    // Opening a config is not an edit, and undoing past it would leave the builder showing
    // something the author never had.
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('undoes and redoes a structural edit', () => {
    store.addField('text');
    expect(fieldIds()).toHaveLength(2);
    expect(store.canUndo()).toBe(true);

    store.undo();
    expect(fieldIds()).toHaveLength(1);
    expect(store.canRedo()).toBe(true);

    store.redo();
    expect(fieldIds()).toHaveLength(2);
  });

  it('restores rules alongside the config', () => {
    store.addRule({ id: 'r1', fieldId: 'name', condition: 'EQUAL', value: 'x', targets: [] } as never);
    expect(store.rules()).toHaveLength(1);

    store.undo();
    // The pair moves together; a rule surviving its field would dangle.
    expect(store.rules()).toHaveLength(0);
  });

  it('folds a burst of label keystrokes into one undo step', () => {
    const before = fieldIds()[0];
    // setFieldLabel is bound to a keystroke. Recording each one would make undo walk back a
    // character at a time.
    for (const label of ['E', 'Em', 'Emp', 'Empl']) {
      store.setFieldLabel(before, 'en', label);
    }

    store.undo();
    expect(store.fields()[0].label?.['en']).toBe('Name');
    expect(store.canUndo()).toBe(false);
  });

  it('keeps rapid structural edits as separate steps', () => {
    // Coalescing is by time *and* shape. Two clicks inside the window still change the field
    // count, so each has to earn its own step or a fast double-click would lose one.
    store.addField('text');
    store.addField('number');
    expect(fieldIds()).toHaveLength(3);

    store.undo();
    expect(fieldIds()).toHaveLength(2);

    store.undo();
    expect(fieldIds()).toHaveLength(1);
  });

  it('discards the redo branch once a new edit is made', () => {
    store.addField('text');
    store.undo();
    expect(store.canRedo()).toBe(true);

    store.addField('number');
    // Editing after an undo abandons the future, as every editor does.
    expect(store.canRedo()).toBe(false);
    expect(fieldIds()).toHaveLength(2);
  });

  it('clears a selection that the restored state has no field for', () => {
    const added = store.addField('text');
    store.selectField(added);
    expect(store.selectedField()).not.toBeNull();

    store.undo();
    // The selected field is gone; leaving the id set would point the inspector at nothing.
    expect(store.selectedField()).toBeNull();
  });

  it('does nothing at either end of the history', () => {
    expect(() => store.undo()).not.toThrow();
    expect(fieldIds()).toHaveLength(1);

    store.addField('text');
    expect(() => store.redo()).not.toThrow();
    expect(fieldIds()).toHaveLength(2);
  });

  it('starts history again when another config is loaded', () => {
    store.addField('text');
    expect(store.canUndo()).toBe(true);

    store.load(config());
    // The previous entity's edits are not this entity's history.
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('starts history again on reset', () => {
    store.addField('text');
    store.reset('fresh');
    expect(store.canUndo()).toBe(false);
  });
});
