/**
 * HUD & In-Race UI
 * Implements the arcade HUD shown in concept_coast.png:
 * - Position (e.g. 1/6)
 * - Lap & Race Timer
 * - Road ribbon Mini-Map with racer blips
 * - Circular speedometer with colored arc, digital km/h & gear
 * - Glowing nitro energy bar
 * - Dynamic combo popups ("NEAR MISS! +150 · COMBO x3", "SLIPSTREAM +8%")
 * - Mobile touch buttons
 */
export class HUD {
  constructor(container, input) {
    this.container = container || document.body;
    this.input = input;

    this.root = document.createElement('div');
    this.root.id = 'hud-root';
    this.container.appendChild(this.root);

    this.popups = [];
    this.initDOM();
  }

  initDOM() {
    this.root.innerHTML = `
      <div id="hud-top-left">
        <div id="hud-position"><span id="pos-val">1</span><span id="pos-total">/6</span></div>
        <div id="hud-lap">LAP <span id="lap-val">1</span> / 3</div>
        <div id="hud-timer">00:00.00</div>
      </div>

      <div id="hud-top-right">
        <canvas id="minimap-canvas" width="160" height="90"></canvas>
      </div>

      <div id="hud-center-popups"></div>

      <div id="hud-bottom-left">
        <div class="nitro-label">NITRO</div>
        <div class="nitro-bar-container">
          <div id="nitro-fill" style="width: 100%;"></div>
        </div>
      </div>

      <div id="hud-bottom-right">
        <svg id="speedo-svg" width="160" height="160" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r="64" fill="none" stroke="#1e293b" stroke-width="10" stroke-dasharray="320" stroke-dashoffset="80" stroke-linecap="round"/>
          <circle id="speedo-arc" cx="80" cy="80" r="64" fill="none" stroke="url(#speedo-grad)" stroke-width="10" stroke-dasharray="320" stroke-dashoffset="320" stroke-linecap="round"/>
          <defs>
            <linearGradient id="speedo-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#00d2ff"/>
              <stop offset="55%" stop-color="#f59e0b"/>
              <stop offset="100%" stop-color="#ef4444"/>
            </linearGradient>
          </defs>
        </svg>
        <div id="speedo-content">
          <div id="speedo-val">0</div>
          <div id="speedo-unit">KM / H</div>
          <div id="speedo-gear">1</div>
        </div>
      </div>

      <!-- Touch Controls Overlay for Mobile -->
      <div id="touch-controls">
        <div id="touch-left-zone">
          <button id="touch-steer-left" class="touch-btn">◀</button>
          <button id="touch-steer-right" class="touch-btn">▶</button>
        </div>
        <div id="touch-right-zone">
          <button id="touch-wheelie" class="touch-btn-action touch-wheelie-btn">WHEELIE</button>
          <button id="touch-nitro" class="touch-btn-action touch-nitro-btn">NITRO</button>
          <button id="touch-brake" class="touch-btn-action touch-brake-btn">BRAKE</button>
          <button id="touch-gas" class="touch-btn-action touch-gas-btn">GAS</button>
        </div>
      </div>
    `;

    this.posVal = document.getElementById('pos-val');
    this.posTotal = document.getElementById('pos-total');
    this.lapVal = document.getElementById('lap-val');
    this.timerVal = document.getElementById('hud-timer');
    this.nitroFill = document.getElementById('nitro-fill');
    this.speedoVal = document.getElementById('speedo-val');
    this.speedoGear = document.getElementById('speedo-gear');
    this.speedoArc = document.getElementById('speedo-arc');
    this.popupContainer = document.getElementById('hud-center-popups');
    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    this.bindTouchControls();
  }

  bindTouchControls() {
    const bindBtn = (id, key) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.input.touchState[key] = true;
      }, { passive: false });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.input.touchState[key] = false;
      }, { passive: false });
      btn.addEventListener('mousedown', () => {
        this.input.touchState[key] = true;
      });
      btn.addEventListener('mouseup', () => {
        this.input.touchState[key] = false;
      });
      btn.addEventListener('mouseleave', () => {
        this.input.touchState[key] = false;
      });
    };

    bindBtn('touch-steer-left', 'steerLeft');
    bindBtn('touch-steer-right', 'steerRight');
    bindBtn('touch-gas', 'throttle');
    bindBtn('touch-brake', 'brake');
    bindBtn('touch-nitro', 'nitro');
    bindBtn('touch-wheelie', 'wheelie');
  }

  showPopup(title, subtitle, type = 'near-miss') {
    const el = document.createElement('div');
    el.className = `hud-popup hud-popup-${type}`;
    el.innerHTML = `
      <div class="popup-title">${title}</div>
      ${subtitle ? `<div class="popup-subtitle">${subtitle}</div>` : ''}
    `;
    this.popupContainer.appendChild(el);

    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 400);
    }, 1200);
  }

  update(dt, playerBike, rivalsList = [], raceTime = 0, totalLaps = 3) {
    if (!playerBike) return;

    // 1. Position & Lap
    const allRacers = [playerBike, ...rivalsList];
    allRacers.sort((a, b) => {
      if (a.lap !== b.lap) return b.lap - a.lap;
      return b.s - a.s;
    });

    const playerPos = allRacers.indexOf(playerBike) + 1;
    this.posVal.innerText = playerPos;
    this.posTotal.innerText = `/${allRacers.length}`;
    this.lapVal.innerText = Math.min(totalLaps, playerBike.lap);

    // 2. Race Timer
    const mins = Math.floor(raceTime / 60);
    const secs = Math.floor(raceTime % 60);
    const ms = Math.floor((raceTime * 100) % 100);
    this.timerVal.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;

    // 3. Speedometer
    const speedKmh = playerBike.getSpeedKmh();
    this.speedoVal.innerText = speedKmh;
    this.speedoGear.innerText = playerBike.gear;

    // Speedometer Arc: dashoffset from 320 (0 km/h) down to 80 (320 km/h)
    const speedRatio = Math.min(1.0, speedKmh / 320);
    const dashOffset = 320 - (speedRatio * 240);
    this.speedoArc.setAttribute('stroke-dashoffset', dashOffset.toFixed(1));

    // 4. Nitro Bar
    const nitroRatio = Math.max(0, Math.min(1.0, playerBike.nitro / playerBike.nitroCapacity));
    this.nitroFill.style.width = `${(nitroRatio * 100).toFixed(1)}%`;
    if (playerBike.isNitro) {
      this.nitroFill.style.boxShadow = '0 0 16px #00d2ff';
    } else {
      this.nitroFill.style.boxShadow = 'none';
    }

    // 5. Slipstream Popup with cooldown
    if (this.slipstreamCooldown > 0) {
      this.slipstreamCooldown -= dt;
    } else if (playerBike.isDrafting) {
      this.showPopup('SLIPSTREAM +8%', 'DRAFTING RIVAL', 'draft');
      this.slipstreamCooldown = 3.2;
    }

    // 6. Draw Mini-Map
    this.renderMiniMap(playerBike, rivalsList);
  }

  renderMiniMap(playerBike, rivalsList) {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background capsule
    ctx.fillStyle = 'rgba(18, 24, 38, 0.7)';
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Road ribbon track shape
    ctx.beginPath();
    ctx.moveTo(18, 65);
    ctx.bezierCurveTo(45, 65, 55, 25, 95, 25);
    ctx.bezierCurveTo(125, 25, 130, 45, 142, 65);
    ctx.strokeStyle = '#55657e';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();

    const totalLen = playerBike.spline.totalLength;

    // Helper to map 0..1 track progress to bezier
    const getPosOnTrack = (ratio) => {
      const x = 18 + ratio * 124;
      const y = 45 - Math.sin(ratio * Math.PI * 2) * 20;
      return { x, y };
    };

    // Draw Rival dots
    for (const r of rivalsList) {
      const rRatio = (r.s % totalLen) / totalLen;
      const pt = getPosOnTrack(rRatio);
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Player dot (Bright orange with white ring)
    const pRatio = (playerBike.s % totalLen) / totalLen;
    const playerPt = getPosOnTrack(pRatio);

    ctx.fillStyle = '#ff4d29';
    ctx.beginPath();
    ctx.arc(playerPt.x, playerPt.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  show() {
    this.root.style.display = 'block';
  }

  hide() {
    this.root.style.display = 'none';
  }
}
