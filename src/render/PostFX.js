import * as THREE from 'three';

/**
 * PostFX & Visual Game-Feel Effects (2D Canvas Overlay — 0 WebGL Draw Calls)
 * - 3D-projected asphalt tire skid mark trails during hard cornering / drifting
 * - Tire smoke & off-road shoulder dirt/dust particle puffs behind rear tire
 * - Guardrail scrape metallic spark bursts
 * - High-speed radial speed lines (>140 km/h & Nitro) + Nitro screen vignette
 */
export class PostFX {
  constructor(container) {
    this.container = container || document.body;

    // 2D overlay canvas for high performance (0 extra WebGL draw calls or shader switches)
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

    // Skid mark segments in 3D world space (projected via camera each frame)
    this.skidSegments = [];
    this.lastSkidPoint = null;
    this.maxSkidSegments = 56;

    // Tire smoke / off-road shoulder dust puffs & rail spark particles
    this.particles = [];
    this.sparks = [];
    this.particleSpawnAccumulator = 0;
    this._projVec1 = new THREE.Vector3();
    this._projVec2 = new THREE.Vector3();
  }

  handleResize() {
    this.width = this.canvas.width = window.innerWidth;
    this.height = this.canvas.height = window.innerHeight;
  }

  clear() {
    this.skidSegments.length = 0;
    this.lastSkidPoint = null;
    this.particles.length = 0;
    this.sparks.length = 0;
    this.ctx?.clearRect(0, 0, this.width, this.height);
  }

  emitSparks(sideSign = 1, intensity = 0.7) {
    const count = Math.min(18, Math.round(8 + intensity * 10));
    const cx = this.width * (0.5 + sideSign * 0.14);
    const cy = this.height * 0.72;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI * 0.5 + (Math.random() - 0.5) * 1.8 - sideSign * 0.45;
      const speed = 140 + Math.random() * 280;
      this.sparks.push({
        x: cx + (Math.random() - 0.5) * 24,
        y: cy + (Math.random() - 0.5) * 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.24 + Math.random() * 0.18,
        maxLife: 0.38
      });
    }
  }

  projectWorldToScreen(worldVec, camera, outObj) {
    if (!camera) return false;
    this._projVec1.copy(worldVec).project(camera);
    if (this._projVec1.z < -1 || this._projVec1.z > 1) return false;
    outObj.x = (this._projVec1.x * 0.5 + 0.5) * this.width;
    outObj.y = (-this._projVec1.y * 0.5 + 0.5) * this.height;
    return true;
  }

  update(dt, playerBike, camera = null) {
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (!playerBike) return;

    const speedKmh = playerBike.getSpeedKmh();
    const isNitro = playerBike.isNitro;
    const isSliding = !!(playerBike.isSliding || playerBike.isDrifting);
    const isOffRoad = !!playerBike.isOffRoad;

    // 1. Update & Draw 3D-Projected Asphalt Skid Marks
    if (!playerBike.isCrashed && isSliding && speedKmh > 65 && playerBike.spline) {
      const frame = playerBike.spline.getFrameAtDistance(Math.max(0, playerBike.s - 0.75));
      const contactPos = frame.position.clone()
        .addScaledVector(frame.binormal, playerBike.d)
        .addScaledVector(frame.normal, 0.04);

      if (this.lastSkidPoint && this.lastSkidPoint.distanceToSquared(contactPos) < 25) {
        this.skidSegments.push({
          p0: this.lastSkidPoint.clone(),
          p1: contactPos.clone(),
          age: 0,
          maxAge: 1.6
        });
        if (this.skidSegments.length > this.maxSkidSegments) {
          this.skidSegments.shift();
        }
      }
      this.lastSkidPoint = contactPos;
    } else {
      this.lastSkidPoint = null;
    }

    if (this.skidSegments.length > 0) {
      const pt0 = { x: 0, y: 0 };
      const pt1 = { x: 0, y: 0 };
      this.ctx.lineCap = 'round';
      for (let i = this.skidSegments.length - 1; i >= 0; i--) {
        const seg = this.skidSegments[i];
        seg.age += dt;
        if (seg.age >= seg.maxAge) {
          this.skidSegments.splice(i, 1);
          continue;
        }
        if (camera && this.projectWorldToScreen(seg.p0, camera, pt0) && this.projectWorldToScreen(seg.p1, camera, pt1)) {
          const alpha = (1.0 - seg.age / seg.maxAge) * 0.48;
          this.ctx.strokeStyle = `rgba(12, 16, 24, ${alpha.toFixed(3)})`;
          this.ctx.lineWidth = 5.5;
          this.ctx.beginPath();
          this.ctx.moveTo(pt0.x, pt0.y);
          this.ctx.lineTo(pt1.x, pt1.y);
          this.ctx.stroke();
        }
      }
    }

    // 2. Spawn & Render Tire Smoke (Corner Drift) & Dirt Dust (Off-Road Shoulder)
    if (!playerBike.isCrashed && (isSliding || isOffRoad) && speedKmh > 45) {
      this.particleSpawnAccumulator += dt * (isSliding ? 42 : 28);
      while (this.particleSpawnAccumulator >= 1) {
        this.particleSpawnAccumulator -= 1;
        const leanShift = -playerBike.lean * 40;
        const baseX = this.width * 0.5 + leanShift + (Math.random() - 0.5) * 26;
        const baseY = this.height * 0.80 + (Math.random() - 0.5) * 12;
        const isDirt = isOffRoad && !isSliding;
        this.particles.push({
          x: baseX,
          y: baseY,
          vx: (Math.random() - 0.5) * 90 - playerBike.lean * 65,
          vy: -30 - Math.random() * 55,
          radius: 7 + Math.random() * 10,
          growRate: 36 + Math.random() * 24,
          age: 0,
          maxAge: 0.36 + Math.random() * 0.18,
          color: isDirt ? '168, 128, 84' : '215, 225, 238'
        });
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.radius += p.growRate * dt;
      const lifeRatio = 1.0 - p.age / p.maxAge;
      const alpha = lifeRatio * 0.28;
      this.ctx.fillStyle = `rgba(${p.color}, ${alpha.toFixed(3)})`;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // 3. Render Guardrail Scrape Sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.life -= dt;
      if (sp.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      const prevX = sp.x;
      const prevY = sp.y;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vy += 420 * dt;
      const alpha = Math.min(1, sp.life / sp.maxLife);
      this.ctx.strokeStyle = `rgba(255, 190, 60, ${alpha.toFixed(2)})`;
      this.ctx.lineWidth = 2.4;
      this.ctx.beginPath();
      this.ctx.moveTo(prevX, prevY);
      this.ctx.lineTo(sp.x, sp.y);
      this.ctx.stroke();
    }

    // 4. Radial Speed Lines (> 140 km/h or Nitro)
    if (speedKmh < 140 && !isNitro) return;

    const intensity = isNitro ? 1.0 : Math.min(1.0, (speedKmh - 140) / 140);
    const centerX = this.width * 0.5;
    const centerY = this.height * 0.46;
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
