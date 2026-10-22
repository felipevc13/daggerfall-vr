// The world host's dungeon uses the same eye door and the same sticks as
// ?dungeon&vr. The host does not import src/vr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyWorldDungeonQuest, paintWorldDungeonEyes, worldDungeonAnalog } from '../../src/scenes/dungeonVrHost.js';

const read = (path) => readFileSync(path, 'utf8');

test('the world dungeon paints each eye and reads the Quest stick without importing src/vr', () => {
  const host = read('src/scenes/worldModes.js');
  const door = read('src/scenes/dungeonVrHost.js');
  assert.match(host, /applyWorldDungeonQuest\(cam, keys, latch\.edge,/);
  assert.match(host, /worldDungeonAnalog\(\)/);
  assert.match(host, /paintWorldDungeonEyes\(\(shot\) => paintWorldDungeonEye\(shot\.proj, shot\.view, shot\.index \?\? 0\)/);
  assert.match(host, /if \(\(index \?\? 0\) > 0\) dungeonCtx\.replayDungeonView\?\./);
  assert.match(host, /if \(dungeonCtx\.uiOverlayActive \|\| townTalk\?\.overlayActive \|\| host\.staffTeleportHeld\?\.\(\)\) paintWorldDungeonEye\(proj, view, 0\)/);
  assert.doesNotMatch(host, /from ['"][^'"]*\/vr\//);
  assert.doesNotMatch(door, /from ['"][^'"]*\/vr\//);
  assert.match(read('src/vr/dungeonStereo.js'), /noteVrPath\('dungeon-stereo'\)/);
  assert.match(read('src/vr/xrFrameLoop.js'), /noteVrPath\('mono-copy'\)/);
  assert.match(read('src/vr/titlePanel.js'), /fallback-monitor/);
});

test('a live session paints every eye, and a missing clock paints once', () => {
  const clock = globalThis.__xrFrameClock;
  try {
    const seen = [];
    delete globalThis.__xrFrameClock;
    assert.equal(paintWorldDungeonEyes((shot) => seen.push(shot.index), { proj: 1, view: 2, index: 0 }), false);
    assert.deepEqual(seen, [0]);
    seen.length = 0;
    globalThis.__xrFrameClock = {
      dungeonEyes(draw) {
        draw({ proj: 1, view: 1, index: 0 });
        draw({ proj: 2, view: 2, index: 1 });
        return true;
      },
    };
    assert.equal(paintWorldDungeonEyes((shot) => seen.push(shot.index), { proj: 0, view: 0 }), true);
    assert.deepEqual(seen, [0, 1]);
  } finally {
    if (clock === undefined) delete globalThis.__xrFrameClock;
    else globalThis.__xrFrameClock = clock;
  }
});

test('the world dungeon stick writes the motor analog only while the session is presenting', () => {
  const clock = globalThis.__xrFrameClock;
  try {
    const cam = { yaw: 1 };
    const keys = new Set();
    globalThis.__xrFrameClock = {
      presenting: true,
      questMotor: () => ({ strafe: 0, forward: 1, turn: 0, headYaw: 0 }),
    };
    applyWorldDungeonQuest(cam, keys, { downFrame: new Set() }, false);
    assert.ok(Math.abs(worldDungeonAnalog().y - 1) < 1e-9);
    assert.equal(cam.yaw, 1);
    applyWorldDungeonQuest(cam, keys, { downFrame: new Set() }, true);
    assert.equal(worldDungeonAnalog(), null);
    globalThis.__xrFrameClock = { presenting: false, questMotor: () => ({ forward: 1, turn: 1 }) };
    applyWorldDungeonQuest(cam, keys, { downFrame: new Set() }, false);
    assert.equal(worldDungeonAnalog(), null);
    assert.equal(cam.yaw, 1);
  } finally {
    if (clock === undefined) delete globalThis.__xrFrameClock;
    else globalThis.__xrFrameClock = clock;
  }
});
