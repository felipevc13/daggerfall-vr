// VR REAL DUNGEON RUNNER - PRIVATEER'S HOLD
//
// Boots the genuine Daggerfall starter dungeon in full WebXR stereo VR:
//   - Authentic 3D dungeon architecture, doors, and ambient lighting
//   - Real classic Skeletal Warrior enemy (TEXTURE.270)
//   - 6DOF physical sword and torch in your hands
//   - Full Quest smooth locomotion and snap turn
//   - Zero-strabismus calibrated stereo projection

import { Renderer, WORLD_FRAME } from '../render/renderer.js';
import { gameMat4, guardedSetXrTarget, probeVrEngineHooks } from './engineBridge.js';
const { lookAt, perspective, mirrorProjectionX, identity, UP_Y } = gameMat4;
import { eyeMatrices } from './xrCamera.js';
import { enterVrSession, endVrSession, makeEnterVrButton, viewerPose, requestFrame } from './xrSession.js';
import { XrInputManager } from './xrInput.js';
import { XrWeapons } from './xrWeapons.js';
import { XrSkeleton } from './xrSkeleton.js';
import { XrCombatUI } from './xrUI.js';
import { XrMenu } from './xrMenu.js';

import { DFPalette } from '../formats/dfPalette.js';
import { BlocksFile } from '../formats/blocksFile.js';
import { Arch3dFile } from '../formats/arch3dFile.js';
import { MapsFile } from '../formats/mapsFile.js';
import { fetchBytes, motorStats, climbingDeps, parkourDeps } from '../scenes/shared.js';
import { createDataPipeline } from '../scenes/dataPipeline.js';
import { buildDungeonContext } from '../scenes/dungeonContext.js';
import { PlayerMotor } from '../player/motor.js';
import { playerEntity } from '../characters/playerEntity.js';
import { syncLightingLane, lanternColor, dungeonAmbient, dungeonTrilight, dungeonFog } from '../render/enhancedLighting.js';
import { DUNGEON_LIGHT_COLOR, DUNGEON_LIGHT_BLOCK_RANGE } from '../world/dungeon/dungeonLights.js';
import { nearestLights, capFadeColors } from '../world/city/cityLights.js';
import { INTERIOR_LIGHT_DIR } from '../world/interior/interiorLights.js';
import { INTERIOR_CLEAR } from '../render/renderer.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new Renderer(canvas);

const NEAR = Number(params.get('near') ?? 0.05);
const FAR = Number(params.get('far') ?? 600);

const regionName = params.get('region') || 'Daggerfall';
const dungeonName = params.get('dungeon') || "Privateer's Hold";

renderer.setLightingLane(null);
const DUNGEON_LANTERN_F32 = new Float32Array(DUNGEON_LIGHT_COLOR);

const rig = {
  pos: [0, 0, 0],
  yaw: 0,
};

// Debug overlay
const debugEl = document.createElement('pre');
debugEl.style.cssText = 'position:fixed;left:10px;top:10px;z-index:9999;color:#55efc4;background:rgba(0,0,0,0.85);font:12px monospace;padding:8px;max-height:45vh;overflow:auto;pointer-events:none;border-radius:6px;border:1px solid #00b894;';
document.body.appendChild(debugEl);
const debugLines = [];
function dbg(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  debugLines.push(line);
  if (debugLines.length > 25) debugLines.shift();
  debugEl.textContent = debugLines.join('\n');
  console.log('[vrdungeon]', msg);
}

let ctx = null;
let player = null;
let skeleton = null;
let weapons = null;
let combatUI = null;
let menu = null;
let xrInput = null;

let presenting = false;
let session = null, layer = null, refSpace = null;
let rafId = 0, frameCount = 0, lastTime = 0;

async function boot() {
  dbg(`Carregando masmorra real: ${dungeonName}...`);

  const [palBytes, blocksBytes, archBytes, mapsBytes, climateBytes, politicBytes] =
    await Promise.all([
      fetchBytes('ART_PAL.COL'),
      fetchBytes('BLOCKS.BSA'),
      fetchBytes('ARCH3D.BSA'),
      fetchBytes('MAPS.BSA'),
      fetchBytes('CLIMATE.PAK'),
      fetchBytes('POLITIC.PAK'),
    ]);

  const palette = new DFPalette();
  palette.load(palBytes, 'ART_PAL.COL');

  const blocks = new BlocksFile();
  blocks.load(blocksBytes);

  const arch = new Arch3dFile();
  arch.load(archBytes);

  const maps = new MapsFile();
  maps.load(mapsBytes, climateBytes, politicBytes);

  const dfLocation = maps.getLocationByName(regionName, dungeonName);
  if (!dfLocation) throw new Error(`Masmorra não encontrada: ${regionName}/${dungeonName}`);

  dbg('Construindo geometria 3D e colisões da masmorra...');
  const pipeline = createDataPipeline({ renderer, arch, palette });
  renderer.setClearColor(new Float32Array([0.18, 0.16, 0.14, 1.0]));

  playerEntity.chargenDone = true;
  ctx = await buildDungeonContext(
    { ...pipeline, renderer, arch, palette },
    dfLocation,
    blocks,
    dfLocation.climate.climateType,
    { foes: true, chargen: false, playerClass: 0 }
  );

  // Classic water tile
  const waterArchive = dfLocation.climate.groundArchive;
  await pipeline.getTexture(waterArchive);
  pipeline.uploadRecord(waterArchive, 0);
  ctx.setWaterArchive(waterArchive);

  // Spawn position (step slightly forward into the open chamber)
  const rawSpawn = ctx.startSpawn() ?? [0, 2, 0];
  const spawn = [rawSpawn[0], rawSpawn[1], rawSpawn[2] + 2.0];
  rig.pos = [spawn[0], spawn[1], spawn[2]];
  dbg(`Spawn inicial em Privateer's Hold: [${spawn.map(v => v.toFixed(2)).join(', ')}]`);

  // Initialize systems
  xrInput = new XrInputManager({ snapTurn: true, snapAngleDeg: 45, moveSpeed: 4.0 });
  weapons = new XrWeapons(renderer, xrInput);

  // Spawn the real Skeletal Warrior 2.8 meters ahead in the room
  skeleton = new XrSkeleton(renderer, [spawn[0], spawn[1], spawn[2] + 2.8]);
  await skeleton.load();

  // Floating VR Status UI
  combatUI = new XrCombatUI(renderer, [spawn[0], spawn[1] + 1.8, spawn[2] + 4.2], 0);

  // In-World Diegetic VR Menu Slate (Inventory, Chargen, Stats, Options)
  menu = new XrMenu(renderer);

  dbg('Pronto! Coloque o Quest e aperte Enter VR para entrar na masmorra!');
}

function drawDungeonPass(proj, view, eyePos) {
  // Bright dungeon ambient lighting so the player can clearly see the stone chamber
  renderer.setLighting(new Float32Array([0.55, 0.52, 0.48]), 1, new Float32Array([1.0, 0.94, 0.82]));

  // Dynamic Torch & Dungeon Lights
  const nearLights = nearestLights(ctx.lights, eyePos, renderer.maxPointLights, ctx.flicker.ranges, null, DUNGEON_LIGHT_BLOCK_RANGE);
  
  // Combine with a bright personal lantern at the player's eye/chest (15m radius)
  const allLights = [
    eyePos[0], eyePos[1] + 0.2, eyePos[2], 18.0, // Player personal torch
  ];
  for (let i = 0; i < nearLights.length; i++) allLights.push(nearLights[i]);

  renderer.setPointLights(new Float32Array(allLights), DUNGEON_LANTERN_F32, null);

  renderer.beginFrame(proj, view, INTERIOR_LIGHT_DIR, null);

  if (presenting && frameCount < 2) {
    const gl = renderer.gl;
    const curFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    console.log(`[VR FBO CHECK] curFb === layer.framebuffer: ${curFb === layer?.framebuffer}, curFb:`, !!curFb);
  }

  // 1. Static Dungeon Architecture (Stone corridors, vaulted ceilings, stone floors)
  if (ctx.staticBatch) renderer.drawMesh(ctx.staticBatch, identity(), null);

  // 2. Dungeon Props (Doors, gates, furniture, chests)
  for (const d of ctx.drawList) {
    if (!d._batched) renderer.drawMesh(d.mesh, d.matrix, d.texRemap ?? ctx.texRemap);
  }
  for (const d of ctx.dynamicDraws) {
    renderer.drawMesh(d.gpu, d.object.matrix, ctx.texRemap);
  }

  // 3. Torch Flats & Dungeon Billboards
  const camRight = new Float32Array([view[0], view[4], view[8]]);
  renderer.drawBillboards([...ctx.billboardBatches, ...ctx.campBatches(), ...ctx.torchBatches()], camRight, UP_Y);

  // 4. Real Skeletal Warrior
  if (skeleton) skeleton.draw();

  // 5. Player 6DOF Weapons (Right Hand Sword, Left Hand Torch)
  if (weapons) weapons.draw();

  // 6. In-World VR Status UI
  if (combatUI) combatUI.draw();

  // 7. In-World Diegetic Menu Slate
  if (menu) menu.draw();

  renderer.resolveFrame();
}

function xrFrame(time, frame) {
  if (!presenting || !session) return;
  try {
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0.016;
    lastTime = time;

    // 1. Locomotion on Quest controllers (with dungeon capsule collision)
    // Pauses locomotion when menu is open so player can freely click items
    xrInput.poll(session, refSpace, frame);
    if (!menu || !menu.isOpen) {
      xrInput.updateLocomotion(rig, dt, 0, ctx?.collider);
    }

    // 2. In-World Menu Raycasting & Hover/Click Input
    if (menu) {
      menu.update(xrInput, rig);
    }

    // 3. Update Weapons & Collision with Skeletal Warrior (only active when menu is closed)
    const targets = [];
    if (!menu?.isOpen && skeleton && skeleton.loaded) {
      targets.push({
        id: 'skeleton',
        pos: skeleton.pos,
        radius: 0.5,
        height: 1.85,
        hp: skeleton.hp,
        onHit: (damage, type) => {
          skeleton.onHit(damage, type);
          combatUI.recordStrike(type, damage, weapons.tipSpeed);
          combatUI.updateData({ dummyHp: skeleton.hp });
          dbg(`💀 ACERTOU O ESQUELETO! Golpe: ${type.toUpperCase()} (-${damage} DANO) | HP: ${skeleton.hp}`);
        },
      });
    }

    weapons.update(rig, dt, targets);
    if (skeleton) skeleton.update(dt, rig.pos);
    if (ctx && ctx.flicker) ctx.flicker.tick(dt);

    const pose = viewerPose(frame, refSpace);
    if (!pose) {
      if (frameCount % 60 === 0) console.warn(`[VR FRAME ${frameCount}] NO POSE RETURNED BY WEBXR (tracking lost or waiting)`);
      requestFrame(session, xrFrame);
      return;
    }

    // 3. Stereo Eye Render Pass
    const views = pose.views;
    if (frameCount < 5 || frameCount % 120 === 0) {
      console.log(`[VR FRAME ${frameCount}] views=${views.length}, fb=${!!layer?.framebuffer}, pos=[${rig.pos.map(n => n.toFixed(2)).join(',')}], yaw=${rig.yaw.toFixed(2)}`);
    }

    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      const vp = layer.getViewport(v);
      if (!guardedSetXrTarget(renderer, layer.framebuffer, vp)) continue;
      const { eye, proj, view } = eyeMatrices(v, rig, NEAR, FAR);
      if (frameCount < 2) {
        console.log(`[VR EYE ${i} (${v.eye})] m12=${v.transform?.matrix?.[12]?.toFixed(4)}, eye=[${eye.map(n => n.toFixed(3)).join(',')}], proj0=${proj[0].toFixed(3)}, proj8=${proj[8].toFixed(3)}`);
      }
      drawDungeonPass(proj, view, eye);
    }

    if (frameCount < 5) {
      console.log(`[VR STATS ${frameCount}] draws=${renderer.stats.draws}, vaoBinds=${renderer.stats.vaoBinds}, glError=${renderer.gl.getError()}`);
    }

    frameCount++;
    window.__frame = frameCount;
  } catch (err) {
    console.error('[VR FRAME ERROR]', err);
    dbg(`ERRO XR: ${err?.message ?? err}`);
  }
  requestFrame(session, xrFrame);
}

function drawFlat() {
  if (!ctx) return;
  const ex = rig.pos[0], ey = rig.pos[1] + 1.65, ez = rig.pos[2];
  const cy = Math.cos(rig.yaw), sy = Math.sin(rig.yaw);
  const fwd = [sy, 0, cy];
  const view = lookAt([ex, ey, ez], [ex + fwd[0], ey + fwd[1], ez + fwd[2]], UP_Y);
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const proj = mirrorProjectionX(perspective((70 * Math.PI) / 180, aspect, NEAR, FAR));
  if (skeleton) skeleton.update(0.016, [ex, ey, ez]);
  drawDungeonPass(proj, view, [ex, ey, ez]);
}

function loop() {
  if (presenting) return;
  drawFlat();
  rafId = requestAnimationFrame(loop);
}

function enterSession(opened) {
  session = opened.session; layer = opened.layer; refSpace = opened.refSpace;
  presenting = true;
  cancelAnimationFrame(rafId);
  session.addEventListener('end', onSessionEnd, { once: true });
  dbg('Sessão VR iniciada em Privateer\'s Hold! Use a espada e tocha.');
  requestFrame(session, xrFrame);
}

function onSessionEnd() {
  presenting = false;
  guardedSetXrTarget(renderer, null, null);
  session = null; layer = null; refSpace = null;
  lastTime = 0;
  rafId = requestAnimationFrame(loop);
}

const mount = document.getElementById('door');
probeVrEngineHooks().then((probe) => {
  if (!probe.ok) {
    const msg = `VR desligado. Ganchos do motor ausentes: ${probe.missing.join(', ')}`;
    console.warn('[vr]', msg);
    dbg(msg);
    mount.textContent = msg;
    return null;
  }
  return makeEnterVrButton({
    gl: renderer.gl, canvas, label: 'Enter VR Dungeon',
    depthNear: NEAR, depthFar: FAR,
    onEnter: (opened) => {
      console.log('[VR] WebXR session granted and entered successfully!');
      enterSession(opened);
    },
    onError: (err) => {
      const msg = String(err?.message ?? err);
      console.error('[VR ERROR] Failed to start WebXR session:', msg);
      dbg(`ERRO AO ENTRAR VR: ${msg}`);
      mount.textContent = msg;
    },
  });
}).then((button) => {
  if (!button) {
    if (!mount.textContent) {
      console.warn('[VR] Immersive-VR NOT supported on this browser or origin.');
      mount.innerHTML = '<div style="background:rgba(0,0,0,0.8);color:#e2b774;padding:8px 14px;border-radius:6px;font:13px sans-serif;">Nenhum headset VR detectado (ou use o Meta Quest Browser)</div>';
    }
    return;
  }
  console.log('[VR] Immersive-VR is supported by this browser. Button mounted.');
  button.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:999999;padding:16px 36px;font:bold 18px system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#c08a3e,#996321);border:2px solid #ffd700;border-radius:10px;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,0.8);';
  mount.append(button);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft') rig.yaw += 0.1;
  else if (e.code === 'ArrowRight') rig.yaw -= 0.1;
  else if (e.code === 'KeyW') { rig.pos[0] += Math.sin(rig.yaw) * 0.2; rig.pos[2] += Math.cos(rig.yaw) * 0.2; }
  else if (e.code === 'KeyS') { rig.pos[0] -= Math.sin(rig.yaw) * 0.2; rig.pos[2] -= Math.cos(rig.yaw) * 0.2; }
  else if (e.code === 'Space' && skeleton) skeleton.onHit(25, 'slash');
});

boot().catch(err => {
  dbg(`FALHA AO INICIAR MASMORRA: ${err?.message ?? err}`);
  console.error(err);
});

loop();
