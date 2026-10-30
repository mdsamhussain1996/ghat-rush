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

    for (const r of this.rivals) {
      const bike = r.bike;
      const ctrl = r.controls;

      // 1. Look-ahead along spline to calculate cornering line
      const lookDist = 45 + (bike.speed * 0.8);
      const futureS = (bike.s + lookDist) % totalLen;
      const currentFrame = this.spline.getFrameAtDistance(bike.s);
      const futureFrame = this.spline.getFrameAtDistance(futureS);

      // Measure curve curvature by cross product of tangents
      const curveCross = currentFrame.tangent.x * futureFrame.tangent.z - currentFrame.tangent.z * futureFrame.tangent.x;
      const isCurving = Math.abs(curveCross) > 0.04;

      // Desired lateral offset (racing line: enter wide, hit apex, exit wide)
      let targetD = r.lanePreference;
      if (isCurving) {
        // Cut towards inner apex of the curve
        targetD = -Math.sign(curveCross) * 2.8;
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

        if (sDist > 2 && sDist < 28 && Math.abs(obs.d - bike.d) < 2.0) {
          if (sDist < minObstacleDist) {
            minObstacleDist = sDist;
            obstacleAhead = obs;
          }
        }
      }

      if (obstacleAhead) {
        // Steer away into clear lane
        const steerSide = obstacleAhead.d > 0 ? -1 : 1;
        targetD = obstacleAhead.d + steerSide * 2.5;
        // Cap to road boundaries
        targetD = Math.max(-5.0, Math.min(5.0, targetD));
      }

      // 3. Steering control
      const dError = targetD - bike.d;
      ctrl.steer = Math.max(-1.0, Math.min(1.0, dError * 0.45));

      // 4. Speed control & Braking
      const speedKmh = bike.getSpeedKmh();
      let curveSpeedLimit = bike.topSpeedKmh;

      if (isCurving) {
        // Tighter curves require lower speeds
        curveSpeedLimit = 160 + (r.skill * 50) - (Math.abs(curveCross) * 120);
      }

      // Subtle rubber-banding: ±5%
      let playerDist = bike.s - playerBike.s;
      if (playerDist < -totalLen * 0.5) playerDist += totalLen;
      if (playerDist > totalLen * 0.5) playerDist -= totalLen;

      let rubberBand = 1.0;
      if (playerDist < -50) rubberBand = 1.05; // Player is far ahead, speed up slightly
      else if (playerDist > 70) rubberBand = 0.95; // Rival is far ahead, ease up slightly

      const targetSpeed = curveSpeedLimit * rubberBand;

      if (speedKmh > targetSpeed + 8) {
        ctrl.throttle = 0;
        ctrl.brake = Math.min(1.0, (speedKmh - targetSpeed) / 25);
      } else {
        ctrl.throttle = 1.0;
        ctrl.brake = 0;
      }

      // 5. Nitro usage on straights
      if (!isCurving && speedKmh > 180 && bike.nitro > 1.0 && Math.random() < 0.05) {
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
      r.bike.s = Math.max(0, gridS[idx] || 0);
      r.bike.d = gridD[idx] || 0;
      r.bike.speed = 0;
      r.bike.lap = 1;
      r.bike.isCrashed = false;
      r.bike.nitro = r.bike.nitroCapacity;
      r.bike.syncTransform();
    });
  }
}
