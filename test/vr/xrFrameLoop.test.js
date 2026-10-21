// VR1: the frame clock. A fake window and a fake XRSession. No WebGL, no
// headset. Enter moves a queued callback onto the session and does not leave
// the window clock running. End puts that callback back on the window clock.
// A throw, a missing pose, and a session that will not arm fall back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createXrFrameClock, eyeViewsOf, createEyeMirror } from '../../src/vr/xrFrameLoop.js';

function fakeWin() {
  let n = 1;
  const pending = new Map();
  const calls = [];
  const requestAnimationFrame = (cb) => {
    const id = n++;
    pending.set(id, cb);
    calls.push('raf');
    return id;
  };
  const cancelAnimationFrame = (id) => {
    calls.push('caf');
    pending.delete(id);
  };
  const win = {
    pending,
    calls,
    requestAnimationFrame,
    cancelAnimationFrame,
    fire(time = 16) {
      const batch = [...pending.entries()];
      pending.clear();
      for (const [, cb] of batch) cb(time);
    },
  };
  return win;
}

function fakeSession() {
  let n = 1;
  const pending = new Map();
  const listeners = { end: [] };
  const session = {
    pending,
    listeners,
    ended: false,
    rafThrows: false,
    requestAnimationFrame(cb) {
      if (session.rafThrows) throw new Error('session clock refused');
      const id = n++;
      pending.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) { pending.delete(id); },
    addEventListener(type, fn, opts) {
      (listeners[type] ??= []).push({ fn, once: opts?.once === true });
    },
    removeEventListener(type, fn) {
      const list = listeners[type];
      if (!list) return;
      const at = list.findIndex((entry) => entry.fn === fn);
      if (at >= 0) list.splice(at, 1);
    },
    end() {
      session.ended = true;
      const list = (listeners.end || []).splice(0);
      for (const entry of list) entry.fn();
    },
    fire(time, frame) {
      const batch = [...pending.entries()];
      pending.clear();
      for (const [, cb] of batch) cb(time, frame);
    },
  };
  return session;
}

function eyes(n = 2) {
  const views = [];
  for (let i = 0; i < n; i++) views.push({ x: i * 10, y: 0, width: 10, height: 8 });
  return views;
}

function opened(session, n = 2) {
  const viewports = eyes(n);
  const layer = {
    framebuffer: { id: 'fb' },
    getViewport(view) { return view.vp; },
  };
  const frame = {
    getViewerPose() {
      return { views: viewports.map((vp, i) => ({ eye: i, vp })) };
    },
  };
  return { session, layer, refSpace: { kind: 'local-floor' }, frame, viewports };
}

test('eyeViewsOf reads each viewport and gives up when the pose throws', () => {
  const viewports = eyes(2);
  const layer = { getViewport(view) { return view.vp; } };
  const frame = { getViewerPose() { return { views: viewports.map((vp) => ({ vp })) }; } };
  assert.deepEqual(eyeViewsOf(frame, {}, layer), viewports);
  assert.equal(eyeViewsOf({ getViewerPose() { throw new Error('lost'); } }, {}, layer), null);
  assert.equal(eyeViewsOf({ getViewerPose() { return null; } }, {}, layer), null);
  assert.equal(eyeViewsOf(frame, {}, {}), null);
});

test('install swaps the clock, engage runs the queued callback once on the session, end restores the window', () => {
  const win = fakeWin();
  const original = win.requestAnimationFrame;
  const stamps = [];
  const targets = [];
  const mirrors = [];
  const clock = createXrFrameClock({
    win,
    setTarget(fb, vp) { targets.push({ fb, vp }); return true; },
    mirror(layer, views) { mirrors.push({ fb: layer.framebuffer, n: views.length }); return true; },
  });
  assert.equal(clock.install(), true);
  assert.equal(clock.install(), true, 'a second install does not wrap the wrapper');
  assert.notEqual(win.requestAnimationFrame, original);
  win.requestAnimationFrame((t) => {
    stamps.push(t);
    win.requestAnimationFrame(() => {
      stamps.push('again');
      win.requestAnimationFrame(() => stamps.push('restored'));
    });
  });
  assert.equal(win.pending.size, 1);
  const session = fakeSession();
  const bag = opened(session, 2);
  assert.equal(clock.engage(bag), true);
  assert.equal(clock.presenting, true);
  assert.equal(win.pending.size, 0);
  assert.equal(session.pending.size, 1);
  assert.equal(session.listeners.end.length, 1);
  session.fire(72, bag.frame);
  assert.deepEqual(stamps, [72]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].fb, bag.layer.framebuffer);
  assert.deepEqual(targets[0].vp, bag.viewports[0]);
  assert.equal(mirrors.length, 1);
  assert.equal(mirrors[0].n, 2);
  assert.equal(session.pending.size, 1, 'one re-arm on the session');
  assert.equal(win.pending.size, 0, 'the window clock is not also armed');
  session.fire(90, bag.frame);
  assert.deepEqual(stamps, [72, 'again']);
  assert.equal(session.pending.size, 1, 'the callback queued during the session frame is still on the session');
  assert.equal(win.calls.filter((c) => c === 'raf').length, 1, 'only the pre-session window request was made');
  session.end();
  assert.equal(clock.presenting, false);
  assert.equal(session.listeners.end.length, 0);
  assert.equal(session.pending.size, 0);
  assert.equal(targets.at(-1).fb, null, 'the headset target is cleared');
  assert.equal(win.pending.size, 1, 'the frame that was still queued moved onto the window clock');
  win.fire(100);
  assert.deepEqual(stamps, [72, 'again', 'restored']);
  assert.equal(session.pending.size, 0, 'the restored frame did not also schedule the session');
  clock.uninstall();
  assert.equal(win.requestAnimationFrame, original);
  assert.equal(win.cancelAnimationFrame.name, original && 'cancelAnimationFrame' ? win.cancelAnimationFrame.name : '');
});

test('uninstall restores the exact requestAnimationFrame and flushes a queued callback onto it', () => {
  const win = fakeWin();
  const original = win.requestAnimationFrame;
  const cancel = win.cancelAnimationFrame;
  const clock = createXrFrameClock({ win });
  clock.install();
  let ran = 0;
  win.requestAnimationFrame(() => { ran += 1; });
  assert.equal(win.pending.size, 1);
  clock.uninstall();
  assert.equal(win.requestAnimationFrame, original);
  assert.equal(win.cancelAnimationFrame, cancel);
  assert.equal(win.__xrFrameClock, undefined);
  assert.equal(ran, 0);
  assert.equal(win.pending.size, 1, 'the queued callback was handed to the original clock, not dropped');
  win.fire(5);
  assert.equal(ran, 1);
});

test('cancel drops a queued callback and does not fire it on the session', () => {
  const win = fakeWin();
  const clock = createXrFrameClock({ win, setTarget() { return true; } });
  clock.install();
  const ran = [];
  const drop = win.requestAnimationFrame(() => ran.push('drop'));
  win.requestAnimationFrame(() => ran.push('keep'));
  win.cancelAnimationFrame(drop);
  const session = fakeSession();
  const bag = opened(session, 1);
  clock.engage(bag);
  session.fire(3, bag.frame);
  assert.deepEqual(ran, ['keep']);
});

test('a callback that throws does not skip the next callback or the re-arm', () => {
  const win = fakeWin();
  const errors = [];
  const clock = createXrFrameClock({
    win,
    setTarget() { return true; },
    report(err) { errors.push(err.message); },
  });
  clock.install();
  const ran = [];
  win.requestAnimationFrame(() => { throw new Error('boom'); });
  win.requestAnimationFrame(() => {
    ran.push('second');
    win.requestAnimationFrame(() => ran.push('third'));
  });
  const session = fakeSession();
  const bag = opened(session, 1);
  clock.engage(bag);
  assert.doesNotThrow(() => session.fire(4, bag.frame));
  assert.deepEqual(ran, ['second']);
  assert.deepEqual(errors, ['boom']);
  assert.equal(session.pending.size, 1);
  assert.equal(clock.presenting, true);
});

test('a session clock that throws on engage falls back to the window and does not leak the end listener', () => {
  const win = fakeWin();
  const clock = createXrFrameClock({ win, setTarget() { return true; } });
  clock.install();
  let ran = 0;
  win.requestAnimationFrame(() => { ran += 1; });
  const session = fakeSession();
  session.rafThrows = true;
  const bag = opened(session, 1);
  assert.equal(clock.engage(bag), false);
  assert.equal(clock.presenting, false);
  assert.equal(session.listeners.end.length, 0);
  assert.equal(session.pending.size, 0);
  assert.equal(ran, 0);
  win.fire(8);
  assert.equal(ran, 1);
});

test('a missing pose still runs the callback, clears the target, and does not throw', () => {
  const win = fakeWin();
  const targets = [];
  const clock = createXrFrameClock({
    win,
    setTarget(fb, vp) { targets.push(fb ? vp : null); return true; },
  });
  clock.install();
  let ran = 0;
  win.requestAnimationFrame(() => { ran += 1; });
  const session = fakeSession();
  const bag = opened(session, 1);
  bag.frame.getViewerPose = () => { throw new Error('no pose'); };
  clock.engage(bag);
  assert.doesNotThrow(() => session.fire(9, bag.frame));
  assert.equal(ran, 1);
  assert.deepEqual(targets, [null]);
  assert.equal(clock.presenting, true);
});

test('a target that refuses the eye asks the caller once and the window clock is back', () => {
  const win = fakeWin();
  let fails = 0;
  let ends = 0;
  const clock = createXrFrameClock({
    win,
    setTarget() { return false; },
    onPresentFail() { fails += 1; },
    onDisengage() { ends += 1; },
  });
  clock.install();
  let ran = 0;
  win.requestAnimationFrame(() => { ran += 1; win.requestAnimationFrame(() => { ran += 10; }); });
  const session = fakeSession();
  const bag = opened(session, 1);
  clock.engage(bag);
  session.fire(11, bag.frame);
  assert.equal(ran, 1);
  assert.equal(fails, 1);
  assert.equal(clock.presenting, true, 'ending the session is the caller; the clock stays until end');
  session.fire(12, bag.frame);
  assert.equal(fails, 1, 'a refused target is reported once');
  session.end();
  assert.equal(ends, 1);
  assert.equal(clock.presenting, false);
  win.fire(13);
  assert.equal(ran, 11);
});

test('session end inside a callback does not mirror and the reschedule lands on the window', () => {
  const win = fakeWin();
  const mirrors = [];
  const clock = createXrFrameClock({
    win,
    setTarget() { return true; },
    mirror() { mirrors.push(1); return true; },
  });
  clock.install();
  let ran = 0;
  const session = fakeSession();
  const bag = opened(session, 2);
  win.requestAnimationFrame(() => {
    ran += 1;
    session.end();
    win.requestAnimationFrame(() => { ran += 10; });
  });
  clock.engage(bag);
  session.fire(15, bag.frame);
  assert.equal(ran, 1);
  assert.deepEqual(mirrors, [], 'a session that ended during the callback is not copied after');
  assert.equal(clock.presenting, false);
  assert.equal(session.listeners.end.length, 0);
  assert.equal(win.pending.size, 1);
  win.fire(16);
  assert.equal(ran, 11);
  assert.equal(session.pending.size, 0);
});

test('a second engage after end does not leak listeners or arm two clocks', () => {
  const win = fakeWin();
  const clock = createXrFrameClock({ win, setTarget() { return true; } });
  clock.install();
  let n = 0;
  const loop = () => { n += 1; win.requestAnimationFrame(loop); };
  win.requestAnimationFrame(loop);
  const first = fakeSession();
  const bag = opened(first, 1);
  clock.engage(bag);
  first.fire(1, bag.frame);
  first.end();
  const second = fakeSession();
  const bag2 = opened(second, 1);
  assert.equal(clock.engage(bag2), true);
  assert.equal(first.listeners.end.length, 0);
  assert.equal(second.listeners.end.length, 1);
  assert.equal(win.pending.size, 0);
  assert.equal(second.pending.size, 1);
  second.fire(2, bag2.frame);
  assert.equal(n, 2);
  assert.equal(second.pending.size, 1);
  assert.equal(win.pending.size, 0);
});

test('createEyeMirror copies eye 0 into the other eye and restores the program', () => {
  const gl = fakeGl();
  const mirror = createEyeMirror(gl);
  const layer = { framebuffer: { id: 'xr' } };
  const views = eyes(2);
  assert.equal(mirror.copy(layer, views), true);
  assert.equal(gl.calls.filter((c) => c[0] === 'blit').length, 1);
  assert.equal(gl.calls.filter((c) => c[0] === 'draw').length, 1);
  const lastProg = [...gl.calls].reverse().find((c) => c[0] === 'prog');
  assert.equal(lastProg[1], null, 'the game program is bound again');
  assert.equal(mirror.copy(layer, [views[0]]), false);
  mirror.release();
  assert.equal(mirror.copy(layer, views), true, 'release lets the next session build the copy again');
});

test('createEyeMirror returns false when the context cannot blit and when the shader will not compile', () => {
  assert.equal(createEyeMirror(null).copy({ framebuffer: {} }, eyes(2)), false);
  const gl = fakeGl();
  gl.getShaderParameter = () => false;
  assert.equal(createEyeMirror(gl).copy({ framebuffer: { id: 'x' } }, eyes(2)), false);
  const boom = fakeGl();
  boom.blitFramebuffer = () => { throw new Error('incomplete'); };
  assert.equal(createEyeMirror(boom).copy({ framebuffer: { id: 'x' } }, eyes(2)), false);
});

function fakeGl() {
  const calls = [];
  const gl = {
    COLOR_BUFFER_BIT: 1,
    NEAREST: 2,
    CLAMP_TO_EDGE: 3,
    TEXTURE_2D: 4,
    TEXTURE_MIN_FILTER: 5,
    TEXTURE_MAG_FILTER: 6,
    TEXTURE_WRAP_S: 7,
    TEXTURE_WRAP_T: 8,
    RGBA: 9,
    UNSIGNED_BYTE: 10,
    FRAMEBUFFER: 11,
    READ_FRAMEBUFFER: 12,
    DRAW_FRAMEBUFFER: 13,
    COLOR_ATTACHMENT0: 14,
    FRAMEBUFFER_COMPLETE: 15,
    VIEWPORT: 16,
    SCISSOR_BOX: 17,
    SCISSOR_TEST: 18,
    DEPTH_TEST: 19,
    BLEND: 20,
    CULL_FACE: 21,
    CURRENT_PROGRAM: 22,
    VERTEX_ARRAY_BINDING: 23,
    ARRAY_BUFFER: 24,
    ARRAY_BUFFER_BINDING: 25,
    ACTIVE_TEXTURE: 26,
    TEXTURE0: 27,
    TEXTURE_BINDING_2D: 28,
    DRAW_FRAMEBUFFER_BINDING: 29,
    READ_FRAMEBUFFER_BINDING: 30,
    VERTEX_SHADER: 31,
    FRAGMENT_SHADER: 32,
    COMPILE_STATUS: 33,
    LINK_STATUS: 34,
    FLOAT: 35,
    TRIANGLE_STRIP: 36,
    STATIC_DRAW: 37,
    calls,
    getParameter(p) {
      if (p === gl.VIEWPORT || p === gl.SCISSOR_BOX) return [0, 0, 4, 4];
      if (p === gl.ACTIVE_TEXTURE) return gl.TEXTURE0;
      return null;
    },
    isEnabled() { return false; },
    createTexture() { return { t: 1 }; },
    createFramebuffer() { return { f: 1 }; },
    createShader() { return { s: 1 }; },
    createProgram() { return { p: 1 }; },
    createBuffer() { return { b: 1 }; },
    createVertexArray() { return { v: 1 }; },
    shaderSource() {},
    compileShader() {},
    getShaderParameter() { return true; },
    attachShader() {},
    linkProgram() {},
    getProgramParameter() { return true; },
    deleteShader() {},
    deleteTexture() {},
    deleteFramebuffer() {},
    deleteProgram() {},
    deleteBuffer() {},
    deleteVertexArray() {},
    bindTexture() {},
    texParameteri() {},
    texImage2D() {},
    bindFramebuffer() {},
    framebufferTexture2D() {},
    checkFramebufferStatus() { return gl.FRAMEBUFFER_COMPLETE; },
    blitFramebuffer(...args) { calls.push(['blit', ...args]); },
    viewport() {},
    scissor() {},
    disable() {},
    enable() {},
    useProgram(p) { calls.push(['prog', p]); },
    bindVertexArray() {},
    bindBuffer() {},
    bufferData() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    uniform1i() {},
    getUniformLocation() { return { u: 1 }; },
    drawArrays(...args) { calls.push(['draw', ...args]); },
    activeTexture() {},
  };
  return gl;
}
