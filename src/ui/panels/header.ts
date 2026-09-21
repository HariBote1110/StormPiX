import type { createStore } from '../lib/store.ts';
import type { AppState, Theme } from '../state.ts';

export function buildHeader(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
  const header = document.createElement('header');
  header.className = 'app-header';

  const titleWrap = document.createElement('div');
  const h1 = document.createElement('h1');
  h1.textContent = 'StormPiX';
  const subtitle = document.createElement('span');
  subtitle.className = 'subtitle';
  subtitle.textContent = '画像 → Stormworks Lua 変換';
  titleWrap.append(h1, subtitle);

  const themeToggle = document.createElement('div');
  themeToggle.className = 'theme-toggle';
  const options: { value: Theme; label: string }[] = [
    { value: 'system', label: '自動' },
    { value: 'light', label: 'ライト' },
    { value: 'dark', label: 'ダーク' },
  ];
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = opt.label;
    btn.setAttribute('aria-pressed', String(store.get().theme === opt.value));
    btn.addEventListener('click', () => store.update((s) => ({ ...s, theme: opt.value })));
    store.subscribe((s) => btn.setAttribute('aria-pressed', String(s.theme === opt.value)));
    themeToggle.append(btn);
  }

  header.append(titleWrap, themeToggle);
  return header;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
