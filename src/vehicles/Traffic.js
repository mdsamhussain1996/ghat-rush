import * as THREE from 'three';
import { audio } from '../core/Audio.js';
import { mergeColoredParts } from '../render/GeomMerge.js';

/**
 * Traffic System — Procedural Indian Highway Traffic & Object Pool
 * Features:
 * - Auto-rickshaws (iconic green/yellow 3-wheeler)
 * - Highway Cargo Trucks ("Horn OK Please" painted freight carrier)
 * - Yellow/Black & White Taxis (sedans with roof racks)
 * - Delivery bikes (commuters with cargo crates)
 * - Object pooling to ensure zero garbage collection during gameplay
 */
export class Traffic {
  constructor(scene, spline, trackData = {}) {
    this.scene = scene;
    this.spline = spline;
    this.trackData = trackData;
    this.poolSize = 18;
    this.vehicles = [];
    this.activeVehicles = [];

    this.roadWidth = trackData.roadWidth || 14.0;
    this.lanes = this.spline.getLaneCenters ? this.spline.getLaneCenters() : [-3.8, 0, 3.8];
    this.density = Math.max(0.15, Math.min(1.0, trackData.trafficDensity || 0.45));
    this.maxActive = Math.max(2, Math.min(this.poolSize, Math.round(this.lanes.length * this.density * 5.5)));

    // Reusable materials
    this.materials = {
      body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 }),
      indicator: new THREE.MeshBasicMaterial({ color: 0xffaa00 })
    };

    // Cached merged geometry per vehicle type (reused across all pooled instances -> near-zero memory churn)
    this.typeTemplates = {};
    ['rickshaw', 'truck', 'taxi', 'scooter'].forEach(t => {
      this.typeTemplates[t] = this.buildMergedTemplate(t);
    });

    this.initPool();
  }

  buildMergedTemplate(type) {
    const parts = [];
    let length = 3.6;
    let width = 1.8;
    let height = 1.5;

    if (type === 'rickshaw') {
      length = 2.7;
      width = 1.35;
      height = 1.75;
      const bodyG = new THREE.BoxGeometry(width, 0.7, length * 0.7);
      const canopyG = new THREE.BoxGeometry(width * 0.95, 0.75, length * 0.85);
      const frontG = new THREE.CylinderGeometry(0.2, width * 0.5, 0.7, 4);
      const headG = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 6);
      const tailG = new THREE.BoxGeometry(0.15, 0.1, 0.05);
      const wheelG = new THREE.CylinderGeometry(0.24, 0.24, 0.14, 8);
      parts.push(
        { geo: bodyG, color: 0x1b7a3e, pos: [0, 0.5, 0.1] },
        { geo: canopyG, color: 0xf5b018, pos: [0, 1.2, 0.05] },
        { geo: frontG, color: 0x1b7a3e, pos: [0, 0.5, -length * 0.4], rot: [0, Math.PI / 4, 0] },
        { geo: headG, color: 0xfffae0, pos: [0, 0.65, -length * 0.52], rot: [Math.PI / 2, 0, 0] },
        { geo: tailG, color: 0xff2233, pos: [-width * 0.38, 0.6, length * 0.46] },
        { geo: tailG, color: 0xff2233, pos: [width * 0.38, 0.6, length * 0.46] },
        { geo: wheelG, color: 0x181818, pos: [0, 0.24, -length * 0.42], rot: [0, 0, Math.PI / 2] },
        { geo: wheelG, color: 0x181818, pos: [-width * 0.44, 0.24, length * 0.3], rot: [0, 0, Math.PI / 2] },
        { geo: wheelG, color: 0x181818, pos: [width * 0.44, 0.24, length * 0.3], rot: [0, 0, Math.PI / 2] }
      );
      const geo = mergeColoredParts(parts);
      [bodyG, canopyG, frontG, headG, tailG, wheelG].forEach(g => g.dispose());
      return { geo, length, width, height };
    }

    if (type === 'truck') {
      length = 6.8;
      width = 2.4;
      height = 2.9;
      const chassisG = new THREE.BoxGeometry(width * 0.85, 0.4, length);
      const cabG = new THREE.BoxGeometry(width, 1.8, length * 0.35);
      const glassG = new THREE.BoxGeometry(width * 0.9, 0.6, 0.05);
      const bedG = new THREE.BoxGeometry(width, 1.6, length * 0.62);
      const hlG = new THREE.BoxGeometry(0.25, 0.2, 0.05);
      const tlG = new THREE.BoxGeometry(0.3, 0.15, 0.05);
      const wheelG = new THREE.CylinderGeometry(0.48, 0.48, 0.3, 8);
      parts.push(
        { geo: chassisG, color: 0x222222, pos: [0, 0.5, 0] },
        { geo: cabG, color: 0xd9381e, pos: [0, 1.4, -length * 0.3] },
        { geo: glassG, color: 0x223344, pos: [0, 1.7, -length * 0.48] },
        { geo: bedG, color: 0x8b5a2b, pos: [0, 1.5, length * 0.18] }
      );
      for (const side of [-1, 1]) {
        parts.push(
          { geo: hlG, color: 0xfffae0, pos: [side * 0.85, 0.9, -length * 0.48] },
          { geo: tlG, color: 0xff2233, pos: [side * 0.9, 0.8, length * 0.49] },
          { geo: wheelG, color: 0x181818, pos: [side * 1.05, 0.48, -length * 0.32], rot: [0, 0, Math.PI / 2] },
          { geo: wheelG, color: 0x181818, pos: [side * 1.05, 0.48, length * 0.28], rot: [0, 0, Math.PI / 2] }
        );
      }
      const geo = mergeColoredParts(parts);
      [chassisG, cabG, glassG, bedG, hlG, tlG, wheelG].forEach(g => g.dispose());
      return { geo, length, width, height };
    }

    if (type === 'taxi') {
      length = 4.3;
      width = 1.8;
      height = 1.45;
      const lowerG = new THREE.BoxGeometry(width, 0.6, length);
      const cabinG = new THREE.BoxGeometry(width * 0.85, 0.6, length * 0.55);
      const rackG = new THREE.BoxGeometry(width * 0.75, 0.15, length * 0.35);
      const lightG = new THREE.BoxGeometry(0.24, 0.14, 0.05);
      const wheelG = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8);
      parts.push(
        { geo: lowerG, color: 0xf0a500, pos: [0, 0.55, 0] },
        { geo: cabinG, color: 0xf2f2f2, pos: [0, 1.1, -0.1] },
        { geo: rackG, color: 0x222222, pos: [0, 1.48, -0.1] }
      );
      for (const side of [-1, 1]) {
        parts.push(
          { geo: lightG, color: 0xfffae0, pos: [side * 0.65, 0.6, -length * 0.5] },
          { geo: lightG, color: 0xff2233, pos: [side * 0.65, 0.6, length * 0.5] },
          { geo: wheelG, color: 0x181818, pos: [side * 0.82, 0.3, -length * 0.32], rot: [0, 0, Math.PI / 2] },
          { geo: wheelG, color: 0x181818, pos: [side * 0.82, 0.3, length * 0.32], rot: [0, 0, Math.PI / 2] }
        );
      }
      const geo = mergeColoredParts(parts);
      [lowerG, cabinG, rackG, lightG, wheelG].forEach(g => g.dispose());
      return { geo, length, width, height };
    }

    // Scooter / Delivery (1 merged mesh)
    length = 2.0;
    width = 0.8;
    height = 1.2;
    const bodyG = new THREE.BoxGeometry(width * 0.6, 0.45, length * 0.7);
    const boxG = new THREE.BoxGeometry(width * 0.9, 0.55, 0.6);
    const wheelG = new THREE.CylinderGeometry(0.22, 0.22, 0.1, 8);
    const hlG = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 6);
    const tlG = new THREE.BoxGeometry(0.12, 0.08, 0.04);
    parts.push(
      { geo: bodyG, color: 0x0077b6, pos: [0, 0.45, 0] },
      { geo: boxG, color: 0x0077b6, pos: [0, 0.85, 0.45] },
      { geo: wheelG, color: 0x181818, pos: [0, 0.22, -0.65], rot: [0, 0, Math.PI / 2] },
      { geo: wheelG, color: 0x181818, pos: [0, 0.22, 0.55], rot: [0, 0, Math.PI / 2] },
      { geo: hlG, color: 0xfffae0, pos: [0, 0.65, -0.75], rot: [Math.PI / 2, 0, 0] },
      { geo: tlG, color: 0xff2233, pos: [0, 0.6, 0.8] }
    );
    const geo = mergeColoredParts(parts);
    [bodyG, boxG, wheelG, hlG, tlG].forEach(g => g.dispose());
    return { geo, length, width, height };
  }

  initPool() {
    const types = ['rickshaw', 'truck', 'taxi', 'rickshaw', 'taxi', 'scooter'];
    for (let i = 0; i < this.poolSize; i++) {
      const type = types[i % types.length];
      const v = this.createVehicleMesh(type);
      v.poolIndex = i;
      v.type = type;
      v.s = 0;
      v.d = 0;
      v.targetD = 0;
      v.pendingTargetD = 0;
      v.pendingLaneIdx = -1;
      v.laneChangeState = 'none';
      v.signalTimer = 0;
      v.speed = 0;
      v.hasNearMissed = false;
      v.active = false;
      v.group.visible = false;
      this.scene.add(v.group);
      this.vehicles.push(v);
    }
  }

  createVehicleMesh(type) {
    const group = new THREE.Group();
    const tmpl = this.typeTemplates[type] || this.typeTemplates.taxi;
    const bodyMesh = new THREE.Mesh(tmpl.geo, this.materials.body);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    const { length, width, height } = tmpl;

    // Amber lane-change indicators (merged pair per side)
    const indG = new THREE.BoxGeometry(0.14, 0.14, 0.18);
    const indPosGeo = mergeColoredParts([
      { geo: indG, color: 0xffaa00, pos: [width * 0.46, 0.72, length * 0.49] },
      { geo: indG, color: 0xffaa00, pos: [width * 0.46, 0.72, -length * 0.49] }
    ]);
    const indNegGeo = mergeColoredParts([
      { geo: indG, color: 0xffaa00, pos: [-width * 0.46, 0.72, length * 0.49] },
      { geo: indG, color: 0xffaa00, pos: [-width * 0.46, 0.72, -length * 0.49] }
    ]);
    indG.dispose();

    const posXIndicator = new THREE.Mesh(indPosGeo, this.materials.indicator);
    const negXIndicator = new THREE.Mesh(indNegGeo, this.materials.indicator);
    posXIndicator.visible = false;
    negXIndicator.visible = false;
    group.add(posXIndicator, negXIndicator);

    return {
      group,
      length,
      width,
      height,
      posXIndicator,
      negXIndicator
    };
  }

  getNearestLaneIndex(d) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.lanes.length; i++) {
      const dist = Math.abs(this.lanes[i] - d);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  wrapSigned(diff) {
    const totalLen = this.spline.totalLength;
    let r = diff;
    if (r < -totalLen * 0.5) r += totalLen;
    if (r > totalLen * 0.5) r -= totalLen;
    return r;
  }

  wouldBlockAllLanes(candidateS, candidateLaneIdx, ignoreVehicle = null) {
    // Collect active traffic within +-80m of candidateS and check every 80m window
    const nearby = [{ sRel: 0, lanes: [candidateLaneIdx] }];
    for (const v of this.activeVehicles) {
      if (!v.active || v === ignoreVehicle) continue;
      const sRel = this.wrapSigned(v.s - candidateS);
      if (Math.abs(sRel) <= 80) {
        const occ = [this.getNearestLaneIndex(v.d)];
        if (v.laneChangeState === 'signaling' || v.laneChangeState === 'moving') {
          const tIdx = v.laneChangeState === 'signaling'
            ? this.getNearestLaneIndex(v.pendingTargetD)
            : this.getNearestLaneIndex(v.targetD);
          if (!occ.includes(tIdx)) occ.push(tIdx);
        }
        nearby.push({ sRel, lanes: occ });
      }
    }

    const windowStarts = [-80, -40, 0];
    for (const entry of nearby) {
      if (entry.sRel >= -80 && entry.sRel <= 0) {
        windowStarts.push(entry.sRel - 0.01);
      }
      if (entry.sRel >= 0 && entry.sRel <= 80) {
        windowStarts.push(entry.sRel - 79.99);
      }
    }

    for (const wStart of windowStarts) {
      const wEnd = wStart + 80;
      if (wStart > 0 || wEnd < 0) continue; // Only check 80m windows that contain candidateS (0)
      const occupied = new Set();
      for (const item of nearby) {
        if (item.sRel >= wStart && item.sRel <= wEnd) {
          for (const li of item.lanes) occupied.add(li);
        }
      }
      if (occupied.size >= this.lanes.length) {
        return true;
      }
    }
    return false;
  }

  spawnAhead(playerS) {
    if (this.activeVehicles.length >= this.maxActive) return;
    const inactive = this.vehicles.find(v => !v.active);
    if (!inactive) return;

    const laneIdx = Math.floor(Math.random() * this.lanes.length);
    const lane = this.lanes[laneIdx];
    let speedKmh = 60;
    if (inactive.type === 'rickshaw') speedKmh = 45 + Math.random() * 15;
    else if (inactive.type === 'truck') speedKmh = 52 + Math.random() * 18;
    else if (inactive.type === 'taxi') speedKmh = 75 + Math.random() * 25;
    else speedKmh = 50 + Math.random() * 20;

    // Spawn 90m to 220m ahead of player
    const totalLen = this.spline.totalLength;
    const spawnDist = 90 + Math.random() * 130;
    const s = (playerS + spawnDist) % totalLen;

    // Check same-lane longitudinal clearance AND guarantee at least 1 clear lane per 80m window
    const tooClose = this.activeVehicles.some(v => {
      const sDiff = Math.abs(this.wrapSigned(v.s - s));
      return sDiff < 24 && Math.abs(v.d - lane) < 1.8;
    });
    if (tooClose || this.wouldBlockAllLanes(s, laneIdx, null)) return;

    inactive.active = true;
    inactive.s = s;
    inactive.d = lane;
    inactive.targetD = lane;
    inactive.pendingTargetD = lane;
    inactive.pendingLaneIdx = -1;
    inactive.laneChangeState = 'none';
    inactive.signalTimer = 0;
    inactive.posXIndicator.visible = false;
    inactive.negXIndicator.visible = false;
    inactive.speed = speedKmh / 3.6;
    inactive.hasNearMissed = false;
    inactive.group.visible = true;

    this.activeVehicles.push(inactive);
  }

  clearAhead(s, range = 40) {
    const totalLen = this.spline.totalLength;
    for (let i = this.activeVehicles.length - 1; i >= 0; i--) {
      const v = this.activeVehicles[i];
      let sRel = v.s - s;
      if (sRel < -totalLen * 0.5) sRel += totalLen;
      if (sRel > totalLen * 0.5) sRel -= totalLen;
      // Clear anything from 5m behind up to range ahead
      if (sRel >= -5 && sRel <= range) {
        v.active = false;
        v.laneChangeState = 'none';
        v.posXIndicator.visible = false;
        v.negXIndicator.visible = false;
        v.group.visible = false;
        this.activeVehicles.splice(i, 1);
      }
    }
  }

  update(dt, playerS, playerSpeed) {
    if (this.activeVehicles.length < this.maxActive && Math.random() < 0.22) {
      this.spawnAhead(playerS);
    }

    const totalLen = this.spline.totalLength;

    for (let i = this.activeVehicles.length - 1; i >= 0; i--) {
      const v = this.activeVehicles[i];

      // Move along road while maintaining same-lane spacing and avoiding 80m multi-lane rolling blocks
      let stepSpeed = v.speed;
      const curLaneIdx = this.getNearestLaneIndex(v.d);
      for (const other of this.activeVehicles) {
        if (other === v || !other.active) continue;
        const gap = this.wrapSigned(other.s - v.s);
        if (gap > 0 && gap < 16 && Math.abs(other.d - v.d) < 1.8) {
          stepSpeed = Math.min(stepSpeed, other.speed * 0.9);
        }
      }
      const nextS = (v.s + stepSpeed * dt) % totalLen;
      if (!this.wouldBlockAllLanes(nextS, curLaneIdx, v)) {
        v.s = nextS;
      }

      // Telegraph lane change with 1s blinking indicator before moving laterally
      if (v.laneChangeState === 'none') {
        v.posXIndicator.visible = false;
        v.negXIndicator.visible = false;
        if (this.lanes.length > 1 && Math.random() < 0.004) {
          const curIdx = this.getNearestLaneIndex(v.d);
          const dir = curIdx === 0 ? 1 : (curIdx === this.lanes.length - 1 ? -1 : (Math.random() < 0.5 ? -1 : 1));
          const candIdx = curIdx + dir;
          const candD = this.lanes[candIdx];
          const laneConflict = this.activeVehicles.some(other =>
            other !== v && other.active &&
            Math.abs(this.wrapSigned(other.s - v.s)) < 26 &&
            (Math.abs(other.d - candD) < 1.8 || Math.abs(other.targetD - candD) < 1.8)
          );
          if (!laneConflict && !this.wouldBlockAllLanes(v.s, candIdx, v)) {
            v.laneChangeState = 'signaling';
            v.signalTimer = 1.0;
            v.pendingLaneIdx = candIdx;
            v.pendingTargetD = candD;
          }
        }
      } else if (v.laneChangeState === 'signaling') {
        v.signalTimer -= dt;
        if (v.signalTimer <= 0) {
          const laneConflict = this.activeVehicles.some(other =>
            other !== v && other.active &&
            Math.abs(this.wrapSigned(other.s - v.s)) < 22 &&
            (Math.abs(other.d - v.pendingTargetD) < 1.8 || Math.abs(other.targetD - v.pendingTargetD) < 1.8)
          );
          if (!laneConflict && !this.wouldBlockAllLanes(v.s, v.pendingLaneIdx, v)) {
            v.targetD = v.pendingTargetD;
            v.laneChangeState = 'moving';
          } else {
            v.laneChangeState = 'none';
            v.posXIndicator.visible = false;
            v.negXIndicator.visible = false;
          }
        }
      } else if (v.laneChangeState === 'moving') {
        if (Math.abs(v.d - v.targetD) > 0.05) {
          v.d = THREE.MathUtils.lerp(v.d, v.targetD, 2.2 * dt);
        } else {
          v.d = v.targetD;
          v.laneChangeState = 'none';
          v.posXIndicator.visible = false;
          v.negXIndicator.visible = false;
        }
      }

      // Check distance relative to player for despawning
      const sRel = this.wrapSigned(v.s - playerS);
      if (sRel < -55 || sRel > 320) {
        v.active = false;
        v.laneChangeState = 'none';
        v.posXIndicator.visible = false;
        v.negXIndicator.visible = false;
        v.group.visible = false;
        this.activeVehicles.splice(i, 1);
        continue;
      }

      // Sync 3D position to spline
      const frame = this.spline.getFrameAtDistance(v.s);
      const worldPos = frame.position.clone()
        .addScaledVector(frame.binormal, v.d)
        .addScaledVector(frame.normal, 0.05);
      v.group.position.copy(worldPos);
      v.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);

      // Update blinker side visual after orientation matches tangent
      if (v.laneChangeState === 'signaling' || v.laneChangeState === 'moving') {
        v.blinkPhase = (v.blinkPhase || 0) + dt;
        const blinkOn = Math.floor(v.blinkPhase * 6) % 2 === 0;
        const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(v.group.quaternion);
        const destD = v.laneChangeState === 'signaling' ? v.pendingTargetD : v.targetD;
        const movingPlusX = localX.dot(frame.binormal) * Math.sign(destD - v.d) >= 0;
        v.posXIndicator.visible = blinkOn && movingPlusX;
        v.negXIndicator.visible = blinkOn && !movingPlusX;
      }
    }
  }

  getActiveList() {
    return this.activeVehicles;
  }

  applyReplayFrame(trafficFrames = []) {
    const seen = new Set();
    for (const tf of trafficFrames) {
      const v = this.vehicles[tf.idx];
      if (!v) continue;
      seen.add(tf.idx);
      v.active = true;
      v.s = tf.s;
      v.d = tf.d;
      v.group.visible = true;
      const frame = this.spline.getFrameAtDistance(v.s);
      const worldPos = frame.position.clone()
        .addScaledVector(frame.binormal, v.d)
        .addScaledVector(frame.normal, 0.05);
      v.group.position.copy(worldPos);
      v.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
    }
    this.activeVehicles = [];
    for (const v of this.vehicles) {
      if (!seen.has(v.poolIndex)) {
        v.active = false;
        v.group.visible = false;
      } else {
        this.activeVehicles.push(v);
      }
    }
  }

  reset() {
    for (const v of this.vehicles) {
      v.active = false;
      v.laneChangeState = 'none';
      v.signalTimer = 0;
      v.posXIndicator.visible = false;
      v.negXIndicator.visible = false;
      v.group.visible = false;
      v.hasNearMissed = false;
    }
    this.activeVehicles = [];
  }

  dispose() {
    for (const v of this.vehicles) {
      this.scene?.remove(v.group);
      v.group?.traverse(child => {
        child.geometry?.dispose();
      });
    }
    Object.values(this.materials || {}).forEach(m => m?.dispose());
    this.vehicles = [];
    this.activeVehicles = [];
  }
}
