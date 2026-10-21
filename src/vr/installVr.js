// VR1 - the opt-in plug for /play/?vr.
//
// src/main.js dynamic-imports this module only when the page's search has
// `vr`. A flat /play/ never evaluates it. Every failure returns; the boot's
// own .catch is the second net. This step opens an immersive session and
// ends it: the host frame loop is the next change, not this one. Nothing
// here draws an eye, so a flat frame is unchanged whether or not the button
// is on the page.

import { probeVrEngineHooks } from './engineBridge.js';
import { endVrSession, immersiveVrSupported, makeEnterVrButton } from './xrSession.js';
import { relayVrLog } from './xrLog.js';

/**
 * Mount Enter VR on the real game, or mount nothing.
 * The second argument is for tests. The boot calls `installVr(renderer)`.
 *
 * @param {{ gl?: WebGL2RenderingContext, canvas?: HTMLCanvasElement }} renderer
 * @param {object} [hooks]
 * @returns {Promise<{ mounted: boolean, reason: string, missing?: string[] }>}
 */
export async function installVr(renderer, hooks = {}) {
  const probe = hooks.probeVrEngineHooks ?? probeVrEngineHooks;
  const supported = hooks.immersiveVrSupported ?? immersiveVrSupported;
  const makeButton = hooks.makeEnterVrButton ?? makeEnterVrButton;
  const endSession = hooks.endVrSession ?? endVrSession;
  const log = hooks.relayVrLog ?? relayVrLog;
  const doc = hooks.doc ?? (typeof document !== 'undefined' ? document : null);
  try {
    let found = null;
    try {
      found = await probe();
    } catch (err) {
      console.warn(log('warn', `VR off. The engine probe threw: ${err?.message ?? err}`));
      return { mounted: false, reason: 'hooks', missing: [] };
    }
    if (!found?.ok) {
      const missing = Array.isArray(found?.missing) ? found.missing : [];
      console.warn(log('warn', `VR off. Missing engine hooks: ${missing.join(', ') || 'unknown'}`));
      return { mounted: false, reason: 'hooks', missing };
    }
    let headset = false;
    try { headset = await supported() === true; } catch { headset = false; }
    if (!headset) return { mounted: false, reason: 'unsupported' };
    if (!doc?.body || !renderer?.gl) return { mounted: false, reason: 'no-surface' };

    let button = null;
    button = await makeButton({
      gl: renderer.gl,
      canvas: renderer.canvas ?? renderer.gl.canvas ?? null,
      doc,
      onEnter: async (opened) => {
        const session = opened?.session ?? null;
        try {
          console.log(log('info', 'The frame loop is not wired yet. Ending the session.'));
        } finally {
          try { await endSession(session); } catch { /* already ending */ }
          if (button) {
            button.disabled = false;
            button.style.display = '';
          }
        }
      },
      onError: (err) => {
        console.warn(log('warn', `VR session refused: ${err?.message ?? err}`));
      },
    });
    if (!button) return { mounted: false, reason: 'unsupported' };
    doc.body.appendChild(button);
    return { mounted: true, reason: 'ready' };
  } catch (err) {
    try { console.warn(log('warn', `VR install failed: ${err?.message ?? err}`)); } catch { /* the flat game continues */ }
    return { mounted: false, reason: 'error' };
  }
}
