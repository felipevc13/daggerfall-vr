// VR1 - the page, on a quad, while the immersive session is up.
//
// The quad is a virtual monitor: one size, the viewport's picture, not the
// door element's box. #intro and #enhanced-menu still decide the title
// phase. When they leave, the loop stays up. A DOM screen that covers the
// view (chargen is one) keeps the monitor, because that screen is not in
// the WebGL framebuffer. A world that is drawing into the eyes, and the
// dungeon's own stereo pass, are left alone. /play/ without a session
// never starts the loop.

import { PANEL_ASPECT, aimHands, headPoint, levelForward, placePanel, uvToClient } from './panelHit.js';
import { dispatchPanelPointer, elementInRoot, triggerEdge } from './panelPointer.js';
import { releaseDoorPin, resolveDoorRect, rasterizeRoot } from './domRaster.js';
import { createPanelDrawer } from './panelDraw.js';
import { pageCovers, snapshotViewport, viewportBox } from './pageShot.js';
import { applyStickScroll, scrollableAt, stickScrollDelta, wheelBurst } from './panelScroll.js';
import { relayVrLog } from './xrLog.js';

export const DOOR_IDS = Object.freeze(['intro', 'enhanced-menu']);
const RASTER_MS = 250;

/** The cinematic, or the menu after it. Null once the player has left the door. */
export function frontDoorRoot(doc) {
  if (!doc || typeof doc.getElementById !== 'function') return null;
  for (const id of DOOR_IDS) {
    const el = doc.getElementById(id);
    if (el && el.isConnected !== false) return el;
  }
  return null;
}

/** 'off' with no session, 'title' while the door is mounted, 'world' after it leaves. */
export function panelPhase({ presenting, doorOpen }) {
  if (!presenting) return 'off';
  return doorOpen ? 'title' : 'world';
}

function eyeOf(view, rect) {
  const proj = view?.view?.projectionMatrix ?? view?.projectionMatrix ?? null;
  const inv = view?.view?.transform?.inverse?.matrix ?? view?.transform?.inverse?.matrix ?? null;
  if (!proj || !inv) return null;
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    projection: proj,
    view: inv,
  };
}

function safeDrawer(gl) {
  try { return createPanelDrawer(gl); } catch { return null; }
}

function canSnapshot(doc) {
  return !!(doc?.body && typeof globalThis.XMLSerializer === 'function' && typeof doc.createElement === 'function' && doc.defaultView);
}

export function createTitlePanel({ gl, doc, win, clock, now, onPhase, drawer: given, log, capture } = {}) {
  const time = now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const drawer = given ?? safeDrawer(gl) ?? { draw() { return false; }, setTexture() {}, dispose() {} };
  const shoot = capture ?? snapshotViewport;
  let alive = false;
  let frameId = null;
  let phase = 'off';
  let pose = null;
  let canvas = null;
  let paintedAt = 0;
  let busy = false;
  const trigger = { down: false };
  let captured = null;
  let aim = null;
  let toldKey = '';
  let lastStamp = 0;
  let deferred = false;
  const doorBox = {};

  function say(line) {
    try {
      if (log) log(line);
      else relayVrLog('info', line);
    } catch { /* the picture does not wait on the log */ }
  }

  function setPhase(next) {
    if (next === phase) return;
    phase = next;
    try { onPhase?.(phase); } catch { /* a test hook is not the session */ }
  }

  function viewFrame() {
    return viewportBox(win?.innerWidth, win?.innerHeight);
  }

  function lockPose() {
    if (pose) return pose;
    const forward = levelForward(clock?.viewerMatrix?.());
    const head = headPoint(clock?.viewerMatrix?.());
    if (!forward || !head) return pose;
    const next = placePanel(head, forward, { aspect: PANEL_ASPECT });
    if (!next) return pose;
    pose = next;
    return pose;
  }

  function publish(shot, mode, ms) {
    const uploaded = shot?.canvas ? drawer.setTexture(shot.canvas) : null;
    const frame = viewFrame();
    const key = `${phase}:${mode}`;
    if (toldKey === key) return;
    toldKey = key;
    const w = Math.round(frame.width);
    const h = Math.round(frame.height);
    say(`vr-panel:phase=${phase},shot=${mode},ms=${Math.max(0, Math.round(ms))},view=${w}x${h},nodes=${shot?.nodes ?? 0},texts=${shot?.texts ?? 0},images=${shot?.images ?? 0},tex=${uploaded?.ok ? 1 : 0},gl=${uploaded?.error ?? 0},pin=${frame.pinned ? 1 : 0}`);
  }

  function boxShot() {
    const root = doc?.body || doc?.documentElement || frontDoorRoot(doc);
    if (!root) return null;
    if (!canvas && typeof doc?.createElement === 'function') {
      try { canvas = doc.createElement('canvas'); } catch { canvas = null; }
    }
    const shot = rasterizeRoot(root, canvas, doc, viewFrame());
    return shot ? { ...shot, mode: 'box' } : null;
  }

  function raster(stamp) {
    if (busy) return;
    if (canvas && stamp - paintedAt < RASTER_MS) return;
    paintedAt = stamp;
    const t0 = time();
    if (!canSnapshot(doc)) {
      publish(boxShot(), 'box', time() - t0);
      return;
    }
    busy = true;
    Promise.resolve(shoot(doc, win, canvas, viewFrame())).then((shot) => {
      busy = false;
      if (!alive) return;
      if (shot?.canvas) publish(shot, shot.mode || 'svg', time() - t0);
      else publish(boxShot(), 'box', time() - t0);
    }, () => {
      busy = false;
      if (!alive) return;
      publish(boxShot(), 'box', time() - t0);
    });
  }

  function mirroring() {
    if (typeof clock?.claimed === 'function' && clock.claimed()) return false;
    if (frontDoorRoot(doc)) return true;
    return pageCovers(doc, win);
  }

  function hitRoot(door) {
    return doc?.body || door || doc?.documentElement || null;
  }

  function pointer(door, stamp) {
    const quad = lockPose();
    aim = quad ? aimHands(clock?.questRays?.(), quad) : null;
    const frame = viewFrame();
    const root = hitRoot(door);
    if (!aim || !root) {
      if (trigger.down && captured) dispatchPanelPointer(doc, root, { x: 0, y: 0 }, 'up', captured);
      trigger.down = false;
      captured = null;
      return;
    }
    const point = uvToClient(aim.hit.u, aim.hit.v, frame);
    const rays = clock?.questRays?.();
    const delta = stickScrollDelta(rays?.right?.stickY, stamp - lastStamp);
    if (delta) {
      const scroller = scrollableAt(doc, point.x, point.y);
      if (scroller && applyStickScroll(scroller, delta)) {
        wheelBurst(scroller, delta, doc);
        paintedAt = 0;
      }
    }
    const edge = triggerEdge(trigger, aim.trigger);
    if (edge.down) {
      captured = elementInRoot(doc, root, point.x, point.y);
      if (captured) dispatchPanelPointer(doc, root, point, 'down', captured);
    } else if (edge.up) {
      const target = captured ?? elementInRoot(doc, root, point.x, point.y);
      if (target) dispatchPanelPointer(doc, root, point, 'up', target);
      captured = null;
      paintedAt = 0;
    } else if (!trigger.down) {
      dispatchPanelPointer(doc, root, point, 'move');
    }
  }

  function drawEyes() {
    const pack = clock?.eyePack?.() ?? null;
    const quad = lockPose();
    if (!pack?.views?.length || !quad) return false;
    const views = [];
    for (const entry of pack.views) {
      const eye = eyeOf(entry, entry);
      if (eye) views.push(eye);
    }
    if (!views.length) return false;
    const hit = aim?.hit ? { point: aim.hit.point, rayOrigin: null } : null;
    const ray = clock?.questRays?.()?.[aim?.hand || 'right'];
    if (hit && ray?.origin) hit.rayOrigin = ray.origin;
    return drawer.draw({ framebuffer: pack.framebuffer ?? null, views, pose: quad, hit }) === true;
  }

  function paintIfNeeded() {
    if (!alive || !mirroring()) return false;
    const drew = drawEyes();
    if (drew) {
      try { clock?.claimStereo?.(); } catch { /* the copy would repeat one eye */ }
    }
    return drew;
  }

  function halt() {
    alive = false;
    releaseDoorPin(doorBox);
    try { clock?.setUnclaimed?.(null); } catch { /* the clock may not have the hook */ }
    pose = null;
    captured = null;
    trigger.down = false;
    if (frameId != null) {
      try { win?.cancelAnimationFrame?.(frameId); } catch { /* already fired */ }
      frameId = null;
    }
  }

  function tick(stamp) {
    frameId = null;
    const nowStamp = Number(stamp) || time();
    if (!alive) return;
    if (!clock?.presenting) {
      halt();
      setPhase('off');
      return;
    }
    const door = frontDoorRoot(doc);
    const next = panelPhase({ presenting: true, doorOpen: !!door });
    setPhase(next);
    if (door) resolveDoorRect(door, doorBox);
    else releaseDoorPin(doorBox);
    const show = mirroring();
    try {
      if (show) raster(nowStamp);
      else publish(null, 'eyes', 0);
    } catch { /* a bad snapshot leaves the previous picture */ }
    if (show) {
      try { pointer(door, nowStamp); } catch { /* the ray is not the session */ }
    } else if (trigger.down) {
      trigger.down = false;
      captured = null;
    }
    lastStamp = nowStamp;
    if (!deferred) {
      try { paintIfNeeded(); } catch { /* the copy still has the engine's frame */ }
    }
    if (!alive) return;
    try { frameId = win.requestAnimationFrame(tick); } catch { alive = false; }
  }

  return {
    start() {
      if (alive) return false;
      if (typeof win?.requestAnimationFrame !== 'function') return false;
      alive = true;
      if (typeof clock?.setUnclaimed === 'function') {
        deferred = true;
        try { clock.setUnclaimed(() => { try { paintIfNeeded(); } catch { /* the copy remains */ } }); }
        catch { deferred = false; }
      }
      try { frameId = win.requestAnimationFrame(tick); } catch { alive = false; return false; }
      return true;
    },
    stop() { halt(); },
    get phase() { return phase; },
  };
}
