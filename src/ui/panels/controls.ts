import type { createStore } from '../lib/store.ts';
import type { ConvertMode } from '../../core/index.ts';
import { normaliseOptions } from '../lib/options.ts';
import { numberField } from '../dom.ts';
import type { ConvertWorkerClient } from '../workerClient.ts';
import type { AppState } from '../state.ts';

export function buildControlsPanel(
  store: ReturnType<typeof createStore<AppState>>,
  worker: ConvertWorkerClient,
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h2 = document.createElement('h2');
  h2.textContent = '変換設定';
  panel.append(h2);

  panel.append(buildModeField(store));

  const budgetField = numberField('文字数予算', 1, 8192, 1, store.get().options.budget, (v) =>
    store.update((s) => ({ ...s, options: normaliseOptions({ ...s.options, budget: v }) })),
  );
  const coloursField = numberField('最大パレット色数', 1, 256, 1, store.get().options.maxColours, (v) =>
    store.update((s) => ({ ...s, options: normaliseOptions({ ...s.options, maxColours: v }) })),
  );
  const timeField = numberField('探索打ち切り時間 (ms)', 100, 60000, 100, store.get().options.timeBudgetMs, (v) =>
    store.update((s) => ({ ...s, options: normaliseOptions({ ...s.options, timeBudgetMs: v }) })),
  );

  const ditherField = document.createElement('div');
  ditherField.className = 'field checkbox-field';
  const ditherCheckbox = document.createElement('input');
  ditherCheckbox.type = 'checkbox';
  ditherCheckbox.id = 'dither';
  ditherCheckbox.checked = store.get().options.dither === 'floyd-steinberg';
  ditherCheckbox.addEventListener('change', () => {
    store.update((s) => ({
      ...s,
      options: normaliseOptions({ ...s.options, dither: ditherCheckbox.checked ? 'floyd-steinberg' : 'none' }),
    }));
  });
  const ditherLabel = document.createElement('label');
  ditherLabel.htmlFor = 'dither';
  ditherLabel.textContent = 'ディザリング (Floyd–Steinberg)';
  ditherField.append(ditherCheckbox, ditherLabel);

  const strategyField = document.createElement('div');
  strategyField.className = 'field';
  const strategyLabel = document.createElement('label');
  strategyLabel.htmlFor = 'strategy';
  strategyLabel.textContent = '出力戦略';
  const strategySelect = document.createElement('select');
  strategySelect.id = 'strategy';
  const strategies: { value: string; label: string }[] = [
    { value: 'auto', label: '自動' },
    { value: 'direct', label: '直接命令 (direct)' },
    { value: 'table', label: 'テーブル (table)' },
    { value: 'packed', label: 'パック (packed)' },
  ];
  for (const opt of strategies) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    strategySelect.append(el);
  }
  strategySelect.value = store.get().options.strategy;
  strategySelect.addEventListener('change', () => {
    store.update((s) => ({
      ...s,
      options: normaliseOptions({ ...s.options, strategy: strategySelect.value as typeof s.options.strategy }),
    }));
  });
  strategyField.append(strategyLabel, strategySelect);

  const ticksField = numberField('コマ間隔 (ticks/frame, 60tick=1秒)', 1, 600, 1, store.get().ticksPerFrame, (v) =>
    store.update((s) => ({ ...s, ticksPerFrame: v })),
  );

  const rerunBtn = document.createElement('button');
  rerunBtn.className = 'btn btn-primary';
  rerunBtn.type = 'button';
  rerunBtn.textContent = '再変換';
  rerunBtn.addEventListener('click', () => {
    store.update((s) => ({ ...s, runNonce: s.runNonce + 1 }));
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.disabled = true;
  cancelBtn.addEventListener('click', () => {
    worker.cancel();
    store.update((s) => ({ ...s, busy: false }));
  });
  store.subscribe((s) => {
    cancelBtn.disabled = !s.busy;
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'field-row';
  btnRow.append(rerunBtn, cancelBtn);

  const busyIndicator = document.createElement('div');
  busyIndicator.className = 'busy-indicator';
  busyIndicator.hidden = true;
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  const busyText = document.createElement('span');
  busyText.textContent = '変換中…';
  busyIndicator.append(spinner, busyText);
  store.subscribe((s) => {
    busyIndicator.hidden = !s.busy;
  });

  panel.append(budgetField, coloursField, ditherField, strategyField, timeField, ticksField, btnRow, busyIndicator);
  return panel;
}

function buildModeField(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = 'convert-mode';
  label.textContent = '変換モード';
  const select = document.createElement('select');
  select.id = 'convert-mode';
  const modes: { value: ConvertMode; label: string }[] = [
    { value: 'lossless', label: 'ロスレス（画質優先・複数スクリプトに分割することがある）' },
    { value: 'fit', label: 'フィット（1スクリプトに収める・画質を落とすことがある）' },
  ];
  for (const opt of modes) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    select.append(el);
  }
  select.value = store.get().options.mode;
  select.addEventListener('change', () => {
    store.update((s) => ({ ...s, options: normaliseOptions({ ...s.options, mode: select.value as ConvertMode }) }));
  });

  const hint = document.createElement('p');
  hint.className = 'field-hint';
  store.subscribe((s) => {
    hint.textContent =
      s.options.mode === 'lossless'
        ? '画像を完全に再現します。予算に収まらない場合は複数のスクリプトに分けて出力し、各スクリプトを別のマイクロコントローラーに書き込みます。'
        : '常に1本のスクリプトに収めます。予算が足りない場合は色数や細部を削って画質を落とします。';
  });
  hint.textContent =
    store.get().options.mode === 'lossless'
      ? '画像を完全に再現します。予算に収まらない場合は複数のスクリプトに分けて出力し、各スクリプトを別のマイクロコントローラーに書き込みます。'
      : '常に1本のスクリプトに収めます。予算が足りない場合は色数や細部を削って画質を落とします。';

  field.append(label, select, hint);
  return field;
}
