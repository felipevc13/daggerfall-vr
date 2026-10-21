// VR1 - the front door, on a quad, while the immersive session is up.
//
// #intro and #enhanced-menu are the page's own screens. This module does
// not import them. When both are gone the session stays up and this loop
// stops, so the world's own frames are the picture. /play/ without a
// session never starts the loop.

import { aimHands, headPoint, levelForward, placePanel, uvToClient } from './panelHit.js';
import { dispatchPanelPointer, elementInRoot, triggerEdge } from './panelPointer.js';
import { rasterizeRoot } from './domRaster.js';
import { createPanelDrawer } from './panelDraw.js';

export const DOOR_IDS = Object.freeze(['intro', 'enhanced-menu']);
const RASTER_MS = 100;

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

export function createTitlePanel({ gl, doc, win, clock, now, onPhase, drawer: given } = {}) {
  const time = now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const drawer = given ?? safeDrawer(gl) ?? { draw() { return false; }, setTexture() {}, dispose() {} };
  let alive = false;
  let frameId = null;
  let phase = 'off';
  let pose = null;
  let poseRoot = null;
  let canvas = null;
  let paintedAt = 0;
  let paintedRoot = null;
  const trigger = { down: false };
  let captured = null;
  let aim = null;

  function setPhase(next) {
    if (next === phase) return;
    phase = next;
    try { onPhase?.(phase); } catch { /* a test hook is not the session */ }
  }

  function lockPose(root) {
    if (pose && poseRoot === root) return pose;
    const forward = levelForward(clock?.viewerMatrix?.());
    const head = headPoint(clock?.viewerMatrix?.());
    if (!forward || !head) return pose;
    let aspect = 16 / 9;
    try {
      const rect = root.getBoundingClientRect();
      if (rect && rect.height > 0 && rect.width > 0) aspect = rect.width / rect.height;
    } catch { /* the previous quad stays */ }
    const next = placePanel(head, forward, { aspect });
    if (!next) return pose;
    pose = next;
    poseRoot = root;
    return pose;
  }

  function raster(root, stamp) {
    if (paintedRoot === root && stamp - paintedAt < RASTER_MS) return;
    if (!canvas && typeof doc?.createElement === 'function') {
      try { canvas = doc.createElement('canvas'); } catch { canvas = null; }
    }
    paintedAt = stamp;
    paintedRoot = root;
    const bitmap = rasterizeRoot(root, canvas, doc);
    if (bitmap) drawer.setTexture(bitmap);
  }

  function pointer(root) {
    const quad = lockPose(root);
    aim = quad ? aimHands(clock?.questRays?.(), quad) : null;
    const rect = root.getBoundingClientRect?.();
    if (!aim || !rect) {
      if (trigger.down && captured) dispatchPanelPointer(doc, root, { x: 0, y: 0 }, 'up', captured);
      trigger.down = false;
      captured = null;
      return;
    }
    const point = uvToClient(aim.hit.u, aim.hit.v, rect);
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

  function drawEyes(root) {
    const pack = clock?.eyePack?.() ?? null;
    const quad = lockPose(root);
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

  function tick(stamp) {
    frameId = null;
    if (!alive) return;
    if (!clock?.presenting) {
      alive = false;
      setPhase('off');
      return;
    }
    const root = frontDoorRoot(doc);
    const next = panelPhase({ presenting: true, doorOpen: !!root });
    setPhase(next);
    if (next !== 'title') {
      alive = false;
      pose = null;
      poseRoot = null;
      captured = null;
      trigger.down = false;
      return;
    }
    try { raster(root, Number(stamp) || time()); } catch { /* a bad snapshot leaves the previous picture */ }
    try { pointer(root); } catch { /* the ray is not the session */ }
    let drew = false;
    try { drew = drawEyes(root); } catch { drew = false; }
    if (drew) {
      try { clock.claimStereo?.(); } catch { /* the copy would repeat one eye */ }
    }
    if (!alive) return;
    try { frameId = win.requestAnimationFrame(tick); } catch { alive = false; }
  }

  return {
    start() {
      if (alive) return false;
      if (typeof win?.requestAnimationFrame !== 'function') return false;
      alive = true;
      try { frameId = win.requestAnimationFrame(tick); } catch { alive = false; return false; }
      return true;
    },
    stop() {
      alive = false;
      if (frameId != null) {
        try { win?.cancelAnimationFrame?.(frameId); } catch { /* already fired */ }
        frameId = null;
      }
    },
    get phase() { return phase; },
  };
}
