/**
 * Unified Input System
 * Supports Keyboard, Gamepad, Touch (Tilt, On-screen buttons, Swipe), and Haptic Feedback.
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

    // Gamepad state
    this.gamepadIndex = null;
    this.prevGamepadButtons = new Array(16).fill(false);

    // Camera toggle trigger
    this.cameraJustPressed = false;
    this.resetJustPressed = false;
    this.pauseJustPressed = false;
    this.f3JustPressed = false;

    // Mobile control mode: 'buttons' | 'tilt' | 'swipe'
    this.mobileMode = 'buttons';

    this.initKeyboard();
    this.initGamepad();
    this.initTouch();
    this.initOrientation();
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.cameraJustPressed = true;
      if (e.code === 'KeyR') this.resetJustPressed = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.pauseJustPressed = true;
      if (e.code === 'F3') {
        e.preventDefault();
        this.f3JustPressed = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
    });
  }

  initGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
      console.log('Gamepad connected:', e.gamepad.id);
      this.gamepadIndex = e.gamepad.index;
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
      }
    });
  }

  initTouch() {
    // Touch event listeners will bind to UI touch zones created in HUD
  }

  initOrientation() {
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (e) => {
        if (e.gamma !== null) {
          // In landscape mode, gamma or beta handles steering depending on orientation
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

  getControls() {
    return this.poll();
  }

  poll() {
    // Poll gamepad
    let padSteer = 0;
    let padThrottle = 0;
    let padBrake = 0;
    let padNitro = false;
    let padWheelie = false;

    if (this.gamepadIndex !== null && navigator.getGamepads) {
      const pad = navigator.getGamepads()[this.gamepadIndex];
      if (pad && pad.connected) {
        // Left stick steering
        if (Math.abs(pad.axes[0]) > 0.12) {
          padSteer = pad.axes[0];
        }
        // RT throttle (button 7) or A (button 0)
        padThrottle = (pad.buttons[7] && pad.buttons[7].value > 0.1) ? pad.buttons[7].value : (pad.buttons[0]?.pressed ? 1 : 0);
        // LT brake (button 6) or B (button 1)
        padBrake = (pad.buttons[6] && pad.buttons[6].value > 0.1) ? pad.buttons[6].value : (pad.buttons[1]?.pressed ? 1 : 0);
        // Nitro: X (button 2) or RB (button 5)
        padNitro = !!(pad.buttons[2]?.pressed || pad.buttons[5]?.pressed);
        // Wheelie: Y (button 3) or LB (button 4)
        padWheelie = !!(pad.buttons[3]?.pressed || pad.buttons[4]?.pressed);

        // Edge detection for Camera button (button 9 or 3)
        if (pad.buttons[3]?.pressed && !this.prevGamepadButtons[3]) {
          this.cameraJustPressed = true;
        }
        for (let i = 0; i < 16; i++) {
          this.prevGamepadButtons[i] = !!pad.buttons[i]?.pressed;
        }
      }
    }

    // Keyboard inputs
    let keySteer = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) keySteer -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) keySteer += 1;

    const keyThrottle = (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ? 1 : 0;
    const keyBrake = (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ? 1 : 0;
    const keyNitro = this.keys.has('Space');
    const keyWheelie = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    // Tilt steer calculation
    let tiltVal = 0;
    if (this.tiltEnabled) {
      const rawDelta = (this.tiltGamma - this.tiltCalibratedCenter);
      tiltVal = Math.max(-1, Math.min(1, (rawDelta / 25) * this.tiltSensitivity));
    }

    // Combine steer
    let touchSteerBtn = 0;
    if (this.touchState.steerLeft) touchSteerBtn -= 1;
    if (this.touchState.steerRight) touchSteerBtn += 1;

    let finalSteer = keySteer + padSteer + this.touchSteer + touchSteerBtn + tiltVal;
    finalSteer = Math.max(-1, Math.min(1, finalSteer));

    // Combine throttle & brake
    const finalThrottle = Math.max(keyThrottle, padThrottle, (this.touchThrottle || this.touchState.throttle) ? 1 : 0);
    const finalBrake = Math.max(keyBrake, padBrake, (this.touchBrake || this.touchState.brake) ? 1 : 0);
    const finalNitro = keyNitro || padNitro || this.touchNitro || this.touchState.nitro;
    const finalWheelie = keyWheelie || padWheelie || this.touchWheelie || this.touchState.wheelie;

    return {
      steer: finalSteer,
      throttle: finalThrottle,
      brake: finalBrake,
      nitro: finalNitro,
      wheelie: finalWheelie,
      camera: this.consumeCamera(),
      reset: this.consumeReset(),
      pause: this.consumePause(),
      f3: this.consumeF3()
    };
  }

  isActionJustPressed(action) {
    if (action === 'camera') return this.consumeCamera();
    if (action === 'reset') return this.consumeReset();
    if (action === 'pause') return this.consumePause();
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

  consumeF3() {
    const val = this.f3JustPressed;
    this.f3JustPressed = false;
    return val;
  }
}

export const input = new InputSystem();
export const Input = InputSystem;
