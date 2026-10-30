/**
 * Fixed 60 Hz Simulation Loop with Render Interpolation
 * Decouples physics step from display refresh rate to ensure deterministic simulation.
 */
export class Loop {
  constructor(updateFn, renderFn) {
    this.updateFn = updateFn;
    this.renderFn = renderFn;

    this.fixedStep = 1 / 60; // 60 Hz (16.666 ms)
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.isRunning = false;
    this.rafId = null;

    this.tick = this.tick.bind(this);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  tick(currentTime) {
    if (!this.isRunning) return;

    let frameTime = (currentTime - this.lastTime) / 1000;
    if (frameTime > 0.25) frameTime = 0.25; // Clamp spiral of death
    this.lastTime = currentTime;

    this.accumulator += frameTime;

    while (this.accumulator >= this.fixedStep) {
      this.updateFn(this.fixedStep);
      this.accumulator -= this.fixedStep;
    }

    const alpha = this.accumulator / this.fixedStep;
    this.renderFn(alpha, currentTime);

    this.rafId = requestAnimationFrame(this.tick);
  }
}
