# AGENTS.md

Guide for an AI agent in this repository. Humans: start at `README.md`. Engine law: `CLAUDE.md` and `bible/Home.md`.

## What this is

A VR mod for [DFO](https://daggerfalljs.dev/), the WebGL2 game from [Lattymoy/daggerfall-js-source](https://github.com/Lattymoy/daggerfall-js-source). Felipe's goal is a module any DFO player can turn on, so someone in a Meta Quest Browser and someone on a monitor share the same world. The Quest build is not a second game.

The module is opt-in. VR code lives in `src/vr/`. The flat game (`play/index.html` → `src/main.js`) dynamic-imports `src/vr/installVr.js` only when the URL has `?vr`. Without that flag it does not fetch the module. The headset demo is `vr-dungeon.html` (Privateer's Hold). The map of the tree, the workflows, and the coupling list is `docs/repo-map.md`. How to wear the headset is `docs/TESTING-ON-QUEST.md`.

Upstream license is MIT (`LICENSE`, copyright Lattymoy, plus Daggerfall Unity's notice). Keep that notice. Do not commit Bethesda's game files.

## Boundary

- New VR behavior goes in `src/vr/`. `src/vr/engineBridge.js` is the only file in that folder that imports `src/world/mat4.js`. Call `guardedSetXrTarget` instead of `renderer.setXrTarget`. Call `probeVrEngineHooks()` before offering Enter VR. If it returns `ok: false`, skip the session. Do not throw into the flat frame.
- `makeEnterVrButton` in `src/vr/xrSession.js` is the entry point. It returns null when the browser cannot do `immersive-vr`. On `/play/?vr`, `installVr` keeps the session up by moving the page clock in `src/vr/xrFrameLoop.js`. Hosts still call `requestAnimationFrame`. Exit restores the window clock.
- Do not import `src/vr` from `src/main.js` or `src/scenes/` with a static import. The plug is a dynamic `import('./vr/installVr.js')` after the renderer exists, gated on `params.has('vr')`, as `docs/repo-map.md` describes. Do not grow `bootWorld`, `createWorldModes`, `buildDungeonContext`, `bootExterior`, or the other hosts named in `CLAUDE.md`.
- The two inherited edits the headset needs are `Renderer.setXrTarget` / `_frameTarget` / `xrCompatible: true` in `src/render/renderer.js`, and `perspectiveOffCenter` in `src/world/mat4.js`. Touch them only to keep those hooks alive, and name the touch in the PR. Any other engine edit has to be justified the same way and covered by `test/vr/engineContract.test.js`.
- `vrDungeon.js` still imports the dungeon pipeline directly. That list is the next adapter (`docs/repo-map.md`). Do not pretend the bridge already wraps it.
- The flat game has to keep working. A change that throws while `src/main.js` evaluates is a broken mod, even if the headset demo looks fine.

## Upstream sync

```bash
git remote add upstream https://github.com/Lattymoy/daggerfall-js-source.git   # once
git fetch upstream main
git checkout -b sync/upstream-date
git merge upstream/main
node --test test/vr/engineContract.test.js
```

Merge on a branch. Never on `main`. The fragile files are `src/render/renderer.js`, `src/world/mat4.js`, and the three workflows that carry `github.repository == 'Lattymoy/daggerfall-js-source'` (`deploy.yml`, `relay-deploy.yml`, `release-desktop.yml`). Upstream's copies of those workflows publish from `main`. Re-check them after every sync. The contract test fails if the guard line is gone or a hook is missing.

Actions workflow **VR upstream contract** (`vr-upstream-contract.yml`) does that merge on a runner and runs the same test. It is `workflow_dispatch` only. It has no secrets and it does not publish. Run it when you want an early signal. Do not convert it into a push or pull-request trigger.

## How to run and check

```bash
npm ci
npm run dev:quest          # headset; see docs/TESTING-ON-QUEST.md
npm run dev                # flat dev server, localhost only
npm run lint
npm run types
node --test test/vr/engineContract.test.js
npm run test:changed       # tests the changed files can move
```

`CLAUDE.md` is still the bar before a push that touches the engine: lint, types, the bible gates (`test/bible/manifest`, `citeanchor`, `citedrift`, `mutantdrift`, `audit18_bible_docs`, `ledger`), and `npm run test:changed`. CI's `verify` workflow runs the full gate on the PR. A PR that conflicts with its base runs no workflow. Fork pins that still differ from upstream (the README door, the relay and desktop push triggers, the committed `UPDATE` stamp, the relay bundle hash) live in `test/fork/overrides.js`. Why each one is there: `docs/fork-ci.md`. Do not delete an upstream test to make this fork green. Do not cite code with line numbers in `bible/`, `test/`, `src/`, or `tools/`. Use an anchor (`file.js:"the line"`) or run `npm run cites -- --apply`.

`npm test` is the whole suite (thousands of files). Use it when the change can move hosts the pins read, or leave it to CI. Do not delete a test to go green.

Patch notes belong in the PR body under `## Patch notes: <title>`, never in a committed file (`test/tooling/rel4_release.test.js`).

## Git

- Never push to `main`. Open a PR. Do not merge it yourself.
- Small PRs. One concern. Tests that passed before the change still pass.
- Never commit `arena2/`, `ARENA2/`, `*.BSA`, `.quest-vr.log`, `.vr-chat.json`, `.vr-user-request.json`, `.quest-certs/`, or anything that looks like a token, a `.dev.vars`, or a Worker secret.
- Do not edit `server/`, `server-account/`, or `.github/workflows/` except `vr-upstream-contract.yml`, unless Felipe explicitly asked. `account-deploy.yml` is not limited to the upstream repository: a push to `main` that touches its path list will try to deploy the account service.
- Do not deploy, and do not run the operator workflows (`account-recovery`, `realm-restore`, `realm-revive`, `guild-grant`, `server-post`, `d1-load`, `relay-deploy`).

## Quest and telemetry

Follow `docs/TESTING-ON-QUEST.md`. Short form: `npm run dev:quest`, USB debugging, Quest Browser at `http://localhost:5173/vr-dungeon.html`. LAN `http://192.168…` does not enter VR.

`/api/vr-log` is a Vite middleware (`vrLogServer` in `vite.config.js`). The page `src/vr/xrLog.js` posts console output there. It is not part of the hosted game. Read the terminal or `.quest-vr.log`. Voice is `/api/vr-voice` and `.vr-user-request.json`. Chat replies are `node scripts/aiReply.mjs "text"` into `.vr-chat.json`.

Also open `http://localhost:5173/play/` and https://daggerfalljs.dev/play/ and confirm there is still no Enter VR button. That is the current online flow.

## Conventions already in the code

- ESM, hand-rolled WebGL2, no framework. Match the file you are editing.
- VR files may be in Portuguese or English. Docs for this fork are English. PR text for Felipe is Portuguese (pt-BR).
- Comments name the hook (`VR1`) and why a flat frame is unchanged.
- Do not add a second camera. Eyes go through `gameMat4.lookAt` from `engineBridge.js`. An XR projection negates only `proj[0]`. Do not pass it through `mirrorProjectionX`: that also negates `proj[8]`, which is 0 on the flat symmetric lens and is the Quest lens centre. Do not re-export those mat4 names; each stays declared once, in `src/world/mat4.js`. The off-centre frustum is `offCenterProjection`, which returns null when upstream drops `perspectiveOffCenter`.
- Daggerfall Unity is the reference for game rules, not a tree to copy. `bible/01-Overview/Port-Doctrine.md` says when that applies. VR presentation is this mod's, and it should still say where it departs.
- Hosts do not grow. See `CLAUDE.md`.

## `CLAUDE.md`

That file is upstream's agent note: bible process, cites, patch notes, Discord-as-code, host ceilings. It still applies to engine work. This file is the VR mod's note. If they disagree about a host or a cite, `CLAUDE.md` wins for the inherited engine and this file wins for what may import `src/vr`.
