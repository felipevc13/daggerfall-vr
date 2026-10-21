// Quest sticks on the dungeon motor. The rotation, the deadzone, the snap
// latch, and the button edges are pure. The getter is null without a session.
// A null sample does not write the camera or the key set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XrInputManager, questSampleOf, trackingYawOf } from '../../src/vr/xrInput.js';
import { readQuestMotor } from '../../src/vr/engineBridge.js';
import { createXrFrameClock } from '../../src/vr/xrFrameLoop.js';
import {
  headRelativeAnalog, takeSnapTurn, questButtonEdges, applyDungeonQuestInput,
  createDungeonQuestLatch, QUEST_SNAP,
} from '../../src/scenes/dungeonQuestInput.js';
import { bindings, setBindings } from '../../src/ui/input.js';
import { createBindings, resetDefaults } from '../../src/systems/inputActions.js';

function ground(bodyYaw, analog) {
  const s = Math.sin(bodyYaw);
  const c = Math.cos(bodyYaw);
  return {
    x: s * analog.y + c * analog.x,
    z: c * analog.y - s * analog.x,
  };
}

function hand(axes, buttons = []) {
  return {
    handedness: 'left',
    gamepad: { axes, buttons },
  };
}

test('head-relative stick follows head yaw and ignores pitch', () => {
  const body = Math.PI / 4;
  const tracking = Math.PI / 2;
  const analog = headRelativeAnalog(0, 1, body + tracking, body);
  const step = ground(body, analog);
  const head = body + tracking;
  assert.ok(Math.abs(step.x - Math.sin(head)) < 1e-9);
  assert.ok(Math.abs(step.z - Math.cos(head)) < 1e-9);
  const level = trackingYawOf([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const pitched = trackingYawOf([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  assert.equal(level, 0);
  assert.equal(pitched, 0);
  const turned = Math.PI / 2;
  const c = Math.cos(turned);
  const s = Math.sin(turned);
  const yawOnly = trackingYawOf([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]);
  const yawAndPitch = trackingYawOf([c, 0, s, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  assert.ok(Math.abs(yawOnly - turned) < 1e-9);
  assert.ok(Math.abs(yawAndPitch - turned) < 1e-9);
  assert.deepEqual(headRelativeAnalog(0.25, -0.5, 1, 0.2), headRelativeAnalog(0.25, -0.5, 1, 0.2));
});

test('a resting stick is inside the deadzone and a full push is forward', () => {
  const input = new XrInputManager();
  input.poll({ inputSources: [hand([0, 0, 0.08, -0.06], [])] }, null, null);
  const rest = questSampleOf(input.state, 0);
  assert.equal(rest.strafe, 0);
  assert.equal(rest.forward, 0);
  input.poll({ inputSources: [hand([0, 0, 0, -1], [])] }, null, null);
  const pushed = questSampleOf(input.state, 0);
  assert.equal(pushed.forward, 1);
  assert.equal(pushed.strafe, 0);
});

test('snap turn is one 45 degree step per push', () => {
  const latch = { snap: false };
  assert.equal(takeSnapTurn(latch, 0.8), QUEST_SNAP);
  assert.equal(takeSnapTurn(latch, 0.8), 0);
  assert.equal(takeSnapTurn(latch, 0.4), 0);
  assert.equal(latch.snap, true);
  assert.equal(takeSnapTurn(latch, 0.1), 0);
  assert.equal(latch.snap, false);
  assert.equal(takeSnapTurn(latch, -0.9), -QUEST_SNAP);
  assert.equal(takeSnapTurn(latch, -0.9), 0);
});

test('attack, activate, and crouch edge once per press', () => {
  const prev = { attack: false, activate: false, crouch: false };
  const idle = questButtonEdges(prev, { attack: false, activate: false, crouch: false });
  assert.equal(idle.attackEdge, false);
  assert.equal(idle.activateEdge, false);
  assert.equal(idle.crouchEdge, false);
  const down = questButtonEdges(prev, { attack: true, activate: true, crouch: true });
  assert.equal(down.attackEdge, true);
  assert.equal(down.activateEdge, true);
  assert.equal(down.crouchEdge, true);
  assert.equal(down.attackHeld, true);
  const held = questButtonEdges(prev, { attack: true, activate: true, crouch: true });
  assert.equal(held.attackEdge, false);
  assert.equal(held.activateEdge, false);
  assert.equal(held.crouchEdge, false);
  assert.equal(held.attackHeld, true);
  const up = questButtonEdges(prev, { attack: false, activate: false, crouch: false });
  assert.equal(up.attackEdge, false);
  assert.equal(up.attackHeld, false);
});

test('the sample maps A, B, thumb click, triggers, and X', () => {
  const buttons = (right, left) => {
    const state = {
      left: { stick: { x: 0, y: 0 }, ...left },
      right: { stick: { x: 0.2, y: 0 }, ...right },
    };
    return questSampleOf(state, null);
  };
  const a = buttons({ aBtn: true, bBtn: false, trigger: 0 }, { thumbClick: false, trigger: 0, xBtn: false });
  assert.equal(a.jump, true);
  assert.equal(a.crouch, false);
  assert.equal(a.attack, false);
  assert.equal(a.activate, false);
  assert.equal(a.headYaw, null);
  const run = buttons({ aBtn: false, bBtn: true, trigger: 0.6 }, { thumbClick: true, trigger: 0.4, xBtn: false });
  assert.equal(run.run, true);
  assert.equal(run.crouch, true);
  assert.equal(run.attack, true);
  assert.equal(run.activate, false);
  const x = buttons({ trigger: 0 }, { trigger: 0, xBtn: true, thumbClick: false });
  assert.equal(x.activate, true);
  const light = buttons({ trigger: 0.49 }, { trigger: 0.49, xBtn: false });
  assert.equal(light.attack, false);
  assert.equal(light.activate, false);
});

test('readQuestMotor is null without a presenting session', () => {
  assert.equal(readQuestMotor(undefined), null);
  assert.equal(readQuestMotor(null), null);
  assert.equal(readQuestMotor({ presenting: false, questMotor: () => ({ forward: 1 }) }), null);
  assert.equal(readQuestMotor({ presenting: true, questMotor: () => null }), null);
  assert.equal(readQuestMotor({ presenting: true, questMotor: () => { throw new Error('gone'); } }), null);
  const sample = { forward: 1, strafe: 0 };
  assert.equal(readQuestMotor({ presenting: true, questMotor: () => sample }), sample);
});

test('a null sample writes nothing, and a live one turns, moves, and edges crouch once', () => {
  const had = bindings();
  const clock = globalThis.__xrFrameClock;
  try {
    setBindings(resetDefaults(createBindings()));
    const cam = { yaw: 0.4, pitch: -0.2 };
    const keys = new Set(['KeyW']);
    const edges = { downFrame: new Set() };
    const latch = createDungeonQuestLatch();
    assert.equal(applyDungeonQuestInput(cam, keys, edges, latch, false), null);
    assert.equal(cam.yaw, 0.4);
    assert.equal(cam.pitch, -0.2);
    assert.deepEqual([...keys], ['KeyW']);
    assert.equal(latch.analog, null);
    assert.equal(edges.downFrame.size, 0);

    globalThis.__xrFrameClock = {
      presenting: true,
      questMotor: () => ({
        strafe: 0, forward: 1, turn: 0.85, headYaw: Math.PI / 2,
        jump: true, run: true, crouch: true, attack: true, activate: true,
      }),
    };
    applyDungeonQuestInput(cam, keys, edges, latch, false);
    assert.equal(cam.pitch, -0.2);
    assert.ok(Math.abs(cam.yaw - (0.4 + QUEST_SNAP)) < 1e-9);
    assert.ok(Math.abs(latch.analog.x - 1) < 1e-9, 'forward along a head turned 90 degrees is strafe');
    assert.ok(Math.abs(latch.analog.y) < 1e-9);
    assert.equal(keys.has('KeyW'), true);
    assert.equal(keys.has('JoystickButton5'), true);
    assert.equal(keys.has('JoystickButton8'), true);
    assert.equal(keys.has('JoystickAxis10Button0'), true);
    assert.equal(keys.has('Mouse0'), true);
    assert.equal(edges.downFrame.has('JoystickButton4'), true);

    const yaw = cam.yaw;
    applyDungeonQuestInput(cam, keys, edges, latch, false);
    assert.equal(cam.yaw, yaw);
    assert.equal(edges.downFrame.has('JoystickButton4'), true);

    globalThis.__xrFrameClock = { presenting: false, questMotor: () => ({ forward: 1, turn: 1, jump: true }) };
    applyDungeonQuestInput(cam, keys, edges, latch, false);
    assert.equal(cam.yaw, yaw);
    assert.equal(cam.pitch, -0.2);
    assert.equal(latch.analog, null);
    assert.equal(keys.has('KeyW'), true);
    assert.equal(keys.has('JoystickButton5'), false);
    assert.equal(keys.has('Mouse0'), false);
  } finally {
    setBindings(had);
    if (clock === undefined) delete globalThis.__xrFrameClock;
    else globalThis.__xrFrameClock = clock;
  }
});

test('a window swallows the turn and the crouch, then a held stick does not repeat them', () => {
  const had = bindings();
  const clock = globalThis.__xrFrameClock;
  try {
    setBindings(resetDefaults(createBindings()));
    globalThis.__xrFrameClock = {
      presenting: true,
      questMotor: () => ({
        strafe: 0, forward: 1, turn: 0.9, headYaw: 0,
        jump: false, run: false, crouch: true, attack: true, activate: false,
      }),
    };
    const cam = { yaw: 1, pitch: 0.3 };
    const keys = new Set(['KeyW']);
    const edges = { downFrame: new Set() };
    const latch = createDungeonQuestLatch();
    assert.equal(applyDungeonQuestInput(cam, keys, edges, latch, true), null);
    assert.equal(cam.yaw, 1);
    assert.equal(cam.pitch, 0.3);
    assert.equal(latch.analog, null);
    assert.equal(latch.snap, true);
    assert.equal(edges.downFrame.size, 0);
    assert.equal(keys.has('KeyW'), true);
    assert.equal(keys.has('JoystickAxis10Button0'), false);
    applyDungeonQuestInput(cam, keys, edges, latch, false);
    assert.equal(cam.yaw, 1);
    assert.equal(edges.downFrame.size, 0);
    assert.equal(keys.has('KeyW'), true);
    assert.equal(keys.has('JoystickAxis10Button0'), true);
  } finally {
    setBindings(had);
    if (clock === undefined) delete globalThis.__xrFrameClock;
    else globalThis.__xrFrameClock = clock;
  }
});

test('the frame clock publishes one sample and the getter goes null when the session ends', () => {
  const win = {
    requestAnimationFrame(cb) { this.pending = cb; return 1; },
    cancelAnimationFrame() { this.pending = null; },
  };
  const pending = new Map();
  let n = 1;
  const session = {
    inputSources: [{
      handedness: 'left',
      gamepad: {
        axes: [0, 0, 0, -1],
        buttons: [{ value: 0 }, { value: 0 }, { pressed: false }, { pressed: false }, { pressed: false }, { pressed: false }],
      },
    }, {
      handedness: 'right',
      gamepad: {
        axes: [0, 0, 0.9, 0],
        buttons: [{ value: 0.8 }, { value: 0 }, { pressed: false }, { pressed: false }, { pressed: true }, { pressed: false }],
      },
    }],
    requestAnimationFrame(cb) { const id = n++; pending.set(id, cb); return id; },
    cancelAnimationFrame(id) { pending.delete(id); },
    addEventListener() {},
    removeEventListener() {},
  };
  const layer = { framebuffer: {}, getViewport: () => ({ x: 0, y: 0, width: 10, height: 8 }) };
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const frame = {
    getViewerPose() {
      return { views: [{ vp: { x: 0, y: 0, width: 10, height: 8 } }], transform: { matrix } };
    },
  };
  const clock = createXrFrameClock({ win, setTarget: () => true, mirror: () => true });
  assert.equal(readQuestMotor(clock), null);
  assert.equal(clock.install(), true);
  assert.equal(clock.engage({ session, layer, refSpace: {} }), true);
  win.requestAnimationFrame(() => {});
  const batch = [...pending.entries()];
  pending.clear();
  for (const [, cb] of batch) cb(16, frame);
  const sample = readQuestMotor(clock);
  assert.equal(sample.forward, 1);
  assert.equal(sample.headYaw, 0);
  assert.equal(sample.jump, true);
  assert.equal(sample.attack, true);
  clock.disengage();
  assert.equal(readQuestMotor(clock), null);
  assert.equal(clock.questMotor(), null);
});
