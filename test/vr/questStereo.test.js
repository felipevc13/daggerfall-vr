// VR1: Quest 3 numbers for the dungeon eyes. Identity head is level.
// A 30 degree look up looks up. The two eyes are a real IPD apart, the
// asymmetric centre is mirrored with the scale, and the world image is
// the eye's own size so the horizon is not cropped off the bottom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { perspectiveOffCenter } from '../../src/world/mat4.js';
import { eyeMatrices, headsetDeltaView, projectionMatrix, rigView } from '../../src/vr/xrCamera.js';
import { createDungeonStereo } from '../../src/vr/dungeonStereo.js';
import { createXrFrameClock } from '../../src/vr/xrFrameLoop.js';
import { xrWorldImageSize } from '../../src/render/renderer.js';

const read = (p) => readFileSync(p, 'utf8');
const DEG = Math.PI / 180;
const IPD = 0.063;
const HEAD_Y = 1.6;
const NEAR = 0.05;
const FAR = 800;
// Quest 3 per-eye angles, degrees. Outer edge wider than the nose, a
// little more down than up. local-floor head at 1.6 m.
const Q3_LEFT = { left: -52, right: 42, up: 48, down: -53 };
const Q3_RIGHT = { left: -42, right: 52, up: 48, down: -53 };
const EYE_VP = { width: 1680, height: 1760 };
const WINDOW = { width: 1280, height: 720 };

function pose(rotation, t) {
  const m = new Float32Array(16);
  const [r, u, b] = rotation;
  m[0] = r[0]; m[1] = r[1]; m[2] = r[2];
  m[4] = u[0]; m[5] = u[1]; m[6] = u[2];
  m[8] = b[0]; m[9] = b[1]; m[10] = b[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  m[15] = 1;
  return m;
}

const LEVEL = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function pitchUp(deg) {
  const th = deg * DEG, c = Math.cos(th), s = Math.sin(th);
  return [[1, 0, 0], [0, c, s], [0, -s, c]];
}

function yawLeft(deg) {
  const th = deg * DEG, c = Math.cos(th), s = Math.sin(th);
  return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
}

function det3(a, b, c) {
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

function frustum(angles) {
  const l = NEAR * Math.tan(angles.left * DEG);
  const r = NEAR * Math.tan(angles.right * DEG);
  const b = NEAR * Math.tan(angles.down * DEG);
  const t = NEAR * Math.tan(angles.up * DEG);
  return perspectiveOffCenter(l, r, b, t, NEAR, FAR);
}

function ndc(proj, view, p) {
  const x = view[0] * p[0] + view[4] * p[1] + view[8] * p[2] + view[12];
  const y = view[1] * p[0] + view[5] * p[1] + view[9] * p[2] + view[13];
  const z = view[2] * p[0] + view[6] * p[1] + view[10] * p[2] + view[14];
  const w = view[3] * p[0] + view[7] * p[1] + view[11] * p[2] + view[15];
  const cx = proj[0] * x + proj[4] * y + proj[8] * z + proj[12] * w;
  const cy = proj[1] * x + proj[5] * y + proj[9] * z + proj[13] * w;
  const cw = proj[3] * x + proj[7] * y + proj[11] * z + proj[15] * w;
  return [cx / cw, cy / cw];
}

function camOf(view) {
  return [
    -(view[0] * view[12] + view[1] * view[13] + view[2] * view[14]),
    -(view[4] * view[12] + view[5] * view[13] + view[6] * view[14]),
    -(view[8] * view[12] + view[9] * view[13] + view[10] * view[14]),
  ];
}

function questEye(side, rotation, head = [0, HEAD_Y, 0], alongRight = false) {
  const x = side * (IPD / 2);
  const raw = frustum(side < 0 ? Q3_LEFT : Q3_RIGHT);
  const right = rotation[0];
  const at = alongRight
    ? [head[0] + x * right[0], head[1] + x * right[1], head[2] + x * right[2]]
    : [head[0] + x, head[1], head[2]];
  return {
    raw,
    view: {
      transform: { matrix: pose(rotation, at) },
      projectionMatrix: raw,
    },
    vp: { x: side < 0 ? 0 : EYE_VP.width, y: 0, width: EYE_VP.width, height: EYE_VP.height },
  };
}

const game = { pos: [8, 1.7, 3], yaw: 0 };

function shotFor(eye, head) {
  const posed = headsetDeltaView(eye.view, head);
  return eyeMatrices(posed, game, NEAR, FAR);
}

test('a level head looks level, and looking up looks up', () => {
  const level = rigView({ transform: { matrix: pose(LEVEL, [0, HEAD_Y, 0]) } }, { pos: game.pos, yaw: 0 });
  assert.ok(Math.abs(level.forward[1]) < 1e-9, level.forward[1]);
  assert.ok(Math.abs(level.forward[0]) < 1e-9 && level.forward[2] > 0.9, level.forward.join(','));
  assert.ok(Math.abs(det3(level.right, level.up, level.forward) - 1) < 1e-6);
  const up = rigView({ transform: { matrix: pose(pitchUp(30), [0, HEAD_Y, 0]) } }, { pos: game.pos, yaw: 0 });
  assert.ok(Math.abs(up.forward[1] - Math.sin(30 * DEG)) < 1e-6, up.forward[1]);
  assert.ok(Math.abs(det3(up.right, up.up, up.forward) - 1) < 1e-6);
  const left = rigView({ transform: { matrix: pose(yawLeft(30), [0, HEAD_Y, 0]) } }, { pos: game.pos, yaw: 0 });
  assert.ok(left.forward[0] < -0.4, left.forward.join(','));
  assert.ok(Math.abs(left.forward[1]) < 1e-6);
  assert.ok(Math.abs(det3(left.right, left.up, left.forward) - 1) < 1e-6);
});

test('Quest eyes mirror the off-centre term, and a point ahead sits near both optical centres', () => {
  const head = [0, HEAD_Y, 0];
  const left = questEye(-1, LEVEL, head);
  const right = questEye(1, LEVEL, head);
  for (const eye of [left, right]) {
    const proj = projectionMatrix(eye.view, NEAR, FAR);
    assert.ok(Math.abs(proj[0] + eye.raw[0]) < 1e-6, proj[0]);
    assert.ok(Math.abs(proj[8] + eye.raw[8]) < 1e-6, proj[8]);
    assert.ok(Math.abs(eye.raw[8]) > 0.05, 'the Quest frustum is off centre');
  }
  const L = shotFor(left, head);
  const R = shotFor(right, head);
  const ahead = [game.pos[0], game.pos[1], game.pos[2] + 4];
  const floor = [ahead[0], 0, ahead[2]];
  const nL = ndc(L.proj, L.view, ahead);
  const nR = ndc(R.proj, R.view, ahead);
  const cL = ndc(L.proj, L.view, [L.eye[0], L.eye[1], L.eye[2] + 20]);
  const cR = ndc(R.proj, R.view, [R.eye[0], R.eye[1], R.eye[2] + 20]);
  const dL = [nL[0] - cL[0], nL[1] - cL[1]];
  const dR = [nR[0] - cR[0], nR[1] - cR[1]];
  assert.ok(Math.hypot(dL[0], dL[1]) < 0.05, dL.join(','));
  assert.ok(Math.hypot(dR[0], dR[1]) < 0.05, dR.join(','));
  assert.ok(Math.abs(nL[1]) < 0.25 && Math.abs(nR[1]) < 0.25, [nL[1], nR[1]].join(','));
  const floorL = ndc(L.proj, L.view, floor);
  assert.ok(floorL[1] < nL[1] - 0.15, [floorL[1], nL[1]].join(','));
  // Screen-right is whichever way a point on the eye's right goes. Each eye's
  // NDC is measured from its own optical centre: the lenses do not share one.
  const rightward = ndc(L.proj, L.view, [ahead[0] + 0.4, ahead[1], ahead[2]]);
  const screenRight = Math.sign(rightward[0] - nL[0]);
  assert.ok(screenRight !== 0);
  assert.ok((dL[0] - dR[0]) * screenRight > 0, [dL[0], dR[0], screenRight].join(','));
  assert.ok(Math.abs(dL[0] - dR[0]) < 0.08, Math.abs(dL[0] - dR[0]));
});

test('the two eyes views differ by the Quest IPD, and claiming skips the copy', () => {
  const head = [0.1, HEAD_Y, -0.2];
  const left = questEye(-1, LEVEL, head);
  const right = questEye(1, LEVEL, head);
  const L = shotFor(left, head);
  const R = shotFor(right, head);
  const a = camOf(L.view), b = camOf(R.view);
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  assert.ok(Math.abs(Math.hypot(dx, dy, dz) - IPD) < 1e-6, [dx, dy, dz].join(','));
  assert.ok(Math.abs(dx - IPD) < 1e-6 && Math.abs(dy) < 1e-6 && Math.abs(dz) < 1e-6);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  assert.ok(Math.hypot(mid[0] - game.pos[0], mid[1] - game.pos[1], mid[2] - game.pos[2]) < 1e-6);
  assert.ok(Math.hypot(a[0] - game.pos[0], a[1] - game.pos[1], a[2] - game.pos[2]) > 0.03);
  let differed = false;
  for (let i = 0; i < 16; i++) if (L.view[i] !== R.view[i]) differed = true;
  assert.equal(differed, true);

  // A turned head: the offset follows that head's right, not world X and not the flat eye.
  const turned = yawLeft(30);
  const TL = shotFor(questEye(-1, turned, head, true), head);
  const TR = shotFor(questEye(1, turned, head, true), head);
  const ta = camOf(TL.view), tb = camOf(TR.view);
  const gx = tb[0] - ta[0], gy = tb[1] - ta[1], gz = tb[2] - ta[2];
  const basis = rigView(headsetDeltaView(questEye(1, turned, head, true).view, head), { pos: game.pos, yaw: 0 });
  const along = gx * basis.right[0] + gy * basis.right[1] + gz * basis.right[2];
  const slip = Math.hypot(gx - along * basis.right[0], gy - along * basis.right[1], gz - along * basis.right[2]);
  assert.ok(Math.abs(along - IPD) < 1e-5, along);
  assert.ok(slip < 1e-5, slip);
  assert.notDeepEqual(Array.from(TL.view), Array.from(TR.view));

  const dungeon = read('src/scenes/dungeon.js');
  const renderer = read('src/render/renderer.js');
  assert.match(dungeon, /paintDungeonFrame\(shot\.proj, shot\.view, shot\.index/);
  assert.match(renderer, /proj, view, lightDir, eye: this\._camPos/);
  assert.match(renderer, /gl\.uniformMatrix4fv\(this\.bbUView, false, this\._view\)/);

  const pack = {
    framebuffer: { id: 'fb' },
    head,
    session: { id: 'q' },
    views: [left, right].map((eye) => ({ view: eye.view, x: eye.vp.x, y: eye.vp.y, width: eye.vp.width, height: eye.vp.height })),
  };
  const seen = [];
  const stereo = createDungeonStereo(() => true);
  const clock = { eyePack: () => pack, claimed: false, claimStereo() { this.claimed = true; } };
  assert.equal(stereo.paint(clock, (shot) => seen.push(shot.view), { eye: game.pos, yaw: 0 }), true);
  assert.equal(clock.claimed, true);
  assert.equal(seen.length, 2);
  const sa = camOf(seen[0]), sb = camOf(seen[1]);
  assert.ok(Math.abs(Math.hypot(sb[0] - sa[0], sb[1] - sa[1], sb[2] - sa[2]) - IPD) < 1e-6);

  const mirrors = [];
  const win = fakeWin();
  const session = fakeSession();
  const clock2 = createXrFrameClock({
    win,
    setTarget: () => true,
    mirror() { mirrors.push(1); return true; },
  });
  clock2.dungeonEyes = (draw, cam) => stereo.paint(clock2, draw, cam);
  clock2.install();
  const opened = open(session, head, left, right);
  clock2.engage(opened);
  win.requestAnimationFrame(() => { clock2.dungeonEyes((shot) => seen.push(shot.index), { eye: game.pos, yaw: 0 }); });
  session.fire(1, opened.frame);
  assert.deepEqual(mirrors, []);
  clock2.uninstall();
});

test('the eye image is the eye viewport, not the window, so the horizon stays in frame', () => {
  assert.deepEqual(xrWorldImageSize(EYE_VP, null, WINDOW.width, WINDOW.height), [EYE_VP.width, EYE_VP.height]);
  assert.deepEqual(xrWorldImageSize(null, null, WINDOW.width, WINDOW.height), [WINDOW.width, WINDOW.height]);
  assert.deepEqual(xrWorldImageSize(EYE_VP, { width: 320, height: 200 }, WINDOW.width, WINDOW.height), [320, 200]);
  const cropped = -1 + 2 * (Math.min(WINDOW.height, EYE_VP.height) / EYE_VP.height);
  assert.ok(cropped < 0, cropped);
  const fitted = -1 + 2 * (EYE_VP.height / EYE_VP.height);
  assert.equal(fitted, 1);
  // The resolve samples the whole image with vUV across the eye rectangle.
  // Same aspect keeps a horizontal shift the same fraction of the eye.
  // Stretching the window into the eye scales that fraction.
  const aspectScale = (srcW, srcH, dstW, dstH) => (dstW / dstH) / (srcW / srcH);
  assert.equal(aspectScale(EYE_VP.width, EYE_VP.height, EYE_VP.width, EYE_VP.height), 1);
  const stretched = aspectScale(WINDOW.width, WINDOW.height, EYE_VP.width, EYE_VP.height);
  assert.ok(stretched < 0.6, stretched);
  const air = read('src/render/airPass.js');
  assert.match(air, /texture\(uFrame, vUV\)/);
  assert.match(air, /gl\.viewport\(_vp\.x, _vp\.y, _vp\.width, _vp\.height\)/);
  const src = read('src/render/renderer.js');
  assert.match(src, /xrWorldImageSize\(this\._xrTarget\?\.vp, retro,/);
  assert.match(src, /if \(xrWorld && this\._frameFbo && this\._xrTarget\?\.vp\)/);
  assert.match(src, /gl\.viewport\(0, 0, v\.width, v\.height\)/);
  assert.match(src, /gl\.scissor\(0, 0, v\.width, v\.height\)/);
});

function fakeWin() {
  let n = 1;
  const pending = new Map();
  return {
    pending,
    requestAnimationFrame(cb) { const id = n++; pending.set(id, cb); return id; },
    cancelAnimationFrame(id) { pending.delete(id); },
  };
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

function open(session, head, left, right) {
  const frame = {
    getViewerPose() {
      return {
        transform: { matrix: pose(LEVEL, head) },
        views: [left.view, right.view],
      };
    },
  };
  left.view.vp = left.vp;
  right.view.vp = right.vp;
  return {
    session,
    layer: { framebuffer: { id: 'fb' }, getViewport: (view) => view.vp },
    refSpace: { kind: 'local-floor' },
    frame,
  };
}
