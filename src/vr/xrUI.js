// VR IN-WORLD HUD & FLOATING STATUS DISPLAY
//
// Renders dynamic player and enemy vitals into an in-world 3D panel.

import { identity } from '../world/mat4.js';

export class XrCombatUI {
  /**
   * @param {import('../render/renderer.js').Renderer} renderer
   * @param {number[]} pos [x, y, z] center of the panel
   * @param {number} yaw Facing angle
   */
  constructor(renderer, pos = [0, 1.8, 4.2], yaw = 0) {
    this.renderer = renderer;
    this.pos = pos;
    this.yaw = yaw;

    // Offscreen Canvas for high-res crisp VR text
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d');

    this.texArchive = 'vrcombat';
    this.texRecord = 'ui_panel';

    this.dirty = true;
    this.lastStrike = { type: 'Ready', damage: 0, speed: 0 };

    this._initMesh();
    this.updateData({ playerHp: 100, playerMaxHp: 100, dummyHp: 100, dummyMaxHp: 100 });
  }

  _initMesh() {
    const w = 1.6, h = 0.8;
    const hw = w / 2, hh = h / 2;

    // Single quad facing -Z (towards player at Z=0)
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

    // Model matrix
    this.matrix = identity();
    this.matrix[12] = this.pos[0];
    this.matrix[13] = this.pos[1];
    this.matrix[14] = this.pos[2];
  }

  recordStrike(type, damage, speed) {
    this.lastStrike = { type: type.toUpperCase(), damage, speed: speed.toFixed(1) };
    this.dirty = true;
  }

  updateData(data) {
    this.data = { ...this.data, ...data };
    this.dirty = true;
  }

  redraw() {
    if (!this.dirty) return;
    this.dirty = false;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 1. Dark Parchment / Slate Fantasy Card
    ctx.fillStyle = '#0f1218';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#c08a3e';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    ctx.strokeStyle = 'rgba(192, 138, 62, 0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(16, 16, w - 32, h - 32);

    // 2. Title Header
    ctx.fillStyle = '#f0d8a8';
    ctx.font = 'bold 38px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚔️ DAGGERFALL VR COMBAT DOJO', w / 2, 60);

    // 3. Dummy HP Section
    const dummyHp = this.data?.dummyHp ?? 100;
    const dummyMaxHp = this.data?.dummyMaxHp ?? 100;
    const dummyPct = Math.max(0, dummyHp / dummyMaxHp);

    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e86a5a';
    ctx.fillText(`🎯 TRAINING DUMMY: ${dummyHp} / ${dummyMaxHp} HP`, 50, 130);

    // Bar background
    ctx.fillStyle = '#222';
    ctx.fillRect(50, 145, 924, 30);
    // Bar fill
    ctx.fillStyle = dummyPct > 0.4 ? '#44b044' : dummyPct > 0.15 ? '#e6a817' : '#d63031';
    ctx.fillRect(50, 145, 924 * dummyPct, 30);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.strokeRect(50, 145, 924, 30);

    // 4. Last Strike Report
    ctx.fillStyle = '#f1f2f6';
    ctx.font = '30px system-ui, sans-serif';
    ctx.fillText('ÚLTIMO GOLPE:', 50, 230);

    if (this.lastStrike.damage > 0) {
      ctx.fillStyle = '#fffa65';
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.fillText(`${this.lastStrike.type}!  -${this.lastStrike.damage} DANO  (Velocidade: ${this.lastStrike.speed} m/s)`, 50, 280);
    } else {
      ctx.fillStyle = '#888';
      ctx.font = 'italic 28px system-ui, sans-serif';
      ctx.fillText('Balançe a espada com velocidade para acertar o alvo!', 50, 280);
    }

    // 5. Instruction / Controls Footer
    ctx.fillStyle = '#57606f';
    ctx.fillRect(30, 330, w - 60, 2);

    ctx.font = '22px system-ui, sans-serif';
    ctx.fillStyle = '#a4b0be';
    ctx.fillText('🕹️ Analógico Esquerdo: Andar / Strafe    |    🕹️ Analógico Direito: Snap Turn 45°', 50, 380);
    ctx.fillText('✋ Mão Direita: Espada 6DOF (Slash/Chop/Thrust)  |  ✋ Mão Esquerda: Tocha com Luz', 50, 420);
    ctx.fillText('⚡ Haptic Feedback: Vibração realista no controle a cada impacto!', 50, 460);

    // Upload to WebGL texture
    const imgData = ctx.getImageData(0, 0, w, h);
    this.renderer.uploadTexture(this.texArchive, this.texRecord, {
      width: w,
      height: h,
      colors: imgData.data,
    });
  }

  draw() {
    this.redraw();
    this.renderer.drawMesh(this.mesh, this.matrix, null);
  }
}
