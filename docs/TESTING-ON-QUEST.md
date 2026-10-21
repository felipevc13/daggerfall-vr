# Testing on a Meta Quest

The demo that runs in the headset today is the Privateer's Hold page, `vr-dungeon.html`. The real game at `/play/` mounts Enter VR only when the URL has `?vr`. That press opens an immersive session and ends it: the frame loop is not wired yet, so the headset does not draw the world. Without `?vr`, `/play/` is the flat game and does not download `src/vr`. https://daggerfalljs.dev/play/ is upstream and has no door. The checks are below.

WebXR is a secure context. These origins can start a session:

- `http://localhost` and `http://127.0.0.1` (what `adb reverse` gives the headset)
- `https://` with a certificate the Quest Browser already trusts

`http://192.168.x.x` loads the page and leaves `navigator.xr` undefined. Enter VR will not appear. A self-signed certificate often stops at a warning, and the immersive session stays blocked after you continue. Prefer USB.

## Once per machine

1. Install Node 22 (or Node 20.19+). From the repo root: `npm ci`.
2. Own a legal copy of The Elder Scrolls II: Daggerfall (free from Bethesda, Steam, or GOG). Copy its `ARENA2` folder to `arena2/` in the repo root, or point `ARENA2_PATH` at it. Do not commit that folder.
   The demo fetches `ART_PAL.COL`, `BLOCKS.BSA`, `ARCH3D.BSA`, `MAPS.BSA`, `CLIMATE.PAK`, `POLITIC.PAK`, and the skeleton's `TEXTURE` archive through the dev server. A partial folder fails the boot line in the on-screen log.
3. On the Quest: turn on developer mode (Meta Quest phone app, the headset, Developer Mode). Connect a data USB cable. Put the headset on and accept the USB debugging prompt.
4. On the computer: `adb devices` lists the headset as `device`, not `unauthorized`.

`adb` is Android platform-tools. The dev script still starts if `adb` is missing; it prints the reverse command for you to run.

## Every session (USB, the path that works)

```bash
npm run dev:quest
```

That runs `scripts/devQuest.mjs`. Vite listens on `0.0.0.0:5173` (or the next free port, which the script prints) and runs `adb reverse tcp:5173 tcp:5173` when a device is present.

In the Quest Browser, not a PCVR stream, open exactly:

```text
http://localhost:5173/vr-dungeon.html
```

Use the port the script printed if it was not 5173. `localhost` here is the headset's localhost, forwarded to the computer. The computer's LAN address is the wrong URL for WebXR.

`npm run dev` also serves the page, but only on localhost, and it does not run `adb reverse` or print the Quest steps. Use `dev:quest` for the headset.

Logs from the headset land in the same terminal and in `.quest-vr.log` (`POST /api/vr-log`). Voice transcripts land in `.vr-user-request.json`. To push a line back into the in-world chat: `node scripts/aiReply.mjs "text"`. To watch voice on the computer: `node scripts/vrVoiceWatcher.mjs`.

## In the headset (Privateer's Hold)

Wait until the on-page log stops on the ready line. Then:

1. **Enter VR.** Press the gold **Enter VR Dungeon** button. The browser should present a stereo session. If the button says no headset was found, the origin is not a secure context or the page is not the Quest Browser.
2. **Stereo.** Look at the sword and a doorway. One image, not a doubled one. Preset 5 is baked in (`src/vr/xrCamera.js`).
3. **Hands.** Move each controller. The right hand holds the sword, the left holds the torch. The torch throws light on the stone.
4. **Locomotion.** Left stick walks and strafes. You should stop on walls (`ctx.collider.move`), not slide through them. Click the left stick to move faster. Right stick snap-turns 45 degrees.
5. **Combat.** Swing the sword through the skeletal warrior. The log line should report a hit and the skeleton's HP. The combat slate shows the numbers.
6. **Menu.** Left **X** or left **Y** toggles the floating menu. Right trigger points the laser. Left grip (hold, then release) records a voice line. On the computer, `.vr-user-request.json` updates and the terminal prints the transcript. `node scripts/aiReply.mjs "reply"` should show the reply on the slate within a few seconds. That slate is the demo's own menu (`src/vr/xrMenu.js`), not the game's inventory. Append `?vrui` to the dungeon URL to log when the generic modal detector changes (`[vrui]` in the dev terminal). The flag does not draw a panel. See [docs/vr-menus.md](vr-menus.md).
7. **Telemetry.** Force a log (the boot lines are enough). The dev terminal prints `[INFO]` lines and `.quest-vr.log` grows. An exception prints `[ERROR]`.
8. **Exit.** Use the Quest menu to leave immersive mode. The flat page should return, still running. Reload if the canvas stays black.

Arrow keys and WASD on a desktop move the flat preview. They are not the Quest check. `vr.html` is the empty room (`Enter VR` there too) and does not need ARENA2. `node tools/vrProbe.mjs` checks that room's flat frames and the camera math in headless Chromium. It does not replace the headset.

## The real game, with `?vr`

`npm run dev:quest` prints the port (5173 unless that port was taken) and runs `adb reverse` when a headset is plugged in. In the Quest Browser, open exactly:

```text
http://localhost:5173/play/?vr
```

Use the printed port if it is not 5173. `localhost` is the headset's localhost. The LAN address will load the page and will not enter VR.

1. Pick the ARENA2 folder if the page asks. The dev server can also serve `./arena2` without the picker.
2. **Enter VR** appears only when `probeVrEngineHooks()` reports every hook and `navigator.xr.isSessionSupported('immersive-vr')` is true. A desktop browser without a headset, and a page opened without `?vr`, show no button.
3. Press **Enter VR**. The browser starts an immersive session. The dev terminal and `.quest-vr.log` get one `[INFO]` line: the frame loop is not wired yet. The session then ends and the flat page returns, with the button back. The world is not drawn in the headset. That loop is the next change. Controllers do not become a sword on this page yet.
4. If the button never appears, the origin is not a secure context, the hooks failed (a `[WARN]` line names the missing one), or the browser reported no immersive device.

## The flat game, without `?vr`

This check still has to pass.

1. With the dev server up, open `http://localhost:5173/play/` (no `?vr`) in the Quest Browser or on a monitor.
2. Confirm the game draws and that there is **no Enter VR button**. The network panel shows no request for `installVr.js` or any other file under `src/vr/`. `probeVrEngineHooks` is never called.
3. Open https://daggerfalljs.dev/play/ in the Quest Browser. That is upstream DFO. It has no `installVr` door. You get the flat game and no Enter VR. The local `.quest-vr.log` receives nothing from that origin. The log plugin is the dev server only.

## Desktop: Immersive Web Emulator

USB is the Quest check. A desktop check of the same door:

1. `npm run dev` (localhost is a secure context; `adb reverse` is not involved).
2. In desktop Chrome, install the Immersive Web Emulator extension and emulate a Quest headset.
3. Open `http://localhost:5173/play/?vr`.
4. **Enter VR** should appear. The press starts the emulated session, the terminal logs that the frame loop is not wired, and the session ends. Open `http://localhost:5173/play/` in another tab and confirm that tab never requests `src/vr`.

The extension is not a substitute for the stereo, hands, and collision checks on `vr-dungeon.html`. Those still want the headset.

## Wireless options

Use these when USB is unavailable. Confirm `navigator.xr` exists (the Enter VR button is the check) before judging gameplay.

**Trusted HTTPS tunnel.** On the computer, with the dev server up:

```bash
cloudflared tunnel --url http://127.0.0.1:5173
```

Open the printed `https://….trycloudflare.com/vr-dungeon.html` in the Quest Browser. The tunnel forwards to the dev server, so ARENA2 and `/api/vr-log` still work. ngrok's HTTPS URL is the same idea. The URL is public for as long as the tunnel runs. Do not leave voice transcripts going to a URL you shared.

**Self-signed LAN.** `npm run dev:quest:https` writes `.quest-certs/` (gitignored) and serves HTTPS on the LAN address it prints. On current Quest Browser builds the certificate warning is a bad sign: continuing often still withholds the immersive session. If Enter VR does not appear, go back to USB.

**Plain LAN HTTP.** The script prints `http://192.168…/vr-dungeon.html`. Useful only to see that the file server is reachable. It will not enter VR.

## A public build players could open

Not set up here, and nothing in this change deploys. Options, cheapest first:

1. **Static HTTPS of this fork's `npm run build`.** GitHub Pages or Cloudflare Pages on a hostname this fork controls, not daggerfalljs.dev. The build contains no game files (Port-Doctrine). A player opens the site, picks their own ARENA2, and the bytes stay in the browser's IndexedDB (`src/scenes/dataSource.js`: memory, then IndexedDB, then `./arena2`, which 404s in production). `vr-dungeon.html` calls `fetchBytes` and does not open that picker. On a static host the demo 404s the BSAs unless that origin already has ARENA2 in IndexedDB from a visit to `/play/` on the same host. Calling `ensureArena2()` before the demo fetches is the one-line gap to close before sending players a URL. The flat `/play/` picker already works, because it is upstream's.
2. **The upstream site, after the module lands.** https://daggerfalljs.dev/ is the right long-term URL: HTTPS, the ARENA2 picker, accounts, the relay. It updates from Lattymoy's `main`. Players get Enter VR only after the drop-in in `docs/repo-map.md` is merged upstream. Until then the site is the flat game on purpose. Do not point this fork's `deploy.yml` at that domain. The workflow is guarded so a push here does not publish it.
3. **A tunnel to a machine that has ARENA2 on disk.** Same as the wireless dev path. Right for one person testing. Wrong for strangers: the machine, the log, and the voice file are on the open URL.
4. **The desktop app (`app/`).** Upstream's Electron shell. It is not WebXR and it is not how a Quest Browser loads the game.

Whichever host you pick, the Quest still needs a trusted HTTPS origin or `http://localhost`. The game files stay the player's.
