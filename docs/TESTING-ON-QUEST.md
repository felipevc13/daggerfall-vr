# Testing on a Meta Quest

The headset check is the real game. `/play/` mounts Enter VR only when the URL has `?vr`. That press keeps the immersive session open. On `/play/?dungeon&class=16&vr` each eye is drawn (Privateer's Hold, as a Warrior, with character creation skipped) and the Quest controllers walk that player. On `/play/?vr` alone, and in the world and interiors, both eyes still show the one picture the host drew, and the sticks do not walk there yet. Without `?vr`, `/play/` is the flat game and does not download `src/vr`. https://daggerfalljs.dev/play/ is upstream and has no door. The checks are below.

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
http://localhost:5173/play/?dungeon&class=16&vr
```

Use the port the script printed if it was not 5173. `localhost` here is the headset's localhost, forwarded to the computer. The computer's LAN address is the wrong URL for WebXR.

`npm run dev` also serves the page, but only on localhost, and it does not run `adb reverse` or print the Quest steps. Use `dev:quest` for the headset.

Logs from the headset land in the same terminal and in `.quest-vr.log` (`POST /api/vr-log`).

`vr.html` is the empty room (`Enter VR` there too) and does not need ARENA2. `node tools/vrProbe.mjs` checks that room's flat frames and the camera math in headless Chromium. It does not replace the headset. That room moves its own rig. The dungeon on `/play/?dungeon&vr` reads the same sticks and feeds the player motor.

## The real game, with `?vr`

`npm run dev:quest` prints the port (5173 unless that port was taken) and runs `adb reverse` when a headset is plugged in. In the Quest Browser, open exactly:

```text
http://localhost:5173/play/?vr
```

The stereo check lands in Privateer's Hold as a Warrior and skips character creation:

```text
http://localhost:5173/play/?dungeon&class=16&vr
```

`16` is the Warrior. The careers table is `CLASS_CAREERS` in `src/systems/chargen.js` (Mage is 0, Warrior is 16, Knight is 17). That index is what `?class=` hands the dungeon host, and the host builds the career headless, so the character-creation wizard does not open.

Plain `?dungeon` (no `class`) runs the classic opening: character creation, then Privateer's Hold. `?dungeon` with no value is still that hold, region Daggerfall.

```text
http://localhost:5173/play/?dungeon&vr
```

Use the printed port if it is not 5173. `localhost` is the headset's localhost. The LAN address will load the page and will not enter VR.

The dev server needs Daggerfall's game files. Put the `ARENA2` folder at `./arena2` in the repo root, or set `ARENA2_PATH` to that folder. Do not commit it. With either one set, this page does not ask for a folder.

1. If `./arena2` and `ARENA2_PATH` are both unset, pick the ARENA2 folder when the page asks. The front door itself does not ask.
2. **Enter VR** appears only when `probeVrEngineHooks()` reports every hook and `navigator.xr.isSessionSupported('immersive-vr')` is true. A desktop browser without a headset, and a page opened without `?vr`, show no button.
3. The button is a small dark plaque with a bone label and a grey-gold border, on the **right edge, about a third of the way down**. It sits under the sign-in mark and above the footer, so it does not cover Settings, Overhauls, or Screenshots, and it does not sit on the compass or the vitals. It only takes clicks on itself. During the intro film the film covers it (the film is a later full-screen layer at the same depth). That is expected. The plaque is back when the title menu is up, and it stays up through character creation, the pause menu, and the dungeon. Pressing it while a session is open ends the session. The label then reads Exit.
4. Press **Enter VR**. The browser starts an immersive session and **leaves it open**. The dev terminal and `.quest-vr.log` get one `[INFO]` line: the frame loop is on the headset, the dungeon draws each eye, and other places still share one picture.
   - **Quest, stereo:** `http://localhost:5173/play/?dungeon&class=16&vr` (the port the script printed). Privateer's Hold, Warrior, no character creation. Look straight ahead: the horizon of a level corridor sits at eye height, and the floor is below that line. Look up and the ceiling comes into view. Look at a campfire: one fire, not two side by side. A near door jamb shifts a little between the eyes, and a door reads about human height (one game metre is one headset metre). Turning your head looks around. The controller checklist below is this same page. Keyboard and mouse on a desktop still do, and they still do after you exit the session.
   - **Quest, one picture:** `http://localhost:5173/play/?vr` until you are in the world, and any interior. Both eyes show the same picture. A menu open on `?dungeon&class=16&vr` does too.
   - On `?vr` alone the front door is a DOM menu, so the headset shows that picture only once a world host is drawing frames. Controllers do not become a sword on this page yet.
5. **Exit.** Press the same plaque (it says Exit), or leave immersive mode from the Quest system menu. The flat page returns, still running, and the plaque says Enter VR again. The window frame loop is back. The terminal logs that. There is not a second loop.
6. If the button never appears, the origin is not a secure context, the hooks failed (a `[WARN]` line names the missing one), or the browser reported no immersive device. A failure while the session is starting ends the session and returns to the window loop. It does not stop the flat game.

## Quest controllers in the dungeon

This mapping is only the dungeon host, and only while the immersive session is presenting. `/play/?dungeon&class=16&vr` is the page. The world and interiors still do not walk from the sticks. A menu that is open ignores the sticks and the buttons for that frame. Looking up or down does not steer. The body still moves through the same player motor as the keyboard, so a wall stops you.

| Control | What it does |
| --- | --- |
| Left stick | Walk and strafe the way your head is facing, on the level. A small rest in the centre does nothing, and it does not cancel the keyboard. |
| Right stick, left or right | Turn the body 45° once per push. Holding the stick does not keep turning. Let it return to the centre, then push again. |
| A | Jump. Hold it the same way you hold the jump key. |
| Left stick, pressed in | Run. |
| B | Crouch, once per press. Press again to stand. It does not hold you down. |
| Right trigger | Swing. Press and release, the same as the swing key. |
| Left trigger, or X | Use a door or the object you are looking at. The use completes when you let go. |
| Y, either grip, right stick up or down | Not used. |

### What to check on the Quest

Open `http://localhost:5173/play/?dungeon&class=16&vr`, press **Enter VR**, and stand in Privateer's Hold.

1. Push the left stick forward. You walk the way your head is facing, including when you have turned your head and not yet snapped your body.
2. Look up or down and walk. You still move level, not into the floor or the ceiling. The campfire is still one fire, and the horizon stays level.
3. Flick the right stick left or right. Your body turns 45° once. Holding the stick does not spin you. Release it to the centre and flick again: one more turn.
4. A jumps. Click the left stick and you run. B crouches once per press, and the next press stands you.
5. The right trigger swings. The left trigger, or X, opens a door or uses the thing in front of you.
6. Open a menu. The sticks do not walk or turn, and the triggers do not swing, until the menu closes. Closing it while a stick is still held does not turn you.
7. Exit VR. The keyboard and mouse still move you. Open `http://localhost:5173/play/` with no `?vr`: there is no Enter VR button, and the sticks are not in that page.

## The title panel

`/play/?vr` can be entered from the title menu, after the intro film has uncovered the Enter VR plaque. The session stays open. Until you pick a game, the headset shows a dark room and one large panel: the same front door the page is showing (Online, Offline, login, settings, overhauls, new game, load). Point the right controller. The trigger clicks. The left controller is used when the right ray misses the panel. Looking up does not tilt the panel. Y, the grips, and the sticks do not drive this screen.

Typing into a login field is not settled on a headset. A trigger on a text field focuses it. If the Quest does not raise its keyboard, leave the login for a later pass and use Offline, which does not need an account.

When the door closes, the panel loop stops and the session does not. The world is the picture the game was already drawing in VR: one shared view outdoors and in interiors, both eyes in a dungeon. Menus you open after that are not on the panel yet.

### What to check on the Quest

Open `http://localhost:5173/play/?vr` (the port the script printed). Wait until **Enter VR** is visible, then press it.

1. You are in a dark room. A large panel in front of you shows the front door, readable enough to tell Online from Offline.
2. Point the right controller at Offline and pull the trigger once. The offline doors appear on the same panel. Holding the trigger does not fire them again.
3. Open Settings or Overhauls from the panel, then come back. The page you see in the headset is the page that changed.
4. Point at the right edge, where the flat Exit plaque sits. That plaque is not a door on the panel, and the session stays up.
5. Start a game (Offline, then New Game, or Continue if you have a save). The panel goes away. The session stays. You are in the world, still in VR.
6. Open `http://localhost:5173/play/` with no `?vr`. There is no Enter VR button and no panel.

A dungeon you enter from that same session still draws both eyes, and the sticks still walk you, as in the controller checklist above.

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
4. **Enter VR** should appear on the right edge, under the sign-in mark. It is covered during the intro film and back on the title menu. The press starts the emulated session and **keeps it open**. The terminal logs that the frame loop is on the headset and that the dungeon draws each eye.
   - Open `http://localhost:5173/play/?dungeon&class=16&vr`. The emulator's two views are Privateer's Hold from two eyes, with character creation skipped (16 is the Warrior). Looking straight, a level corridor's horizon sits near the middle of each view and the floor is below it. A campfire is one fire across the two views. A near door jamb shifts between the views, and the two views fuse. Yaw the emulated head and the view turns. If the emulator exposes the touch controllers, the checklist below applies. Plain `?dungeon&vr` runs character creation first, then the same hold. The dev server needs `./arena2` or `ARENA2_PATH`.
   - Open `http://localhost:5173/play/?vr` and enter the world, or open an interior. Both emulator views show the same picture.
   - Open `http://localhost:5173/play/` in another tab and confirm that tab never requests `src/vr`.
   Leaving the session from the emulator (or the Exit plaque) returns the window loop, and the terminal logs that the window frame loop is back.

The extension is not a substitute for the stereo check on a real Quest.

## Wireless options

Use these when USB is unavailable. Confirm `navigator.xr` exists (the Enter VR button is the check) before judging gameplay.

**Trusted HTTPS tunnel.** On the computer, with the dev server up:

```bash
cloudflared tunnel --url http://127.0.0.1:5173
```

Open the printed `https://….trycloudflare.com/play/?dungeon&class=16&vr` in the Quest Browser. The tunnel forwards to the dev server, so ARENA2 and `/api/vr-log` still work. ngrok's HTTPS URL is the same idea. The URL is public for as long as the tunnel runs.

**Self-signed LAN.** `npm run dev:quest:https` writes `.quest-certs/` (gitignored) and serves HTTPS on the LAN address it prints. On current Quest Browser builds the certificate warning is a bad sign: continuing often still withholds the immersive session. If Enter VR does not appear, go back to USB.

**Plain LAN HTTP.** The script prints `http://192.168…/play/?dungeon&class=16&vr`. Useful only to see that the file server is reachable. It will not enter VR.

## A public build players could open

Not set up here, and nothing in this change deploys. Options, cheapest first:

1. **Static HTTPS of this fork's `npm run build`.** GitHub Pages or Cloudflare Pages on a hostname this fork controls, not daggerfalljs.dev. The build contains no game files (Port-Doctrine). A player opens `/play/`, picks their own ARENA2, and the bytes stay in the browser's IndexedDB (`src/scenes/dataSource.js`: memory, then IndexedDB, then `./arena2`, which 404s in production). The flat `/play/` picker already works, because it is upstream's.
2. **The upstream site, after the module lands.** https://daggerfalljs.dev/ is the right long-term URL: HTTPS, the ARENA2 picker, accounts, the relay. It updates from Lattymoy's `main`. Players get Enter VR only after the drop-in in `docs/repo-map.md` is merged upstream. Until then the site is the flat game on purpose. Do not point this fork's `deploy.yml` at that domain. The workflow is guarded so a push here does not publish it.
3. **A tunnel to a machine that has ARENA2 on disk.** Same as the wireless dev path. Right for one person testing. Wrong for strangers: the machine, the log, and the voice file are on the open URL.
4. **The desktop app (`app/`).** Upstream's Electron shell. It is not WebXR and it is not how a Quest Browser loads the game.

Whichever host you pick, the Quest still needs a trusted HTTPS origin or `http://localhost`. The game files stay the player's.
