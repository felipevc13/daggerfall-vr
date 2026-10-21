// VR1: the /play/?vr plug. No headset, no WebGL, no ARENA2. The three gates
// are a missing WebXR device, missing engine hooks, and a supported device
// whose Enter VR press opens a session, logs that the frame loop is absent,
// and ends the session. A failure resolves; it does not reject.
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
        listeners: {},
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

alone('a supported headset gets Enter VR, and the press logs the missing frame loop and ends the session', async () => {
  const posts = [];
  const session = {
    ended: false,
    updateRenderState() {},
    requestReferenceSpace: async () => ({ kind: 'local-floor' }),
    end: async () => { session.ended = true; },
  };
  let requested = null;
  const env = stubGlobals({
    xr: {
      isSessionSupported: async (mode) => mode === 'immersive-vr',
      requestSession: async (mode, init) => { requested = { mode, init }; return session; },
    },
    fetchFn: async (url, init) => { posts.push({ url, body: init?.body }); return { ok: true }; },
    XRWebGLLayer: class {
      constructor() { this.framebufferWidth = 2; this.framebufferHeight = 2; }
    },
  });
  const doc = fakeDoc();
  const gl = { canvas: {}, makeXRCompatible: async () => { gl.ready = true; } };
  try {
    const result = await installVr({ gl, canvas: gl.canvas }, { doc });
    assert.equal(result.reason, 'ready');
    assert.equal(result.mounted, true);
    assert.equal(doc.kids.length, 1);
    assert.equal(doc.kids[0].textContent, 'Enter VR');
    await doc.kids[0].listeners.click[0]();
    assert.equal(requested.mode, 'immersive-vr');
    assert.equal(gl.ready, true);
    assert.equal(session.ended, true);
    assert.match(env.logs.join('\n'), /The frame loop is not wired yet\. Ending the session\./);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, '/api/vr-log');
    assert.match(posts[0].body, /frame loop is not wired yet/);
    assert.equal(JSON.parse(posts[0].body).level, 'info');
    assert.equal(doc.kids[0].disabled, false);
    assert.equal(doc.kids[0].style.display, '');
    assert.equal(globalThis.window?.__vrLoggerInstalled, undefined);
  } finally { env.restore(); }
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
  try {
    const result = await installVr({ gl: { makeXRCompatible: async () => {} } }, { doc });
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
