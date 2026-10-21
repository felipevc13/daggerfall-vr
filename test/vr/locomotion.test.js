// Unit tests for WebXR Locomotion and Input Mapping in VR.
// Covers Oculus Touch gamepad mapping (axes[2]/[3]), head-gaze alignment,
// deadzone thresholding, snap/smooth rotation, and DFO motor translation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XrInputManager } from '../../src/vr/xrInput.js';

test('XrInputManager polls standard Oculus Touch physical thumbsticks on axes[2] and axes[3]', () => {
  const input = new XrInputManager();

  // Mock WebXR session with 4 axes on Oculus Touch (0,1: thumb rest; 2,3: physical stick)
  const mockSession = {
    inputSources: [
      {
        handedness: 'left',
        gamepad: {
          axes: [0.85, -0.42, 0.0, -1.0], // capacitive rest is touched (0.85), stick is pushed pure forward (-1.0)
          buttons: [{ value: 0 }, { value: 0 }, { pressed: false }, { pressed: false }, { pressed: false }, { pressed: false }],
        },
      },
    ],
  };

  input.poll(mockSession, null, null);
  const left = input.state.left.stick;

  // Physical stick should be forward (-1.0), and X should be 0 (no capacitive drift from axes[0])
  assert.equal(left.x, 0);
  assert.equal(left.y, -1.0);
});

test('XrInputManager falls back to axes[0]/axes[1] if gamepad has only 2 axes', () => {
  const input = new XrInputManager();

  const mockSession = {
    inputSources: [
      {
        handedness: 'left',
        gamepad: {
          axes: [0.5, -0.8], // 2 axes only
          buttons: [],
        },
      },
    ],
  };

  input.poll(mockSession, null, null);
  const left = input.state.left.stick;
  assert.ok(left.x > 0);
  assert.ok(left.y < 0);
});

test('Radial deadzone removes small stick resting drift', () => {
  const input = new XrInputManager();

  const mockSession = {
    inputSources: [
      {
        handedness: 'left',
        gamepad: {
          axes: [0, 0, 0.08, -0.06], // magnitude is 0.1, below 0.15 deadzone
          buttons: [],
        },
      },
    ],
  };

  input.poll(mockSession, null, null);
  const left = input.state.left.stick;
  assert.equal(left.x, 0);
  assert.equal(left.y, 0);
});

test('Forward locomotion moves in the direction of the players head gaze (headYaw)', () => {
  const input = new XrInputManager({ moveSpeed: 4.0 });

  // Pushing pure forward on left stick
  input.state.left.stick = { x: 0, y: -1.0 };

  // Case A: Looking straight ahead (headYaw = 0, rig.yaw = 0)
  const rigA = { pos: [0, 0, 0], yaw: 0 };
  input.updateLocomotion(rigA, 0.1, 0); // dt = 0.1s, distance = 0.4m
  assert.ok(Math.abs(rigA.pos[0]) < 1e-6, 'dx should be 0 when looking forward');
  assert.ok(Math.abs(rigA.pos[2] - 0.4) < 1e-6, 'dz should be +0.4m in DFO coordinate system');

  // Case B: Head physically turned 90 degrees right (headYaw = Math.PI / 2)
  const rigB = { pos: [0, 0, 0], yaw: 0 };
  input.updateLocomotion(rigB, 0.1, Math.PI / 2);
  assert.ok(Math.abs(rigB.pos[0] - 0.4) < 1e-6, 'dx should be +0.4m towards head direction');
  assert.ok(Math.abs(rigB.pos[2]) < 1e-6, 'dz should be ~0 when head is turned 90 deg right');

  // Case C: Head physically turned 180 degrees (headYaw = Math.PI)
  const rigC = { pos: [0, 0, 0], yaw: 0 };
  input.updateLocomotion(rigC, 0.1, Math.PI);
  assert.ok(Math.abs(rigC.pos[0]) < 1e-6, 'dx should be ~0');
  assert.ok(Math.abs(rigC.pos[2] - (-0.4)) < 1e-6, 'dz should be -0.4m (backward relative to rig)');
});

test('Strafe locomotion moves perpendicular to gaze direction', () => {
  const input = new XrInputManager({ moveSpeed: 4.0 });

  // Pushing pure right on left stick (+x)
  input.state.left.stick = { x: 1.0, y: 0 };

  const rig = { pos: [0, 0, 0], yaw: 0 };
  input.updateLocomotion(rig, 0.1, 0); // dt = 0.1s
  assert.ok(Math.abs(rig.pos[0] - 0.4) < 1e-6, 'dx should be +0.4m to the right');
  assert.ok(Math.abs(rig.pos[2]) < 1e-6, 'dz should be 0');
});

test('Snap turning turns by exact snapAngle once per flick and latches', () => {
  const input = new XrInputManager({ snapTurn: true, snapAngleDeg: 45 });
  const rig = { pos: [0, 0, 0], yaw: 0 };

  // Flick right stick to the right
  input.state.right.stick = { x: 0.8, y: 0 };
  input.updateLocomotion(rig, 0.016, 0);

  const expectedAngle = 45 * (Math.PI / 180);
  assert.ok(Math.abs(rig.yaw - expectedAngle) < 1e-6, 'Rig turned 45 degrees right');

  // Holding the stick in the next frame should NOT rotate again (must be latched)
  input.updateLocomotion(rig, 0.016, 0);
  assert.ok(Math.abs(rig.yaw - expectedAngle) < 1e-6, 'Snap turn remained latched without continuous rotation');

  // Release stick to center
  input.state.right.stick = { x: 0, y: 0 };
  input.updateLocomotion(rig, 0.016, 0);

  // Flick again to turn another 45 degrees
  input.state.right.stick = { x: 0.8, y: 0 };
  input.updateLocomotion(rig, 0.016, 0);
  assert.ok(Math.abs(rig.yaw - 2 * expectedAngle) < 1e-6, 'Rig turned another 45 degrees on second flick');
});

test('Smooth turning rotates continuously when snapTurn is disabled', () => {
  const input = new XrInputManager({ snapTurn: false, smoothTurnSpeed: 2.0 });
  const rig = { pos: [0, 0, 0], yaw: 0 };

  input.state.right.stick = { x: 1.0, y: 0 };
  input.updateLocomotion(rig, 0.5, 0); // 0.5s * 2.0 rad/s = 1.0 rad
  assert.ok(Math.abs(rig.yaw - 1.0) < 1e-6, 'Rig smoothly rotated 1.0 radian');
});

test('Thumbstick click activates sprint speed boost', () => {
  const input = new XrInputManager({ moveSpeed: 4.0 });
  input.state.left.stick = { x: 0, y: -1.0 };
  input.state.left.thumbClick = true;

  const rig = { pos: [0, 0, 0], yaw: 0 };
  input.updateLocomotion(rig, 0.1, 0);

  // 4.0 * 1.8 * 0.1 = 0.72m
  assert.ok(Math.abs(rig.pos[2] - 0.72) < 1e-6, 'Sprint speed applied 1.8x multiplier');
});

test('toMotorInput maps XR inputs to standard DFO motor format', () => {
  const input = new XrInputManager();
  input.state.left.stick = { x: 0.5, y: -0.9 };
  input.state.right.aBtn = true;
  input.state.right.bBtn = false;
  input.state.left.thumbClick = true;

  const motor = input.toMotorInput();
  assert.equal(motor.forward, 0.9);
  assert.equal(motor.strafe, 0.5);
  assert.equal(motor.jump, true);
  assert.equal(motor.run, true);
  assert.equal(motor.crouch, false);
});
