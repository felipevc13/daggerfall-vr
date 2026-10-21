// VR1: the dungeon's two eyes. A fake XR frame with two views. No WebGL,
// no headset. Each eye is aimed and gets its own projection. The sim
// callback runs on eye 0 only. A missing seam paints once and the clock
// still copies. Session end drops the captured head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDungeonStereo, GAME_UNIT_IN_METERS, DUNGEON_NEAR, DUNGEON_FAR } from '../../src/vr/dungeonStereo.js';
import { readVrEyeDebug } from '../../src/vr/engineBridge.js';
import { headsetDeltaView } from '../../src/vr/xrCamera.js';
import { createXrFrameClock } from '../../src/vr/xrFrameLoop.js';
import { paintDungeonEyes } from '../../src/scenes/dungeonEyeHost.js';

const read = (p) => readFileSync(p, 'utf8');

function pose(x, y, z) {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function projOf(scale) {
  const m = new Float32Array(16);
  m[0] = scale; m[5] = 2; m[10] = -1; m[11] = -1; m[14] = -0.2;
  return m;
}

function eyes({ headY = 1.65, session = { id: 's' } } = {}) {
  const head = [0.2, headY, -0.4];
  const views = [
    { transform: { matrix: pose(-0.032, headY, -0.4) }, projectionMatrix: projOf(1), vp: { x: 0, y: 0, width: 100, height: 80 } },
    { transform: { matrix: pose(0.032, headY, -0.4) }, projectionMatrix: projOf(3), vp: { x: 100, y: 0, width: 100, height: 80 } },
  ];
  return {
    framebuffer: { id: 'fb' },
    head,
    session,
    views: views.map((view) => ({ view, x: view.vp.x, y: view.vp.y, width: view.vp.width, height: view.vp.height })),
  };
}

function clockFor(pack, setTarget, extras = {}) {
  return {
    claimed: false,
    eyePack: () => pack,
    claimStereo() { this.claimed = true; },
    ...extras,
  };
}

const camera = { proj: 'flat-proj', view: 'flat-view', eye: [10, 1.7, -4], yaw: 0 };

test('one game metre is one headset metre', () => {
  assert.equal(GAME_UNIT_IN_METERS, 1);
  const view = { transform: { matrix: pose(0, 1.65, 0) }, projectionMatrix: projOf(1) };
  const still = headsetDeltaView(view, [0, 1.65, 0.25], 2);
  assert.ok(Math.abs(still.transform.matrix[14] - (0 - 0.25) * 2) < 1e-9);
  const unit = headsetDeltaView(view, [0, 1.65, 0.25]);
  assert.ok(Math.abs(unit.transform.matrix[14] - (0 - 0.25) * GAME_UNIT_IN_METERS) < 1e-9);
});

test('two eyes get their own target and projection, and the head stays on the game eye', () => {
  const targets = [];
  const shots = [];
  let sim = 0;
  const pack = eyes();
  const stereo = createDungeonStereo((fb, vp) => { targets.push({ fb, vp }); return true; });
  const clock = clockFor(pack);
  const ok = stereo.paint(clock, (shot) => {
    shots.push(shot);
    if (shot.index === 0) sim += 1;
  }, camera);
  assert.equal(ok, true);
  assert.equal(clock.claimed, true);
  assert.equal(sim, 1);
  assert.deepEqual(shots.map((s) => s.index), [0, 1]);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].fb, pack.framebuffer);
  assert.deepEqual(targets[0].vp, { x: 0, y: 0, width: 100, height: 80 });
  assert.deepEqual(targets[1].vp, { x: 100, y: 0, width: 100, height: 80 });
  assert.equal(shots[0].proj[0], -1);
  assert.equal(shots[1].proj[0], -3);
  assert.ok(Math.abs(shots[0].eye[1] - 1.7) < 1e-6, shots[0].eye[1]);
  assert.ok(Math.abs(shots[1].eye[1] - 1.7) < 1e-6, shots[1].eye[1]);
  const gap = shots[1].eye[0] - shots[0].eye[0];
  assert.ok(Math.abs(gap - 0.064) < 1e-6, gap);
  assert.equal(DUNGEON_NEAR, 0.05);
  assert.equal(DUNGEON_FAR, 800);
});

test('ipd=0 parks both eyes on the head, and swapeyes exchanges poses not rects', () => {
  assert.deepEqual(readVrEyeDebug('?dungeon&class=16&vr&ipd=0'), { zeroIpd: true, swapEyes: false });
  assert.deepEqual(readVrEyeDebug('?dungeon&class=16&vr&swapeyes'), { zeroIpd: false, swapEyes: true });
  assert.deepEqual(readVrEyeDebug('?dungeon&class=16&vr&ipd=0&swapeyes'), { zeroIpd: true, swapEyes: true });
  assert.deepEqual(readVrEyeDebug('?dungeon&class=16'), { zeroIpd: false, swapEyes: false });
  assert.deepEqual(readVrEyeDebug('?vr&ipd=1'), { zeroIpd: false, swapEyes: false });
  assert.equal(read('src/main.js').includes('swapeyes'), false);
  assert.equal(read('src/main.js').includes('readVrEyeDebug'), false);
  assert.match(read('src/vr/engineBridge.js'), /pageParam\('ipd'/);
  assert.match(read('src/vr/engineBridge.js'), /pageHas\('swapeyes'/);
  assert.match(read('src/vr/dungeonStereo.js'), /readVrEyeDebug/);

  const pack = eyes();
  const centre = createDungeonStereo(() => true, () => ({ zeroIpd: true, swapEyes: false }));
  const centred = [];
  assert.equal(centre.paint(clockFor(pack), (shot) => centred.push(shot), camera), true);
  assert.ok(Math.abs(centred[0].eye[0] - camera.eye[0]) < 1e-6, centred[0].eye[0]);
  assert.ok(Math.abs(centred[1].eye[0] - camera.eye[0]) < 1e-6, centred[1].eye[0]);
  assert.ok(Math.abs(centred[0].eye[1] - camera.eye[1]) < 1e-6);
  assert.ok(Math.abs(centred[1].eye[2] - camera.eye[2]) < 1e-6);
  assert.equal(centred[0].proj[0], -1);
  assert.equal(centred[1].proj[0], -3);
  assert.deepEqual(centred[0].vp, { x: 0, y: 0, width: 100, height: 80 });
  assert.deepEqual(centred[1].vp, { x: 100, y: 0, width: 100, height: 80 });

  const swapped = [];
  const targets = [];
  const swap = createDungeonStereo((fb, vp) => { targets.push(vp); return true; }, () => ({ zeroIpd: false, swapEyes: true }));
  assert.equal(swap.paint(clockFor(pack), (shot) => swapped.push(shot), camera), true);
  assert.equal(swapped[0].proj[0], -3);
  assert.equal(swapped[1].proj[0], -1);
  assert.ok(swapped[0].eye[0] > swapped[1].eye[0]);
  assert.deepEqual(targets[0], { x: 0, y: 0, width: 100, height: 80 });
  assert.deepEqual(targets[1], { x: 100, y: 0, width: 100, height: 80 });
  assert.deepEqual(swapped[0].vp, targets[0]);
  assert.deepEqual(swapped[1].vp, targets[1]);
});

test('a missing seam paints once and the clock still copies', () => {
  const win = fakeWin();
  const mirrors = [];
  const paints = [];
  const clock = createXrFrameClock({
    win,
    setTarget() { return true; },
    mirror(_layer, views) { mirrors.push(views.length); return true; },
  });
  clock.install();
  const session = fakeSession();
  const opened = open(session);
  clock.engage(opened);
  win.requestAnimationFrame(() => {
    paints.push(paintDungeonEyes((shot) => { paints.push(shot.index); }, camera));
  });
  session.fire(10, opened.frame);
  assert.deepEqual(paints, [0, false]);
  assert.deepEqual(mirrors, [2]);
  clock.uninstall();
});

test('a seam that cannot see the head paints the flat camera once', () => {
  globalThis.__xrFrameClock = { dungeonEyes: () => false };
  try {
    const seen = [];
    const ok = paintDungeonEyes((shot) => seen.push(shot.index), camera);
    assert.equal(ok, false);
    assert.deepEqual(seen, [0]);
  } finally {
    delete globalThis.__xrFrameClock;
  }
});

test('a seam that already drew does not paint the flat camera again', () => {
  globalThis.__xrFrameClock = {
    dungeonEyes(draw) { draw({ index: 0, proj: 'L', view: 'L' }); return false; },
  };
  try {
    const seen = [];
    assert.equal(paintDungeonEyes((shot) => seen.push(shot.proj), camera), false);
    assert.deepEqual(seen, ['L']);
  } finally {
    delete globalThis.__xrFrameClock;
  }
});

test('the clock skips the copy after the dungeon claims both eyes', () => {
  const win = fakeWin();
  const mirrors = [];
  const targets = [];
  let sim = 0;
  const stereo = createDungeonStereo((fb, vp) => { targets.push(vp); return true; });
  const clock = createXrFrameClock({
    win,
    setTarget(fb, vp) { targets.push(vp); return !!fb; },
    mirror() { mirrors.push(1); return true; },
    onDisengage() { stereo.release(); },
  });
  clock.dungeonEyes = (draw, cam) => stereo.paint(clock, draw, cam);
  clock.install();
  const session = fakeSession();
  const opened = open(session, { headY: 1.65, id: 'a' });
  clock.engage(opened);
  const eyesY = [];
  win.requestAnimationFrame(() => {
    clock.dungeonEyes((shot) => {
      if (shot.index === 0) sim += 1;
      eyesY.push(shot.eye[1]);
    }, camera);
  });
  session.fire(20, opened.frame);
  assert.equal(sim, 1);
  assert.deepEqual(mirrors, []);
  assert.ok(eyesY.every((y) => Math.abs(y - 1.7) < 1e-6));
  clock.disengage();
  const again = [];
  const sessionB = fakeSession();
  const openedB = open(sessionB, { headY: 1.0, id: 'b' });
  clock.engage(openedB);
  win.requestAnimationFrame(() => {
    clock.dungeonEyes((shot) => { if (shot.index === 0) again.push(shot.eye[1]); }, camera);
  });
  sessionB.fire(30, openedB.frame);
  assert.equal(again.length, 1);
  assert.ok(Math.abs(again[0] - 1.7) < 1e-6, again[0]);
  clock.uninstall();
});

test('the dungeon door does not import src/vr, and a second eye does not resume the weapon', () => {
  assert.doesNotMatch(read('src/scenes/dungeon.js'), /from ['"][^'"]*\/vr\//);
  assert.doesNotMatch(read('src/scenes/dungeonEyeHost.js'), /from ['"][^'"]*\/vr\//);
  assert.doesNotMatch(read('src/scenes/dungeonEyeReplay.js'), /from ['"][^'"]*\/vr\//);
  assert.match(read('src/scenes/dungeon.js'), /if \(\(index \?\? 0\) > 0\) ctx\.replayDungeonView\?\./);
  assert.match(read('src/scenes/dungeon.js'), /ctx\.drawFoes\(dt, canvas, proj, view, cam\.pos,/);
  assert.match(read('src/combat/weapon/weaponRig.js'), /draw\(\{ paralyzed = false, resume = true \} = \{\}\)/);
  assert.match(read('src/scenes/dungeonEyeReplay.js'), /resume: false/);
  assert.match(read('src/scenes/dungeonContext.js'), /weaponRig\.draw\(\{ paralyzed: _pParalyzed \}\)/);
  assert.match(read('src/vr/installVr.js'), /stereo\.release\(\)/);
  assert.match(read('src/vr/installVr.js'), /depthFar: DUNGEON_FAR/);
});

function fakeWin() {
  let n = 1;
  const pending = new Map();
  const requestAnimationFrame = (cb) => { const id = n++; pending.set(id, cb); return id; };
  const cancelAnimationFrame = (id) => { pending.delete(id); };
  return { pending, requestAnimationFrame, cancelAnimationFrame };
}

function fakeSession() {
  let n = 1;
  const pending = new Map();
  const listeners = { end: [] };
  return {
    pending,
    listeners,
    requestAnimationFrame(cb) { const id = n++; pending.set(id, cb); return id; },
    cancelAnimationFrame(id) { pending.delete(id); },
    addEventListener(type, fn, opts) { (listeners[type] ??= []).push({ fn, once: opts?.once === true }); },
    removeEventListener(type, fn) {
      const list = listeners[type];
      if (!list) return;
      const at = list.findIndex((entry) => entry.fn === fn);
      if (at >= 0) list.splice(at, 1);
    },
    fire(time, frame) {
      const batch = [...pending.entries()];
      pending.clear();
      for (const [, cb] of batch) cb(time, frame);
    },
  };
}

function open(session, { headY = 1.65, id = 'a' } = {}) {
  const left = { transform: { matrix: pose(-0.032, headY, 0) }, projectionMatrix: projOf(1), vp: { x: 0, y: 0, width: 10, height: 8 } };
  const right = { transform: { matrix: pose(0.032, headY, 0) }, projectionMatrix: projOf(3), vp: { x: 10, y: 0, width: 10, height: 8 } };
  const head = pose(0, headY, 0);
  const frame = {
    getViewerPose() {
      return { transform: { matrix: head }, views: [left, right] };
    },
  };
  const layer = {
    framebuffer: { id },
    getViewport(view) { return view.vp; },
  };
  return { session, layer, refSpace: { kind: 'local-floor' }, frame };
}
