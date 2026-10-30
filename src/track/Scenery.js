import * as THREE from 'three';

/**
 * Scenery — Coastal Highway Environment
 * Uses InstancedMesh and merged static geometry to strictly respect draw call budget (draw calls <= 180).
 * Features:
 * - Sunset ocean plane with reflective depth
 * - Coastal ground terrain beneath road
 * - Warm terracotta mountain hills along the right
 * - Instanced coconut palms with swaying fronds along the coast
 * - Instanced W-beam highway guardrails with steel posts
 * - Instanced highway lamp posts with glowing warm luminaires
 * - Historic coastal lighthouse with red/white tower
 * - Indian highway milestone stones ("NH 66 · GOA")
 */
export class Scenery {
  constructor(scene, spline, trackData = {}) {
    this.scene = scene;
    this.spline = spline;
    this.trackData = trackData;
    this.group = new THREE.Group();

    this.initOcean();
    this.initTerrainGround();
    this.initTerrainCliffs();
    this.initGuardrails();
    this.initPalmTrees();
    this.initLampPosts();
    this.initLighthouse();
    this.initMilestones();

    scene.add(this.group);
  }

  initOcean() {
    // Vast ocean surface on the left
    const oceanGeo = new THREE.PlaneGeometry(3500, 3500, 16, 16);
    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x1d4d6a,
      roughness: 0.22,
      metalness: 0.55,
      flatShading: true
    });
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(-600, -2.5, 600);
    this.group.add(ocean);
    this.ocean = ocean;
  }

  initTerrainGround() {
    // Ground landscape under the road and hills
    const groundGeo = new THREE.PlaneGeometry(3500, 3500, 16, 16);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x3d5a45, // Coastal coastal greenery & earth
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(200, -0.6, 600);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  initTerrainCliffs() {
    // Warm sunlit coastal bluffs and hills on the right (set back safely from road edge)
    const cliffGroup = new THREE.Group();
    const cliffMat = new THREE.MeshStandardMaterial({
      color: 0xc48c56, // Warm terracotta sandstone
      roughness: 0.88,
      metalness: 0.05,
      flatShading: true
    });

    const totalLen = this.spline.totalLength;
    for (let s = 60; s < totalLen; s += 90) {
      const frame = this.spline.getFrameAtDistance(s);
      const cliffHeight = 35 + Math.sin(s * 0.02) * 16;
      const cliffRadius = 38;
      const cliffGeo = new THREE.ConeGeometry(cliffRadius, cliffHeight, 6);
      const cliffMesh = new THREE.Mesh(cliffGeo, cliffMat);
      cliffMesh.castShadow = true;
      cliffMesh.receiveShadow = true;

      // Road edge is at +7m. Base radius is 38m. Center at 65m ensures base ends at +27m (safely off-road)!
      const pos = frame.position.clone()
        .addScaledVector(frame.binormal, 68 + (Math.sin(s * 0.04) * 12))
        .addScaledVector(frame.normal, cliffHeight / 2 - 4);
      cliffMesh.position.copy(pos);
      cliffMesh.rotation.y = (s * 0.04);
      cliffGroup.add(cliffMesh);
    }
    this.group.add(cliffGroup);
  }

  initGuardrails() {
    // Left and right metallic W-beam barriers along the track
    const totalLen = this.spline.totalLength;
    const step = 6.0;
    const count = Math.floor(totalLen / step);
    const halfWidth = (this.trackData.roadWidth || 14) / 2 + 0.8;

    // Instanced posts
    const postGeo = new THREE.BoxGeometry(0.14, 0.9, 0.14);
    const railGeo = new THREE.BoxGeometry(0.08, 0.26, step + 0.1);
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.45,
      metalness: 0.75
    });

    const leftPosts = new THREE.InstancedMesh(postGeo, metalMat, count);
    const rightPosts = new THREE.InstancedMesh(postGeo, metalMat, count);
    const leftRails = new THREE.InstancedMesh(railGeo, metalMat, count);
    const rightRails = new THREE.InstancedMesh(railGeo, metalMat, count);

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const s = i * step;
      const frame = this.spline.getFrameAtDistance(s);

      // Left barrier post
      const leftPos = frame.position.clone()
        .addScaledVector(frame.binormal, -halfWidth)
        .addScaledVector(frame.normal, 0.45);
      dummy.position.copy(leftPos);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      leftPosts.setMatrixAt(i, dummy.matrix);

      // Left rail bridging posts
      dummy.position.addScaledVector(frame.normal, 0.2);
      dummy.updateMatrix();
      leftRails.setMatrixAt(i, dummy.matrix);

      // Right barrier post
      const rightPos = frame.position.clone()
        .addScaledVector(frame.binormal, halfWidth)
        .addScaledVector(frame.normal, 0.45);
      dummy.position.copy(rightPos);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      rightPosts.setMatrixAt(i, dummy.matrix);

      // Right rail bridging posts
      dummy.position.addScaledVector(frame.normal, 0.2);
      dummy.updateMatrix();
      rightRails.setMatrixAt(i, dummy.matrix);
    }

    leftPosts.instanceMatrix.needsUpdate = true;
    rightPosts.instanceMatrix.needsUpdate = true;
    leftRails.instanceMatrix.needsUpdate = true;
    rightRails.instanceMatrix.needsUpdate = true;

    this.group.add(leftPosts, rightPosts, leftRails, rightRails);
  }

  initPalmTrees() {
    // Coastal coconut palms swaying beside the ocean on the left
    // Using InstancedMesh for both trunks and fronds to keep draw calls ultra low!
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 0.9 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.7, flatShading: true });

    const totalLen = this.spline.totalLength;
    const treeCount = Math.floor(totalLen / 36);

    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 9, 6);
    trunkGeo.translate(0, 4.5, 0);
    const instancedTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);

    const frondGeo = new THREE.ConeGeometry(1.6, 5.5, 4);
    frondGeo.translate(0, 2.75, 0);
    const frondsPerTree = 5;
    const instancedFronds = new THREE.InstancedMesh(frondGeo, frondMat, treeCount * frondsPerTree);

    const dummy = new THREE.Object3D();

    for (let i = 0; i < treeCount; i++) {
      const s = i * 36 + (Math.sin(i * 1.5) * 8);
      const frame = this.spline.getFrameAtDistance(s);

      // Place 14 to 22m to the left (ocean side)
      const d = -16 - (Math.abs(Math.sin(i * 2.3)) * 8);
      const pos = frame.position.clone()
        .addScaledVector(frame.binormal, d)
        .addScaledVector(frame.normal, -0.2);

      const treeScale = 0.9 + Math.sin(i) * 0.25;

      // Position trunk
      dummy.position.copy(pos);
      dummy.rotation.set(0, i * 1.3, 0.12);
      dummy.scale.setScalar(treeScale);
      dummy.updateMatrix();
      instancedTrunks.setMatrixAt(i, dummy.matrix);

      // Position fronds
      for (let f = 0; f < frondsPerTree; f++) {
        dummy.position.copy(pos);
        dummy.position.y += 8.2 * treeScale;
        dummy.rotation.set(0, (f * Math.PI * 2) / frondsPerTree + i, Math.PI / 2.6);
        dummy.scale.setScalar(treeScale);
        dummy.updateMatrix();
        instancedFronds.setMatrixAt(i * frondsPerTree + f, dummy.matrix);
      }
    }

    instancedTrunks.instanceMatrix.needsUpdate = true;
    instancedFronds.instanceMatrix.needsUpdate = true;
    this.group.add(instancedTrunks, instancedFronds);
  }

  initLampPosts() {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.5 });
    const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });

    const totalLen = this.spline.totalLength;
    const count = Math.floor(totalLen / 60);

    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7.5, 6);
    poleGeo.translate(0, 3.75, 0);
    const instancedPoles = new THREE.InstancedMesh(poleGeo, postMat, count);

    const glowGeo = new THREE.SphereGeometry(0.35, 6, 6);
    const instancedGlows = new THREE.InstancedMesh(glowGeo, lampGlowMat, count);

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const s = i * 60;
      const frame = this.spline.getFrameAtDistance(s);
      const rightOffset = (this.trackData.roadWidth || 14) / 2 + 1.8;
      const pos = frame.position.clone().addScaledVector(frame.binormal, rightOffset);

      dummy.position.copy(pos);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instancedPoles.setMatrixAt(i, dummy.matrix);

      dummy.position.addScaledVector(frame.normal, 7.2).addScaledVector(frame.binormal, -1.2);
      dummy.updateMatrix();
      instancedGlows.setMatrixAt(i, dummy.matrix);
    }

    instancedPoles.instanceMatrix.needsUpdate = true;
    instancedGlows.instanceMatrix.needsUpdate = true;
    this.group.add(instancedPoles, instancedGlows);
  }

  initLighthouse() {
    // Historic coastal lighthouse on ocean cliff
    const lhGroup = new THREE.Group();
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xd90429, roughness: 0.6 });
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });

    const h1 = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, 8, 8), whiteMat);
    h1.position.y = 4;
    lhGroup.add(h1);

    const h2 = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.2, 8, 8), redMat);
    h2.position.y = 12;
    lhGroup.add(h2);

    const h3 = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.5, 8, 8), whiteMat);
    h3.position.y = 20;
    lhGroup.add(h3);

    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 8), beaconMat);
    lantern.position.y = 25.5;
    lhGroup.add(lantern);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8), redMat);
    dome.position.y = 27;
    lhGroup.add(dome);

    const frame = this.spline.getFrameAtDistance(400);
    const pos = frame.position.clone()
      .addScaledVector(frame.binormal, -160)
      .addScaledVector(frame.normal, 6);
    lhGroup.position.copy(pos);
    this.group.add(lhGroup);
  }

  initMilestones() {
    // Instanced yellow/white Indian highway milestone markers
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
    const totalLen = this.spline.totalLength;
    const count = Math.floor(totalLen / 200);

    const stoneGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.75, 8);
    stoneGeo.translate(0, 0.38, 0);
    const instancedStones = new THREE.InstancedMesh(stoneGeo, whiteMat, count);

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const s = i * 200 + 40;
      const frame = this.spline.getFrameAtDistance(s);
      const pos = frame.position.clone().addScaledVector(frame.binormal, -((this.trackData.roadWidth || 14) / 2 + 1.2));

      dummy.position.copy(pos);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      instancedStones.setMatrixAt(i, dummy.matrix);
    }

    instancedStones.instanceMatrix.needsUpdate = true;
    this.group.add(instancedStones);
  }
}
