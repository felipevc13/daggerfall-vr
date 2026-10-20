# Daggerfall VR — Standalone WebXR Edition

> **The Elder Scrolls II: Daggerfall** running natively in Standalone VR for Meta Quest 2, Quest 3, and Quest Pro via WebXR, built on top of the open-source DFO WebGL2 engine.

Play it: https://daggerfalljs.dev/

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
- **Real-Time Remote Telemetry**: On a `?shot` boot, Quest 3 browser logs and exceptions stream to the development server at `/api/vr-log` and are saved into `.quest-vr.log`. The same shot gate covers the frame counter.

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

### 1. Base Game Engine (`src/`) — *Upstream Untouched Core*
These directories contain the underlying Daggerfall Unity port and DFO WebGL2 game engine. **Do not modify these directly** — the VR mod consumes them as an external API layer:
- `src/characters/`: Player entity, NPC bodies, enemy tables, and mobile monster definitions.
- `src/world/`: 3D dungeon blocks, procedural terrain, city buildings, streaming, and lighting.
- `src/render/`: Core WebGL2 renderer (`renderer.js`), shaders, mesh buffers, and enhanced lighting.
- `src/formats/`: Daggerfall DOS binary asset parsers (`blocksFile.js`, `arch3dFile.js`, `imgFile.js`, `bsaFile.js`).
- `src/ui/`: 2D classic & enhanced UI screens (`chargen.js`, `charsheet.js`, `nativeInventory.js`, `windowStack.js`).
- `arena2/`: Authentic 1996 Daggerfall DOS game files (textures, sounds, maps, 3D meshes).

---

### 2. Production VR Runtime Layer (`src/vr/`) — *Permanent Mod Code*
These modules constitute the permanent VR mod layer:

| File | Purpose & Architecture |
|---|---|
| [`src/vr/xrCamera.js`](src/vr/xrCamera.js) | **Core VR Camera & Calibrated Optics**. Extracts WebXR eye matrices, maps coordinate conventions, and applies **Preset 5** (`VR_EYE_X = 1`, `IPD_SCALE = 0.75`, `out[0] = -out[0]`) eliminating strabismus. |
| [`src/vr/xrInput.js`](src/vr/xrInput.js) | **Quest Controller Input System**. Locomotion, capsule sliding collision against dungeon walls (`ctx.collider.move`), snap turn, and haptic vibration. |
| [`src/vr/xrWeapons.js`](src/vr/xrWeapons.js) | **6DOF Weapon System**. Right-hand steel sword and left-hand torch. Tracks blade tip velocity (`tipSpeed`) and calculates strike bounding-sphere hits. |
| [`src/vr/xrMenu.js`](src/vr/xrMenu.js) | **Diegetic VR Menu Slate**. In-world floating 3D canvas for Inventory (Paperdoll), Character Stats, Options, and Tamriel Chargen Map with 6DOF laser raycasting. |
| [`src/vr/xrSession.js`](src/vr/xrSession.js) | **WebXR Lifecycle Manager**. Manages `immersive-vr` sessions and `local-floor` reference space. |
| [`src/vr/xrLog.js`](src/vr/xrLog.js) | **Remote Telemetry Client**. On a `?shot` boot, intercepts Quest 3 browser logs and streams them to the server at `/api/vr-log`. |

---

### 3. VR Test Scenes & Prototypes — *Test Harnesses & Sandboxes*
These files are specialized environments created for testing, calibrating, and iterating in VR without affecting the rest of the game:

| File | Type | Purpose |
|---|---|---|
| [`vr-dungeon.html`](vr-dungeon.html) | **Main Test Scene** | Standalone HTML page used to boot and test the genuine *Privateer's Hold* starter dungeon in VR. |
| [`src/vr/vrDungeon.js`](src/vr/vrDungeon.js) | **Test Scene Runner** | Drives the Privateer's Hold test scene: loads dungeon architecture, sets up ambient lighting, spawns the test skeleton, and runs the WebXR stereo loop. |
| [`src/vr/xrSkeleton.js`](src/vr/xrSkeleton.js) | **Test Enemy (PoC)** | Proof of concept for 6DOF weapon hit detection on *TEXTURE.270*. Will be generalized into the universal `XrEnemy.js`. |
| [`src/vr/xrUI.js`](src/vr/xrUI.js) | **Test Combat HUD** | Floating in-world stats billboard used to monitor player and skeleton HP and strike damage during combat tuning. |
| [`src/vr/xrCalibrator.js`](src/vr/xrCalibrator.js) | **Calibration Rig** | In-VR optical test bench used to cycle through and test the 8 stereo projection presets to find the winning focus settings. |
| [`src/tools/vrLab.js`](src/tools/vrLab.js) / [`vr.html`](vr.html) | **Sandbox Lab** | Isolated WebXR matrix testing harness for rapid experimentation with coordinate transforms and projection matrices. |

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
