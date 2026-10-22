// VR1 - THE WEBXR SESSION: the headset's door into the game.
//
// This module owns the ONE thing a browser will only give a page with a user
// gesture: an `immersive-vr` session, its reference space and its GL layer.
// It does NOT run the game's frame. The hosts (scenes/world.js and its three
// siblings) still own the loop body and still call requestAnimationFrame.
// The dungeon demo drives the XR clock itself (`requestFrame`). The real game
// does not: src/vr/xrFrameLoop.js moves the page's requestAnimationFrame onto
// the session while one is active, and puts the window clock back on end.
// Nothing in the hosts changes.
//
// A "Enter VR" press is the gesture. `makeEnterVrButton` builds the button; a
// host mounts it. The layer is the WebXR answer to the renderer's canvas: its
// framebuffer IS the default framebuffer for the context once
// `gl.makeXRCompatible()` has run, which is why the renderer needs an explicit
// target at all (render/renderer.js setXrTarget - the whole of its VR seam).
//
// WHAT THIS MODULE ASSUMES ABOUT THE BROWSER (all read through globalThis, so
// a headless test that has no XR sees `false` and nothing else):
//   - `navigator.xr` exists and `isSessionSupported('immersive-vr')` is true
//     (the Meta Quest Browser, Chrome on a tethered headset).
//   - `XRWebGLLayer`, `XRWebGLLayer`'s `getViewport`/`framebuffer`, and the
//     `local-floor` reference space are the standard ones.
// A browser without any of it simply never offers the button.

/** VR1: is there an XR device at all? Cheap, synchronous, and true on a
 *  headset's browser and false everywhere else - the gate for drawing a button. */
export function xrAvailable() {
  return typeof globalThis !== 'undefined' && !!globalThis.navigator?.xr;
}

/** VR1: will this device run an immersive session? Asks the browser; the press
 *  handler awaits it, and a `false` (or a refusal) means no button. */
export async function immersiveVrSupported() {
  const xr = globalThis.navigator?.xr;
  if (!xr?.isSessionSupported) return false;
  try { return await xr.isSessionSupported('immersive-vr'); } catch { return false; }
}

/**
 * VR1: OPEN A SESSION. The one call a gesture must reach (`optionalFeatures`
 * are requested, never required, so a browser that lacks `dom-overlay` still
 * starts the session - the menus then simply have no panel).
 *
 * @param {{ gl: WebGL2RenderingContext, canvas?: HTMLCanvasElement, optionalFeatures?: string[], domOverlayRoot?: Element|null }} opts
 * @returns {Promise<{ session: XRSession, layer: any, refSpace: XRReferenceSpace, refSpaceType: string }>}
 */
export async function enterVrSession({ gl, canvas = null, optionalFeatures = null, domOverlayRoot = null, depthNear = 0.05, depthFar = 300 } = {}) {
  const xr = globalThis.navigator?.xr;
  if (!xr) throw new Error('WebXR unavailable');
  const XRLayer = globalThis.XRWebGLLayer;
  if (!XRLayer) throw new Error('XRWebGLLayer unavailable');
  const features = optionalFeatures ?? ['local-floor', 'bounded-floor', 'hand-tracking'];
  const init = { optionalFeatures: features };
  if (domOverlayRoot) { init.domOverlay = { root: domOverlayRoot }; init.optionalFeatures = [...features, 'dom-overlay']; }
  const session = await xr.requestSession('immersive-vr', init);
  // A GL context must declare itself XR-compatible before a layer may take it.
  // Idempotent, and it can reject on a context the browser will not share - a
  // real failure, so it is thrown rather than swallowed.
  await gl.makeXRCompatible();
  const layer = new XRLayer(session, gl);
  if ('fixedFoveation' in layer) {
    try { layer.fixedFoveation = 1; } catch {}
  }
  session.updateRenderState({
    baseLayer: layer,
    depthNear,
    depthFar,
  });
  const refSpace = await session.requestReferenceSpace('local-floor');
  return { session, layer, refSpace, refSpaceType: 'local-floor' };
}

/** VR1: the canvas's backing store sized to the stereo layer. The browser keeps
 *  it in step on a headset; this makes a page whose canvas was sized for a flat
 *  display start at the layer's shape instead of the flat one. */
export function syncCanvasToLayer(canvas, layer) {
  if (!canvas || !layer) return;
  if (canvas.width !== layer.framebufferWidth) canvas.width = layer.framebufferWidth;
  if (canvas.height !== layer.framebufferHeight) canvas.height = layer.framebufferHeight;
}

/** VR1: the headset's pose this XR frame, or null when the head is outside
 *  tracking (the pose a frame must skip, never draw a guess from). */
export function viewerPose(frame, refSpace) {
  try { return frame.getViewerPose(refSpace) ?? null; } catch { return null; }
}

/** VR1: THE XR CLOCK. Under a session a host drives its loop with this instead
 *  of `requestAnimationFrame`: `cb` receives the XR frame the pose comes from,
 *  which is the only frame a WebXR draw may use. A no-op callback is safe
 *  after the session ends (`requestAnimationFrame` rejects), so end is caught
 *  by the host's own session `end` listener, not here. */
export function requestFrame(session, cb) {
  session.requestAnimationFrame(cb);
}

/** VR1: end the session. Idempotent; every host also listens for `end` so a
 *  headset's own exit (taken off, the menu key) runs the same unwind. */
export function endVrSession(session) {
  try {
    const done = session?.end?.();
    // A rejecting end() must not surface as an unhandled rejection on a flat page.
    if (done && typeof done.then === 'function') return done.then(() => {}, () => {});
    return done;
  } catch { /* already ending */ }
}

/**
 * VR1: THE "ENTER VR" BUTTON. Builds and returns a `<button>`, wired to open a
 * session and hand it to `onEnter`; it disables itself while a request is in
 * flight. The default hides the button once the session is live (the dungeon
 * demo). `hideOnEnter: false` leaves it up and the next click ends the session,
 * which is how the real game's page offers Exit while a monitor can still see
 * the window. `onGesture` runs synchronously at the start of an enter click,
 * before `requestSession`, so a frame clock can take the queue while the
 * browser is still producing window frames. `data-vr-chrome` keeps the button
 * out of the modal detector. A page with no XR shows nothing at all.
 *
 * @param {{ gl: WebGL2RenderingContext, canvas?: HTMLCanvasElement, label?: string,
 *          hideOnEnter?: boolean, exitLabel?: string, onGesture?: () => void,
 *          onEnter: (opened: any) => void, onError?: (err: any) => void, doc?: Document,
 *          hold?: boolean, onSession?: (live: any) => void }} opts
 * @returns {Promise<HTMLButtonElement|null>} the button, or null if none can ever work
 */
export async function makeEnterVrButton({ gl, canvas = null, label = 'Enter VR', hideOnEnter = true, exitLabel = 'Exit', onGesture = null, onEnter, onError = null, doc = (typeof document !== 'undefined' ? document : null), depthNear = 0.05, depthFar = 300, optionalFeatures = null, domOverlayRoot = null, hold = false, onSession = null } = {}) {
  if (!doc || !(await immersiveVrSupported())) return null;
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('data-vr-chrome', '');
  // The title foot owns both bottom corners (Tutorials on the left, Settings /
  // Overhauls / Screenshots on the right) and the in-game HUD owns the top
  // centre (compass) and the bottom centre (vitals). The sign-in mark is the
  // top-right corner. A short plaque on the right edge, under that mark and
  // above the foot, misses all of those, and it misses the chargen question,
  // which is centred in its pane. z-index 30 stays under the asset picker
  // (40) and over the menu host (12) and the HUD (4). #intro is the same
  // layer and is appended later, so it would cover this plaque for the whole
  // film. The plug does not fight that: it holds the plaque until
  // #enhanced-menu is up and #intro is gone (enterChrome.js). The spot stays
  // clear of Screenshots, which is the foot.
  // Only the button takes clicks.
  button.style.cssText = 'position:fixed;top:38%;right:16px;transform:translateY(-50%);z-index:30;' +
    'padding:6px 12px;font:600 12px system-ui,sans-serif;letter-spacing:0.14em;text-transform:uppercase;' +
    'color:#d8cfae;background:rgba(10,12,17,0.92);border:2px solid #7d7460;border-radius:0;' +
    'cursor:pointer;pointer-events:auto;white-space:nowrap;';
  let live = null;
  const note = () => { try { onSession?.(live); } catch { /* the plaque still shows the word */ } };
  const reset = () => {
    live = null;
    button.textContent = label;
    button.disabled = false;
    if (!hold) button.style.display = '';
    note();
  };
  if (hold) button.style.display = 'none';
  button.addEventListener('click', async () => {
    if (!hideOnEnter && live) {
      const current = live;
      live = null;
      button.disabled = true;
      try { endVrSession(current); } catch { reset(); }
      return;
    }
    if (!hideOnEnter) {
      try { onGesture?.(); } catch { /* the enter still runs; engage reports a dead clock */ }
    }
    button.disabled = true;
    try {
      const opened = await enterVrSession({ gl, canvas, depthNear, depthFar, optionalFeatures, domOverlayRoot });
      if (hideOnEnter) {
        button.style.display = 'none';
      } else {
        live = opened?.session ?? null;
        button.textContent = exitLabel;
        button.disabled = false;
        note();
        try { opened?.session?.addEventListener?.('end', reset, { once: true }); } catch { /* a session with no events still ends through the clock */ }
      }
      // Awaiting keeps a host that returns a promise from becoming an unhandled rejection. A sync host is unchanged.
      await onEnter?.(opened);
    } catch (err) {
      reset();
      onError?.(err);
      if (typeof console !== 'undefined') console.warn('[vr] the session was refused:', err?.message ?? err);
    }
  });
  return button;
}
