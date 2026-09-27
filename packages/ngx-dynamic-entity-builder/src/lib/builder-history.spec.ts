import { BuilderHistory } from './builder-history';

interface State {
  items: string[];
}

const make = (max = 200) =>
  new BuilderHistory<State>(
    s => String(s.items.length),
    (a, b) => a === b,
    max,
  );

describe('BuilderHistory', () => {
  let now = 0;
  beforeEach(() => {
    now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('undoes and redoes structural edits one step at a time', () => {
    const h = make();
    const a = { items: [] };
    const b = { items: ['x'] };
    const c = { items: ['x', 'y'] };
    h.reset(a);
    h.record(b);
    h.record(c);

    expect(h.undo()).toBe(b);
    expect(h.undo()).toBe(a);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe(b);
  });

  it('coalesces quick same-shape edits, but not slow ones', () => {
    const h = make();
    h.reset({ items: ['a'] });
    h.record({ items: ['ab'] });
    now += 100;
    const quick = { items: ['abc'] };
    h.record(quick);
    now += 1_000;
    h.record({ items: ['abcd'] });

    expect(h.undo()).toBe(quick);
    expect(h.canUndo()).toBe(true);
    h.undo();
    expect(h.canUndo()).toBe(false);
  });

  it('ignores recording the state already at the cursor', () => {
    const h = make();
    const a = { items: [] };
    h.reset(a);
    h.record(a);
    expect(h.canUndo()).toBe(false);
  });

  it('drops the redo branch on a new edit', () => {
    const h = make();
    h.reset({ items: [] });
    h.record({ items: ['x'] });
    h.undo();
    h.record({ items: ['y', 'z'] });
    expect(h.canRedo()).toBe(false);
  });

  it('keeps only the most recent entries', () => {
    const h = make(3);
    h.reset({ items: [] });
    for (let i = 1; i <= 5; i++) h.record({ items: Array(i).fill('x') });
    h.undo();
    h.undo();
    expect(h.canUndo()).toBe(false);
  });
});
