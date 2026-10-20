// VR COMBAT & WEAPON PHYSICS FOR QUEST STANDALONE
//
// 1. Tracks 6DOF controller poses for both hands (right = weapon, left = torch/shield)
// 2. Computes blade tip velocity and detects realistic physical swings (slash, chop, thrust)
// 3. Performs continuous blade-segment collision against target hitboxes
// 4. Triggers Quest haptics on impact and produces dynamic sound effects

import { identity } from './engineBridge.js';
import { VR_EYE_X } from './xrCamera.js';

/** Synthesizes procedural retro/fantasy sounds via WebAudio with zero latency */
class VrCombatAudio {
  constructor() {
    this.ctx = null;
  }

  _init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playSwing(pitchFactor = 1.0) {
    try {
      this._init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      // White noise burst shaped like a fast whoosh
      const bufferSize = this.ctx.sampleRate * 0.18;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(320 * pitchFactor, now);
      filter.frequency.exponentialRampToValueAtTime(750 * pitchFactor, now + 0.08);
      filter.frequency.exponentialRampToValueAtTime(200 * pitchFactor, now + 0.18);
      filter.Q.value = 3.5;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(now);
    } catch {}
  }

  playHit(isFlesh = true) {
    try {
      this._init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      // Heavy bass impact thud
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = isFlesh ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(isFlesh ? 120 : 240, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
      oscGain.gain.setValueAtTime(0.6, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(oscGain);
      oscGain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);

      // Metallic or bone crack clank
      const clank = this.ctx.createOscillator();
      const clankGain = this.ctx.createGain();
      clank.type = 'sawtooth';
      clank.frequency.setValueAtTime(isFlesh ? 480 : 1200, now);
      clank.frequency.exponentialRampToValueAtTime(isFlesh ? 180 : 600, now + 0.1);
      clankGain.gain.setValueAtTime(isFlesh ? 0.3 : 0.5, now);
      clankGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      clank.connect(clankGain);
      clankGain.connect(this.ctx.destination);
      clank.start(now);
      clank.stop(now + 0.12);
    } catch {}
  }
}

/** Generates procedural 3D box models with textures */
function createBoxModel(min, max, texArchive, texRecord) {
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
    subMeshes: [{ textureArchive: texArchive, textureRecord: texRecord, startIndex: 0, primitiveCount: indices.length / 3 }],
  };
}

/** Merges multiple raw models into a single mesh descriptor */
function mergeModels(models) {
  let totalPos = 0, totalNorm = 0, totalUv = 0, totalIdx = 0;
  for (const m of models) {
    totalPos += m.positions.length;
    totalNorm += m.normals.length;
    totalUv += m.uvs.length;
    totalIdx += m.indices.length;
  }
  const positions = new Float32Array(totalPos);
  const normals = new Float32Array(totalNorm);
  const uvs = new Float32Array(totalUv);
  const indices = new Uint32Array(totalIdx);
  const subMeshes = [];

  let posOffset = 0, normOffset = 0, uvOffset = 0, idxOffset = 0, vertexOffset = 0;
  for (const m of models) {
    positions.set(m.positions, posOffset);
    normals.set(m.normals, normOffset);
    uvs.set(m.uvs, uvOffset);
    for (let i = 0; i < m.indices.length; i++) {
      indices[idxOffset + i] = m.indices[i] + vertexOffset;
    }
    for (const sm of m.subMeshes) {
      subMeshes.push({
        textureArchive: sm.textureArchive,
        textureRecord: sm.textureRecord,
        startIndex: sm.startIndex + idxOffset,
        primitiveCount: sm.primitiveCount,
      });
    }
    vertexOffset += m.positions.length / 3;
    posOffset += m.positions.length;
    normOffset += m.normals.length;
    uvOffset += m.uvs.length;
    idxOffset += m.indices.length;
  }

  return { positions, normals, uvs, indices, subMeshes };
}

/** Rotates local vector by rig yaw */
function rigRotate(local, yaw) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const [x, y, z] = local;
  return [x * cy + z * sy, y, -x * sy + z * cy];
}

export class XrWeapons {
  /**
   * @param {import('../render/renderer.js').Renderer} renderer
   * @param {import('./xrInput.js').XrInputManager} xrInput
   */
  constructor(renderer, xrInput) {
    this.renderer = renderer;
    this.xrInput = xrInput;
    this.audio = new VrCombatAudio();

    // Weapon state
    this.currentWeaponType = 'longsword'; // 'longsword' | 'dagger' | 'battleaxe'
    this.weaponLength = 0.82; // meters
    this.bladeHiltOffset = 0.12;

    // 6DOF motion tracking
    this.lastTipPos = null;
    this.lastHiltPos = null;
    this.tipSpeed = 0;
    this.isSwinging = false;
    this.swingCooldown = 0;
    this.hitCooldown = 0;

    // Current world poses
    this.rightHand = { pos: [0, 0, 0], fwd: [0, 0, 1], up: [0, 1, 0], matrix: identity(), active: false };
    this.leftHand = { pos: [0, 0, 0], fwd: [0, 0, 1], up: [0, 1, 0], matrix: identity(), active: false };

    this._initMeshes();
  }

  _initMeshes() {
    // Textures for weapons
    const steelTex = 'weapon_steel';
    const goldTex = 'weapon_gold';
    const woodTex = 'weapon_wood';
    const flameTex = 'torch_flame';

    const uploadSolid = (record, r, g, b) => {
      this.renderer.uploadTexture('vrcombat', record, {
        width: 4, height: 4,
        colors: new Uint8Array(4 * 4 * 4).fill(255).map((val, idx) => {
          const c = idx % 4;
          return c === 0 ? r : c === 1 ? g : c === 2 ? b : 255;
        }),
      });
    };

    uploadSolid(steelTex, 210, 218, 225);
    uploadSolid(goldTex, 218, 175, 55);
    uploadSolid(woodTex, 92, 58, 33);
    uploadSolid(flameTex, 255, 140, 20);

    // 1. Longsword Mesh
    const hilt = createBoxModel([-0.02, -0.02, -0.16], [0.02, 0.02, 0.0], 'vrcombat', woodTex);
    const guard = createBoxModel([-0.12, -0.025, 0.0], [0.12, 0.025, 0.03], 'vrcombat', goldTex);
    const blade = createBoxModel([-0.028, -0.008, 0.03], [0.028, 0.008, 0.78], 'vrcombat', steelTex);
    const pommel = createBoxModel([-0.03, -0.03, -0.19], [0.03, 0.03, -0.16], 'vrcombat', goldTex);
    this.swordMesh = this.renderer.createMesh(mergeModels([hilt, guard, blade, pommel]));

    // 2. Torch Mesh (Left Hand)
    const torchWood = createBoxModel([-0.022, -0.022, -0.22], [0.022, 0.022, 0.22], 'vrcombat', woodTex);
    const torchHead = createBoxModel([-0.045, -0.045, 0.22], [0.045, 0.045, 0.35], 'vrcombat', goldTex);
    const flame = createBoxModel([-0.05, -0.05, 0.35], [0.05, 0.05, 0.50], 'vrcombat', flameTex);
    this.torchMesh = this.renderer.createMesh(mergeModels([torchWood, torchHead, flame]));
  }

  /**
   * Updates hand poses and performs swing calculation & collision check.
   * @param {{ pos: number[], yaw: number }} rig
   * @param {number} dt Delta time
   * @param {Array<{ id: string, pos: number[], radius: number, height: number, hp: number, onHit?: (damage: number, type: string) => void }>} targets
   */
  update(rig, dt, targets = []) {
    const state = this.xrInput.state;
    this.swingCooldown = Math.max(0, this.swingCooldown - dt);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);

    // 1. Track Right Hand (Weapon)
    if (state.right.pose) {
      this.rightHand.active = true;
      this._extractPose(state.right.pose, rig, this.rightHand);
    } else {
      this.rightHand.active = false;
    }

    // 2. Track Left Hand (Torch)
    if (state.left.pose) {
      this.leftHand.active = true;
      this._extractPose(state.left.pose, rig, this.leftHand);
    } else {
      this.leftHand.active = false;
    }

    if (!this.rightHand.active) return;

    // Calculate current hilt and tip in world space
    const hiltPos = [
      this.rightHand.pos[0] + this.rightHand.fwd[0] * this.bladeHiltOffset,
      this.rightHand.pos[1] + this.rightHand.fwd[1] * this.bladeHiltOffset,
      this.rightHand.pos[2] + this.rightHand.fwd[2] * this.bladeHiltOffset,
    ];
    const tipPos = [
      this.rightHand.pos[0] + this.rightHand.fwd[0] * this.weaponLength,
      this.rightHand.pos[1] + this.rightHand.fwd[1] * this.weaponLength,
      this.rightHand.pos[2] + this.rightHand.fwd[2] * this.weaponLength,
    ];

    if (this.lastTipPos && dt > 0.001) {
      const dx = tipPos[0] - this.lastTipPos[0];
      const dy = tipPos[1] - this.lastTipPos[1];
      const dz = tipPos[2] - this.lastTipPos[2];
      const dist = Math.hypot(dx, dy, dz);
      this.tipSpeed = dist / dt;

      // Detect whoosh / swing sound
      if (this.tipSpeed > 2.0 && this.swingCooldown <= 0) {
        this.isSwinging = true;
        this.swingCooldown = 0.28;
        this.audio.playSwing(Math.min(1.4, 0.8 + this.tipSpeed * 0.1));
        this.xrInput.pulseHaptic('right', 0.25, 30);
      } else if (this.tipSpeed < 1.0) {
        this.isSwinging = false;
      }

      // 3. Collision with targets (e.g. Dummy)
      if (this.hitCooldown <= 0 && this.tipSpeed > 1.4) {
        for (const target of targets) {
          if (this._checkSegmentTargetCollision(hiltPos, tipPos, target)) {
            this._handleHit(target, dx, dy, dz);
            break;
          }
        }
      }
    }

    this.lastTipPos = tipPos;
    this.lastHiltPos = hiltPos;
  }

  _handleHit(target, dx, dy, dz) {
    this.hitCooldown = 0.25; // Prevent multi-hit within same swing
    this.xrInput.pulseHaptic('right', 0.95, 80);
    this.audio.playHit(true);

    // Determine strike direction
    const speed = this.tipSpeed;
    let strikeType = 'slash';
    if (Math.abs(dy) > Math.hypot(dx, dz) * 1.2 && dy < 0) {
      strikeType = 'chop'; // Downward strike
    } else if (Math.abs(dz) > Math.hypot(dx, dy) * 1.3) {
      strikeType = 'thrust'; // Forward thrust
    }

    const baseDamage = strikeType === 'chop' ? 24 : strikeType === 'thrust' ? 18 : 20;
    const damage = Math.round(baseDamage * Math.min(2.0, speed / 2.0));

    if (typeof target.onHit === 'function') {
      target.onHit(damage, strikeType);
    }
  }

  _checkSegmentTargetCollision(p1, p2, target) {
    // Cylinder collision: target at target.pos with radius and height
    const tBase = target.pos;
    const tTopY = target.pos[1] + target.height;
    const radius = target.radius;

    // Sample 5 points along blade
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const x = p1[0] + (p2[0] - p1[0]) * t;
      const y = p1[1] + (p2[1] - p1[1]) * t;
      const z = p1[2] + (p2[2] - p1[2]) * t;

      if (y >= tBase[1] && y <= tTopY) {
        const dX = x - tBase[0];
        const dZ = z - tBase[2];
        if (Math.hypot(dX, dZ) <= radius) {
          return true;
        }
      }
    }
    return false;
  }

  _extractPose(xrPose, rig, outHand) {
    const m = xrPose.transform.matrix;
    // Map controller position directly (m[12] is +X right, m[13] is +Y up, -m[14] is +Z forward)
    const off = rigRotate([m[12], m[13], -m[14]], rig.yaw);
    outHand.pos = [rig.pos[0] + off[0], rig.pos[1] + off[1], rig.pos[2] + off[2]];

    // Map controller forward (+Z along weapon) and up
    const cy = Math.cos(rig.yaw), sy = Math.sin(rig.yaw);
    const turn = ([x, y, z]) => [x * cy + z * sy, y, -x * sy + z * cy];

    // WebXR controller forward (-Z in XR space maps to +Z in game space)
    outHand.fwd = turn([-m[8], -m[9], m[10]]);
    outHand.up = turn([m[4], m[5], -m[6]]);

    // Build model matrix for rendering
    outHand.matrix = this._buildModelMatrix(outHand.pos, outHand.fwd, outHand.up);
  }

  _buildModelMatrix(pos, fwd, up) {
    // Normalize axes
    const fx = fwd[0], fy = fwd[1], fz = fwd[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    const f = [fx / fl, fy / fl, fz / fl];

    const ux = up[0], uy = up[1], uz = up[2];
    const ul = Math.hypot(ux, uy, uz) || 1;
    const u = [ux / ul, uy / ul, uz / ul];

    // Right = up x fwd
    const rx = u[1] * f[2] - u[2] * f[1];
    const ry = u[2] * f[0] - u[0] * f[2];
    const rz = u[0] * f[1] - u[1] * f[0];

    const out = new Float32Array(16);
    out[0] = rx; out[1] = ry; out[2] = rz; out[3] = 0;
    out[4] = u[0]; out[5] = u[1]; out[6] = u[2]; out[7] = 0;
    out[8] = f[0]; out[9] = f[1]; out[10] = f[2]; out[11] = 0;
    out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1;
    return out;
  }

  /**
   * Renders the weapon in the right hand and torch in the left hand.
   */
  draw() {
    if (this.rightHand.active) {
      this.renderer.drawMesh(this.swordMesh, this.rightHand.matrix, null);
    }
    if (this.leftHand.active) {
      this.renderer.drawMesh(this.torchMesh, this.leftHand.matrix, null);
    }
  }
}
