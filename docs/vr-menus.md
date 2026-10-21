# Menus in VR

Checked against fork `main` at `b981f536f0` (PR #4, the merge of upstream `4bba28c6c7`). Line numbers are from that tree. The engine files named here were not edited for the detector, so a later edit above one of them moves the number. The quote next to a line is the text that was there.

Legend:

- **[V]** read in this tree, with `path:line`.
- **[S]** an inference, a headset measurement nobody has taken, or a claim from outside this repository that this pass did not re-check.

This page is the plan. The code that landed with it is only the detector in `src/vr/uiPresence.js`. It does not draw a panel.

## Summary

1. **The UI is hybrid, and most of it is DOM.** Each window can exist in two skins. Classic draws into the WebGL canvas in a virtual 320×200. Enhanced Plus, the default, is fixed `div`s on `document.body` over the canvas. Several screens are DOM on both skins: the boot menu, Settings, and the online panels. A VR path that only reads the canvas misses those.
2. **Windows are owned per host, not by one global stack.** `makeWindowStack` is the port of Daggerfall Unity's `UserInterfaceManager`, and four hosts each keep one. Enhanced doors put a stub in the same slot, so the host's pause covers both skins. DOM doors also register a close function in `enhancedOverlays`. Since the upstream sync, `hostPaused()` in `src/ui/input.js` is a global read of whatever pause the live host published.
3. **The gamepad already solves "any window" for a device that is not a mouse.** Under the Plus layout it ORs the host pause, the overlay registry, and a DOM sweep, then clicks by dispatching synthetic pointer events. VR is a third device of that kind. The sweep it uses today keys off the id prefix `enhanced-`, which the Wyrd door does not use.
4. **Recommendation: mirror the whole 2D plane on one floating panel.** Detection stays generic, which is what `uiPresence.js` does now. A menu upstream adds later shows up because it has to occupy a host slot, register an overlay, or put a fixed interactive element on the body in order to work in the flat game. Drawing that plane, and pointing at it, are the next pull requests. They are listed at the end, with the questions that are still Felipe's.

## How the UI works today

### Two skins, one door

**[V]** The skin is `src/systems/uiSkin.js:35` (`export const SKINS`) and `:36` (`export const DEFAULT_SKIN = 'enhanced'`). `isEnhanced` is `:58`. `?skin=classic` or `?skin=enhanced` answers for this page load only (`skinOverride`, `:45`). Changing skin reloads the page.

**[V]** Enhanced Plus is the only dress the enhanced skin wears. `isEnhancedPlus` (`:69`) returns the same answer as `isEnhanced`. Classic is untouched by that.

**[V]** A door is one function that mounts whichever window the skin asks for and returns one object. Checked entry points:

| Door | Function |
| --- | --- |
| Inventory | `createInventoryWindow`, `src/ui/inventoryDoor.js:64` |
| Character sheet | `createCharSheetWindow`, `src/ui/charSheetDoor.js:134` |
| Spellbook | `createSpellbookWindow`, `src/ui/spellbookDoor.js:57` |
| Rest | `createRestWindow`, `src/ui/restDoor.js:41` |
| Talk | `createTalkWindow`, `src/ui/talkDoor.js:56` |
| Trade | `createTradeWindow`, `src/ui/tradeDoor.js:35` |
| Book | `createBookReaderWindow`, `src/ui/bookDoor.js:51` |
| Wyrd | `createWyrdOverlay`, `src/ui/wyrdDoor.js:27` |

`src/ui` holds 403 JavaScript files and 71 `*Door.js` / `*Window.js` files. The table is not the mechanism.

### What a host knows about a window

**[V]** Hosts treat a window as an object with optional `draw`, `tick`, `input`, `keyup`, `click` / `clickNative`, `pointer`, `hover`, `wheel`, `release`, `done`, and `dispose`. Flags include `pauseWhileOpen`, `previousWindow`, `hidesHud`, and `holdsTop`. `pauseWhileOpen` (`src/ui/windowStack.js:43`) is true unless the window sets it to `false`. A plain object pauses. The status readout is the opt-out.

**[V]** Classic click coordinates are native 320×200. `nativeMetrics` (`src/ui/native/nativePanel.js:38`) is an integer scale `floor(min(w/320, h/200))` plus a centered letterbox. `pointToNative` is `:118`. The host converts a DOM event on the canvas into backing pixels and then into that space. VR should not call `click(vx, vy)` itself. A synthetic `PointerEvent` on the canvas lets the host do the conversion it already does for a mouse.

**[V]** DOM windows satisfy the same contract with empty methods. The enhanced inventory creates `div#enhanced-inventory` (`src/ui/inventoryDoor.js:124`) and the host still puts the stub in the slot, so the game pauses. The Wyrd door does the same with `id = 'wyrd-host'` (`src/ui/wyrdDoor.js:33`) and `position:fixed;inset:0;z-index:13`. A detector that requires the prefix `enhanced-` already misses a door that shipped in this sync.

### Where pixels come from

**Classic, on the canvas.** **[V]** `Renderer.drawScreenQuad` (`src/render/renderer.js:4818`) is the 2D primitive, in canvas pixels, origin at the top left. The first 2D draw ends the world pass (`endWorldPass`, `:2144`, called from the quad at `:4825`). Panel models (paper doll, automap) draw into whichever framebuffer is bound. Redirecting that pass to a texture is a renderer hook. It is not in this change. `setXrTarget` (`:2090`) remains the only headset hook in that file.

**Enhanced, in the DOM.** **[V]** The z-index ladder is written down at `src/ui/enhanced/enhancedStyle.js:944`: door hosts 11–14, bottom sheets 20, the update scrim 30, the notice stack 31, the asset picker 40. The enhanced HUD is `.hud { position: fixed; inset: 0; z-index: 4; pointer-events: none` (`:3112`). A search for `.body.append` or `.body.appendChild` under `src/` hits 83 JavaScript files (`document.body` or `doc.body`). A looser `body.append` hits 118, and many of those append into a panel's own content node, not the document. `mountEnhancedChunk` (`src/ui/enhanced/enhancedChunk.js:108`) is the lazy loader; 21 other files call it.

**DOM on both skins.** **[V]**

- The boot menu is `runEnhancedMenu` (`src/ui/enhanced/enhancedMenu.js:6282`), reached from `src/main.js:182` after `runCinematicFrontDoor` (`src/ui/intro/introScreen.js:319`, called at `src/main.js:202`).
- Professions, Family, mailbox/report, Growth, and Quests open the enhanced pause on either skin (`src/ui/pauseDoor.js:220` through `:236`). Quests is the line this sync added (`hooks.at === 'quests'`, `:236`).

**[S]** Online panels (chat, social, profile, player trade) are described in their own files as keeping one face on either skin. Chat was checked far enough to know it is a fixed body child: `.dfchat` is `position: fixed` (`src/ui/chatPanel.js:224`), the root is created at `:570`, and it is appended at `:775`. It contains inputs, so the DOM rule below reports it open. Whether every online panel is shaped that way was not re-walked file by file.

### The window manager is per host

**[V]** `makeWindowStack` is `src/ui/windowStack.js:126`. `pushWindow` is `:209`, `popWindow` is `:225`, `paused` is `:371`, `reconcile` is `:409`. `paused()` is a latch: it rises when a pausing window is added and falls only when the stack drains. `reconcile` is how a host that wrote its slot by hand (on the order of forty call sites, by the file's own comment) is caught up once a frame. Between those two moments the hosts also ask `pauseWhileOpen(slot)`.

**[V]** The four stacks:

| Host | Created |
| --- | --- |
| `townTalk` (the street slot) | `src/scenes/townTalk.js:210` |
| `worldModes` (interior) | `src/scenes/worldModes.js:2607` |
| `dungeonContext` | `src/scenes/dungeonContext.js:2308` |
| `interior` (the dev host) | `src/scenes/interior.js:145` |

**[V]** The world host's pause is `src/scenes/world.js:6818`:

```js
const gamePaused = () => staffTeleportHeld || townTalk.overlayActive || (modes?.overlayHeld ?? false);
```

`townTalk.overlayActive` (`src/scenes/townTalk.js:1548`) is that stack's latch. `modes.overlayHeld` (`src/scenes/worldModes.js:10565`) folds in the interior and dungeon latches. The same predicate is `inputHooks.paused` (`src/scenes/world.js:18162`). `inputHooks.overlayActive` (`:18139`) is wider: it also treats the travel view as a window. `attachGamepad` and `attachTouch` both call `noteHostInput(hooks)` before they refuse a machine with no pad or no touch (`src/ui/gamepadInput.js:167`, `src/ui/touch/touch.js:197`).

**[V]** `hostPaused` is the global read of that object (`src/ui/input.js:100` `noteHostInput`, `:102` `hostPaused`). It returns `null` until some host has registered, and `null` again if `paused()` throws. The boot menu and the cinematic have no host, so they do not answer here. `staffTeleportHeld` is OR'd into `gamePaused`, so a true answer is not always a window. Treating that as "show the panel" is the fail-open rule, not a claim that the staff is a menu.

There is no exported list of live stacks. The objects stay inside the hosts, and so does the stack's pause method: `test/scenes/roadb_host_pause.test.js` allows that call only in the four hosts that own a stack. `hostPaused()` is the read upstream added for everyone else. The detector does not import the stack module and does not call that method. The Privateer's Hold demo builds `dungeonContext` and never calls `noteHostInput`, so `hostPaused()` stays idle there. The context does publish `uiOverlayActive` (`src/scenes/dungeonContext.js:9875`), which is `dungeonPaused()`. `?vrui` passes that getter as `publishedOpen`.

**[V]** DOM doors register a close function. `registerOverlay` is `src/ui/enhanced/enhancedOverlays.js:71`, `overlayOpen` is `:84`, `closeTopOverlay` is `:92`. 27 other files call `registerOverlay`. The registry holds functions, not elements, so it can say that something is open and cannot say which node.

**[S]** `setCursorActive` (`src/player/pointerLock.js:98`) makes `requestLook` (`:332`) a no-op while the cursor is held free. Hosts call `requestLook` on canvas `pointerdown`. A later input bridge should set the cursor active for the session so a synthetic click does not grab the lock. That call is not part of the detector.

### The gamepad is the precedent

**[V]** `src/ui/gamepadInput.js:591`:

```js
const overlay = !!hooks.overlayActive?.() || (plus && (!!hooks.paused?.() || overlayOpen() || domWindowUp(dt)));
```

`domWindowUp` (`:494`) walks the body's children five times a second (`domAt = 0.2`, `:497`) and keeps a child whose id starts with `enhanced-` (`:502`), that has client rects, and whose computed style is not `display: none`, `visibility: hidden`, or `pointer-events: none` (`:507`). `#enhanced-hitnums` is called out in the comment at `:504` as the full-screen layer that must not count. `#wyrd-host` does not start with `enhanced-`, so this sweep misses it. The host pause still catches Wyrd when the stub is in a slot. A door that is only DOM, with a new id, and not registered, would not.

**[V]** Clicks go through `domTargetAt`, `domPointer`, and `domHoverChange` in `src/ui/plus/plusPad.js` (`:391`, `:398`, `:417`). `interactiveAt` is `:321`. Over a DOM node the pad dispatches pointer events at that node. Over the canvas it dispatches a `PointerEvent` and the host converts to 320×200. `synth` (`src/ui/gamepadInput.js:127`) dispatches a `KeyboardEvent` on `document`. The stale-button edge is the comment at `:598`: a button held across the frame a window opens or closes is ignored until it is released.

The panel's pointer bridge should call these functions through the engine bridge, not copy them. That bridge is not in this change. The detector only answers whether the panel should be up.

## Inventory

Columns: **R** is where it draws (C canvas, D DOM, C/D depends on the skin, D² DOM on both skins). **P** is whether the stack pauses. "Slot" means the host's window slot. The host's pause reader already includes it, and `hostPaused()` is what the detector reads.

This is a map of families, not a whitelist. Counts above are why it cannot be a whitelist.

| Family | Where it lives | Opens by | R | P |
| --- | --- | --- | --- | --- |
| Cinematic, boot menu | `introScreen.js:319`, `enhancedMenu.js:6282`, `main.js:182` | Boot | D² | No host yet. `hostPaused()` is null. The DOM scan is the signal. |
| Classic Begin (title, video, start) | `src/scenes/menu.js`, `src/ui/startWindow.js` | Begin rail or `?begin` | C | No host. **[S]** The whole 2D plane is the UI in that phase; the detector does not yet treat "no host" as open by itself. |
| Character creation | `src/systems/chargenSession.js`, classic `src/ui/chargen.js`, enhanced `#enhanced-chargen` | New game | C/D | Yes, once a host holds the window |
| Pause, Settings | `src/ui/pauseDoor.js:236`, sections forced to the enhanced pause at `:220`–`:236` | `Escape` → `togglePause` (`src/ui/input.js:953`) | C/D, Settings D² | Yes |
| Inventory, loot | `inventoryDoor.js:64` | `Inventory` (`input.js:955`) | C/D | Yes. **[S]** The quick-loot plaque is HUD and does not pause. |
| Sheet, spellbook, maps, books, rest, transport | The doors in the table above; automap and travel map actions at `input.js:984` and `:994` | Their actions in `routeAction` (`input.js:931`) | C/D | Yes, unless the window sets `pauseWhileOpen: false` |
| Talk, trade, bank, tavern, guild, Wyrd | `talkDoor.js:56`, `tradeDoor.js:35`, `wyrdDoor.js:27` | Activate in the world | C/D or D² | Yes, via the slot and, for the DOM doors, `registerOverlay` |
| Message boxes, yes/no, input | `src/systems/notify.js`, `src/ui/yesNoBox.js`, `src/ui/inputMessageBox.js` | Game systems | C/D | Yes on the stack. The enhanced notice element is passive in the DOM scan (pointer-events none, id `enhanced-notice`). |
| Status readout | `src/ui/statusBox.js` | Status action | C/D | **No.** `pauseWhileOpen: false`. The host's pause reader is false, so `hostPaused()` is false. |
| Death | `src/ui/deathScreen.js` | Event | C/D | Yes, and `holdsTop` |
| Radial dial, notice board, bounty, broker, arena, naval, Elite Gates | `pixelDial.js` and the `*Door.js` files that call `registerOverlay` | World activation or Tab | D² in general | Yes, via the registry or the slot |
| Chat and the other online panels | `chatPanel.js:570` | Enter, and the social keys | D² | Usually no. Chat still matches the DOM rule because it is fixed and has inputs. |
| HUD | classic `src/ui/hud/hud.js`, enhanced `.hud` at `enhancedStyle.js:3112` | Always | C/D | Not a menu. The enhanced root is `pointer-events: none` and class `hud`, so the scan skips it. |

**[V]** Stacks are real. A message box is pushed over the inventory. `eachCoveredWindow` (`windowStack.js`, the draw chain above `pushWindow`) is how the window underneath is painted. One panel shows the whole stack. VR does not open a second panel per window.

**[S]** A few host doors (`openShipPurchase` and its neighbours) were not opened one by one. They use the same slot. If one of them does not, it is invisible to `hostPaused` until it also hits the DOM rule or the registry. That is the same hole the flat gamepad has, plus the id-prefix hole the detector here does not have.

## Input flow

### Keyboard

**[V]** The world host listens for `keydown`. With a window up, `routeKey` (`src/ui/input.js:766`) gives the key to the window: raw `e.code` for a choice window, otherwise `overlayAction` (`:632`), which turns the key into `up`, `down`, `confirm`, `back`, or `char:…`. With no window, `routeAction` (`:931`) calls the host (`togglePause` at `:953`, `toggleInventory` at `:955`, and the rest of that switch). DOM windows also listen themselves, on the capture phase. `isTextEntryTarget` leaves a text field its own keys. `routeKeyUp` (`:686`) is a separate path; the automap uses it.

### Mouse and touch

**[V]** `pointerdown`, `wheel`, and `pointermove` land on the canvas. The host tries the street slot, then the mode slot, then HUD clicks, then `requestLook`. DOM windows sit above the canvas, so the canvas never sees those clicks. `installContextMenuGuard` (`src/ui/input.js:756`) suppresses the browser's context menu. The right button is a game button.

### What that means in VR

The injection point that covers both skins is the gamepad's: a point `(clientX, clientY)` and synthetic events.

- If `elementFromPoint` hits a DOM node that is not the canvas, `domPointer` delivers the events there.
- Otherwise the canvas gets a `PointerEvent` and the host converts it.
- Keys are `KeyboardEvent`s on `document`.

No host, window, or door has to know the click came from a controller. That bridge is the next code change after this detector, not this one.

## Stable hooks

| Hook | Where | What VR uses it for |
| --- | --- | --- |
| `hostPaused()` | `src/ui/input.js:102` | "A host says a pausing window is up." Null before any host registers. Read by `readHostPaused` in the bridge. This is the pause signal. |
| `overlayOpen()` / `closeTopOverlay()` | `enhancedOverlays.js:84`, `:92` | "A DOM door registered." The detector reads the first. The second is the panic-close for a later PR. |
| Fixed body children | Door hosts, z 11–14 (`enhancedStyle.js:944`) | The DOM scan. Geometry and pointer events, not id prefixes. `wyrd-host` is the counterexample the prefix misses. |
| `uiOverlayActive` | `dungeonContext.js:9875` | The dungeon demo's published latch, passed as `publishedOpen`. That page never calls `noteHostInput`. |
| `makeWindowStack` and its pause method | `windowStack.js:126`, `:371` | The four hosts only. Not a VR hook. |
| `domTargetAt`, `domPointer`, `domHoverChange`, `interactiveAt` | `plusPad.js:391`, `:398`, `:417`, `:321` | The future pointer bridge. Not called by the detector. |
| `setCursorActive` | `pointerLock.js:98` | The future pointer bridge, so synthetic canvas clicks do not lock the mouse. |
| `drawScreenQuad` / `endWorldPass` | `renderer.js:4818`, `:2144` | The future canvas layer. A named `setUiTarget` next to `setXrTarget`, or nothing until that PR. `renderer.js` is the file upstream rewrites most often. |
| `nativeMetrics` / `pointToNative` | `nativePanel.js:38`, `:118` | Not needed. The host converts the synthetic event. |

**[V]** `windowStack.js` and `enhancedOverlays.js` still have the same jobs they had before this sync. `input.js` gained `hostPaused`. `pauseDoor.js` gained the Quests tab that forces the enhanced pause on either skin. New doors in this sync (Wyrd) are a fixed host, a `registerOverlay`, and a stub in the town slot. The generic signals see that shape. An id prefix does not.

## Architecture

The same criteria as the study: a new menu works with no VR edit; both canvas and DOM are covered; the Quest can read the text; the cost is acceptable while the game is paused; the engine edit is small; the failure mode is a visible panel rather than a stuck game.

### A. Virtual screen — recommended

Draw the canvas 2D layer (HUD plus classic windows) into a render target the size of the page, rasterize the visible DOM windows into a second texture, and show both on one quad about 1.2 m in front of the player. A controller ray hits the quad at `(u, v)`, which becomes `(clientX, clientY)`, which becomes the same synthetic events the gamepad already sends.

This needs one named renderer hook (`setUiTarget`, beside `setXrTarget`) or a spike that wraps `drawScreenQuad` from the outside. The spike is not the production hook. The DOM rasterizer is the risky part and is why the library question is still open.

### B. WebXR quad layer — later, on top of A

**[S]** Meta's Quest Browser has documented WebXR Layers support, including a quad layer, and there is a known issue where a quad's width and height come out half size (`immersive-web/layers#324`). This pass did not re-test that on a headset. A quad layer is a sharper way to show the texture from A. It means moving the session in `src/vr/xrSession.js` off a plain `XRWebGLLayer` (`:50`) onto `XRWebGLBinding` plus a projection layer. Feature-detect it. Do not block A on it.

### C. WebXR DOM Overlay — not the plan

**[V]** `enterVrSession` already accepts `domOverlayRoot` and requests the `dom-overlay` feature (`src/vr/xrSession.js:54`). **[S]** Reports from the Babylon forum and wolvic#1815 say the Quest Browser rejects `dom-overlay` for `immersive-vr`. This pass did not re-test that. Until a headset shows otherwise, DOM Overlay is not the path.

### D. Leave immersive mode — the escape hatch

When a DOM menu opens, end the session. The Quest shows the page on its own floating browser panel, with the system pointer and keyboard. When the menu closes, VR has to be entered again, and that enter needs a user gesture. **[V]** `closeOnOutsideTap` (`enhancedOverlays.js:113`) runs the close inside the gesture, which is the kind of click that can re-enter. Escape and the B button are not a gesture. **[S]** Whether the closing click can call `requestSession` again has to be tried on the headset. Keep D as a button ("open this on the flat screen") for file pickers, native `<select>`, and a rasterizer that failed. It is a poor default.

### E. HTML-in-Canvas — later, if the browser grows it

**[S]** `texElementSubImage2D` is behind a flag and an origin trial in desktop Chromium. It is not something to depend on in the Quest Browser today. If `'texElementSubImage2D' in WebGL2RenderingContext.prototype` is ever true, it replaces the DOM rasterizer in A and the hit testing comes with it. Detect it. Do not vendor a polyfill that pretends it exists.

### F. Rebuild the menus in 3D — rejected

**[V]** The Privateer's Hold page used to draw its own tabs (inventory, stats, chargen, chat, options) on a 2D canvas with fixed sample data. That slate left with the page. Rebuilding the game's menus in 3D stays rejected: every new upstream menu is a miss, and the game rules would be copied.

| | A | B | C | D | E | F |
| --- | --- | --- | --- | --- | --- | --- |
| New menu works with no VR edit | yes | yes, with A | yes | yes | yes | no |
| Canvas | yes | yes | no | yes | — | partly |
| DOM on a Quest today | yes, rasterized | yes, with A | **[S]** no | yes | **[S]** no | no |
| Stays inside the immersive session | yes | yes | yes | no | yes | yes |
| Engine edit | one named hook | session setup | none | none | none | none |

## Recommendation

**A, with D as the escape hatch, B as a sharpness upgrade, and E as the future DOM upload.**

Show the panel when any signal says a modal is up. In doubt, show it. The bad case is a panel the player did not need. The worse case is a modal they cannot see and cannot close.

```text
open =
     hostPaused() === true
  || publishedOpen() === true
  || overlayOpen()
  || the DOM scan finds a window
  || a live read threw
```

`publishedOpen` is optional. Nothing on `/play/` passes one, so that term stays idle.

A missing export is not a throw. The other signals still answer, and the contract test fails so the sync is visible. `hostPaused() === null` means "no host yet", not "open". The boot menu is caught by the DOM scan. The classic Begin canvas, which has no host and no DOM window, is not caught yet. **[S]** That phase should keep the panel up for the whole 2D plane. It can ride the canvas-layer PR, when "something was drawn in 2D this frame" exists. Doing it now, with no 2D target, would mean "no host registered" equals "modal", and a dungeon session would show a panel the whole time.

### DOM scan

Direct children of `document.body`, other than the canvas, a `data-vr-chrome` node, and the passive list (`enhanced-hitnums`, `enhanced-pickupfeed`, `plus-pad-prompts`, `enhanced-notice`, class `hud`, class `notice-stack`). Visible (`display`, `visibility`, opacity, a non-empty rect). `pointer-events` is not `none`. `position` is `fixed` or `absolute` when the style can be read. And either the box covers at least 25% of the viewport, or the subtree has a control (button, link, field, or a dialog role). The active element is the match with the highest z-index.

If the style cannot be read, the child still counts. A new passive layer that is not on the ignore list shows the panel. That is the point of the fictional-id test: `festival-2099-host` is not named anywhere under `src/vr/`, it is a small fixed box with a button, and the detector opens.

The scan runs only after `start()`, at 5 Hz, plus a `MutationObserver` on the body's child list when one exists. `createUiPresence()` by itself does not load the engine and does not set a timer.

### What the detector returns

`subscribe` is called immediately with the current snapshot, then only when it changes. `isOpen()`, `activeElement()`, and `activeRect()` read that snapshot.

- A DOM hit: `kind: 'dom'`, the element, and its rectangle.
- A canvas or host pause, with no DOM hit: `kind: 'canvas'`, the game canvas and its rectangle, when a canvas was passed or the document has one.
- Open with no box (the overlay registry alone, and no canvas): `kind: 'none'`, a null rectangle. The panel PR can fall back to the viewport.

The `?vrui` watcher lived on the removed Privateer's Hold page. `uiPresence.js` is still the detector. Nothing on `/play/` starts it, so it does not import into the flat game. **[S]** `innerWidth` and `innerHeight` during an immersive session are not known until someone wears the headset. A later plug can post that snapshot to `/api/vr-log`. The Enter VR button stays `data-vr-chrome`, so it is not a false open.

### What the panel PR still has to decide

Position, once, when `open` goes from false to true: yaw only, about 1.2 m out, a little below the eyes, fixed in the world, with a lazy follow if the player turns past it. One panel for the whole stack. Locomotion and snap turn freeze while `isOpen()` is true. Head tracking does not. The laser exists only while the panel does.

The canvas layer is one draw per XR frame, not one per eye, into a target the size of the UI, not the size of the stereo buffer. **[V]** `syncCanvasToLayer` (`src/vr/xrSession.js:76`) stretches the canvas to the layer. The game path must not call it. `nativeMetrics` would then letterbox a double-wide stereo buffer.

The DOM layer is a raster of the elements `findDomModal` found, plus whichever passive HUD Felipe wants on the same plane. Re-rasterize when the DOM changes, after an injected event, and on a cap around 10 Hz. Synthetic events do not light `:hover`. The pad's `markHover` is the stand-in. **[S]** Foreign-object SVG versus a vendored `html-to-image` is the open library question. Child canvases (the inventory paper doll, the menu's own canvases) have to become images or the raster shows a hole.

Controller mapping for the pointer bridge, not implemented here: right trigger is the left mouse button, A is the right button, right stick Y scrolls, B is a synthetic Escape, Y toggles pause when the panel is closed. **[S]** The left menu button may not be exposed to WebXR on the Quest, which is why pause is Y and not that button. The stale-edge rule from the gamepad (`gamepadInput.js:598`) has to apply, because B is crouch in the world today (`xrInput.js`).

## Pull requests

PR #4 already merged upstream, including `hostPaused` and the Wyrd door. This pull request is the document and the detector. Each later one is one concern, does not grow a host, and leaves `/play/` with no Enter VR button.

| Next | What it adds | Done when |
| --- | --- | --- |
| Panel pose | Place the quad on open (yaw only, 1.2 m). A test quad in `vr.html`, no game data. | Math tests. On a headset, it appears in front and does not follow pitch. |
| Pointer bridge | Ray to `(u, v)` to synthetic events, through `domTargetAt` / `domPointer` loaded by the bridge. Stale buttons. `setCursorActive` for the session. | Fake targets: down/move/up/click, right-click, Escape. |
| Canvas layer | Named `setUiTarget` on `Renderer`, pinned in `test/vr/engineContract.test.js` the way `setXrTarget` is. UI-sized canvas. Quad drawn after the world, depth off. | Flat `drawScreenQuad` tests stay green. Classic windows land on the quad. |
| DOM raster | Foreign-object or the library Felipe picks. Dirty tracking, a rate cap, hover via `markHover`. | Inventory, Settings, and the boot menu readable on the Quest. |
| Game plug | Depends on `installVr.js` from `docs/repo-map.md`. Wire the detector, the panel, and the pointer. Freeze VR locomotion while `isOpen()`. | The headset checklist below. |
| Escape hatch | "Open on the flat screen" ends the session. Distance, size, hand, and the passive HUD mode. Hold-to-close walks `closeTopOverlay`. | A modal the rasterizer cannot show still has a way out. |
| Quad layer (optional) | `XRWebGLBinding` plus a projection layer. Watch the half-size quad bug. | Sharper text, and a fallback when `layers` is missing. |

### Headset checklist for the game plug

For each family in the inventory, on both skins, opened from the controller and from a click on the panel:

1. The panel is up within a frame for canvas UI, and within a short beat for DOM.
2. Trigger hits the button under the ray. Dragging an inventory item drags. Settings scrolls. A slider moves.
3. B goes back one level and then closes.
4. A message box over the inventory leaves the inventory visible underneath, and the inventory returns when the box closes.
5. The death screen keeps the top (`holdsTop`).
6. Typing a name at character creation works, or the escape hatch does.
7. Save and load work.
8. The boot menu, before any host exists, is on the panel.
9. A door that landed upstream after this detector, with an id that is not `enhanced-*`, works with no VR edit. Wyrd is the one already in the tree.
10. Closing does not crouch or jump.
11. The frame rate while the menu is open stays at the headset's rate. **[S]** 72 Hz on a Quest 2 and 90 Hz on a Quest 3 are the targets. Nobody has measured them here.

### The flat game

`src/main.js` and `src/scenes/` do not import `src/vr`. `play/index.html` loads `src/main.js` only. `uiPresence.js` imports only `engineBridge.js`, and the bridge does not statically import `src/ui`. The contract test pins both. `/play/` and https://daggerfalljs.dev/play/ still have no Enter VR button. That is the current online flow, on purpose.

## Risks

1. **The game's frame clock under XR is one picture, not a panel.** **[V]** The world host still schedules itself with `requestAnimationFrame`. **[S]** While `?vr` has a session, `src/vr/xrFrameLoop.js` moves that callback onto `session.requestAnimationFrame` and hands the first eye to `guardedSetXrTarget`. The other eye gets a copy of that picture. Hosts are unchanged. DOM menus are still not a VR panel, and the 2D pass still runs once per frame rather than once per eye. The detector does not depend on it.
2. **`syncCanvasToLayer` versus the 2D layout.** See above. Stretching the canvas to the stereo buffer lays classic UI out across both eyes.
3. **`renderer.js` moves.** The canvas hook has to sit next to `setXrTarget`, with a contract regex, and the panel has to fall back to the escape hatch when `setUiTarget` is gone.
4. **DOM raster fidelity.** Fonts, `backdrop-filter`, CSS animation, and child canvases. E and D are the mitigations.
5. **`isTrusted === false`.** **[V]** A few sites ignore untrusted events: chat (`src/ui/chatPanel.js` checks `isTrusted`), a real Escape in `pointerLock.js:174`, and at least one minigame. File pickers and a native `<select>` need a real gesture. **[S]** The select popup will not appear inside a raster. The escape hatch is the way through those screens.
6. **Quest viewport during the session.** **[S]** `innerWidth` and `innerHeight` during an immersive session still have to be measured on a headset. The old `?vrui` log went away with the demo page.
7. **Buttons already mean something.** `xrInput.toMotorInput` maps A to jump, B to crouch, and the left thumb click to run. X, Y, and the triggers are polled and not mapped. The pointer bridge needs one written map and the stale-edge rule, and it has to share that map with the motor wiring.
8. **Chat and the quick-loot plaque.** Chat matches the DOM rule today, so the detector reports it open. That is fail-open. A passive mode that leaves chat on a smaller panel, or hides it, belongs with the HUD question below.

## Questions for Felipe

1. **Skin in VR.** Keep Enhanced Plus (the default, more DOM, more to rasterize) or suggest Classic (sharper integer-scaled canvas, while Settings and the boot menu stay DOM either way)? The detector supports both and forces neither. The recommendation is to keep both.
2. **DOM raster library.** Vendor `html-to-image` or `html2canvas` (both MIT) under `vendor/`, or a small foreign-object rasterizer of our own? Nothing is vendored in this change.
3. **Laser hand.** Fixed to the right controller, or a setting? Hand tracking (pinch to click) now, or after the trigger path works?
4. **Panel follow.** Fixed in the world when it opens (the recommendation), or a lazy follow that is on by default?
5. **HUD in VR.** Part of this same panel in a passive mode (health, compass, hotbar), or a separate study (wrist, or anchored to a hand)? The detector ignores `.hud` on purpose. Chat currently counts as modal because it has controls. Both of those are this question.
6. **Flat-screen escape.** Is it acceptable to drop out of the immersive session for the screens a rasterizer cannot operate (the ARENA2 folder, mods, native selects)?
7. **The demo slate.** It left with the Privateer's Hold page, and so did the voice route and the dev chat script. The detector stays. Voice is not part of the motor wiring.
