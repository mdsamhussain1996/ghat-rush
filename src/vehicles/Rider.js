import * as THREE from 'three';

/**
 * Procedural Articulated Motorcycle Rider (Phase 1.3 Upgrade)
 * Features:
 * - High-detail leather racing suit with contrasting team racing stripes
 * - Mirrored chrome/smoked visor with environmental reflections
 * - Aerodynamic helmet crest & speed hump
 * - Armored gloves, knee slider pucks, and race boots
 * - Dynamic animation: Speed tuck against fuel tank, sit-up braking airbrake,
 *   head apex look-ahead, and knee-down cornering.
 */
export class Rider {
  constructor(suitColor = '#ff4d29', helmetColor = '#ffffff') {
    this.group = new THREE.Group();
    this.suitColor = suitColor;
    this.helmetColor = helmetColor;

    this.initMeshes();
  }

  initMeshes() {
    const primaryMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.suitColor),
      roughness: 0.45,
      metalness: 0.25
    });

    const whiteStripeMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
      metalness: 0.20
    });

    const darkLeatherMat = new THREE.MeshStandardMaterial({
      color: 0x16181e,
      roughness: 0.70,
      metalness: 0.15
    });

    const helmetMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.helmetColor),
      roughness: 0.18,
      metalness: 0.45
    });

    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x1a2634,
      roughness: 0.04,
      metalness: 0.98
    });

    const sliderMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.1
    });

    // 1. Pelvis / Hips (Seated on motorcycle saddle)
    this.hips = new THREE.Group();
    this.hips.position.set(0, 0.74, -0.16);
    this.group.add(this.hips);

    const pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.20, 0.26), darkLeatherMat);
    pelvisMesh.castShadow = true;
    this.hips.add(pelvisMesh);

    // 2. Torso / Spine (Pivots forward for tuck)
    this.torso = new THREE.Group();
    this.torso.position.set(0, 0.10, 0);
    this.hips.add(this.torso);

    const chestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.44, 0.26), primaryMat);
    chestMesh.position.set(0, 0.22, 0.04);
    chestMesh.castShadow = true;
    this.torso.add(chestMesh);

    // Racing Chest Stripe
    const stripeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.27), whiteStripeMat);
    stripeMesh.position.set(0, 0.22, 0.04);
    this.torso.add(stripeMesh);

    // Aerodynamic Speed Hump on Upper Back
    const humpMesh = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.36, 5), primaryMat);
    humpMesh.position.set(0, 0.28, -0.14);
    humpMesh.rotation.x = -Math.PI / 3.2;
    humpMesh.castShadow = true;
    this.torso.add(humpMesh);

    // Armored Shoulder Pads
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), darkLeatherMat);
      pad.position.set(side * 0.23, 0.38, 0.04);
      this.torso.add(pad);
    }

    // 3. Head & Helmet (Pivots into turn)
    this.head = new THREE.Group();
    this.head.position.set(0, 0.48, 0.10);
    this.torso.add(this.head);

    const helmetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), helmetMat);
    helmetMesh.castShadow = true;
    this.head.add(helmetMesh);

    // Helmet Aerodynamic Fin (Matching concept art)
    const crestMat = new THREE.MeshStandardMaterial({ color: 0xff4d29, roughness: 0.25, metalness: 0.4 });
    const crestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.24), crestMat);
    crestMesh.position.set(0, 0.17, 0.02);
    this.head.add(crestMesh);

    // Mirrored Aerodynamic Visor
    const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.14), visorMat);
    visorMesh.position.set(0, 0.02, 0.13);
    this.head.add(visorMesh);

    // 4. Arms & Racing Gloves (Clamped to clip-on handlebars)
    const armGeo = new THREE.CylinderGeometry(0.065, 0.055, 0.46, 8);
    this.leftArm = new THREE.Mesh(armGeo, primaryMat);
    this.leftArm.position.set(-0.24, 0.28, 0.22);
    this.leftArm.rotation.set(0.68, 0.2, -0.42);
    this.torso.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, primaryMat);
    this.rightArm.position.set(0.24, 0.28, 0.22);
    this.rightArm.rotation.set(0.68, -0.2, 0.42);
    this.torso.add(this.rightArm);

    // Armored Gloves
    for (const side of [-1, 1]) {
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.10), darkLeatherMat);
      glove.position.set(side * 0.32, 0.10, 0.44);
      this.torso.add(glove);
    }

    // 5. Legs & Knee Sliders
    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.16, -0.05, 0.05);
    this.hips.add(this.leftLeg);

    const thighGeo = new THREE.BoxGeometry(0.14, 0.38, 0.15);
    const thighL = new THREE.Mesh(thighGeo, darkLeatherMat);
    thighL.position.set(0, -0.16, 0.10);
    thighL.rotation.x = 0.88;
    this.leftLeg.add(thighL);

    // White replaceable knee slider puck
    this.kneeSliderL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), sliderMat);
    this.kneeSliderL.position.set(-0.09, -0.16, 0.24);
    this.kneeSliderL.rotation.z = Math.PI / 2;
    this.leftLeg.add(this.kneeSliderL);

    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.16, -0.05, 0.05);
    this.hips.add(this.rightLeg);

    const thighR = new THREE.Mesh(thighGeo, darkLeatherMat);
    thighR.position.set(0, -0.16, 0.10);
    thighR.rotation.x = 0.88;
    this.rightLeg.add(thighR);

    this.kneeSliderR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), sliderMat);
    this.kneeSliderR.position.set(0.09, -0.16, 0.24);
    this.kneeSliderR.rotation.z = Math.PI / 2;
    this.rightLeg.add(this.kneeSliderR);
  }

  updateAnimation(leanAngleRad, speedKmh, isBraking = false, wheelieAngle = 0) {
    const leanRatio = leanAngleRad / (Math.PI / 3.6); // -1 to 1

    // 1. Shift Hips slightly into turn (body hanging off inside)
    this.hips.position.x = leanRatio * 0.09;
    this.hips.rotation.z = -leanRatio * 0.16;

    // 2. Spine Tuck: High speed = lower chest to fuel tank; braking = sit up for airbrake
    const speedTuck = Math.min(1.0, Math.max(0, (speedKmh - 120) / 160));
    const basePitch = 0.44 + (speedTuck * 0.38) - (isBraking ? 0.38 : 0) - (wheelieAngle * 0.6);
    this.torso.rotation.x = basePitch;

    // 3. Head turns into corner & stays level with horizon
    this.head.rotation.y = -leanRatio * 0.48;
    this.head.rotation.z = -leanAngleRad * 0.50;

    // 4. Knee Out slider: inside leg flares outward towards the ground
    if (leanRatio < -0.12) {
      // Leaning left -> left knee flares out
      this.leftLeg.rotation.y = -Math.abs(leanRatio) * 0.72;
      this.leftLeg.rotation.z = -Math.abs(leanRatio) * 0.48;
      this.rightLeg.rotation.set(0, 0, 0);
    } else if (leanRatio > 0.12) {
      // Leaning right -> right knee flares out
      this.rightLeg.rotation.y = Math.abs(leanRatio) * 0.72;
      this.rightLeg.rotation.z = Math.abs(leanRatio) * 0.48;
      this.leftLeg.rotation.set(0, 0, 0);
    } else {
      this.leftLeg.rotation.set(0, 0, 0);
      this.rightLeg.rotation.set(0, 0, 0);
    }
  }
}
