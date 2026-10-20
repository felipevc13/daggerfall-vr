// VR IN-WORLD DIEGETIC MENU & CHARGEN SLATE
//
// Renders Daggerfall's 2D UI (Inventory/Paperdoll, Character Sheet,
// Map of Tamriel / Chargen, Options) into a floating 3D holographic panel.
// Interacted with via 6DOF Quest controller laser pointer & trigger click.

import { identity } from '../world/mat4.js';

export class XrMenu {
  /**
   * @param {import('../render/renderer.js').Renderer} renderer
   */
  constructor(renderer) {
    this.renderer = renderer;
    this.isOpen = false;
    this.activeTab = 'inventory'; // 'inventory' | 'stats' | 'chargen' | 'options'

    // Offscreen Canvas (1024x640) for high-resolution retro fantasy rendering
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 640;
    this.ctx = this.canvas.getContext('2d');

    this.texArchive = 'vrmenu';
    this.texRecord = 'ui_slate';
    this.dirty = true;

    // 3D Panel dimensions (1.28m x 0.8m)
    this.width = 1.28;
    this.height = 0.80;
    this.pos = [0, 1.5, 0];
    this.yaw = 0;
    this.matrix = identity();

    // Laser & Raycast state
    this.laserHit = null; // { x, y, z, u, v, px, py }
    this.laserBeam = { origin: [0, 0, 0], end: [0, 0, 0] };
    this._hoveredButton = null;
    this._lastHovered = null;
    this._triggerLatched = false;
    this._toggleLatched = false;

    // Interactive button definitions (in canvas pixel coords)
    this.buttons = [];

    // Character state
    this.charData = {
      name: 'Guerreiro de High Rock',
      race: 'Breton',
      class: 'Warrior',
      level: 1,
      gold: 350,
      weight: 24,
      maxWeight: 110,
      hp: 100,
      maxHp: 100,
      fatigue: 100,
      maxFatigue: 100,
      magicka: 40,
      maxMagicka: 40,
      stats: {
        Força: 65,
        Inteligência: 40,
        Vontade: 45,
        Agilidade: 60,
        Vitalidade: 70,
        Personalidade: 50,
        Velocidade: 55,
        Sorte: 50,
      },
    };

    // Selected province in Tamriel map
    this.selectedProvince = 'High Rock';

    this._initMesh();
    this._initLaserMesh();
    this._renderCanvas();
  }

  _initMesh() {
    const hw = this.width / 2;
    const hh = this.height / 2;

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
  }

  _initLaserMesh() {
    // Thin cylinder/line for the laser pointer
    const r = 0.003;
    const positions = new Float32Array([
      -r, 0, 0,
      r, 0, 0,
      r, 0, -1,
      -r, 0, -1,
    ]);
    const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

    this.laserMesh = this.renderer.createMesh({
      positions, normals, uvs, indices,
    });
    this.laserMatrix = identity();
  }

  toggle(rig) {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(rig);
    }
  }

  open(rig) {
    this.isOpen = true;
    this.reposition(rig);
    this.dirty = true;
  }

  close() {
    this.isOpen = false;
    this.laserHit = null;
  }

  reposition(rig) {
    const dist = 1.15;
    const heightOffset = 1.35;
    const sin = Math.sin(rig.yaw);
    const cos = Math.cos(rig.yaw);

    this.pos = [
      rig.pos[0] + sin * dist,
      rig.pos[1] + heightOffset,
      rig.pos[2] + cos * dist,
    ];
    this.yaw = rig.yaw;

    // Face the player: normal vector is (-sin, 0, -cos)
    const m = this.matrix;
    m[0] = cos;   m[1] = 0; m[2] = -sin; m[3] = 0;
    m[4] = 0;     m[5] = 1; m[6] = 0;    m[7] = 0;
    m[8] = sin;   m[9] = 0; m[10] = cos; m[11] = 0;
    m[12] = this.pos[0];
    m[13] = this.pos[1];
    m[14] = this.pos[2];
    m[15] = 1;
  }

  /**
   * Casts a ray from the right controller into the 3D menu plane.
   */
  _castRay(handPos, handFwd) {
    // Slate plane: center P = this.pos, Normal N = (sin yaw, 0, cos yaw)
    const N = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    const P = this.pos;
    const O = handPos;
    const D = handFwd;

    // dot(D, N)
    const denom = D[0] * N[0] + D[1] * N[1] + D[2] * N[2];
    if (Math.abs(denom) < 1e-4) return null;

    // t = dot(P - O, N) / dot(D, N)
    const t = ((P[0] - O[0]) * N[0] + (P[1] - O[1]) * N[1] + (P[2] - O[2]) * N[2]) / denom;
    if (t < 0.05 || t > 4.0) return null;

    const hit = [O[0] + t * D[0], O[1] + t * D[1], O[2] + t * D[2]];

    // Transform hit into slate local coordinates
    // Slate local X: (cos yaw, 0, -sin yaw)
    // Slate local Y: (0, 1, 0)
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const diff = [hit[0] - P[0], hit[1] - P[1], hit[2] - P[2]];
    const localX = diff[0] * cos - diff[2] * sin;
    const localY = diff[1];

    const hw = this.width / 2;
    const hh = this.height / 2;

    if (Math.abs(localX) > hw || Math.abs(localY) > hh) return null;

    const u = (localX + hw) / this.width;
    const v = (hh - localY) / this.height; // Top = 0, Bottom = 1
    const px = u * this.canvas.width;
    const py = v * this.canvas.height;

    return { pos: hit, distance: t, u, v, px, py };
  }

  /**
   * Polls input, handles laser raycast and button clicks
   * @param {import('./xrInput.js').XrInputManager} xrInput
   * @param {{ pos: number[], yaw: number }} rig
   */
  update(xrInput, rig) {
    const left = xrInput.state.left;
    const right = xrInput.state.right;

    // Toggle menu with [Y] or [X] button on left controller
    const togglePressed = left.yBtn || left.xBtn;
    if (togglePressed && !this._toggleLatched) {
      this.toggle(rig);
      xrInput.pulseHaptic('left', 0.5, 40);
    }
    this._toggleLatched = togglePressed;

    // Close with [B] if open
    if (this.isOpen && right.bBtn) {
      this.close();
      xrInput.pulseHaptic('right', 0.4, 30);
      return;
    }

    if (!this.isOpen) return;

    // Compute right hand ray
    if (right.pose && right.pose.transform) {
      const m = right.pose.transform.matrix;
      const yaw = rig.yaw;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);

      const fwdXr = [-m[8], -m[9], -m[10]];
      const handFwd = [
        fwdXr[0] * cy + (-fwdXr[2]) * sy,
        fwdXr[1],
        -fwdXr[0] * sy + (-fwdXr[2]) * cy,
      ];

      // Hand origin
      const rx = m[12], ry = m[13], rz = -m[14];
      const handPos = [
        rig.pos[0] + rx * cy + rz * sy,
        rig.pos[1] + ry,
        rig.pos[2] + -rx * sy + rz * cy,
      ];

      this.laserHit = this._castRay(handPos, handFwd);

      // Check hovered button
      this._hoveredButton = null;
      if (this.laserHit) {
        const { px, py } = this.laserHit;
        for (const btn of this.buttons) {
          if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
            this._hoveredButton = btn;
            break;
          }
        }
      }

      // Haptic buzz on new hover
      if (this._hoveredButton && this._hoveredButton !== this._lastHovered) {
        xrInput.pulseHaptic('right', 0.25, 15);
        this.dirty = true;
      }
      this._lastHovered = this._hoveredButton;

      // Click handling on Trigger pull
      const triggerPulled = right.trigger > 0.6;
      if (triggerPulled && !this._triggerLatched) {
        if (this._hoveredButton) {
          this._hoveredButton.onClick();
          xrInput.pulseHaptic('right', 0.65, 45);
          this.dirty = true;
        }
      }
      this._triggerLatched = triggerPulled;
    }

    this._renderCanvas();
  }

  _renderCanvas() {
    if (!this.dirty) return;
    this.dirty = false;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.buttons = [];

    // Background: Authentic Dark Fantasy Parchment
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, w, h);

    // Stone Frame
    ctx.strokeStyle = '#c49746';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    ctx.strokeStyle = '#3d2e14';
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, w - 36, h - 36);

    // --- TOP NAVIGATION TABS ---
    const tabs = [
      { id: 'inventory', label: '🎒 INVENTÁRIO' },
      { id: 'stats', label: '📜 FICHA DO HERÓI' },
      { id: 'chargen', label: '🗺️ MAPA DE TAMRIEL' },
      { id: 'options', label: '⚙️ OPÇÕES' },
    ];

    let tabX = 30;
    for (const tab of tabs) {
      const active = this.activeTab === tab.id;
      const tabW = 210, tabH = 46;

      ctx.fillStyle = active ? '#c49746' : '#1c2230';
      ctx.fillRect(tabX, 26, tabW, tabH);

      ctx.strokeStyle = active ? '#ffe082' : '#3d4b66';
      ctx.lineWidth = 2;
      ctx.strokeRect(tabX, 26, tabW, tabH);

      ctx.fillStyle = active ? '#111622' : '#e0e6ed';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tab.label, tabX + tabW / 2, 56);

      this.buttons.push({
        id: tab.id,
        x: tabX, y: 26, w: tabW, h: tabH,
        onClick: () => { this.activeTab = tab.id; },
      });

      tabX += tabW + 15;
    }

    // Close Button [X]
    ctx.fillStyle = '#8b2525';
    ctx.fillRect(w - 75, 26, 45, 46);
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 2;
    ctx.strokeRect(w - 75, 26, 45, 46);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', w - 52, 58);
    this.buttons.push({
      id: 'close',
      x: w - 75, y: 26, w: 45, h: 46,
      onClick: () => this.close(),
    });

    // --- TAB CONTENTS ---
    if (this.activeTab === 'inventory') {
      this._renderInventoryTab(ctx, w, h);
    } else if (this.activeTab === 'stats') {
      this._renderStatsTab(ctx, w, h);
    } else if (this.activeTab === 'chargen') {
      this._renderChargenTab(ctx, w, h);
    } else if (this.activeTab === 'options') {
      this._renderOptionsTab(ctx, w, h);
    }

    // --- LASER RETICLE OVERLAY ---
    if (this.laserHit) {
      const { px, py } = this.laserHit;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 215, 0, 0.4)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    this.renderer.setTexture(this.texArchive, this.texRecord, this.canvas);
  }

  _renderInventoryTab(ctx, w, h) {
    // Left: Paperdoll equipment slots
    ctx.fillStyle = '#141a26';
    ctx.fillRect(40, 90, 320, 520);
    ctx.strokeStyle = '#3d4b66';
    ctx.strokeRect(40, 90, 320, 520);

    ctx.fillStyle = '#c49746';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAPERDOLL (CORPO)', 200, 125);

    const slots = [
      { name: 'Cabeça', item: 'Elmo de Ferro', y: 155 },
      { name: 'Peitoral', item: 'Cota de Malha de Aço', y: 215 },
      { name: 'Mão Direita', item: '🗡️ Espada Longa (Na mão)', y: 275 },
      { name: 'Mão Esquerda', item: '🔥 Tocha de Masmorra', y: 335 },
      { name: 'Pernas', item: 'Grevas de Couro', y: 395 },
      { name: 'Pés', item: 'Botas de Aço', y: 455 },
    ];

    for (const slot of slots) {
      ctx.fillStyle = '#1e2638';
      ctx.fillRect(60, slot.y, 280, 48);
      ctx.strokeStyle = '#4e5d7d';
      ctx.strokeRect(60, slot.y, 280, 48);

      ctx.fillStyle = '#a0aec0';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(slot.name, 75, slot.y + 20);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(slot.item, 75, slot.y + 40);
    }

    // Right: Backpack items grid
    ctx.fillStyle = '#141a26';
    ctx.fillRect(380, 90, 600, 520);
    ctx.strokeStyle = '#3d4b66';
    ctx.strokeRect(380, 90, 600, 520);

    ctx.fillStyle = '#c49746';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('MOCHILA / INVENTÁRIO', 400, 125);

    // Gold & Weight bar
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(`🪙 Ouro: ${this.charData.gold}`, 700, 125);
    ctx.fillStyle = '#90cdf4';
    ctx.fillText(`⚖️ Carga: ${this.charData.weight}/${this.charData.maxWeight} kg`, 820, 125);

    const items = [
      { name: '🗡️ Adaga de Prata', type: 'Arma', weight: '1.5 kg', val: '65g' },
      { name: '🛡️ Escudo Redondo de Ferro', type: 'Escudo', weight: '4.0 kg', val: '120g' },
      { name: '🧪 Poção de Cura Maior', type: 'Consumível', weight: '0.5 kg', val: '250g' },
      { name: '🗝️ Gazua de Ladrão', type: 'Ferramenta', weight: '0.1 kg', val: '15g' },
      { name: '📜 Pergaminho de Bola de Fogo', type: 'Magia', weight: '0.2 kg', val: '300g' },
      { name: '🍗 Ração de Viagem', type: 'Comida', weight: '1.0 kg', val: '5g' },
    ];

    let iy = 150;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const isHovered = this._hoveredButton && this._hoveredButton.id === `item_${i}`;

      ctx.fillStyle = isHovered ? '#2a3b5c' : '#1b2333';
      ctx.fillRect(400, iy, 560, 55);
      ctx.strokeStyle = isHovered ? '#ffd700' : '#334155';
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.strokeRect(400, iy, 560, 55);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 17px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(it.name, 420, iy + 34);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px sans-serif';
      ctx.fillText(`${it.type} | Peso: ${it.weight} | Valor: ${it.val}`, 680, iy + 34);

      this.buttons.push({
        id: `item_${i}`,
        x: 400, y: iy, w: 560, h: 55,
        onClick: () => {
          this.charData.weight = Math.max(10, this.charData.weight - 2);
          this.charData.gold += 20;
        },
      });

      iy += 68;
    }
  }

  _renderStatsTab(ctx, w, h) {
    ctx.fillStyle = '#141a26';
    ctx.fillRect(40, 90, 940, 520);
    ctx.strokeStyle = '#3d4b66';
    ctx.strokeRect(40, 90, 940, 520);

    ctx.fillStyle = '#c49746';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${this.charData.name} — Nível ${this.charData.level} ${this.charData.class} (${this.charData.race})`, 60, 135);

    // Vitals bars
    const vitals = [
      { name: 'Vida (HP)', cur: 100, max: 100, color: '#e53e3e', y: 170 },
      { name: 'Fadiga', cur: 100, max: 100, color: '#38a169', y: 215 },
      { name: 'Magicka', cur: 40, max: 40, color: '#3182ce', y: 260 },
    ];

    for (const v of vitals) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(`${v.name}: ${v.cur}/${v.max}`, 60, v.y + 16);

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(200, v.y, 400, 22);
      ctx.fillStyle = v.color;
      ctx.fillRect(200, v.y, (v.cur / v.max) * 400, 22);
      ctx.strokeStyle = '#475569';
      ctx.strokeRect(200, v.y, 400, 22);
    }

    // Attributes Table
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('ATRIBUTOS PRIMÁRIOS', 60, 330);

    const statEntries = Object.entries(this.charData.stats);
    let sx = 60, sy = 360;
    for (let i = 0; i < statEntries.length; i++) {
      const [key, val] = statEntries[i];
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(sx, sy, 200, 48);
      ctx.strokeStyle = '#475569';
      ctx.strokeRect(sx, sy, 200, 48);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '16px sans-serif';
      ctx.fillText(key, sx + 15, sy + 30);

      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(String(val), sx + 150, sy + 32);

      sy += 58;
      if (i === 3) { sx = 280; sy = 360; }
    }
  }

  _renderChargenTab(ctx, w, h) {
    ctx.fillStyle = '#141a26';
    ctx.fillRect(40, 90, 940, 520);
    ctx.strokeStyle = '#3d4b66';
    ctx.strokeRect(40, 90, 940, 520);

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('ESCOLHA SUA PROVÍNCIA DE ORIGEM EM TAMRIEL:', 60, 130);

    const provinces = [
      { name: 'High Rock', race: 'Breton', desc: 'Mágicos refinados, alta resistência a feitiços e versatilidade em combate.' },
      { name: 'Hammerfell', race: 'Redguard', desc: 'Os guerreiros mais habilidosos e ágeis de toda Tamriel com espadas.' },
      { name: 'Skyrim', race: 'Nord', desc: 'Homens fortes do norte gelado com resistência nata a geada e ataques físicos.' },
      { name: 'Morrowind', race: 'Dark Elf (Dunmer)', desc: 'Mestres em magia de destruição, arco e flecha e combate com lâminas.' },
      { name: 'Elsweyr', race: 'Khajiit', desc: 'Povo felino com agilidade extrema, visão noturna e garras mortais.' },
      { name: 'Black Marsh', race: 'Argonian', desc: 'Répteis resistentes a veneno e doenças, respiram sob a água.' },
    ];

    let py = 160;
    for (const p of provinces) {
      const isSelected = this.selectedProvince === p.name;
      const isHovered = this._hoveredButton && this._hoveredButton.id === `prov_${p.name}`;

      ctx.fillStyle = isSelected ? '#3b2f15' : (isHovered ? '#26344d' : '#1e293b');
      ctx.fillRect(60, py, 420, 60);
      ctx.strokeStyle = isSelected ? '#ffd700' : '#475569';
      ctx.lineWidth = isSelected ? 3 : 1;
      ctx.strokeRect(60, py, 420, 60);

      ctx.fillStyle = isSelected ? '#ffd700' : '#ffffff';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(`${p.name} (${p.race})`, 80, py + 36);

      this.buttons.push({
        id: `prov_${p.name}`,
        x: 60, y: py, w: 420, h: 60,
        onClick: () => {
          this.selectedProvince = p.name;
          this.charData.race = p.race;
        },
      });

      py += 72;
    }

    // Right details panel
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(510, 160, 445, 420);
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(510, 160, 445, 420);

    const sel = provinces.find(p => p.name === this.selectedProvince) || provinces[0];

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(`Província: ${sel.name}`, 535, 210);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px sans-serif';
    ctx.fillText(`Raça Nativa: ${sel.race}`, 535, 245);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '16px sans-serif';
    this._wrapText(ctx, sel.desc, 535, 290, 400, 24);

    // Confirm button
    const confirmHover = this._hoveredButton && this._hoveredButton.id === 'confirm_chargen';
    ctx.fillStyle = confirmHover ? '#2e7d32' : '#1b5e20';
    ctx.fillRect(535, 500, 395, 55);
    ctx.strokeStyle = confirmHover ? '#81c784' : '#4caf50';
    ctx.lineWidth = 2;
    ctx.strokeRect(535, 500, 395, 55);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CONFIRMAR & ENTRAR NA MASMORRA', 535 + 395 / 2, 535);

    this.buttons.push({
      id: 'confirm_chargen',
      x: 535, y: 500, w: 395, h: 55,
      onClick: () => {
        this.close();
      },
    });
  }

  _renderOptionsTab(ctx, w, h) {
    ctx.fillStyle = '#141a26';
    ctx.fillRect(40, 90, 940, 520);
    ctx.strokeStyle = '#3d4b66';
    ctx.strokeRect(40, 90, 940, 520);

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CONFIGURAÇÕES & OPÇÕES DO JOGO EM VR', 60, 140);

    const options = [
      { id: 'opt_save', label: '💾 SALVAR PROGRESSO NA MASMORRA' },
      { id: 'opt_snap', label: '🔄 MODO DE GIRO: SNAP TURN (45°)' },
      { id: 'opt_lantern', label: '💡 TOCHA DINÂMICA: BRILHO ALTO' },
    ];

    let oy = 180;
    for (const opt of options) {
      const isHovered = this._hoveredButton && this._hoveredButton.id === opt.id;
      ctx.fillStyle = isHovered ? '#374151' : '#1f2937';
      ctx.fillRect(60, oy, 500, 55);
      ctx.strokeStyle = isHovered ? '#ffd700' : '#4b5563';
      ctx.strokeRect(60, oy, 500, 55);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(opt.label, 85, oy + 35);

      this.buttons.push({
        id: opt.id,
        x: 60, y: oy, w: 500, h: 55,
        onClick: () => {},
      });

      oy += 75;
    }
  }

  _wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, x, y);
        line = words[n] + ' ';
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, y);
  }

  draw() {
    if (!this.isOpen) return;

    // Draw the 3D Slate
    this.renderer.drawMesh(this.mesh, this.matrix, null);
  }
}
