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
import { audio } from '../core/Audio.js';

export class HUD {
  constructor(container, input, callbacks = {}) {
    this.container = container || document.body;
    this.input = input;
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.id = 'hud-root';
    this.container.appendChild(this.root);

    this.popups = [];
    this.slipstreamCooldown = 0;
    this.initDOM();
  }

  initDOM() {
    this.root.innerHTML = `
      <div id="hud-top-left">
        <div id="hud-position"><span id="pos-val">1</span><span id="pos-total">/6</span></div>
        <div id="hud-lap">LAP <span id="lap-val">1</span> / <span id="lap-total">3</span></div>
        <div id="hud-timer">00:00.00</div>
        <div id="hud-gaps" class="hud-gaps">PACK LEADER</div>
        <div id="hud-objectives" class="hud-objectives hidden"></div>
      </div>

      <div id="hud-top-right">
        <div id="hud-controls-bar">
          <button id="hud-mute-btn" class="hud-icon-btn" title="Toggle Audio (M)">🔊</button>
          <button id="hud-mixer-btn" class="hud-icon-btn" title="Music & SFX Volume">🎚</button>
          <button id="hud-pause-btn" class="hud-icon-btn" title="Pause Game (Esc / P)">⏸</button>
          <div id="hud-audio-mixer" class="hud-audio-mixer hidden">
            <label class="hud-vol-row">
              <span>BGM</span>
              <input id="hud-music-slider" type="range" min="0" max="1" step="0.05" value="${audio.musicVolume}" />
            </label>
            <label class="hud-vol-row">
              <span>SFX</span>
              <input id="hud-sfx-slider" type="range" min="0" max="1" step="0.05" value="${audio.sfxVolume}" />
            </label>
          </div>
        </div>
        <canvas id="minimap-canvas" width="160" height="90"></canvas>
      </div>

      <div id="hud-center-popups"></div>
      <div id="hud-race-banner" class="race-banner hidden">FINAL LAP!</div>

      <div id="hud-corner-warning" class="corner-warning hidden">
        <span class="cw-chevrons">‹‹</span>
        <span class="cw-dist">120m</span>
      </div>

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
    this.lapTotal = document.getElementById('lap-total');
    this.timerVal = document.getElementById('hud-timer');
    this.gapsEl = document.getElementById('hud-gaps');
    this.raceBannerEl = document.getElementById('hud-race-banner');
    this.objectivesEl = document.getElementById('hud-objectives');
    this.muteBtn = document.getElementById('hud-mute-btn');
    this.mixerBtn = document.getElementById('hud-mixer-btn');
    this.audioMixerEl = document.getElementById('hud-audio-mixer');
    this.musicSliderEl = document.getElementById('hud-music-slider');
    this.sfxSliderEl = document.getElementById('hud-sfx-slider');
    this.activeNearMissEl = null;
    this.nearMissFadeTimeout = null;
    this.nearMissRemoveTimeout = null;
    this.finalLapBannerTimer = 0;
    this._finalLapShownFor = -1;
    this._cachedSpline = null;
    this._minimapBaseCanvas = null;
    this._minimapProj = null;
    this.pauseBtn = document.getElementById('hud-pause-btn');
    this.nitroFill = document.getElementById('nitro-fill');
    this.speedoVal = document.getElementById('speedo-val');
    this.speedoGear = document.getElementById('speedo-gear');
    this.speedoArc = document.getElementById('speedo-arc');
    this.popupContainer = document.getElementById('hud-center-popups');
    this.cornerWarningEl = document.getElementById('hud-corner-warning');
    this.cornerChevronsEl = this.cornerWarningEl?.querySelector('.cw-chevrons');
    this.cornerDistEl = this.cornerWarningEl?.querySelector('.cw-dist');
    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    if (this.muteBtn) {
      this.muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.playUIClick();
        this.callbacks.onToggleMute?.();
        this.muteBtn.blur();
      });
    }
    if (this.mixerBtn && this.audioMixerEl) {
      this.mixerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.playUIClick();
        this.syncVolumeSliders();
        this.audioMixerEl.classList.toggle('hidden');
        this.mixerBtn.blur();
      });
    }
    if (this.musicSliderEl) {
      this.musicSliderEl.addEventListener('input', (e) => {
        e.stopPropagation();
        audio.setMusicVolume(parseFloat(e.target.value));
      });
    }
    if (this.sfxSliderEl) {
      this.sfxSliderEl.addEventListener('input', (e) => {
        e.stopPropagation();
        audio.setSfxVolume(parseFloat(e.target.value));
      });
    }
    if (this.pauseBtn) {
      this.pauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.playUIClick();
        this.callbacks.onPause?.();
        this.pauseBtn.blur();
      });
    }

    this.bindTouchControls();
  }

  syncVolumeSliders() {
    if (this.musicSliderEl) this.musicSliderEl.value = String(audio.musicVolume);
    if (this.sfxSliderEl) this.sfxSliderEl.value = String(audio.sfxVolume);
  }

  syncMuteState(muted) {
    if (!this.muteBtn) return;
    this.muteBtn.textContent = muted ? '🔇' : '🔊';
    this.muteBtn.classList.toggle('muted', !!muted);
  }

  clearPopups() {
    this.slipstreamCooldown = 0;
    this.finalLapBannerTimer = 0;
    this._finalLapShownFor = -1;
    if (this.nearMissFadeTimeout) clearTimeout(this.nearMissFadeTimeout);
    if (this.nearMissRemoveTimeout) clearTimeout(this.nearMissRemoveTimeout);
    this.activeNearMissEl = null;
    if (this.raceBannerEl) this.raceBannerEl.classList.add('hidden');
    if (this.popupContainer) {
      this.popupContainer.innerHTML = '';
    }
  }

  setObjectives(items = []) {
    if (!this.objectivesEl) return;
    if (!items || items.length === 0) {
      this.objectivesEl.classList.add('hidden');
      this.objectivesEl.innerHTML = '';
      return;
    }
    this.objectivesEl.classList.remove('hidden');
    this.objectivesEl.innerHTML = items.map(it =>
      `<div class="hud-obj-item ${it.done ? 'done' : ''}">${it.done ? '✓' : '○'} ${it.label}</div>`
    ).join('');
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
    if (type === 'near-miss') {
      if (this.nearMissFadeTimeout) clearTimeout(this.nearMissFadeTimeout);
      if (this.nearMissRemoveTimeout) clearTimeout(this.nearMissRemoveTimeout);

      let el = this.activeNearMissEl;
      if (!el || !el.parentNode) {
        el = document.createElement('div');
        el.className = 'hud-popup hud-popup-near-miss';
        el.innerHTML = `
          <div class="popup-title"></div>
          <div class="popup-subtitle"></div>
        `;
        this.popupContainer.appendChild(el);
        this.activeNearMissEl = el;
      }
      el.classList.remove('fade-out');
      el.querySelector('.popup-title').textContent = title;
      const subEl = el.querySelector('.popup-subtitle');
      subEl.textContent = subtitle || '';
      subEl.style.display = subtitle ? 'block' : 'none';

      this.nearMissFadeTimeout = setTimeout(() => {
        el.classList.add('fade-out');
        this.nearMissRemoveTimeout = setTimeout(() => {
          el.remove();
          if (this.activeNearMissEl === el) this.activeNearMissEl = null;
        }, 350);
      }, 1250);
      return;
    }

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

    // 1. Position, Lap & Live Gaps
    const totalLen = playerBike.spline.totalLength;
    const progressOf = (b) => ((b.lap - 1) * totalLen + b.s);
    const allRacers = [playerBike, ...rivalsList];
    allRacers.sort((a, b) => progressOf(b) - progressOf(a));

    const playerIdx = allRacers.indexOf(playerBike);
    const playerPos = playerIdx + 1;
    this.posVal.innerText = playerPos;
    this.posTotal.innerText = `/${allRacers.length}`;
    this.lapVal.innerText = Math.min(totalLaps, playerBike.lap);
    if (this.lapTotal) this.lapTotal.innerText = totalLaps;

    if (this.gapsEl) {
      const refSpeed = Math.max(20, playerBike.speed);
      const pProg = progressOf(playerBike);
      const ahead = playerIdx > 0 ? allRacers[playerIdx - 1] : null;
      const behind = playerIdx < allRacers.length - 1 ? allRacers[playerIdx + 1] : null;
      const parts = [];
      if (ahead) {
        const dtAhead = Math.max(0.1, (progressOf(ahead) - pProg) / refSpeed);
        parts.push(`▲ -${dtAhead.toFixed(1)}s`);
      } else {
        parts.push('★ P1 LEADER');
      }
      if (behind) {
        const dtBehind = Math.max(0.1, (pProg - progressOf(behind)) / refSpeed);
        parts.push(`▼ +${dtBehind.toFixed(1)}s`);
      }
      this.gapsEl.textContent = parts.join('  ·  ');
    }

    // FINAL LAP / WRONG WAY Banners
    if (playerBike.lap === totalLaps && totalLaps >= 2 && this._finalLapShownFor !== totalLaps) {
      this._finalLapShownFor = totalLaps;
      this.finalLapBannerTimer = 2.6;
    }
    if (this.finalLapBannerTimer > 0) {
      this.finalLapBannerTimer = Math.max(0, this.finalLapBannerTimer - dt);
    }
    if (this.raceBannerEl) {
      if (playerBike.isWrongWay) {
        this.raceBannerEl.textContent = 'WRONG WAY!';
        this.raceBannerEl.className = 'race-banner banner-wrong';
      } else if (this.finalLapBannerTimer > 0) {
        this.raceBannerEl.textContent = 'FINAL LAP!';
        this.raceBannerEl.className = 'race-banner banner-final';
      } else {
        this.raceBannerEl.className = 'race-banner hidden';
      }
    }

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

    // 6. Upcoming Corner Chevron Warning (150m before sharp bends)
    this.updateCornerWarning(playerBike);

    // 7. Draw Mini-Map
    this.renderMiniMap(playerBike, rivalsList);
  }

  updateCornerWarning(playerBike) {
    if (!this.cornerWarningEl || !playerBike?.spline?.corners) return;
    const corners = playerBike.spline.corners;
    const totalLen = playerBike.spline.totalLength;
    let activeCorner = null;
    let activeDist = 999;

    for (const c of corners) {
      let distToStart = c.startS - playerBike.s;
      if (distToStart < -totalLen * 0.5) distToStart += totalLen;
      if (distToStart > totalLen * 0.5) distToStart -= totalLen;

      let distToApex = c.apexS - playerBike.s;
      if (distToApex < -totalLen * 0.5) distToApex += totalLen;
      if (distToApex > totalLen * 0.5) distToApex -= totalLen;

      const approaching = distToStart >= 0 && distToStart <= 150;
      const enteringApex = distToStart < 0 && distToApex >= 0;
      if ((approaching || enteringApex) && Math.max(0, distToStart) < activeDist) {
        activeCorner = c;
        activeDist = Math.max(0, distToStart);
      }
    }

    if (!activeCorner) {
      this.cornerWarningEl.classList.add('hidden');
      return;
    }

    const glyph = activeCorner.direction === 'right' ? '›' : '‹';
    this.cornerChevronsEl.textContent = glyph.repeat(activeCorner.severity || 1);
    this.cornerDistEl.textContent = activeDist > 2 ? `${Math.round(activeDist)}m` : 'APEX';
    this.cornerWarningEl.className = `corner-warning severity-${activeCorner.severity || 1}`;
  }

  setTrackSpline(spline) {
    if (!spline || !spline.samples || spline.samples.length === 0) return;
    this._cachedSpline = spline;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;

    const base = document.createElement('canvas');
    base.width = w;
    base.height = h;
    const ctx = base.getContext('2d');

    // Background capsule
    ctx.fillStyle = 'rgba(18, 24, 38, 0.78)';
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Compute XZ bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const sample of spline.samples) {
      const p = sample.position;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const spanX = Math.max(10, maxX - minX);
    const spanZ = Math.max(10, maxZ - minZ);
    const padX = 16;
    const padY = 14;
    const scale = Math.min((w - padX * 2) / spanX, (h - padY * 2) / spanZ);
    const offX = (w - spanX * scale) * 0.5 - minX * scale;
    const offY = (h - spanZ * scale) * 0.5 - minZ * scale;

    this._minimapProj = (x, z) => ({
      x: x * scale + offX,
      y: z * scale + offY
    });

    // Draw outer track shadow + inner spline road ribbon
    ctx.beginPath();
    for (let i = 0; i < spline.samples.length; i += 4) {
      const pt = this._minimapProj(spline.samples[i].position.x, spline.samples[i].position.z);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Start/Finish marker tick
    const startPt = this._minimapProj(spline.samples[0].position.x, spline.samples[0].position.z);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(startPt.x - 2, startPt.y - 2, 4, 4);

    this._minimapBaseCanvas = base;
  }

  renderMiniMap(playerBike, rivalsList) {
    if (!playerBike?.spline) return;
    if (this._cachedSpline !== playerBike.spline || !this._minimapBaseCanvas) {
      this.setTrackSpline(playerBike.spline);
    }

    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;

    ctx.clearRect(0, 0, w, h);
    if (this._minimapBaseCanvas) {
      ctx.drawImage(this._minimapBaseCanvas, 0, 0);
    }

    const proj = this._minimapProj;
    if (!proj) return;

    // Draw Rival dots in their own colors
    for (const r of rivalsList) {
      const rFrame = playerBike.spline.getFrameAtDistance(r.s);
      const pt = proj(rFrame.position.x, rFrame.position.z);
      ctx.fillStyle = r.paintColor || '#06b6d4';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Player dot on top (bright orange with white ring)
    const pFrame = playerBike.spline.getFrameAtDistance(playerBike.s);
    const playerPt = proj(pFrame.position.x, pFrame.position.z);

    ctx.fillStyle = '#ff4d29';
    ctx.beginPath();
    ctx.arc(playerPt.x, playerPt.y, 4.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  show() {
    this.root.style.display = 'block';
  }

  hide() {
    this.root.style.display = 'none';
  }
}
