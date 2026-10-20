// THE VR LAB (VR1, 2026-10-18). The proof that a hand-rolled WebGL2 frame can
// be drawn for a headset: a made-in-code room (no game data, the way
// tools/abyssLab.js is) rendered once per eye into the XRWebGLLayer's
// framebuffer, through the game's OWN Renderer and its own camera convention
// (world/mat4.js lookAt + mirrored perspective, exactly as scenes/world.js
// builds a flat frame).
//
// It exists because the seam it proves is the risky one and it is not the
// renderer's only path: the renderer draws the world straight into the canvas
// (no single "present" blit to redirect - render/renderer.js beginFrame's
// `this._frameTarget()` sites), so a headset needs an explicit target
// (setXrTarget) and a per-eye viewport. Everything else here - the box, the
// checker, the checker floor - is only there to give the eyes something with
// depth to disagree about.
//
//   ?x=&y=&z=&yaw=   the rig's feet and facing (metres, degrees)
//   ?eye=            the XR eye sign probe: 1 | -1, overriding VR_EYE_X
//   ?near=&far=      the lens (defaults 0.05 / 300)
//
// Flat (no headset) the page draws the same room from the rig's eye, so a
// desktop can see what the headset will. On a ?shot boot, `window.__frame` counts
// stereo frames (one per eye pair). `window.__lab` moves the rig from a probe.
import { Renderer, WORLD_FRAME } from '../render/renderer.js';
import { lookAt, perspective, mirrorProjectionX, identity, UP_Y } from '../world/mat4.js';
import { eyeMatrices, setVrEyeX, rigView } from '../vr/xrCamera.js';
import { enterVrSession, endVrSession, makeEnterVrButton, viewerPose, requestFrame } from '../vr/xrSession.js';
import { XrInputManager } from '../vr/xrInput.js';
import { pageHas, pageParam } from '../systems/pageQuery.js';
import { guardedSetXrTarget, probeVrEngineHooks } from '../vr/engineBridge.js';

function startVrLab() {
  const canvas = document.getElementById('c');
  const renderer = new Renderer(canvas);

  const NEAR = Number(pageParam('near') ?? 0.05);
  const FAR = Number(pageParam('far') ?? 300);
  const EYE_HEIGHT = 1.6;   // a standing eye, the way motor.js's EYE_HEIGHT is 1.7
  if (pageHas('eye')) setVrEyeX(Number(pageParam('eye')));   // the on-device sign probe (VR_EYE_X's note)
  const LIGHT_DIR = normalize([0.4, 0.82, 0.3]);
  const SKY_COLOR = new Float32Array([0.53, 0.7, 0.92, 1.0]); // Classic Daggerfall Iliac Bay pale sky

  const rig = {
    pos: [Number(pageParam('x') ?? 0), Number(pageParam('y') ?? 0), Number(pageParam('z') ?? 0)],
    yaw: (Number(pageParam('yaw') ?? 0) * Math.PI) / 180,
  };

  // A checker, and a flat wall colour: two pictures so a face is never a
  // uniform colour a depth error could hide in.
  const TEX_CHECK = 'check';
  const TEX_WALL = 'wall';
  upload('vrlab', TEX_CHECK, checker(64, [196, 186, 164], [92, 96, 104]));
  upload('vrlab', TEX_WALL, checker(16, [128, 126, 122], [112, 110, 108]));

  const floorMesh = renderer.createMesh(boxModel([-20, -0.1, -20], [20, 0, 20], TEX_CHECK));
  const wallMesh = renderer.createMesh(boxModel([-14, 0, 29], [14, 7, 30], TEX_WALL));   // a far wall: a depth reference dead ahead
  const posts = [];
  for (let i = 0; i < 6; i++) {
    const z = 3 + i * 4;
    const x = (i % 2 ? 2.2 : -2.2);
    posts.push(renderer.createMesh(boxModel([x - 0.35, 0, z - 0.35], [x + 0.35, 5, z + 0.35], i % 3 === 0 ? TEX_WALL : TEX_CHECK)));
  }
  // A short corridor of near posts either side of the eye: the pair a stereo
  // error shows up in worst (one passes on the wrong side).
  for (const dx of [-1.2, 1.2]) posts.push(renderer.createMesh(boxModel([dx - 0.25, 0, 1.25], [dx + 0.25, 3.2, 1.75], TEX_CHECK)));

  let presenting = false;
  let session = null, layer = null, refSpace = null;
  let rafId = 0;
  let frameCount = 0;
  if (pageHas('shot')) window.__frame = 0;

  // VR1: the flat preview - the same room from the rig's standing eye, so a
  // desktop sees the scene and the headset inherits the same rig.
  function drawFlat() {
    const ex = rig.pos[0], ey = rig.pos[1] + EYE_HEIGHT, ez = rig.pos[2];
    const cy = Math.cos(rig.yaw), sy = Math.sin(rig.yaw);
    const fwd = [sy, 0, cy];
    const view = lookAt([ex, ey, ez], [ex + fwd[0], ey + fwd[1], ez + fwd[2]], UP_Y);
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const proj = mirrorProjectionX(perspective((70 * Math.PI) / 180, aspect, NEAR, FAR));
    drawScene(proj, view);
  }

  // Near target box right in front of the player (2m ahead, at eye level 1.6m) to test convergence/IPD
  const targetMesh = renderer.createMesh(boxModel([-0.18, 1.42, 2.0], [0.18, 1.78, 2.36], TEX_CHECK));

  function drawScene(proj, view) {
    renderer.setMoonlight(null);
    renderer.setLighting(new Float32Array([0.5, 0.55, 0.6]), 1, new Float32Array([1, 0.96, 0.88]));
    renderer.setClearColor(SKY_COLOR);
    renderer.beginFrame(proj, view, LIGHT_DIR, WORLD_FRAME);
    renderer.drawMesh(floorMesh, identity(), null);
    renderer.drawMesh(wallMesh, identity(), null);
    for (const p of posts) renderer.drawMesh(p, identity(), null);
    renderer.drawMesh(targetMesh, identity(), null);
    renderer.resolveFrame();
  }

  function loop() {
    if (presenting) return;   // the XR clock has the frames now (one pending tick is dropped)
    drawFlat();
    if (pageHas('shot')) window.__frame = ++frameCount;   // the repo's own probe convention (bible/Home.md Process): a test waits on this
    rafId = requestAnimationFrame(loop);
  }

  /** DEBUG: visible log on the page so we can read it on the Quest */
  const debugEl = document.createElement('pre');
  debugEl.style.cssText = 'position:fixed;left:0;top:0;z-index:20;color:#0f0;background:rgba(0,0,0,0.85);font:11px monospace;padding:6px;max-height:50vh;overflow:auto;pointer-events:none;';
  document.body.appendChild(debugEl);
  const debugLines = [];
  function dbg(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    debugLines.push(line);
    if (debugLines.length > 30) debugLines.shift();
    debugEl.textContent = debugLines.join('\n');
    console.log('[vrlab]', msg);
  }

  const xrInput = new XrInputManager({ snapTurn: true, snapAngleDeg: 45, moveSpeed: 3.5 });
  let lastXrTime = 0;

  /** One XR animation frame: a pose, then one full frame per eye, each into the
   *  layer's viewport with the eye's own matrices. */
  function xrFrame(_time, frame) {
    if (!presenting || !session) return;
    const gl = renderer.gl;
    try {
      const dt = lastXrTime ? Math.min((_time - lastXrTime) / 1000, 0.1) : 0.016;
      lastXrTime = _time;

      // Quest controller input: thumbstick movement and snap turn
      xrInput.poll(session, refSpace, frame);
      xrInput.updateLocomotion(rig, dt);

      const pose = viewerPose(frame, refSpace);
      if (!pose) {
        dbg(`frame ${frameCount}: NO POSE`);
        requestFrame(session, xrFrame);
        return;
      }
      const views = pose.views;
      if (frameCount < 5 || frameCount % 120 === 0) {
        dbg(`frame ${frameCount}: ${views.length} views, layer fb=${!!layer.framebuffer}, fbW=${layer.framebufferWidth}x${layer.framebufferHeight}`);
      }
      for (let i = 0; i < views.length; i++) {
        const v = views[i];
        const vp = layer.getViewport(v);



        // --- RENDERER PATH: draw the actual scene on top ---
        try {
          if (!guardedSetXrTarget(renderer, layer.framebuffer, vp)) continue;
          const { proj, view } = eyeMatrices(v, rig, NEAR, FAR);
          if (frameCount < 3 && i === 0) {
            dbg(`proj[0..3]=${proj[0].toFixed(3)},${proj[5].toFixed(3)},${proj[10].toFixed(3)},${proj[14].toFixed(3)}`);
            dbg(`view[12..14]=${view[12].toFixed(2)},${view[13].toFixed(2)},${view[14].toFixed(2)}`);
          }
          drawScene(proj, view);
        } catch (drawErr) {
          dbg(`frame ${frameCount} eye${i}: DRAW ERROR: ${drawErr?.message ?? drawErr}`);
        }
      }
      if (pageHas('shot')) window.__frame = ++frameCount;
    } catch (err) {
      dbg(`FATAL xrFrame error: ${err?.message ?? err}\n${err?.stack ?? ''}`);
    }
    requestFrame(session, xrFrame);
  }

  function enterSession(opened) {
    session = opened.session; layer = opened.layer; refSpace = opened.refSpace;
    presenting = true;
    cancelAnimationFrame(rafId);
    session.addEventListener('end', onSessionEnd, { once: true });
    dbg('VR session started with native locomotion');
    requestFrame(session, xrFrame);
  }

  function onSessionEnd() {
    presenting = false;
    guardedSetXrTarget(renderer, null, null);   // VR1: the frame is the canvas's again
    session = null; layer = null; refSpace = null;
    lastXrTime = 0;
    rafId = requestAnimationFrame(loop);
  }

  // #region - made geometry and pictures
  function upload(archive, record, color32) { renderer.uploadTexture(archive, record, color32); }   // no opts: the plain `archive_record` key the sub-mesh draws by

  function checker(size, a, b) {
    const colors = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const on = ((x >> 2) + (y >> 2)) & 1;
        const c = on ? a : b;
        const i = (y * size + x) * 4;
        colors[i] = c[0]; colors[i + 1] = c[1]; colors[i + 2] = c[2]; colors[i + 3] = 255;
      }
    }
    return { width: size, height: size, colors };
  }

  function normalize(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

  // The same six-face order cardsLab.js mints, so the winding matches the
  // mirrored projection + frontFace CW the renderer already sets (mat4's law).
  function boxModel(min, max, tex) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const faces = [
      [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]],
      [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]],
      [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]],
      [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
    ];
    const positions = [], normals = [], uvs = [], indices = [];
    for (const f of faces) {
      const base = positions.length / 3;
      for (let i = 0; i < 4; i++) {
        positions.push(f[i][0], f[i][1], f[i][2]);
        normals.push(f[4][0], f[4][1], f[4][2]);
        uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return {
      positions: new Float32Array(positions), normals: new Float32Array(normals),
      uvs: new Float32Array(uvs), indices: new Uint32Array(indices),
      subMeshes: [{ textureArchive: 'vrlab', textureRecord: tex, startIndex: 0, primitiveCount: indices.length / 3 }],
    };
  }
  // #endregion

  // #region - the door and the probes
  const mount = document.getElementById('door');
  probeVrEngineHooks().then((probe) => {
    if (!probe.ok) {
      mount.textContent = `VR off (engine hooks missing: ${probe.missing.join(', ')})`;
      return null;
    }
    return makeEnterVrButton({
      gl: renderer.gl, canvas, label: 'Enter VR',
      depthNear: NEAR, depthFar: FAR,
      onEnter: enterSession,
      onError: (err) => { mount.textContent = String(err?.message ?? err); },
    });
  }).then((button) => { if (button) mount.append(button); });

  window.__lab = {
    rig: (x, y, z, yawDeg) => { rig.pos = [x, y, z]; rig.yaw = (yawDeg * Math.PI) / 180; },
    eye: (v) => setVrEyeX(v),
    view: (v) => rigView(v, rig),
    end: () => endVrSession(session),
    presenting: () => presenting,
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft') rig.yaw += 0.1;
    else if (e.code === 'ArrowRight') rig.yaw -= 0.1;
  });
  // #endregion

  loop();
  console.log(`vrlab: rig at ${rig.pos.join(',')} yaw ${(rig.yaw * 180 / Math.PI).toFixed(0)}deg; enter VR on a headset browser`);
}

if (typeof document !== 'undefined') startVrLab();
