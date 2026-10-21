# Repository map

This repository is Felipe's VR mod for [DFO](https://daggerfalljs.dev/), the browser game at [Lattymoy/daggerfall-js-source](https://github.com/Lattymoy/daggerfall-js-source). The live site is upstream. This fork adds a WebXR layer for the Meta Quest Browser and keeps the inherited engine, the online services, and their workflows.

The VR layer is meant to be a module a player can turn on. A person on a monitor never loads it. Today that split is already true of the flat game: `play/index.html` boots `src/main.js`, and `src/main.js` does not import `src/vr`. The headset demos are separate pages. Mounting an **Enter VR** button on the real game, including the hosted one, is the integration still to do. The recommendations are at the bottom. This change does not refactor that path.

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
| `play/index.html` | The game. Boots `src/main.js`. No VR import. |
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
| `src/vr/xrSession.js` | `immersive-vr` session, `local-floor`, `XRWebGLLayer`, and `makeEnterVrButton`. Returns null when the browser has no headset, so a flat page shows nothing. |
| `src/vr/xrCamera.js` | One eye: WebXR pose into the engine's `lookAt` / mirrored projection. Preset 5 (`VR_EYE_X`, `IPD_SCALE`, `proj[0] = -proj[0]`). |
| `src/vr/xrInput.js` | Sticks, snap turn, buttons, haptics, `ctx.collider.move`. |
| `src/vr/xrWeapons.js` | Right-hand sword, left-hand torch, tip speed. |
| `src/vr/xrMenu.js` | In-world menu. Left X or Y toggles it. Left grip holds to talk (`xrVoice.js`). A demo slate, not the game's windows. |
| `src/vr/xrVoice.js` | Microphone to `/api/vr-voice`. |
| `src/vr/xrLog.js` | Console and errors to `/api/vr-log`. |
| `src/vr/xrSkeleton.js`, `xrUI.js`, `xrCalibrator.js` | Demo enemy, combat slate, and the old optics bench. |
| `src/vr/vrDungeon.js` | Demo host. Not the online game. |
| `src/vr/engineBridge.js` | Feature detection, the `gameMat4` namespace, `offCenterProjection`, and the read-only UI hooks (`hostPaused`, `overlayOpen`). |
| `src/vr/uiPresence.js` | Generic "is a modal open?" detector. No menu list. Loaded by the dungeon demo only under `?vrui`. |

`makeEnterVrButton` is the entry point a future game host should call. It already no-ops without WebXR. Non-VR players are unaffected because the game entry never calls it.

How the game's own windows open, and the plan for mirroring them on a floating panel, is [docs/vr-menus.md](vr-menus.md). The detector in `uiPresence.js` is the first piece of that plan. It does not draw a panel yet.

## Current coupling

`git diff 2eb330d89e` (upstream at the merge of Lattymoy PR 1035, the parent of the VR commits) is the fork's delta. The engine edits are small and named. Everything else VR added is new files.

### Engine files upstream will overwrite

`src/render/renderer.js`

- WebGL context is created with `xrCompatible: true`.
- `setXrTarget(framebuffer, viewport)` and `_xrTarget`. Null means the flat canvas, which is every frame of a page that never calls it.
- `_frameTarget()` is `_frameFbo`, else the eye's framebuffer, else the canvas. The old `_frameFbo ?? null` sites read this so a nested pass returns to the eye.
- `beginFrame` binds the eye, scissors the clear to that eye, and does not resize the canvas while a session owns it.

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

`src/tools/vrLab.js` still imports `Renderer` and `mat4` for the flat preview of the made room, and calls `guardedSetXrTarget` for the eyes. It is allowed to import `src/vr`. Nothing under `src/scenes` or `src/main.js` is.

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

Not done in this change. The shape that stays mergeable:

1. Add `src/vr/installVr.js` as the only file the game calls. After `new Renderer` in `src/main.js`, dynamic-import it (`import('./vr/installVr.js')`). `test/scenes/boot1.test.js` forbids a static import of a host from `main.js`; a dynamic import of the VR installer is the same door the hosts already use, and it must stay dynamic so a broken VR module cannot throw while the flat game evaluates.
2. `installVr` awaits `probeVrEngineHooks()`. If `ok` is false, it returns. If `immersiveVrSupported()` is false, it returns. Otherwise it mounts `makeEnterVrButton`. Flat players get no button and no VR frame.
3. On enter, the active host (the four in `CLAUDE.md`: exterior, world, worldModes, dungeon) drives `requestFrame` and calls `guardedSetXrTarget` once per eye, then its existing draw with the matrices from `eyeMatrices`. That call belongs in a module the host wires, not in a longer `bootWorld`. `src/scenes/fishHost.js` is the shape `CLAUDE.md` names.
4. Move `vrDungeon.js`'s engine imports behind one dynamic loader, for example `src/vr/dungeonAdapter.js`, that returns `{ ok: false, missing }` when a symbol is gone. The demo then shows the missing list instead of a red page. The online game would not use that adapter; it would use the real hosts.
5. Keep the renderer and mat4 diffs as those named functions so a sync is a re-apply, not a second camera inside the VR folder.
6. Upstream the module only when (2) and (3) are true and the contract test is green against current `upstream/main`. Until then, https://daggerfalljs.dev/play/ has no Enter VR, which is what a Quest browser shows today.

## Dev helpers that are not the game

| File | Job |
| --- | --- |
| `scripts/devQuest.mjs` | `npm run dev:quest`. Binds `0.0.0.0`, tries `adb reverse`, prints the localhost URL. |
| `scripts/aiReply.mjs` | Appends one line to `.vr-chat.json` so the headset menu can show it. |
| `scripts/vrVoiceWatcher.mjs` | Watches `.vr-user-request.json` and prints new voice transcripts. |
| `tools/vrProbe.mjs` | Headless Chromium check of `vr.html` and the camera math. |

`.quest-vr.log`, `.vr-chat.json`, `.vr-user-request.json`, and `.quest-certs/` are gitignored.
