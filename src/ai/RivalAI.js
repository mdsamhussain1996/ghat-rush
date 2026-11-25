import * as THREE from 'three';
import { Bike } from '../vehicles/Bike.js';

/**
 * RivalAI Manager — Manages 5 AI competitors with racing lines, traffic avoidance, and distinct personalities.
 */
export class RivalAI {
  constructor(scene, spline, trackData, bikesData = []) {
    this.scene = scene;
    this.spline = spline;
    this.trackData = trackData;
    this.bikesData = bikesData;
    this.rivals = [];

    this.initRivals();
  }

  initRivals() {
    const rivalConfigs = this.trackData.rivals || [
      { name: "Raftaar Roy", bike: "vayu_r7", skill: 0.88, color: "#f59e0b", personality: "aggressive" },
      { name: "Zoya Mirza", bike: "chetak_300", skill: 0.84, color: "#06b6d4", personality: "smooth" },
      { name: "Vikram Volt", bike: "trishul_650", skill: 0.80, color: "#10b981", personality: "overtaker" },
      { name: "Tara Torque", bike: "chakra_750", skill: 0.77, color: "#ec4899", personality: "smooth" },
      { name: "Kabir Dash", bike: "vayu_150", skill: 0.74, color: "#8b5cf6", personality: "blocker" }
    ];

    // Grid starting offsets: staggered grid positions behind or ahead of start
    const gridD = [-2.5, 2.5, -2.5, 2.5, -2.5];
    const gridS = [18, 12, 6, 0, -6]; // Grid positions along S

    rivalConfigs.forEach((cfg, idx) => {
      const bData = this.bikesData.find(b => b.id === cfg.bike) || {
        topSpeedKmh: 240,
        accelMs: 3.2,
        handling: 0.9,
        nitroCapacity: 3.5
      };

      const bike = new Bike(this.scene, this.spline, bData, false, { color: cfg.color });
      bike.s = Math.max(0, gridS[idx] || 0);
      bike.d = gridD[idx] || 0;
      bike.speed = 0;
      bike.syncTransform();

      this.rivals.push({
        name: cfg.name,
        skill: cfg.skill || 0.82,
        personality: cfg.personality || 'smooth',
        bike,
        controls: {
          throttle: 1.0,
          brake: 0,
          steer: 0,
          nitro: false,
          wheelie: false
        },
        lanePreference: gridD[idx] || 0,
        overtakeOffset: 0
      });
    });
  }

  update(dt, playerBike, trafficList) {
    const totalLen = this.spline.totalLength;
    const halfW = (this.trackData?.roadWidth || 14) / 2;
    const lanes = this.spline.getLaneCenters ? this.spline.getLaneCenters() : [-3.5, 0, 3.5];

    for (const r of this.rivals) {
      const bike = r.bike;
      const ctrl = r.controls;

      // 1. Multi-point curvature lookahead along spline
      const currentFrame = this.spline.getFrameAtDistance(bike.s);
      const look1 = this.spline.getFrameAtDistance(bike.s + 28 + bike.speed * 0.35);
      const look2 = this.spline.getFrameAtDistance(bike.s + 60 + bike.speed * 0.55);
      const currentCurv = currentFrame.curvature || 0;
      const peakCurvObj = [currentFrame, look1, look2].reduce((best, f) =>
        Math.abs(f.curvature || 0) > Math.abs(best.curvature || 0) ? f : best, currentFrame);
      const peakCurv = peakCurvObj.curvature || 0;
      const isCurving = Math.abs(peakCurv) > 0.004;

      // Desired lateral offset (apex inside: negative binormal when curv > 0)
      let targetD = r.lanePreference;
      if (isCurving) {
        const apexSide = -Math.sign(peakCurv);
        targetD = apexSide * Math.max(1.2, halfW - 2.6);
      }

      // 2. Traffic Avoidance & Overtaking
      const obstacles = [...trafficList, playerBike];
      let obstacleAhead = null;
      let minObstacleDist = 999;

      for (const obs of obstacles) {
        if (obs === bike) continue;
        let sDist = obs.s - bike.s;
        if (sDist < -totalLen * 0.5) sDist += totalLen;
        if (sDist > totalLen * 0.5) sDist -= totalLen;

        if (sDist > 2 && sDist < 34 && Math.abs(obs.d - bike.d) < 2.0) {
          if (sDist < minObstacleDist) {
            minObstacleDist = sDist;
            obstacleAhead = obs;
          }
        }
      }

      if (obstacleAhead) {
        // Choose clearest lane away from obstacle
        const clearLanes = lanes.filter(ld => Math.abs(ld - obstacleAhead.d) > 2.0);
        if (clearLanes.length > 0) {
          targetD = clearLanes.reduce((a, b) => Math.abs(a - bike.d) < Math.abs(b - bike.d) ? a : b);
        } else {
          const steerSide = obstacleAhead.d > 0 ? -1 : 1;
          targetD = obstacleAhead.d + steerSide * 2.5;
        }
      }
      targetD = Math.max(-(halfW - 1.5), Math.min(halfW - 1.5, targetD));

      // 3. Steering control + curvature counter-lean feedforward
      const gripVel = 6.9 * (0.78 + 0.28 * bike.handling) * (bike.tyreGripBonus || 1) * (bike.surfaceGrip || 1);
      const driftVel = currentCurv * (bike.speed * bike.speed) * 0.21;
      const counterSteer = -driftVel / Math.max(1.0, gripVel);
      const dError = targetD - bike.d;
      ctrl.steer = Math.max(-1.0, Math.min(1.0, dError * 0.45 + counterSteer));

      // 4. Speed control & Braking based on real safe cornering speed
      const speedKmh = bike.getSpeedKmh();
      let curveSpeedLimit = bike.topSpeedKmh;

      if (Math.abs(peakCurv) > 0.004) {
        const safeCornerKmh = Math.sqrt((gripVel * 0.90) / (Math.abs(peakCurv) * 0.21)) * 3.6;
        curveSpeedLimit = Math.min(bike.topSpeedKmh, safeCornerKmh * (0.86 + r.skill * 0.14));
      }

      // Subtle rubber-banding: ±5%
      let playerDist = bike.s - playerBike.s;
      if (playerDist < -totalLen * 0.5) playerDist += totalLen;
      if (playerDist > totalLen * 0.5) playerDist -= totalLen;

      let rubberBand = 1.0;
      if (playerDist < -50) rubberBand = 1.05;
      else if (playerDist > 70) rubberBand = 0.95;

      const targetSpeed = curveSpeedLimit * rubberBand;

      if (speedKmh > targetSpeed + 6) {
        ctrl.throttle = 0;
        ctrl.brake = Math.min(1.0, (speedKmh - targetSpeed) / 22);
      } else {
        ctrl.throttle = 1.0;
        ctrl.brake = 0;
      }

      // 5. Nitro usage on straights
      if (!isCurving && speedKmh > 165 && bike.nitro > 1.0 && Math.random() < 0.05) {
        ctrl.nitro = true;
      } else {
        ctrl.nitro = false;
      }

      // 6. Update rival bike physics
      const allRivalsExceptSelf = this.rivals.map(rv => rv.bike).filter(b => b !== bike);
      bike.update(dt, ctrl, [playerBike, ...allRivalsExceptSelf], trafficList);
    }
  }

  getLeaderboard(playerBike) {
    const list = [
      { name: 'YOU', bike: playerBike, isPlayer: true },
      ...this.rivals.map(r => ({ name: r.name, bike: r.bike, isPlayer: false }))
    ];

    // Sort by lap descending, then by distance S descending
    list.sort((a, b) => {
      if (a.bike.lap !== b.bike.lap) return b.bike.lap - a.bike.lap;
      return b.bike.s - a.bike.s;
    });

    return list;
  }

  reset() {
    const gridD = [-2.5, 2.5, -2.5, 2.5, -2.5];
    const gridS = [18, 12, 6, 0, -6];
    this.rivals.forEach((r, idx) => {
      r.bike.reset();
      r.bike.s = Math.max(0, gridS[idx] || 0);
      r.bike.d = gridD[idx] || 0;
      r.bike.syncTransform();
    });
  }
}
