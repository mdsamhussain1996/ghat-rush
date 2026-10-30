import * as THREE from 'three';

/**
 * Procedural Low-to-Mid Poly Articulated Motorcycle Rider
 * Supports dynamic inverse lean, knee-out cornering slider, speed tuck, and wheelie posture.
 */
export class Rider {
  constructor(suitColor = '#2b2d42', helmetColor = '#ffffff') {
    this.group = new THREE.Group();
    this.suitColor = suitColor;
    this.helmetColor = helmetColor;

    this.initMeshes();
  }

  initMeshes() {
    const leatherMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.suitColor),
      roughness: 0.65,
      metalness: 0.15
    });

    const helmetMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.helmetColor),
      roughness: 0.25,
      metalness: 0.35
    });

    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.1,
      metalness: 0.9
    });

    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.8
    });

    // 1. Pelvis / Hips (Root of Rider)
    this.hips = new THREE.Group();
    this.hips.position.set(0, 0.72, -0.15); // Seated on saddle
    this.group.add(this.hips);

    const pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.25), leatherMat);
    this.hips.add(pelvisMesh);

    // 2. Torso / Spine (Pivots forward for tuck)
    this.torso = new THREE.Group();
    this.torso.position.set(0, 0.10, 0);
    this.hips.add(this.torso);

    const chestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.24), leatherMat);
    chestMesh.position.set(0, 0.21, 0.04);
    this.torso.add(chestMesh);

    // Back protector / Aerodynamic hump
    const humpMesh = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 4), leatherMat);
    humpMesh.position.set(0, 0.26, -0.12);
    humpMesh.rotation.x = -Math.PI / 3;
    this.torso.add(humpMesh);

    // 3. Head & Helmet (Pivots into turn)
    this.head = new THREE.Group();
    this.head.position.set(0, 0.46, 0.10);
    this.torso.add(this.head);

    const helmetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 10), helmetMat);
    this.head.add(helmetMesh);

    // Helmet aerodynamic mohawk crest (Matches concept art)
    const crestMat = new THREE.MeshStandardMaterial({
      color: 0xff4d29,
      roughness: 0.3,
      metalness: 0.4
    });
    const crestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.22), crestMat);
    crestMesh.position.set(0, 0.16, 0.02);
    this.head.add(crestMesh);

    // Dark aerodynamic visor
    const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.12), visorMat);
    visorMesh.position.set(0, 0.02, 0.12);
    this.head.add(visorMesh);

    // 4. Arms (Clamped to handlebars)
    const armGeo = new THREE.CylinderGeometry(0.065, 0.06, 0.45, 6);
    this.leftArm = new THREE.Mesh(armGeo, leatherMat);
    this.leftArm.position.set(-0.25, 0.28, 0.24);
    this.leftArm.rotation.set(0.65, 0.2, -0.4);
    this.torso.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, leatherMat);
    this.rightArm.position.set(0.25, 0.28, 0.24);
    this.rightArm.rotation.set(0.65, -0.2, 0.4);
    this.torso.add(this.rightArm);

    // 5. Legs & Knee Sliders
    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.16, -0.05, 0.05);
    this.hips.add(this.leftLeg);

    const thighGeo = new THREE.BoxGeometry(0.13, 0.36, 0.14);
    const thighL = new THREE.Mesh(thighGeo, leatherMat);
    thighL.position.set(0, -0.16, 0.1);
    thighL.rotation.x = 0.85;
    this.leftLeg.add(thighL);

    // Knee slider puck
    this.kneeSliderL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 6), bootMat);
    this.kneeSliderL.position.set(-0.08, -0.16, 0.22);
    this.kneeSliderL.rotation.z = Math.PI / 2;
    this.leftLeg.add(this.kneeSliderL);

    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.16, -0.05, 0.05);
    this.hips.add(this.rightLeg);

    const thighR = new THREE.Mesh(thighGeo, leatherMat);
    thighR.position.set(0, -0.16, 0.1);
    thighR.rotation.x = 0.85;
    this.rightLeg.add(thighR);

    this.kneeSliderR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 6), bootMat);
    this.kneeSliderR.position.set(0.08, -0.16, 0.22);
    this.kneeSliderR.rotation.z = Math.PI / 2;
    this.rightLeg.add(this.kneeSliderR);
  }

  updateAnimation(leanAngleRad, speedKmh, isBraking = false, wheelieAngle = 0) {
    const leanRatio = leanAngleRad / (Math.PI / 3.6); // -1 to 1

    // 1. Shift Hips slightly into turn (body hanging off inside)
    this.hips.position.x = leanRatio * 0.08;
    this.hips.rotation.z = -leanRatio * 0.15;

    // 2. Spine Tuck: High speed = lower chest to tank; braking = sit up
    const speedTuck = Math.min(1.0, Math.max(0, (speedKmh - 120) / 160));
    const basePitch = 0.42 + (speedTuck * 0.35) - (isBraking ? 0.35 : 0) - (wheelieAngle * 0.6);
    this.torso.rotation.x = basePitch;

    // 3. Head turns into corner & stays level with horizon
    this.head.rotation.y = -leanRatio * 0.45;
    this.head.rotation.z = -leanAngleRad * 0.55;

    // 4. Knee Out slider: inside leg flares outward
    if (leanRatio < -0.1) {
      // Leaning left -> left knee flares out
      this.leftLeg.rotation.y = -Math.abs(leanRatio) * 0.65;
      this.leftLeg.rotation.z = -Math.abs(leanRatio) * 0.45;
      this.rightLeg.rotation.set(0, 0, 0);
    } else if (leanRatio > 0.1) {
      // Leaning right -> right knee flares out
      this.rightLeg.rotation.y = Math.abs(leanRatio) * 0.65;
      this.rightLeg.rotation.z = Math.abs(leanRatio) * 0.45;
      this.leftLeg.rotation.set(0, 0, 0);
    } else {
      this.leftLeg.rotation.set(0, 0, 0);
      this.rightLeg.rotation.set(0, 0, 0);
    }
  }
}
