// LIVE IN-VR OPTICAL & STEREO CALIBRATOR
//
// Renders an in-world floating calibration panel and listens to Quest controller
// buttons (A, B, X, Y) to switch stereo modes live inside the headset.
// When the user finds the perfect, comfortable setting, they press Save,
// transmitting the winning profile to the development server.

import { gameMat4 } from './engineBridge.js';
const { identity } = gameMat4;

export class XrCalibrator {
  /**
   * @param {import('../render/renderer.js').Renderer} renderer
   */
  constructor(renderer) {
    this.renderer = renderer;

    // Available Presets
    this.presets = [
      {
        name: 'Preset 1: Natural Quest (out[0] only, eyeX=-1, 100% IPD)',
        eyeX: -1,
        ipdScale: 1.0,
        projMode: 'out0',
      },
      {
        name: 'Preset 2: Soft IPD (out[0] only, eyeX=-1, 75% IPD)',
        eyeX: -1,
        ipdScale: 0.75,
        projMode: 'out0',
      },
      {
        name: 'Preset 3: Gentle IPD (out[0] only, eyeX=-1, 50% IPD)',
        eyeX: -1,
        ipdScale: 0.50,
        projMode: 'out0',
      },
      {
        name: 'Preset 4: Inverted Stereo (eyeX=1, 100% IPD)',
        eyeX: 1,
        ipdScale: 1.0,
        projMode: 'out0',
      },
      {
        name: 'Preset 5: Inverted Stereo (eyeX=1, 75% IPD)',
        eyeX: 1,
        ipdScale: 0.75,
        projMode: 'out0',
      },
      {
        name: 'Preset 6: Full Mat4 Mirror (both m0 and m8, eyeX=-1)',
        eyeX: -1,
        ipdScale: 1.0,
        projMode: 'both',
      },
      {
        name: 'Preset 7: Full Mat4 Mirror (both m0 and m8, eyeX=1)',
        eyeX: 1,
        ipdScale: 1.0,
        projMode: 'both',
      },
      {
        name: 'Preset 8: Monoscopic 2D in 3D (eyeX=0, 0% IPD - zero eye strain)',
        eyeX: 0,
        ipdScale: 0.0,
        projMode: 'out0',
      },
    ];

    this.currentIndex = 0;
    this.saved = false;

    // Offscreen Canvas for crisp in-VR UI
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 640;
    this.ctx = this.canvas.getContext('2d');

    this.texArchive = 'vrcalibrate';
    this.texRecord = 'ui_calibrator';
    this.dirty = true;

    this._latchedA = false;
    this._latchedB = false;
    this._latchedX = false;
    this._latchedY = false;

    this._initMesh();
    this._renderCanvas();
  }

  get current() {
    return this.presets[this.currentIndex];
  }

  _initMesh() {
    const w = 1.4, h = 0.88;
    const hw = w / 2, hh = h / 2;

    const positions = new Float32Array([
      -hw, -hh, 0,
      hw, -hh, 0,
      hw, hh, 0,
      -hw, hh, 0,
    ]);
    const normals = new Float32Array([
      0, 0, -1,
      0, 0, -1,
      0, 0, -1,
      0, 0, -1,
    ]);
    const uvs = new Float32Array([
      0, 1,
      1, 1,
      1, 0,
      0, 0,
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

    this.mesh = this.renderer.createMesh({
      positions, normals, uvs, indices,
      subMeshes: [{
        textureArchive: this.texArchive,
        textureRecord: this.texRecord,
        startIndex: 0,
        primitiveCount: 2,
      }],
    });

    this.matrix = identity();
  }

  _renderCanvas() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const p = this.current;

    // Background panel
    ctx.fillStyle = 'rgba(12, 16, 24, 0.95)';
    ctx.fillRect(0, 0, w, h);

    // Golden Fantasy Border
    ctx.strokeStyle = this.saved ? '#00b894' : '#c08a3e';
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    // Title
    ctx.fillStyle = '#ffd32a';
    ctx.font = 'bold 38px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚙️ CALIBRAÇÃO ESTÉREO VR', w / 2, 60);

    ctx.fillStyle = '#dfe4ea';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`Preset ${this.currentIndex + 1} de ${this.presets.length}`, w / 2, 100);

    // Active Profile Box
    ctx.fillStyle = 'rgba(24, 32, 48, 0.9)';
    ctx.fillRect(40, 125, w - 80, 210);
    ctx.strokeStyle = '#485460';
    ctx.lineWidth = 3;
    ctx.strokeRect(40, 125, w - 80, 210);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText(p.name, w / 2, 175);

    ctx.fillStyle = '#70a1ff';
    ctx.font = '26px system-ui, sans-serif';
    ctx.fillText(`• Sinal dos Olhos (Eye X): ${p.eyeX}`, w / 2, 225);
    ctx.fillText(`• Escala de Separação (IPD): ${(p.ipdScale * 100).toFixed(0)}%`, w / 2, 265);
    ctx.fillText(`• Projeção das Lentes: ${p.projMode}`, w / 2, 305);

    // Controller button hints
    ctx.fillStyle = '#a4b0be';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText('🎮 CONTROLES NO QUEST:', w / 2, 385);

    ctx.fillStyle = '#eccc68';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('[A] ou [X]: Próximo Preset   |   [B]: Preset Anterior', w / 2, 430);

    // Save prompt
    if (this.saved) {
      ctx.fillStyle = '#2ed573';
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.fillText('✅ SALVO COM SUCESSO! TRANSMITIDO AO SERVIDOR!', w / 2, 530);
    } else {
      ctx.fillStyle = '#ff6b81';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText('[GATILHO DIREITO]: SALVAR ESTE PRESET PERFEITO', w / 2, 530);
    }

    ctx.fillStyle = '#747d8c';
    ctx.font = '19px system-ui, sans-serif';
    ctx.fillText('Olhe para a espada e para o esqueleto até a visão ficar 100% confortável.', w / 2, 595);

    // Upload to GPU
    const imgData = ctx.getImageData(0, 0, w, h);
    this.renderer.uploadTexture(this.texArchive, this.texRecord, {
      width: w,
      height: h,
      colors: imgData.data,
    });
  }

  /**
   * Polls controller button presses and updates live calibration
   * @param {import('./xrInput.js').XrInputManager} xrInput
   */
  pollInput(xrInput) {
    const right = xrInput.state.right;
    const left = xrInput.state.left;

    // Button A or X: Next preset
    const pressNext = right.aBtn || left.xBtn;
    if (pressNext && !this._latchedA) {
      this.currentIndex = (this.currentIndex + 1) % this.presets.length;
      this.saved = false;
      this._renderCanvas();
      console.log(`[CALIBRATOR] Switched to preset ${this.currentIndex + 1}: ${this.current.name}`);
    }
    this._latchedA = !!pressNext;

    // Button B or Y: Previous preset
    const pressPrev = right.bBtn || left.yBtn;
    if (pressPrev && !this._latchedB) {
      this.currentIndex = (this.currentIndex - 1 + this.presets.length) % this.presets.length;
      this.saved = false;
      this._renderCanvas();
      console.log(`[CALIBRATOR] Switched to preset ${this.currentIndex + 1}: ${this.current.name}`);
    }
    this._latchedB = !!pressPrev;

    // Right Trigger: Save profile
    if (right.trigger > 0.7 && !this._latchedY) {
      this.saved = true;
      this._renderCanvas();
      xrInput.pulseHaptic('right', 1.0, 100);
      console.log(`⭐ [CALIBRATOR WINNER CHOSEN] Preset ${this.currentIndex + 1}:`, JSON.stringify(this.current));
      
      // Send beacon
      fetch('/api/vr-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: 'info',
          message: `⭐ [CALIBRATOR WINNER CHOSEN] ${this.current.name} (EyeX: ${this.current.eyeX}, IPD: ${this.current.ipdScale}, Proj: ${this.current.projMode})`,
        }),
      }).catch(() => {});
    }
    this._latchedY = right.trigger > 0.7;
  }

  /**
   * Positions the floating panel in front of the player's current rig
   * @param {{ pos: number[], yaw: number }} rig
   */
  updatePosition(rig) {
    const dist = 1.6;
    const heightOffset = 1.35;
    const sin = Math.sin(rig.yaw);
    const cos = Math.cos(rig.yaw);

    const px = rig.pos[0] + sin * dist;
    const py = rig.pos[1] + heightOffset;
    const pz = rig.pos[2] + cos * dist;

    // Build rotation matrix facing player
    // Normal facing direction: (-sin, 0, -cos)
    const m = this.matrix;
    m[0] = cos;   m[1] = 0; m[2] = -sin; m[3] = 0;
    m[4] = 0;     m[5] = 1; m[6] = 0;    m[7] = 0;
    m[8] = sin;   m[9] = 0; m[10] = cos; m[11] = 0;
    m[12] = px;   m[13] = py; m[14] = pz; m[15] = 1;
  }

  draw() {
    this.renderer.drawMesh(this.mesh, this.matrix, null);
  }
}
