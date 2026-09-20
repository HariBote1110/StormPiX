/** A tiny explicit subscribe/notify store — no framework. */
export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (current: T) => T): void;
  subscribe(listener: (state: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T) => void>();

  return {
    get: () => state,
    set(next: T) {
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of listeners) listener(state);
    },
    update(fn: (current: T) => T) {
      this.set(fn(state));
    },
    subscribe(listener: (state: T) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
