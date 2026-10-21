// VR1 - THE DUNGEON'S TWO EYES.
//
// The frame clock aims eye 0 and, unless this frame was claimed, copies that
// picture into the other eyes. This module is the claim. installVr publishes
// it on the clock as `dungeonEyes`. The dungeon host calls that door. No other
// host does, so the world and the interiors stay on the copy.
//
// For each XRView it points the renderer at that eye (`setTarget`, which is
// guardedSetXrTarget) and builds the eye from that view's projectionMatrix
// plus the view transform. The transform is the headset's rotation and its
// move since the head was captured, composed onto the game eye and the body's
// yaw. The player stays where the motor put them. Walk and collision keep
// using that body yaw; this pass does not retarget them.
//
// GAME_UNIT_IN_METERS is 1. See xrCamera.js. The headset delta is multiplied
// by it. The game eye is already in metres.
//
// A missing pose, one eye, a view without a projection, or a target that will
// not take the eye returns false before any draw, and the host paints its
// flat camera once so the copy still has a picture. A failure after a draw
// returns false without claiming, and the clock copies eye 0. Nothing here
// throws.

import { eyeMatrices, headsetDeltaView, GAME_UNIT_IN_METERS } from './xrCamera.js';

export { GAME_UNIT_IN_METERS };

/** The dungeon's perspective range. The headset builds its own projection
 *  from the session's depth, so installVr asks for this same far plane. */
export const DUNGEON_NEAR = 0.05;
export const DUNGEON_FAR = 800;

/**
 * @param {(fb: unknown, vp: {x:number,y:number,width:number,height:number}|null) => boolean} setTarget
 */
export function createDungeonStereo(setTarget) {
  let neutral = null;
  let session = null;

  function release() {
    neutral = null;
    session = null;
  }

  /**
   * Draw every eye, or draw none.
   * @returns {boolean} true only when every eye was drawn and the copy should not run
   */
  function paint(clock, draw, camera) {
    if (typeof draw !== 'function' || typeof setTarget !== 'function') return false;
    const eye = camera?.eye;
    const yaw = Number(camera?.yaw) || 0;
    if (!eye || eye.length < 3) return false;
    let pack = null;
    try { pack = clock?.eyePack?.() ?? null; } catch { pack = null; }
    if (!pack?.framebuffer || !pack.views || pack.views.length < 2 || !pack.head) return false;
    if (pack.session !== session || !neutral) {
      session = pack.session ?? null;
      neutral = [pack.head[0], pack.head[1], pack.head[2]];
    }
    const shots = [];
    for (let i = 0; i < pack.views.length; i++) {
      const rec = pack.views[i];
      if (!(rec.width > 0) || !(rec.height > 0)) return false;
      const posed = headsetDeltaView(rec.view, neutral, GAME_UNIT_IN_METERS);
      if (!posed?.projectionMatrix && !posed?.fov) return false;
      let mats = null;
      try { mats = eyeMatrices(posed, { pos: [eye[0], eye[1], eye[2]], yaw }, DUNGEON_NEAR, DUNGEON_FAR); }
      catch { mats = null; }
      if (!mats?.proj || !mats?.view || !mats.eye) return false;
      shots.push({
        proj: mats.proj,
        view: mats.view,
        eye: mats.eye,
        index: i,
        yaw,
        vp: { x: rec.x, y: rec.y, width: rec.width, height: rec.height },
      });
    }
    for (let i = 0; i < shots.length; i++) {
      let aimed = false;
      try { aimed = setTarget(pack.framebuffer, shots[i].vp) === true; } catch { aimed = false; }
      if (!aimed) {
        try { setTarget(pack.framebuffer, shots[0].vp); } catch { /* eye 0 stays where the clock put it */ }
        return false;
      }
      draw(shots[i]);
    }
    try { clock.claimStereo?.(); } catch { /* the copy would repeat eye 0; the eyes already differ */ }
    return true;
  }

  return { paint, release };
}
