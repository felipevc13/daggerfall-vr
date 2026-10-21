// VR1: IS A MODAL UP? One question, no menu list.
//
// The flat game never imports this file. A headset page calls start()
// only while it wants the answer (the Privateer's Hold demo does that
// under ?vrui, and does not call it otherwise). Until start(), nothing
// here loads the engine, watches the DOM, or sets a timer.
//
// Signals, OR'd. Any one of them opens. A read that throws opens too:
// an extra panel is the failure, a modal the headset cannot see is the
// bug. A missing export does not open by itself — the other signals
// still answer, which is how an upstream rename degrades.
//
//   hostPaused   the host's own pause, via engineBridge (null until a
//                host hands its hooks to an input layer). This is the
//                pause upstream publishes. The stack's own pause method
//                stays inside the four hosts that own a stack.
//   published    an optional latch the page already holds. The dungeon
//                demo passes dungeonContext's uiOverlayActive, because
//                that page never calls noteHostInput.
//   overlay      enhancedOverlays.overlayOpen, the DOM doors' registry
//   dom          direct children of the body that look like a window:
//                fixed or absolute, visible, taking the pointer, and
//                either large or holding a control. Ids are not
//                consulted except for a short passive ignore list.
//                A new door with a new id is a window because of how
//                it sits on the page, not because we named it.

import { loadVrUiHooks, readHostPaused, readOverlayOpen } from './engineBridge.js';

/** Fraction of the viewport a child must cover to count with no control inside it. */
export const DOM_MODAL_AREA = 0.25;
/** How often a watching detector re-reads. The gamepad's DOM sweep is the same rate. */
export const DOM_POLL_MS = 200;
/** Layers that are full-screen and fixed but are not windows. A new one
 *  that is not on this list shows the panel (fail-open). */
export const DOM_PASSIVE_IDS = Object.freeze([
  'enhanced-hitnums',
  'enhanced-pickupfeed',
  'plus-pad-prompts',
  'enhanced-notice',
]);
export const DOM_PASSIVE_CLASSES = Object.freeze(['hud', 'notice-stack']);
/** The pad cursor's z-index (gamepadInput.js). It takes no pointer events;
 *  this is the belt under that. A full-screen layer at this z still counts. */
export const DOM_CURSOR_Z = 2147483000;

const INTERACTIVE_SELECTOR = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="dialog"], [role="alertdialog"], [aria-modal="true"], [tabindex]:not([tabindex="-1"])';
const INTERACTIVE_ROLES = new Set(['button', 'tab', 'option', 'menuitem', 'checkbox', 'switch', 'dialog', 'alertdialog']);

function attr(node, name) {
  if (typeof node?.getAttribute === 'function') return node.getAttribute(name);
  return null;
}

function classTokens(node) {
  if (node?.classList?.contains) return null;
  const raw = node?.className;
  const text = typeof raw === 'string' ? raw : (raw && typeof raw.baseVal === 'string' ? raw.baseVal : '');
  return text.split(/\s+/).filter(Boolean);
}

function hasClass(node, name) {
  if (node?.classList?.contains) return node.classList.contains(name);
  return classTokens(node).includes(name);
}

function isChrome(node) {
  if (node?.vrChrome === true) return true;
  if (typeof node?.hasAttribute === 'function' && node.hasAttribute('data-vr-chrome')) return true;
  if (node?.dataset && Object.prototype.hasOwnProperty.call(node.dataset, 'vrChrome')) return true;
  return false;
}

function isCanvas(node, canvas) {
  if (canvas && node === canvas) return true;
  return String(node?.tagName || '').toUpperCase() === 'CANVAS';
}

function isPassive(node) {
  if (node?.id && DOM_PASSIVE_IDS.includes(node.id)) return true;
  for (const name of DOM_PASSIVE_CLASSES) if (hasClass(node, name)) return true;
  return false;
}

function styleOf(node, env) {
  if (node?.computedStyle) return node.computedStyle;
  const gcs = env.getComputedStyle ?? globalThis.getComputedStyle;
  if (typeof gcs !== 'function') return null;
  try { return gcs(node); } catch { return null; }
}

function boxOf(rect) {
  if (!rect) return null;
  const w = Number(rect.width ?? rect.w ?? 0);
  const h = Number(rect.height ?? rect.h ?? 0);
  if (!(w > 0) || !(h > 0)) return null;
  return { x: Number(rect.left ?? rect.x ?? 0), y: Number(rect.top ?? rect.y ?? 0), w, h };
}

function rectOf(node) {
  if (typeof node?.getBoundingClientRect === 'function') {
    try {
      const box = boxOf(node.getBoundingClientRect());
      if (box) return box;
    } catch { /* fall through */ }
  }
  const list = typeof node?.getClientRects === 'function' ? node.getClientRects() : null;
  return boxOf(list && list.length ? list[0] : null);
}

function claimsModal(node) {
  const role = attr(node, 'role') ?? node?.role ?? '';
  if (role === 'dialog' || role === 'alertdialog') return true;
  const modal = attr(node, 'aria-modal');
  return modal === 'true' || modal === true;
}

function isInteractive(node) {
  if (!node || node.nodeType === 3) return false;
  if (claimsModal(node)) return true;
  const tag = String(node.tagName || '').toUpperCase();
  if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  if (tag === 'A' && (node.href || attr(node, 'href'))) return true;
  if (tag === 'INPUT') {
    const type = String(attr(node, 'type') ?? node.type ?? '').toLowerCase();
    return type !== 'hidden';
  }
  const role = attr(node, 'role') ?? node.role ?? '';
  if (INTERACTIVE_ROLES.has(role)) return true;
  const tab = attr(node, 'tabindex');
  return tab != null && String(tab) !== '-1';
}

function hasInteractive(node) {
  if (isInteractive(node)) return true;
  if (typeof node?.querySelector === 'function') {
    try {
      if (node.querySelector(INTERACTIVE_SELECTOR)) return true;
    } catch { /* the walk below is the same question */ }
  }
  const kids = node?.children;
  if (!kids) return false;
  for (const kid of kids) if (hasInteractive(kid)) return true;
  return false;
}

function styleGate(cs) {
  if (!cs) return 'unknown';
  if (cs.display === 'none' || cs.visibility === 'hidden') return 'hidden';
  if (cs.opacity != null && cs.opacity !== '' && Number(cs.opacity) <= 0) return 'hidden';
  if (cs.pointerEvents === 'none') return 'passive';
  const pos = cs.position;
  if (pos && pos !== 'fixed' && pos !== 'absolute') return 'flow';
  return 'layer';
}

function zOf(cs) {
  const z = Number(cs?.zIndex);
  return Number.isFinite(z) ? z : 0;
}

/**
 * The modal among `children` (direct children of the body), or none.
 * Pure: pass element-shaped objects. A real document's body.children
 * works because the fields read here are the DOM's own.
 * @returns {{ open: boolean, element: any, rect: {x:number,y:number,w:number,h:number}|null }}
 */
export function findDomModal(children, env = {}) {
  const viewport = env.viewport ?? { w: 1280, h: 720 };
  const viewArea = Math.max(0, Number(viewport.w) || 0) * Math.max(0, Number(viewport.h) || 0);
  let best = null;
  let bestZ = -Infinity;
  let bestIndex = -1;
  let index = 0;
  const list = children ?? [];
  for (const node of list) {
    const at = index++;
    if (!node || node.nodeType === 3) continue;
    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'TEMPLATE' || tag === 'NOSCRIPT') continue;
    if (isChrome(node) || isCanvas(node, env.canvas) || isPassive(node) || node.hidden === true) continue;
    const cs = styleOf(node, env);
    const gate = styleGate(cs);
    if (gate === 'hidden' || gate === 'passive' || gate === 'flow') continue;
    const rect = rectOf(node);
    if (!rect) continue;
    const fraction = viewArea > 0 ? (rect.w * rect.h) / viewArea : 0;
    const cursorLayer = zOf(cs) >= DOM_CURSOR_Z && fraction < DOM_MODAL_AREA;
    if (cursorLayer) continue;
    // Unknown style still counts: we could not prove it is not a window.
    const modal = gate === 'unknown' || fraction >= DOM_MODAL_AREA || hasInteractive(node);
    if (!modal) continue;
    const z = zOf(cs);
    if (!best || z > bestZ || (z === bestZ && at > bestIndex)) {
      best = { element: node, rect };
      bestZ = z;
      bestIndex = at;
    }
  }
  if (!best) return { open: false, element: null, rect: null };
  return { open: true, element: best.element, rect: best.rect };
}

function viewportOf(doc, override) {
  if (override && override.w > 0 && override.h > 0) return { w: override.w, h: override.h };
  const view = doc?.defaultView ?? globalThis;
  const w = Number(view?.innerWidth);
  const h = Number(view?.innerHeight);
  return { w: w > 0 ? w : 1280, h: h > 0 ? h : 720 };
}

function closedSnapshot(viewport) {
  return {
    open: false,
    reasons: [],
    kind: 'none',
    element: null,
    rect: null,
    viewport,
    signals: { hostPaused: 'idle', published: 'idle', overlay: 'closed', dom: false },
  };
}

function ask(fn) {
  try { return fn(); } catch { return { status: 'threw' }; }
}

function signature(snap) {
  const r = snap.rect;
  const rect = r ? `${r.x},${r.y},${r.w},${r.h}` : '';
  const id = snap.element?.id ?? '';
  return `${snap.open}|${snap.reasons.join('+')}|${snap.kind}|${id}|${rect}`;
}

async function engineReaders() {
  const mods = await loadVrUiHooks();
  return {
    hostPaused: () => readHostPaused(mods),
    overlayOpen: () => readOverlayOpen(mods),
  };
}

/**
 * A detector. Constructing it does not read the engine or the DOM.
 * start() loads the readers and, when `watch` is set, polls and listens
 * for DOM changes. subscribe() is called with the current snapshot at
 * once, then again only when the snapshot changes.
 *
 * @param {{ document?: Document|null, canvas?: any, viewport?: {w:number,h:number}|null,
 *   watch?: boolean, publishedOpen?: (() => boolean)|null,
 *   schedule?: (fn: Function, ms: number) => any, cancel?: (id: any) => void,
 *   getComputedStyle?: Function, readers?: { hostPaused: Function, overlayOpen: Function }|null }} [options]
 */
export function createUiPresence(options = {}) {
  const doc = options.document === undefined ? globalThis.document : options.document;
  const watch = options.watch === true;
  const schedule = options.schedule ?? null;
  const cancel = options.cancel ?? null;
  let readers = options.readers ?? null;
  let viewportOverride = options.viewport ?? null;
  const listeners = new Set();
  let current = closedSnapshot(viewportOf(doc, viewportOverride));
  let watching = false;
  let timer = null;
  let observer = null;
  let lastSig = signature(current);

  function readPublished() {
    if (typeof options.publishedOpen !== 'function') return { status: 'idle' };
    try {
      return { status: 'value', value: options.publishedOpen() === true };
    } catch {
      return { status: 'threw' };
    }
  }

  function sample() {
    const viewport = viewportOf(doc, viewportOverride);
    const host = readers ? ask(() => readers.hostPaused()) : { status: 'missing' };
    const overlay = readers ? ask(() => readers.overlayOpen()) : { status: 'missing' };
    const published = readPublished();
    const dom = findDomModal(doc?.body?.children, {
      viewport,
      canvas: options.canvas ?? doc?.querySelector?.('canvas') ?? null,
      getComputedStyle: options.getComputedStyle,
    });
    const reasons = [];
    if (host.status === 'value' && host.value === true) reasons.push('hostPaused');
    if (published.status === 'value' && published.value === true) reasons.push('published');
    if (overlay.status === 'value' && overlay.value === true) reasons.push('overlay');
    if (dom.open) reasons.push('dom');
    const uncertain = host.status === 'threw' || overlay.status === 'threw' || published.status === 'threw';
    if (uncertain) reasons.push('uncertain');
    const open = reasons.length > 0;
    let kind = 'none';
    let element = null;
    let rect = null;
    if (dom.open) {
      kind = 'dom';
      element = dom.element;
      rect = dom.rect;
    } else if (open) {
      const canvas = options.canvas ?? doc?.querySelector?.('canvas') ?? null;
      const canvasRect = canvas ? rectOf(canvas) : null;
      if (canvas) {
        kind = 'canvas';
        element = canvas;
        rect = canvasRect;
      }
    }
    const snap = {
      open,
      reasons: Object.freeze(reasons),
      kind,
      element,
      rect,
      viewport,
      signals: {
        hostPaused: host.status === 'value' ? (host.value ? 'open' : 'closed') : host.status,
        published: published.status === 'value' ? (published.value ? 'open' : 'closed') : published.status,
        overlay: overlay.status === 'value' ? (overlay.value ? 'open' : 'closed') : overlay.status,
        dom: dom.open,
      },
    };
    current = snap;
    const sig = signature(snap);
    if (sig !== lastSig) {
      lastSig = sig;
      emit();
    }
    return snap;
  }

  function emit() {
    const snap = current;
    for (const fn of listeners) {
      try { fn(snap); } catch { /* one listener does not silence the others */ }
    }
  }

  function arm() {
    if (watching) return;
    watching = true;
    const tick = () => { if (watching) sample(); };
    if (schedule) timer = schedule(tick, DOM_POLL_MS);
    else if (typeof setInterval === 'function') timer = setInterval(tick, DOM_POLL_MS);
    const MO = globalThis.MutationObserver;
    if (typeof MO === 'function' && doc?.body) {
      try {
        observer = new MO(tick);
        observer.observe(doc.body, { childList: true, subtree: true });
      } catch { observer = null; }
    }
  }

  function disarm() {
    watching = false;
    if (timer != null) {
      if (cancel) cancel(timer);
      else if (typeof clearInterval === 'function') clearInterval(timer);
      timer = null;
    }
    if (observer) {
      try { observer.disconnect(); } catch { /* already gone */ }
      observer = null;
    }
  }

  return {
    /** Load readers and take one sample. With `watch`, keep sampling. */
    async start() {
      if (!readers) readers = await engineReaders();
      const snap = sample();
      if (watch) arm();
      return snap;
    },
    /** Stop the timer and the observer. sample() still answers. */
    stop() { disarm(); },
    /** Re-read every signal. Notifies subscribers when the answer changed. */
    sample,
    /** @param {(snap: object) => void} fn called now, and on each change */
    subscribe(fn) {
      listeners.add(fn);
      try { fn(current); } catch { /* same as emit */ }
      return () => listeners.delete(fn);
    },
    isOpen() { return current.open; },
    activeElement() { return current.element; },
    activeRect() { return current.rect; },
    snapshot() { return current; },
    /** Test and debug seam: replace the viewport the area fraction uses. */
    setViewport(next) { viewportOverride = next; },
  };
}
