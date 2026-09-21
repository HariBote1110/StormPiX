import { createStore } from './lib/store.ts';
import { debounce } from './lib/debounce.ts';
import { toConvertOptions } from './lib/options.ts';
import { ConvertWorkerClient } from './workerClient.ts';
import { initialState, type AppState } from './state.ts';
import { applyTheme, buildHeader } from './panels/header.ts';
import { buildInputPanel } from './panels/input.ts';
import { buildMonitorPanel } from './panels/monitor.ts';
import { buildControlsPanel } from './panels/controls.ts';
import { buildResultPanel } from './panels/result.ts';
import { buildCodePanel } from './panels/code.ts';

export function mountApp(root: HTMLElement): void {
  const store = createStore<AppState>(initialState());
  const worker = new ConvertWorkerClient();

  root.innerHTML = '';
  const header = buildHeader(store);
  const body = document.createElement('div');
  body.className = 'app-body';

  const left = document.createElement('div');
  left.className = 'controls-column';
  left.append(buildInputPanel(store), buildMonitorPanel(store), buildControlsPanel(store, worker));

  const right = document.createElement('div');
  right.className = 'results-column';
  right.append(buildResultPanel(store), buildCodePanel(store));

  body.append(left, right);
  root.append(header, body);

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
