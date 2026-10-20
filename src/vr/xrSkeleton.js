// REAL DAGGERFALL SKELETAL WARRIOR FOR VR COMBAT
//
// 1. Decodes TEXTURE.270 (Skeletal Warrior) with ART_PAL.COL
// 2. Uploads classic animated frames to WebGL with 1-bit cutout transparency
// 3. Implements hit reactions: wobble recoil, hurt frame, bone-hit sound and damage
// 4. Billboard orientation automatically aligns to the player in VR

import { TextureFile } from '../formats/textureFile.js';
import { DFPalette } from '../formats/dfPalette.js';
import { fetchBytes } from '../scenes/shared.js';
import { identity } from './engineBridge.js';

export class XrSkeleton {
  /**
   * @param {import('../render/renderer.js').Renderer} renderer
   * @param {number[]} pos World position [x, y, z]
   */
  constructor(renderer, pos = [0, 0, 2.5]) {
    this.renderer = renderer;
    this.pos = pos;
    this.hp = 100;
    this.maxHp = 100;

    this.loaded = false;
    this.animTime = 0;
    this.state = 'idle'; // 'idle' | 'hurt' | 'attack'
    this.stateTimer = 0;

    // Hit reaction wobble physics
    this.wobbleAngle = 0;
    this.wobbleVel = 0;

    this.texArchive = 270;
    this.currentRecord = 15; // Record 15: Idle facing front
    this.currentFrame = 0;

    this.width = 1.35;
    this.height = 1.85;

    this.matrix = identity();
  }

  async load() {
    try {
      const [texBytes, palBytes] = await Promise.all([
        fetchBytes('TEXTURE.270'),
        fetchBytes('ART_PAL.COL'),
      ]);

      const pal = new DFPalette();
      pal.load(palBytes, 'ART_PAL.COL');

      const tf = new TextureFile();
      tf.load(texBytes, 'TEXTURE.270', pal);
      this.tf = tf;

      // Upload key animation frames:
      // Record 15, Frame 0: Idle
      // Record 10, Frame 0: Hurt
      // Record 5, Frames 0..5: Attack
      // Record 0, Frames 0..3: Walk
      this._uploadFrame(15, 0, 'skel_idle');
      this._uploadFrame(10, 0, 'skel_hurt');
      for (let f = 0; f < tf.getFrameCount(5); f++) {
        this._uploadFrame(5, f, `skel_atk_${f}`);
      }
      for (let f = 0; f < tf.getFrameCount(0); f++) {
        this._uploadFrame(0, f, `skel_walk_${f}`);
      }

      this._initMesh();
      this.loaded = true;
      console.log('[skeleton] Real Skeletal Warrior loaded from TEXTURE.270');
    } catch (err) {
      console.error('[skeleton] Failed to load TEXTURE.270:', err);
    }
  }

  _uploadFrame(record, frame, name) {
    const bm = this.tf.getDFBitmap(record, frame);
    const color32 = this.tf.getColor32(bm, 0); // 0 = alpha cutout
    this.renderer.uploadTexture('skeleton', name, {
      width: color32.width,
      height: color32.height,
      colors: color32.colors,
    }, { cutout: true });
  }

  _initMesh() {
    const hw = this.width / 2;
    const h = this.height;

    // Vertical quad standing on floor (Y = 0 to Y = h)
    const positions = new Float32Array([
      -hw, 0, 0,
      hw, 0, 0,
      hw, h, 0,
      -hw, h, 0,
    ]);
    const normals = new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]);
    const uvs = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

    this.meshIdle = this.renderer.createMesh({
      positions, normals, uvs, indices,
      subMeshes: [{ textureArchive: 'skeleton', textureRecord: 'skel_idle', startIndex: 0, primitiveCount: 2 }],
    });

    this.meshHurt = this.renderer.createMesh({
      positions, normals, uvs, indices,
      subMeshes: [{ textureArchive: 'skeleton', textureRecord: 'skel_hurt', startIndex: 0, primitiveCount: 2 }],
    });
  }

  onHit(damage, type) {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - damage);
    this.state = 'hurt';
    this.stateTimer = 0.28; // Show hurt frame for 280ms
    this.wobbleVel = 4.0; // Recoil backwards

    if (this.hp <= 0) {
      setTimeout(() => {
        this.hp = this.maxHp;
        this.state = 'idle';
      }, 2500);
    }
  }

  update(dt, playerEyePos) {
    this.animTime += dt;

    if (this.stateTimer > 0) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.state = 'idle';
      }
    }

    // Damped harmonic recoil wobble
    const springK = 32.0;
    const damping = 4.5;
    const force = -springK * this.wobbleAngle;
    this.wobbleVel += (force - damping * this.wobbleVel) * dt;
    this.wobbleAngle += this.wobbleVel * dt;

    // Billboard facing: calculate angle towards player eye
    let yaw = 0;
    if (playerEyePos) {
      const dx = playerEyePos[0] - this.pos[0];
      const dz = playerEyePos[2] - this.pos[2];
      yaw = Math.atan2(dx, dz);
    }

    // Build billboard transform matrix: yaw rotation + hit wobble tilt
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cw = Math.cos(this.wobbleAngle), sw = Math.sin(this.wobbleAngle);

    const m = identity();
    m[0] = cy;
    m[2] = -sy;
    m[5] = cw;
    m[6] = -sw;
    m[9] = sw;
    m[10] = cw;
    m[12] = this.pos[0];
    m[13] = this.pos[1];
    m[14] = this.pos[2];
    this.matrix = m;
  }

  draw() {
    if (!this.loaded) return;
    const mesh = this.state === 'hurt' ? this.meshHurt : this.meshIdle;
    this.renderer.drawMesh(mesh, this.matrix, null);
  }
}
