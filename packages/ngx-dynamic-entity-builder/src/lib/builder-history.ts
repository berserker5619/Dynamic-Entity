import { computed, signal } from '@angular/core';

/**
 * Bounded undo/redo over immutable states, with keystroke coalescing.
 *
 * Entries hold **references, not clones**. The store builds a new state on every edit and
 * shares unchanged subtrees, so every entry already refers to immutable objects. Undo puts
 * the stored object back, so a `record` that follows sees the reference already sitting at
 * the cursor and skips it — no suppression flag to get out of step.
 *
 * Deliberately free of Angular DI: signals need no injection context, so `new BuilderStore()`
 * keeps working and a test can assert straight after an edit without flushing effects.
 */
export class BuilderHistory<S> {
  private readonly entries: { state: S; shape: string }[] = [];
  private readonly cursor = signal(-1);
  private readonly length = signal(0);
  private lastEditAt = 0;

  readonly canUndo = computed(() => this.cursor() > 0);
  readonly canRedo = computed(() => this.cursor() < this.length() - 1);

  /**
   * @param shapeOf  Counts that distinguish a structural edit from a value edit. Two
   *                 consecutive edits merge only when their shapes match.
   * @param same     Whether two states are the same state (reference identity, in practice).
   */
  constructor(
    private readonly shapeOf: (state: S) => string,
    private readonly same: (a: S, b: S) => boolean,
    private readonly maxEntries = 200,
    private readonly coalesceMs = 400,
  ) {}

  /**
   * Fold a state into history.
   *
   * Recording the same state twice is harmless. A label bound to a keystroke would otherwise
   * make undo walk back one character at a time, so two consecutive edits merge when they
   * land inside `coalesceMs` *and* the shape is unchanged — a rename coalesces, while adding,
   * removing or moving anything always earns its own step however fast it is clicked.
   */
  record(state: S): void {
    const at = this.cursor();
    const top = at >= 0 ? this.entries[at] : undefined;
    if (top && this.same(top.state, state)) return;

    const now = Date.now();
    const entry = { state, shape: this.shapeOf(state) };

    if (top && now - this.lastEditAt < this.coalesceMs && top.shape === entry.shape && at === this.entries.length - 1) {
      this.entries[at] = entry;
      this.lastEditAt = now;
      return;
    }

    // A new edit after an undo discards the redo branch, which is what every editor does.
    this.entries.length = at + 1;
    this.entries.push(entry);
    // Bounded: a builder session is long, and the oldest steps are the ones nobody walks back to.
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    this.cursor.set(this.entries.length - 1);
    this.length.set(this.entries.length);
    this.lastEditAt = now;
  }

  /** Start again from `state`. Nothing before it is undoable. */
  reset(state: S): void {
    this.entries.length = 0;
    this.entries.push({ state, shape: this.shapeOf(state) });
    this.cursor.set(0);
    this.length.set(1);
    this.lastEditAt = 0;
  }

  /** Step back, returning the state to restore, or `null` when there is none. */
  undo(): S | null {
    return this.canUndo() ? this.moveTo(this.cursor() - 1) : null;
  }

  /** Step forward, returning the state to restore, or `null` when there is none. */
  redo(): S | null {
    return this.canRedo() ? this.moveTo(this.cursor() + 1) : null;
  }

  private moveTo(index: number): S | null {
    const entry = this.entries[index];
    if (!entry) return null;
    this.cursor.set(index);
    return entry.state;
  }
}
