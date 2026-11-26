/**
 * Unified Input System
 * Supports Keyboard (WASD / Arrows + Space for brake/drift & nitro),
 * HTML5 Gamepad API (0.15 analog deadzone, proportional left stick & RT/LT triggers),
 * Mobile Touch controls (buttons + proportional drag), and Tilt accelerometer steering.
 */
export class InputSystem {
  constructor() {
    this.keys = new Set();
    this.touchSteer = 0; // -1 to 1
    this.touchThrottle = false;
    this.touchBrake = false;
    this.touchNitro = false;
    this.touchWheelie = false;

    this.touchState = {
      steerLeft: false,
      steerRight: false,
      throttle: false,
      brake: false,
      nitro: false,
      wheelie: false
    };

    // Tilt controls
    this.tiltEnabled = false;
    this.tiltGamma = 0; // -90 to 90
    this.tiltCalibratedCenter = 0;
    this.tiltSensitivity = 1.0;

    // Gamepad configuration & state
    this.gamepadIndex = null;
    this.deadzone = 0.15;
    this.prevGamepadButtons = new Array(16).fill(false);
    this.onFirstInteraction = null;
    this._interacted = false;

    // Edge-triggered action flags
    this.cameraJustPressed = false;
    this.resetJustPressed = false;
    this.pauseJustPressed = false;
    this.muteJustPressed = false;
    this.f3JustPressed = false;

    // Mobile control mode: 'buttons' | 'tilt' | 'swipe'
    this.mobileMode = 'buttons';

    this.initKeyboard();
    this.initGamepad();
    this.initTouch();
    this.initOrientation();
  }

  notifyInteraction() {
    if (!this._interacted) {
      this._interacted = true;
      if (typeof this.onFirstInteraction === 'function') {
        this.onFirstInteraction();
      }
    }
  }

  clearAllInputs() {
    this.keys.clear();
    this.touchSteer = 0;
    this.touchThrottle = false;
    this.touchBrake = false;
    this.touchNitro = false;
    this.touchWheelie = false;
    this.touchState.steerLeft = false;
    this.touchState.steerRight = false;
    this.touchState.throttle = false;
    this.touchState.brake = false;
    this.touchState.nitro = false;
    this.touchState.wheelie = false;
  }

  initKeyboard() {
    const scrollKeys = new Set([
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Space'
    ]);

    window.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      const isFormInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (!isFormInput && (scrollKeys.has(e.code) || e.code === 'F3')) {
        e.preventDefault();
      }

      this.notifyInteraction();
      this.keys.add(e.code);

      if (e.code === 'KeyC') this.cameraJustPressed = true;
      if (e.code === 'KeyR') this.resetJustPressed = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.pauseJustPressed = true;
      if (e.code === 'KeyM') this.muteJustPressed = true;
      if (e.code === 'F3') this.f3JustPressed = true;
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.clearAllInputs();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.clearAllInputs();
      }
    });
  }

  initGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
      }
    });
  }

  initTouch() {
    window.addEventListener('touchcancel', () => {
      this.clearAllInputs();
    });
  }

  requestOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  }

  initOrientation() {
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (e) => {
        const angle = window.screen?.orientation?.angle ?? window.orientation ?? 0;
        if ((angle === 90 || angle === -90 || angle === 270) && e.beta !== null && e.beta !== undefined) {
          this.tiltGamma = angle === 90 ? e.beta : -e.beta;
        } else if (e.gamma !== null && e.gamma !== undefined) {
          this.tiltGamma = e.gamma;
        }
      }, true);
    }
  }

  calibrateTilt() {
    this.tiltCalibratedCenter = this.tiltGamma;
  }

  triggerHaptic(duration = 40) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(duration);
      } catch (e) {}
    }
  }

  applyDeadzone(rawVal, dz = this.deadzone) {
    const abs = Math.abs(rawVal);
    if (abs <= dz) return 0;
    const norm = (abs - dz) / (1 - dz);
    return Math.sign(rawVal) * Math.min(1, norm);
  }

  getActiveGamepad() {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return null;
    }
    const pads = navigator.getGamepads();
    if (!pads) return null;
    if (this.gamepadIndex !== null && pads[this.gamepadIndex]?.connected) {
      return pads[this.gamepadIndex];
    }
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) {
        this.gamepadIndex = pads[i].index;
        return pads[i];
      }
    }
    return null;
  }

  getControls() {
    return this.poll();
  }

  poll() {
    // 1. Poll HTML5 Gamepad API
    let padSteer = 0;
    let padThrottle = 0;
    let padBrake = 0;
    let padNitro = false;
    let padWheelie = false;
    let padDrift = false;

    const pad = this.getActiveGamepad();
    if (pad) {
      // Left analog stick horizontal axis with 0.15 deadzone and smooth proportional rescaling
      const rawAxis0 = pad.axes?.[0] || 0;
      padSteer = this.applyDeadzone(rawAxis0, this.deadzone);

      // D-pad left/right fallback (buttons 14 & 15)
      if (pad.buttons?.[14]?.pressed) padSteer = -1;
      if (pad.buttons?.[15]?.pressed) padSteer = 1;

      // RT / R2 throttle (button 7) or A / Cross (button 0)
      const rtVal = pad.buttons?.[7]?.value || 0;
      padThrottle = rtVal > 0.08 ? Math.min(1, rtVal) : (pad.buttons?.[0]?.pressed ? 1 : 0);

      // LT / L2 brake (button 6) or B / Circle (button 1)
      const ltVal = pad.buttons?.[6]?.value || 0;
      padBrake = ltVal > 0.08 ? Math.min(1, ltVal) : (pad.buttons?.[1]?.pressed ? 1 : 0);

      // Nitro: X (button 2) or RB / R1 (button 5)
      padNitro = !!(pad.buttons?.[2]?.pressed || pad.buttons?.[5]?.pressed);
      // Wheelie / Drift: Y (button 3) or LB / L1 (button 4)
      padWheelie = !!(pad.buttons?.[4]?.pressed);
      padDrift = !!(pad.buttons?.[1]?.pressed && Math.abs(padSteer) > 0.2);

      // Edge detection for Camera (Y / button 3) and Pause (Start / button 9)
      if (pad.buttons?.[3]?.pressed && !this.prevGamepadButtons[3]) {
        this.cameraJustPressed = true;
      }
      if (pad.buttons?.[9]?.pressed && !this.prevGamepadButtons[9]) {
        this.pauseJustPressed = true;
      }

      let anyPressed = Math.abs(padSteer) > 0.01 || padThrottle > 0.05 || padBrake > 0.05;
      for (let i = 0; i < 16; i++) {
        const pressed = !!pad.buttons?.[i]?.pressed;
        if (pressed) anyPressed = true;
        this.prevGamepadButtons[i] = pressed;
      }
      if (anyPressed) {
        this.notifyInteraction();
      }
    }

    // 2. Keyboard inputs
    let keySteer = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) keySteer -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) keySteer += 1;

    const keyThrottle = (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ? 1 : 0;
    const keyBrakePrimary = (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ? 1 : 0;
    const spaceHeld = this.keys.has('Space');
    const keyNitroDedicated = this.keys.has('KeyN') || this.keys.has('KeyE');
    const keyWheelie = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    // 3. Tilt steer calculation
    let tiltVal = 0;
    if (this.tiltEnabled) {
      const rawDelta = (this.tiltGamma - this.tiltCalibratedCenter);
      tiltVal = Math.max(-1, Math.min(1, (rawDelta / 25) * this.tiltSensitivity));
    }

    // 4. Touch steer buttons + proportional touchSteer
    let touchSteerBtn = 0;
    if (this.touchState.steerLeft) touchSteerBtn -= 1;
    if (this.touchState.steerRight) touchSteerBtn += 1;

    let finalSteer = keySteer + padSteer + this.touchSteer + touchSteerBtn + tiltVal;
    finalSteer = Math.max(-1, Math.min(1, finalSteer));

    // Space key acts as Nitro Boost on straights / gentle curves, and also engages
    // controlled brake-drift when hard-cornering without throttle or when combined with turn-in
    const isTurningHard = Math.abs(finalSteer) > 0.35;
    const spaceDriftBrake = (spaceHeld && isTurningHard && keyThrottle === 0) ? 0.65 : 0;
    const finalDrift = padDrift || (spaceHeld && isTurningHard) || (keyBrakePrimary > 0 && isTurningHard);

    // Combine throttle, brake, nitro, wheelie, and drift
    const finalThrottle = Math.max(keyThrottle, padThrottle, (this.touchThrottle || this.touchState.throttle) ? 1 : 0);
    const finalBrake = Math.max(keyBrakePrimary, spaceDriftBrake, padBrake, (this.touchBrake || this.touchState.brake) ? 1 : 0);
    const finalNitro = keyNitroDedicated || (spaceHeld && !spaceDriftBrake) || padNitro || this.touchNitro || this.touchState.nitro;
    const finalWheelie = keyWheelie || padWheelie || this.touchWheelie || this.touchState.wheelie;

    return {
      steer: finalSteer,
      throttle: finalThrottle,
      brake: finalBrake,
      nitro: finalNitro,
      wheelie: finalWheelie,
      drift: finalDrift,
      camera: this.consumeCamera(),
      reset: this.consumeReset(),
      pause: this.consumePause(),
      mute: this.consumeMute(),
      f3: this.consumeF3()
    };
  }

  isActionJustPressed(action) {
    if (action === 'camera') return this.consumeCamera();
    if (action === 'reset') return this.consumeReset();
    if (action === 'pause') return this.consumePause();
    if (action === 'mute') return this.consumeMute();
    if (action === 'f3') return this.consumeF3();
    return false;
  }

  consumeCamera() {
    const val = this.cameraJustPressed;
    this.cameraJustPressed = false;
    return val;
  }

  consumeReset() {
    const val = this.resetJustPressed;
    this.resetJustPressed = false;
    return val;
  }

  consumePause() {
    const val = this.pauseJustPressed;
    this.pauseJustPressed = false;
    return val;
  }

  consumeMute() {
    const val = this.muteJustPressed;
    this.muteJustPressed = false;
    return val;
  }

  consumeF3() {
    const val = this.f3JustPressed;
    this.f3JustPressed = false;
    return val;
  }
}

export const input = new InputSystem();
export const Input = InputSystem;
