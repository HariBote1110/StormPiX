/** Small framework-free DOM builder helpers shared across panels. */

export function numberField(
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

export function previewCell(title: string): { wrap: HTMLElement; canvas: HTMLCanvasElement } {
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
