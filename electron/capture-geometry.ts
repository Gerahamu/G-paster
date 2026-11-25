interface Rect { x: number; y: number; width: number; height: number }
interface Size { width: number; height: number }

/** Clip in physical pixels before projecting each visible piece into its display's DIPs. */
export function projectWindow(window: Rect, physical: Rect, display: Rect, viewport: Rect): Rect | undefined {
  const left = Math.max(window.x, physical.x);
  const top = Math.max(window.y, physical.y);
  const right = Math.min(window.x + window.width, physical.x + physical.width);
  const bottom = Math.min(window.y + window.height, physical.y + physical.height);
  if (right <= left || bottom <= top) return;
  const scaleX = display.width / physical.width;
  const scaleY = display.height / physical.height;
  return {
    x: display.x - viewport.x + (left - physical.x) * scaleX,
    y: display.y - viewport.y + (top - physical.y) * scaleY,
    width: (right - left) * scaleX,
    height: (bottom - top) * scaleY
  };
}

export function cropRegion(rect: Rect, display: Size, image: Size): Rect | undefined {
  if (rect.x < 0 || rect.y < 0 || rect.width < 8 || rect.height < 8 ||
      rect.x + rect.width > display.width + 1 || rect.y + rect.height > display.height + 1) return;
  const scaleX = image.width / display.width;
  const scaleY = image.height / display.height;
  const x = Math.floor(rect.x * scaleX);
  const y = Math.floor(rect.y * scaleY);
  const right = Math.min(image.width, Math.ceil((rect.x + rect.width) * scaleX));
  const bottom = Math.min(image.height, Math.ceil((rect.y + rect.height) * scaleY));
  if (right <= x || bottom <= y) return;
  return { x, y, width: right - x, height: bottom - y };
}
