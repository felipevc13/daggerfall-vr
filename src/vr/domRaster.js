// VR1 - paint whatever DOM is on the front door into a canvas.
//
// The walk reads boxes and computed paint. It does not name a menu. A
// later upstream screen that is still DOM shows up because it has elements,
// not because this file learned its classes. Pseudo-elements are not
// boxes, so a diamond drawn only by ::before is absent. The click path
// does not use this picture. It uses the live page.

export const RASTER_MAX_EDGE = 1600;
const MAX_NODES = 800;

const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT']);

function px(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function visible(style, rect) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return false;
  if (!style) return true;
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const opacity = style.opacity == null || style.opacity === '' ? 1 : px(style.opacity);
  return opacity > 0.02;
}

function overlaps(a, b) {
  return !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
}

/** A canvas, image, or video the panel can draw. A WebGL canvas reads back
 *  black once its buffer has been presented, so it is not a picture.
 *  Asking for 2d returns null when WebGL already owns the canvas, and does
 *  not replace that context. */
export function canvasForPanel(el) {
  const tag = String(el?.tagName || '').toUpperCase();
  if (tag === 'IMG') {
    if (el.complete === false || el.naturalWidth === 0) return null;
    return el;
  }
  if (tag === 'VIDEO') return (Number(el.readyState) || 0) >= 2 ? el : null;
  if (tag !== 'CANVAS') return null;
  if (typeof el.getContext === 'function' && el.getContext('2d') == null) return null;
  return el;
}

const DOOR_MIN = 32;
const DOOR_FALLBACK_W = 1280;
const DOOR_FALLBACK_H = 720;

export function doorBoxTooSmall(rect) {
  return !rect || !(rect.width >= DOOR_MIN) || !(rect.height >= DOOR_MIN);
}

/** The door's page box. A collapsed fixed layer (no size while the
 *  immersive session is up) is pinned to the last real size, or to
 *  1280×720, so the buttons have a box to paint and to click. */
export function resolveDoorRect(root, memory = {}) {
  const read = () => {
    try { return root?.getBoundingClientRect?.() ?? null; } catch { return null; }
  };
  let rect = read();
  if (!doorBoxTooSmall(rect)) {
    memory.width = rect.width;
    memory.height = rect.height;
    return { rect, pinned: false };
  }
  const width = memory.width >= DOOR_MIN ? memory.width : DOOR_FALLBACK_W;
  const height = memory.height >= DOOR_MIN ? memory.height : DOOR_FALLBACK_H;
  const style = root?.style;
  if (style && memory.saved == null) {
    memory.saved = style.cssText ?? '';
    memory.root = root;
  }
  if (style) {
    style.width = `${Math.round(width)}px`;
    style.height = `${Math.round(height)}px`;
    style.left = '0px';
    style.top = '0px';
    style.right = 'auto';
    style.bottom = 'auto';
  }
  rect = read();
  return { rect, pinned: true, width, height };
}

export function releaseDoorPin(memory) {
  const root = memory?.root;
  if (!root?.style || memory.saved == null) return;
  try { root.style.cssText = memory.saved; } catch { /* the door is already gone */ }
  memory.saved = null;
  memory.root = null;
}

function directText(el) {
  const tag = String(el?.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const value = el.value != null && String(el.value).length ? String(el.value) : '';
    return (value || el.placeholder || '').replace(/\s+/g, ' ').trim();
  }
  let s = '';
  const kids = el.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n && n.nodeType === 3) s += n.textContent || '';
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Boxes in paint order. `hooks.rectOf(el)` and `hooks.styleOf(el)` are the
 * page's measurements. `hooks.imageOf(el)` may return a canvas or image.
 */
export function buildPaintList(root, hooks) {
  const rectOf = hooks?.rectOf;
  const styleOf = hooks?.styleOf ?? (() => null);
  if (!root || typeof rectOf !== 'function') return null;
  const base = rectOf(root);
  if (!base || !(base.width > 0) || !(base.height > 0)) return null;
  const nodes = [];
  // Parent box first, then descendants. A global z-index sort paints a
  // full-screen scrim (the account stage is z-index 5) after the text
  // inside it, which covers the door with one dark rectangle.
  const emit = (el) => {
    if (!el || nodes.length >= MAX_NODES) return;
    const tag = String(el.tagName || '').toUpperCase();
    if (SKIP.has(tag)) return;
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-vr-chrome')) return;
    const style = styleOf(el);
    const rect = rectOf(el);
    const raw = el.children || [];
    const kids = [];
    for (let i = 0; i < raw.length; i++) kids.push(raw[i]);
    if (visible(style, rect) && overlaps(base, rect)) {
      const opacity = style?.opacity == null || style.opacity === '' ? 1 : px(style.opacity);
      nodes.push({
        order: nodes.length,
        z: style ? px(style.zIndex) : 0,
        left: rect.left - base.left,
        top: rect.top - base.top,
        width: rect.width,
        height: rect.height,
        color: style?.color || '#d8cfae',
        background: style?.backgroundColor || '',
        font: style?.font || `${style?.fontSize || '16px'} ${style?.fontFamily || 'sans-serif'}`,
        align: style?.textAlign || 'left',
        padLeft: style ? px(style.paddingLeft) : 0,
        opacity,
        text: directText(el),
        image: hooks.imageOf?.(el) ?? null,
        border: style ? px(style.borderTopWidth) : 0,
        borderColor: style?.borderTopColor || style?.color || '#7d7460',
      });
    }
    if (kids.length > 1) {
      const z = new Map();
      for (const k of kids) {
        const ks = styleOf(k);
        z.set(k, ks ? px(ks.zIndex) : 0);
      }
      kids.sort((a, b) => (z.get(a) - z.get(b)) || 0);
    }
    for (const k of kids) emit(k);
  };
  emit(root);
  return { width: base.width, height: base.height, nodes };
}

function scaleOf(width, height) {
  const edge = Math.max(width, height);
  if (!(edge > 0)) return 1;
  return edge > RASTER_MAX_EDGE ? RASTER_MAX_EDGE / edge : 1;
}

/** Draw `list` into a canvas 2D context. Returns false when there is no context. */
export function paintList(ctx, list) {
  if (!ctx || !list) return false;
  const s = scaleOf(list.width, list.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, list.width, list.height);
  ctx.fillStyle = '#0e1013';
  ctx.fillRect(0, 0, list.width, list.height);
  for (const n of list.nodes) {
    ctx.globalAlpha = n.opacity;
    const bg = n.background;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      ctx.fillStyle = bg;
      ctx.fillRect(n.left, n.top, n.width, n.height);
    }
    if (n.image) {
      try { ctx.drawImage(n.image, n.left, n.top, n.width, n.height); } catch { /* a tainted frame is a hole, not a throw */ }
    }
    if (n.border > 0) {
      ctx.strokeStyle = n.borderColor;
      ctx.lineWidth = n.border;
      ctx.strokeRect(n.left, n.top, n.width, n.height);
    }
    if (n.text) {
      ctx.fillStyle = n.color;
      ctx.font = n.font;
      ctx.textAlign = n.align === 'center' || n.align === 'right' ? n.align : 'left';
      ctx.textBaseline = 'middle';
      const x = n.align === 'center' ? n.left + n.width / 2 : n.align === 'right' ? n.left + n.width - 8 : n.left + Math.max(8, n.padLeft);
      try { ctx.fillText(n.text, x, n.top + n.height / 2, Math.max(1, n.width - 8)); } catch { /* a missing font still leaves the box */ }
    }
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return true;
}

export function rasterSize(list) {
  if (!list) return null;
  const s = scaleOf(list.width, list.height);
  return { width: Math.max(1, Math.round(list.width * s)), height: Math.max(1, Math.round(list.height * s)) };
}

function paintStats(list) {
  let texts = 0;
  let images = 0;
  for (const n of list?.nodes ?? []) {
    if (n.text) texts += 1;
    if (n.image) images += 1;
  }
  return {
    nodes: list?.nodes?.length ?? 0,
    texts,
    images,
    width: list?.width ?? 0,
    height: list?.height ?? 0,
  };
}

/** Live page. `canvas` is reused. Returns the canvas plus counts, or null. */
export function rasterizeRoot(root, canvas, doc) {
  if (!root || !canvas || typeof canvas.getContext !== 'function') return null;
  const view = doc?.defaultView;
  const list = buildPaintList(root, {
    rectOf: (el) => el.getBoundingClientRect(),
    styleOf: (el) => (view?.getComputedStyle ? view.getComputedStyle(el) : null),
    imageOf: (el) => canvasForPanel(el),
  });
  const size = rasterSize(list);
  if (!size) return null;
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!paintList(ctx, list)) return null;
  return { canvas, ...paintStats(list) };
}
