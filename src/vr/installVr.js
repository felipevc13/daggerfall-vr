// VR1 - the opt-in plug for /play/?vr.
//
// src/main.js dynamic-imports this module only when the page's search has
// `vr`. A flat /play/ never evaluates it. Every failure returns; the boot's
// own .catch is the second net. Entering VR engages the frame clock
// (xrFrameLoop.js): the host keeps its own callback, and that callback is
// driven by the session until the session ends. Both eyes get the host's
// one picture. Nothing here draws a second camera, and syncCanvasToLayer
// is not called.

import { guardedSetXrTarget, probeVrEngineHooks } from './engineBridge.js';
import { endVrSession, immersiveVrSupported, makeEnterVrButton } from './xrSession.js';
import { relayVrLog } from './xrLog.js';
import { createXrFrameClock } from './xrFrameLoop.js';

/**
 * Mount Enter VR on the real game, or mount nothing.
 * The second argument is for tests. The boot calls `installVr(renderer)`.
 *
 * @param {{ gl?: WebGL2RenderingContext, canvas?: HTMLCanvasElement, setXrTarget?: Function }} renderer
 * @param {object} [hooks]
 * @returns {Promise<{ mounted: boolean, reason: string, missing?: string[] }>}
 */
export async function installVr(renderer, hooks = {}) {
  const probe = hooks.probeVrEngineHooks ?? probeVrEngineHooks;
  const supported = hooks.immersiveVrSupported ?? immersiveVrSupported;
  const makeButton = hooks.makeEnterVrButton ?? makeEnterVrButton;
  const endSession = hooks.endVrSession ?? endVrSession;
  const say = hooks.relayVrLog ?? relayVrLog;
  const doc = hooks.doc ?? (typeof document !== 'undefined' ? document : null);
  const win = hooks.win ?? globalThis;
  const Clock = hooks.createXrFrameClock ?? createXrFrameClock;
  let clock = null;
  let live = null;
  const stop = (session) => {
    try { endSession(session ?? live); } catch { /* already ending */ }
    live = null;
  };
  try {
    let found = null;
    try {
      found = await probe();
    } catch (err) {
      console.warn(say('warn', `VR off. The engine probe threw: ${err?.message ?? err}`));
      return { mounted: false, reason: 'hooks', missing: [] };
    }
    if (!found?.ok) {
      const missing = Array.isArray(found?.missing) ? found.missing : [];
      console.warn(say('warn', `VR off. Missing engine hooks: ${missing.join(', ') || 'unknown'}`));
      return { mounted: false, reason: 'hooks', missing };
    }
    let headset = false;
    try { headset = await supported() === true; } catch { headset = false; }
    if (!headset) return { mounted: false, reason: 'unsupported' };
    if (!doc?.body || !renderer?.gl) return { mounted: false, reason: 'no-surface' };

    clock = Clock({
      win,
      gl: renderer.gl,
      setTarget: (fb, vp) => guardedSetXrTarget(renderer, fb, vp),
      onDisengage: () => {
        try { console.log(say('info', 'VR session ended. The window frame loop is back.')); } catch { /* the flat game continues */ }
      },
      onArmFail: () => {
        try { console.warn(say('warn', 'VR frame clock stopped. Ending the session.')); } catch { /* still end it */ }
        stop(live);
      },
      onPresentFail: () => {
        try { console.warn(say('warn', 'VR could not aim the frame at the headset. Ending the session.')); } catch { /* still end it */ }
        stop(live);
      },
      onMirrorFail: () => {
        try { console.warn(say('warn', 'VR could not copy the picture to the other eye. That eye may stay dark.')); } catch { /* the first eye still drew */ }
      },
    });
    if (!clock.install()) {
      console.warn(say('warn', 'VR off. This page has no frame clock to move.'));
      return { mounted: false, reason: 'no-clock' };
    }

    let button = null;
    button = await makeButton({
      gl: renderer.gl,
      canvas: renderer.canvas ?? renderer.gl.canvas ?? null,
      doc,
      hideOnEnter: false,
      onGesture: () => { try { clock.install(); } catch { /* engage reports a clock that will not arm */ } },
      onEnter: (opened) => {
        live = opened?.session ?? null;
        let on = false;
        try { on = clock.engage(opened) === true; } catch (err) {
          try { console.warn(say('warn', `VR frame loop failed: ${err?.message ?? err}`)); } catch { /* still end the session */ }
        }
        if (!on) {
          try { console.warn(say('warn', 'VR frame loop failed. Ending the session.')); } catch { /* still end the session */ }
          stop(live);
          return;
        }
        try { console.log(say('info', 'VR frame loop is on the headset. Both eyes show the same picture for now.')); } catch { /* the session is already up */ }
      },
      onError: (err) => {
        try { console.warn(say('warn', `VR session refused: ${err?.message ?? err}`)); } catch { /* the flat game continues */ }
      },
    });
    if (!button) {
      try { clock.uninstall(); } catch { /* already down */ }
      return { mounted: false, reason: 'unsupported' };
    }
    doc.body.appendChild(button);
    return { mounted: true, reason: 'ready' };
  } catch (err) {
    try { clock?.uninstall(); } catch { /* the flat game continues */ }
    try { console.warn(say('warn', `VR install failed: ${err?.message ?? err}`)); } catch { /* the flat game continues */ }
    return { mounted: false, reason: 'error' };
  }
}
