import { applyEdit } from "./model/edits.ts";
import type { Edit, EditResult } from "./model/edits.ts";
import { initialMotion, reconcile, remapMotion } from "./model/motion.ts";
import { initialSimState, step } from "./model/simulation.ts";
import type { SimState, StepEvents } from "./model/simulation.ts";
import type { Motion, Yard } from "./model/types.ts";

export interface Change {
  readonly yard: Yard;
  readonly previous: Yard;
  /** Absent for undo. */
  readonly edit?: Edit;
}

export interface Store {
  readonly yard: Yard;
  readonly motion: Motion;
  readonly canUndo: boolean;

  /** Applies the edit. On success the result becomes current and, unless the edit is `rename`, the previous yard is pushed for undo. */
  dispatch(edit: Edit): EditResult;

  /** Restores the previous yard, remaps the current positions to it if needed, then reconciles. */
  undo(): void;

  /** Advances the trains. Changes only `motion`; no undo entry, no notification. */
  tick(seconds: number, speed: number): StepEvents;

  /** Called after each dispatch or undo that changes the yard. */
  subscribe(listener: (change: Change) => void): () => void;
}

interface UndoEntry {
  readonly yard: Yard;
  /** Maps indices on the board after the edit to the restored one; set when the edit was a resize. */
  readonly remap?: (index: number) => number;
  readonly edit: Edit;
}

/**
 * Holds the yard, where the trains are, and an in-memory undo stack of earlier yards.
 * Undo reverses exactly one edit and never rewinds train movement.
 */
export function createStore(initial: Yard, { undoLimit = 100 } = {}): Store {
  let yard = initial;
  let motion = initialMotion(initial);
  let sim: SimState = initialSimState();
  const undoStack: UndoEntry[] = [];
  const listeners = new Set<(change: Change) => void>();
  const notify = (change: Change) => {
    for (const listener of listeners) listener(change);
  };

  return {
    get yard() {
      return yard;
    },
    get motion() {
      return motion;
    },
    get canUndo() {
      return undoStack.length > 0;
    },

    dispatch(edit) {
      const result = applyEdit(yard, motion, edit);
      if (!result.ok) return result;
      const previous = yard;
      if (edit.type !== "rename") {
        undoStack.push({ yard: previous, edit, ...(result.remap && { remap: result.remap }) });
        if (undoStack.length > undoLimit) undoStack.splice(0, undoStack.length - undoLimit);
      }
      yard = result.yard;
      motion = result.motion;
      if (edit.type === "replace") sim = initialSimState();
      notify({ yard, previous, edit });
      return result;
    },

    undo() {
      const entry = undoStack.pop();
      if (!entry) return;
      const previous = yard;
      // Renaming isn't undoable, so undoing anything but a load keeps the current name.
      yard =
        entry.edit.type === "replace" || entry.yard.name === yard.name
          ? entry.yard
          : { ...entry.yard, name: yard.name };
      motion = reconcile(yard, entry.remap ? remapMotion(motion, entry.remap) : motion);
      notify({ yard, previous });
    },

    tick(seconds, speed) {
      const result = step(yard, motion, sim, seconds, speed);
      motion = result.motion;
      sim = result.sim;
      return result.events;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
