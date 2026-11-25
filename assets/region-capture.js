const shade = document.getElementById('shade');
const selection = document.getElementById('selection');
const toolbar = document.getElementById('toolbar');
let rect = null;
let gesture = null;
let preview = null;
let candidates = [];
const minimum = 8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function render() {
  const visible = rect ?? preview;
  shade.hidden = Boolean(visible);
  selection.hidden = !visible;
  toolbar.hidden = !rect || Boolean(gesture);
  if (!visible) return;
  selection.classList.toggle('preview', !rect);
  Object.assign(selection.style, {
    left: `${visible.x}px`, top: `${visible.y}px`,
    width: `${visible.width}px`, height: `${visible.height}px`
  });
  if (!toolbar.hidden) {
    const w = toolbar.offsetWidth, h = toolbar.offsetHeight;
    toolbar.style.left = `${clamp(rect.x + rect.width - w, 8, innerWidth - w - 8)}px`;
    const below = rect.y + rect.height + 10;
    toolbar.style.top = `${clamp(below + h <= innerHeight - 8 ? below : rect.y - h - 10, 8, innerHeight - h - 8)}px`;
  }
}
function updatePreview(x, y) {
  const windowRect = candidates.find(candidate =>
    x >= candidate.x && x < candidate.x + candidate.width &&
    y >= candidate.y && y < candidate.y + candidate.height);
  if (!windowRect || x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) {
    preview = null;
    return;
  }
  const left = Math.max(0, windowRect.x);
  const top = Math.max(0, windowRect.y);
  preview = {
    x: left, y: top,
    width: Math.min(innerWidth, windowRect.x + windowRect.width) - left,
    height: Math.min(innerHeight, windowRect.y + windowRect.height) - top
  };
  if (preview.width < minimum || preview.height < minimum) preview = null;
}
window.regionCapture.onInit(data => {
  if (data.backdrop) {
    const backdrop = document.getElementById('backdrop');
    backdrop.src = data.backdrop;
    backdrop.hidden = false;
  }
  candidates = data.candidates ?? [];
  if (data.pointer) updatePreview(data.pointer.x, data.pointer.y);
  render();
  if (data.language === 'en') { document.getElementById('save').textContent = 'Save'; document.getElementById('text').textContent = 'Recognize & copy'; document.getElementById('cancel').setAttribute('aria-label', 'Close'); document.getElementById('cancel').textContent = 'Close'; }
});
addEventListener('pointerdown', event => {
  if (event.button !== 0 || toolbar.contains(event.target)) return;
  const x = clamp(event.clientX, 0, innerWidth), y = clamp(event.clientY, 0, innerHeight);
  const handle = event.target.dataset?.handle;
  const mode = handle || (selection.contains(event.target) ? 'move' : 'new');
  if (mode === "new") updatePreview(x, y);
  gesture = { mode, x, y, original: rect, snap: preview, dragged: false };
  document.body.setPointerCapture(event.pointerId); render();
});
addEventListener('pointermove', event => {
  if (!gesture) {
    if (!rect) { updatePreview(event.clientX, event.clientY); render(); }
    return;
  }
  const x = clamp(event.clientX, 0, innerWidth), y = clamp(event.clientY, 0, innerHeight);
  const { mode, original, x: startX, y: startY } = gesture;
  if (mode === 'new' && !gesture.dragged) {
    if (Math.hypot(x - startX, y - startY) < 5) return;
    gesture.dragged = true;
  }
  if (mode === 'new') rect = { x: Math.min(x,startX), y: Math.min(y,startY), width: Math.abs(x-startX), height: Math.abs(y-startY) };
  else if (mode === 'move') rect = { ...original, x: clamp(original.x+x-startX,0,innerWidth-original.width), y: clamp(original.y+y-startY,0,innerHeight-original.height) };
  else {
    let left = original.x, top = original.y, right = left+original.width, bottom = top+original.height;
    if (mode.includes('w')) left = clamp(x,0,right-minimum);
    if (mode.includes('e')) right = clamp(x,left+minimum,innerWidth);
    if (mode.includes('n')) top = clamp(y,0,bottom-minimum);
    if (mode.includes('s')) bottom = clamp(y,top+minimum,innerHeight);
    rect = { x:left, y:top, width:right-left, height:bottom-top };
  }
  render();
});
addEventListener('pointerup', () => {
  if (!gesture) return;
  if (gesture.mode === 'new' && !gesture.dragged) rect = gesture.snap;
  gesture = null;
  if (rect && (rect.width < minimum || rect.height < minimum)) rect = null;
  if (rect) preview = null;
  render();
});
addEventListener('pointercancel', () => {
  if (!gesture) return;
  rect = gesture.original;
  gesture = null;
  render();
});
addEventListener('pointerleave', () => {
  if (!gesture && !rect) { preview = null; render(); }
});
addEventListener('keydown', event => { if (event.key === 'Escape') window.regionCapture.finish('cancel'); });
document.getElementById('save').onclick = () => window.regionCapture.finish('save', rect);
document.getElementById('text').onclick = () => window.regionCapture.finish('text', rect);
document.getElementById('cancel').onclick = () => window.regionCapture.finish('cancel');
