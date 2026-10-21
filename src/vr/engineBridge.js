// VR engine bridge. The stereo seam between src/vr and the DFO engine.
//
// Product shape: this repository is a VR mod for DFO
// (https://daggerfalljs.dev/, upstream https://github.com/Lattymoy/daggerfall-js-source).
// The flat game must keep booting when this module is absent or when an
// upstream merge drops a hook. src/main.js does not import src/vr. Pages that
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

// VR1: UI PRESENCE. Read-only questions the menu detector asks so it can
// tell "a modal is up" without a list of menus. Nothing here is called
// while a flat frame draws: src/main.js does not import src/vr, and these
// loaders run only when a headset page asks. Each import is dynamic and
// the answer is a status, never a throw, so an upstream rename degrades
// to "missing" and the other signals still answer.
//
//   input.hostPaused             the host's pause, once it has handed its
//                                hooks to an input layer (null before that)
//   enhancedOverlays.overlayOpen the DOM doors' close-arm stack
//   windowStack.pauseWhileOpen   the stack's own pause law, applied to a
//                                stack object the caller already holds
//
// The four hosts keep their stacks in closures. There is no global list
// to import. hostPaused() is how a host publishes the latch. A caller
// that holds a stack (a test, a later plug) passes that object through.

/** Names probeVrUiHooks reports. Same list the contract test pins. */
export const VR_UI_HOOKS = Object.freeze([
  'input.hostPaused',
  'enhancedOverlays.overlayOpen',
  'windowStack.makeWindowStack',
  'windowStack.pauseWhileOpen',
]);

let uiHooksPromise = null;

/** Load the three UI modules once. A failed import is a missing module. */
export function loadVrUiHooks() {
  if (!uiHooksPromise) {
    uiHooksPromise = (async () => {
      const out = { input: null, overlays: null, stack: null };
      try { out.input = await import('../ui/input.js'); } catch { out.input = null; }
      try { out.overlays = await import('../ui/enhanced/enhancedOverlays.js'); } catch { out.overlays = null; }
      try { out.stack = await import('../ui/windowStack.js'); } catch { out.stack = null; }
      return out;
    })();
  }
  return uiHooksPromise;
}

/** Which UI hooks are still exported. Missing names are not a crash. */
export async function probeVrUiHooks() {
  const mods = await loadVrUiHooks();
  const missing = [];
  if (typeof mods.input?.hostPaused !== 'function') missing.push('input.hostPaused');
  if (typeof mods.overlays?.overlayOpen !== 'function') missing.push('enhancedOverlays.overlayOpen');
  if (typeof mods.stack?.makeWindowStack !== 'function') missing.push('windowStack.makeWindowStack');
  if (typeof mods.stack?.pauseWhileOpen !== 'function') missing.push('windowStack.pauseWhileOpen');
  return { ok: missing.length === 0, missing };
}

/** @param {{ status: 'value', value: boolean } | { status: 'idle' } | { status: 'missing' } | { status: 'threw' }} */
function valueStatus(status, value) {
  return value === undefined ? { status } : { status, value };
}

/** The host's pause. `idle` is "no host has registered yet" (the boot
 *  menu). `missing` is "upstream dropped the export". `threw` is a read
 *  that failed — the caller treats that as "show the panel". */
export function readHostPaused(mods) {
  const fn = mods?.input?.hostPaused;
  if (typeof fn !== 'function') return valueStatus('missing');
  try {
    const v = fn();
    if (v == null) return valueStatus('idle');
    return valueStatus('value', !!v);
  } catch {
    return valueStatus('threw');
  }
}

/** True when a DOM door has registered a close arm. */
export function readOverlayOpen(mods) {
  const fn = mods?.overlays?.overlayOpen;
  if (typeof fn !== 'function') return valueStatus('missing');
  try {
    return valueStatus('value', !!fn());
  } catch {
    return valueStatus('threw');
  }
}

/** Whether one stack currently holds a pausing window.
 *  `paused()` is the latch. `pauseWhileOpen` is the same law the hosts
 *  OR onto the live slot for the frame before reconcile. A window with
 *  no `pauseWhileOpen: false` pauses (the engine's default). If that
 *  law itself is gone, a live top still counts: showing the panel is
 *  the failure mode. */
export function readStackModal(mods, stack, slot = null) {
  if (stack == null && slot == null) return valueStatus('value', false);
  const pauseWhileOpen = mods?.stack?.pauseWhileOpen;
  const pauses = (win) => {
    if (!win) return false;
    if (typeof pauseWhileOpen !== 'function') return true;
    try { return pauseWhileOpen(win) === true; } catch { return true; }
  };
  try {
    if (pauses(slot)) return valueStatus('value', true);
    if (stack && typeof stack.paused === 'function' && stack.paused()) return valueStatus('value', true);
    const top = stack && typeof stack.topWindow === 'function' ? stack.topWindow() : null;
    if (top && pauses(top)) return valueStatus('value', true);
    return valueStatus('value', false);
  } catch {
    return valueStatus('threw');
  }
}
