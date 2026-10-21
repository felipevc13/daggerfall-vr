// VR1 - where a controller ray meets the title panel, and which page pixel that is.
//
// The panel is a quad in WebXR local-floor space: metres, +Y up, the runtime's
// own -Z forward. It is placed once, level, in front of the head. Pitch does
// not tilt it. Nothing here imports the engine.

export const PANEL_DISTANCE = 1.35;
export const PANEL_WIDTH = 1.6;
export const PANEL_DROP = 0.05;
export const PANEL_MAX_HEIGHT = 1.15;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function normalize3(v) {
  if (!v) return null;
  const x = num(v[0]);
  const y = num(v[1]);
  const z = num(v[2]);
  if (x == null || y == null || z == null) return null;
  const h = Math.hypot(x, y, z);
  if (!(h > 1e-8)) return null;
  return [x / h || 0, y / h || 0, z / h || 0];
}

/** Horizontal facing of an XR pose matrix. +Y is ignored, so a look up or
 *  down does not turn the panel. Null when the head has no horizontal axis. */
export function levelForward(matrix) {
  if (!matrix || matrix.length < 11) return null;
  const x = num(-matrix[8]);
  const z = num(-matrix[10]);
  if (x == null || z == null) return null;
  const h = Math.hypot(x, z);
  if (!(h > 1e-6)) return null;
  return [x / h || 0, 0, z / h || 0];
}

export function headPoint(matrix) {
  if (!matrix || matrix.length < 15) return null;
  const x = num(matrix[12]);
  const y = num(matrix[13]);
  const z = num(matrix[14]);
  if (x == null || y == null || z == null) return null;
  return [x, y, z];
}

/** Target-ray origin and the ray's forward (-Z of the pose). */
export function rayFromTransform(matrix) {
  if (!matrix || matrix.length < 15) return null;
  const origin = headPoint(matrix);
  const x = num(-matrix[8]);
  const y = num(-matrix[9]);
  const z = num(-matrix[10]);
  if (!origin || x == null || y == null || z == null) return null;
  const direction = normalize3([x, y, z]);
  if (!direction) return null;
  return { origin, direction };
}

export function panelSize(aspect, width = PANEL_WIDTH, maxHeight = PANEL_MAX_HEIGHT) {
  const a = Number(aspect);
  const ratio = a > 0.25 && a < 8 ? a : 16 / 9;
  let w = width;
  let h = w / ratio;
  if (h > maxHeight) {
    h = maxHeight;
    w = h * ratio;
  }
  return { width: w, height: h };
}

/** A level quad. `forward` is the horizontal direction from the head to the
 *  panel. The plane normal points back at the player. */
export function placePanel(head, forward, { distance = PANEL_DISTANCE, width = PANEL_WIDTH, aspect = 16 / 9, drop = PANEL_DROP } = {}) {
  const f = normalize3(forward);
  const eye = head && head.length >= 3 ? [num(head[0]), num(head[1]), num(head[2])] : null;
  if (!f || !eye || eye.some((v) => v == null)) return null;
  const right = normalize3(cross(f, [0, 1, 0]));
  if (!right) return null;
  const size = panelSize(aspect, width);
  return {
    center: [eye[0] + f[0] * distance, eye[1] - drop, eye[2] + f[2] * distance],
    right,
    up: [0, 1, 0],
    normal: [-f[0], -f[1], -f[2]],
    halfW: size.width / 2,
    halfH: size.height / 2,
  };
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Hit on the quad, or null. u is 0 on the left and 1 on the right. v is 0
 *  on the top and 1 on the bottom, matching a page. */
export function rayPanelHit(origin, direction, pose) {
  if (!pose || !origin || !direction) return null;
  const dir = normalize3(direction);
  const o = [num(origin[0]), num(origin[1]), num(origin[2])];
  if (!dir || o.some((v) => v == null)) return null;
  const denom = dot(dir, pose.normal);
  if (Math.abs(denom) < 1e-6) return null;
  const t = dot(sub(pose.center, o), pose.normal) / denom;
  if (!(t > 0.02)) return null;
  const hit = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t];
  const local = sub(hit, pose.center);
  const x = dot(local, pose.right);
  const y = dot(local, pose.up);
  if (Math.abs(x) > pose.halfW + 1e-6 || Math.abs(y) > pose.halfH + 1e-6) return null;
  return {
    u: (x / pose.halfW + 1) / 2,
    v: (1 - y / pose.halfH) / 2,
    t,
    point: hit,
  };
}

/** Page pixel for a hit. `rect` is the door's getBoundingClientRect. */
export function uvToClient(u, v, rect) {
  const left = num(rect?.left) ?? 0;
  const top = num(rect?.top) ?? 0;
  const width = num(rect?.width) ?? 0;
  const height = num(rect?.height) ?? 0;
  return { x: left + u * width, y: top + v * height };
}

/** The first hand whose ray meets the panel. The right hand wins a tie. */
export function aimHands(rays, pose) {
  if (!pose) return null;
  for (const hand of ['right', 'left']) {
    const ray = rays?.[hand];
    if (!ray) continue;
    const hit = rayPanelHit(ray.origin, ray.direction, pose);
    if (hit) return { hand, hit, trigger: !!ray.trigger };
  }
  return null;
}
