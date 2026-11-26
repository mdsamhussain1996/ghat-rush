import * as THREE from 'three';
import { Rider } from './Rider.js';
import { audio } from '../core/Audio.js';
import { BikePhysics } from '../core/Physics.js';
import { mergeColoredParts, mergePlainParts } from '../render/GeomMerge.js';

// Shared static resources across AI rivals to minimize draw calls & shader switches
let SHARED_RIVAL_PAINT_MAT = null;
let SHARED_RIVAL_DETAIL_MAT = null;
let SHARED_RIVAL_WHEEL_MAT = null;
let SHARED_RIVAL_TAILLIGHT_MAT = null;
let SHARED_BIKE_FLAME_GEO = null;
let SHARED_BIKE_FLAME_MAT = null;

/**
 * Bike Entity — 3D Motorcycle Model & Road-Space Arcade Physics
 * Features:
 * - High-fidelity original procedural bike geometry with articulated steerable front fork/handlebar group
 * - Controller-synchronized lean/bank angle, front wheel steering, acceleration squat, and brake nose-dive
 * - Realistic arcade ghat road physics via BikePhysics (non-linear torque curve, engine braking, slope gravity,
 *   centrifugal cornering drift, shoulder off-road resistance, and smooth guardrail deflection)
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
    this.brakeRate = bikeStats.brakeRate || 22.0; // m/s^2
    this.handling = bikeStats.handling || 0.94;
    this.tyreGripBonus = bikeStats.tyreGripBonus || 1.0;
    this.surfaceGrip = 1.0;
    this.gripDemandRatio = 0;
    this.maxLeanRad = 0.87; // ~50 degrees
    this.nitroCapacity = bikeStats.nitroCapacity || 5.0; // seconds
    this.nitro = this.nitroCapacity;
    this.paintColor = customPaint?.color || bikeStats.color || '#ff4d29';

    // Road-Space State
    this.s = 0; // Distance along track (m)
    this.d = 0; // Lateral offset from centerline (m)
    this.speed = 0; // Current speed (m/s)
    this.lateralVel = 0;
    this.longitudinalAccel = 0;
    this.lean = 0; // Current lean angle (rad)
    this.steerAngle = 0; // Visual front fork / handlebar steer angle (rad)
    this.accelSquat = 0; // Rear squat pitch under hard acceleration (rad)
    this.brakeDive = 0; // Forward nose-dive pitch under braking (rad)
    this.wheelie = 0; // 0 to 1 wheelie pitch
    this.stoppie = 0; // 0 to 1 stoppie pitch
    this.gear = 1;
    this.rpmRatio = 0.1; // 0 to 1

    // Steering Smoothing & Rail Assist
    this.steerSmoothed = 0;
    this.steerTapCount = 0;
    this.lastSteerSign = 0;
    this.preCrashSpeed = 0;
    this.onRespawn = null;
    this.onRailScrape = null;
    this.railScrapeCooldown = 0;
    this.wobbleTimer = 0;
    this.wobbleMagnitude = 0;
    this.ghostTimer = 0; // Invulnerability timer after respawn

    // Gameplay States
    this.isNitro = false;
    this.wasNitro = false;
    this.isDrafting = false;
    this.draftTimer = 0;
    this.draftPersistTimer = 0; // Must persist 0.5s before bonus triggers
    this.isSliding = false;
    this.isDrifting = false;
    this.isOffRoad = false;
    this.offRoadFactor = 0;
    this.isWrongWay = false;
    this.slideAngle = 0;
    this.isCrashed = false;
    this.crashTimer = 0;
    this.crashDuration = 2.0;
    this.crashType = 'rail';
    this.crashSlideDir = 0;
    this.onCrash = null;
    this.nearMissCombo = 0;
    this.comboResetTimer = 0;
    this.lap = 1;
    this.lapStartTime = 0;
    this.totalRaceTime = 0;
    this.topSpeedReachedKmh = 0;
    this.totalDraftSeconds = 0;
    this.currentNitroChain = 0;
    this.maxNitroChain = 0;
    this.didFullNitroDrain = false;
    this._nitroPeakAtChainStart = 0;
    this.hadCrashThisLap = false;
    this.cleanLapsCount = 0;
    this.cleanMeters = 0;

    // Visual effect states
    this.brakeGlow = 0;

    // 3D Object Hierarchy
    this.group = new THREE.Group();
    this.bikeMesh = new THREE.Group();
    this.group.add(this.bikeMesh);

    this.initModel();
    if (scene) scene.add(this.group);
  }

  initModel() {
    if (!SHARED_RIVAL_PAINT_MAT) {
      SHARED_RIVAL_PAINT_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.65 });
    }
    if (!SHARED_RIVAL_DETAIL_MAT) {
      SHARED_RIVAL_DETAIL_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.78 });
    }
    if (!SHARED_RIVAL_WHEEL_MAT) {
      SHARED_RIVAL_WHEEL_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.2 });
    }
    if (!SHARED_RIVAL_TAILLIGHT_MAT) {
      SHARED_RIVAL_TAILLIGHT_MAT = new THREE.MeshBasicMaterial({ color: 0xff1744 });
    }
    if (!SHARED_BIKE_FLAME_GEO) {
      SHARED_BIKE_FLAME_GEO = new THREE.ConeGeometry(0.09, 0.75, 5);
      SHARED_BIKE_FLAME_GEO.rotateX(Math.PI / 2);
      SHARED_BIKE_FLAME_MAT = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    }

    this.paintMat = this.isPlayer
      ? new THREE.MeshStandardMaterial({
          color: new THREE.Color(this.paintColor),
          roughness: 0.22,
          metalness: 0.65
        })
      : null;

    const detailMat = this.isPlayer
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.78 })
      : SHARED_RIVAL_DETAIL_MAT;

    const wheelMat = this.isPlayer
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.2 })
      : SHARED_RIVAL_WHEEL_MAT;

    this.brakeDiscMat = this.isPlayer
      ? new THREE.MeshStandardMaterial({
          color: 0xaaaaaa,
          roughness: 0.35,
          metalness: 0.90,
          emissive: new THREE.Color(0x000000),
          emissiveIntensity: 0
        })
      : null;

    // 1. Merged Paintable Bodywork (Fairing + Tank + Front Nose) -> 1 draw call
    const fairingG = new THREE.BoxGeometry(0.50, 0.54, 1.40);
    const noseG = new THREE.ConeGeometry(0.26, 0.70, 5);
    const bodyParts = [
      { geo: fairingG, color: this.paintColor, pos: [0, 0.64, 0.05] },
      { geo: noseG, color: this.paintColor, pos: [0, 0.78, 0.88], rot: [-Math.PI / 2.3, 0, 0] }
    ];
    const bodyGeo = this.isPlayer ? mergePlainParts(bodyParts) : mergeColoredParts(bodyParts);
    fairingG.dispose();
    noseG.dispose();
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.isPlayer ? this.paintMat : SHARED_RIVAL_PAINT_MAT);
    this.bodyMesh.castShadow = true;
    this.bikeMesh.add(this.bodyMesh);

    // 2. Chassis & Steerable Front Assembly
    const screenG = new THREE.BoxGeometry(0.32, 0.26, 0.04);
    const hlG = new THREE.BoxGeometry(0.12, 0.06, 0.06);
    const plateG = new THREE.BoxGeometry(0.18, 0.14, 0.02);
    const calG = new THREE.BoxGeometry(0.08, 0.12, 0.10);
    const forkG = new THREE.CylinderGeometry(0.032, 0.032, 0.78, 6);
    const stanchG = new THREE.CylinderGeometry(0.024, 0.024, 0.40, 6);
    const barG = new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6);
    const stemG = new THREE.CylinderGeometry(0.01, 0.01, 0.16, 4);
    const mirrorG = new THREE.BoxGeometry(0.10, 0.06, 0.03);
    const exhG = new THREE.CylinderGeometry(0.05, 0.065, 0.48, 6);

    // Pivot for front steering head at z = 0.78
    const pivotZ = 0.78;
    this.steerGroup = new THREE.Group();
    this.steerGroup.position.set(0, 0, pivotZ);
    this.bikeMesh.add(this.steerGroup);

    if (this.isPlayer) {
      // Player bike separates fixed chassis details from steerable handlebars/forks/mirrors
      const fixedDetailGeo = mergeColoredParts([
        { geo: screenG, color: 0x112233, pos: [0, 0.94, 0.72], rot: [-Math.PI / 3.0, 0, 0] },
        { geo: hlG, color: 0xffffff, pos: [-0.13, 0.74, 1.20] },
        { geo: hlG, color: 0xffffff, pos: [0.13, 0.74, 1.20] },
        { geo: plateG, color: 0xffffff, pos: [0, 0.82, 1.05], rot: [-Math.PI / 4, 0, 0] },
        { geo: exhG, color: 0x4876a8, pos: [-0.15, 0.52, -0.74], rot: [Math.PI / 2, 0, 0] },
        { geo: exhG, color: 0x4876a8, pos: [0.15, 0.52, -0.74], rot: [Math.PI / 2, 0, 0] }
      ]);
      this.bikeMesh.add(new THREE.Mesh(fixedDetailGeo, detailMat));

      const steerDetailGeo = mergeColoredParts([
        { geo: calG, color: 0xd4af37, pos: [0.10, 0.38, 0.86 - pivotZ] },
        { geo: forkG, color: 0xd4af37, pos: [-0.14, 0.64, 0.88 - pivotZ], rot: [-0.32, 0, 0] },
        { geo: forkG, color: 0xd4af37, pos: [0.14, 0.64, 0.88 - pivotZ], rot: [-0.32, 0, 0] },
        { geo: stanchG, color: 0xdde4ed, pos: [-0.14, 0.44, 0.94 - pivotZ], rot: [-0.32, 0, 0] },
        { geo: stanchG, color: 0xdde4ed, pos: [0.14, 0.44, 0.94 - pivotZ], rot: [-0.32, 0, 0] },
        { geo: barG, color: 0x1f232b, pos: [0, 0.90, 0.65 - pivotZ], rot: [0, 0, Math.PI / 2] },
        { geo: stemG, color: 0x1f232b, pos: [-0.30, 0.94, 0.68 - pivotZ], rot: [0, 0, -0.45] },
        { geo: stemG, color: 0x1f232b, pos: [0.30, 0.94, 0.68 - pivotZ], rot: [0, 0, 0.45] },
        { geo: mirrorG, color: 0x1f232b, pos: [-0.36, 1.00, 0.68 - pivotZ] },
        { geo: mirrorG, color: 0x1f232b, pos: [0.36, 1.00, 0.68 - pivotZ] }
      ]);
      this.steerHardwareMesh = new THREE.Mesh(steerDetailGeo, detailMat);
      this.steerGroup.add(this.steerHardwareMesh);
    } else {
      // Rivals merge all hardware into 1 draw call while still steering their front wheel via steerGroup
      const detailGeo = mergeColoredParts([
        { geo: screenG, color: 0x112233, pos: [0, 0.94, 0.72], rot: [-Math.PI / 3.0, 0, 0] },
        { geo: hlG, color: 0xffffff, pos: [-0.13, 0.74, 1.20] },
        { geo: hlG, color: 0xffffff, pos: [0.13, 0.74, 1.20] },
        { geo: plateG, color: 0xffffff, pos: [0, 0.82, 1.05], rot: [-Math.PI / 4, 0, 0] },
        { geo: calG, color: 0xd4af37, pos: [0.10, 0.38, 0.86] },
        { geo: forkG, color: 0xd4af37, pos: [-0.14, 0.64, 0.88], rot: [-0.32, 0, 0] },
        { geo: forkG, color: 0xd4af37, pos: [0.14, 0.64, 0.88], rot: [-0.32, 0, 0] },
        { geo: stanchG, color: 0xdde4ed, pos: [-0.14, 0.44, 0.94], rot: [-0.32, 0, 0] },
        { geo: stanchG, color: 0xdde4ed, pos: [0.14, 0.44, 0.94], rot: [-0.32, 0, 0] },
        { geo: barG, color: 0x1f232b, pos: [0, 0.90, 0.65], rot: [0, 0, Math.PI / 2] },
        { geo: stemG, color: 0x1f232b, pos: [-0.30, 0.94, 0.68], rot: [0, 0, -0.45] },
        { geo: stemG, color: 0x1f232b, pos: [0.30, 0.94, 0.68], rot: [0, 0, 0.45] },
        { geo: mirrorG, color: 0x1f232b, pos: [-0.36, 1.00, 0.68] },
        { geo: mirrorG, color: 0x1f232b, pos: [0.36, 1.00, 0.68] },
        { geo: exhG, color: 0x4876a8, pos: [-0.15, 0.52, -0.74], rot: [Math.PI / 2, 0, 0] },
        { geo: exhG, color: 0x4876a8, pos: [0.15, 0.52, -0.74], rot: [Math.PI / 2, 0, 0] }
      ]);
      this.bikeMesh.add(new THREE.Mesh(detailGeo, detailMat));
    }
    [screenG, hlG, plateG, calG, forkG, stanchG, barG, stemG, mirrorG, exhG].forEach(g => g.dispose());

    // Taillight bar
    this.tailLightMat = this.isPlayer ? new THREE.MeshBasicMaterial({ color: 0xff1744 }) : null;
    this.tailLight = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.09, 0.06),
      this.isPlayer ? this.tailLightMat : SHARED_RIVAL_TAILLIGHT_MAT
    );
    this.tailLight.position.set(0, 0.76, -0.76);
    this.bikeMesh.add(this.tailLight);

    // 3. Merged Wheels (Tyre + Alloy Rim -> 1 draw call per wheel)
    const tireG = new THREE.CylinderGeometry(0.32, 0.32, 0.16, 12);
    const rimG = new THREE.CylinderGeometry(0.22, 0.22, 0.17, 8);
    const wheelGeo = mergeColoredParts([
      { geo: tireG, color: 0x161719, rot: [0, 0, Math.PI / 2] },
      { geo: rimG, color: 0x22262e, rot: [0, 0, Math.PI / 2] }
    ]);
    tireG.dispose();
    rimG.dispose();

    this.frontWheel = new THREE.Mesh(wheelGeo, wheelMat);
    this.frontWheel.position.set(0, 0.32, 0.95 - pivotZ);
    this.frontWheel.castShadow = this.isPlayer;
    this.steerGroup.add(this.frontWheel);

    this.rearWheel = new THREE.Mesh(wheelGeo, wheelMat);
    this.rearWheel.position.set(0, 0.32, -0.75);
    this.rearWheel.castShadow = this.isPlayer;
    this.bikeMesh.add(this.rearWheel);

    if (this.isPlayer) {
      const discGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.19, 10);
      discGeo.rotateZ(Math.PI / 2);
      this.frontDisc = new THREE.Mesh(discGeo, this.brakeDiscMat);
      this.frontWheel.add(this.frontDisc);
    }

    // 4. Nitro flame jets (hidden unless isNitro)
    this.flameL = new THREE.Mesh(SHARED_BIKE_FLAME_GEO, SHARED_BIKE_FLAME_MAT);
    this.flameL.position.set(-0.15, 0.52, -1.15);
    this.flameL.visible = false;

    this.flameR = new THREE.Mesh(SHARED_BIKE_FLAME_GEO, SHARED_BIKE_FLAME_MAT);
    this.flameR.position.set(0.15, 0.52, -1.15);
    this.flameR.visible = false;
    this.bikeMesh.add(this.flameL, this.flameR);

    // 5. Rider Model (Merged limbs; rivals share suit vertex-color material)
    this.rider = new Rider(this.paintColor, '#ffffff', !this.isPlayer);
    this.bikeMesh.add(this.rider.group);

    // Cache unique per-bike material references for ghost fading
    const sharedSet = new Set([
      SHARED_RIVAL_PAINT_MAT,
      SHARED_RIVAL_DETAIL_MAT,
      SHARED_RIVAL_WHEEL_MAT,
      SHARED_RIVAL_TAILLIGHT_MAT,
      SHARED_BIKE_FLAME_MAT
    ]);
    this.ghostMaterials = [];
    const seenMats = new Set();
    this.bikeMesh.traverse(child => {
      if (child.isMesh && child.material && !seenMats.has(child.material) && !sharedSet.has(child.material) && !child.material._isSharedRider) {
        seenMats.add(child.material);
        if (this.isPlayer || child.material === this.paintMat || child.material === this.tailLightMat) {
          this.ghostMaterials.push({
            mat: child.material,
            baseTransparent: !!child.material.transparent,
            baseOpacity: child.material.opacity !== undefined ? child.material.opacity : 1.0
          });
        }
      }
    });
  }

  enterGhostMode(duration = 1.5) {
    this.ghostTimer = duration;
    if (!this.ghostMaterials) return;
    for (const entry of this.ghostMaterials) {
      entry.mat.transparent = true;
    }
  }

  exitGhostMode() {
    this.ghostTimer = 0;
    if (!this.ghostMaterials) return;
    for (const entry of this.ghostMaterials) {
      entry.mat.transparent = entry.baseTransparent;
      entry.mat.opacity = entry.baseOpacity;
    }
  }

  update(dt, controls, rivalsList = [], trafficList = []) {
    return this.updatePhysics(dt, controls, trafficList, rivalsList);
  }

  updatePhysics(rawDt, controls, trafficList = [], rivalsList = []) {
    const dt = BikePhysics.clampDt(rawDt);

    if (this.railScrapeCooldown > 0) {
      this.railScrapeCooldown = Math.max(0, this.railScrapeCooldown - dt);
    }

    // 0. Crash recovery state
    if (this.isCrashed) {
      this.crashTimer -= dt;
      const elapsed = Math.max(0, this.crashDuration - this.crashTimer);
      this.speed = Math.max(0, this.speed - (this.crashType === 'traffic' ? 16 : 24) * dt);

      // Slide forward along track during tumble
      this.s += this.speed * 0.45 * dt;
      if (this.s >= this.spline.totalLength) {
        this.s -= this.spline.totalLength;
        this.lap++;
      }

      const halfWidth = (this.spline.trackData?.roadWidth || 14) / 2;
      if (this.crashType === 'traffic') {
        this.d += this.crashSlideDir * dt;
        this.d = THREE.MathUtils.clamp(this.d, -halfWidth + 0.55, halfWidth - 0.55);
        this.bikeMesh.rotation.set(0.35 + elapsed * 1.4, elapsed * 1.8, 1.35);
      } else {
        this.d = Math.sign(this.d || 1) * (halfWidth - 0.45);
        this.bikeMesh.rotation.set(0.4, 0.8, 1.4);
      }
      this.bikeMesh.position.y = 0.14;
      this.rider.updateCrashPose(elapsed, this.crashType);

      if (this.crashTimer <= 0) {
        this.respawnOnRoad(trafficList);
      }
      this.syncTransform();
      return;
    }

    // Ghost invulnerability timer
    if (this.ghostTimer > 0) {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) {
        this.exitGhostMode();
      } else if (this.ghostMaterials) {
        const flash = Math.sin(this.ghostTimer * 24) > 0;
        const targetOp = flash ? 0.35 : 0.85;
        for (const entry of this.ghostMaterials) {
          entry.mat.opacity = Math.min(entry.baseOpacity, targetOp);
        }
      }
    }

    // Scrape wobble decay
    if (this.wobbleTimer > 0) {
      this.wobbleTimer -= dt;
      this.wobbleMagnitude = THREE.MathUtils.lerp(this.wobbleMagnitude, 0, 5.0 * dt);
    }

    // 1. Nitro activation & flames
    const prevNitro = this.isNitro;
    this.isNitro = !!(controls.nitro && this.nitro > 0.1 && this.speed > 10);
    if (this.isNitro && !prevNitro && this.isPlayer) {
      audio.playNitroIgnition();
    }
    this.wasNitro = this.isNitro;

    if (this.isNitro) {
      if (this.currentNitroChain === 0) {
        this._nitroPeakAtChainStart = this.nitro;
      }
      this.currentNitroChain += dt;
      if (this.currentNitroChain > this.maxNitroChain) {
        this.maxNitroChain = this.currentNitroChain;
      }
      this.nitro = Math.max(0, this.nitro - 1.25 * dt);
      if (this.nitro <= 0.15 && this._nitroPeakAtChainStart >= this.nitroCapacity * 0.78) {
        this.didFullNitroDrain = true;
      }
      this.flameL.visible = true;
      this.flameR.visible = true;
      this.flameL.scale.setScalar(0.85 + Math.random() * 0.35);
      this.flameR.scale.setScalar(0.85 + Math.random() * 0.35);
    } else {
      this.currentNitroChain = 0;
      this.flameL.visible = false;
      this.flameR.visible = false;
      this.nitro = Math.min(this.nitroCapacity, this.nitro + 0.12 * dt);
    }

    // Tail light brightness & Brake disc glow
    if (this.tailLightMat) {
      this.tailLightMat.color.setHex(controls.brake > 0 ? 0xff0022 : 0xaa1111);
    }
    if (controls.brake > 0.4 && this.speed > 18) {
      this.brakeGlow = Math.min(1.0, this.brakeGlow + 3.0 * dt);
    } else {
      this.brakeGlow = Math.max(0, this.brakeGlow - 1.5 * dt);
    }
    if (this.brakeDiscMat) {
      this.brakeDiscMat.emissive.setHex(0xff3300);
      this.brakeDiscMat.emissiveIntensity = this.brakeGlow * 1.8;
    }

    // 2. Wheelie & Stoppie
    if (controls.wheelie && this.speed > 8 && !this.isSliding) {
      this.wheelie = Math.min(1.0, this.wheelie + 3.0 * dt);
      this.nitro = Math.min(this.nitroCapacity, this.nitro + 0.35 * dt);
    } else {
      this.wheelie = Math.max(0, this.wheelie - 4.5 * dt);
    }

    if (controls.brake > 0.6 && this.speed > 15) {
      this.stoppie = Math.min(0.45, this.stoppie + 2.5 * dt);
    } else {
      this.stoppie = Math.max(0, this.stoppie - 4.0 * dt);
    }

    // 3. Step Modular Ghat Road Physics (Longitudinal, Slope Gravity, Lateral, Corner Drift, Off-Road, Rail Deflection)
    const frame = this.spline.getFrameAtDistance(this.s);
    const stepResult = BikePhysics.step(this, dt, controls, frame);
    if (stepResult.crashed) {
      return;
    }

    const kmh = this.getSpeedKmh();
    if (kmh > this.topSpeedReachedKmh) this.topSpeedReachedKmh = kmh;

    // 4. Advance distance along track
    if (this.speed > 18) {
      this.cleanMeters += this.speed * dt;
    }
    this.s = (this.s + this.speed * dt);
    if (this.s >= this.spline.totalLength) {
      this.s -= this.spline.totalLength;
      if (!this.hadCrashThisLap) this.cleanLapsCount++;
      this.hadCrashThisLap = false;
      this.lap++;
    }

    // 5. RPM & Gear Simulation
    this.updateGears(dt);

    // 6. Drafting & Slipstream Detection
    this.checkDrafting(rivalsList, trafficList, dt);
    if (this.isDrafting) {
      this.totalDraftSeconds += dt;
    }

    // 7. Near Miss Detection
    this.checkNearMisses(trafficList, dt);

    // 8. Collisions with Traffic Vehicles
    if (this.ghostTimer <= 0) {
      this.checkTrafficCollisions(trafficList);
    }

    // 9. Animate Rider & Spin Wheels
    this.rider.updateAnimation(this.lean, this.getSpeedKmh(), controls.brake > 0.2, this.wheelie);

    const wheelRot = (this.speed / 0.32) * dt;
    this.frontWheel.rotation.x += wheelRot;
    this.rearWheel.rotation.x += wheelRot;

    // 10. Dynamic Audio update for player
    if (this.isPlayer) {
      audio.updateEngine(
        this.rpmRatio,
        this.getSpeedKmh(),
        this.isNitro,
        this.gripDemandRatio || 0,
        this.isDrifting || this.isSliding,
        this.offRoadFactor || 0
      );
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
      const isUpshift = targetGear > this.gear;
      this.gear = targetGear;
      if (this.isPlayer) audio.playGearShift(isUpshift);
    }

    const minS = gearMaxSpeeds[this.gear - 1] || 0;
    const maxS = gearMaxSpeeds[this.gear] || 320;
    this.rpmRatio = Math.max(0.15, Math.min(1.0, (speedKmh - minS) / (maxS - minS)));
  }

  checkDrafting(rivals, traffic, dt = 0.016) {
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

      if (sDist > 4 && sDist < 16 && Math.abs(other.d - this.d) < 1.2) {
        inDraftRange = true;
        break;
      }
    }

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

  checkNearMisses(trafficList, dt = 1 / 60) {
    if (this.comboResetTimer > 0) {
      this.comboResetTimer -= dt;
      if (this.comboResetTimer <= 0) {
        this.comboResetTimer = 0;
        this.nearMissCombo = 0;
      }
    }

    const playerSpeedKmh = this.getSpeedKmh();
    if (playerSpeedKmh < 85) return;

    const totalLen = this.spline.totalLength;
    for (const v of trafficList) {
      if (!v.active || v.hasNearMissed) continue;
      let sDiff = v.s - this.s;
      if (sDiff < -totalLen * 0.5) sDiff += totalLen;
      if (sDiff > totalLen * 0.5) sDiff -= totalLen;
      const sDist = Math.abs(sDiff);
      const vHalfW = (v.width || 1.8) / 2;
      const vHalfL = (v.length || 3.8) / 2;

      const edgeGap = Math.abs(v.d - this.d) - (vHalfW + 0.35);

      if (edgeGap >= 0.05 && edgeGap <= 1.45 && sDist < (vHalfL + 2.2)) {
        v.hasNearMissed = true;
        this.nearMissCombo++;
        this.comboResetTimer = 3.5;
        this.nitro = Math.min(this.nitroCapacity, this.nitro + 1.25);

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
    const totalLen = this.spline.totalLength;
    for (const v of trafficList) {
      if (!v.active) continue;
      let sDiff = v.s - this.s;
      if (sDiff < -totalLen * 0.5) sDiff += totalLen;
      if (sDiff > totalLen * 0.5) sDiff -= totalLen;
      const sDist = Math.abs(sDiff);
      const dDist = Math.abs(v.d - this.d);

      if (sDist < (v.length || 3.8) / 2 + 1.1 && dDist < (v.width || 1.8) / 2 + 0.45) {
        if (this.speed > 28) {
          this.triggerCrash('traffic');
        } else {
          // Smooth deflection on low-speed traffic brush
          this.speed *= 0.55;
          const pushSign = Math.sign(this.d - v.d) || 1;
          this.d += pushSign * 1.4;
          this.wobbleTimer = 0.35;
          this.wobbleMagnitude = 0.14;
          if (this.isPlayer && typeof this.onRailScrape === 'function') {
            this.onRailScrape(0.6);
          }
        }
        break;
      }
    }
  }

  triggerCrash(type = 'rail') {
    if (this.isCrashed || this.ghostTimer > 0) return;
    this.isCrashed = true;
    this.crashType = type === 'traffic' ? 'traffic' : 'rail';
    this.preCrashSpeed = this.speed;
    this.crashDuration = this.crashType === 'traffic' ? 1.65 : 2.0;
    this.crashTimer = this.crashDuration;
    this.nearMissCombo = 0;
    this.isDrafting = false;
    this.draftPersistTimer = 0;
    this.gripDemandRatio = 0;
    this.isSliding = false;
    this.isDrifting = false;
    this.hadCrashThisLap = true;
    this.currentNitroChain = 0;

    const halfWidth = (this.spline.trackData?.roadWidth || 14) / 2;
    if (this.crashType === 'rail') {
      this.d = Math.sign(this.d || 1) * (halfWidth - 0.45);
      this.crashSlideDir = 0;
      this.bikeMesh.rotation.set(0.4, 0.8, 1.4);
    } else {
      this.d = THREE.MathUtils.clamp(this.d, -halfWidth + 0.65, halfWidth - 0.65);
      this.crashSlideDir = (Math.random() - 0.5) * 1.0;
      this.bikeMesh.rotation.set(0.35, 0.25, 1.25);
    }
    this.bikeMesh.position.y = 0.14;
    this.rider.updateCrashPose(0, this.crashType);

    if (this.isPlayer) {
      audio.playCrash();
      if (this.onCrash) this.onCrash(this.crashType);
    }
  }

  respawnOnRoad(trafficList = []) {
    this.isCrashed = false;
    this.enterGhostMode(1.5);
    this.speed = Math.max(16.0, (this.preCrashSpeed || 30.0) * 0.60);

    const lanes = this.spline.getLaneCenters ? this.spline.getLaneCenters() : [-3.5, 0, 3.5];
    const totalLen = this.spline.totalLength;
    const sortedLanes = [...lanes].sort((a, b) => Math.abs(a - this.d) - Math.abs(b - this.d));

    let chosenLane = sortedLanes[0];
    for (const candidate of sortedLanes) {
      const blocked = trafficList.some(v => {
        if (!v.active) return false;
        let sDiff = v.s - this.s;
        if (sDiff < -totalLen * 0.5) sDiff += totalLen;
        if (sDiff > totalLen * 0.5) sDiff -= totalLen;
        return sDiff >= -12 && sDiff <= 45 && Math.abs(v.d - candidate) < 1.8;
      });
      if (!blocked) {
        chosenLane = candidate;
        break;
      }
    }
    this.d = chosenLane;

    this.bikeMesh.rotation.set(0, 0, 0);
    this.bikeMesh.position.set(0, 0, 0);
    this.rider.resetPose();
    this.wheelie = 0;
    this.stoppie = 0;
    this.accelSquat = 0;
    this.brakeDive = 0;
    this.steerAngle = 0;
    this.slideAngle = 0;
    this.lean = 0;
    this.wobbleTimer = 0;

    if (this.onRespawn) {
      this.onRespawn(this.s, 40);
    }
  }

  reset() {
    this.s = 0;
    this.d = 0;
    this.speed = 0;
    this.lateralVel = 0;
    this.longitudinalAccel = 0;
    this.lean = 0;
    this.steerAngle = 0;
    this.accelSquat = 0;
    this.brakeDive = 0;
    this.slideAngle = 0;
    this.wheelie = 0;
    this.stoppie = 0;
    this.gear = 1;
    this.rpmRatio = 0.1;
    this.steerSmoothed = 0;
    this.steerTapCount = 0;
    this.lastSteerSign = 0;
    this.wobbleTimer = 0;
    this.wobbleMagnitude = 0;
    this.exitGhostMode();
    this.isCrashed = false;
    this.crashTimer = 0;
    this.crashType = 'rail';
    this.gripDemandRatio = 0;
    this.topSpeedReachedKmh = 0;
    this.totalDraftSeconds = 0;
    this.currentNitroChain = 0;
    this.maxNitroChain = 0;
    this.didFullNitroDrain = false;
    this._nitroPeakAtChainStart = 0;
    this.hadCrashThisLap = false;
    this.cleanLapsCount = 0;
    this.cleanMeters = 0;
    this.rider.resetPose();
    this.isSliding = false;
    this.isDrifting = false;
    this.isOffRoad = false;
    this.offRoadFactor = 0;
    this.isWrongWay = false;
    this.isNitro = false;
    this.wasNitro = false;
    this.isDrafting = false;
    this.draftTimer = 0;
    this.draftPersistTimer = 0;
    this.nearMissCombo = 0;
    this.comboResetTimer = 0;
    this.lap = 1;
    this.bikeMesh.rotation.set(0, 0, 0);
    this.bikeMesh.position.set(0, 0, 0);
    if (this.steerGroup) {
      this.steerGroup.rotation.set(0, 0, 0);
      this.steerGroup.position.set(0, 0, 0.78);
    }
    this.flameL.visible = false;
    this.flameR.visible = false;
    this.nitro = this.nitroCapacity;
    this.syncTransform();
  }

  setPaintColor(hex) {
    this.paintColor = hex;
    if (this.paintMat) {
      this.paintMat.color.set(hex);
    }
    const colorAttr = this.bodyMesh?.geometry?.getAttribute('color');
    if (colorAttr) {
      const col = new THREE.Color(hex);
      for (let i = 0; i < colorAttr.count; i++) {
        colorAttr.setXYZ(i, col.r, col.g, col.b);
      }
      colorAttr.needsUpdate = true;
    }
  }

  dispose() {
    if (this.scene && this.group) {
      this.scene.remove(this.group);
    }
    const sharedMats = new Set([
      SHARED_RIVAL_PAINT_MAT,
      SHARED_RIVAL_DETAIL_MAT,
      SHARED_RIVAL_WHEEL_MAT,
      SHARED_RIVAL_TAILLIGHT_MAT,
      SHARED_BIKE_FLAME_MAT
    ]);
    const sharedGeos = new Set([SHARED_BIKE_FLAME_GEO]);
    const disposedGeos = new Set();
    const disposedMats = new Set();
    this.group?.traverse((child) => {
      if (child.geometry && !disposedGeos.has(child.geometry) && !sharedGeos.has(child.geometry)) {
        disposedGeos.add(child.geometry);
        child.geometry.dispose();
      }
      if (child.material && !disposedMats.has(child.material) && !sharedMats.has(child.material) && child.material !== this.rider?.material) {
        disposedMats.add(child.material);
        child.material.dispose();
      }
    });
    if (this.rider && !this.rider.shareMaterial) {
      this.rider.material?.dispose();
    }
  }

  syncTransform() {
    if (!this.spline) return;
    const frame = this.spline.getFrameAtDistance(this.s);

    // Position in world space: centerline + lateral binormal * d
    const worldPos = frame.position.clone()
      .addScaledVector(frame.binormal, this.d)
      .addScaledVector(frame.normal, 0.05);
    this.group.position.copy(worldPos);

    // Orientation: align with track Frenet frame
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);

    // Apply lean, dynamic pitch (wheelie + acceleration squat vs stoppie + brake nose-dive),
    // drift yaw, and front fork/handlebar steering rotation
    if (!this.isCrashed) {
      this.bikeMesh.rotation.z = this.lean;
      this.bikeMesh.rotation.y = this.slideAngle || 0;
      const totalPitch = -(this.wheelie * 0.48 + (this.accelSquat || 0))
        + (this.stoppie * 0.25 + (this.brakeDive || 0));
      this.bikeMesh.rotation.x = totalPitch;
      this.bikeMesh.position.y = this.wheelie * 0.25 - (this.brakeDive || 0) * 0.12;

      if (this.steerGroup) {
        this.steerGroup.rotation.y = this.steerAngle || 0;
        // Subtle front fork suspension compression under braking
        this.steerGroup.position.y = -(this.brakeDive || 0) * 0.14;
      }
    }
  }

  getSpeedKmh() {
    return Math.round(this.speed * 3.6);
  }
}
