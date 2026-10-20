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

import { lookAt, perspectiveOffCenter, mirrorProjectionX } from '../world/mat4.js';

const DEG = Math.PI / 180;

/** VR1 - THE HANDEDNESS SEAM, ONE SIGN, WRITTEN DOWN. The engine mirrors NDC x
 *  at the projection (mat4's HANDEDNESS LAW); that mirror flips the STEREO pair
 *  with it, so the two eyes' lateral offsets must be mirrored by the same sign
 *  or the depth reads INSIDE-OUT (a wall through a doorway sits behind it).
 *  The mirror is the view's and the projection's; this constant is the eye's.
/** VR1 - CALIBRATED QUEST OPTICS PROFILE (Preset 5):
 *  - eyeX = 1: Unmirrored controller and eye coordinate space matching physical Quest IPD
 *  - ipdScale = 0.75: 75% virtual IPD distance eliminating stereoscopic eye strain and strabismus
 *  - proj[0] = -proj[0]: Left-handed world parity mirror without disturbing optical lens center proj[8]
 */
export const VR_EYE_X = 1;
export const IPD_SCALE = 0.75;

export function vrEyeX() { return VR_EYE_X; }
export function setVrEyeX() {}
export function setStereoProfile() {}

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
  // The head's basis in XR space, column-major: right = col0, up = col1,
  // forward = -col2 (WebXR's camera looks down its own -z).
  const right = toGame(m[0], m[1], m[2]);
  const upXr = toGame(m[4], m[5], m[6]);
  const fwdXr = toGame(-m[8], -m[9], -m[10]);
  // The head's offset from the origin, mapped, with the stereo sign on x
  // (VR_EYE_X * IPD_SCALE) and the rig's yaw over it - the eye's world position.
  const off = rigRotate([VR_EYE_X * IPD_SCALE * m[12], m[13], -m[14]], rig.yaw);
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
    const out = new Float32Array(view.projectionMatrix);
    out[0] = -out[0];
    return out;
  }
  // Fallback for legacy WebVR or test harnesses that supply view.fov
  if (view?.fov) {
    const f = view.fov;
    const l = -near * Math.tan(f.leftDegrees * DEG);
    const r = near * Math.tan(f.rightDegrees * DEG);
    const b = -near * Math.tan(f.downDegrees * DEG);
    const t = near * Math.tan(f.upDegrees * DEG);
    return mirrorProjectionX(perspectiveOffCenter(l, r, b, t, near, far));
  }
  return mirrorProjectionX(perspectiveOffCenter(-0.04, 0.04, -0.04, 0.04, near ?? 0.05, far ?? 300));
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
