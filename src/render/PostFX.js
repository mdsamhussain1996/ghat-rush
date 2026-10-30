import * as THREE from 'three';

/**
 * PostFX & Visual Speed Effects
 * - Radial speed lines overlay (seen in concept art) that intensifies above 160 km/h and during nitro
 * - Nitro exhaust flame particles
 * - Tire smoke particles during heavy slides/skids
 */
export class PostFX {
  constructor(container) {
    this.container = container || document.body;

    // 2D speed lines overlay canvas for high performance (0 WebGL post-processing passes needed)
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'fx-canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '5';
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());

    // Speed lines pool
    this.lines = [];
    for (let i = 0; i < 48; i++) {
      this.lines.push({
        angle: Math.random() * Math.PI * 2,
        dist: 0.25 + Math.random() * 0.75,
        length: 0.15 + Math.random() * 0.35,
        alpha: 0.2 + Math.random() * 0.6,
        speed: 1.5 + Math.random() * 2.5
      });
    }
  }

  handleResize() {
    this.width = this.canvas.width = window.innerWidth;
    this.height = this.canvas.height = window.innerHeight;
  }

  update(dt, playerBike) {
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (!playerBike) return;

    const speedKmh = playerBike.getSpeedKmh();
    const isNitro = playerBike.isNitro;

    // Only draw speed lines when exceeding 150 km/h or during nitro
    if (speedKmh < 140 && !isNitro) return;

    const intensity = isNitro ? 1.0 : Math.min(1.0, (speedKmh - 140) / 140);
    const centerX = this.width * 0.5;
    const centerY = this.height * 0.46; // Center vanishing point aligned with horizon
    const maxRadius = Math.hypot(centerX, centerY);

    this.ctx.lineWidth = isNitro ? 2.8 : 1.8;
    this.ctx.strokeStyle = isNitro ? 'rgba(160, 235, 255, 0.85)' : 'rgba(255, 255, 255, 0.65)';

    this.ctx.beginPath();
    for (const l of this.lines) {
      l.dist += l.speed * intensity * dt;
      if (l.dist > 1.0) {
        l.dist = 0.15 + Math.random() * 0.2;
        l.angle = Math.random() * Math.PI * 2;
      }

      const r1 = l.dist * maxRadius;
      const r2 = (l.dist + l.length * intensity) * maxRadius;

      const cos = Math.cos(l.angle);
      const sin = Math.sin(l.angle);

      const x1 = centerX + cos * r1;
      const y1 = centerY + sin * r1;
      const x2 = centerX + cos * r2;
      const y2 = centerY + sin * r2;

      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
    }
    this.ctx.stroke();

    // Nitro blue screen vignette glow
    if (isNitro) {
      const grad = this.ctx.createRadialGradient(centerX, centerY, maxRadius * 0.5, centerX, centerY, maxRadius);
      grad.addColorStop(0, 'rgba(0, 180, 255, 0)');
      grad.addColorStop(1, 'rgba(0, 140, 255, 0.18)');
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
  }
}
