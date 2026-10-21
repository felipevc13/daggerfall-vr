// VR1 / VR2 - THE WEBXR INPUT SYSTEM FOR QUEST STANDALONE
//
// Kept when the Privateer's Hold page (vr-dungeon.html) was removed.
// The empty-room lab still calls poll and updateLocomotion, which moves
// that lab's own rig. The real dungeon does not: the frame clock polls
// once a frame and publishes questSampleOf. The host feeds that to the
// motor. updateLocomotion stays the lab's path.
//
// Reads Quest 2/3/Pro controllers (thumbsticks, triggers, grips, buttons)
// and handles:
//   1. Smooth Locomotion (Left Thumbstick -> Walk / Strafe)
//   2. Turn (Right Thumbstick -> Snap Turn by default, or Smooth Turn)
//   3. Controller poses (hands/wands position and rotation in world)
//   4. Direct translation into Daggerfall's motor.js input format.

const DEADZONE = 0.15;
const TRIGGER = 0.5;

function freshHand(side) {
  const hand = {
    stick: { x: 0, y: 0 },
    trigger: 0,
    grip: 0,
    thumbClick: false,
    pose: null,
    source: null,
  };
  if (side === 'left') {
    hand.xBtn = false;
    hand.yBtn = false;
  } else {
    hand.aBtn = false;
    hand.bBtn = false;
  }
  return hand;
}

/** Tracking-space yaw of a viewer matrix. Pitch does not change it: a look
 *  up or down rotates about the head's right, and this reads that axis.
 *  The dungeon view then turns the head by the body yaw, so this angle is
 *  the head's offset from the body. Null when the axis has no length. */
export function trackingYawOf(matrix) {
  if (!matrix || matrix.length < 3) return null;
  const x = Number(matrix[0]);
  const z = Number(matrix[2]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (x * x + z * z < 1e-8) return null;
  return Math.atan2(z, x);
}

function triggerDown(hand) {
  return (Number(hand?.trigger) || 0) >= TRIGGER;
}

/** One frame of Quest input for the motor. Sticks are already deadzoned.
 *  headYaw stays null when the pose did not give a finite angle. A resting
 *  stick is +0, so a later strict compare does not see a negated zero. */
export function questSampleOf(state, headYaw) {
  const left = state?.left ?? {};
  const right = state?.right ?? {};
  const yaw = Number(headYaw);
  return {
    strafe: Number(left.stick?.x) || 0,
    forward: -(Number(left.stick?.y) || 0) || 0,
    turn: Number(right.stick?.x) || 0,
    jump: !!right.aBtn,
    run: !!left.thumbClick,
    crouch: !!right.bBtn,
    attack: triggerDown(right),
    activate: triggerDown(left) || !!left.xBtn,
    headYaw: headYaw == null || !Number.isFinite(yaw) ? null : yaw,
  };
}

/** Applies a radial deadzone and normalizes the stick vector. */
function applyDeadzone(x, y, deadzone = DEADZONE) {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return { x: 0, y: 0 };
  const scale = (mag - deadzone) / (1 - deadzone) / mag;
  return { x: x * scale, y: y * scale };
}

export class XrInputManager {
  constructor(options = {}) {
    this.snapTurn = options.snapTurn ?? true;
    this.snapAngle = (options.snapAngleDeg ?? 45) * (Math.PI / 180);
    this.smoothTurnSpeed = options.smoothTurnSpeed ?? 2.0; // rad/s
    this.moveSpeed = options.moveSpeed ?? 4.0; // m/s (approx Daggerfall walk)
    this.debug = options.debug ?? false;

    // Snap turn edge detection latch
    this._snapLatched = false;

    // Last polled state
    this.state = {
      left: { stick: { x: 0, y: 0 }, trigger: 0, grip: 0, xBtn: false, yBtn: false, thumbClick: false, pose: null },
      right: { stick: { x: 0, y: 0 }, trigger: 0, grip: 0, aBtn: false, bBtn: false, thumbClick: false, pose: null },
    };
  }

  /**
   * Polls all connected WebXR input sources.
   * @param {XRSession} session
   * @param {XRReferenceSpace} refSpace
   * @param {XRFrame} frame
   */
  poll(session, refSpace, frame) {
    if (!session || !session.inputSources) return this.state;
    // A hand that left the session must not keep its last stick.
    this.state.left = freshHand('left');
    this.state.right = freshHand('right');

    for (const source of session.inputSources) {
      const handedness = source.handedness; // 'left' | 'right'
      if (handedness !== 'left' && handedness !== 'right') continue;

      const hand = this.state[handedness];
      const gp = source.gamepad;

      if (gp) {
        // Quest standard gamepad mapping:
        // In xr-standard (Oculus Touch), axes[2] and axes[3] are physical thumbstick X and Y.
        // axes[0] and axes[1] are reserved for touchpad / capacitive thumb rest.
        let rawX = 0, rawY = 0;
        if (gp.axes.length >= 4) {
          rawX = gp.axes[2] ?? 0;
          rawY = gp.axes[3] ?? 0;
        } else {
          rawX = gp.axes[0] ?? 0;
          rawY = gp.axes[1] ?? 0;
        }

        if (this.debug && handedness === 'left' && (Math.abs(rawX) > 0.1 || Math.abs(rawY) > 0.1)) {
          if (!this._lastStickLog || Date.now() - this._lastStickLog > 500) {
            this._lastStickLog = Date.now();
            console.log(`[STICK LEFT] axes: [${gp.axes.map(v => v.toFixed(2)).join(', ')}] -> x=${rawX.toFixed(2)}, y=${rawY.toFixed(2)}`);
          }
        }

        hand.stick = applyDeadzone(rawX, rawY);

        // Buttons:
        // 0: Trigger, 1: Squeeze/Grip, 3: Thumbstick click, 4: A/X, 5: B/Y
        hand.trigger = gp.buttons[0]?.value ?? 0;
        hand.grip = gp.buttons[1]?.value ?? 0;
        hand.thumbClick = gp.buttons[3]?.pressed ?? false;

        if (handedness === 'left') {
          hand.xBtn = gp.buttons[4]?.pressed ?? false;
          hand.yBtn = gp.buttons[5]?.pressed ?? false;
        } else {
          hand.aBtn = gp.buttons[4]?.pressed ?? false;
          hand.bBtn = gp.buttons[5]?.pressed ?? false;
        }
      }

      hand.source = source;

      // 6DOF controller pose (gripSpace or targetRaySpace)
      if (frame && refSpace && source.gripSpace) {
        hand.pose = frame.getPose(source.gripSpace, refSpace);
      }
    }

    return this.state;
  }

  /**
   * Triggers haptic feedback vibration on the specified controller.
   * @param {'left'|'right'} handedness
   * @param {number} intensity [0..1]
   * @param {number} durationMs duration in milliseconds
   */
  pulseHaptic(handedness, intensity = 0.5, durationMs = 50) {
    const src = this.state[handedness]?.source;
    const actuator = src?.gamepad?.hapticActuators?.[0];
    if (actuator && typeof actuator.pulse === 'function') {
      try {
        actuator.pulse(intensity, durationMs);
      } catch {
        // ignore haptic errors
      }
    }
  }

  /**
   * Updates a rig's position and yaw based on thumbstick inputs.
   * Left stick moves relative to head orientation (or rig yaw).
   * Right stick turns the rig.
   *
   * @param {{ pos: number[], yaw: number }} rig
   * @param {number} dt Delta time in seconds
   * @param {number} [headYaw] Optional head yaw offset from rig
   */
  updateLocomotion(rig, dt, headYaw = 0, collider = null) {
    const left = this.state.left.stick;
    const right = this.state.right.stick;

    // --- 1. ROTATION (Right Stick) ---
    if (this.snapTurn) {
      const snapThreshold = 0.6;
      if (Math.abs(right.x) > snapThreshold) {
        if (!this._snapLatched) {
          const dir = Math.sign(right.x);
          // Quest convention: stick right = turn right (+yaw in Daggerfall)
          rig.yaw += dir * this.snapAngle;
          this._snapLatched = true;
        }
      } else if (Math.abs(right.x) < 0.2) {
        this._snapLatched = false;
      }
    } else {
      // Smooth turn
      rig.yaw += right.x * this.smoothTurnSpeed * dt;
    }

    // Keep yaw in standard range
    rig.yaw = Math.atan2(Math.sin(rig.yaw), Math.cos(rig.yaw));

    // --- 2. MOVEMENT (Left Stick) ---
    // In WebXR, stick Y: -1 is push UP (forward), +1 is pull DOWN (backward)
    // Left stick X: -1 is left (strafe left), +1 is right (strafe right)
    const fwdAmount = -left.y;
    const strafeAmount = left.x;

    if (fwdAmount !== 0 || strafeAmount !== 0) {
      // Move relative to current facing direction
      const moveYaw = rig.yaw + headYaw;
      const sin = Math.sin(moveYaw);
      const cos = Math.cos(moveYaw);

      // In Daggerfall Unity coordinates:
      // Forward = (sin, 0, cos)
      // Strafe Right = (cos, 0, -sin)
      const speed = this.moveSpeed * (this.state.left.thumbClick ? 1.8 : 1.0);
      const dx = (sin * fwdAmount + cos * strafeAmount) * speed * dt;
      const dz = (cos * fwdAmount - sin * strafeAmount) * speed * dt;

      if (collider && typeof collider.move === 'function') {
        // Physical sweep: capsule height 1.8m, radius 0.35m, snaps to floor and stops on walls
        collider.move(rig.pos, dx, 0, dz, 1.8, true);
      } else {
        rig.pos[0] += dx;
        rig.pos[2] += dz;
      }
    }
  }

  /**
   * Translates current XR gamepad inputs into Daggerfall's motor.js input format.
   * Can be passed directly to `player.update(dt, input, yaw, pitch)`.
   */
  toMotorInput() {
    const left = this.state.left;
    const right = this.state.right;

    return {
      forward: -left.stick.y, // +1 forward, -1 backward
      strafe: left.stick.x,   // +1 right, -1 left
      jump: right.aBtn,
      run: left.thumbClick,
      crouch: right.bBtn,
      sneak: false,
    };
  }
}
