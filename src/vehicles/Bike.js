import * as THREE from 'three';
import { Rider } from './Rider.js';
import { audio } from '../core/Audio.js';

/**
 * Bike Entity — 3D Motorcycle Model & Road-Space Arcade Physics
 * Computes speed, lean angle, lateral drift, wheelie, nitro, drafting, and collisions.
 */
export class Bike {
  constructor(scene, spline, bikeStats = {}, isPlayer = true, customPaint = null) {
    this.scene = scene;
    this.spline = spline;
    this.isPlayer = isPlayer;

    // Attributes & Stats
    this.topSpeedKmh = bikeStats.topSpeedKmh || 290;
    this.accelRate = (this.topSpeedKmh / 3.6) / (bikeStats.accelMs || 2.8); // m/s^2
    this.brakeRate = 22.0; // m/s^2
    this.handling = bikeStats.handling || 0.94;
    this.maxLeanRad = 0.87; // ~50 degrees
    this.nitroCapacity = bikeStats.nitroCapacity || 5.0; // seconds
    this.nitro = this.nitroCapacity;
    this.paintColor = customPaint?.color || bikeStats.color || '#ff4d29';

    // Road-Space State
    this.s = 0; // Distance along track (m)
    this.d = 0; // Lateral offset from centerline (m)
    this.speed = 0; // Current speed (m/s)
    this.lean = 0; // Current lean angle (rad)
    this.wheelie = 0; // 0 to 1 wheelie pitch
    this.stoppie = 0; // 0 to 1 stoppie pitch
    this.gear = 1;
    this.rpmRatio = 0.1; // 0 to 1

    // Gameplay States
    this.isNitro = false;
    this.isDrafting = false;
    this.draftTimer = 0;
    this.isSliding = false;
    this.slideAngle = 0;
    this.isCrashed = false;
    this.crashTimer = 0;
    this.nearMissCombo = 0;
    this.comboResetTimer = 0;
    this.lap = 1;
    this.lapStartTime = 0;
    this.totalRaceTime = 0;

    // 3D Object Hierarchy
    this.group = new THREE.Group();
    this.bikeMesh = new THREE.Group();
    this.group.add(this.bikeMesh);

    this.initModel();
    scene.add(this.group);
  }

  initModel() {
    const paintMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.paintColor),
      roughness: 0.28,
      metalness: 0.55
    });

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1f242d,
      roughness: 0.5,
      metalness: 0.8
    });

    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x141416,
      roughness: 0.85
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xdde2ea,
      roughness: 0.15,
      metalness: 0.95
    });

    // 1. Fairing & Fuel Tank
    const fairingGeo = new THREE.BoxGeometry(0.48, 0.52, 1.35);
    this.bodyMesh = new THREE.Mesh(fairingGeo, paintMat);
    this.bodyMesh.position.set(0, 0.62, 0.1);
    this.bikeMesh.add(this.bodyMesh);

    // Front Nose & Windscreen
    const noseGeo = new THREE.ConeGeometry(0.24, 0.65, 4);
    const nose = new THREE.Mesh(noseGeo, paintMat);
    nose.rotation.x = -Math.PI / 2.3;
    nose.position.set(0, 0.76, 0.85);
    this.bikeMesh.add(nose);

    // Dual LED Projector Headlights
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.06), lightMat);
    hl1.position.set(-0.12, 0.72, 1.15);
    const hl2 = hl1.clone();
    hl2.position.set(0.12, 0.72, 1.15);
    this.bikeMesh.add(hl1, hl2);

    // LED Taillight
    this.tailLightMat = new THREE.MeshBasicMaterial({ color: 0xcc1111 });
    this.tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.06), this.tailLightMat);
    this.tailLight.position.set(0, 0.74, -0.78);
    this.bikeMesh.add(this.tailLight);

    // 2. Wheels
    const tireGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.16, 16);
    tireGeo.rotateZ(Math.PI / 2);

    this.frontWheel = new THREE.Mesh(tireGeo, rubberMat);
    this.frontWheel.position.set(0, 0.32, 0.95);
    this.bikeMesh.add(this.frontWheel);

    this.rearWheel = new THREE.Mesh(tireGeo, rubberMat);
    this.rearWheel.position.set(0, 0.32, -0.75);
    this.bikeMesh.add(this.rearWheel);

    // Brake discs
    const discGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.18, 12);
    discGeo.rotateZ(Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, chromeMat);
    this.frontWheel.add(disc);

    // 3. Front Forks & Clip-On Handlebars
    const forkGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.75, 6);
    const forkL = new THREE.Mesh(forkGeo, chromeMat);
    forkL.position.set(-0.14, 0.65, 0.88);
    forkL.rotation.x = -0.32;
    const forkR = forkL.clone();
    forkR.position.x = 0.14;
    this.bikeMesh.add(forkL, forkR);

    // 4. Twin Under-seat Exhausts & Nitro Jet Emitting Points
    const exhaustGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.45, 8);
    exhaustGeo.rotateX(Math.PI / 2);
    const exL = new THREE.Mesh(exhaustGeo, chromeMat);
    exL.position.set(-0.15, 0.52, -0.72);
    const exR = exL.clone();
    exR.position.x = 0.15;
    this.bikeMesh.add(exL, exR);

    // Nitro flame meshes (visible during boost)
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff });
    this.flameL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.65, 4), flameMat);
    this.flameL.rotation.x = Math.PI / 2;
    this.flameL.position.set(-0.15, 0.52, -1.1);
    this.flameL.visible = false;

    this.flameR = this.flameL.clone();
    this.flameR.position.x = 0.15;
    this.bikeMesh.add(this.flameL, this.flameR);

    // 5. Rider (Vibrant racing suit matching bike team color)
    this.rider = new Rider(this.paintColor, '#ffffff');
    this.bikeMesh.add(this.rider.group);
  }

  update(dt, controls, rivalsList = [], trafficList = []) {
    return this.updatePhysics(dt, controls, trafficList, rivalsList);
  }

  updatePhysics(dt, controls, trafficList = [], rivalsList = []) {
    if (this.isCrashed) {
      this.crashTimer -= dt;
      this.speed = Math.max(0, this.speed - 30 * dt);
      if (this.crashTimer <= 0) {
        this.respawnOnRoad();
      }
      this.syncTransform();
      return;
    }

    const maxSpeedMs = (this.topSpeedKmh / 3.6);
    const currentMaxSpeed = this.isNitro ? maxSpeedMs * 1.25 : (this.isDrafting ? maxSpeedMs * 1.08 : maxSpeedMs);

    // 1. Throttle, Brake & Nitro
    this.isNitro = false;
    if (controls.nitro && this.nitro > 0 && controls.throttle > 0) {
      this.isNitro = true;
      this.nitro = Math.max(0, this.nitro - dt);
      if (this.isPlayer) {
        audio.playNitroIgnition();
      }
    } else {
      // Slow passive nitro regeneration
      this.nitro = Math.min(this.nitroCapacity, this.nitro + 0.15 * dt);
    }

    // Flames visual
    this.flameL.visible = this.isNitro;
    this.flameR.visible = this.isNitro;
    if (this.isNitro) {
      const fScale = 0.8 + Math.random() * 0.5;
      this.flameL.scale.set(fScale, fScale, fScale);
      this.flameR.scale.set(fScale, fScale, fScale);
    }

    // Acceleration & Drag
    let forwardAccel = 0;
    if (controls.throttle > 0) {
      const powerFactor = Math.max(0.2, 1 - (this.speed / currentMaxSpeed));
      forwardAccel = this.accelRate * controls.throttle * powerFactor * (this.isNitro ? 1.7 : 1.0);
    }

    let brakeDecel = 0;
    if (controls.brake > 0) {
      brakeDecel = this.brakeRate * controls.brake;
    }

    // Tail light brightness on brake
    this.tailLightMat.color.setHex(controls.brake > 0 ? 0xff0022 : 0xaa1111);

    const aeroDrag = 0.0018 * (this.speed * this.speed);
    const netAccel = forwardAccel - brakeDecel - aeroDrag;
    this.speed = Math.max(0, Math.min(currentMaxSpeed, this.speed + netAccel * dt));

    // 2. Wheelie & Stoppie
    if (controls.wheelie && this.speed > 8 && !this.isSliding) {
      this.wheelie = Math.min(1.0, this.wheelie + 3.0 * dt);
      this.nitro = Math.min(this.nitroCapacity, this.nitro + 0.3 * dt); // Wheelie charges nitro!
    } else {
      this.wheelie = Math.max(0, this.wheelie - 4.5 * dt);
    }

    if (controls.brake > 0.6 && this.speed > 15) {
      this.stoppie = Math.min(0.45, this.stoppie + 2.5 * dt);
    } else {
      this.stoppie = Math.max(0, this.stoppie - 4.0 * dt);
    }

    // 3. Steering & Lean Dynamics
    // Higher speed = wider turning radius (lean sensitivity scales inversely with speed)
    const steerSpeedFactor = Math.max(0.4, Math.min(1.2, 28 / Math.max(8, this.speed)));
    const targetLean = -controls.steer * this.maxLeanRad * this.handling * (1 - this.wheelie * 0.65);
    const leanSpeed = 6.5;
    this.lean = THREE.MathUtils.lerp(this.lean, targetLean, Math.min(1, leanSpeed * dt));

    // Lateral displacement along road space: d
    const lateralSpeed = (-this.lean / this.maxLeanRad) * (this.speed * 0.42);
    this.d += lateralSpeed * dt;

    // Road Edge Limits & Guardrail collision
    const halfWidth = (this.spline.trackData?.roadWidth || 14) / 2;
    if (Math.abs(this.d) > halfWidth + 0.6) {
      // Hit guardrail!
      if (this.speed > 35) {
        this.triggerCrash();
        return;
      } else {
        // Minor scrape & bounce
        this.d = Math.sign(this.d) * (halfWidth + 0.5);
        this.speed *= 0.75;
      }
    }

    // 4. Advance distance along track
    const prevS = this.s;
    this.s = (this.s + this.speed * dt);
    if (this.s >= this.spline.totalLength) {
      this.s -= this.spline.totalLength;
      this.lap++;
    }

    // 5. RPM & Gear Simulation
    this.updateGears(dt);

    // 6. Drafting & Slipstream Detection
    this.checkDrafting(rivalsList, trafficList);

    // 7. Near Miss Detection (Vehicles within 0.6m pass distance at speed)
    this.checkNearMisses(trafficList);

    // 8. Collisions with Traffic Vehicles
    this.checkTrafficCollisions(trafficList);

    // 9. Animate Rider
    this.rider.updateAnimation(this.lean, this.getSpeedKmh(), controls.brake > 0.2, this.wheelie);

    // Spin wheels
    const wheelRot = (this.speed / 0.32) * dt;
    this.frontWheel.rotation.x += wheelRot;
    this.rearWheel.rotation.x += wheelRot;

    // Audio update for player
    if (this.isPlayer) {
      audio.updateEngine(this.rpmRatio, this.getSpeedKmh(), this.isNitro);
    }

    this.syncTransform();
  }

  updateGears(dt) {
    const speedKmh = this.getSpeedKmh();
    const gearMaxSpeeds = [0, 65, 115, 165, 215, 260, 340];
    let targetGear = 1;

    for (let g = 1; g < gearMaxSpeeds.length; g++) {
      if (speedKmh > gearMaxSpeeds[g - 1]) targetGear = g;
    }

    if (targetGear !== this.gear) {
      this.gear = targetGear;
      if (this.isPlayer) audio.playGearShift();
    }

    const minS = gearMaxSpeeds[this.gear - 1] || 0;
    const maxS = gearMaxSpeeds[this.gear] || 320;
    this.rpmRatio = Math.max(0.15, Math.min(1.0, (speedKmh - minS) / (maxS - minS)));
  }

  checkDrafting(rivals, traffic) {
    this.isDrafting = false;
    const allAhead = [...rivals, ...traffic];

    for (const other of allAhead) {
      if (other === this) continue;
      const sDist = other.s - this.s;
      // 5 to 16 meters ahead in the same lane
      if (sDist > 4 && sDist < 16 && Math.abs(other.d - this.d) < 1.6) {
        this.isDrafting = true;
        this.draftTimer += 0.016;
        this.nitro = Math.min(this.nitroCapacity, this.nitro + 0.25 * 0.016);
        break;
      }
    }
  }

  checkNearMisses(trafficList) {
    if (this.comboResetTimer > 0) {
      this.comboResetTimer -= 0.016;
      if (this.comboResetTimer <= 0) this.nearMissCombo = 0;
    }

    for (const v of trafficList) {
      if (v.hasNearMissed) continue;
      const sDist = Math.abs(v.s - this.s);
      const dDist = Math.abs(v.d - this.d);

      // Pass within 0.8m laterally, alongside longitudinally, at > 100 km/h
      if (sDist < 2.8 && dDist < 1.8 && this.getSpeedKmh() > 95) {
        v.hasNearMissed = true;
        this.nearMissCombo++;
        this.comboResetTimer = 2.5;
        this.nitro = Math.min(this.nitroCapacity, this.nitro + 1.2);

        if (this.isPlayer) {
          audio.playNearMiss();
          if (this.onNearMiss) {
            this.onNearMiss(this.nearMissCombo);
          }
        }
      }
    }
  }

  checkTrafficCollisions(trafficList) {
    for (const v of trafficList) {
      const sDist = Math.abs(v.s - this.s);
      const dDist = Math.abs(v.d - this.d);

      // Bounding box overlap
      if (sDist < (v.length || 3.8) / 2 + 1.1 && dDist < (v.width || 1.8) / 2 + 0.45) {
        if (this.speed > 28) {
          this.triggerCrash();
        } else {
          // Slow glance
          this.speed *= 0.5;
          this.d += Math.sign(this.d - v.d) * 1.5;
        }
        break;
      }
    }
  }

  triggerCrash() {
    if (this.isCrashed) return;
    this.isCrashed = true;
    this.crashTimer = 1.8;
    this.nearMissCombo = 0;

    if (this.isPlayer) {
      audio.playCrash();
    }

    // Pitch & roll bike in crash tumble
    this.bikeMesh.rotation.set(0.6, 1.2, 1.5);
    this.bikeMesh.position.y = 0.2;
  }

  respawnOnRoad() {
    this.isCrashed = false;
    this.speed = 15.0; // Rolling rolling start
    this.bikeMesh.rotation.set(0, 0, 0);
    this.bikeMesh.position.set(0, 0, 0);
    this.wheelie = 0;
    this.stoppie = 0;
    this.lean = 0;
  }

  syncTransform() {
    const frame = this.spline.getFrameAtDistance(this.s);

    // Position in world space: centerline + lateral binormal * d
    const worldPos = frame.position.clone()
      .addScaledVector(frame.binormal, this.d)
      .addScaledVector(frame.normal, 0.05);
    this.group.position.copy(worldPos);

    // Orientation: align with track Frenet frame
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);

    // Apply lean, wheelie, and stoppie to bikeMesh
    if (!this.isCrashed) {
      this.bikeMesh.rotation.z = this.lean;
      this.bikeMesh.rotation.x = -this.wheelie * 0.48 + this.stoppie * 0.25;
      this.bikeMesh.position.y = this.wheelie * 0.25;
    }
  }

  getSpeedKmh() {
    return Math.round(this.speed * 3.6);
  }
}
