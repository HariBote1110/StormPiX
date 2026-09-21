import type { ConvertResult, Rgb } from '../../core/index.ts';
import type { createStore } from '../lib/store.ts';
import { paintBitmap } from '../lib/bitmap.ts';
import { diffHeatmap } from '../lib/diff.ts';
import { scriptUsages } from '../lib/format.ts';
import { previewCell } from '../dom.ts';
import type { AppState } from '../state.ts';

export function buildResultPanel(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h2 = document.createElement('h2');
  h2.textContent = '結果';
  panel.append(h2);

  const body = document.createElement('div');
  panel.append(body);

  store.subscribe((state) => renderResultBody(body, store, state));
  renderResultBody(body, store, store.get());

  return panel;
}

function renderResultBody(body: HTMLElement, store: ReturnType<typeof createStore<AppState>>, state: AppState): void {
  body.innerHTML = '';

  if (state.frames.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '画像を読み込むとここにプレビューが表示されます。';
    body.append(empty);
    return;
  }

  if (state.error) {
    const notice = document.createElement('div');
    notice.className = 'notice error';
    notice.textContent = state.error.notImplemented
      ? '変換コアは準備中です。しばらくしてから再度お試しください。'
      : `変換エラー: ${state.error.message}`;
    body.append(notice);
  }

  const activeFrame = state.frames[0]!;

  const toolbar = document.createElement('div');
  toolbar.className = 'result-toolbar';
  const diffToggle = document.createElement('button');
  diffToggle.className = 'btn';
  diffToggle.type = 'button';
  diffToggle.textContent = state.showDiff ? '差分表示: ON' : '差分表示: OFF';
  diffToggle.setAttribute('aria-pressed', String(state.showDiff));
  diffToggle.addEventListener('click', () => store.update((s) => ({ ...s, showDiff: !s.showDiff })));
  toolbar.append(diffToggle);
  body.append(toolbar);

  const grid = document.createElement('div');
  grid.className = 'preview-grid';

  const sourceCell = previewCell('元画像');
  paintBitmap(sourceCell.canvas, activeFrame.bitmap);
  grid.append(sourceCell.wrap);

  const resultCell = previewCell(state.showDiff ? '差分ヒートマップ' : '変換結果');
  if (state.result) {
    const bmp = state.showDiff ? diffHeatmap(activeFrame.bitmap, state.result.rendered) : state.result.rendered;
    paintBitmap(resultCell.canvas, bmp);
  } else {
    resultCell.wrap.querySelector('.preview-canvas-wrap')?.remove();
    const msg = document.createElement('div');
    msg.className = 'empty-state';
    msg.textContent = state.busy ? '変換中…' : '結果はまだありません。';
    resultCell.wrap.append(msg);
  }
  grid.append(resultCell.wrap);

  body.append(grid);

  if (state.result) {
    body.append(buildBudgetGauge(state.result, state.options.budget));
    body.append(buildStats(state.result));
    body.append(buildPalette(state.result.palette));
  }
}

/** Honest budget gauge: a bar per script (each must individually fit), plus the total. */
export function buildBudgetGauge(result: ConvertResult, budget: number): HTMLElement {
  const gauge = document.createElement('div');
  gauge.className = `budget-gauge${result.withinBudget ? '' : ' over'}`;

  const usages = scriptUsages(result.scripts, budget);
  for (const usage of usages) {
    const row = document.createElement('div');
    row.className = 'budget-gauge-row';

    const track = document.createElement('div');
    track.className = 'bar-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(budget));
    track.setAttribute('aria-valuenow', String(usage.charCount));
    const fill = document.createElement('div');
    fill.className = `bar-fill${usage.over ? ' over' : ''}`;
    fill.style.width = `${usage.pct}%`;
    track.append(fill);

    const labelRow = document.createElement('div');
    labelRow.className = 'bar-label';
    const scriptLabel = usages.length > 1 ? `スクリプト${usage.index + 1}: ` : '';
    labelRow.innerHTML = `<span>${scriptLabel}${usage.charCount.toLocaleString()} / ${budget.toLocaleString()} 文字</span><span>${usage.pct.toFixed(1)}%</span>`;

    row.append(track, labelRow);
    gauge.append(row);
  }

  if (usages.length > 1) {
    const total = document.createElement('div');
    total.className = 'bar-total';
    total.textContent = `合計: ${result.totalCharCount.toLocaleString()} 文字（${usages.length} 本のスクリプト、それぞれ別のマイクロコントローラーに書き込みます）`;
    gauge.append(total);
  }

  return gauge;
}

function buildStats(result: ConvertResult): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'stats-grid';
  const tiles: { label: string; value: string }[] = [
    { label: '戦略', value: result.strategy },
    { label: 'SSIM', value: result.metrics.ssim.toFixed(4) },
    { label: 'PSNR', value: Number.isFinite(result.metrics.psnr) ? `${result.metrics.psnr.toFixed(2)} dB` : '∞ dB' },
    { label: '命令数', value: String(result.stats.ops) },
    { label: '矩形数', value: String(result.stats.rects) },
    { label: 'setColour呼出', value: String(result.stats.setColourCalls) },
    { label: '所要時間', value: `${result.stats.elapsedMs.toFixed(0)} ms` },
    { label: 'スクリプト数', value: String(result.scripts.length) },
  ];
  for (const tile of tiles) {
    const el = document.createElement('div');
    el.className = 'stat-tile';
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = tile.value;
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = tile.label;
    el.append(value, label);
    grid.append(el);
  }
  return grid;
}

function buildPalette(palette: readonly Rgb[]): HTMLElement {
  const wrap = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.textContent = `パレット (${palette.length}色)`;
  h3.style.fontSize = '12px';
  h3.style.fontWeight = 'normal';
  h3.style.color = 'var(--colour-text-dim)';
  const swatches = document.createElement('div');
  swatches.className = 'palette-swatches';
  for (const [r, g, b] of palette) {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = `rgb(${r},${g},${b})`;
    sw.title = `rgb(${r}, ${g}, ${b})`;
    swatches.append(sw);
  }
  wrap.append(h3, swatches);
  return wrap;
}
