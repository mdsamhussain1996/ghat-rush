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

  update(dt, playerBike) {
    if (!playerBike || !playerBike.group) return;

    const frame = this.spline.getFrameAtDistance(playerBike.s);
    const bikePos = playerBike.group.position;
    const speed = playerBike.speed; // m/s
    const speedKmh = playerBike.getSpeedKmh();
    const isNitro = playerBike.isNitro;

    // 1. Dynamic FOV
    const speedRatio = Math.min(1.0, speedKmh / 300);
    const targetFov = this.baseFov + (speedRatio * 12) + (isNitro ? 8 : 0);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 6.0 * dt);
    this.camera.updateProjectionMatrix();

    // 2. Camera offsets relative to bike in road space
    let offsetBack = 4.2;
    let offsetUp = 1.85;
    let lookAheadDist = 14.0;
    let lookUpDist = 0.55;

    if (this.mode === 'close') {
      offsetBack = 3.2;
      offsetUp = 1.45;
      lookAheadDist = 12.0;
      lookUpDist = 0.45;
    } else if (this.mode === 'helmet') {
      offsetBack = -0.15;
      offsetUp = 1.25;
      lookAheadDist = 22.0;
      lookUpDist = 0.8;
    }

    // High speed pulls camera slightly further back for sense of speed
    offsetBack += speedRatio * 0.9;

    // Target Camera Position: behind bike along Frenet tangent
    const targetPos = bikePos.clone()
      .addScaledVector(frame.tangent, -offsetBack)
      .addScaledVector(frame.normal, offsetUp)
      .addScaledVector(frame.binormal, playerBike.d * 0.15); // subtle lateral lag

    // Target Look-At: road ahead of the bike
    const targetLookAt = bikePos.clone()
      .addScaledVector(frame.tangent, lookAheadDist)
      .addScaledVector(frame.normal, lookUpDist);

    // 3. Camera Shake
    this.shakeIntensity = Math.max(0, (speedKmh - 190) / 130) * 0.045 + (playerBike.isSliding ? 0.06 : 0);
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

    // Roll slightly with bike lean (subtle 15% roll)
    if (this.mode !== 'helmet') {
      this.camera.rotateZ(playerBike.lean * 0.14);
    }
  }

  reset(playerBike) {
    if (!playerBike) return;
    this.currentPos.set(0, 0, 0);
    this.currentLookAt.set(0, 0, 0);
  }
}
