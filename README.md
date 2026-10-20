# Daggerfall VR

A VR mod for [DFO](https://daggerfalljs.dev/), the browser reimplementation of *The Elder Scrolls II: Daggerfall* from [Lattymoy/daggerfall-js-source](https://github.com/Lattymoy/daggerfall-js-source). The mod runs in the Meta Quest Browser through WebXR. The flat game stays the same game: a monitor player never loads the VR module.

**Status:** a single-dungeon demo. Privateer's Hold can be entered in VR from `vr-dungeon.html`. The online flow (`/play/`, and the live site) does not offer Enter VR yet. That button is the integration this repo is aiming at. Non-VR players are unaffected because `src/main.js` does not import `src/vr`.

[![WebXR](https://img.shields.io/badge/WebXR-Meta%20Quest%203%20Native-blue.svg)](https://immersiveweb.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Repository](https://img.shields.io/badge/GitHub-felipevc13%2Fdaggerfall--vr-success.svg)](https://github.com/felipevc13/daggerfall-vr)

## Quick start

```bash
npm ci
# Put your own Daggerfall ARENA2 folder at ./arena2  (never commit it)
npm run dev:quest
```

On the Quest, with USB debugging accepted: open `http://localhost:5173/vr-dungeon.html` in the Quest Browser and press **Enter VR Dungeon**. A LAN `http://192.168…` address loads the page and does not start WebXR. Full steps, the flat-game check, and hosted-build options: [docs/TESTING-ON-QUEST.md](docs/TESTING-ON-QUEST.md).

| Doc | For |
| --- | --- |
| [docs/TESTING-ON-QUEST.md](docs/TESTING-ON-QUEST.md) | Headset steps, telemetry, what `/play/` and daggerfalljs.dev do today |
| [docs/repo-map.md](docs/repo-map.md) | What is the VR mod, what is upstream, workflows, engine hooks, how to merge upstream |
| [AGENTS.md](AGENTS.md) | Rules for an AI agent: boundary, tests, never push `main`, never commit game files |

## Roadmap

1. Keep the VR code a module with one bridge (`src/vr/engineBridge.js`) so an upstream update disables VR instead of crashing the flat game.
2. Mount **Enter VR** on the real hosts, dynamically, only when the hooks and the headset are there. Same world as a flat player on [daggerfalljs.dev](https://daggerfalljs.dev/).
3. A public HTTPS build where each player supplies their own game files. Not deployed from this repo. Options are in the Quest doc.

---

## What the demo does

Players can step into Privateer's Hold through the Quest Browser without PCVR or a link cable.

### Core VR Features:
- **Calibrated Stereoscopic Optics (Zero Strabismus & Eye Strain)**: Projection parity and convergence adjusted specifically for Meta Quest 3 Pancake lenses using the calibrated **Preset 5** profile (`VR_EYE_X = 1`, `IPD_SCALE = 0.75`, `out[0] = -out[0]`).
- **6DOF Physical Weapon Combat**: Steel longsword in the right hand and flickering dungeon torch in the left hand, with real blade tip velocity tracking and physical strike detection.
- **Classic Enemies with 6DOF Hit Physics**: Authentic Daggerfall Skeletal Warrior (*TEXTURE.270*) featuring upright billboarding, 1-bit alpha transparency cutout, and dynamic recoil wobble physics when struck.
- **Smooth Locomotion & Wall Collisions**: Left thumbstick locomotion with genuine capsule sliding collision against 3D dungeon walls and geometry (`ctx.collider.move`), plus 45° snap turn on the right thumbstick.
- **In-World Diegetic VR Menus & Chargen**: Floating 3D holographic slates for Inventory (Paperdoll), Character Stats, Options, and the full Tamriel Province Map (Character Creation / Chargen) operated with a 6DOF laser pointer and haptic feedback.
- **Real-Time Remote Telemetry**: Automatic bi-directional streaming of Quest 3 browser logs and exceptions to the development server at `/api/vr-log` saved into `.quest-vr.log`.

---

Controls inside the demo: left stick walks (walls stop you), right stick snap-turns, right hand is the sword, left hand is the torch, left **X** or **Y** toggles the menu, right trigger is the laser, left grip holds to talk. Detail and the telemetry files: [docs/TESTING-ON-QUEST.md](docs/TESTING-ON-QUEST.md).

---

## Where the code sits

The module is `src/vr/`. The flat entry does not load it. Two inherited files carry a named hook so the engine can draw an eye: `Renderer.setXrTarget` in `src/render/renderer.js`, and `perspectiveOffCenter` in `src/world/mat4.js`. `src/vr/engineBridge.js` is the VR side of that seam. If a hook disappears, Enter VR stays off. The rest of the coupling, the workflows, and how to merge [upstream](https://github.com/Lattymoy/daggerfall-js-source) are in [docs/repo-map.md](docs/repo-map.md).

Upstream engine (do not treat as the mod): `src/characters`, `src/world`, `src/render`, `src/formats`, `src/ui`, `src/scenes`, plus `server/` and `server-account/` for the online services. `arena2/` is the player's own 1996 data and is gitignored.

| VR file | Role |
| --- | --- |
| [`src/vr/engineBridge.js`](src/vr/engineBridge.js) | Hook probe and the only `src/vr` import of `mat4`. |
| [`src/vr/xrSession.js`](src/vr/xrSession.js) | Session and the Enter VR button. |
| [`src/vr/xrCamera.js`](src/vr/xrCamera.js) | Eye matrices. Preset 5. |
| [`src/vr/xrInput.js`](src/vr/xrInput.js) | Sticks, snap turn, collisions, haptics. |
| [`src/vr/xrWeapons.js`](src/vr/xrWeapons.js) | Sword and torch. |
| [`src/vr/xrMenu.js`](src/vr/xrMenu.js) | In-world menu, X/Y, voice grip. |
| [`src/vr/xrLog.js`](src/vr/xrLog.js) | Posts logs to `/api/vr-log` on the dev server. |
| [`vr-dungeon.html`](vr-dungeon.html), [`src/vr/vrDungeon.js`](src/vr/vrDungeon.js) | Privateer's Hold demo. |
| [`vr.html`](vr.html), [`src/tools/vrLab.js`](src/tools/vrLab.js) | Empty-room lab. |

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

## Upstream

Play it: https://daggerfalljs.dev/

[DFO](https://daggerfalljs.dev/) is the game this mod targets. Useful local commands: `npm run dev:quest`, `npm run dev`, `npm run lint`, `npm run types`, `node --test test/vr/engineContract.test.js`. The full suite is `npm test`.

### License

MIT, copyright Lattymoy, with Daggerfall Unity's MIT notice (`LICENSE`). The Elder Scrolls and Daggerfall are trademarks of ZeniMax Media Inc. This is an unofficial, non-commercial fan project. Game files stay on the player's machine.
