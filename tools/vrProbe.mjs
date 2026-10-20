// VR1 probe (src/tools/vrLab.js, vr.html). Boots vite in-process and drives
// Chromium, the way tools/screenshot.mjs does, and holds the two things a
// headset-free machine can still prove about the VR lane:
//
//   1. THE FLAT PREVIEW RENDERS. The lab's made room is drawn through the real
//      Renderer - no page error, and `window.__frame` advances. This covers the
//      renderer's VR seam (beginFrame's `_frameTarget`/viewport/scissor arms,
//      _restoreWorldViewport) on the path a desktop takes, so a mistake there
//      fails here and not only on a headset.
//   2. THE CAMERA MATH IS THE ENGINE'S OWN. An identity XR pose through
//      vr/xrCamera.js answers the game's camera exactly: the eye at the head's
//      height, forward down +z (mat4's HANDEDNESS LAW), finite matrices. This
//      is the one part of WebXR that is arithmetic and not a device.
//
// The headset-only parts (the session, the layer's framebuffer, the stereo
// read) are NOT covered here - they need a Quest. Usage: `node tools/vrProbe.mjs`.
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { port: 5201, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text()); } });

let ok = true;
const near = (a, b, t = 1e-4) => Math.abs(a - b) < t;

try {
  await page.goto('http://localhost:5201/vr.html?shot');
  await page.waitForFunction(() => typeof window.__frame === 'number' && window.__frame > 3, null, { timeout: 20000 });
  console.log('[vr] flat preview frames:', await page.evaluate(() => window.__frame));

  const math = await page.evaluate(async () => {
    const cam = await import('/src/vr/xrCamera.js');
    const rig = { pos: [0, 0, 0], yaw: 0 };
    // Column-major identity rotation, head 1.6 m over the floor origin.
    const identity = {
      transform: { matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1]) },
      fov: { upDegrees: 45, downDegrees: 45, leftDegrees: 45, rightDegrees: 45 },
    };
    const r = cam.rigView(identity, rig);
    const { proj, view } = cam.eyeMatrices(identity, rig, 0.05, 300);
    return {
      eye: r.eye, forward: r.forward, up: r.up,
      projFinite: Array.from(proj).every(Number.isFinite),
      viewFinite: Array.from(view).every(Number.isFinite),
    };
  });
  console.log('[vr] xrCamera identity:', JSON.stringify(math));
  if (!(near(math.eye[0], 0) && near(math.eye[1], 1.6) && near(math.eye[2], 0))) { ok = false; console.log('[FAIL] the eye is not the head at the rig'); }
  if (!(near(math.forward[0], 0) && near(math.forward[1], 0) && near(math.forward[2], 1))) { ok = false; console.log('[FAIL] forward is not the game\'s +z (mat4: HANDEDNESS)'); }
  if (!(near(math.up[0], 0) && near(math.up[1], 1) && near(math.up[2], 0))) { ok = false; console.log('[FAIL] up is not +y'); }
  if (!math.projFinite || !math.viewFinite) { ok = false; console.log('[FAIL] a matrix is not finite'); }
} catch (err) {
  ok = false;
  console.log('[FAIL] threw:', err.message);
}

await browser.close();
await server.close();
if (errors.length) { ok = false; console.log('[FAIL] page errors:', errors.length); }
console.log(ok ? 'VR PROBE PASS' : 'VR PROBE FAIL');
process.exit(ok ? 0 : 1);
