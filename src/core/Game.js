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
import { HUD } from '../ui/HUD.js';
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
    this.state = 'COUNTDOWN'; // 'COUNTDOWN', 'RACING', 'FINISHED', 'REPLAY'
    this.countdownTimer = 3.8;
    this.raceTime = 0;
    this.totalLaps = 3;
    this.nearMissCount = 0;
    this.bestLapTime = 9999;
    this.currentLapStartTime = 0;
    this.lastLap = 1;

    // Track Configuration (Coastal Highway Route 1 "Konkan Cliffs")
    this.trackConfig = tracksData.find(t => t.id === 'coast_route_1') || tracksData[0];
    this.playerBikeData = bikesData.find(b => b.id === 'vayu_r7') || bikesData[3];

    this.initScene();
    this.initTrack();
    this.initEntities();
    this.initUI();
    this.initLoop();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.renderer = new Renderer(this.container);
    this.cameraRig = new CameraRig(null); // Spline attached below
    this.sky = new Sky(this.scene, 'coastal');
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

    // 3. 5 AI Rivals
    this.rivalAI = new RivalAI(this.scene, this.spline, this.trackConfig, bikesData);
  }

  initUI() {
    this.hud = new HUD(this.container, this.input);
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

    // Audio unlock listener on first user click
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

  initLoop() {
    this.loop = new Loop(
      (dt) => this.update(dt),
      (alpha, time) => this.render(alpha, time)
    );
    this.loop.start();
  }

  update(dt) {
    this.totalTime = (this.totalTime || 0) + dt;
    if (this.scenery) {
      this.scenery.update(dt, this.totalTime);
    }

    const controls = this.input.getControls();

    // Camera mode toggle hotkey (C)
    if (this.input.isActionJustPressed('camera')) {
      const mode = this.cameraRig.cycleMode();
      this.hud.showPopup('CAMERA', mode.toUpperCase(), 'system');
    }

    // Reset hotkey (R)
    if (this.input.isActionJustPressed('reset')) {
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
      }

      // Restrict throttle during countdown
      const idleControls = { throttle: 0, brake: 0, steer: 0, nitro: false, wheelie: false };
      this.playerBike.update(dt, idleControls, [], []);
      this.cameraRig.update(dt, this.playerBike);
      return;
    }

    if (this.state === 'RACING') {
      this.raceTime += dt;

      // Check lap transitions
      if (this.playerBike.lap > this.lastLap) {
        const lapTime = this.raceTime - this.currentLapStartTime;
        if (lapTime < this.bestLapTime) this.bestLapTime = lapTime;
        this.currentLapStartTime = this.raceTime;
        this.lastLap = this.playerBike.lap;

        if (this.playerBike.lap > this.totalLaps) {
          this.finishRace();
          return;
        } else {
          this.hud.showPopup(`LAP ${this.playerBike.lap} / ${this.totalLaps}`, 'PUSH IT!', 'lap');
        }
      }

      // 1. Update Traffic
      const playerSpeed = this.playerBike.speed;
      this.traffic.update(dt, this.playerBike.s, playerSpeed);
      const activeTraffic = this.traffic.getActiveList();

      // 2. Update Rivals
      this.rivalAI.update(dt, this.playerBike, activeTraffic);

      // 3. Update Player Bike
      const rivalsBikes = this.rivalAI.rivals.map(r => r.bike);
      this.playerBike.update(dt, controls, rivalsBikes, activeTraffic);

      // 4. Update Camera & Visuals
      this.cameraRig.update(dt, this.playerBike);
      this.sky.update(this.playerBike);
      this.postFX.update(dt, this.playerBike);

      // 5. Update HUD
      this.hud.update(dt, this.playerBike, rivalsBikes, this.raceTime, this.totalLaps);
    } else if (this.state === 'FINISHED') {
      // Gentle coasting after finish line
      this.playerBike.speed = Math.max(0, this.playerBike.speed - 12.0 * dt);
      this.playerBike.update(dt, { throttle: 0, brake: 0.4, steer: 0, nitro: false, wheelie: false }, [], []);
      this.cameraRig.update(dt, this.playerBike);
      this.sky.update(this.playerBike);
      this.postFX.update(dt, this.playerBike);
    }
  }

  render(alpha, currentTime) {
    this.renderer.render(this.scene, this.cameraRig.camera);
    this.f3Overlay.update(currentTime, this.renderer.getStats());
  }

  finishRace() {
    this.state = 'FINISHED';
    const rivalsBikes = this.rivalAI.rivals.map(r => r.bike);
    const leaderboard = this.rivalAI.getLeaderboard(this.playerBike);
    const playerPos = leaderboard.findIndex(entry => entry.isPlayer) + 1;

    audio.stopEngine();

    this.resultsScreen.show({
      position: playerPos,
      totalRacers: leaderboard.length,
      raceTime: this.raceTime,
      nearMisses: this.nearMissCount,
      bestLap: this.bestLapTime
    });
  }

  restartRace() {
    this.state = 'COUNTDOWN';
    this.countdownTimer = 3.8;
    this.countdownEl.style.display = 'block';
    this.countdownEl.classList.remove('countdown-go');
    this.countdownEl.innerText = '3';

    this.raceTime = 0;
    this.lastLap = 1;
    this.nearMissCount = 0;
    this.currentLapStartTime = 0;

    this.playerBike.s = 0;
    this.playerBike.d = 0;
    this.playerBike.speed = 0;
    this.playerBike.lap = 1;
    this.playerBike.nitro = this.playerBike.nitroCapacity;
    this.playerBike.isCrashed = false;
    this.playerBike.syncTransform();

    this.traffic.reset();
    this.rivalAI.reset();
    this.cameraRig.reset(this.playerBike);
  }

  startReplay() {
    this.state = 'REPLAY';
    this.cameraRig.mode = 'close';
    this.hud.showPopup('REPLAY MODE', 'PRESS ESC / RESTART TO EXIT', 'system');
  }
}
