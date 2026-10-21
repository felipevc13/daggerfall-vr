// VR engine bridge. The stereo seam between src/vr and the DFO engine.
//
// Product shape: this repository is a VR mod for DFO
// (https://daggerfalljs.dev/, upstream https://github.com/Lattymoy/daggerfall-js-source).
// The flat game must keep booting when this module is absent or when an
// upstream merge drops a hook. src/main.js reaches this folder only by a
// dynamic import of installVr.js, and only when the URL has ?vr. Pages that
// do import it ask this file whether the hooks are still there, and skip
// "Enter VR" when they are not.
//
// WHAT CROSSES HERE (the fragile hooks an upstream sync can delete):
//   - world/mat4.js perspectiveOffCenter, plus the camera helpers the eye
//     reuses (lookAt, perspective, mirrorProjectionX, identity, UP_Y).
//     Every src/vr file imports those through this module, not from mat4.
//   - render/renderer.js Renderer.setXrTarget and Renderer._frameTarget.
//     Hosts call guardedSetXrTarget. A missing method returns false.
//   - The context flag xrCompatible: true in the Renderer constructor is
//     pinned by test/vr/engineContract.test.js. makeXRCompatible() in
//     xrSession.js is the runtime fallback if a browser still accepts it.
//
// WHAT DOES NOT CROSS HERE YET. vrDungeon.js still imports the dungeon
// pipeline (formats, dungeonContext, the motor, lighting) and constructs
// Renderer itself. src/tools/vrLab.js constructs Renderer too. Moving that
// graph behind one dynamic adapter is the next step, written in
// docs/repo-map.md. Doing it in one pass would rewrite the test scene.

import * as mat4 from '../world/mat4.js';

/** The mat4 namespace. Callers use `gameMat4.lookAt` and the rest. Those
 *  names stay declared once, in world/mat4.js: a second `export const` of
 *  the same name is a duplicate declaration. */
export const gameMat4 = mat4;

/** The headset frustum. Null when upstream no longer exports it, so a caller
 *  can skip the eye instead of throwing at import time. The name here is
 *  not `perspectiveOffCenter`: that export already lives in world/mat4.js. */
export function offCenterProjection(left, right, bottom, top, near, far) {
  if (typeof mat4.perspectiveOffCenter !== 'function') return null;
  return mat4.perspectiveOffCenter(left, right, bottom, top, near, far);
}

/** Names that probeVrEngineHooks reports. Kept in one place so the contract
 *  test and the docs describe the same list. */
export const VR_ENGINE_HOOKS = Object.freeze([
  'mat4.lookAt',
  'mat4.perspective',
  'mat4.mirrorProjectionX',
  'mat4.identity',
  'mat4.UP_Y',
  'mat4.perspectiveOffCenter',
  'Renderer',
  'Renderer.setXrTarget',
  'Renderer._frameTarget',
]);

/** Pure check. `Renderer` may be null when the module failed to load. */
export function collectMissingHooks(mat4ns, Renderer) {
  const missing = [];
  for (const name of ['lookAt', 'perspective', 'mirrorProjectionX', 'identity', 'perspectiveOffCenter']) {
    if (typeof mat4ns?.[name] !== 'function') missing.push(`mat4.${name}`);
  }
  if (mat4ns?.UP_Y == null) missing.push('mat4.UP_Y');
  if (typeof Renderer !== 'function') missing.push('Renderer');
  else {
    if (typeof Renderer.prototype.setXrTarget !== 'function') missing.push('Renderer.setXrTarget');
    if (typeof Renderer.prototype._frameTarget !== 'function') missing.push('Renderer._frameTarget');
  }
  return missing;
}

/** Load the renderer and report every missing hook. A thrown import is a
 *  missing module, not a crash of the caller. */
export async function probeVrEngineHooks() {
  let Renderer = null;
  try {
    const mod = await import('../render/renderer.js');
    Renderer = mod.Renderer ?? null;
  } catch { /* missing.push happens below */ }
  const missing = collectMissingHooks(mat4, Renderer);
  return { ok: missing.length === 0, missing };
}

/** Point the world pass at one eye, or refuse. Never throws: a flat frame
 *  keeps drawing when the method has been removed. */
export function guardedSetXrTarget(renderer, framebuffer, viewport) {
  if (typeof renderer?.setXrTarget !== 'function') return false;
  try {
    renderer.setXrTarget(framebuffer, viewport);
    return true;
  } catch {
    return false;
  }
}
