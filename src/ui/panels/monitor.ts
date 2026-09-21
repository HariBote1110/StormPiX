import type { createStore } from '../lib/store.ts';
import { MONITOR_PRESETS, resolutionOf } from '../lib/monitors.ts';
import type { FitMode } from '../lib/fit.ts';
import type { AppState } from '../state.ts';

export function buildMonitorPanel(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
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
