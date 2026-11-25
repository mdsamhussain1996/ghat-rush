import * as THREE from 'three';
import { RoadSpline } from '../track/RoadSpline.js';
import { TrackBuilder } from '../track/TrackBuilder.js';
import { Scenery } from '../track/Scenery.js';
import { Bike } from '../vehicles/Bike.js';
import { Traffic } from '../vehicles/Traffic.js';
import { RivalAI } from '../ai/RivalAI.js';
import { Renderer } from '../render/Renderer.js';
import { CameraRig } from '../render/CameraRig.js';
import { Sky } from '../render/Sky.js';
import { PostFX } from '../render/PostFX.js';
import { Input } from './Input.js';
import { audio } from './Audio.js';
import { Loop } from './Loop.js';
import { save } from './Save.js';
import { ReplayRecorder } from './ReplayRecorder.js';
import { ObjectiveTracker } from './ObjectiveTracker.js';
import { HUD } from '../ui/HUD.js';
import { MenuSystem } from '../ui/MenuSystem.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { ResultsScreen } from '../ui/ResultsScreen.js';
import { F3Overlay } from '../ui/F3Overlay.js';
import tracksData from '../data/tracks.json';
import bikesData from '../data/bikes.json';

/**
 * Main Game Controller — Orchestrates simulation, menus, career, track streaming, entities, audio, and UI.
 */
export class Game {
  constructor(container) {
    this.container = container || document.body;

    // State
    this.state = 'TITLE'; // 'TITLE', 'MENU', 'GARAGE', 'COUNTDOWN', 'RACING', 'PAUSED', 'FINISHED', 'REPLAY'
    this.prePauseState = 'RACING';
    this.countdownTimer = 3.8;
    this.raceTime = 0;
    this.totalTime = 0;
    this.slowMoTimer = 0;
    this.finishTimer = 0;
    this.totalLaps = 3;
    this.nearMissCount = 0;
    this.bestLapTime = Infinity;
    this.currentLapStartTime = 0;
    this.lastLap = 1;
    this.lastRaceResults = null;
    this.lastEndSnapshot = null;
    this.menuAttractS = 0;

    // References disposed/rebuilt per session
    this.spline = null;
    this.trackBuilder = null;
    this.roadMesh = null;
    this.scenery = null;
    this.sky = null;
    this.playerBike = null;
    this.traffic = null;
    this.rivalAI = null;
    this.objectiveTracker = null;
    this.sessionConfig = { mode: 'quick', trackId: 'coast_route_1', bikeId: save.getActiveBikeId() };

    this.replayRecorder = new ReplayRecorder(4800);
    this.replayReadIdx = 0;
    this.replayTime = 0;

    this.effectiveQuality = 'high';
    this.autoQualityState = { active: false, resolved: false, resolvedPreset: 'high', elapsed: 0, frames: 0, lastFrameMs: 0 };

    this.initScene();
    this.initUI();
    this.initVisibilityPause();

    // Parse query params (?track=<id>&bike=<id>&autostart=1)
    const params = new URLSearchParams(window.location.search);
    const trackParam = params.get('track');
    const bikeParam = params.get('bike');
    const autostart = params.get('autostart') === '1';

    this.loadSession({
      mode: 'quick',
      trackId: trackParam || tracksData[0]?.id || 'coast_route_1',
      bikeId: bikeParam || (autostart ? (params.get('bike') || save.getActiveBikeId()) : save.getActiveBikeId()),
      enterRace: autostart
    });

    if (!autostart) {
      this.enterMenuScreen('title');
    }

    this.initLoop();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.renderer = new Renderer(this.container);
    this.cameraRig = new CameraRig(null);
    this.postFX = new PostFX(this.container);
    this.input = new Input();

    const settings = save.getSettings();
    this.configureQualitySetting(settings.quality || 'auto');
    if (settings.cameraView && this.cameraRig.modes.includes(settings.cameraView)) {
      this.cameraRig.modeIndex = this.cameraRig.modes.indexOf(settings.cameraView);
      this.cameraRig.mode = settings.cameraView;
    }
    this.input.tiltEnabled = !!settings.tiltEnabled;
    this.input.mobileMode = settings.tiltEnabled ? 'tilt' : 'buttons';
  }

  applyQualityPreset(preset) {
    const p = preset === 'med' ? 'medium' : (preset || 'high');
    this.effectiveQuality = p;
    this.renderer?.setQuality(p);
    this.scenery?.applyQuality(p);
  }

  configureQualitySetting(q) {
    if (q === 'auto') {
      this.autoQualityState = { active: true, resolved: false, resolvedPreset: 'high', elapsed: 0, frames: 0, lastFrameMs: 0 };
      this.applyQualityPreset('high');
    } else {
      this.autoQualityState = { active: false, resolved: false, resolvedPreset: q, elapsed: 0, frames: 0, lastFrameMs: 0 };
      this.applyQualityPreset(q);
    }
  }

  recordAutoQualitySample(dtMs) {
    const aq = this.autoQualityState;
    if (!aq || !aq.active || aq.resolved) return;
    aq.elapsed += dtMs / 1000;
    aq.frames += 1;
    if (aq.elapsed >= 3.0 && aq.frames >= 15) {
      const avgMs = (aq.elapsed * 1000) / aq.frames;
      const chosen = avgMs <= 19.5 ? 'high' : (avgMs <= 28.0 ? 'medium' : 'low');
      aq.resolved = true;
      aq.resolvedPreset = chosen;
      this.applyQualityPreset(chosen);
    }
  }

  initUI() {
    this.hud = new HUD(this.container, this.input, {
      onToggleMute: () => this.toggleMute(),
      onPause: () => {
        if (this.state === 'RACING' || this.state === 'COUNTDOWN') this.pauseGame();
        else if (this.state === 'PAUSED') this.resumeGame();
      }
    });
    this.hud.syncMuteState(audio.muted);

    this.menuSystem = new MenuSystem(this.container, {
      onScreenChange: (screen) => {
        if (screen === 'title') this.state = 'TITLE';
        else if (screen === 'garage') this.state = 'GARAGE';
        else this.state = 'MENU';
      },
      onStartRace: (cfg) => {
        this.loadSession({ ...cfg, enterRace: true });
      },
      onMuteSync: (muted) => {
        this.hud.syncMuteState(muted);
      },
      onQualityChange: (q) => this.configureQualitySetting(q),
      onCameraChange: (c) => {
        if (this.cameraRig.modes.includes(c)) {
          this.cameraRig.modeIndex = this.cameraRig.modes.indexOf(c);
          this.cameraRig.mode = c;
        }
      },
      onTiltChange: (enabled, calibrateNow) => {
        this.input.tiltEnabled = !!enabled;
        this.input.mobileMode = enabled ? 'tilt' : 'buttons';
        if (enabled) this.input.requestOrientationPermission();
        if (calibrateNow) this.input.calibrateTilt();
        document.body.classList.toggle('tilt-steering', !!enabled);
      }
    });

    this.pauseMenu = new PauseMenu(this.container, {
      onResume: () => this.resumeGame(),
      onRestart: () => {
        this.pauseMenu.hide();
        this.restartRace();
      },
      onToggleMute: () => this.toggleMute(),
      onCycleCamera: () => {
        const mode = this.cameraRig.cycleMode();
        this.pauseMenu.updateState(audio.muted, mode);
        this.hud.showPopup('CAMERA', mode.toUpperCase(), 'system');
      },
      onQuit: () => this.quitToMenu()
    });

    this.resultsScreen = new ResultsScreen(
      this.container,
      () => this.restartRace(),
      () => this.startReplay(),
      () => this.startNextCareerRace(),
      () => this.quitToMenu()
    );
    this.f3Overlay = new F3Overlay(this.container, this.renderer);

    // Countdown overlay
    this.countdownEl = document.createElement('div');
    this.countdownEl.id = 'countdown-display';
    this.countdownEl.className = 'countdown-text';
    this.countdownEl.style.display = 'none';
    this.container.appendChild(this.countdownEl);

    // Replay banner
    this.replayBanner = document.createElement('div');
    this.replayBanner.id = 'replay-banner';
    this.replayBanner.className = 'hidden';
    this.replayBanner.innerHTML = `
      <span class="replay-rec-dot"></span>
      <span class="replay-label">REPLAY · [C] CAMERA · [ESC] RESULTS</span>
      <button id="replay-exit-btn" class="replay-exit-btn">EXIT REPLAY</button>
    `;
    this.container.appendChild(this.replayBanner);
    this.replayBanner.querySelector('#replay-exit-btn').onclick = () => this.exitReplay();

    // Portrait Rotate Device Overlay
    this.rotateOverlayEl = document.createElement('div');
    this.rotateOverlayEl.id = 'rotate-device-overlay';
    this.rotateOverlayEl.className = 'rotate-overlay hidden';
    this.rotateOverlayEl.innerHTML = `
      <div class="rotate-card">
        <div class="rotate-icon">📱↻</div>
        <div class="rotate-title">ROTATE YOUR DEVICE</div>
        <div class="rotate-sub">GHAT RUSH is built for landscape racing. Turn your device sideways to hit the highway.</div>
      </div>
    `;
    this.container.appendChild(this.rotateOverlayEl);

    this.updateViewportAndTouchState = () => {
      const isTouch = ('ontouchstart' in window)
        || (navigator.maxTouchPoints > 0)
        || !!window.matchMedia?.('(pointer: coarse)')?.matches;
      document.body.classList.toggle('touch-device', isTouch);
      document.body.classList.toggle('tilt-steering', !!this.input?.tiltEnabled);

      const w = window.innerWidth;
      const h = window.innerHeight;
      const isPortrait = h > w && (isTouch || w <= 900);
      this.rotateOverlayEl?.classList.toggle('hidden', !isPortrait);
      if (isPortrait && (this.state === 'RACING' || this.state === 'COUNTDOWN')) {
        this.pauseGame();
      }
    };
    window.addEventListener('resize', this.updateViewportAndTouchState);
    window.addEventListener('orientationchange', this.updateViewportAndTouchState);
    this.updateViewportAndTouchState();

    // Audio unlock listener on first user interaction
    const unlockAudio = () => {
      audio.init();
      audio.playMusic();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
  }

  disposeSession() {
    this.playerBike?.dispose();
    this.playerBike = null;

    this.traffic?.dispose();
    this.traffic = null;

    this.rivalAI?.dispose();
    this.rivalAI = null;

    this.trackBuilder?.dispose(this.scene);
    this.trackBuilder = null;
    this.roadMesh = null;

    this.scenery?.dispose();
    this.scenery = null;

    this.sky?.dispose();
    this.sky = null;
  }

  loadSession(options = {}) {
    this.disposeSession();

    const trackConfig = tracksData.find(t => t.id === options.trackId)
      || tracksData.find(t => t.id === 'coast_route_1')
      || tracksData[0];
    this.trackConfig = trackConfig;
    this.totalLaps = options.laps || trackConfig.laps || 3;

    const rawBike = bikesData.find(b => b.id === (options.bikeId || save.getActiveBikeId())) || bikesData[0];
    this.playerBikeData = save.getEffectiveBikeStats(rawBike);
    this.sessionConfig = {
      mode: options.mode || 'quick',
      trackId: trackConfig.id,
      bikeId: rawBike.id,
      laps: this.totalLaps,
      careerRace: options.careerRace || null,
      careerLeague: options.careerLeague || null
    };

    // Scene sky + track + scenery
    this.sky = new Sky(this.scene, trackConfig.environment || 'coastal');
    this.spline = new RoadSpline(trackConfig.controlPoints, trackConfig);
    this.cameraRig.spline = this.spline;

    this.trackBuilder = new TrackBuilder(this.spline, trackConfig);
    this.roadMesh = this.trackBuilder.buildRoadMesh();
    this.scene.add(this.roadMesh);

    this.scenery = new Scenery(this.scene, this.spline, trackConfig);
    this.scenery.applyQuality(this.effectiveQuality || 'high');
    const surfaceGrip = this.scenery.getSurfaceGrip();

    // Player bike
    this.playerBike = new Bike(this.scene, this.spline, this.playerBikeData, true, { color: this.playerBikeData.color });
    this.playerBike.surfaceGrip = surfaceGrip;
    this.playerBike.s = 0;
    this.playerBike.d = 0;
    this.playerBike.syncTransform();

    this.playerBike.onNearMiss = (combo) => {
      this.nearMissCount++;
      const bonus = 150 * combo;
      this.hud.showPopup('NEAR MISS!', `+${bonus} · COMBO ×${combo}`, 'near-miss');
    };

    this.traffic = new Traffic(this.scene, this.spline, trackConfig);
    this.playerBike.onRespawn = (s, range) => {
      this.traffic?.clearAhead(s, range);
    };

    this.playerBike.onCrash = (type) => {
      this.slowMoTimer = 0.3;
      this.cameraRig.triggerCrashShake(type === 'traffic' ? 0.55 : 0.42);
      this.hud.showPopup(type === 'traffic' ? 'TRAFFIC IMPACT!' : 'RAIL CRASH!', 'SLOW-MO RECOVERY', 'crash');
    };

    // Rivals (with optional Career Boss override)
    const rivalTrackCfg = {
      ...trackConfig,
      bossRival: this.sessionConfig.careerRace?.bossRival || null
    };
    this.rivalAI = new RivalAI(this.scene, this.spline, rivalTrackCfg, bikesData);
    this.rivalAI.rivals.forEach(r => {
      r.bike.surfaceGrip = surfaceGrip;
    });

    // Objectives tracker
    const objLabels = this.sessionConfig.careerRace?.starsTarget || [];
    this.objectiveTracker = new ObjectiveTracker(objLabels, this.totalLaps);

    if (options.enterRace) {
      this.menuSystem.hide();
      this.restartRace();
    } else {
      this.cameraRig.reset(this.playerBike);
      this.scenery.update(0, 0, this.cameraRig.camera);
      this.hud.setTrackSpline(this.spline);
      this.hud.setObjectives([]);
    }
  }

  enterMenuScreen(screen = 'main') {
    this.pauseMenu.hide();
    this.resultsScreen.hide();
    this.replayBanner.classList.add('hidden');
    this.countdownEl.style.display = 'none';
    audio.stopEngine();
    audio.setEnvironmentAmbience('coastal');
    this.hud.hide();
    this.menuSystem.show(screen);
  }

  quitToMenu() {
    this.enterMenuScreen('main');
  }

  startNextCareerRace() {
    const curId = this.sessionConfig.careerRace?.id;
    if (!curId) {
      this.quitToMenu();
      return;
    }
    const next = this.menuSystem.findNextCareerRace(curId);
    if (!next) {
      this.quitToMenu();
      return;
    }
    if (next.race.bossRival) {
      this.enterMenuScreen('career');
      this.menuSystem.pendingBossLaunch = next;
      this.menuSystem.render();
    } else {
      this.menuSystem.launchCareerRace(next);
    }
  }

  initVisibilityPause() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'RACING' || this.state === 'COUNTDOWN')) {
        this.pauseGame();
      }
    });
  }

  initLoop() {
    this.loop = new Loop(
      (dt) => this.update(dt),
      (alpha, time) => this.render(alpha, time)
    );
    this.loop.start();
  }

  toggleMute() {
    const muted = audio.toggleMute();
    this.hud.syncMuteState(muted);
    if (this.pauseMenu) {
      this.pauseMenu.updateState(muted, this.cameraRig.mode);
    }
    this.hud.showPopup('AUDIO', muted ? 'MUTED' : 'UNMUTED', 'system');
    return muted;
  }

  pauseGame() {
    if (this.state !== 'RACING' && this.state !== 'COUNTDOWN') return;
    this.prePauseState = this.state;
    this.state = 'PAUSED';
    audio.setPaused(true);
    this.pauseMenu.show(audio.muted, this.cameraRig.mode);
  }

  resumeGame() {
    if (this.state !== 'PAUSED') return;
    this.state = this.prePauseState || 'RACING';
    this.pauseMenu.hide();
    audio.setPaused(false);
    audio.resume();
  }

  update(dt) {
    const controls = this.input.getControls();

    // Global Mute hotkey (M)
    if (controls.mute) {
      this.toggleMute();
    }

    // Menu / Title / Garage camera updates
    if (this.state === 'TITLE' || this.state === 'MENU' || this.state === 'GARAGE') {
      this.totalTime += dt;
      if (this.state === 'GARAGE') {
        this.menuSystem.updateGarage(dt);
      } else if (this.spline && this.playerBike) {
        this.menuAttractS = (this.menuAttractS + 14 * dt) % this.spline.totalLength;
        const frame = this.spline.getFrameAtDistance(this.menuAttractS);
        const camPos = frame.position.clone()
          .addScaledVector(frame.normal, 4.2)
          .addScaledVector(frame.binormal, Math.sin(this.totalTime * 0.25) * 3.0);
        const lookPt = this.spline.getFrameAtDistance(this.menuAttractS + 32).position.clone()
          .add(new THREE.Vector3(0, 1.5, 0));
        this.cameraRig.camera.position.copy(camPos);
        this.cameraRig.camera.lookAt(lookPt);
        this.scenery?.update(dt, this.totalTime, this.cameraRig.camera);
        this.sky?.update({ group: { position: camPos } }, dt);
      }
      return;
    }

    // Pause / Replay exit hotkey (Esc / P)
    if (controls.pause) {
      if (this.state === 'RACING' || this.state === 'COUNTDOWN') {
        this.pauseGame();
        return;
      } else if (this.state === 'PAUSED') {
        this.resumeGame();
        return;
      } else if (this.state === 'REPLAY') {
        this.exitReplay();
        return;
      }
    }

    if (this.state === 'PAUSED') {
      return;
    }

    this.totalTime += dt;
    if (this.scenery) {
      this.scenery.update(dt, this.totalTime, this.cameraRig.camera);
    }

    // Camera mode toggle hotkey (C)
    if (controls.camera) {
      if (this.state === 'REPLAY') {
        this.cameraRig.replayForceChase = !this.cameraRig.replayForceChase;
      } else {
        const mode = this.cameraRig.cycleMode();
        this.hud.showPopup('CAMERA', mode.toUpperCase(), 'system');
      }
    }

    // Reset hotkey (R) during racing — instant track reset (+1s penalty, no crash animation)
    if (controls.reset && this.state === 'RACING') {
      this.resetPlayerToTrack();
    }

    if (this.state === 'COUNTDOWN') {
      this.countdownTimer -= dt;
      if (this.countdownTimer > 2.8) {
        this.countdownEl.innerText = '3';
      } else if (this.countdownTimer > 1.8) {
        this.countdownEl.innerText = '2';
      } else if (this.countdownTimer > 0.8) {
        this.countdownEl.innerText = '1';
      } else if (this.countdownTimer > 0) {
        this.countdownEl.innerText = 'GO!';
        this.countdownEl.classList.add('countdown-go');
      } else {
        this.countdownEl.style.display = 'none';
        this.state = 'RACING';
        this.currentLapStartTime = 0;
        if (audio.ctx) audio.startEngine();
      }

      const idleControls = { throttle: 0, brake: 0, steer: 0, nitro: false, wheelie: false };
      this.playerBike.update(dt, idleControls, [], []);
      this.cameraRig.update(dt, this.playerBike);
      this.sky.update(this.playerBike, dt);
      const rivalsBikes = this.rivalAI.rivals.map(r => r.bike);
      this.hud.update(dt, this.playerBike, rivalsBikes, 0, this.totalLaps);
      return;
    }

    if (this.state === 'RACING') {
      let simDt = dt;
      if (this.slowMoTimer > 0) {
        this.slowMoTimer = Math.max(0, this.slowMoTimer - dt);
        simDt = dt * 0.4;
      }

      this.raceTime += simDt;

      // Check lap transitions
      if (this.playerBike.lap > this.lastLap) {
        const lapTime = this.raceTime - this.currentLapStartTime;
        if (lapTime > 0 && lapTime < this.bestLapTime) {
          this.bestLapTime = lapTime;
          save.recordBestLap(this.trackConfig.id, lapTime);
        }
        this.currentLapStartTime = this.raceTime;
        this.lastLap = this.playerBike.lap;

        if (this.playerBike.lap > this.totalLaps) {
          this.finishRace();
          return;
        } else {
          this.hud.showPopup(`LAP ${this.playerBike.lap} / ${this.totalLaps}`, 'PUSH IT!', 'lap');
        }
      }

      const playerSpeed = this.playerBike.speed;
      this.traffic.update(simDt, this.playerBike.s, playerSpeed);
      const activeTraffic = this.traffic.getActiveList();

      this.rivalAI.update(simDt, this.playerBike, activeTraffic);

      const rivalsBikes = this.rivalAI.rivals.map(r => r.bike);
      this.playerBike.update(simDt, controls, rivalsBikes, activeTraffic);

      // Update live Career objectives if in Career mode
      if (this.sessionConfig.mode === 'career' && this.objectiveTracker) {
        const lb = this.rivalAI.getLeaderboard(this.playerBike);
        const curPos = lb.findIndex(e => e.isPlayer) + 1;
        const objs = this.objectiveTracker.evaluate({
          position: curPos,
          nearMissCount: this.nearMissCount,
          playerBike: this.playerBike
        }, false);
        this.hud.setObjectives(objs);
      }

      this.replayRecorder.recordFrame(this.playerBike, rivalsBikes, activeTraffic);

      this.cameraRig.update(dt, this.playerBike, activeTraffic);
      this.sky.update(this.playerBike, dt);
      this.postFX.update(simDt, this.playerBike);
      this.hud.update(simDt, this.playerBike, rivalsBikes, this.raceTime, this.totalLaps);
    } else if (this.state === 'FINISHED') {
      this.finishTimer += dt;
      this.playerBike.speed = Math.max(0, this.playerBike.speed - 12.0 * dt);
      this.playerBike.update(dt, { throttle: 0, brake: 0.4, steer: 0, nitro: false, wheelie: false }, [], []);
      this.cameraRig.updateFinishSweep(dt, this.playerBike, this.finishTimer);
      this.sky.update(this.playerBike, dt);
      this.postFX.update(dt, this.playerBike);
    } else if (this.state === 'REPLAY') {
      this.updateReplay(dt);
    }
  }

  updateReplay(dt) {
    if (this.replayRecorder.length === 0) {
      this.exitReplay();
      return;
    }

    this.replayTime += dt;
    this.replayReadIdx = (this.replayReadIdx + 1) % this.replayRecorder.length;
    const frame = this.replayRecorder.getFrame(Math.floor(this.replayReadIdx));
    if (!frame) return;

    const applyBikeSnapshot = (bike, snap) => {
      bike.s = snap.s;
      bike.d = snap.d;
      bike.lean = snap.lean;
      bike.wheelie = snap.wheelie;
      bike.stoppie = snap.stoppie;
      bike.speed = snap.speed;
      bike.isNitro = snap.isNitro;
      if (bike.flameL && bike.flameR) {
        bike.flameL.visible = !!snap.isNitro;
        bike.flameR.visible = !!snap.isNitro;
      }
      const wheelRot = (snap.speed / 0.32) * dt;
      bike.frontWheel.rotation.x += wheelRot;
      bike.rearWheel.rotation.x += wheelRot;
      bike.rider.updateAnimation(snap.lean, Math.round(snap.speed * 3.6), false, snap.wheelie);
      bike.syncTransform();
    };

    applyBikeSnapshot(this.playerBike, frame.p);
    this.rivalAI.rivals.forEach((r, idx) => {
      if (frame.r[idx]) applyBikeSnapshot(r.bike, frame.r[idx]);
    });
    this.traffic.applyReplayFrame(frame.t);

    this.cameraRig.updateReplay(dt, this.playerBike, this.replayTime, this.traffic.getActiveList());
    this.sky.update(this.playerBike, dt);
    this.postFX.update(dt, this.playerBike);
  }

  render(alpha, currentTime) {
    if (this.autoQualityState?.active && !this.autoQualityState.resolved && this.state !== 'PAUSED' && this.state !== 'GARAGE') {
      const nowMs = typeof currentTime === 'number' ? currentTime : performance.now();
      if (this.autoQualityState.lastFrameMs > 0) {
        const dtMs = nowMs - this.autoQualityState.lastFrameMs;
        if (dtMs > 1 && dtMs <= 200 && (!this.loop || this.loop.isRunning)) {
          this.recordAutoQualitySample(dtMs);
        }
      }
      this.autoQualityState.lastFrameMs = nowMs;
    }
    if (this.state === 'GARAGE' && this.menuSystem?.garageScene && this.menuSystem?.garageCamera) {
      this.renderer.render(this.menuSystem.garageScene, this.menuSystem.garageCamera);
    } else {
      this.renderer.render(this.scene, this.cameraRig.camera);
    }
    this.f3Overlay.update(currentTime, this.renderer.getStats());
  }

  finishRace() {
    this.state = 'FINISHED';
    this.finishTimer = 0;
    this.slowMoTimer = 0;
    this.pauseMenu.hide();
    audio.setPaused(false);
    audio.stopEngine();

    const leaderboard = this.rivalAI.getLeaderboard(this.playerBike);
    const playerPos = leaderboard.findIndex(entry => entry.isPlayer) + 1;
    const scoreBreakdown = ObjectiveTracker.computeScoreBreakdown({
      position: playerPos,
      nearMissCount: this.nearMissCount,
      playerBike: this.playerBike
    });

    let cashWon = Math.max(5000, (4 - playerPos) * 12000) + (this.nearMissCount * 350);
    let starsWon = 0;
    let objectives = [];
    let hasNextRace = false;

    if (this.sessionConfig.mode === 'career' && this.sessionConfig.careerRace && this.objectiveTracker) {
      const race = this.sessionConfig.careerRace;
      objectives = this.objectiveTracker.evaluate({
        position: playerPos,
        nearMissCount: this.nearMissCount,
        playerBike: this.playerBike
      }, true);
      const wonBoss = playerPos === 1 && !!race.bossRival;
      if (wonBoss) {
        cashWon += (race.bossRival.reward || 15000);
      }
      const rec = save.recordCareerRace(race.id, this.objectiveTracker.achieved, wonBoss);
      starsWon = rec.earnedCount;
      hasNextRace = !!this.menuSystem.findNextCareerRace(race.id);
    } else {
      starsWon = playerPos === 1 ? 3 : (playerPos <= 3 ? 2 : 1);
    }

    // Save cash rewards ONCE per finished race
    save.addCash(cashWon);

    const rivalsBikes = this.rivalAI.rivals.map(r => r.bike);
    this.lastEndSnapshot = {
      p: { s: this.playerBike.s, d: this.playerBike.d, speed: this.playerBike.speed },
      r: rivalsBikes.map(rb => ({ s: rb.s, d: rb.d, speed: rb.speed }))
    };

    this.lastRaceResults = {
      position: playerPos,
      totalRacers: leaderboard.length,
      raceTime: this.raceTime,
      nearMisses: this.nearMissCount,
      bestLap: this.bestLapTime,
      topSpeedKmh: this.playerBike.topSpeedReachedKmh || 0,
      scoreBreakdown,
      objectives,
      hasNextRace,
      cashWon,
      starsWon
    };

    this.resultsScreen.show(this.lastRaceResults);
  }

  resetPlayerToTrack() {
    if (this.state !== 'RACING' || this.playerBike.isCrashed) return;

    this.raceTime += 1.0;

    const lanes = this.spline.getLaneCenters ? this.spline.getLaneCenters() : [-3.5, 0, 3.5];
    const totalLen = this.spline.totalLength;
    const activeTraffic = this.traffic.getActiveList();
    const sortedLanes = [...lanes].sort((a, b) => Math.abs(a - this.playerBike.d) - Math.abs(b - this.playerBike.d));

    let chosenLane = sortedLanes[0];
    let foundClear = false;
    for (const candidate of sortedLanes) {
      const blocked = activeTraffic.some(v => {
        if (!v.active) return false;
        let sDiff = v.s - this.playerBike.s;
        if (sDiff < -totalLen * 0.5) sDiff += totalLen;
        if (sDiff > totalLen * 0.5) sDiff -= totalLen;
        return sDiff >= -10 && sDiff <= 40 && Math.abs(v.d - candidate) < 1.8;
      });
      if (!blocked) {
        chosenLane = candidate;
        foundClear = true;
        break;
      }
    }
    if (!foundClear) {
      this.traffic.clearAhead(this.playerBike.s, 40);
    }

    this.playerBike.d = chosenLane;
    this.playerBike.speed = Math.min(this.playerBike.speed, 22.0);
    this.playerBike.lean = 0;
    this.playerBike.wheelie = 0;
    this.playerBike.stoppie = 0;
    this.playerBike.steerSmoothed = 0;
    this.playerBike.wobbleTimer = 0;
    this.playerBike.rider.resetPose();
    this.playerBike.enterGhostMode(1.5);
    this.playerBike.syncTransform();

    this.hud.showPopup('RESET TO TRACK', '+1.0s PENALTY', 'system');
  }

  restartRace() {
    this.menuSystem.hide();
    this.resultsScreen.hide();
    this.pauseMenu.hide();
    this.replayBanner.classList.add('hidden');
    this.hud.show();
    this.hud.clearPopups();

    this.state = 'COUNTDOWN';
    this.countdownTimer = 3.8;
    this.countdownEl.style.display = 'block';
    this.countdownEl.classList.remove('countdown-go');
    this.countdownEl.innerText = '3';

    this.raceTime = 0;
    this.totalTime = 0;
    this.slowMoTimer = 0;
    this.finishTimer = 0;
    this.hud.setTrackSpline(this.spline);
    audio.setEnvironmentAmbience(this.trackConfig?.environment || 'coastal');
    this.lastLap = 1;
    this.nearMissCount = 0;
    this.bestLapTime = Infinity;
    this.currentLapStartTime = 0;
    this.lastRaceResults = null;
    this.replayRecorder.clear();

    this.playerBike.reset();
    this.traffic.reset();
    this.rivalAI.reset();
    this.cameraRig.reset(this.playerBike);
    this.scenery?.update(0, 0, this.cameraRig.camera);

    if (this.sessionConfig.mode === 'career' && this.objectiveTracker) {
      const labels = this.sessionConfig.careerRace?.starsTarget || [];
      this.objectiveTracker = new ObjectiveTracker(labels, this.totalLaps);
      this.hud.setObjectives(labels.map(label => ({ label, done: false })));
    } else {
      this.hud.setObjectives([]);
    }

    audio.setPaused(false);
    if (audio.ctx) {
      audio.startEngine();
    }
  }

  startReplay() {
    if (this.replayRecorder.length === 0) return;
    this.resultsScreen.hide();
    this.hud.hide();
    this.state = 'REPLAY';
    this.replayReadIdx = 0;
    this.replayTime = 0;
    this.cameraRig.replayForceChase = false;
    this.cameraRig.replayCutIndex = -1;
    this.replayBanner.classList.remove('hidden');
  }

  exitReplay() {
    if (this.state !== 'REPLAY') return;
    this.replayBanner.classList.add('hidden');
    this.state = 'FINISHED';
    this.hud.show();
    this.cameraRig.replayCutIndex = -1;
    if (this.lastEndSnapshot) {
      this.playerBike.s = this.lastEndSnapshot.p.s;
      this.playerBike.d = this.lastEndSnapshot.p.d;
      this.playerBike.speed = 0;
      this.playerBike.syncTransform();
      this.rivalAI.rivals.forEach((r, idx) => {
        if (this.lastEndSnapshot.r[idx]) {
          r.bike.s = this.lastEndSnapshot.r[idx].s;
          r.bike.d = this.lastEndSnapshot.r[idx].d;
          r.bike.speed = 0;
          r.bike.syncTransform();
        }
      });
    }
    this.cameraRig.reset(this.playerBike);
    if (this.lastRaceResults) {
      this.resultsScreen.show(this.lastRaceResults);
    }
  }
}
