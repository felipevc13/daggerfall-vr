// VR1: a modal is detected from the signals every door already has to
// use, not from a list of menus. Headless: element-shaped objects stand
// in for the DOM. The engine readers are the real ones (host pause,
// overlay registry, window stack), loaded through the bridge.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createUiPresence } from '../../src/vr/uiPresence.js';
import { noteHostInput } from '../../src/ui/input.js';
import { registerOverlay, overlayOpen, closeTopOverlay } from '../../src/ui/enhanced/enhancedOverlays.js';
import { makeWindowStack } from '../../src/ui/windowStack.js';

const VIEW = { w: 1000, h: 800 };

function style(over = {}) {
  return {
    position: 'fixed', display: 'block', visibility: 'visible', opacity: '1',
    pointerEvents: 'auto', zIndex: '13', ...over,
  };
}

function node(spec = {}, kids = []) {
  const n = {
    id: spec.id ?? '',
    className: spec.className ?? '',
    tagName: spec.tagName ?? 'DIV',
    role: spec.role ?? null,
    vrChrome: spec.vrChrome === true,
    hidden: spec.hidden === true,
    href: spec.href ?? null,
    type: spec.type ?? null,
    computedStyle: spec.computedStyle === undefined ? style() : spec.computedStyle,
    rect: spec.rect ?? { left: 10, top: 10, width: 200, height: 80 },
    children: kids,
    getBoundingClientRect() { return this.rect; },
    getClientRects() { return this.rect && this.rect.width > 0 ? [this.rect] : []; },
    getAttribute(name) {
      if (name === 'role') return this.role;
      if (name === 'href') return this.href;
      if (name === 'type') return this.type;
      if (name === 'tabindex') return spec.tabindex ?? null;
      if (name === 'aria-modal') return spec.ariaModal ?? null;
      if (name === 'data-vr-chrome') return this.vrChrome ? '' : null;
      return null;
    },
    hasAttribute(name) { return this.getAttribute(name) != null; },
  };
  if (spec.querySelector) n.querySelector = spec.querySelector;
  return n;
}

function page(children, canvas = null) {
  return {
    body: { children },
    querySelector(sel) { return sel === 'canvas' ? canvas : null; },
    defaultView: { innerWidth: VIEW.w, innerHeight: VIEW.h },
  };
}

function canvasNode() {
  return node({
    tagName: 'CANVAS', id: 'c', computedStyle: null,
    rect: { left: 0, top: 0, width: VIEW.w, height: VIEW.h },
  });
}

function button(rect = { left: 20, top: 20, width: 48, height: 20 }) {
  return node({ tagName: 'BUTTON', rect });
}

function resetHost() { noteHostInput({ paused: () => false }); }
function drainOverlays() { let guard = 0; while (overlayOpen() && guard < 20) { closeTopOverlay(); guard += 1; } }

const idleReaders = () => ({
  hostPaused: () => ({ status: 'idle' }),
  overlayOpen: () => ({ status: 'value', value: false }),
  stackModal: () => ({ status: 'value', value: false }),
});

async function openPresence(doc, extra = {}) {
  const presence = createUiPresence({ document: doc, viewport: VIEW, watch: false, ...extra });
  await presence.start();
  return presence;
}

function jsFiles(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) jsFiles(p, acc);
    else if (ent.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

describe('ui presence against the live engine signals', { concurrency: 1 }, () => {
  test('a canvas window on a stack opens the detector, and pop closes it', async () => {
    resetHost();
    drainOverlays();
    const canvas = canvasNode();
    const presence = await openPresence(page([canvas], canvas));
    const stack = makeWindowStack();
    presence.observeStack(stack);
    assert.equal(presence.isOpen(), false);
    stack.pushWindow({ draw() {} });
    presence.sample();
    const open = presence.snapshot();
    assert.equal(open.open, true);
    assert.deepEqual(open.reasons, ['stack']);
    assert.equal(open.kind, 'canvas');
    assert.equal(presence.activeElement(), canvas);
    assert.deepEqual(presence.activeRect(), { x: 0, y: 0, w: VIEW.w, h: VIEW.h });
    stack.popWindow();
    presence.sample();
    assert.equal(presence.isOpen(), false);
    assert.equal(presence.activeElement(), null);
    assert.equal(presence.activeRect(), null);
  });

  test('a window that opts out of pause (the status readout) is not a modal', async () => {
    resetHost();
    drainOverlays();
    const canvas = canvasNode();
    const presence = await openPresence(page([canvas], canvas));
    const stack = makeWindowStack();
    presence.observeStack(stack);
    stack.pushWindow({ pauseWhileOpen: false, draw() {} });
    presence.sample();
    assert.equal(presence.isOpen(), false);
  });

  test('a HUD-only stack is not a modal', async () => {
    resetHost();
    drainOverlays();
    const presence = await openPresence(page([]));
    presence.observeStack(makeWindowStack({ hud: { pauseWhileOpen: false } }));
    assert.equal(presence.isOpen(), false);
  });

  test('a slot written by hand counts before the stack is told', async () => {
    resetHost();
    drainOverlays();
    const presence = await openPresence(page([]));
    const stack = makeWindowStack();
    let slot = null;
    presence.observeStack(stack, () => slot);
    assert.equal(presence.isOpen(), false);
    slot = { draw() {} };
    presence.sample();
    assert.equal(presence.isOpen(), true);
    assert.deepEqual(presence.snapshot().reasons, ['stack']);
    slot = null;
    presence.sample();
    assert.equal(presence.isOpen(), false);
  });

  test('hostPaused alone opens and closes, with no DOM and no adopted stack', async () => {
    drainOverlays();
    let paused = false;
    noteHostInput({ paused: () => paused });
    try {
      const canvas = canvasNode();
      const presence = await openPresence(page([canvas], canvas));
      assert.equal(presence.isOpen(), false);
      paused = true;
      presence.sample();
      assert.equal(presence.isOpen(), true);
      assert.deepEqual(presence.snapshot().reasons, ['hostPaused']);
      assert.equal(presence.snapshot().kind, 'canvas');
      paused = false;
      presence.sample();
      assert.equal(presence.isOpen(), false);
    } finally {
      resetHost();
    }
  });

  test('an HTML overlay registration opens, and unregistering closes', async () => {
    resetHost();
    drainOverlays();
    const presence = await openPresence(page([]));
    const off = registerOverlay(() => {});
    try {
      presence.sample();
      assert.equal(presence.isOpen(), true);
      assert.deepEqual(presence.snapshot().reasons, ['overlay']);
    } finally {
      off();
    }
    presence.sample();
    assert.equal(presence.isOpen(), false);
    assert.equal(overlayOpen(), false);
  });

  test('a fictional menu id that VR code does not name still opens, and removing it closes', async () => {
    resetHost();
    drainOverlays();
    const id = 'festival-2099-host';
    for (const file of jsFiles('src/vr')) {
      assert.equal(readFileSync(file, 'utf8').includes(id), false, file);
    }
    const host = node({ id, rect: { left: 8, top: 8, width: 180, height: 64 } }, [button()]);
    const children = [host];
    const presence = await openPresence(page(children));
    assert.equal(presence.isOpen(), true);
    assert.deepEqual(presence.snapshot().reasons, ['dom']);
    assert.equal(presence.activeElement(), host);
    assert.deepEqual(presence.activeRect(), { x: 8, y: 8, w: 180, h: 64 });
    children.splice(0, 1);
    presence.sample();
    assert.equal(presence.isOpen(), false);
    assert.equal(presence.activeElement(), null);
  });

  test('wyrd-host, which the gamepad prefix misses, is a modal because of its shape', async () => {
    resetHost();
    drainOverlays();
    const host = node({ id: 'wyrd-host', rect: { left: 0, top: 0, width: 320, height: 180 } }, [button()]);
    const presence = await openPresence(page([host]));
    assert.equal(presence.isOpen(), true);
    assert.equal(presence.activeElement().id, 'wyrd-host');
    assert.equal(presence.snapshot().signals.dom, true);
  });

  test('passive layers and a small label stay closed; a large unknown layer opens', async () => {
    resetHost();
    drainOverlays();
    const full = { left: 0, top: 0, width: VIEW.w, height: VIEW.h };
    const hud = node({ className: 'hud', computedStyle: style({ pointerEvents: 'none' }), rect: full });
    const nums = node({ id: 'enhanced-hitnums', computedStyle: style({ pointerEvents: 'none' }), rect: full });
    const feed = node({ id: 'enhanced-pickupfeed', computedStyle: style({ pointerEvents: 'none' }), rect: { left: 400, top: 500, width: 200, height: 40 } });
    const prompts = node({ id: 'plus-pad-prompts', computedStyle: style({ pointerEvents: 'none', zIndex: '39' }), rect: { left: 200, top: 700, width: 400, height: 32 } });
    const notice = node({ id: 'enhanced-notice', className: 'notice-stack', computedStyle: style({ pointerEvents: 'none', zIndex: '31' }), rect: full });
    const label = node({ id: 'quest-hint', rect: { left: 0, top: 0, width: 40, height: 16 } });
    const quiet = await openPresence(page([hud, nums, feed, prompts, notice, label]));
    assert.equal(quiet.isOpen(), false);

    const scrim = node({ id: 'totally-new-layer', rect: full });
    const loud = await openPresence(page([scrim]));
    assert.equal(loud.isOpen(), true);
    assert.deepEqual(loud.snapshot().reasons, ['dom']);
    assert.equal(loud.activeElement(), scrim);
  });

  test('the topmost DOM layer is the active element', async () => {
    resetHost();
    drainOverlays();
    const low = node({ id: 'low', computedStyle: style({ zIndex: '11' }), rect: { left: 0, top: 0, width: 400, height: 300 } }, [button()]);
    const high = node({ id: 'high', computedStyle: style({ zIndex: '40' }), rect: { left: 40, top: 40, width: 200, height: 120 } }, [button()]);
    const presence = await openPresence(page([high, low]));
    assert.equal(presence.activeElement().id, 'high');
    assert.deepEqual(presence.activeRect(), { x: 40, y: 40, w: 200, h: 120 });
  });

  test('VR chrome and the game canvas are not modals', async () => {
    resetHost();
    drainOverlays();
    const canvas = canvasNode();
    const door = node({ id: 'door', vrChrome: true, rect: { left: 800, top: 700, width: 180, height: 64 } }, [button()]);
    const presence = await openPresence(page([canvas, door], canvas));
    assert.equal(presence.isOpen(), false);
  });

  test('a control found by querySelector counts, the same question the walk asks', async () => {
    resetHost();
    drainOverlays();
    const hit = button();
    const host = node({
      id: 'query-host',
      rect: { left: 8, top: 8, width: 120, height: 40 },
      querySelector: () => hit,
    });
    const presence = await openPresence(page([host]));
    assert.equal(presence.isOpen(), true);
    assert.equal(presence.activeElement(), host);
  });

  test('subscribers hear the open and the close, and not a sample that changed nothing', async () => {
    resetHost();
    drainOverlays();
    const canvas = canvasNode();
    const presence = await openPresence(page([canvas], canvas));
    const seen = [];
    presence.subscribe((s) => seen.push(s.open));
    presence.sample();
    const stack = makeWindowStack();
    presence.observeStack(stack);
    stack.pushWindow({ draw() {} });
    presence.sample();
    presence.sample();
    stack.popWindow();
    presence.sample();
    assert.deepEqual(seen, [false, true, false]);
  });
});

test('a reader that throws shows the panel; a missing export does not', async () => {
  const threw = createUiPresence({
    document: page([]), viewport: VIEW, watch: false,
    readers: {
      hostPaused: () => { throw new Error('host down'); },
      overlayOpen: () => ({ status: 'value', value: false }),
      stackModal: () => ({ status: 'value', value: false }),
    },
  });
  await threw.start();
  assert.equal(threw.isOpen(), true);
  assert.ok(threw.snapshot().reasons.includes('uncertain'));

  const missing = createUiPresence({
    document: page([]), viewport: VIEW, watch: false,
    readers: {
      hostPaused: () => ({ status: 'missing' }),
      overlayOpen: () => ({ status: 'missing' }),
      stackModal: () => ({ status: 'value', value: false }),
    },
  });
  await missing.start();
  assert.equal(missing.isOpen(), false);

  const idle = createUiPresence({
    document: page([]), viewport: VIEW, watch: false, readers: idleReaders(),
  });
  await idle.start();
  assert.equal(idle.isOpen(), false);
  assert.equal(idle.snapshot().signals.hostPaused, 'idle');
});

test('an unreadable style still counts as a window', async () => {
  const odd = node({
    id: 'unreadable',
    computedStyle: null,
    rect: { left: 0, top: 0, width: 80, height: 40 },
  });
  const presence = createUiPresence({
    document: page([odd]), viewport: VIEW, watch: false, readers: idleReaders(),
  });
  await presence.start();
  assert.equal(presence.isOpen(), true);
  assert.equal(presence.snapshot().reasons.includes('dom'), true);
});

test('watch polls only when asked, and stop cancels the timer', async () => {
  let ticks = 0;
  let scheduled = 0;
  const cancelled = [];
  let beat = null;
  const presence = createUiPresence({
    document: page([]), viewport: VIEW, watch: true, readers: idleReaders(),
    schedule(fn) { scheduled += 1; beat = fn; return 7; },
    cancel(id) { cancelled.push(id); },
  });
  await presence.start();
  assert.equal(scheduled, 1);
  const seen = [];
  presence.subscribe((s) => seen.push(s.signals.hostPaused));
  const readersOpen = presence;
  // The idle readers stay closed, so a beat does not notify again.
  beat();
  ticks = seen.length;
  assert.equal(ticks, 1);
  readersOpen.stop();
  assert.deepEqual(cancelled, [7]);
  beat();
  assert.equal(seen.length, 1);
});

test('constructing a detector does not start a timer', async () => {
  let scheduled = 0;
  createUiPresence({
    document: page([]), viewport: VIEW, watch: false, readers: idleReaders(),
    schedule() { scheduled += 1; return 1; },
  });
  assert.equal(scheduled, 0);
});
