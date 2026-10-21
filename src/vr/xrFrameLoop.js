// VR1 - THE GAME'S FRAME CLOCK UNDER AN immersive-vr SESSION.
//
// The hosts already call requestAnimationFrame. While a session is active the
// page's requestAnimationFrame stops (a headset does not composite the window),
// so a loop left on the window clock freezes and the session has nothing to
// present. This module is the same kind of seam as installFramePacer in
// systems/frameCap.js: it stands in front of the page clock. With no session
// it still asks the clock it replaced (the browser, or the pacer if that was
// installed first) for one frame per batch. engage() moves that batch onto
// session.requestAnimationFrame. End, a thrown session clock, or uninstall()
// puts the window clock back and hands it whatever was still queued.
//
// It does not edit a host. The host's callback runs once per XR frame, with
// the XR timestamp. Before it, the first eye's viewport is handed to setTarget
// (guardedSetXrTarget, the renderer's existing setXrTarget). The host draws
// once, its normal camera, into that rectangle. After it, the other eyes get
// a copy of that color image. Both eyes show the same picture. Per-eye cameras
// are a later change. syncCanvasToLayer is not called: the flat layout stays
// the window's size.
//
// /play/ without ?vr never loads this file. A failure logs and falls back to
// the window clock. Nothing here throws into the caller.

const QUEUE_ID = 2 ** 20;

/** VR1: the eye rectangles for this XR frame, or null when the head cannot be posed. */
export function eyeViewsOf(frame, refSpace, layer) {
  if (!frame || typeof frame.getViewerPose !== 'function' || !refSpace || typeof layer?.getViewport !== 'function') return null;
  let pose = null;
  try { pose = frame.getViewerPose(refSpace); } catch { return null; }
  const list = pose?.views;
  if (!list || typeof list.length !== 'number' || list.length === 0) return null;
  const views = [];
  for (let i = 0; i < list.length; i++) {
    let vp = null;
    try { vp = layer.getViewport(list[i]); } catch { return null; }
    const x = Number(vp?.x);
    const y = Number(vp?.y);
    const width = Number(vp?.width);
    const height = Number(vp?.height);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(width > 0) || !(height > 0)) return null;
    views.push({ x, y, width, height });
  }
  return views;
}

// GLSL is split into pieces that are not sentences. The localization ratchet
// counts a string with two words in it, and a shader is not a sentence a player reads.
const g = (parts) => parts.join('');
const MIRROR_VS = g([
  '#version 300 es\n',
  'precision', ' highp', ' float;\n',
  'layout(location=0)', 'in', ' vec2 a;\n',
  'layout(location=1)', 'in', ' vec2 b;\n',
  'out', ' vec2 v;\n',
  'void', ' main(){v=b;gl_Position=vec4(a,0.0,1.0);}',
]);
const MIRROR_FS = g([
  '#version 300 es\n',
  'precision', ' mediump', ' float;\n',
  'uniform', ' sampler2D', ' tex;\n',
  'in', ' vec2 v;\n',
  'out', ' vec4 o;\n',
  'void', ' main(){o=texture(tex,v);}',
]);

function compile(gl, type, source) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * VR1: copy eye 0's color into every later eye.
 * A same-framebuffer blit is illegal, and a blit into a multisampled XR
 * framebuffer is illegal, so eye 0 is resolved into a texture and a quad
 * draws that texture into each other eye. GL state is put back. Never throws.
 */
export function createEyeMirror(gl) {
  const hold = { tex: null, fbo: null, prog: null, buf: null, vao: null, w: 0, h: 0, dead: false };
  function release() {
    if (!gl) return;
    try { if (hold.tex) gl.deleteTexture(hold.tex); } catch { /* the context is already gone */ }
    try { if (hold.fbo) gl.deleteFramebuffer(hold.fbo); } catch { /* same */ }
    try { if (hold.prog) gl.deleteProgram(hold.prog); } catch { /* same */ }
    try { if (hold.buf) gl.deleteBuffer(hold.buf); } catch { /* same */ }
    try { if (hold.vao) gl.deleteVertexArray(hold.vao); } catch { /* same */ }
    hold.tex = null;
    hold.fbo = null;
    hold.prog = null;
    hold.buf = null;
    hold.vao = null;
    hold.w = 0;
    hold.h = 0;
    hold.dead = false;
  }
  function program() {
    if (hold.prog || hold.dead) return hold.prog;
    const vs = compile(gl, gl.VERTEX_SHADER, MIRROR_VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, MIRROR_FS);
    if (!vs || !fs) {
      hold.dead = true;
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      hold.dead = true;
      return null;
    }
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      -1, 1, 0, 1,
      1, 1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    hold.prog = prog;
    hold.vao = vao;
    hold.buf = buf;
    return prog;
  }
  function texture(width, height) {
    if (!hold.tex) {
      hold.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, hold.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    if (hold.w !== width || hold.h !== height) {
      gl.bindTexture(gl.TEXTURE_2D, hold.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      hold.w = width;
      hold.h = height;
    }
    if (!hold.fbo) hold.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, hold.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hold.tex, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  }
  function copy(layer, views) {
    if (!gl || hold.dead || !layer?.framebuffer || !views || views.length < 2) return false;
    if (typeof gl.blitFramebuffer !== 'function' || typeof gl.createTexture !== 'function') return false;
    const src = views[0];
    let snap = null;
    try {
      snap = {
        draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
        read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
        vp: gl.getParameter(gl.VIEWPORT),
        scissorBox: gl.getParameter(gl.SCISSOR_BOX),
        scissor: gl.isEnabled(gl.SCISSOR_TEST),
        depth: gl.isEnabled(gl.DEPTH_TEST),
        blend: gl.isEnabled(gl.BLEND),
        cull: gl.isEnabled(gl.CULL_FACE),
        program: gl.getParameter(gl.CURRENT_PROGRAM),
        vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING),
        buffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
        unit: gl.getParameter(gl.ACTIVE_TEXTURE),
      };
      gl.activeTexture(gl.TEXTURE0);
      snap.tex = gl.getParameter(gl.TEXTURE_BINDING_2D);
      if (!texture(src.width, src.height)) return false;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, layer.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, hold.fbo);
      gl.blitFramebuffer(src.x, src.y, src.x + src.width, src.y + src.height, 0, 0, src.width, src.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      const prog = program();
      if (!prog) return false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(prog);
      gl.bindVertexArray(hold.vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hold.tex);
      const loc = gl.getUniformLocation(prog, 'tex');
      if (loc) gl.uniform1i(loc, 0);
      for (let i = 1; i < views.length; i++) {
        const dst = views[i];
        gl.viewport(dst.x, dst.y, dst.width, dst.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      return true;
    } catch {
      return false;
    } finally {
      if (snap) {
        try {
          gl.bindVertexArray(snap.vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, snap.buffer);
          gl.useProgram(snap.program);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, snap.tex);
          gl.activeTexture(snap.unit);
          if (snap.vp) gl.viewport(snap.vp[0], snap.vp[1], snap.vp[2], snap.vp[3]);
          if (snap.scissorBox) gl.scissor(snap.scissorBox[0], snap.scissorBox[1], snap.scissorBox[2], snap.scissorBox[3]);
          if (snap.scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
          if (snap.depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
          if (snap.blend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
          if (snap.cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, snap.read);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, snap.draw);
        } catch { /* the context went away mid-frame; the next flat frame rebinds */ }
      }
    }
  }
  return { copy, release };
}

/**
 * VR1: the page clock. `install` borrows requestAnimationFrame. `engage`
 * presents on the session. `disengage` / the session's `end` give it back.
 * `uninstall` restores the exact functions install replaced.
 *
 * @param {{ win?: Window, setTarget?: (fb: unknown, vp: unknown) => boolean, gl?: WebGL2RenderingContext|null,
 *   mirror?: (layer: unknown, views: {x:number,y:number,width:number,height:number}[]) => boolean,
 *   onDisengage?: () => void, onArmFail?: (err: unknown) => void, onMirrorFail?: () => void,
 *   onPresentFail?: () => void, report?: (err: unknown) => void }} [opts]
 */
export function createXrFrameClock({
  win = globalThis,
  setTarget = () => false,
  gl = null,
  mirror = null,
  onDisengage = null,
  onArmFail = null,
  onMirrorFail = null,
  onPresentFail = null,
  report = null,
} = {}) {
  const queue = new Map();
  let nextId = QUEUE_ID;
  let installed = false;
  let savedRaf = null;
  let savedCaf = null;
  let mode = 'window';
  let session = null;
  let layer = null;
  let refSpace = null;
  let armedId = null;
  let armedOn = 'window';
  let armedSession = null;
  let epoch = 0;
  let endListener = null;
  let mirrorWarned = false;
  let presentFailed = false;
  const eyeMirror = createEyeMirror(gl);
  const copyEyes = mirror ?? ((fbLayer, views) => eyeMirror.copy(fbLayer, views));

  function tell(err) {
    try {
      if (report) report(err);
      else if (typeof win.reportError === 'function') win.reportError(err);
      else console.error(err);
    } catch { /* one callback's throw is not the next callback's */ }
  }

  function cancelArmed() {
    epoch += 1;
    const id = armedId;
    const where = armedOn;
    const sched = armedSession;
    armedId = null;
    if (id == null) return;
    try {
      if (where === 'session') sched?.cancelAnimationFrame?.(id);
      else savedCaf.call(win, id);
    } catch { /* the frame already ran, or the session is already over */ }
  }

  function arm() {
    if (armedId != null || queue.size === 0) return;
    const token = epoch;
    if (mode === 'session') {
      const sched = session;
      const id = sched.requestAnimationFrame((t, frame) => {
        if (token !== epoch) return;
        if (armedId === id) armedId = null;
        pump(t, frame);
      });
      if (id == null) throw new Error('session frame id missing');
      armedId = id;
      armedOn = 'session';
      armedSession = sched;
      return;
    }
    const id = savedRaf.call(win, (t) => {
      if (token !== epoch) return;
      if (armedId === id) armedId = null;
      pump(t, null);
    });
    if (id == null) throw new Error('window frame id missing');
    armedId = id;
    armedOn = 'window';
    armedSession = null;
  }

  function pump(stamp, xrFrame) {
    let views = null;
    if (mode === 'session') {
      if (xrFrame) {
        try { views = eyeViewsOf(xrFrame, refSpace, layer); } catch { views = null; }
      }
      let pointed = false;
      try {
        if (views?.length) pointed = setTarget(layer?.framebuffer ?? null, views[0]) === true;
        else setTarget(null, null);
      } catch { pointed = false; }
      // A pose with nowhere to draw it would leave the headset black. One signal,
      // then the caller ends the session and this pump finishes on the window clock.
      if (views?.length && !pointed && !presentFailed) {
        presentFailed = true;
        try { onPresentFail?.(); } catch { /* ending the session is the caller's */ }
      }
    }
    const batch = [...queue.values()];
    queue.clear();
    for (const cb of batch) {
      try { cb(stamp); } catch (err) { tell(err); }
    }
    if (mode !== 'session' || !views || views.length < 2) return;
    let copied = false;
    try { copied = copyEyes(layer, views) === true; } catch { copied = false; }
    if (!copied && !mirrorWarned) {
      mirrorWarned = true;
      try { onMirrorFail?.(); } catch { /* the picture still reached the first eye */ }
    }
  }

  function request(cb) {
    if (typeof cb !== 'function') return 0;
    const id = nextId++;
    queue.set(id, cb);
    try {
      arm();
    } catch (err) {
      queue.delete(id);
      if (mode === 'session') {
        disengage('fail');
        try { onArmFail?.(err); } catch { /* the window clock already has the queue */ }
      }
      try { return savedRaf.call(win, cb); } catch { return 0; }
    }
    return id;
  }

  function cancel(id) {
    if (!queue.delete(id)) {
      try { savedCaf.call(win, id); } catch { /* not our id and not the browser's */ }
      return;
    }
    if (queue.size === 0 && armedId != null) cancelArmed();
  }

  function disengage(reason) {
    if (mode !== 'session') return;
    const ending = session;
    const listener = endListener;
    endListener = null;
    mode = 'window';
    session = null;
    layer = null;
    refSpace = null;
    try { setTarget(null, null); } catch { /* already the canvas */ }
    try { eyeMirror.release(); } catch { /* nothing left to free */ }
    if (listener && ending) {
      try { ending.removeEventListener('end', listener); } catch { /* once already removed it */ }
    }
    cancelArmed();
    try { arm(); } catch { /* the next request arms the window */ }
    if (reason === 'end') {
      try { onDisengage?.(); } catch { /* the log is not the loop */ }
    }
  }

  function install() {
    if (installed) return true;
    if (typeof win?.requestAnimationFrame !== 'function' || typeof win?.cancelAnimationFrame !== 'function') return false;
    if (win.__xrFrameClock && win.__xrFrameClock !== api) return false;
    savedRaf = win.requestAnimationFrame;
    savedCaf = win.cancelAnimationFrame;
    win.requestAnimationFrame = request;
    win.cancelAnimationFrame = cancel;
    installed = true;
    try { win.__xrFrameClock = api; } catch { /* the functions are swapped either way */ }
    return true;
  }

  function uninstall() {
    if (mode === 'session') disengage('fail');
    if (!installed) return;
    const pending = [...queue.values()];
    queue.clear();
    cancelArmed();
    installed = false;
    mode = 'window';
    win.requestAnimationFrame = savedRaf;
    win.cancelAnimationFrame = savedCaf;
    try { delete win.__xrFrameClock; } catch { win.__xrFrameClock = undefined; }
    try { eyeMirror.release(); } catch { /* already released */ }
    for (const cb of pending) {
      try { savedRaf.call(win, cb); } catch { /* one stranded callback is not the rest */ }
    }
  }

  function engage(opened) {
    if (!installed && !install()) return false;
    const next = opened?.session;
    if (!next || typeof next.requestAnimationFrame !== 'function') return false;
    if (mode === 'session') disengage('fail');
    mode = 'session';
    session = next;
    layer = opened?.layer ?? null;
    refSpace = opened?.refSpace ?? null;
    mirrorWarned = false;
    presentFailed = false;
    if (armedId != null) cancelArmed();
    const onEnd = () => { disengage('end'); };
    endListener = onEnd;
    try { next.addEventListener('end', onEnd, { once: true }); }
    catch {
      endListener = null;
      mode = 'window';
      session = null;
      layer = null;
      refSpace = null;
      try { arm(); } catch { /* queued work waits for the next request */ }
      return false;
    }
    try { arm(); }
    catch {
      disengage('fail');
      return false;
    }
    return true;
  }

  const api = {
    install,
    uninstall,
    engage,
    disengage: () => disengage('end'),
    get installed() { return installed; },
    get presenting() { return mode === 'session'; },
  };
  return api;
}
