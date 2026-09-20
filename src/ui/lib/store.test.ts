import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store.ts';

describe('createStore', () => {
  it('exposes the initial state via get()', () => {
    const store = createStore({ count: 0 });
    expect(store.get()).toEqual({ count: 0 });
  });

  it('set() replaces the state and notifies subscribers with the new value', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ count: 1 });
    expect(store.get()).toEqual({ count: 1 });
    expect(listener).toHaveBeenCalledWith({ count: 1 });
  });

  it('update() derives the next state from the previous one', () => {
    const store = createStore({ count: 0 });
    store.update((s) => ({ count: s.count + 5 }));
    expect(store.get()).toEqual({ count: 5 });
  });

  it('unsubscribe stops further notifications', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set({ count: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify when set() receives a value === current state (Object.is)', () => {
    const state = { count: 0 };
    const store = createStore(state);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(state);
    expect(listener).not.toHaveBeenCalled();
  });
});
