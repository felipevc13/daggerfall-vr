// VR1 - when the Enter VR plaque is allowed on /play/?vr.
//
// The front door is two real nodes, not a clock. #intro is the BEGIN gate
// and the film. #enhanced-menu is the Online/Offline door, and it is mounted
// while the film is still fading (introScreen.js enterMenu), so the plaque
// waits until the film node is gone. Before either node exists, a spinner
// stands in. A scene URL that never mounts the door (a probe's ?begin) does
// not wait. Nothing here is a timer. The query is read through pageHas.

import { pageHas } from '../systems/pageQuery.js';

const SKIP_DOOR = Object.freeze(['begin', 'nomenu', 'shot', 'interior', 'dungeon', 'world', 'exterior', 'region', 'loc']);

export function expectsFrontDoor(search) {
  if (search == null) return true;
  if (typeof search !== 'string') {
    if (typeof search.has !== 'function') return true;
    for (const key of SKIP_DOOR) if (search.has(key)) return false;
    return true;
  }
  for (const key of SKIP_DOOR) if (pageHas(key, search)) return false;
  return true;
}

/**
 * @param {{ intro?: boolean, menu?: boolean, seenDoor?: boolean, expectDoor?: boolean, session?: boolean }} state
 * @returns {{ button: boolean, loading: boolean, role: 'loading'|'hidden'|'enter'|'exit', seen: boolean }}
 */
export function enterChromeState({ intro = false, menu = false, seenDoor = false, expectDoor = true, session = false } = {}) {
  const introUp = !!intro;
  const menuUp = !!menu;
  const seen = !!(seenDoor || introUp || menuUp);
  if (session) return { button: true, loading: false, role: 'exit', seen };
  if (!expectDoor) return { button: true, loading: false, role: 'enter', seen };
  if (menuUp && !introUp) return { button: true, loading: false, role: 'enter', seen };
  if (introUp || seenDoor) return { button: false, loading: false, role: 'hidden', seen };
  return { button: false, loading: true, role: 'loading', seen: false };
}

export function applyEnterChrome(button, loader, state) {
  if (button) {
    button.hidden = !state.button;
    if (button.style) button.style.display = state.button ? '' : 'none';
  }
  if (loader) loader.hidden = !state.loading;
}

function connected(doc, id) {
  if (!doc || typeof doc.getElementById !== 'function') return false;
  let el = null;
  try { el = doc.getElementById(id); } catch { return false; }
  return !!(el && el.isConnected !== false);
}

/** A ring, no words. It is chrome, so the monitor does not treat it as a door. */
export function createEnterLoader(doc) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  const loader = doc.createElement('div');
  loader.setAttribute('data-vr-chrome', '');
  loader.setAttribute('data-vr-loading', '');
  loader.style.cssText = 'position:fixed;left:50%;top:50%;z-index:30;width:28px;height:28px;margin:0;'
    + 'border:3px solid #7d7460;border-top-color:#d8cfae;border-radius:50%;pointer-events:none;'
    + 'transform:translate(-50%,-50%);animation:vrspin 0.8s linear infinite;';
  const style = doc.createElement('style');
  style.setAttribute('data-vr-chrome', '');
  style.textContent = '@keyframes vrspin{from{transform:translate(-50%,-50%) rotate(0deg)}to{transform:translate(-50%,-50%) rotate(360deg)}}';
  try { doc.head?.appendChild(style); } catch { /* the ring still shows, it just does not turn */ }
  return loader;
}

export function attachEnterChrome({ doc, button, loader, expectDoor } = {}) {
  let seenDoor = false;
  let session = false;
  function read() {
    const intro = connected(doc, 'intro');
    const menu = connected(doc, 'enhanced-menu');
    const state = enterChromeState({
      intro,
      menu,
      seenDoor,
      expectDoor: typeof expectDoor === 'function' ? expectDoor() !== false : expectDoor !== false,
      session,
    });
    seenDoor = state.seen;
    return state;
  }
  function sync() {
    applyEnterChrome(button, loader, read());
  }
  let obs = null;
  const MO = doc?.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (typeof MO === 'function' && doc?.body && typeof doc.body !== 'string') {
    try {
      obs = new MO(sync);
      obs.observe(doc.body, { childList: true, subtree: true });
    } catch { obs = null; }
  }
  sync();
  return {
    sync,
    setSession(on) { session = !!on; sync(); },
    stop() { try { obs?.disconnect(); } catch { /* already gone */ } },
  };
}
