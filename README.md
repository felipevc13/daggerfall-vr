# Daggerfall VR

A VR mod for [DFO](https://daggerfalljs.dev/), the browser reimplementation of *The Elder Scrolls II: Daggerfall* from [Lattymoy/daggerfall-js-source](https://github.com/Lattymoy/daggerfall-js-source). The mod runs in the Meta Quest Browser through WebXR. The flat game stays the same game: a player who does not pass `?vr` never loads the VR module.

**Status:** The real game mounts **Enter VR** at `/play/?vr` when the browser can start `immersive-vr`. That press keeps the session open. On the title screen the front door is a floating panel you point at. `/play/?dungeon&class=16&vr` draws each eye in Privateer's Hold as a Warrior, and the Quest controllers walk that player. The world and interiors still share one picture, and the sticks do not walk there yet. Menus after the game has started are not on the panel yet. Without `?vr`, `src/main.js` does not fetch `src/vr`. The live site https://daggerfalljs.dev/play/ is upstream and has no button.

Play it: https://daggerfalljs.dev/

[![WebXR](https://img.shields.io/badge/WebXR-Meta%20Quest%203%20Native-blue.svg)](https://immersiveweb.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Repository](https://img.shields.io/badge/GitHub-felipevc13%2Fdaggerfall--vr-success.svg)](https://github.com/felipevc13/daggerfall-vr)

## Quick start

```bash
npm ci
# Put your own Daggerfall ARENA2 folder at ./arena2  (never commit it)
npm run dev:quest
```

On the Quest, with USB debugging accepted: open `http://localhost:5173/play/?dungeon&class=16&vr` in the Quest Browser and press **Enter VR**. A LAN `http://192.168…` address loads the page and does not start WebXR. Full steps, the flat-game check, and hosted-build options: [docs/TESTING-ON-QUEST.md](docs/TESTING-ON-QUEST.md).

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
- **Headset stereo**: Each eye uses that eye's WebXR pose and its own asymmetric projection. The horizontal scale is mirrored (`proj[0]`). The lens centre (`proj[8]`) stays where the runtime put it. One game metre is one headset metre, and the eye offset is the pose's own.
- **Quest sticks on the dungeon player**: `src/vr/xrInput.js` reads the thumbsticks, snap turn, and face buttons. The dungeon host feeds them to the player motor while a session is presenting. The mapping and the headset checklist are in [docs/TESTING-ON-QUEST.md](docs/TESTING-ON-QUEST.md). The world and interiors still walk from the keyboard. A flat page with no session is unchanged.
- **Real-Time Remote Telemetry**: On a `?shot` boot, Quest 3 browser logs and exceptions stream to the development server at `/api/vr-log` and are saved into `.quest-vr.log`. The same shot gate covers the frame counter.

---

Detail and the telemetry file: [docs/TESTING-ON-QUEST.md](docs/TESTING-ON-QUEST.md).

---

## Where the code sits

The module is `src/vr/`. The flat entry does not load it. Two inherited files carry a named hook so the engine can draw an eye: `Renderer.setXrTarget` in `src/render/renderer.js`, and `perspectiveOffCenter` in `src/world/mat4.js`. `src/vr/engineBridge.js` is the VR side of that seam. If a hook disappears, Enter VR stays off. The rest of the coupling, the workflows, and how to merge [upstream](https://github.com/Lattymoy/daggerfall-js-source) are in [docs/repo-map.md](docs/repo-map.md).

Upstream engine (do not treat as the mod): `src/characters`, `src/world`, `src/render`, `src/formats`, `src/ui`, `src/scenes`, plus `server/` and `server-account/` for the online services. `arena2/` is the player's own 1996 data and is gitignored.

| VR file | Role |
| --- | --- |
| [`src/vr/engineBridge.js`](src/vr/engineBridge.js) | Hook probe and the only `src/vr` import of `mat4`. |
| [`src/vr/xrSession.js`](src/vr/xrSession.js) | Session and the Enter VR button. |
| [`src/vr/xrFrameLoop.js`](src/vr/xrFrameLoop.js) | Moves the page frame clock onto the headset, and back on exit. |
| [`src/vr/xrCamera.js`](src/vr/xrCamera.js) | Eye matrices. The headset's own pose and frustum. Horizontal scale mirrored; lens centre kept. |
| [`src/vr/xrInput.js`](src/vr/xrInput.js) | Sticks, snap turn, buttons, haptics. The frame clock polls them. The dungeon host feeds the motor. The lab still moves its own rig. |
| [`src/vr/xrLog.js`](src/vr/xrLog.js) | On a `?shot` boot, posts logs to `/api/vr-log` on the dev server. |
| [`vr.html`](vr.html), [`src/tools/vrLab.js`](src/tools/vrLab.js) | Empty-room lab. |

---

## 🛠️ Key Technical Findings & Solutions

1. **WebXR Black Screen Issue (LightingLane / FBO Redirection)**:
   - *Cause*: The desktop renderer created an offscreen framebuffer (`_frameFbo`) for screen-space post-processing (`AirPass`). WebGL rendered dungeon geometry into `_frameFbo` while the WebXR layer received only the clear color.
   - *Solution*: Disabled lighting lane redirection in VR with `renderer.setLightingLane(null)` and rendered geometry directly to the WebXR `layer.framebuffer`.
2. **Two campfires (the eyes do not fuse)**:
   - *Cause*: `mirrorProjectionX` negates `proj[0]` and `proj[8]`. On the flat lens `proj[8]` is 0. On a Quest eye it is the lens centre (about ±0.17 NDC). Negating it places a point straight ahead on the outer side of each lens, about 0.35 NDC from where the runtime projection puts it. The eye offset was already the headset's own (about 0.063 m), not applied twice. The air colour sample is `texture(uFrame, vUV)` into that eye's rectangle. It does not add the other eye's viewport x.
   - *Solution*: Negate only `proj[0]`. Leave `proj[8]` as the runtime matrix.
3. **Inverted Controller Coordinates**:
   - *Cause*: Multiplying controller positions by camera parity flags flipped the right hand to the left side.
   - *Solution*: WebXR controller input coordinates are physical (+X right, +Y up, -Z forward) and must never be multiplied by the eye mirror flag.

---

## Upstream

Play it: https://daggerfalljs.dev/

[DFO](https://daggerfalljs.dev/) is the game this mod targets. Useful local commands: `npm run dev:quest`, `npm run dev`, `npm run lint`, `npm run types`, `node --test test/vr/engineContract.test.js`. The full suite is `npm test`.

### License

MIT, copyright Lattymoy, with Daggerfall Unity's MIT notice (`LICENSE`). The Elder Scrolls and Daggerfall are trademarks of ZeniMax Media Inc. This is an unofficial, non-commercial fan project. Game files stay on the player's machine.
