// The title panel: a controller ray becomes a page pixel, and leaving the
// front door leaves the session up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aimHands, levelForward, placePanel, rayFromTransform, rayPanelHit, uvToClient,
} from '../../src/vr/panelHit.js';
import { dispatchPanelPointer, elementInRoot, triggerEdge } from '../../src/vr/panelPointer.js';
import { buildPaintList, canvasForPanel, paintList, releaseDoorPin, resolveDoorRect } from '../../src/vr/domRaster.js';
import { uploadPanelSource } from '../../src/vr/panelDraw.js';
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

test('a scrim paints under its own label, and a door name nested in spans is text', () => {
  const root = { tagName: 'DIV', childNodes: [], children: [] };
  const button = { tagName: 'BUTTON', childNodes: [], children: [] };
  const word = { tagName: 'SPAN', childNodes: [], children: [] };
  const name = { tagName: 'SPAN', childNodes: [{ nodeType: 3, textContent: 'Offline' }], children: [] };
  word.children = [name];
  button.children = [word];
  const stage = { tagName: 'DIV', childNodes: [], children: [] };
  const form = { tagName: 'SPAN', childNodes: [{ nodeType: 3, textContent: 'Sign in' }], children: [] };
  stage.children = [form];
  const sky = { tagName: 'CANVAS', childNodes: [], children: [], getContext: () => null };
  root.children = [sky, button, stage];
  const rects = new Map([
    [root, box(0, 0, 400, 300)],
    [sky, box(-20, -20, 440, 340)],
    [button, box(100, 80, 200, 48)],
    [word, box(120, 88, 160, 32)],
    [name, box(130, 90, 140, 28)],
    [stage, box(0, 0, 400, 300)],
    [form, box(140, 160, 120, 24)],
  ]);
  const styles = new Map([
    [name, { color: '#d8cfae', backgroundColor: 'rgba(0, 0, 0, 0)', font: '34px sans-serif', opacity: '1', zIndex: 'auto', textAlign: 'center', paddingLeft: '0', borderTopWidth: '0' }],
    [stage, { color: '#d8cfae', backgroundColor: 'rgba(8, 10, 15, 0.6)', font: '16px sans-serif', opacity: '1', zIndex: '5', textAlign: 'left', paddingLeft: '0', borderTopWidth: '0' }],
    [form, { color: '#fff', backgroundColor: 'rgba(0, 0, 0, 0)', font: '16px sans-serif', opacity: '1', zIndex: 'auto', textAlign: 'left', paddingLeft: '0', borderTopWidth: '0' }],
  ]);
  const list = buildPaintList(root, {
    rectOf: (el) => rects.get(el),
    styleOf: (el) => styles.get(el) ?? null,
    imageOf: canvasForPanel,
  });
  const texts = list.nodes.map((n) => n.text).filter(Boolean);
  assert.deepEqual(texts, ['Offline', 'Sign in']);
  const stageAt = list.nodes.findIndex((n) => n.background === 'rgba(8, 10, 15, 0.6)');
  const formAt = list.nodes.findIndex((n) => n.text === 'Sign in');
  const doorAt = list.nodes.findIndex((n) => n.text === 'Offline');
  assert.ok(doorAt < stageAt && stageAt < formAt);
  assert.equal(list.nodes.some((n) => n.image), false);
  assert.equal(canvasForPanel(sky), null);
  assert.equal(canvasForPanel({ tagName: 'CANVAS', getContext: (kind) => (kind === '2d' ? {} : null) }) != null, true);
  const drawn = [];
  paintList({
    setTransform() {}, clearRect() {}, strokeRect() {},
    fillRect() { drawn.push(`rect:${this.fillStyle}`); },
    fillText(t) { drawn.push(`text:${t}`); },
    drawImage() { drawn.push('image'); },
    fillStyle: '', font: '', textAlign: '', textBaseline: '', globalAlpha: 1, strokeStyle: '', lineWidth: 1,
  }, list);
  assert.ok(drawn.indexOf('text:Offline') < drawn.indexOf('rect:rgba(8, 10, 15, 0.6)'));
  assert.ok(drawn.indexOf('rect:rgba(8, 10, 15, 0.6)') < drawn.indexOf('text:Sign in'));
  assert.equal(drawn.includes('image'), false);
});

test('a collapsed door gets a pixel box, and a failed upload is not treated as a picture', () => {
  let laid = false;
  const style = { cssText: 'position:fixed;inset:0' };
  const root = {
    id: 'enhanced-menu',
    style,
    getBoundingClientRect() { return laid ? box(0, 0, 1280, 720) : box(0, 0, 0, 0); },
  };
  Object.defineProperty(style, 'width', { set(v) { if (parseFloat(v) >= 32) laid = true; }, configurable: true });
  const memory = {};
  const pinned = resolveDoorRect(root, memory);
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.rect.width, 1280);
  assert.equal(pinned.rect.height, 720);
  assert.equal(style.left, '0px');
  releaseDoorPin(memory);
  assert.equal(style.cssText, 'position:fixed;inset:0');
  const healthy = { getBoundingClientRect: () => box(0, 0, 800, 600) };
  const kept = resolveDoorRect(healthy, {});
  assert.equal(kept.pinned, false);
  assert.equal(kept.rect.width, 800);

  const calls = [];
  let err = 0;
  const gl = {
    TEXTURE_2D: 1, TEXTURE_MIN_FILTER: 2, TEXTURE_MAG_FILTER: 3, TEXTURE_WRAP_S: 4, TEXTURE_WRAP_T: 5,
    LINEAR: 6, CLAMP_TO_EDGE: 7, RGBA: 8, UNSIGNED_BYTE: 9, PIXEL_UNPACK_BUFFER: 10,
    UNPACK_ALIGNMENT: 11, UNPACK_ROW_LENGTH: 12, UNPACK_SKIP_PIXELS: 13, UNPACK_SKIP_ROWS: 14,
    UNPACK_IMAGE_HEIGHT: 15, UNPACK_SKIP_IMAGES: 16, UNPACK_FLIP_Y_WEBGL: 17,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 18, UNPACK_COLORSPACE_CONVERSION_WEBGL: 19, NONE: 0, NO_ERROR: 0,
    getParameter(p) { return p === gl.PIXEL_UNPACK_BUFFER ? 7 : p === gl.UNPACK_ROW_LENGTH ? 64 : 4; },
    pixelStorei(p, v) { calls.push(['store', p, v]); },
    bindBuffer(t, b) { calls.push(['buf', b]); },
    bindTexture() {},
    texParameteri() { calls.push(['param']); },
    texImage2D() { calls.push(['image']); err = gl.INVALID_OPERATION = 1282; },
    getError() { const e = err; err = 0; return e; },
  };
  const failed = uploadPanelSource(gl, {}, {});
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 1282);
  const imageAt = calls.findIndex((c) => c[0] === 'image');
  const unbound = calls.findIndex((c) => c[0] === 'buf' && c[1] == null);
  assert.ok(unbound !== -1 && unbound < imageAt);
  assert.ok(calls.some((c) => c[0] === 'store' && c[1] === gl.UNPACK_ROW_LENGTH && c[2] === 0 && calls.indexOf(c) < imageAt));
  assert.ok(calls.some((c) => c[0] === 'store' && c[1] === gl.UNPACK_FLIP_Y_WEBGL && c[2] === false && calls.indexOf(c) < imageAt));
  assert.equal(calls.filter((c) => c[0] === 'buf').at(-1)[1], 7);
  err = 0;
  gl.texImage2D = () => { calls.push(['image-ok']); };
  assert.equal(uploadPanelSource(gl, {}, {}).ok, true);
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

test('the first title frame logs the door box once', () => {
  const lines = [];
  const root = {
    id: 'enhanced-menu',
    isConnected: true,
    getBoundingClientRect: () => box(0, 0, 320, 180),
  };
  const doc = { getElementById: (id) => (id === 'enhanced-menu' ? root : null) };
  const frames = [];
  const win = { requestAnimationFrame(cb) { frames.push(cb); return frames.length; }, cancelAnimationFrame() {} };
  const clock = {
    presenting: true,
    viewerMatrix: () => IDENTITY,
    questRays: () => null,
    eyePack: () => null,
    claimStereo() {},
  };
  const panel = createTitlePanel({
    doc, win, clock, log: (line) => lines.push(line),
    drawer: { draw() { return false; }, setTexture() { return { ok: false, error: 0 }; } },
  });
  panel.start();
  frames.splice(0).forEach((cb) => cb(10));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /vr-panel enhanced-menu 320x180 nodes=0 texts=0 images=0 tex=0 gl=0 pin=0/);
  frames.splice(0).forEach((cb) => cb(20));
  assert.equal(lines.length, 1);
});
