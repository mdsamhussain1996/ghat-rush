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
import { HUD } from '../ui/HUD.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { ResultsScreen } from '../ui/ResultsScreen.js';
import { F3Overlay } from '../ui/F3Overlay.js';
import tracksData from '../data/tracks.json';
import bikesData from '../data/bikes.json';

/**
 * Main Game Controller — Orchestrates simulation, track streaming, entities, audio, and UI.
 */
export class Game {
  constructor(container) {
    this.container = container || document.body;

    // State
    this.state = 'COUNTDOWN'; // 'COUNTDOWN', 'RACING', 'PAUSED', 'FINISHED', 'REPLAY', 'READY_MENU'
    this.prePauseState = 'RACING';
    this.countdownTimer = 3.8;
    this.raceTime = 0;
    this.totalTime = 0;
    this.totalLaps = 3;
    this.nearMissCount = 0;
    this.bestLapTime = Infinity;
    this.currentLapStartTime = 0;
    this.lastLap = 1;
    this.lastRaceResults = null;
    this.lastEndSnapshot = null;

    // Track Configuration (default Konkan Cliffs; supports ?track=<id> for multi-track testing)
    const params = new URLSearchParams(window.location.search);
    const trackParam = params.get('track');
    this.trackConfig = tracksData.find(t => t.id === trackParam)
      || tracksData.find(t => t.id === 'coast_route_1')
      || tracksData[0];
    this.totalLaps = this.trackConfig.laps || 3;
    this.playerBikeData = bikesData.find(b => b.id === 'vayu_r7') || bikesData[3];

    this.replayRecorder = new ReplayRecorder(4800);
    this.replayReadIdx = 0;
    this.replayTime = 0;

    this.initScene();
    this.initTrack();
    this.initEntities();
    this.initUI();
    this.initVisibilityPause();
    this.initLoop();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.renderer = new Renderer(this.container);
    this.cameraRig = new CameraRig(null);
    this.sky = new Sky(this.scene, this.trackConfig.environment || 'coastal');
    this.postFX = new PostFX(this.container);
    this.input = new Input();
  }

  initTrack() {
    this.spline = new RoadSpline(this.trackConfig.controlPoints, this.trackConfig);
    this.cameraRig.spline = this.spline;

    this.trackBuilder = new TrackBuilder(this.spline, this.trackConfig);
    this.roadMesh = this.trackBuilder.buildRoadMesh();
    this.scene.add(this.roadMesh);

    this.scenery = new Scenery(this.scene, this.spline, this.trackConfig);
  }

  initEntities() {
    // 1. Player Bike
    this.playerBike = new Bike(this.scene, this.spline, this.playerBikeData, true, { color: '#ff4d29' });
    this.playerBike.s = 0;
    this.playerBike.d = 0;
    this.playerBike.syncTransform();

    this.playerBike.onNearMiss = (combo) => {
      this.nearMissCount++;
      const bonus = 150 * combo;
      this.hud.showPopup('NEAR MISS!', `+${bonus} · COMBO ×${combo}`, 'near-miss');
    };

    // 2. Traffic Pool
    this.traffic = new Traffic(this.scene, this.spline, this.trackConfig);

    this.playerBike.onRespawn = (s, range) => {
      this.traffic.clearAhead(s, range);
    };

    // 3. AI Rivals
    this.rivalAI = new RivalAI(this.scene, this.spline, this.trackConfig, bikesData);
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
      () => this.startReplay()
    );
    this.f3Overlay = new F3Overlay(this.container, this.renderer);

    // Countdown overlay
    this.countdownEl = document.createElement('div');
    this.countdownEl.id = 'countdown-display';
    this.countdownEl.className = 'countdown-text';
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

    // Lightweight Ready Menu overlay for Quit-to-Menu before Phase 3 full menu system
    this.readyMenuOverlay = document.createElement('div');
    this.readyMenuOverlay.id = 'ready-menu-overlay';
    this.readyMenuOverlay.className = 'ui-modal hidden';
    this.readyMenuOverlay.innerHTML = `
      <div class="results-card pause-card">
        <h1 class="results-title" style="color:#ff4d29;">GHAT RUSH</h1>
        <p class="pause-sub">${this.trackConfig.name} · ${this.playerBikeData.name}</p>
        <div class="pause-actions">
          <button id="ready-start-btn" class="btn btn-primary">START RACE</button>
        </div>
      </div>
    `;
    this.container.appendChild(this.readyMenuOverlay);
    this.readyMenuOverlay.querySelector('#ready-start-btn').onclick = () => {
      this.readyMenuOverlay.classList.add('hidden');
      this.hud.show();
      this.restartRace();
    };

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

  quitToMenu() {
    this.pauseMenu.hide();
    this.resultsScreen.hide();
    this.replayBanner.classList.add('hidden');
    this.countdownEl.style.display = 'none';
    audio.stopEngine();
    this.state = 'READY_MENU';
    this.hud.hide();
    this.readyMenuOverlay.classList.remove('hidden');
  }

  update(dt) {
    const controls = this.input.getControls();

    // Global Mute hotkey (M)
    if (controls.mute) {
      this.toggleMute();
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

    if (this.state === 'PAUSED' || this.state === 'READY_MENU') {
      return;
    }

    this.totalTime += dt;
    if (this.scenery) {
      this.scenery.update(dt, this.totalTime);
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

    // Reset hotkey (R) during racing
    if (controls.reset && this.state === 'RACING') {
      this.playerBike.triggerCrash();
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
      const rivalsBikes = this.rivalAI.rivals.map(r => r.bike);
      this.hud.update(dt, this.playerBike, rivalsBikes, 0, this.totalLaps);
      return;
    }

    if (this.state === 'RACING') {
      this.raceTime += dt;

      // Check lap transitions
      if (this.playerBike.lap > this.lastLap) {
        const lapTime = this.raceTime - this.currentLapStartTime;
        if (lapTime > 0 && lapTime < this.bestLapTime) {
          this.bestLapTime = lapTime;
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
      this.traffic.update(dt, this.playerBike.s, playerSpeed);
      const activeTraffic = this.traffic.getActiveList();

      this.rivalAI.update(dt, this.playerBike, activeTraffic);

      const rivalsBikes = this.rivalAI.rivals.map(r => r.bike);
      this.playerBike.update(dt, controls, rivalsBikes, activeTraffic);

      // Record tick to Replay ring buffer
      this.replayRecorder.recordFrame(this.playerBike, rivalsBikes, activeTraffic);

      this.cameraRig.update(dt, this.playerBike, activeTraffic);
      this.sky.update(this.playerBike);
      this.postFX.update(dt, this.playerBike);

      this.hud.update(dt, this.playerBike, rivalsBikes, this.raceTime, this.totalLaps);
    } else if (this.state === 'FINISHED') {
      this.playerBike.speed = Math.max(0, this.playerBike.speed - 12.0 * dt);
      this.playerBike.update(dt, { throttle: 0, brake: 0.4, steer: 0, nitro: false, wheelie: false }, [], []);
      this.cameraRig.update(dt, this.playerBike);
      this.sky.update(this.playerBike);
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
    this.sky.update(this.playerBike);
    this.postFX.update(dt, this.playerBike);
  }

  render(alpha, currentTime) {
    this.renderer.render(this.scene, this.cameraRig.camera);
    this.f3Overlay.update(currentTime, this.renderer.getStats());
  }

  finishRace() {
    this.state = 'FINISHED';
    this.pauseMenu.hide();
    audio.setPaused(false);
    audio.stopEngine();

    const leaderboard = this.rivalAI.getLeaderboard(this.playerBike);
    const playerPos = leaderboard.findIndex(entry => entry.isPlayer) + 1;
    const cashWon = Math.max(5000, (4 - playerPos) * 12000) + (this.nearMissCount * 350);
    const starsWon = playerPos === 1 ? 3 : (playerPos <= 3 ? 2 : 1);

    // Save rewards ONCE per finished race
    save.addCash(cashWon);
    save.addStars(starsWon);

    // Store finish snapshot in case user enters & exits replay
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
      cashWon,
      starsWon
    };

    this.resultsScreen.show(this.lastRaceResults);
  }

  restartRace() {
    this.resultsScreen.hide();
    this.pauseMenu.hide();
    this.replayBanner.classList.add('hidden');
    this.readyMenuOverlay.classList.add('hidden');
    this.hud.show();
    this.hud.clearPopups();

    this.state = 'COUNTDOWN';
    this.countdownTimer = 3.8;
    this.countdownEl.style.display = 'block';
    this.countdownEl.classList.remove('countdown-go');
    this.countdownEl.innerText = '3';

    this.raceTime = 0;
    this.totalTime = 0;
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
