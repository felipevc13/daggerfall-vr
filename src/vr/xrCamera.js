// VR1 - THE HEADSET'S CAMERA: a WebXR eye pose into the engine's own camera.
//
// The game has ONE camera convention and every world frame builds it the
// same way (scenes/world.js, scenes/exterior.js, scenes/interior.js,
// scenes/dungeon.js):
//
//   eye      = cam.pos
//   forward  = (sin yaw, 0, cos yaw) tilted by pitch
//   view     = lookAt(eye, eye + forward, [0, 1, 0])
//   proj     = mirrorProjectionX(perspective(fovY, aspect, near, far))
//
// `lookAt` and `perspective` are RIGHT-handed (world/mat4.js), and the world
// DATA is Daggerfall Unity's - LEFT-handed, x east, y up, z north (mat4's
// HANDEDNESS LAW). The mirror at the projection is the one correction that
// makes the left-handed data read the right way round. This module keeps that
// exact convention: it builds an eye, a forward and an up from the XR pose
// and hands them to the SAME lookAt / perspective / mirrorProjectionX, so
// every shader and every state flag (frontFace CW, cull BACK) sees what it
// always saw. It adds no camera of its own.
//
// WHAT IS NEW HERE (and only here):
//   - WebXR is RIGHT-handed, +x right, +y up, -z forward. The game's frame is
//     +x right, +y up, +z forward. The two differ by ONE sign: z. Every vector
//     below is mapped with `(x, y, z) -> (x, y, -z)` at `toGame`, the module's
//     single conversion.
//   - A VR eye is not the head: the XR view carries the eye's own offset from
//     the head centre and its own (asymmetric) frustum. Both are used - the
//     offset in the view, the frustum in the projection - so the picture is
//     the headset's own, not a guess.
//   - The RIG: the head is not the player. The body (player/motor.js) owns the
//     floor position and the facing (yaw); the headset rides on top, and its
//     own rotation is free. `rig` is `{ pos: [x, y, z] (the feet), yaw }`, and
//     the head pose is composed onto it here. Snap/smooth turn writes `rig.yaw`
//     (the body), never the head.

import { gameMat4, offCenterProjection } from './engineBridge.js';
const { lookAt, mirrorProjectionX } = gameMat4;

const DEG = Math.PI / 180;

/** VR1: one game metre is one headset metre.
 *  Classic units become metres when a mesh is read (`GLOBAL_SCALE` 0.025 in
 *  world/meshReader.js, DFU's MeshReader.GlobalScale). A dungeon block face is
 *  51.2 m, the body is 1.8 m, the eye is 1.7 m, and a door is about 2.4–3.2 m.
 *  WebXR's local-floor space is already metres. Applying 0.025 again would
 *  shrink the player to a few centimetres, so the headset delta is multiplied
 *  by 1 and the game position is left as the motor stored it. */
export const GAME_UNIT_IN_METERS = 1;

/** WebXR vector -> the game's frame: (x, y, z) -> (x, y, -z). The module's one
 *  handedness conversion (the file header's law). Answers a fresh triple. */
function toGame(x, y, z) { return [x, y, -z]; }

/** Rotate a rig-local vector by the rig's yaw into the world. The rig-local
 *  frame is right, up, forward (+x, +y, +z); a yaw turns local +z to the game's
 *  forward `(sin yaw, 0, cos yaw)`, which pins this matrix (mat4's HANDEDNESS:
 *  right is `(cos yaw, 0, -sin yaw)`). */
function rigRotate(local, yaw) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const [x, y, z] = local;
  return [x * cy + z * sy, y, -x * sy + z * cy];
}

/**
 * THE EYE, THE FORWARD AND THE UP of one XR view, in the world.
 *
 * @param {{ transform: { matrix: Float32Array|number[] } }} view  an XRView
 * @param {{ pos: number[], yaw: number }} rig  the body's feet and facing
 * @returns {{ eye: number[], forward: number[], up: number[] }}
 */
export function rigView(view, rig) {
  const m = view.transform.matrix;
  // Column-major pose (XRRigidTransform.matrix): col0 right, col1 up, col2
  // is the camera's +Z, which points backward. Forward is -col2. toGame
  // reflects each axis's z. That keeps a level head level (forward y is 0)
  // and a pitch up (positive rotation about the eye's right) looking up.
  const right = toGame(m[0], m[1], m[2]);
  const upXr = toGame(m[4], m[5], m[6]);
  const fwdXr = toGame(-m[8], -m[9], -m[10]);
  // The eye's own translation, already the move since the captured head when
  // the dungeon called headsetDeltaView. 1:1 with the headset. No IPD scale.
  const off = rigRotate([m[12], m[13], -m[14]], rig.yaw);
  const eye = [rig.pos[0] + off[0], rig.pos[1] + off[1], rig.pos[2] + off[2]];
  // The head's own axes, turned by the rig's yaw alone (not mirrored: the
  // view direction is the game's, the mirror is the projection's).
  const yaw = rig.yaw;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const turn = ([x, y, z]) => [x * cy + z * sy, y, -x * sy + z * cy];
  return { eye, forward: turn(fwdXr), up: turn(upXr), right: turn(right) };
}

/**
 * THE VIEW MATRIX for one XR view, in the engine's own convention: a
 * right-handed lookAt over the left-handed world (mat4's own). The eye's own
 * up is passed through, so a headset's ROLL is drawn - a flat frame always
 * passes [0, 1, 0].
 */
export function viewMatrix(view, rig) {
  const { eye, forward, up } = rigView(view, rig);
  return lookAt(eye, [eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]], up);
}

/**
 * THE PROJECTION MATRIX for one XR view: the eye's own asymmetric frustum (the
 * `fov` a headset reports is not centred - that is what a lens does), mirrored
 * exactly as the flat projection is (mat4's HANDEDNESS LAW). `near`/`far` are
 * the host's own, so a VR frame keeps the scene's depth range.
 */
export function projectionMatrix(view, near, far) {
  if (view?.projectionMatrix) {
    // The same mirror the flat lens uses. Negating only [0] leaves the
    // asymmetric centre [8] on the other side of the eye, and the two
    // optical centres diverge.
    const out = new Float32Array(view.projectionMatrix);
    return mirrorProjectionX(out);
  }
  // Fallback for legacy WebVR or test harnesses that supply view.fov
  if (view?.fov) {
    const f = view.fov;
    const l = -near * Math.tan(f.leftDegrees * DEG);
    const r = near * Math.tan(f.rightDegrees * DEG);
    const b = -near * Math.tan(f.downDegrees * DEG);
    const t = near * Math.tan(f.upDegrees * DEG);
    const raw = offCenterProjection(l, r, b, t, near, far);
    return raw ? mirrorProjectionX(raw) : null;
  }
  const raw = offCenterProjection(-0.04, 0.04, -0.04, 0.04, near ?? 0.05, far ?? 300);
  return raw ? mirrorProjectionX(raw) : null;
}

/** VR1: the same XR view with its translation replaced by the move since the
 *  captured head, times `metersPerGameUnit`. `eyeMatrices` then adds that
 *  delta to the game eye, so a still headset keeps the eye the motor chose
 *  and a crouch or a room-scale step is only the change. The rotation stays
 *  the eye's. The demo rig still passes the raw view and the feet; this is
 *  the dungeon's anchor, not a second camera. */
export function headsetDeltaView(view, neutral, metersPerGameUnit = GAME_UNIT_IN_METERS) {
  const src = view?.transform?.matrix;
  if (!src || !neutral || neutral.length < 3) return null;
  const scale = Number.isFinite(metersPerGameUnit) ? metersPerGameUnit : 1;
  const m = new Float32Array(src);
  m[12] = (Number(m[12]) - Number(neutral[0])) * scale;
  m[13] = (Number(m[13]) - Number(neutral[1])) * scale;
  m[14] = (Number(m[14]) - Number(neutral[2])) * scale;
  return { transform: { matrix: m }, projectionMatrix: view.projectionMatrix, fov: view.fov };
}

/** Both matrices and the eye, the three things a host's frame needs. */
export function eyeMatrices(view, rig, near, far) {
  const { eye, forward, up } = rigView(view, rig);
  return {
    eye,
    proj: projectionMatrix(view, near, far),
    view: lookAt(eye, [eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]], up),
  };
}
