// VR1 - the world host's dungeon, on the same door as ?dungeon&vr.
//
// createWorldModes wires these three calls. This file does not import
// src/vr. No clock, or a session that is not presenting: the paint runs
// once, and the sticks write nothing. The latch lives here so the host
// does not grow one of its own.

import { paintDungeonEyes } from './dungeonEyeHost.js';
import { applyDungeonQuestInput, createDungeonQuestLatch } from './dungeonQuestInput.js';

const latch = createDungeonQuestLatch();

/** Quest sticks for this frame, before the motor reads keys. `blocked` is a
 *  window: no turn, no stick, no buttons. */
export function applyWorldDungeonQuest(cam, keys, keyEdge, blocked) {
  return applyDungeonQuestInput(cam, keys, keyEdge, latch, !!blocked);
}

/** The stick the motor should prefer, or null so the pad throw shows through. */
export function worldDungeonAnalog() {
  return latch.analog ?? null;
}

/** Per-eye paint when a live session published one. One paint otherwise. */
export function paintWorldDungeonEyes(paint, camera) {
  return paintDungeonEyes(paint, camera);
}
