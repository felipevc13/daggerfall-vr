// VR1 - Quest sticks for the dungeon motor, in the fishHost shape.
//
// The frame clock polls the controllers and publishes one sample. This
// file reads that clock. It does not import src/vr. A page without ?vr
// never creates the clock, and a session that is not presenting leaves
// the camera, the key set, and the pad throw alone.
//
// The sample's headYaw is the headset's yaw in tracking space. The
// dungeon view turns that head by cam.yaw, so the head's world yaw is
// cam.yaw + headYaw. The motor then turns forward/strafe by cam.yaw
// again, on the horizontal plane only. Rotating the stick by headYaw
// makes "forward" follow the head, and pitch never enters the vector.
// Snap turn writes cam.yaw. The motor collides. Nothing here writes a rig.

import { bindings } from '../ui/input.js';
import { codesForAction, isPadCode } from '../systems/inputActions.js';

export const QUEST_SNAP = 45 * (Math.PI / 180);
const SNAP_ON = 0.6;
const SNAP_OFF = 0.2;

const MODIFIERS = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

/** Body-space stick. x is strafe right, y is forward. headYaw and bodyYaw
 *  are world yaw: the difference is how far the head has turned from the
 *  body. Pitch is not an input. */
export function headRelativeAnalog(strafe, forward, headYaw, bodyYaw) {
  const sx = Number(strafe) || 0;
  const sy = Number(forward) || 0;
  const delta = (Number(headYaw) || 0) - (Number(bodyYaw) || 0);
  const c = Math.cos(delta);
  const s = Math.sin(delta);
  return {
    x: sx * c + sy * s,
    y: -sx * s + sy * c,
  };
}

/** One snap per push. Holding the stick does not turn again. Releasing
 *  below the inner threshold arms the next push. Positive x turns right. */
export function takeSnapTurn(latch, turnX) {
  const x = Number(turnX) || 0;
  if (Math.abs(x) > SNAP_ON) {
    if (!latch.snap) {
      latch.snap = true;
      return Math.sign(x) * QUEST_SNAP;
    }
    return 0;
  }
  if (Math.abs(x) < SNAP_OFF) latch.snap = false;
  return 0;
}

/** Rising edges. Held levels stay true while the button is down. */
export function questButtonEdges(prev, sample) {
  const attack = !!sample?.attack;
  const activate = !!sample?.activate;
  const crouch = !!sample?.crouch;
  const edges = {
    attackHeld: attack,
    activateHeld: activate,
    crouchHeld: crouch,
    attackEdge: attack && !prev.attack,
    activateEdge: activate && !prev.activate,
    crouchEdge: crouch && !prev.crouch,
  };
  prev.attack = attack;
  prev.activate = activate;
  prev.crouch = crouch;
  return edges;
}

export function createDungeonQuestLatch() {
  return {
    analog: null,
    snap: false,
    attack: false,
    activate: false,
    crouch: false,
    injected: new Set(),
  };
}

/** The clock's sample, or null. Same rule as the bridge getter: no
 *  presenting session, no sample. */
export function readDungeonQuestSample(clock = globalThis.__xrFrameClock) {
  if (!clock || clock.presenting !== true) return null;
  try {
    const sample = typeof clock.questMotor === 'function' ? clock.questMotor() : null;
    if (!sample || typeof sample !== 'object') return null;
    return sample;
  } catch {
    return null;
  }
}

function codeFor(action, nonMouse) {
  let codes = [];
  try { codes = codesForAction(bindings(), action); } catch { codes = []; }
  const pad = codes.find((c) => isPadCode(c));
  if (pad) return pad;
  return codes.find((c) => !MODIFIERS.has(c) && (!nonMouse || !String(c).startsWith('Mouse'))) ?? null;
}

function releaseInjected(keys, latch) {
  if (!keys || !latch?.injected) return;
  for (const code of latch.injected) keys.delete(code);
  latch.injected.clear();
}

function inject(keys, latch, code) {
  if (!keys || !code || keys.has(code)) return;
  keys.add(code);
  latch.injected.add(code);
}

/**
 * One frame. Null sample: does not write cam, keys, or latch.analog
 * beyond clearing a stick that is no longer there (analog becomes null
 * so the pad throw shows through). A live stick replaces latch.analog.
 * Buttons land in the key set the host already polls. Crouch is an edge
 * on the frame's down ring, not a held crouch.
 * @param {boolean} [blocked] a window is up: no turn, no stick, no buttons
 */
export function applyDungeonQuestInput(cam, keys, keyEdge, latch, blocked = false) {
  if (!latch) return null;
  releaseInjected(keys, latch);
  const live = readDungeonQuestSample();
  if (!live) {
    latch.analog = null;
    latch.snap = false;
    latch.attack = false;
    latch.activate = false;
    latch.crouch = false;
    return null;
  }
  // A window is up: no walk, no turn, no buttons. The latch still follows
  // the sticks, so closing the window on a held flick does not turn or crouch.
  if (blocked) {
    latch.analog = null;
    const x = Number(live.turn) || 0;
    if (Math.abs(x) > SNAP_ON) latch.snap = true;
    else if (Math.abs(x) < SNAP_OFF) latch.snap = false;
    questButtonEdges(latch, live);
    return null;
  }
  const sample = live;
  const body = Number(cam?.yaw) || 0;
  const tracking = Number.isFinite(sample.headYaw) ? sample.headYaw : 0;
  const analog = headRelativeAnalog(sample.strafe, sample.forward, body + tracking, body);
  latch.analog = (analog.x !== 0 || analog.y !== 0) ? analog : null;
  if (cam && typeof cam.yaw === 'number') cam.yaw += takeSnapTurn(latch, sample.turn);
  const edges = questButtonEdges(latch, sample);
  if (sample.jump) inject(keys, latch, codeFor('Jump', false));
  if (sample.run) inject(keys, latch, codeFor('Run', false));
  if (sample.attack) inject(keys, latch, codeFor('SwingWeapon', true));
  if (sample.activate) inject(keys, latch, codeFor('ActivateCenterObject', false));
  if (edges.crouchEdge && keyEdge?.downFrame) {
    const code = codeFor('Crouch', false);
    if (code) keyEdge.downFrame.add(code);
  }
  return edges;
}
