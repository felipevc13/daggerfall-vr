// VR1: the /play/?vr plug. No headset, no WebGL, no ARENA2. The gates are a
// missing WebXR device, missing engine hooks, a page with no frame clock, and
// a supported device whose Enter VR press keeps the session and moves the
// frame clock onto it. End puts the window clock back. A failure resolves;
// it does not reject.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installVr } from '../../src/vr/installVr.js';
import { relayVrLog } from '../../src/vr/xrLog.js';

/** @type {Promise<void>} */
let turn = Promise.resolve();
function alone(name, fn) {
  test(name, async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const wait = turn;
    turn = gate;
    await wait;
    try { await fn(); } finally { release(); }
  });
}

function fakeWin() {
  let n = 1;
  const pending = new Map();
  const requestAnimationFrame = (cb) => {
    const id = n++;
    pending.set(id, cb);
    return id;
  };
  const cancelAnimationFrame = (id) => pending.delete(id);
  return {
    pending,
    requestAnimationFrame,
    cancelAnimationFrame,
    fire(time = 16) {
      const batch = [...pending.entries()];
      pending.clear();
      for (const [, cb] of batch) cb(time);
    },
  };
}

function fakeDoc() {
  const kids = [];
  return {
    kids,
    body: { appendChild(el) { kids.push(el); } },
    createElement() {
      return {
        type: '',
        textContent: '',
        disabled: false,
        style: {},
        attrs: {},
        listeners: {},
        setAttribute(name, value) { this.attrs[name] = String(value); },
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
        addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
      };
    },
  };
}

function stubGlobals({ xr, fetchFn, XRWebGLLayer }) {
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const prevFetch = globalThis.fetch;
  const prevLayer = globalThis.XRWebGLLayer;
  const prevLog = console.log;
  const prevWarn = console.warn;
  const logs = [];
  const warns = [];
  console.log = (...args) => { logs.push(args.map(String).join(' ')); };
  console.warn = (...args) => { warns.push(args.map(String).join(' ')); };
  if (fetchFn) globalThis.fetch = fetchFn;
  if (XRWebGLLayer) globalThis.XRWebGLLayer = XRWebGLLayer;
  if (xr) Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { xr } });
  return {
    logs,
    warns,
    restore() {
      console.log = prevLog;
      console.warn = prevWarn;
      globalThis.fetch = prevFetch;
      globalThis.XRWebGLLayer = prevLayer;
      if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav);
      else delete globalThis.navigator;
    },
  };
}

alone('without WebXR, installVr mounts nothing and does not throw', async () => {
  const env = stubGlobals({});
  const doc = fakeDoc();
  try {
    const result = await installVr({ gl: { makeXRCompatible() {} } }, { doc });
    assert.deepEqual(result, { mounted: false, reason: 'unsupported' });
    assert.deepEqual(doc.kids, []);
    assert.deepEqual(env.warns, []);
  } finally { env.restore(); }
});

alone('missing engine hooks skip the headset check and the button', async () => {
  let supported = 0;
  let buttons = 0;
  const notes = [];
  const doc = fakeDoc();
  const result = await installVr({ gl: {} }, {
    doc,
    probeVrEngineHooks: async () => ({ ok: false, missing: ['Renderer.setXrTarget'] }),
    immersiveVrSupported: async () => { supported += 1; return true; },
    makeEnterVrButton: async () => { buttons += 1; return { style: {} }; },
    relayVrLog: (level, message) => { notes.push({ level, message }); return message; },
  });
  assert.equal(result.mounted, false);
  assert.equal(result.reason, 'hooks');
  assert.deepEqual(result.missing, ['Renderer.setXrTarget']);
  assert.equal(supported, 0);
  assert.equal(buttons, 0);
  assert.deepEqual(doc.kids, []);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].level, 'warn');
  assert.match(notes[0].message, /Renderer\.setXrTarget/);
});

alone('a probe that throws resolves as hooks-missing', async () => {
  const result = await installVr({ gl: {} }, {
    doc: fakeDoc(),
    probeVrEngineHooks: async () => { throw new Error('probe down'); },
    relayVrLog: (_level, message) => message,
  });
  assert.equal(result.mounted, false);
  assert.equal(result.reason, 'hooks');
  assert.deepEqual(result.missing, []);
});

alone('a supported headset keeps the session, runs the queued frame on it, and Exit restores the window clock', async () => {
  const posts = [];
  const listeners = { end: [] };
  const xrPending = new Map();
  let xrNext = 1;
  const targets = [];
  const session = {
    ended: false,
    listeners,
    xrPending,
    updateRenderState(state) { session.renderState = state; },
    requestReferenceSpace: async () => ({ kind: 'local-floor' }),
    requestAnimationFrame(cb) {
      const id = xrNext++;
      xrPending.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) { xrPending.delete(id); },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) {
      const list = listeners[type];
      if (!list) return;
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    end() {
      session.ended = true;
      const list = (listeners.end || []).splice(0);
      for (const fn of list) fn();
      return Promise.resolve();
    },
    fire(time = 40) {
      const frame = {
        getViewerPose() {
          return { views: [{ eye: 'left', vp: { x: 0, y: 0, width: 8, height: 8 } }, { eye: 'right', vp: { x: 8, y: 0, width: 8, height: 8 } }] };
        },
      };
      const batch = [...xrPending.entries()];
      xrPending.clear();
      for (const [, cb] of batch) cb(time, frame);
    },
  };
  let requested = null;
  const env = stubGlobals({
    xr: {
      isSessionSupported: async (mode) => mode === 'immersive-vr',
      requestSession: async (mode, init) => { requested = { mode, init }; return session; },
    },
    fetchFn: async (url, init) => { posts.push({ url, body: init?.body }); return { ok: true }; },
    XRWebGLLayer: class {
      constructor() {
        this.framebuffer = { id: 'xr' };
        this.framebufferWidth = 16;
        this.framebufferHeight = 8;
      }
      getViewport(view) { return view.vp; }
    },
  });
  const doc = fakeDoc();
  const win = fakeWin();
  const gl = { canvas: {}, makeXRCompatible: async () => { gl.ready = true; } };
  const renderer = {
    gl,
    canvas: gl.canvas,
    setXrTarget(fb, vp) { targets.push({ fb, vp }); },
  };
  try {
    const result = await installVr(renderer, { doc, win });
    assert.equal(result.reason, 'ready');
    assert.equal(result.mounted, true);
    assert.equal(doc.kids.length, 2);
    assert.equal(doc.kids[0].textContent, 'Enter VR');
    assert.equal(doc.kids[0].getAttribute('data-vr-chrome'), '');
    assert.equal(doc.kids[0].style.display, 'none');
    assert.equal(doc.kids[1].hidden, false);
    assert.equal(doc.kids[1].getAttribute('data-vr-loading'), '');
    assert.match(doc.kids[0].style.cssText, /top:38%/);
    assert.match(doc.kids[0].style.cssText, /right:16px/);
    assert.match(doc.kids[0].style.cssText, /pointer-events:auto/);
    assert.doesNotMatch(doc.kids[0].style.cssText, /bottom:/);
    const stamps = [];
    win.requestAnimationFrame((t) => {
      stamps.push(t);
      win.requestAnimationFrame(() => { stamps.push('next'); });
    });
    assert.equal(win.pending.size, 1, 'before Enter VR the frame waits on the window clock');
    await doc.kids[0].listeners.click[0]();
    assert.equal(requested.mode, 'immersive-vr');
    assert.equal(gl.ready, true);
    assert.equal(session.ended, false);
    assert.equal(win.pending.size, 0, 'the window frame was cancelled, not left running beside the session');
    assert.equal(session.xrPending.size, 1);
    assert.equal(doc.kids[0].textContent, 'Exit');
    assert.equal(doc.kids[0].disabled, false);
    assert.equal(doc.kids[0].style.display, '');
    assert.equal(doc.kids[1].hidden, true);
    assert.match(env.logs.join('\n'), /VR frame loop is on the headset\. The dungeon draws each eye\. Other places still share one picture\./);
    assert.match(posts[0].body, /The dungeon draws each eye/);
    assert.equal(session.renderState.depthNear, 0.05);
    assert.equal(session.renderState.depthFar, 800);
    assert.equal(JSON.parse(posts[0].body).level, 'info');
    session.fire(40);
    assert.deepEqual(stamps, [40]);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].fb.id, 'xr');
    assert.equal(targets[0].vp.width, 8);
    assert.equal(targets[0].vp.x, 0);
    assert.equal(session.xrPending.size, 1, 'the host re-armed once, on the session');
    assert.equal(win.pending.size, 0);
    await doc.kids[0].listeners.click[0]();
    assert.equal(session.ended, true);
    assert.equal(session.listeners.end.length, 0);
    assert.equal(session.xrPending.size, 0);
    assert.equal(doc.kids[0].textContent, 'Enter VR');
    assert.equal(doc.kids[0].disabled, false);
    assert.match(env.logs.join('\n'), /The window frame loop is back/);
    assert.equal(win.pending.size, 1, 'the queued host frame moved back onto the window clock');
    win.fire(50);
    assert.deepEqual(stamps, [40, 'next']);
    assert.equal(session.xrPending.size, 0, 'the restored frame did not also schedule the session');
    assert.equal(globalThis.window?.__vrLoggerInstalled, undefined);
  } finally { env.restore(); }
});

alone('a page with no frame clock does not mount the button', async () => {
  let buttons = 0;
  const result = await installVr({ gl: {}, canvas: {} }, {
    doc: fakeDoc(),
    win: {},
    probeVrEngineHooks: async () => ({ ok: true, missing: [] }),
    immersiveVrSupported: async () => true,
    makeEnterVrButton: async () => { buttons += 1; return { style: {} }; },
    relayVrLog: (_level, message) => message,
  });
  assert.equal(result.mounted, false);
  assert.equal(result.reason, 'no-clock');
  assert.equal(buttons, 0);
});

alone('a clock that will not engage ends the session and leaves the button usable', async () => {
  const session = { ended: false, end() { session.ended = true; } };
  const notes = [];
  const doc = fakeDoc();
  const result = await installVr({ gl: {} }, {
    doc,
    probeVrEngineHooks: async () => ({ ok: true, missing: [] }),
    immersiveVrSupported: async () => true,
    relayVrLog: (level, message) => { notes.push({ level, message }); return message; },
    createXrFrameClock: () => ({ install: () => true, uninstall() {}, engage: () => false }),
    makeEnterVrButton: async ({ onEnter }) => {
      const button = doc.createElement();
      button.addEventListener('click', () => onEnter({ session }));
      return button;
    },
  });
  assert.equal(result.mounted, true);
  await doc.kids[0].listeners.click[0]();
  assert.equal(session.ended, true);
  assert.equal(notes.some((n) => n.level === 'warn' && /frame loop failed/.test(n.message)), true);
});

alone('a refused session is reported and does not reject the plug', async () => {
  const env = stubGlobals({
    xr: {
      isSessionSupported: async () => true,
      requestSession: async () => { throw new Error('user dismissed'); },
    },
    fetchFn: async () => { throw new Error('no dev server'); },
    XRWebGLLayer: class {},
  });
  const doc = fakeDoc();
  const win = fakeWin();
  try {
    const result = await installVr({ gl: { makeXRCompatible: async () => {} } }, { doc, win });
    assert.equal(result.mounted, true);
    await doc.kids[0].listeners.click[0]();
    assert.equal(doc.kids[0].disabled, false);
    assert.match(env.warns.join('\n'), /user dismissed/);
  } finally { env.restore(); }
});

test('relayVrLog posts one line and does not install the shot-gated console hook', async () => {
  const posts = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => { posts.push({ url, body: init.body }); return { ok: true }; };
  try {
    const text = relayVrLog('info', 'one line');
    assert.equal(text, 'one line');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, '/api/vr-log');
    assert.equal(globalThis.window, undefined);
    globalThis.window = { __vrLoggerInstalled: true };
    const again = relayVrLog('info', 'already hooked');
    assert.equal(again, 'already hooked');
    assert.equal(posts.length, 1, 'the console hook would forward this line; relay must not send it twice');
  } finally {
    delete globalThis.window;
    globalThis.fetch = prev;
  }
});

test('relayVrLog ignores a fetch that rejects', async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    assert.equal(relayVrLog('warn', 'still here'), 'still here');
    globalThis.fetch = () => Promise.reject(new Error('later'));
    assert.equal(relayVrLog('warn', 'still here'), 'still here');
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally { globalThis.fetch = prev; }
});
