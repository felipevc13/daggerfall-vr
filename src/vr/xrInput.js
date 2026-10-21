// VR1 / VR2 - THE WEBXR INPUT SYSTEM FOR QUEST STANDALONE
//
// Kept when the Privateer's Hold page (vr-dungeon.html) was removed.
// The empty-room lab still calls poll and updateLocomotion. /play/?vr
// does not: the real hosts read the keyboard in ui/input.js. toMotorInput
// is the bag the next wiring should hand the motor.
//
// Reads Quest 2/3/Pro controllers (thumbsticks, triggers, grips, buttons)
// and handles:
//   1. Smooth Locomotion (Left Thumbstick -> Walk / Strafe)
//   2. Turn (Right Thumbstick -> Snap Turn by default, or Smooth Turn)
//   3. Controller poses (hands/wands position and rotation in world)
//   4. Direct translation into Daggerfall's motor.js input format.

const DEADZONE = 0.15;

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
