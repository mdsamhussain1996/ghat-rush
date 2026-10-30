import * as THREE from 'three';
import { Rider } from './Rider.js';
import { audio } from '../core/Audio.js';

/**
 * Bike Entity — 3D Motorcycle Model & Road-Space Arcade Physics
 * Features:
 * - High-fidelity original procedural bike geometry (fairings, alloy rims, brake discs, gold forks, mirrors, heat-tint exhaust)
 * - Speed-sensitive steering with 0.15s smooth input ramp
 * - Lane assist against guardrails on normal conditions
 * - Realistic rail scrape wobble vs severe impact crash
 * - Crash containment inside barriers & 1.5s ghost invulnerability
 * - Strict slipstream drafting (speed > 80 km/h, 4-16m ahead, |Δd| < 1.2m, 0.5s persistence)
 * - Brake disc heating glow & exhaust nitro flames
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

    // Steering Smoothing & Rail Assist (Phase 0 Fixes)
    this.steerSmoothed = 0;
    this.wobbleTimer = 0;
    this.wobbleMagnitude = 0;
    this.ghostTimer = 0; // Invulnerability timer after respawn

    // Gameplay States
    this.isNitro = false;
    this.isDrafting = false;
    this.draftTimer = 0;
    this.draftPersistTimer = 0; // Must persist 0.5s before bonus triggers
    this.isSliding = false;
    this.slideAngle = 0;
    this.isCrashed = false;
    this.crashTimer = 0;
    this.nearMissCombo = 0;
    this.comboResetTimer = 0;
    this.lap = 1;
    this.lapStartTime = 0;
    this.totalRaceTime = 0;

    // Visual effect states
    this.brakeGlow = 0;

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
      roughness: 0.22,
      metalness: 0.65
    });

    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1f232b,
      roughness: 0.45,
      metalness: 0.85
    });

    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x161719,
      roughness: 0.90
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xdde4ed,
      roughness: 0.12,
      metalness: 0.95
    });

    const goldForkMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37, // Anodized gold inverted forks
      roughness: 0.25,
      metalness: 0.85
    });

    const titaniumMat = new THREE.MeshStandardMaterial({
      color: 0x4876a8, // Blue/purple heat-tinted titanium exhaust
      roughness: 0.25,
      metalness: 0.88
    });

    this.brakeDiscMat = new THREE.MeshStandardMaterial({
      color: 0xaaaaaa,
      roughness: 0.35,
      metalness: 0.90,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0
    });

    // 1. Aerodynamic Main Fairing & Fuel Tank
    const fairingGeo = new THREE.BoxGeometry(0.50, 0.54, 1.40);
    this.bodyMesh = new THREE.Mesh(fairingGeo, paintMat);
    this.bodyMesh.position.set(0, 0.64, 0.05);
    this.bodyMesh.castShadow = true;
    this.bikeMesh.add(this.bodyMesh);

    // Front Nose Fairing & Windscreen
    const noseGeo = new THREE.ConeGeometry(0.26, 0.70, 5);
    const nose = new THREE.Mesh(noseGeo, paintMat);
    nose.rotation.x = -Math.PI / 2.3;
    nose.position.set(0, 0.78, 0.88);
    nose.castShadow = true;
    this.bikeMesh.add(nose);

    // Smoked Windscreen
    const screenGeo = new THREE.BoxGeometry(0.32, 0.26, 0.04);
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x112233,
      roughness: 0.1,
      metalness: 0.85,
      transparent: true,
      opacity: 0.85
    });
    const windscreen = new THREE.Mesh(screenGeo, screenMat);
    windscreen.rotation.x = -Math.PI / 3.0;
    windscreen.position.set(0, 0.94, 0.72);
    this.bikeMesh.add(windscreen);

    // Twin Projector LED Headlights
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), lightMat);
    hl1.position.set(-0.13, 0.74, 1.20);
    const hl2 = hl1.clone();
    hl2.position.set(0.13, 0.74, 1.20);
    this.bikeMesh.add(hl1, hl2);

    // LED Taillight
    this.tailLightMat = new THREE.MeshBasicMaterial({ color: 0xcc1111 });
    this.tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.06), this.tailLightMat);
    this.tailLight.position.set(0, 0.75, -0.78);
    this.bikeMesh.add(this.tailLight);

    // Number Board Decal ("27" racing board)
    const plateGeo = new THREE.BoxGeometry(0.18, 0.14, 0.02);
    const plateMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const numberPlate = new THREE.Mesh(plateGeo, plateMat);
    numberPlate.position.set(0, 0.82, 1.05);
    numberPlate.rotation.x = -Math.PI / 4;
    this.bikeMesh.add(numberPlate);

    // 2. Wheels (Alloy Rims + Rubber Tyres + Brake Discs)
    const tireGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.16, 18);
    tireGeo.rotateZ(Math.PI / 2);

    this.frontWheel = new THREE.Mesh(tireGeo, rubberMat);
    this.frontWheel.position.set(0, 0.32, 0.95);
    this.frontWheel.castShadow = true;
    this.bikeMesh.add(this.frontWheel);

    this.rearWheel = new THREE.Mesh(tireGeo, rubberMat);
    this.rearWheel.position.set(0, 0.32, -0.75);
    this.rearWheel.castShadow = true;
    this.bikeMesh.add(this.rearWheel);

    // Lightweight 5-Spoke Wheel Rims
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.2 });
    const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.17, 10);
    rimGeo.rotateZ(Math.PI / 2);
    this.frontWheel.add(new THREE.Mesh(rimGeo, rimMat));
    this.rearWheel.add(new THREE.Mesh(rimGeo, rimMat));

    // Perforated Brake Discs with Heat Glow
    const discGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.19, 14);
    discGeo.rotateZ(Math.PI / 2);
    this.frontDisc = new THREE.Mesh(discGeo, this.brakeDiscMat);
    this.frontWheel.add(this.frontDisc);

    // Gold Brake Calipers
    const caliperMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.3 });
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.10), caliperMat);
    caliper.position.set(0.10, 0.38, 0.86);
    this.bikeMesh.add(caliper);

    // 3. Inverted Front Forks & Triple Clamp
    const forkGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.78, 8);
    const forkL = new THREE.Mesh(forkGeo, goldForkMat);
    forkL.position.set(-0.14, 0.64, 0.88);
    forkL.rotation.x = -0.32;
    const forkR = forkL.clone();
    forkR.position.x = 0.14;
    this.bikeMesh.add(forkL, forkR);

    // Chrome Inner Fork Stanchions
    const stanchionGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.40, 8);
    const stanchL = new THREE.Mesh(stanchionGeo, chromeMat);
    stanchL.position.set(-0.14, 0.44, 0.94);
    stanchL.rotation.x = -0.32;
    const stanchR = stanchL.clone();
    stanchR.position.x = 0.14;
    this.bikeMesh.add(stanchL, stanchR);

    // Clip-On Handlebars with Levers & Rear-View Mirrors
    const barGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8);
    barGeo.rotateZ(Math.PI / 2);
    const handlebars = new THREE.Mesh(barGeo, darkMetalMat);
    handlebars.position.set(0, 0.90, 0.65);
    this.bikeMesh.add(handlebars);

    // Aerodynamic Rear-View Mirrors
    for (const side of [-1, 1]) {
      const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 4), darkMetalMat);
      mirrorStem.position.set(side * 0.30, 0.94, 0.68);
      mirrorStem.rotation.z = side * 0.45;
      this.bikeMesh.add(mirrorStem);

      const mirrorHousing = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.03), darkMetalMat);
      mirrorHousing.position.set(side * 0.36, 1.00, 0.68);
      this.bikeMesh.add(mirrorHousing);
    }

    // 4. Titanium Under-Seat Exhausts with Heat-Tint & Nitro Flame Jets
    const exhaustGeo = new THREE.CylinderGeometry(0.05, 0.065, 0.48, 8);
    exhaustGeo.rotateX(Math.PI / 2);
    const exL = new THREE.Mesh(exhaustGeo, titaniumMat);
    exL.position.set(-0.15, 0.52, -0.74);
    const exR = exL.clone();
    exR.position.x = 0.15;
    this.bikeMesh.add(exL, exR);

    // Nitro flame jets (cyan + orange core)
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    this.flameL = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.75, 5), flameMat);
    this.flameL.rotation.x = Math.PI / 2;
    this.flameL.position.set(-0.15, 0.52, -1.15);
    this.flameL.visible = false;

    this.flameR = this.flameL.clone();
    this.flameR.position.x = 0.15;
    this.bikeMesh.add(this.flameL, this.flameR);

    // 5. Rider Model (Articulated team racing suit + aerodynamic helmet)
    this.rider = new Rider(this.paintColor, '#ffffff');
    this.bikeMesh.add(this.rider.group);
  }

  update(dt, controls, rivalsList = [], trafficList = []) {
    return this.updatePhysics(dt, controls, trafficList, rivalsList);
  }

  updatePhysics(dt, controls, trafficList = [], rivalsList = []) {
    // 0. Crash recovery state
    if (this.isCrashed) {
      this.crashTimer -= dt;
      this.speed = Math.max(0, this.speed - 24 * dt);

      // Clamp strictly inside guardrails during tumble/slide
      const halfWidth = (this.spline.trackData?.roadWidth || 14) / 2;
      this.d = Math.max(-halfWidth + 0.4, Math.min(halfWidth - 0.4, this.d));

      if (this.crashTimer <= 0) {
        this.respawnOnRoad();
      }
      this.syncTransform();
      return;
    }

    // Ghost invulnerability timer
    if (this.ghostTimer > 0) {
      this.ghostTimer -= dt;
      // Visual flashing indication
      const flash = Math.sin(this.ghostTimer * 24) > 0;
      this.bikeMesh.traverse(child => {
        if (child.material) {
          child.material.transparent = true;
          child.material.opacity = flash ? 0.35 : 0.85;
        }
      });
      if (this.ghostTimer <= 0) {
        this.bikeMesh.traverse(child => {
          if (child.material) {
            child.material.transparent = false;
            child.material.opacity = 1.0;
          }
        });
      }
    }

    // Scrape wobble decay
    if (this.wobbleTimer > 0) {
      this.wobbleTimer -= dt;
      this.wobbleMagnitude = THREE.MathUtils.lerp(this.wobbleMagnitude, 0, 5.0 * dt);
    }

    // 1. Throttle, Nitro, and Acceleration Dynamics
    this.isNitro = !!(controls.nitro && this.nitro > 0.1 && this.speed > 10);
    if (this.isNitro) {
      this.nitro = Math.max(0, this.nitro - 1.25 * dt);
      this.flameL.visible = true;
      this.flameR.visible = true;
      this.flameL.scale.setScalar(0.85 + Math.random() * 0.35);
      this.flameR.scale.setScalar(0.85 + Math.random() * 0.35);
    } else {
      this.flameL.visible = false;
      this.flameR.visible = false;
      // Gradual natural nitro trickle recharge
      this.nitro = Math.min(this.nitroCapacity, this.nitro + 0.12 * dt);
    }

    const currentMaxSpeed = (this.topSpeedKmh / 3.6) * (this.isNitro ? 1.24 : 1.0) * (this.isDrafting ? 1.08 : 1.0);

    let forwardAccel = 0;
    if (controls.throttle > 0) {
      const powerFactor = Math.max(0.2, 1 - (this.speed / currentMaxSpeed));
      forwardAccel = this.accelRate * controls.throttle * powerFactor * (this.isNitro ? 1.65 : 1.0);
    }

    let brakeDecel = 0;
    if (controls.brake > 0) {
      brakeDecel = this.brakeRate * controls.brake;
    }

    // Tail light brightness on brake
    this.tailLightMat.color.setHex(controls.brake > 0 ? 0xff0022 : 0xaa1111);

    // Brake disc heating glow
    if (controls.brake > 0.4 && this.speed > 18) {
      this.brakeGlow = Math.min(1.0, this.brakeGlow + 3.0 * dt);
    } else {
      this.brakeGlow = Math.max(0, this.brakeGlow - 1.5 * dt);
    }
    this.brakeDiscMat.emissive.setHex(0xff3300);
    this.brakeDiscMat.emissiveIntensity = this.brakeGlow * 1.8;

    const aeroDrag = 0.0018 * (this.speed * this.speed);
    const netAccel = forwardAccel - brakeDecel - aeroDrag;
    this.speed = Math.max(0, Math.min(currentMaxSpeed, this.speed + netAccel * dt));

    // 2. Wheelie & Stoppie
    if (controls.wheelie && this.speed > 8 && !this.isSliding) {
      this.wheelie = Math.min(1.0, this.wheelie + 3.0 * dt);
      this.nitro = Math.min(this.nitroCapacity, this.nitro + 0.35 * dt); // Wheelie bonus
    } else {
      this.wheelie = Math.max(0, this.wheelie - 4.5 * dt);
    }

    if (controls.brake > 0.6 && this.speed > 15) {
      this.stoppie = Math.min(0.45, this.stoppie + 2.5 * dt);
    } else {
      this.stoppie = Math.max(0, this.stoppie - 4.0 * dt);
    }

    // 3. Steering & Lean Dynamics (Phase 0 Fixes: Speed-sensitive & 0.15s smoothing ramp)
    this.steerSmoothed = THREE.MathUtils.lerp(this.steerSmoothed, controls.steer, Math.min(1.0, dt / 0.15));

    const speedRatio = Math.min(1.0, this.speed / (300 / 3.6));
    const maxLean = this.maxLeanRad * (1.0 - speedRatio * 0.36); // Caps from ~50° to ~32° at high speeds
    const leanSpeed = 6.2 * (1.0 - speedRatio * 0.42); // Avoids twitchy instant over-steer
    const targetLean = -this.steerSmoothed * maxLean * this.handling * (1 - this.wheelie * 0.65);

    // Apply wobble from rail scrape if active
    const wobbleOffset = this.wobbleTimer > 0 ? Math.sin(this.wobbleTimer * 28) * this.wobbleMagnitude : 0;
    this.lean = THREE.MathUtils.lerp(this.lean, targetLean + wobbleOffset, Math.min(1, leanSpeed * dt));

    // Lateral displacement along road space: d
    const lateralSpeed = (-this.lean / this.maxLeanRad) * (this.speed * 0.38);
    this.d += lateralSpeed * dt;

    // Road Edge Limits & Light Lane Assist (Phase 0 Fixes)
    const halfWidth = (this.spline.trackData?.roadWidth || 14) / 2;
    const distToRail = halfWidth - Math.abs(this.d);

    // Light lane assist: resists drifting into the rail on bends unless steering hard
    if (distToRail < 1.2 && Math.abs(this.steerSmoothed) < 0.6) {
      this.d -= Math.sign(this.d) * (1.2 - distToRail) * 2.2 * dt;
    }

    // Guardrail Scrape vs Crash Logic
    if (Math.abs(this.d) > halfWidth - 0.2) {
      const impactAngleDeg = Math.atan2(Math.abs(lateralSpeed), Math.max(1, this.speed)) * (180 / Math.PI);
      const isHighSpeedHeadOn = (this.speed * 3.6 > 160 && Math.abs(this.lean) > 0.45);

      if (impactAngleDeg > 25 || isHighSpeedHeadOn) {
        // Severe impact -> Trigger Crash!
        this.triggerCrash();
        return;
      } else {
        // Rail scrape -> Wobble + speed loss + stay inside barrier!
        this.d = Math.sign(this.d) * (halfWidth - 0.28);
        this.speed = Math.max(0, this.speed * (1.0 - 0.20 * dt * 60));
        this.wobbleTimer = 0.45;
        this.wobbleMagnitude = 0.20;
      }
    }

    // 4. Advance distance along track
    this.s = (this.s + this.speed * dt);
    if (this.s >= this.spline.totalLength) {
      this.s -= this.spline.totalLength;
      this.lap++;
    }

    // 5. RPM & Gear Simulation
    this.updateGears(dt);

    // 6. Drafting & Slipstream Detection (Phase 0 Fix: speed > 80 km/h, 4-16m ahead, 0.5s persistence)
    this.checkDrafting(rivalsList, trafficList, dt);

    // 7. Near Miss Detection
    this.checkNearMisses(trafficList);

    // 8. Collisions with Traffic Vehicles (Disabled during ghost invulnerability)
    if (this.ghostTimer <= 0) {
      this.checkTrafficCollisions(trafficList);
    }

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

  checkDrafting(rivals, traffic, dt = 0.016) {
    // Phase 0 Fix: Drafting only occurs at speed > 80 km/h
    if (this.getSpeedKmh() < 80) {
      this.isDrafting = false;
      this.draftPersistTimer = 0;
      return;
    }

    let inDraftRange = false;
    const allAhead = [...rivals, ...traffic];
    const totalLen = this.spline.totalLength;

    for (const other of allAhead) {
      if (other === this) continue;
      let sDist = other.s - this.s;
      if (sDist < -totalLen * 0.5) sDist += totalLen;
      if (sDist > totalLen * 0.5) sDist -= totalLen;

      // 4 to 16 meters ahead in the same lane (|Δd| < 1.2 m)
      if (sDist > 4 && sDist < 16 && Math.abs(other.d - this.d) < 1.2) {
        inDraftRange = true;
        break;
      }
    }

    // Must persist 0.5s before bonus triggers
    if (inDraftRange) {
      this.draftPersistTimer += dt;
      if (this.draftPersistTimer >= 0.5) {
        this.isDrafting = true;
        this.nitro = Math.min(this.nitroCapacity, this.nitro + 0.35 * dt);
      }
    } else {
      this.draftPersistTimer = Math.max(0, this.draftPersistTimer - dt * 2);
      this.isDrafting = false;
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

      // Pass within 0.8m laterally, alongside longitudinally, at > 95 km/h
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
    if (this.isCrashed || this.ghostTimer > 0) return;
    this.isCrashed = true;
    this.crashTimer = 2.0; // 2s tumble & slide before respawn
    this.nearMissCombo = 0;
    this.isDrafting = false;
    this.draftPersistTimer = 0;

    // Keep bike clamped strictly inside road barriers during crash
    const halfWidth = (this.spline.trackData?.roadWidth || 14) / 2;
    this.d = Math.sign(this.d) * (halfWidth - 0.45);

    if (this.isPlayer) {
      audio.playCrash();
    }

    // Pitch & roll bike in crash slide along the rail
    this.bikeMesh.rotation.set(0.4, 0.8, 1.4);
    this.bikeMesh.position.y = 0.15;
  }

  respawnOnRoad() {
    this.isCrashed = false;
    this.ghostTimer = 1.5; // 1.5s ghost invulnerability
    this.speed = 18.0; // Clean rolling restart at ~65 km/h
    this.d = 0; // Centerline of track
    this.bikeMesh.rotation.set(0, 0, 0);
    this.bikeMesh.position.set(0, 0, 0);
    this.wheelie = 0;
    this.stoppie = 0;
    this.lean = 0;
    this.wobbleTimer = 0;
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
