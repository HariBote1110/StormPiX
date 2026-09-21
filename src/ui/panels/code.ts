import type { createStore } from '../lib/store.ts';
import { formatFrameRange, totalChars } from '../lib/format.ts';
import type { AppState } from '../state.ts';

export function buildCodePanel(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel code-output';
  const h2 = document.createElement('h2');
  h2.textContent = '生成コード';
  panel.append(h2);

  const summary = document.createElement('div');
  summary.className = 'code-summary';
  panel.append(summary);

  const list = document.createElement('div');
  list.className = 'code-scripts';
  panel.append(list);

  store.subscribe((state) => render(summary, list, state));
  render(summary, list, store.get());

  return panel;
}

function render(summary: HTMLElement, list: HTMLElement, state: AppState): void {
  summary.textContent = '';
  list.innerHTML = '';

  const result = state.result;
  if (!result) return;

  const scripts = result.scripts;
  const ranges = result.stats.scriptFrameRanges;

  if (!result.withinBudget) {
    const notice = document.createElement('p');
    notice.className = 'code-summary-notice';
    notice.textContent =
      scripts.length > 1
        ? `文字数予算が小さすぎるため、${scripts.length} 本に分割してもどのスクリプトも予算に収まりませんでした。予算を上げるか、変換モードを「フィット」に切り替えて1本に収める（画質は落ちます）ことを検討してください。`
        : '文字数予算に収まりませんでした。予算を上げるか、変換モードを「フィット」に切り替えて画質を落として収めることを検討してください。';
    summary.append(notice);
  } else if (scripts.length > 1) {
    const info = document.createElement('p');
    info.textContent = `合計 ${totalChars(scripts).toLocaleString()} 文字を ${scripts.length} 本のスクリプトに分割しました。各スクリプトは個別のマイクロコントローラーに書き込んでください。`;
    summary.append(info);
  }

  scripts.forEach((script, index) => {
    const block = document.createElement('div');
    block.className = 'code-block';

    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';

    const title = document.createElement('span');
    title.className = 'code-block-title';
    const range = ranges?.[index];
    const rangeLabel = range ? `（フレーム ${formatFrameRange(range)}）` : '';
    title.textContent =
      scripts.length > 1 ? `スクリプト ${index + 1} / ${scripts.length}${rangeLabel}` : 'スクリプト';

    const charCountLabel = document.createElement('span');
    charCountLabel.className = 'code-char-count';
    charCountLabel.textContent = `${script.length.toLocaleString()} 文字`;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'コピー';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(script);
        copyBtn.textContent = 'コピーしました ✓';
        setTimeout(() => (copyBtn.textContent = 'コピー'), 1500);
      } catch {
        copyBtn.textContent = 'コピーに失敗しました';
        setTimeout(() => (copyBtn.textContent = 'コピー'), 1500);
      }
    });

    toolbar.append(title, charCountLabel, copyBtn);

    const pre = document.createElement('pre');
    pre.tabIndex = 0;
    pre.textContent = script;

    block.append(toolbar, pre);
    list.append(block);
  });
}
