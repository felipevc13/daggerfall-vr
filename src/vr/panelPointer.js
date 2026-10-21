// VR1 - a panel hit becomes the same click the page already listens for.
// The door's own handlers run. This file does not know which screen it is.

function isChromeNode(el) {
  let n = el;
  while (n) {
    if (typeof n.hasAttribute === 'function' && n.hasAttribute('data-vr-chrome')) return true;
    n = n.parentElement ?? null;
  }
  return false;
}

/** The top element under the page point that lives inside the door.
 *  The Enter VR plaque sits above the menu and is not a door control. */
export function elementInRoot(doc, root, x, y) {
  if (!doc || !root) return null;
  let stack = null;
  if (typeof doc.elementsFromPoint === 'function') stack = doc.elementsFromPoint(x, y);
  else if (typeof doc.elementFromPoint === 'function') stack = [doc.elementFromPoint(x, y)];
  if (!stack) return null;
  for (const el of stack) {
    if (!el || el === root.ownerDocument?.documentElement) continue;
    if (isChromeNode(el)) continue;
    if (el.disabled) continue;
    if (root === el || (typeof root.contains === 'function' && root.contains(el))) return el;
  }
  return null;
}

function fire(el, type, point, Ctor, extra) {
  if (!el || typeof el.dispatchEvent !== 'function' || typeof Ctor !== 'function') return;
  const init = {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    button: 0,
    buttons: extra.buttons,
    pointerId: 1,
    pointerType: 'mouse',
    view: el.ownerDocument?.defaultView ?? null,
    detail: extra.detail ?? 1,
  };
  try { el.dispatchEvent(new Ctor(type, init)); } catch { /* a widget that throws does not end the session */ }
}

/** `phase` is 'move', 'down', or 'up'. 'down' on a field focuses it so a
 *  headset keyboard, when the browser offers one, has a target. */
export function dispatchPanelPointer(doc, root, point, phase, target = null) {
  const el = target ?? elementInRoot(doc, root, point.x, point.y);
  if (!el) return null;
  const Pointer = doc.defaultView?.PointerEvent ?? globalThis.PointerEvent;
  const Mouse = doc.defaultView?.MouseEvent ?? globalThis.MouseEvent;
  if (phase === 'move') {
    fire(el, 'pointermove', point, Pointer, { buttons: 0 });
    fire(el, 'mousemove', point, Mouse, { buttons: 0 });
  } else if (phase === 'down') {
    fire(el, 'pointerdown', point, Pointer, { buttons: 1 });
    fire(el, 'mousedown', point, Mouse, { buttons: 1 });
    const tag = String(el.tagName || '').toUpperCase();
    if ((tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) && typeof el.focus === 'function') {
      try { el.focus(); } catch { /* the click still lands */ }
    }
  } else if (phase === 'up') {
    fire(el, 'pointerup', point, Pointer, { buttons: 0 });
    fire(el, 'mouseup', point, Mouse, { buttons: 0 });
    fire(el, 'click', point, Mouse, { buttons: 0, detail: 1 });
  }
  return el;
}

/** One click per trigger press. `prev` is `{ down }`. */
export function triggerEdge(prev, down) {
  const pressed = !!down;
  const was = !!prev.down;
  prev.down = pressed;
  return { down: pressed && !was, up: !pressed && was, held: pressed };
}
