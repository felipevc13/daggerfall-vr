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
  const walk = (el) => {
    if (!el || nodes.length >= MAX_NODES) return;
    const tag = String(el.tagName || '').toUpperCase();
    if (SKIP.has(tag)) return;
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-vr-chrome')) return;
    const style = styleOf(el);
    const rect = rectOf(el);
    const kids = el.children || [];
    if (!visible(style, rect) || !overlaps(base, rect)) {
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
      return;
    }
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
    for (let i = 0; i < kids.length; i++) walk(kids[i]);
  };
  walk(root);
  nodes.sort((a, b) => (a.z - b.z) || (a.order - b.order));
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

/** Live page. `canvas` is reused. Returns the canvas, or null. */
export function rasterizeRoot(root, canvas, doc) {
  if (!root || !canvas || typeof canvas.getContext !== 'function') return null;
  const view = doc?.defaultView;
  const list = buildPaintList(root, {
    rectOf: (el) => el.getBoundingClientRect(),
    styleOf: (el) => (view?.getComputedStyle ? view.getComputedStyle(el) : null),
    imageOf: (el) => {
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'CANVAS' || tag === 'IMG' || tag === 'VIDEO') return el;
      return null;
    },
  });
  const size = rasterSize(list);
  if (!size) return null;
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!paintList(ctx, list)) return null;
  return canvas;
}
