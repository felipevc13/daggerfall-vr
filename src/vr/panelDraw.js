// VR1 - the dark room and the panel quad, drawn with the runtime's own
// view and projection. The game's camera is not involved, and this file
// does not import the renderer. A missing shader turns the draw into a no-op.

const ROOM_VERT = 'attribute vec2 aClip; varying float vY; void main(){ vY=aClip.y; gl_Position=vec4(aClip,0.0,1.0); return; }';
const ROOM_FRAG = 'precision mediump float; varying float vY; void main(){ float t=clamp(vY*0.5+0.5,0.0,1.0); gl_FragColor=mix(vec4(0.025,0.03,0.045,1.0),vec4(0.11,0.13,0.17,1.0),t); return; }';
const PANEL_VERT = 'attribute vec3 aPos; attribute vec2 aUv; uniform mat4 uMvp; varying vec2 vUv; void main(){ vUv=aUv; gl_Position=uMvp*vec4(aPos,1.0); return; }';
const PANEL_FRAG = 'precision mediump float; varying vec2 vUv; uniform sampler2D uTex; uniform vec4 uColor; uniform float uTexOn; void main(){ vec4 tex=texture2D(uTex,vUv); gl_FragColor=mix(uColor,tex,uTexOn); return; }';

function compile(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl, vertSrc, fragSrc, attribs) {
  const vert = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vert || !frag) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  for (const [name, index] of attribs) gl.bindAttribLocation(program, index, name);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function mul4(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function corners(pose, pad, flipV) {
  const hw = pose.halfW + pad;
  const hh = pose.halfH + pad;
  const c = pose.center;
  const r = pose.right;
  const u = pose.up;
  const top = flipV ? 1 : 0;
  const bot = flipV ? 0 : 1;
  const at = (sx, sy, u0, v0) => {
    const p = [
      c[0] + r[0] * sx * hw + u[0] * sy * hh,
      c[1] + r[1] * sx * hw + u[1] * sy * hh,
      c[2] + r[2] * sx * hw + u[2] * sy * hh,
    ];
    return { p, u: u0, v: v0 };
  };
  const tl = at(-1, 1, 0, top);
  const tr = at(1, 1, 1, top);
  const bl = at(-1, -1, 0, bot);
  const br = at(1, -1, 1, bot);
  return [tl, tr, bl, bl, tr, br];
}

function pack(list) {
  const data = new Float32Array(list.length * 5);
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    data[i * 5] = q.p[0];
    data[i * 5 + 1] = q.p[1];
    data[i * 5 + 2] = q.p[2];
    data[i * 5 + 3] = q.u;
    data[i * 5 + 4] = q.v;
  }
  return data;
}

const UNPACK_RESET = [
  ['UNPACK_ALIGNMENT', 4],
  ['UNPACK_ROW_LENGTH', 0],
  ['UNPACK_SKIP_PIXELS', 0],
  ['UNPACK_SKIP_ROWS', 0],
  ['UNPACK_IMAGE_HEIGHT', 0],
  ['UNPACK_SKIP_IMAGES', 0],
  ['UNPACK_FLIP_Y_WEBGL', false],
  ['UNPACK_PREMULTIPLY_ALPHA_WEBGL', false],
  ['UNPACK_COLORSPACE_CONVERSION_WEBGL', null],
];

function drainErrors(gl) {
  try {
    for (let i = 0; i < 8; i++) {
      if (!gl.getError()) break;
    }
  } catch { /* a context that cannot report still tries the upload */ }
}

/** Put `source` in `tex`. Resets unpack state first: a bound pixel-unpack
 *  buffer or a leftover row length makes texImage2D fail without throwing,
 *  and an incomplete texture samples as black. The quad's v=0 is its top,
 *  so the canvas is stored unflipped. */
export function uploadPanelSource(gl, tex, source) {
  if (!gl || !tex || !source) return { ok: false, error: 0 };
  const saved = [];
  const unpack = gl.PIXEL_UNPACK_BUFFER;
  let prevBuf = null;
  if (unpack != null) {
    try { prevBuf = gl.getParameter(unpack); } catch { prevBuf = null; }
    try { gl.bindBuffer(unpack, null); } catch { /* this context has no unpack buffer */ }
  }
  for (const [name, fallback] of UNPACK_RESET) {
    const key = gl[name];
    if (key == null) continue;
    let before = null;
    try { before = gl.getParameter(key); } catch { before = null; }
    saved.push([key, before]);
    const value = name === 'UNPACK_COLORSPACE_CONVERSION_WEBGL' ? (gl.NONE ?? 0) : fallback;
    try { gl.pixelStorei(key, value); } catch { /* the pname is absent */ }
  }
  drainErrors(gl);
  let error = 0;
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    try { error = gl.getError() || 0; } catch { error = 0; }
  } catch { error = -1; }
  for (let i = saved.length - 1; i >= 0; i--) {
    const [key, before] = saved[i];
    if (before == null) continue;
    try { gl.pixelStorei(key, before); } catch { /* the safe value can stay */ }
  }
  if (unpack != null) {
    try { gl.bindBuffer(unpack, prevBuf); } catch { /* already unbound */ }
  }
  try { gl.bindTexture(gl.TEXTURE_2D, null); } catch { /* the next draw binds it */ }
  const ok = error === 0 || error === gl.NO_ERROR;
  return { ok, error: ok ? 0 : error };
}

/** A drawer bound to one GL context. `draw` returns true when both eyes were painted. */
export function createPanelDrawer(gl) {
  if (!gl) return { draw() { return false; }, setTexture() {}, dispose() {} };
  const room = link(gl, ROOM_VERT, ROOM_FRAG, [['aClip', 0]]);
  const panel = link(gl, PANEL_VERT, PANEL_FRAG, [['aPos', 0], ['aUv', 1]]);
  if (!room || !panel) {
    if (room) gl.deleteProgram(room);
    if (panel) gl.deleteProgram(panel);
    return { draw() { return false; }, setTexture() {}, dispose() {} };
  }
  const roomBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, roomBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const quadBuf = gl.createBuffer();
  const lineBuf = gl.createBuffer();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  let texOn = 0;
  let flipV = false;
  let capW = 0;
  let capH = 0;
  let capFbo = null;

  function setTexture(source) {
    if (!source) return { ok: false, error: 0 };
    const result = uploadPanelSource(gl, tex, source);
    if (result.ok) texOn = 1;
    return result;
  }

  function drawQuad(mvp, pose, pad, color, useTex) {
    const data = pack(corners(pose, pad, flipV && useTex));
    gl.useProgram(panel);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.uniformMatrix4fv(gl.getUniformLocation(panel, 'uMvp'), false, mvp);
    gl.uniform4fv(gl.getUniformLocation(panel, 'uColor'), color);
    gl.uniform1f(gl.getUniformLocation(panel, 'uTexOn'), useTex ? texOn : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (useTex) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.uniform1i(gl.getUniformLocation(panel, 'uTex'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Copy eye 0 into the quad's texture before the eyes are cleared.
   *  A blit keeps the eye's own pixels, so the quad can match that aspect.
   *  The texture's v=0 is the bottom of a framebuffer, and the quad's v=0
   *  is its top, so the draw flips v for this picture. */
  function captureEye(pack) {
    const view = pack?.views?.[0];
    const fb = pack?.framebuffer ?? null;
    const w = Math.round(Number(view?.width));
    const h = Math.round(Number(view?.height));
    if (!view || fb == null || !(w > 0) || !(h > 0)) return null;
    if (typeof gl.blitFramebuffer !== 'function' || typeof gl.createFramebuffer !== 'function') return null;
    let read = null;
    let drawFb = null;
    try {
      read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      drawFb = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
      if (!capFbo) capFbo = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (capW !== w || capH !== h) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        capW = w;
        capH = h;
      }
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, capFbo);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      gl.blitFramebuffer(view.x, view.y, view.x + view.width, view.y + view.height, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      texOn = 1;
      return { width: w, height: h };
    } catch {
      return null;
    } finally {
      try {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFb);
        gl.bindTexture(gl.TEXTURE_2D, null);
      } catch { /* the next draw binds the headset */ }
    }
  }

  function draw(eyes) {
    if (!eyes?.views?.length || !eyes.pose) return false;
    flipV = !!eyes.flipV;
    const fb = eyes.framebuffer ?? null;
    const depthOn = gl.isEnabled(gl.DEPTH_TEST);
    const blendOn = gl.isEnabled(gl.BLEND);
    const cullOn = gl.isEnabled(gl.CULL_FACE);
    const scissorOn = gl.isEnabled(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    let painted = 0;
    for (const eye of eyes.views) {
      if (!eye.projection || !eye.view || !(eye.width > 0) || !(eye.height > 0)) continue;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(eye.x, eye.y, eye.width, eye.height);
      gl.viewport(eye.x, eye.y, eye.width, eye.height);
      gl.clearColor(0.03, 0.035, 0.05, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(room);
      gl.bindBuffer(gl.ARRAY_BUFFER, roomBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const mvp = mul4(eye.projection, eye.view);
      drawQuad(mvp, eyes.pose, 0.012, [0.49, 0.45, 0.32, 1], false);
      drawQuad(mvp, eyes.pose, 0, [0.08, 0.09, 0.11, 1], true);
      const hit = eyes.hit;
      if (hit?.point) {
        const cursor = {
          center: hit.point,
          right: eyes.pose.right,
          up: eyes.pose.up,
          halfW: 0.012,
          halfH: 0.012,
        };
        drawQuad(mvp, cursor, 0, [0.95, 0.86, 0.45, 1], false);
        if (hit.rayOrigin) {
          gl.useProgram(panel);
          gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
          const line = new Float32Array([
            hit.rayOrigin[0], hit.rayOrigin[1], hit.rayOrigin[2], 0, 0,
            hit.point[0], hit.point[1], hit.point[2], 1, 1,
          ]);
          gl.bufferData(gl.ARRAY_BUFFER, line, gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(0);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
          gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
          gl.uniformMatrix4fv(gl.getUniformLocation(panel, 'uMvp'), false, mvp);
          gl.uniform4fv(gl.getUniformLocation(panel, 'uColor'), [0.95, 0.86, 0.45, 1]);
          gl.uniform1f(gl.getUniformLocation(panel, 'uTexOn'), 0);
          gl.drawArrays(gl.LINES, 0, 2);
        }
      }
      painted += 1;
    }
    if (scissorOn) gl.enable(gl.SCISSOR_TEST);
    else gl.disable(gl.SCISSOR_TEST);
    gl.disableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
    if (depthOn) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    if (blendOn) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    if (cullOn) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    return painted > 0 && painted === eyes.views.length;
  }

  function dispose() {
    gl.deleteProgram(room);
    gl.deleteProgram(panel);
    gl.deleteBuffer(roomBuf);
    gl.deleteBuffer(quadBuf);
    gl.deleteBuffer(lineBuf);
    gl.deleteTexture(tex);
  }

  return { draw, setTexture, captureEye, dispose };
}
