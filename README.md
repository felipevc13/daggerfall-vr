# Daggerfall VR — Standalone WebXR Edition

> **The Elder Scrolls II: Daggerfall** running natively in Standalone VR for Meta Quest 2, Quest 3, and Quest Pro via WebXR, built on top of the open-source DFO WebGL2 engine.

[![WebXR](https://img.shields.io/badge/WebXR-Meta%20Quest%203%20Native-blue.svg)](https://immersiveweb.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Repository](https://img.shields.io/badge/GitHub-felipevc13%2Fdaggerfall--vr-success.svg)](https://github.com/felipevc13/daggerfall-vr)

---

## 🧭 Project Overview (For Developers & AI Agents)

This repository brings full **Standalone 6DOF Virtual Reality** to Daggerfall. Players can step directly into the classic dungeons of Tamriel (starting inside the iconic *Privateer's Hold*) through the native **Meta Quest Browser** without requiring PCVR, Link cables, or third-party streaming apps.

### Core VR Features:
- **Calibrated Stereoscopic Optics (Zero Strabismus & Eye Strain)**: Projection parity and convergence adjusted specifically for Meta Quest 3 Pancake lenses using the calibrated **Preset 5** profile (`VR_EYE_X = 1`, `IPD_SCALE = 0.75`, `out[0] = -out[0]`).
- **6DOF Physical Weapon Combat**: Steel longsword in the right hand and flickering dungeon torch in the left hand, with real blade tip velocity tracking and physical strike detection.
- **Classic Enemies with 6DOF Hit Physics**: Authentic Daggerfall Skeletal Warrior (*TEXTURE.270*) featuring upright billboarding, 1-bit alpha transparency cutout, and dynamic recoil wobble physics when struck.
- **Smooth Locomotion & Wall Collisions**: Left thumbstick locomotion with genuine capsule sliding collision against 3D dungeon walls and geometry (`ctx.collider.move`), plus 45° snap turn on the right thumbstick.
- **In-World Diegetic VR Menus & Chargen**: Floating 3D holographic slates for Inventory (Paperdoll), Character Stats, Options, and the full Tamriel Province Map (Character Creation / Chargen) operated with a 6DOF laser pointer and haptic feedback.
- **Real-Time Remote Telemetry**: Automatic bi-directional streaming of Quest 3 browser logs and exceptions to the development server at `/api/vr-log` saved into `.quest-vr.log`.

---

## 🚀 How to Run & Test in VR (Testing Guide)

### 1. Start the Local Development Server
From the project root directory, run:
```bash
npm run dev
```
Vite will boot the development server listening on `http://0.0.0.0:5173`.

### 2. Open on Meta Quest (Quest 2 / Quest 3 / Quest Pro)

#### Option A: USB Cable (Recommended for Development)
Connect your Quest to your computer via USB with USB Debugging enabled, and run:
```bash
adb reverse tcp:5173 tcp:5173
```
Inside the Meta Quest Browser, navigate to:
```
http://localhost:5173/vr-dungeon.html
```

#### Option B: Local Wi-Fi Network (Wireless)
Find your computer's local IP address (e.g. `192.168.0.30`) and open in Meta Quest Browser:
```
http://192.168.0.30:5173/vr-dungeon.html
```

### 3. Entering the Dungeon
Click the green **"ENTER VR"** button in the center of the display.
- **Left Thumbstick**: Smooth walk and strafe (with collision against dungeon walls).
- **Right Thumbstick**: Snap turn (45° steps).
- **Right Hand Controller**: Swing the longsword to strike enemies.
- **Left Hand Controller**: Hold and maneuver the torch to illuminate dark corners.
- **Left Controller [Y] or Menu Button**: Toggle the floating Holographic Menu / Tamriel Map.
- **Right Controller Trigger**: Click buttons and select items with the 6DOF laser ray pointer.

---

## 🏛️ Modular Architecture & Codebase Map

> **Strict Modularity Rule**: All VR code is strictly isolated inside the `src/vr/` directory and the standalone entry page `vr-dungeon.html`. No upstream core engine classes (`PlayerMotor`, `Renderer`, `DungeonContext`, physics, quests, etc.) have been altered. This guarantees that future updates from the upstream engine (`origin/main` / `Lattymoy/daggerfall-js-source`) can be merged seamlessly via `git merge origin/main` without code conflicts.

### File Directory Breakdown (`src/vr/`):

| File | Role & Implementation Details |
|---|---|
| [`vr-dungeon.html`](vr-dungeon.html) | Standalone WebXR HTML entry point. Sets up the WebGL2 canvas, responsive viewport, and boots the dungeon runner. |
| [`src/vr/vrDungeon.js`](src/vr/vrDungeon.js) | **Main Dungeon Runner (Privateer's Hold)**. Loads 3D dungeon architecture, spawns lights, binds the WebXR layer framebuffer directly to `Renderer` (bypassing desktop post-processing FBOs), and drives the stereo frame loop. |
| [`src/vr/xrCamera.js`](src/vr/xrCamera.js) | **Stereoscopic Camera & Optics**. Translates WebXR eye poses from right-handed (+X right, +Y up, -Z forward) to Daggerfall world convention (+X, +Y, +Z). Implements calibrated **Preset 5** (`VR_EYE_X = 1`, `IPD_SCALE = 0.75`, `out[0] = -out[0]`) eliminating strabismus and eye fatigue. |
| [`src/vr/xrInput.js`](src/vr/xrInput.js) | **Quest Controller Input System**. Polls thumbsticks, buttons (A, B, X, Y, Triggers, Grips), computes smooth locomotion with capsule collision against dungeon walls (`ctx.collider.move`), and delivers haptic vibration pulses (`pulseHaptic`). |
| [`src/vr/xrWeapons.js`](src/vr/xrWeapons.js) | **6DOF Weapon System**. Manages the right-hand steel longsword and left-hand flickering dungeon torch. Tracks blade tip velocity (`tipSpeed`) and calculates bounding sphere strike intersections against targets. |
| [`src/vr/xrSkeleton.js`](src/vr/xrSkeleton.js) | **Skeletal Warrior (TEXTURE.270)**. Authentic sprite billboard facing the player, 1-bit alpha transparency cutout, health points, and reactive physical wobble upon taking hits. |
| [`src/vr/xrMenu.js`](src/vr/xrMenu.js) | **In-World Diegetic VR Menu Slate**. Renders Inventory (Paperdoll), Character Stats, Options, and the Map of Tamriel (Chargen). Computes 6DOF laser ray-plane intersections, reticle tracking, and trigger click dispatch. |
| [`src/vr/xrUI.js`](src/vr/xrUI.js) | **Floating Combat HUD**. In-world floating billboard displaying player and enemy health bars and damage readouts. |
| [`src/vr/xrSession.js`](src/vr/xrSession.js) | **WebXR Session Lifecycle**. Requests `immersive-vr` sessions with `local-floor` reference space, handles session start/end, and manages the Enter VR UI. |
| [`src/vr/xrLog.js`](src/vr/xrLog.js) | **Remote Telemetry Client**. Intercepts Quest 3 browser console logs (`log`, `warn`, `error`) and streams them back to the Node dev server. |

---

## 🛠️ Key Technical Findings & Solutions

1. **WebXR Black Screen Issue (LightingLane / FBO Redirection)**:
   - *Cause*: The desktop renderer created an offscreen framebuffer (`_frameFbo`) for screen-space post-processing (`AirPass`). WebGL rendered dungeon geometry into `_frameFbo` while the WebXR layer received only the clear color.
   - *Solution*: Disabled lighting lane redirection in VR with `renderer.setLightingLane(null)` and rendered geometry directly to the WebXR `layer.framebuffer`.
2. **Stereoscopic Eye Strain & Focus Convergence (Preset 5)**:
   - *Cause*: Daggerfall Unity's coordinate parity mirrors NDC X. Mirroring the lens optical center (`out[8]`) caused severe stereoscopic distortion and double-vision when focusing on near objects (like the sword).
   - *Solution*: Preserved optical center `out[8]`, mirrored only coordinate scale `out[0] = -out[0]`, and relaxed the virtual IPD separation to 75% (`IPD_SCALE = 0.75`). Near and far objects now focus naturally and comfortably.
3. **Inverted Controller Coordinates**:
   - *Cause*: Multiplying controller positions by camera parity flags flipped the right hand to the left side.
   - *Solution*: WebXR controller input coordinates are physical (+X right, +Y up, -Z forward) and must never be multiplied by the eye mirror flag.

---

## 📜 Upstream Game Engine (DFO Online)

This project builds upon **DFO Online**, an open-source WebGL2 reimplementation of *The Elder Scrolls II: Daggerfall*.

### Useful Commands:
- `npm run dev`: Starts local Vite dev server.
- `npm run build`: Builds production distribution bundle.
- `npm test`: Runs automated engine tests.
- `npm run lint`: Validates code style and syntax rules.

### License
Released under the **MIT License**.
The Elder Scrolls and Daggerfall are registered trademarks of Bethesda Softworks / ZeniMax Media Inc. This is an unofficial, non-commercial fan project.
