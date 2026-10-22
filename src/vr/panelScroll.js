// VR1 - the right stick scrolls the box under the laser.
//
// WebXR stick Y is -1 pushed up and +1 pulled down (xrInput.js). Pulling
// down increases scrollTop. An untrusted wheel event does not move the
// page, so the scroll is a write to scrollTop. The event is still fired
// for a listener that watches the wheel. Snap turn reads the right stick's
// X in the dungeon, and this file is only asked while the title monitor
// is the picture.

const SCROLL_MODE = new Set(['auto', 'scroll', 'overlay']);

export const STICK_DEAD = 0.15;
export const STICK_SCROLL_PX_PER_S = 900;

export function stickScrollDelta(y, dtMs) {
  const n = Number(y);
  if (!Number.isFinite(n)) return 0;
  const mag = Math.abs(n);
  if (mag < STICK_DEAD) return 0;
  const shaped = Math.sign(n) * (mag - STICK_DEAD) / (1 - STICK_DEAD);
  const dt = Number.isFinite(dtMs) && dtMs > 0 && dtMs < 80 ? dtMs : 16;
  return shaped * STICK_SCROLL_PX_PER_S * (dt / 1000);
}

function styleOf(doc, el) {
  if (el?.computedStyle) return el.computedStyle;
  try { return doc?.defaultView?.getComputedStyle?.(el) ?? null; } catch { return null; }
}

function canScroll(style, el, axis) {
  if (!style || !el) return false;
  const named = axis === 'x' ? style.overflowX : style.overflowY;
  const value = named || style.overflow || '';
  if (!SCROLL_MODE.has(value)) return false;
  if (axis === 'y') return (Number(el.scrollHeight) || 0) > (Number(el.clientHeight) || 0) + 1;
  return (Number(el.scrollWidth) || 0) > (Number(el.clientWidth) || 0) + 1;
}

/** The nearest overflow:auto/scroll ancestor of the element under the point.
 *  The page is used only when nothing inside it scrolls. */
export function scrollableAt(doc, x, y) {
  if (!doc) return null;
  let stack = null;
  try {
    if (typeof doc.elementsFromPoint === 'function') stack = doc.elementsFromPoint(x, y);
    else if (typeof doc.elementFromPoint === 'function') stack = [doc.elementFromPoint(x, y)];
  } catch { stack = null; }
  let n = stack?.[0] ?? null;
  while (n) {
    const style = styleOf(doc, n);
    if (canScroll(style, n, 'y') || canScroll(style, n, 'x')) return n;
    n = n.parentElement ?? null;
  }
  const page = doc.scrollingElement || doc.documentElement || null;
  if (page && (canScroll(styleOf(doc, page), page, 'y') || canScroll(styleOf(doc, page), page, 'x'))) return page;
  return null;
}

export function applyStickScroll(el, delta) {
  const d = Number(delta) || 0;
  if (!el || !d) return false;
  const before = Number(el.scrollTop) || 0;
  const max = Math.max(0, (Number(el.scrollHeight) || 0) - (Number(el.clientHeight) || 0));
  const next = Math.min(max, Math.max(0, before + d));
  el.scrollTop = next;
  return next !== before;
}

export function wheelBurst(el, delta, doc) {
  if (!el || typeof el.dispatchEvent !== 'function') return;
  const Ctor = doc?.defaultView?.WheelEvent ?? globalThis.WheelEvent;
  if (typeof Ctor !== 'function') return;
  try {
    el.dispatchEvent(new Ctor('wheel', { bubbles: true, cancelable: true, deltaY: delta }));
  } catch { /* scrollTop is the scroll */ }
}
