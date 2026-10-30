import * as THREE from 'three';
import { audio } from '../core/Audio.js';

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
    this.lanes = [-3.8, -1.3, 1.3, 3.8]; // 4 distinct lanes

    // Reusable materials
    this.materials = {
      rickshawGreen: new THREE.MeshStandardMaterial({ color: 0x1b7a3e, roughness: 0.5 }),
      rickshawYellow: new THREE.MeshStandardMaterial({ color: 0xf5b018, roughness: 0.4 }),
      truckCab: new THREE.MeshStandardMaterial({ color: 0xd9381e, roughness: 0.6 }),
      truckWood: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 }),
      taxiWhite: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3 }),
      taxiYellow: new THREE.MeshStandardMaterial({ color: 0xf0a500, roughness: 0.4 }),
      deliveryBlue: new THREE.MeshStandardMaterial({ color: 0x0077b6, roughness: 0.5 }),
      metalDark: new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.3 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9, roughness: 0.2 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.9 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.5 }),
      headlight: new THREE.MeshBasicMaterial({ color: 0xfffae0 }),
      taillight: new THREE.MeshBasicMaterial({ color: 0xff1122 })
    };

    this.initPool();
  }

  initPool() {
    const types = ['rickshaw', 'truck', 'taxi', 'rickshaw', 'taxi', 'scooter'];
    for (let i = 0; i < this.poolSize; i++) {
      const type = types[i % types.length];
      const v = this.createVehicleMesh(type);
      v.type = type;
      v.s = 0;
      v.d = 0;
      v.targetD = 0;
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
    let length = 3.6;
    let width = 1.8;
    let height = 1.5;

    if (type === 'rickshaw') {
      length = 2.7;
      width = 1.35;
      height = 1.75;

      // Lower body (Green)
      const bodyGeo = new THREE.BoxGeometry(width, 0.7, length * 0.7);
      const body = new THREE.Mesh(bodyGeo, this.materials.rickshawGreen);
      body.position.set(0, 0.5, 0.1);
      body.castShadow = true;
      group.add(body);

      // Yellow canopy hood
      const canopyGeo = new THREE.BoxGeometry(width * 0.95, 0.75, length * 0.85);
      const canopy = new THREE.Mesh(canopyGeo, this.materials.rickshawYellow);
      canopy.position.set(0, 1.2, 0.05);
      canopy.castShadow = true;
      group.add(canopy);

      // Windshield & Front taper
      const frontGeo = new THREE.CylinderGeometry(0.2, width * 0.5, 0.7, 4);
      frontGeo.rotateY(Math.PI / 4);
      const front = new THREE.Mesh(frontGeo, this.materials.rickshawGreen);
      front.position.set(0, 0.5, -length * 0.4);
      group.add(front);

      // Single center headlight
      const headLGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12);
      headLGeo.rotateX(Math.PI / 2);
      const headL = new THREE.Mesh(headLGeo, this.materials.headlight);
      headL.position.set(0, 0.65, -length * 0.52);
      group.add(headL);

      // Dual taillights
      for (const side of [-1, 1]) {
        const tailGeo = new THREE.BoxGeometry(0.15, 0.1, 0.05);
        const tail = new THREE.Mesh(tailGeo, this.materials.taillight);
        tail.position.set(side * (width * 0.38), 0.6, length * 0.46);
        group.add(tail);
      }

      // Wheels (1 front, 2 rear)
      const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.14, 12);
      wheelGeo.rotateZ(Math.PI / 2);
      const frontW = new THREE.Mesh(wheelGeo, this.materials.rubber);
      frontW.position.set(0, 0.24, -length * 0.42);
      group.add(frontW);

      for (const side of [-1, 1]) {
        const rearW = new THREE.Mesh(wheelGeo, this.materials.rubber);
        rearW.position.set(side * (width * 0.44), 0.24, length * 0.3);
        group.add(rearW);
      }
    } else if (type === 'truck') {
      length = 6.8;
      width = 2.4;
      height = 2.9;

      // Chassis frame
      const chassisGeo = new THREE.BoxGeometry(width * 0.85, 0.4, length);
      const chassis = new THREE.Mesh(chassisGeo, this.materials.metalDark);
      chassis.position.set(0, 0.5, 0);
      group.add(chassis);

      // Front colorful cab
      const cabGeo = new THREE.BoxGeometry(width, 1.8, length * 0.35);
      const cab = new THREE.Mesh(cabGeo, this.materials.truckCab);
      cab.position.set(0, 1.4, -length * 0.3);
      cab.castShadow = true;
      group.add(cab);

      // Windshield
      const glassGeo = new THREE.BoxGeometry(width * 0.9, 0.6, 0.05);
      const glass = new THREE.Mesh(glassGeo, this.materials.glass);
      glass.position.set(0, 1.7, -length * 0.48);
      group.add(glass);

      // Wooden cargo bed with decorative side slats
      const bedGeo = new THREE.BoxGeometry(width, 1.6, length * 0.62);
      const bed = new THREE.Mesh(bedGeo, this.materials.truckWood);
      bed.position.set(0, 1.5, length * 0.18);
      bed.castShadow = true;
      group.add(bed);

      // Headlights
      for (const side of [-1, 1]) {
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.05), this.materials.headlight);
        hl.position.set(side * 0.85, 0.9, -length * 0.48);
        group.add(hl);
      }

      // Taillights
      for (const side of [-1, 1]) {
        const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.05), this.materials.taillight);
        tl.position.set(side * 0.9, 0.8, length * 0.49);
        group.add(tl);
      }

      // Heavy wheels (2 front, 4 rear duals)
      const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.3, 14);
      wheelGeo.rotateZ(Math.PI / 2);
      for (const side of [-1, 1]) {
        const fw = new THREE.Mesh(wheelGeo, this.materials.rubber);
        fw.position.set(side * 1.05, 0.48, -length * 0.32);
        group.add(fw);

        const rw1 = new THREE.Mesh(wheelGeo, this.materials.rubber);
        rw1.position.set(side * 1.05, 0.48, length * 0.18);
        group.add(rw1);

        const rw2 = new THREE.Mesh(wheelGeo, this.materials.rubber);
        rw2.position.set(side * 1.05, 0.48, length * 0.38);
        group.add(rw2);
      }
    } else if (type === 'taxi') {
      length = 4.3;
      width = 1.8;
      height = 1.45;

      // Lower body (Yellow)
      const lowerGeo = new THREE.BoxGeometry(width, 0.6, length);
      const lower = new THREE.Mesh(lowerGeo, this.materials.taxiYellow);
      lower.position.set(0, 0.55, 0);
      lower.castShadow = true;
      group.add(lower);

      // Cabin roof (White)
      const cabinGeo = new THREE.BoxGeometry(width * 0.85, 0.6, length * 0.55);
      const cabin = new THREE.Mesh(cabinGeo, this.materials.taxiWhite);
      cabin.position.set(0, 1.1, -0.1);
      cabin.castShadow = true;
      group.add(cabin);

      // Luggage roof rack
      const rackGeo = new THREE.BoxGeometry(width * 0.75, 0.15, length * 0.35);
      const rack = new THREE.Mesh(rackGeo, this.materials.metalDark);
      rack.position.set(0, 1.48, -0.1);
      group.add(rack);

      // Headlights and Taillights
      for (const side of [-1, 1]) {
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.05), this.materials.headlight);
        hl.position.set(side * 0.65, 0.6, -length * 0.5);
        group.add(hl);

        const tl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.05), this.materials.taillight);
        tl.position.set(side * 0.65, 0.6, length * 0.5);
        group.add(tl);
      }

      // Wheels
      const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14);
      wheelGeo.rotateZ(Math.PI / 2);
      for (const side of [-1, 1]) {
        const fw = new THREE.Mesh(wheelGeo, this.materials.rubber);
        fw.position.set(side * 0.82, 0.3, -length * 0.32);
        group.add(fw);

        const rw = new THREE.Mesh(wheelGeo, this.materials.rubber);
        rw.position.set(side * 0.82, 0.3, length * 0.32);
        group.add(rw);
      }
    } else {
      // Scooter / Delivery
      length = 2.0;
      width = 0.8;
      height = 1.2;

      const bodyGeo = new THREE.BoxGeometry(width * 0.6, 0.45, length * 0.7);
      const body = new THREE.Mesh(bodyGeo, this.materials.deliveryBlue);
      body.position.set(0, 0.45, 0);
      group.add(body);

      // Blue delivery box
      const boxGeo = new THREE.BoxGeometry(width * 0.9, 0.55, 0.6);
      const box = new THREE.Mesh(boxGeo, this.materials.deliveryBlue);
      box.position.set(0, 0.85, 0.45);
      group.add(box);

      // Wheels
      const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12);
      wheelGeo.rotateZ(Math.PI / 2);
      const fw = new THREE.Mesh(wheelGeo, this.materials.rubber);
      fw.position.set(0, 0.22, -0.65);
      group.add(fw);

      const rw = new THREE.Mesh(wheelGeo, this.materials.rubber);
      rw.position.set(0, 0.22, 0.55);
      group.add(rw);

      // Headlight & Taillight
      const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 8), this.materials.headlight);
      hl.rotateX(Math.PI / 2);
      hl.position.set(0, 0.65, -0.75);
      group.add(hl);

      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.04), this.materials.taillight);
      tl.position.set(0, 0.6, 0.8);
      group.add(tl);
    }

    return {
      group,
      length,
      width,
      height
    };
  }

  spawnAhead(playerS) {
    const inactive = this.vehicles.find(v => !v.active);
    if (!inactive) return;

    // Pick lane and calculate speed based on vehicle type
    const lane = this.lanes[Math.floor(Math.random() * this.lanes.length)];
    let speedKmh = 60;
    if (inactive.type === 'rickshaw') speedKmh = 45 + Math.random() * 15;
    else if (inactive.type === 'truck') speedKmh = 52 + Math.random() * 18;
    else if (inactive.type === 'taxi') speedKmh = 75 + Math.random() * 25;
    else speedKmh = 50 + Math.random() * 20;

    // Spawn 80m to 220m ahead of player
    const spawnDist = 90 + Math.random() * 140;
    let s = (playerS + spawnDist) % this.spline.totalLength;

    // Check distance with already active vehicles to avoid overlaps
    const tooClose = this.activeVehicles.some(v => Math.abs(v.s - s) < 18 && Math.abs(v.d - lane) < 1.5);
    if (tooClose) return;

    inactive.active = true;
    inactive.s = s;
    inactive.d = lane;
    inactive.targetD = lane;
    inactive.speed = speedKmh / 3.6; // m/s
    inactive.hasNearMissed = false;
    inactive.group.visible = true;

    this.activeVehicles.push(inactive);
  }

  update(dt, playerS, playerSpeed) {
    // Keep active vehicle count around 10-14 vehicles
    if (this.activeVehicles.length < 12 && Math.random() < 0.15) {
      this.spawnAhead(playerS);
    }

    const totalLen = this.spline.totalLength;

    for (let i = this.activeVehicles.length - 1; i >= 0; i--) {
      const v = this.activeVehicles[i];

      // Move along road
      v.s = (v.s + v.speed * dt) % totalLen;

      // Gentle lane weaving or lane change logic
      if (Math.abs(v.d - v.targetD) > 0.05) {
        v.d = THREE.MathUtils.lerp(v.d, v.targetD, 1.2 * dt);
      } else if (Math.random() < 0.003) {
        // Occasionally switch lane
        v.targetD = this.lanes[Math.floor(Math.random() * this.lanes.length)];
      }

      // Check distance relative to player for despawning
      let sRel = v.s - playerS;
      if (sRel < -totalLen * 0.5) sRel += totalLen;
      if (sRel > totalLen * 0.5) sRel -= totalLen;

      // Despawn if > 50m behind or > 320m ahead
      if (sRel < -55 || sRel > 320) {
        v.active = false;
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

      // Orientation matching track tangent
      v.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
    }
  }

  getActiveList() {
    return this.activeVehicles;
  }

  reset() {
    for (const v of this.vehicles) {
      v.active = false;
      v.group.visible = false;
      v.hasNearMissed = false;
    }
    this.activeVehicles = [];
  }
}
