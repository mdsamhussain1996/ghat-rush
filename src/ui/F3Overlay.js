/**
 * F3 Performance Overlay
 * Displays:
 * - Current FPS & 1% low FPS
 * - Frame time in ms
 * - Draw calls (budget <= 180)
 * - Triangles (budget <= 400k)
 * - Quality preset (Low / Medium / High)
 * - Memory usage
 */
export class F3Overlay {
  constructor(container, renderer) {
    this.container = container || document.body;
    this.renderer = renderer;

    this.visible = false;
    this.fps = 60;
    this.frameTimeMs = 16.6;
    this.history = [];
    this.lastTime = performance.now();
    this.frameCount = 0;

    this.root = document.createElement('div');
    this.root.id = 'f3-overlay';
    this.root.className = 'f3-hidden';
    this.container.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || (e.key === 'F3')) {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle() {
    this.visible = !this.visible;
    if (this.visible) {
      this.root.classList.remove('f3-hidden');
    } else {
      this.root.classList.add('f3-hidden');
    }
  }

  update(now, rendererStats) {
    this.frameCount++;
    const delta = now - this.lastTime;

    if (delta >= 400) {
      this.fps = Math.round((this.frameCount * 1000) / delta);
      this.frameTimeMs = (delta / this.frameCount).toFixed(1);
      this.frameCount = 0;
      this.lastTime = now;

      this.history.push(this.fps);
      if (this.history.length > 30) this.history.shift();

      // Calculate 1% low
      const sorted = [...this.history].sort((a, b) => a - b);
      const lowIndex = Math.max(0, Math.floor(sorted.length * 0.05));
      const onePercentLow = sorted[lowIndex] || this.fps;

      if (this.visible) {
        const stats = rendererStats || this.renderer.getStats();
        const mem = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : 'N/A';

        this.root.innerHTML = `
          <div class="f3-title">⚡ GHAT RUSH · PERF MONITOR (F3)</div>
          <div class="f3-row"><span class="f3-lbl">FPS:</span> <span class="f3-val ${this.fps >= 58 ? 'perf-good' : 'perf-warn'}">${this.fps} FPS</span> (1% Low: ${onePercentLow})</div>
          <div class="f3-row"><span class="f3-lbl">Frame Time:</span> <span class="f3-val">${this.frameTimeMs} ms</span></div>
          <div class="f3-row"><span class="f3-lbl">Draw Calls:</span> <span class="f3-val ${stats.drawCalls <= 180 ? 'perf-good' : 'perf-bad'}">${stats.drawCalls} / 180</span></div>
          <div class="f3-row"><span class="f3-lbl">Triangles:</span> <span class="f3-val">${stats.triangles.toLocaleString()} / 400k</span></div>
          <div class="f3-row"><span class="f3-lbl">Quality Preset:</span> <span class="f3-val">${this.renderer.quality.toUpperCase()}</span></div>
          <div class="f3-row"><span class="f3-lbl">JS Heap:</span> <span class="f3-val">${mem}</span></div>
        `;
      }
    }
  }
}
