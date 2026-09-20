import type { Rgb } from '../core/index.ts';
import { createStore } from './lib/store.ts';
import { debounce } from './lib/debounce.ts';
import { fileToBitmap, paintBitmap } from './lib/bitmap.ts';
import { diffHeatmap } from './lib/diff.ts';
import { MONITOR_PRESETS, resolutionOf } from './lib/monitors.ts';
import type { FitMode } from './lib/fit.ts';
import { normaliseOptions, toConvertOptions } from './lib/options.ts';
import { ConvertWorkerClient } from './workerClient.ts';
import { initialState, type AppState, type FrameEntry, type Theme } from './state.ts';

let nextFrameId = 1;

export function mountApp(root: HTMLElement): void {
  const store = createStore<AppState>(initialState());
  const worker = new ConvertWorkerClient();

  root.innerHTML = '';
  const header = buildHeader(store);
  const body = document.createElement('div');
  body.className = 'app-body';

  const left = document.createElement('div');
  left.className = 'controls-column';

  const right = document.createElement('div');
  right.className = 'results-column';

  body.append(left, right);
  root.append(header, body);

  renderLeft(left, store, worker);
  renderRight(right, store);

  applyTheme(store.get().theme);
  store.subscribe((state) => applyTheme(state.theme));

  const scheduleConvert = debounce(() => void runConvert(store, worker), 500);

  // Kick off conversion whenever frames/options/monitor/fit/runNonce change.
  let lastTrigger = '';
  store.subscribe((state) => {
    const key = JSON.stringify({
      frames: state.frames.map((f) => f.id),
      monitorPresetId: state.monitorPresetId,
      fitMode: state.fitMode,
      options: state.options,
      ticksPerFrame: state.ticksPerFrame,
      runNonce: state.runNonce,
    });
    if (key !== lastTrigger) {
      lastTrigger = key;
      if (state.frames.length > 0) scheduleConvert();
    }
  });

  (root as unknown as { __store?: typeof store }).__store = store; // for debugging / tests via console
}

async function runConvert(store: ReturnType<typeof createStore<AppState>>, worker: ConvertWorkerClient): Promise<void> {
  const state = store.get();
  if (state.frames.length === 0) return;
  store.update((s) => ({ ...s, busy: true, error: undefined }));

  const options = toConvertOptions(state.options);
  const outcome = await worker.run(
    state.frames.map((f) => f.bitmap),
    { ...options, ticksPerFrame: state.ticksPerFrame },
  );

  const current = store.get();
  if (current.frames !== state.frames) return; // superseded by newer input while we awaited

  if (outcome.ok && outcome.result) {
    store.update((s) => ({ ...s, busy: false, result: outcome.result, error: undefined }));
  } else {
    store.update((s) => ({
      ...s,
      busy: false,
      result: undefined,
      error: { message: outcome.message ?? '不明なエラーです', notImplemented: outcome.notImplemented ?? false },
    }));
  }
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

function buildHeader(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
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

function renderLeft(
  container: HTMLElement,
  store: ReturnType<typeof createStore<AppState>>,
  worker: ConvertWorkerClient,
): void {
  container.append(buildInputPanel(store), buildMonitorPanel(store), buildControlsPanel(store, worker));
}

function renderRight(container: HTMLElement, store: ReturnType<typeof createStore<AppState>>): void {
  container.append(buildResultPanel(store), buildCodePanel(store));
}

// ---------- Input panel ----------

function buildInputPanel(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h2 = document.createElement('h2');
  h2.textContent = '画像入力';
  panel.append(h2);

  const dropzone = document.createElement('div');
  dropzone.className = 'dropzone';
  dropzone.tabIndex = 0;
  dropzone.setAttribute('role', 'button');
  dropzone.setAttribute('aria-label', '画像をドラッグ＆ドロップ、またはクリックして選択');

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.id = 'file-input';

  const label = document.createElement('label');
  label.htmlFor = 'file-input';
  label.textContent = 'ここに画像をドロップ / クリックして選択 / 貼り付け (Ctrl+V)';

  dropzone.append(fileInput, label);
  panel.append(dropzone);

  const frameStrip = document.createElement('div');
  frameStrip.className = 'frame-strip';
  panel.append(frameStrip);

  const addFiles = async (files: FileList | File[]) => {
    const state = store.get();
    const preset = MONITOR_PRESETS.find((p) => p.id === state.monitorPresetId) ?? MONITOR_PRESETS[0]!;
    const { width, height } = resolutionOf(preset);
    const entries: FrameEntry[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const { bitmap } = await fileToBitmap(file, width, height, store.get().fitMode);
        entries.push({ id: nextFrameId++, name: file.name || `frame-${nextFrameId}`, bitmap });
      } catch (e) {
        console.error('画像の読み込みに失敗しました', e);
      }
    }
    if (entries.length > 0) {
      store.update((s) => ({ ...s, frames: [...s.frames, ...entries] }));
    }
  };

  fileInput.addEventListener('change', () => {
    if (fileInput.files) void addFiles(fileInput.files);
    fileInput.value = '';
  });

  dropzone.addEventListener('click', (e) => {
    if (e.target === fileInput) return;
    fileInput.click();
  });
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    store.update((s) => ({ ...s, dragActive: true }));
  });
  dropzone.addEventListener('dragleave', () => {
    store.update((s) => ({ ...s, dragActive: false }));
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    store.update((s) => ({ ...s, dragActive: false }));
    if (e.dataTransfer?.files) void addFiles(e.dataTransfer.files);
  });

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.files;
    if (items && items.length > 0) void addFiles(items);
  });

  store.subscribe((state) => {
    dropzone.classList.toggle('dragover', state.dragActive);
  });

  store.subscribe((state) => {
    renderFrameStrip(frameStrip, store, state);
  });

  return panel;
}

function renderFrameStrip(strip: HTMLElement, store: ReturnType<typeof createStore<AppState>>, state: AppState): void {
  strip.innerHTML = '';
  if (state.frames.length === 0) return;
  state.frames.forEach((frame, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'frame-thumb';
    thumb.draggable = true;
    thumb.title = frame.name;
    const canvas = document.createElement('canvas');
    paintBitmap(canvas, frame.bitmap);
    thumb.append(canvas);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `${frame.name} を削除`);
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.update((s) => ({ ...s, frames: s.frames.filter((f) => f.id !== frame.id) }));
    });
    thumb.append(removeBtn);

    thumb.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', String(index));
    });
    thumb.addEventListener('dragover', (e) => e.preventDefault());
    thumb.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer?.getData('text/plain'));
      if (Number.isNaN(from) || from === index) return;
      store.update((s) => {
        const frames = [...s.frames];
        const [moved] = frames.splice(from, 1);
        if (moved) frames.splice(index, 0, moved);
        return { ...s, frames };
      });
    });

    strip.append(thumb);
  });
}

// ---------- Monitor panel ----------

function buildMonitorPanel(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h2 = document.createElement('h2');
  h2.textContent = 'モニター設定';
  panel.append(h2);

  const presetField = document.createElement('div');
  presetField.className = 'field';
  const presetLabel = document.createElement('label');
  presetLabel.htmlFor = 'monitor-preset';
  presetLabel.textContent = 'モニターサイズ';
  const presetSelect = document.createElement('select');
  presetSelect.id = 'monitor-preset';
  for (const preset of MONITOR_PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    const { width, height } = resolutionOf(preset);
    opt.textContent = `${preset.label} (${width}x${height}px)`;
    presetSelect.append(opt);
  }
  presetSelect.value = store.get().monitorPresetId;
  presetSelect.addEventListener('change', () => {
    store.update((s) => ({ ...s, monitorPresetId: presetSelect.value }));
  });
  presetField.append(presetLabel, presetSelect);

  const resolutionNote = document.createElement('div');
  resolutionNote.className = 'field-row';
  store.subscribe((state) => {
    const preset = MONITOR_PRESETS.find((p) => p.id === state.monitorPresetId) ?? MONITOR_PRESETS[0]!;
    const { width, height } = resolutionOf(preset);
    resolutionNote.textContent = `解像度: ${width} x ${height} px`;
  });

  const fitField = document.createElement('div');
  fitField.className = 'field';
  const fitLabel = document.createElement('label');
  fitLabel.htmlFor = 'fit-mode';
  fitLabel.textContent = 'フィットモード';
  const fitSelect = document.createElement('select');
  fitSelect.id = 'fit-mode';
  const fitOptions: { value: FitMode; label: string }[] = [
    { value: 'contain', label: '収める (contain)' },
    { value: 'cover', label: '埋める (cover)' },
    { value: 'stretch', label: '引き伸ばす (stretch)' },
    { value: 'nearest', label: 'ニアレストネイバー拡縮' },
  ];
  for (const opt of fitOptions) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    fitSelect.append(el);
  }
  fitSelect.value = store.get().fitMode;
  fitSelect.addEventListener('change', () => {
    store.update((s) => ({ ...s, fitMode: fitSelect.value as FitMode }));
  });
  fitField.append(fitLabel, fitSelect);

  panel.append(presetField, resolutionNote, fitField);
  return panel;
}

// ---------- Controls panel ----------

function buildControlsPanel(store: ReturnType<typeof createStore<AppState>>, worker: ConvertWorkerClient): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel';
  const h2 = document.createElement('h2');
  h2.textContent = '変換設定';
  panel.append(h2);

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

function numberField(
  labelText: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  onChange: (value: number) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const id = `f-${labelText.replace(/[^a-zA-Z0-9]/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'number';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initial);
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  wrap.append(label, input);
  return wrap;
}

// ---------- Result panel ----------

function buildResultPanel(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
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
    body.append(buildBudgetGauge(state.result.charCount, state.options.budget));
    body.append(buildStats(state.result));
    body.append(buildPalette(state.result.palette));
  }
}

function previewCell(title: string): { wrap: HTMLElement; canvas: HTMLCanvasElement } {
  const wrap = document.createElement('div');
  wrap.className = 'preview-cell';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'preview-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.style.width = '256px';
  canvas.style.height = '256px';
  canvasWrap.append(canvas);
  wrap.append(h3, canvasWrap);
  return { wrap, canvas };
}

function buildBudgetGauge(charCount: number, budget: number): HTMLElement {
  const gauge = document.createElement('div');
  const over = charCount > budget;
  gauge.className = `budget-gauge${over ? ' over' : ''}`;
  const track = document.createElement('div');
  track.className = 'bar-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(budget));
  track.setAttribute('aria-valuenow', String(charCount));
  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  const pct = Math.min(100, (charCount / budget) * 100);
  fill.style.width = `${pct}%`;
  track.append(fill);
  const labelRow = document.createElement('div');
  labelRow.className = 'bar-label';
  labelRow.innerHTML = `<span>${charCount.toLocaleString()} / ${budget.toLocaleString()} 文字</span><span>${(
    (charCount / budget) *
    100
  ).toFixed(1)}%</span>`;
  gauge.append(track, labelRow);
  return gauge;
}

function buildStats(result: NonNullable<AppState['result']>): HTMLElement {
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

// ---------- Code panel ----------

function buildCodePanel(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel code-output';
  const h2 = document.createElement('h2');
  h2.textContent = '生成コード';
  panel.append(h2);

  const toolbar = document.createElement('div');
  toolbar.className = 'code-toolbar';
  const charCountLabel = document.createElement('span');
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn';
  copyBtn.type = 'button';
  copyBtn.textContent = 'コピー';
  toolbar.append(charCountLabel, copyBtn);

  const pre = document.createElement('pre');
  pre.tabIndex = 0;

  copyBtn.addEventListener('click', async () => {
    const state = store.get();
    if (!state.result) return;
    try {
      await navigator.clipboard.writeText(state.result.lua);
      copyBtn.textContent = 'コピーしました ✓';
      setTimeout(() => (copyBtn.textContent = 'コピー'), 1500);
    } catch {
      copyBtn.textContent = 'コピーに失敗しました';
      setTimeout(() => (copyBtn.textContent = 'コピー'), 1500);
    }
  });

  store.subscribe((state) => {
    if (state.result) {
      pre.textContent = state.result.lua;
      charCountLabel.textContent = `${state.result.charCount.toLocaleString()} 文字`;
      copyBtn.disabled = false;
    } else {
      pre.textContent = '';
      charCountLabel.textContent = '';
      copyBtn.disabled = true;
    }
  });
  copyBtn.disabled = true;

  panel.append(toolbar, pre);
  return panel;
}
