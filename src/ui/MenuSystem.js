import * as THREE from 'three';
import tracksData from '../data/tracks.json';
import bikesData from '../data/bikes.json';
import careerData from '../data/career.json';
import { save, UPGRADE_KEYS, MAX_UPGRADE_LEVEL } from '../core/Save.js';
import { Bike } from '../vehicles/Bike.js';
import { audio } from '../core/Audio.js';

const PAINT_SWATCHES = [
  { name: 'Saffron Heat', hex: '#ff4d29' },
  { name: 'Cyber Cyan', hex: '#06b6d4' },
  { name: 'Sunset Gold', hex: '#f59e0b' },
  { name: 'Emerald Mint', hex: '#10b981' },
  { name: 'Cobalt Blue', hex: '#2563eb' },
  { name: 'Electric Violet', hex: '#8b5cf6' },
  { name: 'Pearl White', hex: '#f8fafc' },
  { name: 'Stealth Matte', hex: '#1f2937' }
];

const UPGRADE_LABELS = {
  engine: 'ENGINE',
  exhaust: 'EXHAUST',
  tyres: 'TYRES',
  brakes: 'BRAKES',
  nitro: 'NITRO'
};

/**
 * MenuSystem — Title Screen, Main Menu, Career (Leagues & Bosses),
 * Quick Race, 3D Garage Turntable, and Settings.
 */
export class MenuSystem {
  constructor(container, callbacks = {}) {
    this.container = container || document.body;
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.id = 'menu-root';
    this.root.className = 'hidden';
    this.container.appendChild(this.root);

    this.currentScreen = 'title'; // 'title' | 'main' | 'career' | 'quick' | 'garage' | 'settings'
    this.selectedTrackId = tracksData[0]?.id || 'coast_route_1';
    this.selectedBikeId = save.getActiveBikeId();
    this.garageIndex = Math.max(0, bikesData.findIndex(b => b.id === this.selectedBikeId));
    this.pendingBossLaunch = null;

    // 3D Garage Scene + Camera
    this.garageScene = null;
    this.garageCamera = null;
    this.garageBike = null;
    this.garageAngle = 0.55;
    this.initGarage3D();

    window.addEventListener('keydown', (e) => {
      if (this.currentScreen === 'title' && !this.root.classList.contains('hidden')) {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          this.show('main');
        }
      }
    });
  }

  initGarage3D() {
    this.garageScene = new THREE.Scene();
    this.garageScene.background = new THREE.Color(0x0b1120);
    this.garageScene.fog = new THREE.Fog(0x0b1120, 8, 28);

    this.garageCamera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 60);
    this.garageCamera.position.set(2.9, 1.35, 3.2);
    this.garageCamera.lookAt(0, 0.72, 0);

    const hemi = new THREE.HemisphereLight(0xf8fafc, 0x1e293b, 1.15);
    const keyLight = new THREE.DirectionalLight(0xffedd5, 2.0);
    keyLight.position.set(4, 6, 4);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.3);
    rimLight.position.set(-4, 3, -3);
    this.garageScene.add(hemi, keyLight, rimLight);

    // Showroom turntable platform
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(2.15, 2.3, 0.22, 36),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.28, metalness: 0.72 })
    );
    platform.position.y = -0.11;
    const neonRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.16, 0.03, 10, 48),
      new THREE.MeshBasicMaterial({ color: 0xff4d29 })
    );
    neonRing.rotation.x = Math.PI / 2;
    neonRing.position.y = 0.01;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0x090e1a, roughness: 0.4, metalness: 0.5 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.22;
    this.garageScene.add(platform, neonRing, floor);

    window.addEventListener('resize', () => {
      if (this.garageCamera) {
        this.garageCamera.aspect = window.innerWidth / window.innerHeight;
        this.garageCamera.updateProjectionMatrix();
      }
    });
  }

  refreshGarageBike() {
    if (this.garageBike) {
      this.garageBike.dispose();
      this.garageBike = null;
    }
    const rawBike = bikesData[this.garageIndex] || bikesData[0];
    const effective = save.getEffectiveBikeStats(rawBike);
    this.garageBike = new Bike(this.garageScene, null, effective, false, { color: effective.color });
    this.garageBike.group.position.set(0, 0, 0);
    this.garageBike.group.rotation.y = this.garageAngle;
  }

  updateGarage(dt) {
    if (this.currentScreen !== 'garage' || this.root.classList.contains('hidden')) return;
    this.garageAngle += dt * 0.55;
    if (this.garageBike?.group) {
      this.garageBike.group.rotation.y = this.garageAngle;
    }
  }

  show(screen = 'main') {
    this.currentScreen = screen;
    this.pendingBossLaunch = null;
    this.root.classList.remove('hidden');
    if (screen === 'garage') {
      const idx = bikesData.findIndex(b => b.id === save.getActiveBikeId());
      if (idx >= 0) this.garageIndex = idx;
      this.refreshGarageBike();
    }
    this.render();
    this.callbacks.onScreenChange?.(screen);
  }

  hide() {
    this.root.classList.add('hidden');
    if (this.garageBike) {
      this.garageBike.dispose();
      this.garageBike = null;
    }
  }

  renderHeader(title) {
    const cash = save.getCash().toLocaleString('en-IN');
    const stars = save.getStars();
    return `
      <div class="menu-topbar">
        <button id="menu-back-btn" class="menu-back-btn">◀ BACK</button>
        <div class="menu-header-title">${title}</div>
        <div class="menu-currencies">
          <span id="menu-cash-val" class="currency-pill currency-cash">₹ ${cash}</span>
          <span id="menu-stars-val" class="currency-pill currency-stars">★ ${stars}</span>
        </div>
      </div>
    `;
  }

  render() {
    if (this.currentScreen === 'title') {
      this.root.innerHTML = `
        <div class="menu-screen menu-title-screen">
          <div class="title-badge">SAHYADRI HIGH-SPEED RACING</div>
          <h1 class="game-logo-big">GHAT <span>RUSH</span></h1>
          <p class="title-tagline">Coastlines · Monsoon Cliffs · Midnight Flyovers</p>
          <button id="title-start-btn" class="btn btn-primary title-cta">TAP TO RIDE</button>
          <div class="title-hint">Press ENTER or click anywhere to continue</div>
        </div>
      `;
      this.root.querySelector('#title-start-btn').onclick = () => this.show('main');
      return;
    }

    if (this.currentScreen === 'main') {
      const cash = save.getCash().toLocaleString('en-IN');
      const stars = save.getStars();
      const activeBike = bikesData.find(b => b.id === save.getActiveBikeId()) || bikesData[0];
      this.root.innerHTML = `
        <div class="menu-screen menu-main-screen">
          <div class="menu-topbar main-topbar">
            <div class="main-logo-small">GHAT <span>RUSH</span></div>
            <div class="menu-currencies">
              <span id="menu-cash-val" class="currency-pill currency-cash">₹ ${cash}</span>
              <span id="menu-stars-val" class="currency-pill currency-stars">★ ${stars}</span>
            </div>
          </div>
          <div class="main-content-wrap">
            <div class="main-nav-col">
              <button id="menu-btn-career" class="main-card-btn primary-card">
                <div class="mc-title">CAREER CHAMPS</div>
                <div class="mc-sub">Conquer 3 Indian leagues, earn stars & beat street bosses</div>
              </button>
              <button id="menu-btn-quick" class="main-card-btn">
                <div class="mc-title">QUICK RACE</div>
                <div class="mc-sub">Pick any track & unlocked bike for instant action</div>
              </button>
              <button id="menu-btn-garage" class="main-card-btn">
                <div class="mc-title">GARAGE</div>
                <div class="mc-sub">Buy superbikes, tune 5 upgrades & customize paint · Active: ${activeBike.name}</div>
              </button>
              <button id="menu-btn-settings" class="main-card-btn">
                <div class="mc-title">SETTINGS</div>
                <div class="mc-sub">Audio, graphics quality, camera & mobile tilt calibration</div>
              </button>
            </div>
          </div>
        </div>
      `;
      this.root.querySelector('#menu-btn-career').onclick = () => this.show('career');
      this.root.querySelector('#menu-btn-quick').onclick = () => this.show('quick');
      this.root.querySelector('#menu-btn-garage').onclick = () => this.show('garage');
      this.root.querySelector('#menu-btn-settings').onclick = () => this.show('settings');
      return;
    }

    if (this.currentScreen === 'career') {
      const stars = save.getStars();
      const leagues = Array.isArray(careerData) ? careerData : (careerData.leagues || []);
      const leaguesHtml = leagues.map(league => {
        const reqStars = league.requiredStars ?? league.unlockStars ?? 0;
        const unlocked = stars >= reqStars;
        const racesHtml = (league.races || []).map((rawRace, ri) => {
          const raceId = rawRace.id || `${league.id}_r${ri}`;
          const bossRival = rawRace.bossRival || (ri === league.races.length - 1 ? league.bossRival : null);
          const raceName = rawRace.name || `${league.name}${league.races.length > 1 ? ` · Race ${ri + 1}` : ''}`;
          const track = tracksData.find(t => t.id === rawRace.trackId) || tracksData[0];
          const achieved = save.getCareerRaceObjectives(raceId);
          const earnedCount = achieved.filter(Boolean).length;
          const bossBadge = bossRival ? `<span class="boss-pill">BOSS: ${bossRival.name}</span>` : '';
          const objectivesList = (rawRace.starsTarget || []).map((obj, idx) =>
            `<span class="obj-chip ${achieved[idx] ? 'obj-done' : ''}">${achieved[idx] ? '✓' : '☆'} ${obj}</span>`
          ).join('');
          return `
            <div class="career-race-card ${unlocked ? '' : 'locked-card'}">
              <div class="cr-head">
                <div>
                  <div class="cr-name">${raceName} ${bossBadge}</div>
                  <div class="cr-meta">${track.name} · ${rawRace.laps || 3} Laps · Prize ₹ ${(rawRace.rewardCash || 5000).toLocaleString('en-IN')}</div>
                </div>
                <div class="cr-stars">${'★'.repeat(earnedCount)}${'☆'.repeat(3 - earnedCount)}</div>
              </div>
              <div class="cr-objectives">${objectivesList}</div>
              <button class="btn ${unlocked ? 'btn-primary' : 'btn-secondary'} career-race-btn" data-race-id="${raceId}" ${unlocked ? '' : 'disabled'}>
                ${unlocked ? (bossRival ? 'CHALLENGE BOSS' : 'START EVENT') : `LOCKED (NEED ★ ${reqStars})`}
              </button>
            </div>
          `;
        }).join('');

        return `
          <div class="league-section ${unlocked ? '' : 'league-locked'}">
            <div class="league-header">
              <h2>${league.name}</h2>
              <span class="league-req">${unlocked ? 'UNLOCKED' : `REQUIRES ★ ${reqStars}`}</span>
            </div>
            <div class="league-races-grid">${racesHtml}</div>
          </div>
        `;
      }).join('');

      this.root.innerHTML = `
        <div class="menu-screen menu-career-screen">
          ${this.renderHeader('CAREER MODE')}
          <div class="menu-scroll-body">${leaguesHtml}</div>
          <div id="boss-intro-modal" class="boss-modal ${this.pendingBossLaunch ? '' : 'hidden'}">
            ${this.pendingBossLaunch ? this.renderBossModalInner(this.pendingBossLaunch) : ''}
          </div>
        </div>
      `;

      this.root.querySelector('#menu-back-btn').onclick = () => this.show('main');
      this.root.querySelectorAll('.career-race-btn').forEach(btn => {
        btn.onclick = () => {
          const rId = btn.dataset.raceId;
          const found = this.findCareerRace(rId);
          if (!found) return;
          if (found.race.bossRival) {
            this.pendingBossLaunch = found;
            this.render();
          } else {
            this.launchCareerRace(found);
          }
        };
      });

      if (this.pendingBossLaunch) {
        this.root.querySelector('#boss-cancel-btn').onclick = () => {
          this.pendingBossLaunch = null;
          this.render();
        };
        this.root.querySelector('#boss-race-btn').onclick = () => {
          const target = this.pendingBossLaunch;
          this.pendingBossLaunch = null;
          this.launchCareerRace(target);
        };
      }
      return;
    }

    if (this.currentScreen === 'quick') {
      const unlockedIds = bikesData.filter(b => save.isBikeUnlocked(b.id)).map(b => b.id);
      if (!unlockedIds.includes(this.selectedBikeId)) {
        this.selectedBikeId = unlockedIds[0] || 'vayu_150';
      }

      const tracksHtml = tracksData.map(t => `
        <div class="pick-card ${this.selectedTrackId === t.id ? 'selected' : ''}" data-track-id="${t.id}">
          <div class="pick-env">${(t.environment || 'coastal').toUpperCase()}</div>
          <div class="pick-name">${t.name}</div>
          <div class="pick-meta">${t.lanes} Lanes · ${(t.lapLengthMeters / 1000).toFixed(1)} km · ${t.laps} Laps</div>
          <div class="pick-desc">${t.description}</div>
        </div>
      `).join('');

      const bikesHtml = bikesData.map(b => {
        const unlocked = save.isBikeUnlocked(b.id);
        const eff = save.getEffectiveBikeStats(b);
        return `
          <div class="pick-card ${this.selectedBikeId === b.id ? 'selected' : ''} ${unlocked ? '' : 'locked-card'}" data-bike-id="${b.id}" data-unlocked="${unlocked}">
            <div class="pick-env">TIER ${b.tier} · ${b.class}</div>
            <div class="pick-name">${b.name}</div>
            <div class="pick-meta">${unlocked ? `Top ${eff.topSpeedKmh} km/h · 0-100 ${eff.accelMs}s` : `LOCKED · ₹ ${b.price.toLocaleString('en-IN')}`}</div>
          </div>
        `;
      }).join('');

      this.root.innerHTML = `
        <div class="menu-screen menu-quick-screen">
          ${this.renderHeader('QUICK RACE')}
          <div class="menu-scroll-body">
            <h3 class="pick-section-title">1. SELECT TRACK</h3>
            <div class="pick-grid">${tracksHtml}</div>
            <h3 class="pick-section-title">2. SELECT UNLOCKED BIKE</h3>
            <div class="pick-grid">${bikesHtml}</div>
          </div>
          <div class="menu-footer-bar">
            <button id="quick-start-btn" class="btn btn-primary">START QUICK RACE</button>
          </div>
        </div>
      `;

      this.root.querySelector('#menu-back-btn').onclick = () => this.show('main');
      this.root.querySelectorAll('[data-track-id]').forEach(el => {
        el.onclick = () => {
          this.selectedTrackId = el.dataset.trackId;
          this.render();
        };
      });
      this.root.querySelectorAll('[data-bike-id]').forEach(el => {
        el.onclick = () => {
          if (el.dataset.unlocked !== 'true') return;
          this.selectedBikeId = el.dataset.bikeId;
          save.setActiveBikeId(this.selectedBikeId);
          this.render();
        };
      });
      this.root.querySelector('#quick-start-btn').onclick = () => {
        this.hide();
        this.callbacks.onStartRace?.({
          mode: 'quick',
          trackId: this.selectedTrackId,
          bikeId: this.selectedBikeId
        });
      };
      return;
    }

    if (this.currentScreen === 'garage') {
      const rawBike = bikesData[this.garageIndex] || bikesData[0];
      const unlocked = save.isBikeUnlocked(rawBike.id);
      const isEquipped = save.getActiveBikeId() === rawBike.id;
      const eff = save.getEffectiveBikeStats(rawBike);
      const upgrades = save.getBikeUpgrades(rawBike.id);
      const paint = save.getBikePaint(rawBike.id, rawBike.color);

      const speedPct = Math.min(100, (eff.topSpeedKmh / 370) * 100).toFixed(0);
      const accelPct = Math.min(100, Math.max(20, (5.0 - eff.accelMs) * 28)).toFixed(0);
      const handPct = Math.min(100, ((eff.handling - 0.7) / 0.45) * 100).toFixed(0);
      const nitroPct = Math.min(100, (eff.nitroCapacity / 7.5) * 100).toFixed(0);

      const upgradesHtml = UPGRADE_KEYS.map(key => {
        const lvl = upgrades[key] || 0;
        const isMax = lvl >= MAX_UPGRADE_LEVEL;
        const cost = save.getUpgradeCost(lvl);
        const canBuy = unlocked && !isMax && save.getCash() >= cost;
        return `
          <div class="upgrade-row">
            <div class="upg-info">
              <span class="upg-name">${UPGRADE_LABELS[key]}</span>
              <span class="upg-pips">${'■'.repeat(lvl)}${'□'.repeat(MAX_UPGRADE_LEVEL - lvl)}</span>
            </div>
            <button id="garage-upg-${key}" class="btn btn-secondary upg-btn" data-upg="${key}" ${canBuy ? '' : 'disabled'}>
              ${isMax ? 'MAXED' : (unlocked ? `₹ ${cost.toLocaleString('en-IN')}` : 'LOCKED')}
            </button>
          </div>
        `;
      }).join('');

      const swatchesHtml = PAINT_SWATCHES.map(sw => `
        <button class="paint-swatch ${paint.color === sw.hex ? 'active' : ''}" data-color="${sw.hex}" title="${sw.name}" style="background:${sw.hex};"></button>
      `).join('');

      this.root.innerHTML = `
        <div class="menu-screen menu-garage-screen">
          ${this.renderHeader('BIKE GARAGE')}
          <div class="garage-layout">
            <div class="garage-stage-col">
              <div class="garage-bike-title-row">
                <button id="garage-prev-btn" class="garage-nav-btn">◀</button>
                <div>
                  <div class="garage-tier">TIER ${rawBike.tier} · ${rawBike.class}</div>
                  <h2 id="garage-bike-name" class="garage-bike-name">${rawBike.name}</h2>
                </div>
                <button id="garage-next-btn" class="garage-nav-btn">▶</button>
              </div>
              <div class="garage-action-bar">
                ${unlocked
                  ? `<button id="garage-select-btn" class="btn ${isEquipped ? 'btn-secondary' : 'btn-primary'}" ${isEquipped ? 'disabled' : ''}>${isEquipped ? 'EQUIPPED RIDE' : 'EQUIP BIKE'}</button>`
                  : `<button id="garage-buy-btn" class="btn btn-primary" ${save.getCash() >= rawBike.price ? '' : 'disabled'}>BUY BIKE · ₹ ${rawBike.price.toLocaleString('en-IN')}</button>`
                }
              </div>
            </div>

            <div class="garage-panel-col">
              <div class="garage-stats-card">
                <div class="g-stat"><span>TOP SPEED</span><strong>${eff.topSpeedKmh} km/h</strong><div class="g-bar"><div style="width:${speedPct}%"></div></div></div>
                <div class="g-stat"><span>0-100 KM/H</span><strong>${eff.accelMs}s</strong><div class="g-bar"><div style="width:${accelPct}%"></div></div></div>
                <div class="g-stat"><span>HANDLING / GRIP</span><strong>${Math.round(eff.handling * 100)}</strong><div class="g-bar"><div style="width:${handPct}%"></div></div></div>
                <div class="g-stat"><span>NITRO CAPACITY</span><strong>${eff.nitroCapacity}s</strong><div class="g-bar"><div style="width:${nitroPct}%"></div></div></div>
              </div>

              <div class="garage-upgrades-card">
                <h4>PERFORMANCE UPGRADES</h4>
                ${upgradesHtml}
              </div>

              <div class="garage-paint-card">
                <h4>CUSTOM PAINT</h4>
                <div class="paint-swatch-row">${swatchesHtml}</div>
              </div>
            </div>
          </div>
        </div>
      `;

      this.root.querySelector('#menu-back-btn').onclick = () => this.show('main');
      this.root.querySelector('#garage-prev-btn').onclick = () => {
        this.garageIndex = (this.garageIndex - 1 + bikesData.length) % bikesData.length;
        this.refreshGarageBike();
        this.render();
      };
      this.root.querySelector('#garage-next-btn').onclick = () => {
        this.garageIndex = (this.garageIndex + 1) % bikesData.length;
        this.refreshGarageBike();
        this.render();
      };

      const buyBtn = this.root.querySelector('#garage-buy-btn');
      if (buyBtn) {
        buyBtn.onclick = () => {
          if (save.buyBike(rawBike)) {
            this.render();
          }
        };
      }
      const selBtn = this.root.querySelector('#garage-select-btn');
      if (selBtn) {
        selBtn.onclick = () => {
          save.setActiveBikeId(rawBike.id);
          this.render();
        };
      }

      this.root.querySelectorAll('[data-upg]').forEach(btn => {
        btn.onclick = () => {
          const res = save.upgradeBike(rawBike.id, btn.dataset.upg);
          if (res.ok) this.render();
        };
      });

      this.root.querySelectorAll('.paint-swatch').forEach(btn => {
        btn.onclick = () => {
          const hex = btn.dataset.color;
          save.setBikePaint(rawBike.id, hex);
          this.garageBike?.setPaintColor(hex);
          this.render();
        };
      });
      return;
    }

    if (this.currentScreen === 'settings') {
      const settings = save.getSettings();
      const qualities = ['auto', 'low', 'medium', 'high'];
      const cameras = ['chase', 'close', 'helmet'];
      this.root.innerHTML = `
        <div class="menu-screen menu-settings-screen">
          ${this.renderHeader('SETTINGS')}
          <div class="settings-card">
            <div class="setting-row">
              <div><strong>AUDIO MUTE</strong><div class="setting-sub">Mute engine, music & traffic SFX</div></div>
              <button id="settings-mute-toggle" class="btn btn-secondary">${audio.muted ? 'MUTED' : 'SOUND ON'}</button>
            </div>
            <div class="setting-row">
              <div><strong>MUSIC &amp; SFX VOLUME</strong><div class="setting-sub">Adjust synthwave BGM and procedural bike SFX levels</div></div>
              <div class="seg-group" style="gap:14px;align-items:center;">
                <label style="font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px;">BGM <input id="settings-music-vol" type="range" min="0" max="1" step="0.05" value="${audio.musicVolume}" style="width:80px;"/></label>
                <label style="font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px;">SFX <input id="settings-sfx-vol" type="range" min="0" max="1" step="0.05" value="${audio.sfxVolume}" style="width:80px;"/></label>
              </div>
            </div>
            <div class="setting-row">
              <div><strong>GRAPHICS QUALITY</strong><div class="setting-sub">Shadow map, resolution scaling & density</div></div>
              <div class="seg-group">
                ${qualities.map(q => `<button class="seg-btn ${settings.quality === q ? 'active' : ''}" data-quality="${q}">${q.toUpperCase()}</button>`).join('')}
              </div>
            </div>
            <div class="setting-row">
              <div><strong>CAMERA VIEW</strong><div class="setting-sub">Default ride camera preset</div></div>
              <div class="seg-group">
                ${cameras.map(c => `<button class="seg-btn ${settings.cameraView === c ? 'active' : ''}" data-cam="${c}">${c.toUpperCase()}</button>`).join('')}
              </div>
            </div>
            <div class="setting-row">
              <div><strong>TILT STEERING</strong><div class="setting-sub">Use device tilt accelerometer on mobile</div></div>
              <div class="seg-group">
                <button id="settings-tilt-toggle" class="btn btn-secondary">${settings.tiltEnabled ? 'TILT: ON' : 'TILT: OFF'}</button>
                <button id="settings-calibrate-btn" class="btn btn-secondary">CALIBRATE</button>
              </div>
            </div>
            <div class="setting-row">
              <div><strong>RESET SAVE DATA</strong><div class="setting-sub">Restore starter ₹ 8,000 cash & Vayu 150</div></div>
              <button id="settings-reset-btn" class="btn btn-secondary btn-danger-outline">RESET SAVE</button>
            </div>
          </div>
        </div>
      `;

      this.root.querySelector('#menu-back-btn').onclick = () => this.show('main');
      this.root.querySelector('#settings-mute-toggle').onclick = () => {
        audio.toggleMute();
        audio.playUIClick();
        this.callbacks.onMuteSync?.(audio.muted);
        this.render();
      };
      const musicVolInput = this.root.querySelector('#settings-music-vol');
      if (musicVolInput) {
        musicVolInput.oninput = (e) => {
          audio.setMusicVolume(parseFloat(e.target.value));
        };
      }
      const sfxVolInput = this.root.querySelector('#settings-sfx-vol');
      if (sfxVolInput) {
        sfxVolInput.oninput = (e) => {
          audio.setSfxVolume(parseFloat(e.target.value));
        };
      }
      this.root.querySelectorAll('[data-quality]').forEach(btn => {
        btn.onclick = () => {
          const q = btn.dataset.quality;
          save.updateSettings({ quality: q });
          this.callbacks.onQualityChange?.(q);
          this.render();
        };
      });
      this.root.querySelectorAll('[data-cam]').forEach(btn => {
        btn.onclick = () => {
          const c = btn.dataset.cam;
          save.updateSettings({ cameraView: c });
          this.callbacks.onCameraChange?.(c);
          this.render();
        };
      });
      this.root.querySelector('#settings-tilt-toggle').onclick = () => {
        const next = !save.getSettings().tiltEnabled;
        save.updateSettings({ tiltEnabled: next, controlMode: next ? 'tilt' : 'buttons' });
        this.callbacks.onTiltChange?.(next, false);
        this.render();
      };
      this.root.querySelector('#settings-calibrate-btn').onclick = () => {
        this.callbacks.onTiltChange?.(save.getSettings().tiltEnabled, true);
        const btn = this.root.querySelector('#settings-calibrate-btn');
        if (btn) btn.textContent = 'CALIBRATED ✓';
      };
      this.root.querySelector('#settings-reset-btn').onclick = () => {
        save.resetSave();
        this.selectedBikeId = save.getActiveBikeId();
        this.render();
      };
    }
  }

  renderBossModalInner({ league, race }) {
    const boss = race.bossRival;
    const bossBike = bikesData.find(b => b.id === boss.bike);
    return `
      <div class="boss-card">
        <div class="boss-eyebrow">LEAGUE BOSS SHOWDOWN · ${league.name.toUpperCase()}</div>
        <h2 class="boss-name">${boss.name}</h2>
        ${boss.intro ? `<p class="boss-quote">"${boss.intro}"</p>` : ''}
        <div class="boss-sub">Riding: <strong>${bossBike?.name || boss.bike}</strong> · Event: ${race.name}</div>
        <div class="boss-reward">BOSS BOUNTY: <span class="text-gold">+₹ ${(boss.reward || 15000).toLocaleString('en-IN')}</span></div>
        <div class="boss-objectives">
          ${(race.starsTarget || []).map(s => `<div class="boss-obj-item">★ ${s}</div>`).join('')}
        </div>
        <div class="boss-actions">
          <button id="boss-cancel-btn" class="btn btn-secondary">BACK</button>
          <button id="boss-race-btn" class="btn btn-primary">RACE BOSS</button>
        </div>
      </div>
    `;
  }

  getLeagues() {
    return Array.isArray(careerData) ? careerData : (careerData.leagues || []);
  }

  findCareerRace(raceId) {
    const leagues = this.getLeagues();
    for (let li = 0; li < leagues.length; li++) {
      const league = leagues[li];
      const races = league.races || [];
      for (let ri = 0; ri < races.length; ri++) {
        const raw = races[ri];
        const id = raw.id || `${league.id}_r${ri}`;
        if (id === raceId) {
          const bossRival = raw.bossRival || (ri === races.length - 1 ? league.bossRival : null);
          const name = raw.name || `${league.name}${races.length > 1 ? ` · Race ${ri + 1}` : ''}`;
          return {
            league,
            leagueIdx: li,
            raceIdx: ri,
            race: { ...raw, id, name, bossRival }
          };
        }
      }
    }
    return null;
  }

  findNextCareerRace(currentRaceId) {
    const cur = this.findCareerRace(currentRaceId);
    if (!cur) return null;
    const leagues = this.getLeagues();
    const { league, leagueIdx, raceIdx } = cur;
    const races = league.races || [];
    if (raceIdx + 1 < races.length) {
      const raw = races[raceIdx + 1];
      const nextId = raw.id || `${league.id}_r${raceIdx + 1}`;
      return this.findCareerRace(nextId);
    }
    const nextLeague = leagues[leagueIdx + 1];
    const reqStars = nextLeague ? (nextLeague.requiredStars ?? nextLeague.unlockStars ?? 0) : Infinity;
    if (nextLeague && save.getStars() >= reqStars && (nextLeague.races || []).length > 0) {
      const raw = nextLeague.races[0];
      const nextId = raw.id || `${nextLeague.id}_r0`;
      return this.findCareerRace(nextId);
    }
    return null;
  }

  launchCareerRace({ league, race }) {
    this.hide();
    this.callbacks.onStartRace?.({
      mode: 'career',
      trackId: race.trackId,
      bikeId: save.getActiveBikeId(),
      laps: race.laps,
      careerRace: race,
      careerLeague: league
    });
  }
}
