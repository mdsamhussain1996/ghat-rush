import * as THREE from 'three';

/**
 * CameraRig — Arcade Chase & First-Person Camera Rig
 * Features:
 * - Dynamic chase camera with look-ahead and lean lag
 * - Speed-linked FOV expansion (68° up to 86° on nitro)
 * - Micro camera shake at high speeds (> 200 km/h)
 * - Multiple modes: Chase (default), Close Chase, Helmet/FPV
 */
export class CameraRig {
  constructor(spline) {
    this.spline = spline;
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.2, 2200);

    this.mode = 'chase'; // 'chase', 'close', 'helmet'
    this.modes = ['chase', 'close', 'helmet'];
    this.modeIndex = 0;

    // Smoothed internal vectors
    this.currentPos = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.baseFov = 70;
    this.shakeIntensity = 0;
    this.crashShakeTimer = 0;
    this.crashShakeAmount = 0;
    this.replayCutIndex = -1;
    this.replayTrackCamPos = new THREE.Vector3();
    this.replayForceChase = false;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  cycleMode() {
    this.modeIndex = (this.modeIndex + 1) % this.modes.length;
    this.mode = this.modes[this.modeIndex];
    return this.mode;
  }

  triggerCrashShake(amount = 0.45) {
    this.crashShakeTimer = 0.45;
    this.crashShakeAmount = amount;
  }

  update(dt, playerBike, activeTraffic = []) {
    if (!playerBike || !playerBike.group) return;

    const frame = this.spline.getFrameAtDistance(playerBike.s);
    const bikePos = playerBike.group.position;
    const speed = playerBike.speed; // m/s
    const speedKmh = playerBike.getSpeedKmh();
    const isNitro = playerBike.isNitro;

    // 1. Dynamic FOV
    const speedRatio = Math.min(1.0, speedKmh / 300);
    const targetFov = this.baseFov + (speedRatio * 14) + (isNitro ? 8 : 0);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 6.0 * dt);
    this.camera.updateProjectionMatrix();

    // 2. Camera offsets relative to bike in road space (Matches concept_coast.png)
    let offsetBack = 4.6;
    let offsetUp = 2.05;
    let lookAheadDist = 18.0;
    let lookUpDist = 0.35;

    if (this.mode === 'close') {
      offsetBack = 3.6;
      offsetUp = 1.65;
      lookAheadDist = 14.0;
      lookUpDist = 0.40;
    } else if (this.mode === 'helmet') {
      offsetBack = -0.15;
      offsetUp = 1.25;
      lookAheadDist = 22.0;
      lookUpDist = 0.80;
    }

    // High speed pulls camera slightly further back for sense of speed
    offsetBack += speedRatio * 0.75;

    // Target Camera Position: behind bike along Frenet tangent
    const targetPos = bikePos.clone()
      .addScaledVector(frame.tangent, -offsetBack)
      .addScaledVector(frame.normal, offsetUp)
      .addScaledVector(frame.binormal, playerBike.d * 0.12); // subtle lateral lag

    // Camera Collision Avoidance with Vehicles (Bug A.3: prevent truck clipping into screen)
    if (activeTraffic && activeTraffic.length > 0) {
      for (const v of activeTraffic) {
        if (!v.active || !v.group) continue;
        const vPos = v.group.position;
        const distSq = targetPos.distanceToSquared(vPos);
        if (distSq < 10.0) { // within ~3.16m
          const dist = Math.sqrt(distSq);
          const pushAmount = (3.2 - dist) + 0.4;
          // Pull camera forward towards player bike and up
          const toBike = bikePos.clone().sub(targetPos).normalize();
          targetPos.addScaledVector(toBike, pushAmount * 0.85);
          targetPos.addScaledVector(frame.normal, pushAmount * 0.65);
        }
      }
    }

    // Target Look-At: road ahead of the bike
    const targetLookAt = bikePos.clone()
      .addScaledVector(frame.tangent, lookAheadDist)
      .addScaledVector(frame.normal, lookUpDist);

    // 3. Camera Shake
    if (this.crashShakeTimer > 0) {
      this.crashShakeTimer = Math.max(0, this.crashShakeTimer - dt);
    }
    const crashShake = this.crashShakeTimer > 0
      ? (this.crashShakeTimer / 0.45) * this.crashShakeAmount
      : 0;
    this.shakeIntensity = Math.max(0, (speedKmh - 190) / 130) * 0.045 + (playerBike.isSliding ? 0.06 : 0) + crashShake;
    if (this.shakeIntensity > 0) {
      const shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      const shakeY = (Math.random() - 0.5) * this.shakeIntensity;
      targetPos.x += shakeX;
      targetPos.y += shakeY;
    }

    // 4. Smooth interpolation
    const posLerp = Math.min(1.0, 14.0 * dt);
    const lookLerp = Math.min(1.0, 18.0 * dt);

    if (this.currentPos.lengthSq() === 0) {
      this.currentPos.copy(targetPos);
      this.currentLookAt.copy(targetLookAt);
    } else {
      this.currentPos.lerp(targetPos, posLerp);
      this.currentLookAt.lerp(targetLookAt, lookLerp);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);

    // Roll slightly with bike lean (subtle 14% roll)
    if (this.mode !== 'helmet') {
      this.camera.rotateZ(playerBike.lean * 0.14);
    }
  }

  updateReplay(dt, playerBike, replayTime = 0, activeTraffic = []) {
    if (!playerBike || !playerBike.group || !this.spline) return;

    // Alternate every 3.5 seconds between trackside fly-by camera and chase cam
    const segment = Math.floor(replayTime / 3.5);
    const useTrackside = !this.replayForceChase && (segment % 2 === 0);

    if (useTrackside) {
      if (this.replayCutIndex !== segment) {
        this.replayCutIndex = segment;
        const aheadS = this.spline.wrapDistance(playerBike.s + 65);
        const cutFrame = this.spline.getFrameAtDistance(aheadS);
        const sideSign = (segment % 4 === 0) ? -1 : 1;
        const halfW = (this.spline.trackData?.roadWidth || 14) / 2;
        this.replayTrackCamPos.copy(cutFrame.position)
          .addScaledVector(cutFrame.binormal, sideSign * (halfW + 3.2))
          .addScaledVector(cutFrame.normal, 2.2);
      }
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 54, 6.0 * dt);
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(this.replayTrackCamPos);
      const targetLook = playerBike.group.position.clone().add(new THREE.Vector3(0, 0.9, 0));
      this.currentLookAt.lerp(targetLook, Math.min(1.0, 14.0 * dt));
      this.camera.lookAt(this.currentLookAt);
    } else {
      this.replayCutIndex = -1;
      const savedMode = this.mode;
      this.mode = 'close';
      this.update(dt, playerBike, activeTraffic);
      this.mode = savedMode;
    }
  }

  reset(playerBike) {
    if (!playerBike) return;
    this.currentPos.set(0, 0, 0);
    this.currentLookAt.set(0, 0, 0);
    this.crashShakeTimer = 0;
    this.replayCutIndex = -1;
  }
}
