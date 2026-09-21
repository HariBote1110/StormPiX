import type { createStore } from '../lib/store.ts';
import { fileToBitmap, paintBitmap } from '../lib/bitmap.ts';
import { MONITOR_PRESETS, resolutionOf } from '../lib/monitors.ts';
import type { AppState, FrameEntry } from '../state.ts';

let nextFrameId = 1;

export function buildInputPanel(store: ReturnType<typeof createStore<AppState>>): HTMLElement {
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
