# Repository map

This repository is Felipe's VR mod for [DFO](https://daggerfalljs.dev/), the browser game at [Lattymoy/daggerfall-js-source](https://github.com/Lattymoy/daggerfall-js-source). The live site is upstream. This fork adds a WebXR layer for the Meta Quest Browser and keeps the inherited engine, the online services, and their workflows.

The VR layer is a module a player turns on. `play/index.html` boots `src/main.js`. That file dynamic-imports `src/vr/installVr.js` only when the URL has `?vr` (`params.has('vr')` on the boot's one `URLSearchParams`). Without the flag, no file under `src/vr/` is fetched. The headset demos are still separate pages. The button on `/play/?vr` opens an immersive session and ends it: the host frame loop is the next step. https://daggerfalljs.dev/play/ does not have this door. The recommendations for that loop are at the bottom.

License: MIT, copyright Lattymoy, with Daggerfall Unity's MIT notice. See `LICENSE`. The Elder Scrolls and Daggerfall are trademarks of ZeniMax Media Inc. This is an unofficial fan project. Original game files (`arena2/`, `ARENA2/`) are never committed.

## What a newcomer is looking at

| Path | Whose it is | Touch it when |
| --- | --- | --- |
| `src/vr/` | Felipe's VR module | VR work. New VR behavior goes here. |
| `vr-dungeon.html`, `vr.html` | VR entry pages | The Privateer's Hold demo and the empty-room lab. |
| `src/tools/vrLab.js`, `tools/vrProbe.mjs` | VR lab and its headless probe | Stereo seam without game data. |
| `src/vr/engineBridge.js` | The stereo boundary | The only `src/vr` import of `world/mat4.js`. Headset targets go through `guardedSetXrTarget`. |
| `src/`, `bible/`, `locales/`, `vendor/`, `public/` | Upstream engine and its design record | Only for a named, documented hook. Read `bible/Home.md` and `bible/01-Overview/Port-Doctrine.md` first. `CLAUDE.md` still binds that work. |
| `server/`, `server-account/` | Upstream online relay and account service | Do not change unless Felipe asked. A main push that touches the account paths can deploy. |
| `.github/workflows/` | Upstream CI, deploys, and operator jobs | Do not change unless Felipe asked. One exception lives here on purpose: `vr-upstream-contract.yml` (manual, no secrets, no publish). |
| `test/` | Upstream suite, plus `test/vr/engineContract.test.js` | VR contract tests may be added. Do not weaken a pin to make a move. |
| `app/` | Upstream desktop shell | Not the Quest path. |
| `arena2/` | The player's own Daggerfall install | Never commit. |

`AGENTS.md` is the short version of these rules.

## Root HTML

Every tracked `*.html` in the repository root is a Vite build input (`vite.config.js`, `build.rollupOptions.input`). `test/tooling/audit68_repo.test.js` fails the suite if one is missing from that list, because a page that works under `npm run dev` would otherwise never ship. The labs are also opened by probes and cited by tests and `bible/` at their root URLs (`/sky.html`, `/gun-proto.html`, and the rest). Some of those URLs are public on daggerfalljs.dev (`/mw-viewer.html` is one the tests name).

They were not moved into `prototypes/`. They are not unused, and moving them would rewrite the build, the probes, and hundreds of path pins for no gain to the VR mod. `vr-dungeon.html` was the one tracked page missing from the input list (the audit was already red on it). It is registered now so a production build contains the demo.

| Page | Role |
| --- | --- |
| `index.html` | Upstream landing page. |
| `play/index.html` | The game. Boots `src/main.js`. That file reaches `src/vr/installVr.js` only by a dynamic import, and only when the URL has `?vr`. |
| `terms/index.html`, `privacy/index.html` | Upstream legal pages. |
| `vr-dungeon.html` | VR demo. Privateer's Hold. Loads `src/vr/vrDungeon.js` and `src/vr/xrLog.js`. Needs the player's ARENA2. |
| `vr.html` | VR lab. A made room, no game data. Loads `src/tools/vrLab.js`. `tools/vrProbe.mjs` drives it. |
| `viewer.html` | Upstream voxel editor. |
| `sky.html`, `water.html`, `abyss.html`, `spire.html`, `cards.html` | Upstream labs (sky, water, Shattered Hour, Elite Breach, card table), each with a probe. |
| `mw-inspect.html`, `mw-viewer.html` | Upstream Morrowind data inspector and mesh viewer. User-supplied archives. |
| `enhanced.html`, `menu.html`, `chargen.html`, `menu-redesign.html`, `menu-pixel.html` | Upstream UI prototypes, deployed on purpose so a phone can open them. |
| `grass-proto.html`, `gun-proto.html`, `levelup.html`, `firmament.html`, `growth.html` | Upstream look and combat labs. Tests pin several of them byte for byte. |
| `archive-sheet.html`, `studio.html` | Upstream texture sheet and the artists' studio. |
| `app/launcher/index.html` | Desktop launcher page, not a root prototype. |

## VR module

| File | Job |
| --- | --- |
| `src/vr/installVr.js` | The only file the game calls. Probes the engine hooks, asks `isSessionSupported('immersive-vr')`, and mounts `makeEnterVrButton`. The press keeps the session open. `src/vr/xrFrameLoop.js` moves the page clock onto `session.requestAnimationFrame` and puts the window clock back on end. |
| `src/vr/xrFrameLoop.js` | The page's `requestAnimationFrame` stand-in while a session is active. The host still calls `requestAnimationFrame` once. The first eye is `guardedSetXrTarget`. Later eyes get a copy of that picture, unless the dungeon claimed the frame. |
| `src/vr/dungeonStereo.js` | The dungeon's per-eye paint. One game metre is one headset metre (`GAME_UNIT_IN_METERS`). Published on the clock as `dungeonEyes`. Dev flags `ipd=0` and `swapeyes` are read through `engineBridge` and do nothing without `?vr`. |
| `src/vr/xrSession.js` | `immersive-vr` session, `local-floor`, `XRWebGLLayer`, and `makeEnterVrButton`. Returns null when the browser has no headset, so a flat page shows nothing. On `/play/?vr` the plaque stays up and the next click is Exit. |
| `src/vr/xrCamera.js` | One eye: WebXR pose into the engine's `lookAt`. The XR projection negates only `proj[0]`. `proj[8]` stays the runtime's lens centre (`mirrorProjectionX` would move it; that term is 0 only on the flat symmetric lens). The eye offset is the headset's, unscaled. |
| `src/vr/xrInput.js` | Sticks, snap turn, buttons, haptics, `ctx.collider.move`. |
| `src/vr/xrWeapons.js` | Right-hand sword, left-hand torch, tip speed. |
| `src/vr/xrMenu.js` | In-world menu. Left X or Y toggles it. Left grip holds to talk (`xrVoice.js`). A demo slate, not the game's windows. |
| `src/vr/xrVoice.js` | Microphone to `/api/vr-voice`. |
| `src/vr/xrLog.js` | Console and errors to `/api/vr-log`. |
| `src/vr/xrSkeleton.js`, `xrUI.js`, `xrCalibrator.js` | Demo enemy, combat slate, and the old optics bench. |
| `src/vr/vrDungeon.js` | Demo host. Not the online game. |
| `src/vr/engineBridge.js` | Feature detection, the `gameMat4` namespace, `offCenterProjection`, and the read-only UI hooks (`hostPaused`, `overlayOpen`). |
| `src/vr/uiPresence.js` | Generic "is a modal open?" detector. No menu list. Loaded by the dungeon demo only under `?vrui`. |

`makeEnterVrButton` is the button `installVr` mounts. It returns null when the browser has no headset. A player who opens `/play/` without `?vr` never calls it, and the module is not downloaded.

How the game's own windows open, and the plan for mirroring them on a floating panel, is [docs/vr-menus.md](vr-menus.md). The detector in `uiPresence.js` is the first piece of that plan. It does not draw a panel yet.

## Current coupling

`git diff 2eb330d89e` (upstream at the merge of Lattymoy PR 1035, the parent of the VR commits) is the fork's delta. The engine edits are small and named. Everything else VR added is new files.

### Engine files upstream will overwrite

`src/render/renderer.js`

- WebGL context is created with `xrCompatible: true`.
- `setXrTarget(framebuffer, viewport)` and `_xrTarget`. Null means the flat canvas, which is every frame of a page that never calls it.
- `_frameTarget()` is `_frameFbo`, else the eye's framebuffer, else the canvas. The old `_frameFbo ?? null` sites read this so a nested pass returns to the eye.
- `beginFrame` binds the eye, scissors the clear to that eye, and does not resize the canvas while a session owns it.
- `_aimXrResolve` (fork exception): while `setXrTarget` has an eye, the air resolve writes that eye's rectangle of the XR framebuffer instead of the canvas. The world image is that eye's viewport (`xrWorldImageSize`), so the blit keeps the projection's aspect. A flat frame never sets the target, so the resolve stays the canvas. Retro mode still owns its own image size and `resolveTo` when it is on. Hosts do not call this. `guardedSetXrTarget` is the only door.

`src/world/mat4.js`

- `perspectiveOffCenter`. Symmetric edges match `perspective`. Flat frames still call `perspective`.

### Vite

`vite.config.js` registers `vr.html` and `vr-dungeon.html`, and the dev-only plugin `vrLogServer` answers `POST /api/vr-log`, `POST /api/vr-voice`, and `GET`/`POST /api/vr-chat`. Those routes exist only on `npm run dev` / `npm run dev:quest`. They are not in the production build. Game files are served the same way as upstream: `arena2DevServer` maps `/arena2/*` and `/play/arena2/*` from `ARENA2_PATH` or `./arena2`.

### What `src/vr` still imports itself

Through `engineBridge.js`: `gameMat4` (lookAt, perspective, mirrorProjectionX, identity, UP_Y) and `offCenterProjection`, which returns null if `perspectiveOffCenter` is gone. Those mat4 names are not re-exported. `probeVrEngineHooks` dynamic-imports `Renderer` and checks `setXrTarget` and `_frameTarget`. `guardedSetXrTarget` no-ops when the method is gone. `probeVrUiHooks` dynamic-imports `ui/input.js` and `ui/enhanced/enhancedOverlays.js` and checks `hostPaused` and `overlayOpen`. It does not import the window stack. Those imports run only when something asks (`uiPresence.start`, or the contract test). A missing export is a status, not a throw. The dungeon demo's `?vrui` flag passes `uiOverlayActive` into the detector; that page never registers a host.

`vrDungeon.js` still constructs `Renderer` and imports the dungeon stack directly:

- `src/render/renderer.js` (`Renderer`, `WORLD_FRAME`, `INTERIOR_CLEAR`)
- `src/formats/dfPalette.js`, `blocksFile.js`, `arch3dFile.js`, `mapsFile.js`
- `src/scenes/shared.js` (`fetchBytes`), `dataPipeline.js`, `dungeonContext.js`
- `src/player/motor.js`, `src/characters/playerEntity.js`
- `src/render/enhancedLighting.js`
- `src/world/dungeon/dungeonLights.js`, `city/cityLights.js`, `interior/interiorLights.js`

`xrSkeleton.js` still imports `formats/textureFile.js`, `formats/dfPalette.js`, and `fetchBytes`.

`src/tools/vrLab.js` still imports `Renderer` and `mat4` for the flat preview of the made room, and calls `guardedSetXrTarget` for the eyes. It is allowed to import `src/vr`. `src/main.js` dynamic-imports `installVr.js` only when the URL has `?vr`. Nothing under `src/scenes` imports `src/vr`.

`src/buildTag.js` differs from that upstream commit only by a build stamp (`BUILD_TAG` / `UPDATE`). It is rewritten by `prebuild` and restored by `postbuild`. It is not a VR hook.

`eslint.config.js` ignores `**/._*` (AppleDouble files). Not a VR hook.

## Workflows

Inherited from upstream unless noted. Do not edit them to "tidy" the fork. Pins that still differ from upstream on purpose (the README door, the relay and desktop push triggers, the committed `UPDATE` stamp, the relay bundle hash) are `test/fork/overrides.js`. The reason for each is `docs/fork-ci.md`.

| Workflow | When it runs | What it does | On this fork |
| --- | --- | --- | --- |
| `verify.yml` | Called by `check` | Lint, types, four test shards, build, Elite Gates sweep. | Runs on PRs via `check`. No publish. |
| `check.yml` | Pull request, manual | Requires `verify`. | The PR gate. Leave it. |
| `deploy.yml` | Push to `main`, manual | Builds the site and publishes GitHub Pages. | Job `main` runs only when `github.repository == 'Lattymoy/daggerfall-js-source'`. A merge from upstream can drop that line. |
| `relay-deploy.yml` | Manual | Deploys the relay Worker. Drops every connected player. | Push-to-main trigger removed. Job guarded to the upstream repository. |
| `release-desktop.yml` | Tag `app-v*`, manual | Desktop installers. | Push-to-main trigger removed. Job guarded to the upstream repository. |
| `release-notes.yml` | Manual, and `pull_request_target` when a merged PR body is edited | Rewrites a published release's notes from the PR body. | Still listens. Do not point it at production. |
| `account-deploy.yml` | Push to `main` when account paths change, manual | Creates and deploys the account Worker, D1, Discord commands. | Not repository-guarded. A main push that touches `server-account/**` or the listed `src/net` files will try to deploy. |
| `account-recovery.yml` | Manual | Writes one recovery-code hash. | Operator tool. Needs upstream secrets. |
| `d1-load.yml` | Manual | Reads account-database load. | Operator tool. |
| `guild-grant.yml` | Manual | Grants guild gold. Dry run unless apply is on. | Operator tool. |
| `realm-restore.yml` | Manual | Restores realm rows lost to a character delete. Rewinds D1. | Operator tool. |
| `realm-revive.yml` | Manual | Undoes one realm character's death. Rewinds D1. | Operator tool. |
| `server-post.yml` | Manual | Sends a developer mailbox item. | Operator tool. |
| `sd-clears.yml` | Manual | Reads who cleared an Abyss dungeon. | Operator tool. |
| `eg-sweep.yml` | Called by verify, nightly cron, manual | Walks Elite Breach courses with the real motor. | The cron runs on this fork too. It does not deploy. |
| `intro-quality.yml` | One upstream branch, plus PRs that touch the intro | Intro render check. | Idle on this fork's branches. |
| `vr-upstream-contract.yml` | Manual only | Fetches `Lattymoy/daggerfall-js-source` `main`, merges it on the runner, runs `test/vr/engineContract.test.js`. | Added for this mod. No secrets, no publish, nothing is pushed. |

## Upstream sync

There is no `upstream` remote stored in git config (only `origin`, this fork). Add it locally:

```bash
git remote add upstream https://github.com/Lattymoy/daggerfall-js-source.git
git fetch upstream main
git checkout -b sync/upstream-date
git merge upstream/main
```

Never do this on `main`, and never push the result to `main`. Open a PR.

When the merge conflicts, keep the VR files (`src/vr/`, `vr-dungeon.html`, `vr.html`, `src/tools/vrLab.js`, `tools/vrProbe.mjs`, `scripts/devQuest.mjs`, `scripts/aiReply.mjs`, `scripts/vrVoiceWatcher.mjs`, the `vrLogServer` plugin). Re-apply the two engine hunks if upstream rewrote them: `Renderer.setXrTarget` / `_frameTarget` / `xrCompatible`, and `perspectiveOffCenter`. Then run:

```bash
node --test test/vr/engineContract.test.js
```

That test is the list of hooks. It also fails if `deploy.yml`, `relay-deploy.yml`, or `release-desktop.yml` lose the `github.repository == 'Lattymoy/daggerfall-js-source'` guard. After a sync, read those three files before opening the PR. Upstream's copies still push the relay and the desktop release from `main`.

The same test can be run against a fresh merge without a local conflict dance: Actions, workflow **VR upstream contract**, run manually. A conflict fails the job and prints the unmerged paths. A missing hook fails the test. Nothing is deployed.

`src/buildTag.js` will look dirty after `npm run build`. `postbuild` checks it out. Do not commit a stamp.

## Making it a drop-in module

The door is in. The frame clock is in. The dungeon's two eyes are in. The world and the interiors still share one picture. The shape that stays mergeable:

1. Done. `src/vr/installVr.js` is the only file the game calls. `src/main.js` dynamic-imports it (`import('./vr/installVr.js')`) when `params.has('vr')`, on the boot's one `URLSearchParams`. It cannot sit between `new Renderer` and `onPageGone`: `test/ui/ink/fb1003_glleak.test.js` pins that pair, and `test/systems/perfurl_doors.test.js` pins the one parse. `test/scenes/boot1.test.js` still forbids a static import of a host from `main.js`. The import stays dynamic so a broken VR module cannot throw while the flat game evaluates, and the call's `.catch` is the second net.
2. Done. `installVr` awaits `probeVrEngineHooks()`. If `ok` is false, it returns. If `immersiveVrSupported()` is false, it returns. Otherwise it mounts `makeEnterVrButton`. The press opens the session and `createXrFrameClock` moves the page's `requestAnimationFrame` onto the session. End, a failed arm, or a failed present puts the window clock back and ends the session when the headset would otherwise stay black. A flat `/play/` gets no button and no VR request.
3. The dungeon on `/play/?dungeon&vr` draws each eye. `src/scenes/dungeonEyeHost.js` is the door (`fishHost.js`'s shape): it reads `globalThis.__xrFrameClock.dungeonEyes` and does not import `src/vr`. `dungeonStereo.js` aims `guardedSetXrTarget` per eye and composes that view onto the game eye. The motor, the tactics, and `drawFoes`' sim run once. A second eye calls `replayDungeonView`. World, interiors, and the dungeon entered from the map still draw once; the clock copies that picture. An overlay on `?dungeon` stays one picture too. No seam, or a seam that draws nothing, falls back to that copy. `syncCanvasToLayer` is not called.
4. Move `vrDungeon.js`'s engine imports behind one dynamic loader, for example `src/vr/dungeonAdapter.js`, that returns `{ ok: false, missing }` when a symbol is gone. The demo then shows the missing list instead of a red page. The online game would not use that adapter; it would use the real hosts.
5. Keep the renderer and mat4 diffs as those named functions so a sync is a re-apply, not a second camera inside the VR folder.
6. Upstream the module only when per-eye cameras (the rest of step 3) are in and the contract test is green against current `upstream/main`. Until then, https://daggerfalljs.dev/play/ has no Enter VR, which is what a Quest browser shows today. This fork's `/play/?vr` keeps the session open.

## Dev helpers that are not the game

| File | Job |
| --- | --- |
| `scripts/devQuest.mjs` | `npm run dev:quest`. Binds `0.0.0.0`, tries `adb reverse`, prints the localhost URL. |
| `scripts/aiReply.mjs` | Appends one line to `.vr-chat.json` so the headset menu can show it. |
| `scripts/vrVoiceWatcher.mjs` | Watches `.vr-user-request.json` and prints new voice transcripts. |
| `tools/vrProbe.mjs` | Headless Chromium check of `vr.html` and the camera math. |

`.quest-vr.log`, `.vr-chat.json`, `.vr-user-request.json`, and `.quest-certs/` are gitignored.
