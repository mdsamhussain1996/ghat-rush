import * as THREE from 'three';
import { mergeColoredParts } from '../render/GeomMerge.js';

let SHARED_RIDER_MAT = null;
function getSharedRiderMaterial() {
  if (!SHARED_RIDER_MAT) {
    SHARED_RIDER_MAT = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.25
    });
    SHARED_RIDER_MAT._isSharedRider = true;
  }
  return SHARED_RIDER_MAT;
}

/**
 * Articulated Procedural Motorcycle Rider (Geometry-Merged per Limb)
 * Keeps full animated lean/tuck/knee-out/crash articulation in 7 draw calls & ~250 tris.
 */
export class Rider {
  constructor(suitColor = '#ff4d29', helmetColor = '#ffffff', shareMaterial = false) {
    this.group = new THREE.Group();
    this.suitColor = suitColor;
    this.helmetColor = helmetColor;
    this.shareMaterial = shareMaterial;
    this.material = shareMaterial
      ? getSharedRiderMaterial()
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });

    this.initModel();
  }

  initModel() {
    const suitHex = this.suitColor;
    const helmetHex = this.helmetColor;
    const leatherHex = 0x16181d;
    const visorHex = 0x1a2634;
    const sliderHex = 0xffffff;
    const crestHex = 0xff4d29;

    // 1. Hips / Pelvis
    this.hips = new THREE.Group();
    this.hips.position.set(0, 0.74, -0.16);
    this.group.add(this.hips);

    const pelvisGeo = new THREE.BoxGeometry(0.34, 0.20, 0.26);
    const pelvisMerged = mergeColoredParts([{ geo: pelvisGeo, color: leatherHex }]);
    pelvisGeo.dispose();
    const pelvisMesh = new THREE.Mesh(pelvisMerged, this.material);
    pelvisMesh.castShadow = !this.shareMaterial;
    this.hips.add(pelvisMesh);

    // 2. Torso (merged chest + stripe + speed hump + shoulder pads + gloves)
    this.torso = new THREE.Group();
    this.torso.position.set(0, 0.10, 0);
    this.hips.add(this.torso);

    const chestG = new THREE.BoxGeometry(0.38, 0.44, 0.26);
    const stripeG = new THREE.BoxGeometry(0.12, 0.45, 0.27);
    const humpG = new THREE.ConeGeometry(0.14, 0.36, 5);
    const padG = new THREE.SphereGeometry(0.09, 6, 5);
    const gloveG = new THREE.BoxGeometry(0.08, 0.08, 0.10);

    const torsoGeo = mergeColoredParts([
      { geo: chestG, color: suitHex, pos: [0, 0.22, 0.04] },
      { geo: stripeG, color: 0xf8fafc, pos: [0, 0.22, 0.04] },
      { geo: humpG, color: suitHex, pos: [0, 0.28, -0.14], rot: [-Math.PI / 3.2, 0, 0] },
      { geo: padG, color: leatherHex, pos: [-0.23, 0.38, 0.04] },
      { geo: padG, color: leatherHex, pos: [0.23, 0.38, 0.04] },
      { geo: gloveG, color: leatherHex, pos: [-0.32, 0.10, 0.44] },
      { geo: gloveG, color: leatherHex, pos: [0.32, 0.10, 0.44] }
    ]);
    [chestG, stripeG, humpG, padG, gloveG].forEach(g => g.dispose());
    const torsoMesh = new THREE.Mesh(torsoGeo, this.material);
    torsoMesh.castShadow = true;
    this.torso.add(torsoMesh);

    // 3. Head & Helmet (merged helmet + crest + visor)
    this.head = new THREE.Group();
    this.head.position.set(0, 0.48, 0.10);
    this.torso.add(this.head);

    const helmetG = new THREE.SphereGeometry(0.18, 8, 6);
    const crestG = new THREE.BoxGeometry(0.04, 0.09, 0.24);
    const visorG = new THREE.BoxGeometry(0.26, 0.09, 0.14);
    const headGeo = mergeColoredParts([
      { geo: helmetG, color: helmetHex },
      { geo: crestG, color: crestHex, pos: [0, 0.17, 0.02] },
      { geo: visorG, color: visorHex, pos: [0, 0.02, 0.13] }
    ]);
    [helmetG, crestG, visorG].forEach(g => g.dispose());
    const headMesh = new THREE.Mesh(headGeo, this.material);
    headMesh.castShadow = !this.shareMaterial;
    this.head.add(headMesh);

    // 4. Arms
    const armG = new THREE.CylinderGeometry(0.065, 0.055, 0.46, 6);
    const armColored = mergeColoredParts([{ geo: armG, color: suitHex }]);
    armG.dispose();

    this.leftArm = new THREE.Mesh(armColored, this.material);
    this.leftArm.position.set(-0.24, 0.28, 0.22);
    this.leftArm.rotation.set(0.68, 0.2, -0.42);
    this.torso.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armColored, this.material);
    this.rightArm.position.set(0.24, 0.28, 0.22);
    this.rightArm.rotation.set(0.68, -0.2, 0.42);
    this.torso.add(this.rightArm);

    // 5. Legs & Knee Sliders (merged per leg)
    const thighG = new THREE.BoxGeometry(0.14, 0.38, 0.15);
    const sliderG = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 6);

    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.16, -0.05, 0.05);
    const leftLegGeo = mergeColoredParts([
      { geo: thighG, color: leatherHex, pos: [0, -0.16, 0.10], rot: [0.88, 0, 0] },
      { geo: sliderG, color: sliderHex, pos: [-0.09, -0.16, 0.24], rot: [0, 0, Math.PI / 2] }
    ]);
    this.leftLeg.add(new THREE.Mesh(leftLegGeo, this.material));
    this.hips.add(this.leftLeg);

    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.16, -0.05, 0.05);
    const rightLegGeo = mergeColoredParts([
      { geo: thighG, color: leatherHex, pos: [0, -0.16, 0.10], rot: [0.88, 0, 0] },
      { geo: sliderG, color: sliderHex, pos: [0.09, -0.16, 0.24], rot: [0, 0, Math.PI / 2] }
    ]);
    this.rightLeg.add(new THREE.Mesh(rightLegGeo, this.material));
    this.hips.add(this.rightLeg);

    thighG.dispose();
    sliderG.dispose();

    this._baseHipsY = this.hips.position.y;
    this._baseHipsZ = this.hips.position.z;
  }

  updateCrashPose(elapsed = 0, crashType = 'rail') {
    const t = Math.max(0, elapsed);
    const arc = Math.sin(Math.min(1, t / 0.85) * Math.PI);
    const flail = Math.sin(t * 14);
    const slideSpread = Math.min(1, t * 2.2);

    this.group.position.set(
      crashType === 'traffic' ? 0.15 * slideSpread : -0.25 * slideSpread,
      (crashType === 'traffic' ? 0.55 : 0.25) * arc - 0.18 * slideSpread,
      crashType === 'traffic' ? 0.65 * Math.min(1, t * 1.6) : 0.15 * slideSpread
    );
    this.group.rotation.set(
      -0.85 * slideSpread + flail * 0.18,
      flail * 0.25,
      (crashType === 'traffic' ? 1.15 : -0.95) * slideSpread
    );
    this.hips.position.set(0, this._baseHipsY, this._baseHipsZ);
    this.torso.rotation.x = -0.35 + flail * 0.25;
    this.head.rotation.set(0.3 * flail, flail * 0.5, -0.35);
    this.leftArm.rotation.set(-1.1 + flail * 0.55, 0.4, -1.25);
    this.rightArm.rotation.set(-0.9 - flail * 0.55, -0.4, 1.35);
    this.leftLeg.rotation.set(0.45 * flail, -0.55, -0.65);
    this.rightLeg.rotation.set(-0.45 * flail, 0.55, 0.65);
  }

  resetPose() {
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.hips.position.set(0, this._baseHipsY, this._baseHipsZ);
    this.hips.rotation.set(0, 0, 0);
    this.torso.rotation.set(0.44, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.leftArm.rotation.set(0.68, 0.2, -0.42);
    this.rightArm.rotation.set(0.68, -0.2, 0.42);
    this.leftLeg.rotation.set(0, 0, 0);
    this.rightLeg.rotation.set(0, 0, 0);
  }

  updateAnimation(leanAngleRad, speedKmh, isBraking = false, wheelieAngle = 0) {
    const leanRatio = leanAngleRad / (Math.PI / 3.6);

    this.hips.position.x = leanRatio * 0.09;
    this.hips.rotation.z = -leanRatio * 0.16;

    const speedTuck = Math.min(1.0, Math.max(0, (speedKmh - 120) / 160));
    const basePitch = 0.44 + (speedTuck * 0.38) - (isBraking ? 0.38 : 0) - (wheelieAngle * 0.6);
    this.torso.rotation.x = basePitch;

    this.head.rotation.y = -leanRatio * 0.48;
    this.head.rotation.z = -leanAngleRad * 0.50;

    if (leanRatio < -0.12) {
      this.leftLeg.rotation.y = -Math.abs(leanRatio) * 0.72;
      this.leftLeg.rotation.z = -Math.abs(leanRatio) * 0.48;
      this.rightLeg.rotation.set(0, 0, 0);
    } else if (leanRatio > 0.12) {
      this.rightLeg.rotation.y = Math.abs(leanRatio) * 0.72;
      this.rightLeg.rotation.z = Math.abs(leanRatio) * 0.48;
      this.leftLeg.rotation.set(0, 0, 0);
    } else {
      this.leftLeg.rotation.set(0, 0, 0);
      this.rightLeg.rotation.set(0, 0, 0);
    }
  }
}
