// The title panel: a controller ray becomes a page pixel, and leaving the
// front door leaves the session up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aimHands, levelForward, placePanel, rayFromTransform, rayPanelHit, uvToClient,
} from '../../src/vr/panelHit.js';
import { dispatchPanelPointer, elementInRoot, triggerEdge } from '../../src/vr/panelPointer.js';
import { buildPaintList } from '../../src/vr/domRaster.js';
import { createTitlePanel, frontDoorRoot, panelPhase } from '../../src/vr/titlePanel.js';
import { createXrFrameClock } from '../../src/vr/xrFrameLoop.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1];

function box(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

test('a level panel ignores head pitch, and the ray maps to the page', () => {
  assert.deepEqual(levelForward(IDENTITY), [0, 0, -1]);
  const pitched = [1, 0, 0, 0, 0, 0.866, 0.5, 0, 0, -0.5, 0.866, 0, 0, 1.6, 0, 1];
  assert.deepEqual(levelForward(pitched), [0, 0, -1]);
  const pose = placePanel([0, 1.6, 0], [0, 0, -1], { aspect: 16 / 9 });
  assert.ok(Math.abs(pose.center[2] + 1.35) < 1e-9);
  assert.equal(pose.center[1], 1.55);
  const center = rayPanelHit([0, 1.55, 0], [0, 0, -1], pose);
  assert.ok(Math.abs(center.u - 0.5) < 1e-6);
  assert.ok(Math.abs(center.v - 0.5) < 1e-6);
  const above = rayPanelHit([0, 1.6, 0], [0, 0, -1], pose);
  assert.ok(above.v < 0.5);
  assert.equal(rayPanelHit([0, 1.55, 0], [1, 0, 0], pose), null);
  assert.equal(rayPanelHit([0, 1.55, 0], [0, 0, 1], pose), null);
  const page = uvToClient(0.25, 0.5, { left: 10, top: 20, width: 200, height: 100 });
  assert.deepEqual(page, { x: 60, y: 70 });
  const aimed = aimHands({
    right: { origin: [3, 1.55, 0], direction: [0, 0, -1], trigger: true },
    left: { origin: [0, 1.55, 0], direction: [0, 0, -1], trigger: false },
  }, pose);
  assert.equal(aimed.hand, 'left');
  assert.equal(aimed.trigger, false);
  const ray = rayFromTransform(IDENTITY);
  assert.deepEqual(ray.direction, [0, 0, -1]);
  assert.deepEqual(ray.origin, [0, 1.6, 0]);
});

test('one trigger press clicks the door element under the ray, not the VR plaque', () => {
  const seen = [];
  class Ev {
    constructor(type, init) { this.type = type; this.detail = init.detail; this.clientX = init.clientX; }
  }
  const button = {
    tagName: 'BUTTON',
    dispatchEvent(e) { seen.push(`${e.type}:${e.detail}`); return true; },
  };
  const field = {
    tagName: 'INPUT',
    dispatchEvent(e) { seen.push(`field:${e.type}`); return true; },
    focus() { seen.push('focus'); },
  };
  const chrome = { hasAttribute: (n) => n === 'data-vr-chrome', dispatchEvent() { seen.push('chrome'); } };
  const disabled = { disabled: true, dispatchEvent() { seen.push('disabled'); } };
  const root = {
    contains(el) { return el === button || el === field; },
  };
  const doc = {
    defaultView: { PointerEvent: Ev, MouseEvent: Ev },
    elementsFromPoint: () => [chrome, disabled, button],
  };
  assert.equal(elementInRoot(doc, root, 60, 70), button);
  const pose = placePanel([0, 1.6, 0], [0, 0, -1], { aspect: 2 });
  const hit = rayPanelHit([0, 1.55, 0], [0, 0, -1], pose);
  const point = uvToClient(hit.u, hit.v, { left: 0, top: 0, width: 200, height: 100 });
  const prev = { down: false };
  const press = triggerEdge(prev, true);
  assert.equal(press.down, true);
  assert.equal(triggerEdge(prev, true).down, false);
  dispatchPanelPointer(doc, root, point, 'down', button);
  const release = triggerEdge(prev, false);
  assert.equal(release.up, true);
  dispatchPanelPointer(doc, root, point, 'up', button);
  assert.deepEqual(seen.filter((s) => s.startsWith('click')), ['click:1']);
  assert.equal(seen.includes('chrome'), false);
  seen.length = 0;
  doc.elementsFromPoint = () => [field];
  dispatchPanelPointer(doc, root, point, 'down');
  assert.equal(seen.includes('focus'), true);
});

test('the paint list is the live boxes, and a chrome node is not one of them', () => {
  const root = { tagName: 'DIV', childNodes: [], children: [] };
  const word = { tagName: 'SPAN', childNodes: [{ nodeType: 3, textContent: 'Offline' }], children: [] };
  const plaque = { tagName: 'BUTTON', hasAttribute: () => true, childNodes: [{ nodeType: 3, textContent: 'Exit' }], children: [] };
  root.children = [word, plaque];
  const rects = new Map([
    [root, box(0, 0, 200, 100)],
    [word, box(20, 30, 80, 24)],
    [plaque, box(160, 40, 30, 16)],
  ]);
  const styles = new Map([
    [word, { color: '#fff', backgroundColor: '#223', font: '16px sans-serif', opacity: '1', zIndex: '2', paddingLeft: '4px', textAlign: 'center', borderTopWidth: '0' }],
  ]);
  const list = buildPaintList(root, {
    rectOf: (el) => rects.get(el),
    styleOf: (el) => styles.get(el) ?? null,
  });
  assert.equal(list.nodes.some((n) => n.text === 'Offline'), true);
  assert.equal(list.nodes.some((n) => n.text === 'Exit'), false);
  const offline = list.nodes.find((n) => n.text === 'Offline');
  assert.equal(offline.left, 20);
  assert.equal(offline.background, '#223');
});

test('the panel is up for the door and drops when the door leaves, without ending the session', () => {
  assert.equal(panelPhase({ presenting: false, doorOpen: true }), 'off');
  assert.equal(panelPhase({ presenting: true, doorOpen: true }), 'title');
  assert.equal(panelPhase({ presenting: true, doorOpen: false }), 'world');
  const root = {
    isConnected: true,
    getBoundingClientRect: () => box(0, 0, 320, 180),
  };
  let open = true;
  const doc = { getElementById: (id) => (open && id === 'enhanced-menu' ? root : null) };
  assert.equal(frontDoorRoot(doc), root);
  const phases = [];
  const claims = [];
  const frames = [];
  const win = {
    requestAnimationFrame(cb) { frames.push(cb); return frames.length; },
    cancelAnimationFrame() {},
  };
  let ended = 0;
  const clock = {
    presenting: true,
    end() { ended += 1; },
    viewerMatrix: () => IDENTITY,
    questRays: () => null,
    eyePack: () => ({
      framebuffer: {},
      views: [{
        x: 0, y: 0, width: 8, height: 8,
        view: { projectionMatrix: new Float32Array(16), transform: { inverse: { matrix: new Float32Array(16) } } },
      }],
    }),
    claimStereo() { claims.push(1); },
  };
  const drawer = { draw() { return true; }, setTexture() {} };
  const panel = createTitlePanel({ doc, win, clock, onPhase: (p) => phases.push(p), drawer });
  assert.equal(panel.start(), true);
  const run = () => {
    const batch = frames.splice(0);
    for (const cb of batch) cb(10);
  };
  run();
  assert.deepEqual(phases, ['title']);
  assert.equal(claims.length, 1);
  assert.equal(frames.length, 1);
  open = false;
  run();
  assert.deepEqual(phases, ['title', 'world']);
  assert.equal(claims.length, 1);
  assert.equal(frames.length, 0);
  assert.equal(ended, 0);
  assert.equal(panel.phase, 'world');
  assert.equal(panel.start(), true);
  clock.presenting = false;
  run();
  assert.equal(panel.phase, 'off');
  assert.equal(ended, 0);
  assert.doesNotMatch(readFileSync('src/vr/titlePanel.js', 'utf8'), /endVrSession|session\.end/);
});

test('the frame clock publishes controller rays and clears them when the session ends', () => {
  const win = {
    requestAnimationFrame(cb) { this.pending = cb; return 1; },
    cancelAnimationFrame() { this.pending = null; },
  };
  const pending = new Map();
  let n = 1;
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, 1.4, -0.3, 1];
  const session = {
    inputSources: [{
      handedness: 'right',
      targetRaySpace: {},
      gamepad: { axes: [0, 0, 0, 0], buttons: [{ value: 0.8, pressed: true }] },
    }],
    requestAnimationFrame(cb) { const id = n++; pending.set(id, cb); return id; },
    cancelAnimationFrame(id) { pending.delete(id); },
    addEventListener() {},
    removeEventListener() {},
  };
  const frame = {
    getViewerPose() { return { views: [{}], transform: { matrix: IDENTITY } }; },
    getPose() { return { transform: { matrix } }; },
  };
  const clock = createXrFrameClock({ win, setTarget: () => true, mirror: () => true });
  assert.equal(clock.questRays(), null);
  clock.install();
  clock.engage({ session, layer: { framebuffer: {}, getViewport: () => ({ x: 0, y: 0, width: 4, height: 4 }) }, refSpace: {} });
  win.requestAnimationFrame(() => {});
  for (const [, cb] of [...pending.entries()]) cb(16, frame);
  pending.clear();
  const rays = clock.questRays();
  assert.equal(rays.right.trigger, true);
  assert.ok(Math.abs(rays.right.direction[2] + 1) < 1e-9);
  assert.deepEqual(rays.right.origin, [0.2, 1.4, -0.3]);
  assert.equal(clock.viewerMatrix()[13], 1.6);
  clock.disengage();
  assert.equal(clock.questRays(), null);
  assert.equal(clock.viewerMatrix(), null);
});
