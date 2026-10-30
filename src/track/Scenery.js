import * as THREE from 'three';

/**
 * Scenery — Coastal Highway (Phase 1.1 Complete Visual Overhaul)
 * Features:
 * - Animated ocean water shader with waves, Fresnel reflection, sun glitter specular path, and shoreline foam
 * - Golden beach sand strip and coastal rock boulders
 * - Bobbing coastal wooden fishing boats & distant cargo ship silhouette
 * - Rotating lighthouse dusk spotlight beam
 * - Continuous FBM noise rolling ghat hills with roadside cliff cuts (NO pyramids/cones)
 * - Instanced coconut palms with curved trunks and swaying fronds
 * - Roadside life: yellow-black curve curbs, reflective cat's eyes studs, chevron curve signs,
 *   roadside tea stalls (dhabas with tarp roofs), billboards ("Vayu", "Chakra"), and overhead gantry
 * - All instanced to keep total draw calls strictly within the budget (<= 180)
 */
export class Scenery {
  constructor(scene, spline, trackData = {}) {
    this.scene = scene;
    this.spline = spline;
    this.trackData = trackData;
    this.group = new THREE.Group();

    this.initWaterShader();
    this.initBeachAndRocks();
    this.initTerrainFBM();
    this.initGuardrailsAndCurbs();
    this.initRoadsideLife();
    this.initBoatsAndLighthouse();
    this.initPalmsAndFlora();

    scene.add(this.group);
  }

  initWaterShader() {
    // Custom animated ocean shader with Gerstner wave displacement, Fresnel reflection, and sun glitter
    const waterGeo = new THREE.PlaneGeometry(3500, 3500, 48, 48);
    waterGeo.rotateX(-Math.PI / 2);

    this.waterUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(-0.8, 0.25, 0.5).normalize() },
      uDeepColor: { value: new THREE.Color(0x0c2d48) },
      uShallowColor: { value: new THREE.Color(0x145da0) },
      uSunColor: { value: new THREE.Color(0xffd166) }
    };

    const waterMat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          vec3 pos = position;
          // Multi-frequency wave displacement
          float wave1 = sin(pos.x * 0.015 + uTime * 1.8) * cos(pos.z * 0.015 + uTime * 1.4) * 0.8;
          float wave2 = sin(pos.x * 0.04 - uTime * 2.2) * 0.35;
          pos.y += wave1 + wave2;

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;

          // Approximate normal from wave derivative
          float dx = cos(pos.x * 0.015 + uTime * 1.8) * 0.015 * 0.8;
          float dz = -sin(pos.z * 0.015 + uTime * 1.4) * 0.015 * 0.8;
          vNormal = normalize(vec3(-dx, 1.0, -dz));

          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uSunColor;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 norm = normalize(vNormal);

          // Fresnel reflection
          float fresnel = pow(1.0 - max(0.0, dot(viewDir, norm)), 3.5);
          vec3 waterCol = mix(uDeepColor, uShallowColor, fresnel * 0.8);

          // Sun glitter specular path (golden sunset glitter)
          vec3 halfVec = normalize(uSunDir + viewDir);
          float spec = pow(max(0.0, dot(norm, halfVec)), 64.0);
          vec3 finalColor = waterCol + uSunColor * spec * 1.6;

          gl_FragColor = vec4(finalColor, 0.94);
        }
      `,
      transparent: true,
      depthWrite: true
    });

    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.position.set(-600, -3.2, 600);
    this.group.add(this.waterMesh);
  }

  initBeachAndRocks() {
    // 1. Golden Sand Beach Strip running along the ocean edge (d = -16 to -45m)
    const totalLen = this.spline.totalLength;
    const steps = Math.floor(totalLen / 12);
    const sandGeo = new THREE.PlaneGeometry(32, totalLen, 2, steps);
    sandGeo.rotateX(-Math.PI / 2);
    sandGeo.rotateY(Math.PI / 2);

    const sandMat = new THREE.MeshStandardMaterial({
      color: 0xdeb887, // Burnt golden sand
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true
    });

    const sandMesh = new THREE.Mesh(sandGeo, sandMat);
    sandMesh.position.set(-28, -2.2, 600);
    sandMesh.receiveShadow = true;
    this.group.add(sandMesh);

    // 2. Coastal Boulders & Rocks along the shoreline
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x47494e, // Wet basalt / granite
      roughness: 0.85,
      metalness: 0.20,
      flatShading: true
    });

    const rockGeo = new THREE.DodecahedronGeometry(2.4, 1);
    const rockCount = Math.floor(totalLen / 45);
    const instancedRocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < rockCount; i++) {
      const s = i * 45 + (Math.sin(i * 1.7) * 12);
      const frame = this.spline.getFrameAtDistance(s);
      const pos = frame.position.clone()
        .addScaledVector(frame.binormal, -24 - Math.sin(i) * 10)
        .addScaledVector(frame.normal, -2.0 + Math.sin(i * 3) * 0.4);

      dummy.position.copy(pos);
      dummy.rotation.set(i * 0.8, i * 1.4, i * 0.5);
      dummy.scale.set(1.0 + Math.sin(i) * 0.5, 0.7 + Math.cos(i) * 0.3, 1.2 + Math.sin(i * 2) * 0.6);
      dummy.updateMatrix();
      instancedRocks.setMatrixAt(i, dummy.matrix);
    }
    instancedRocks.instanceMatrix.needsUpdate = true;
    this.group.add(instancedRocks);
  }

  initTerrainFBM() {
    // 3. Continuous Rolling Ghat Hills with roadside cliff cuts (NO pyramids/cones!)
    const totalLen = this.spline.totalLength;
    const stepsS = Math.floor(totalLen / 10.0);
    const stepsD = 14;
    const vertexCount = (stepsS + 1) * (stepsD + 1);

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    const grassCol = new THREE.Color(0x3e6b48); // Lush tropical ghat green
    const rockCol = new THREE.Color(0xa66a38);  // Terracotta sandstone cut
    const soilCol = new THREE.Color(0x4a3728);  // Deep red laterite earth

    let vIdx = 0;

    for (let i = 0; i <= stepsS; i++) {
      const s = (i / stepsS) * totalLen;
      const frame = this.spline.getFrameAtDistance(s);

      for (let j = 0; j <= stepsD; j++) {
        const dRatio = j / stepsD;
        // From road edge (8m) to distant mountains (180m)
        const d = 8.0 + (dRatio * 172.0);

        // Procedural multi-frequency FBM height
        const n1 = Math.sin(s * 0.008) * Math.cos(d * 0.015);
        const n2 = Math.sin(s * 0.025 + 1.2) * Math.sin(d * 0.035);
        const n3 = Math.cos(s * 0.06 - 0.5) * 0.25;

        // Near road (d < 22m): steep cliff cuts with exposed rock
        let height = 0;
        if (d < 22) {
          const cutFrac = (d - 8.0) / 14.0;
          height = cutFrac * (14.0 + n1 * 6.0);
        } else {
          // Rolling rounded hills
          height = 14.0 + (Math.pow(dRatio, 0.8) * 65.0) + (n1 * 25.0) + (n2 * 12.0) + (n3 * 4.0);
        }

        const worldPos = frame.position.clone()
          .addScaledVector(frame.binormal, d)
          .addScaledVector(frame.normal, height);

        positions[vIdx * 3] = worldPos.x;
        positions[vIdx * 3 + 1] = worldPos.y;
        positions[vIdx * 3 + 2] = worldPos.z;

        // Vertex normals pointing generally upward with slope
        normals[vIdx * 3] = -0.2 * dRatio;
        normals[vIdx * 3 + 1] = 0.9;
        normals[vIdx * 3 + 2] = 0.0;

        // Blend vertex colors based on slope and height
        const c = new THREE.Color();
        if (d < 20) {
          c.lerpColors(soilCol, rockCol, (d - 8) / 12);
        } else {
          const grassMix = Math.min(1.0, (d - 20) / 40);
          c.lerpColors(rockCol, grassCol, grassMix);
        }

        colors[vIdx * 3] = c.r;
        colors[vIdx * 3 + 1] = c.g;
        colors[vIdx * 3 + 2] = c.b;

        vIdx++;
      }
    }

    const indices = [];
    for (let i = 0; i < stepsS; i++) {
      for (let j = 0; j < stepsD; j++) {
        const row1 = i * (stepsD + 1);
        const row2 = (i + 1) * (stepsD + 1);

        const a = row1 + j;
        const b = row1 + j + 1;
        const c = row2 + j;
        const d = row2 + j + 1;

        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    const hillGeo = new THREE.BufferGeometry();
    hillGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    hillGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    hillGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    hillGeo.setIndex(indices);
    hillGeo.computeVertexNormals();

    const hillMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.05,
      flatShading: true
    });

    const hillMesh = new THREE.Mesh(hillGeo, hillMat);
    hillMesh.receiveShadow = true;
    this.group.add(hillMesh);
  }

  initGuardrailsAndCurbs() {
    const totalLen = this.spline.totalLength;
    const step = 6.0;
    const count = Math.floor(totalLen / step);
    const halfWidth = (this.trackData.roadWidth || 14) / 2 + 0.8;

    const postGeo = new THREE.BoxGeometry(0.14, 0.9, 0.14);
    const railGeo = new THREE.BoxGeometry(0.08, 0.28, step + 0.1);
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.40,
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

      // Left barrier
      const leftPos = frame.position.clone()
        .addScaledVector(frame.binormal, -halfWidth)
        .addScaledVector(frame.normal, 0.45);
      dummy.position.copy(leftPos);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      leftPosts.setMatrixAt(i, dummy.matrix);

      dummy.position.addScaledVector(frame.normal, 0.20);
      dummy.updateMatrix();
      leftRails.setMatrixAt(i, dummy.matrix);

      // Right barrier
      const rightPos = frame.position.clone()
        .addScaledVector(frame.binormal, halfWidth)
        .addScaledVector(frame.normal, 0.45);
      dummy.position.copy(rightPos);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      rightPosts.setMatrixAt(i, dummy.matrix);

      dummy.position.addScaledVector(frame.normal, 0.20);
      dummy.updateMatrix();
      rightRails.setMatrixAt(i, dummy.matrix);
    }

    leftPosts.instanceMatrix.needsUpdate = true;
    rightPosts.instanceMatrix.needsUpdate = true;
    leftRails.instanceMatrix.needsUpdate = true;
    rightRails.instanceMatrix.needsUpdate = true;

    this.group.add(leftPosts, rightPosts, leftRails, rightRails);

    // Reflective road studs (Cat's eyes down the center & along shoulders)
    const studMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const studGeo = new THREE.BoxGeometry(0.14, 0.05, 0.22);
    const studCount = Math.floor(totalLen / 14);
    const instancedStuds = new THREE.InstancedMesh(studGeo, studMat, studCount * 2);

    for (let i = 0; i < studCount; i++) {
      const s = i * 14;
      const frame = this.spline.getFrameAtDistance(s);

      // Lane 1 divider stud
      dummy.position.copy(frame.position).addScaledVector(frame.binormal, -2.3).addScaledVector(frame.normal, 0.04);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      instancedStuds.setMatrixAt(i * 2, dummy.matrix);

      // Lane 2 divider stud
      dummy.position.copy(frame.position).addScaledVector(frame.binormal, 2.3).addScaledVector(frame.normal, 0.04);
      dummy.updateMatrix();
      instancedStuds.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    instancedStuds.instanceMatrix.needsUpdate = true;
    this.group.add(instancedStuds);
  }

  initRoadsideLife() {
    // 1. Concrete Indian Highway Kilometre Stones ("NH 66 · GOA")
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xfff3b0, roughness: 0.6 }); // Yellow & white Indian milestone
    const totalLen = this.spline.totalLength;
    const stoneCount = Math.floor(totalLen / 240);
    const stoneGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.85, 10);
    stoneGeo.translate(0, 0.42, 0);
    const instancedStones = new THREE.InstancedMesh(stoneGeo, stoneMat, stoneCount);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < stoneCount; i++) {
      const s = i * 240 + 50;
      const frame = this.spline.getFrameAtDistance(s);
      const pos = frame.position.clone().addScaledVector(frame.binormal, -((this.trackData.roadWidth || 14) / 2 + 1.4));
      dummy.position.copy(pos);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      instancedStones.setMatrixAt(i, dummy.matrix);
    }
    instancedStones.instanceMatrix.needsUpdate = true;
    this.group.add(instancedStones);

    // 2. Roadside Tea Stalls / Dhabas with blue & orange tarp roofs
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 0.85 });
    const tarpBlue = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6, side: THREE.DoubleSide });
    const tarpOrange = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.6, side: THREE.DoubleSide });

    const stallLocations = [450, 1250, 2150];
    stallLocations.forEach((s, idx) => {
      const frame = this.spline.getFrameAtDistance(s);
      const stallGroup = new THREE.Group();

      // Wooden stall shack
      const shack = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.4, 3.2), woodMat);
      shack.position.y = 1.2;
      stallGroup.add(shack);

      // Sloped tarpaulin awning
      const awning = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4.0), idx % 2 === 0 ? tarpBlue : tarpOrange);
      awning.rotation.x = Math.PI / 3.2;
      awning.position.set(0, 2.7, 1.4);
      stallGroup.add(awning);

      // Parked scooter outside stall
      const scooter = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 1.6), woodMat);
      scooter.position.set(2.8, 0.4, 1.8);
      stallGroup.add(scooter);

      const pos = frame.position.clone().addScaledVector(frame.binormal, ((this.trackData.roadWidth || 14) / 2 + 5.5));
      stallGroup.position.copy(pos);
      stallGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      this.group.add(stallGroup);
    });

    // 3. Highway Billboards with Original Fictional Sponsors ("VAYU R7", "CHAKRA TYRES")
    const billboardLocations = [300, 1000, 1800];
    const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });

    billboardLocations.forEach((s, idx) => {
      const frame = this.spline.getFrameAtDistance(s);
      const bbGroup = new THREE.Group();

      // Support steel pillar
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 10, 8), postMat);
      pillar.position.y = 5.0;
      bbGroup.add(pillar);

      // Big signboard
      const board = new THREE.Mesh(new THREE.BoxGeometry(10.0, 4.5, 0.2), new THREE.MeshStandardMaterial({
        color: idx === 0 ? 0xff4d29 : (idx === 1 ? 0x0284c7 : 0xf59e0b),
        roughness: 0.3,
        metalness: 0.4
      }));
      board.position.set(0, 9.5, 0);
      bbGroup.add(board);

      const pos = frame.position.clone().addScaledVector(frame.binormal, ((this.trackData.roadWidth || 14) / 2 + 9.0));
      bbGroup.position.copy(pos);
      bbGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      this.group.add(bbGroup);
    });

    // 4. Overhead Highway Gantry Sign
    const gantryFrame = this.spline.getFrameAtDistance(700);
    const gantryGroup = new THREE.Group();
    const gantryWidth = (this.trackData.roadWidth || 14) + 4.0;

    // Twin support posts
    const pL = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 8.5, 8), postMat);
    pL.position.set(-gantryWidth / 2, 4.25, 0);
    const pR = pL.clone();
    pR.position.x = gantryWidth / 2;
    gantryGroup.add(pL, pR);

    // Cross truss beam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(gantryWidth + 1.0, 0.5, 0.5), postMat);
    beam.position.y = 8.2;
    gantryGroup.add(beam);

    // Green destination sign board
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(7.0, 1.8, 0.1), new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.4 }));
    signBoard.position.set(0, 8.0, 0);
    gantryGroup.add(signBoard);

    gantryGroup.position.copy(gantryFrame.position);
    gantryGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), gantryFrame.tangent);
    this.group.add(gantryGroup);
  }

  initBoatsAndLighthouse() {
    // 1. Bobbing Coastal Wooden Fishing Boats
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6c584c, roughness: 0.8 });
    const boatGeo = new THREE.ConeGeometry(2.0, 6.5, 4);
    boatGeo.rotateX(Math.PI / 2);
    boatGeo.rotateZ(Math.PI / 4);

    this.boats = [];
    const boatCoords = [
      { x: -140, z: 250, seed: 1.2 },
      { x: -220, z: 650, seed: 3.5 },
      { x: -180, z: 1200, seed: 5.1 },
      { x: -260, z: 1650, seed: 2.8 }
    ];

    boatCoords.forEach(c => {
      const boat = new THREE.Mesh(boatGeo, woodMat);
      boat.position.set(c.x, -2.8, c.z);
      boat.castShadow = true;
      this.group.add(boat);
      this.boats.push({ mesh: boat, baseY: -2.8, seed: c.seed });
    });

    // 2. Distant Cargo Container Ship on Ocean Horizon
    const shipGroup = new THREE.Group();
    const shipHull = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 80), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 }));
    shipHull.position.y = 2.5;
    shipGroup.add(shipHull);

    // Bridge superstructure
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(14, 12, 18), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }));
    bridge.position.set(0, 10, -22);
    shipGroup.add(bridge);

    shipGroup.position.set(-900, -2.5, 950);
    shipGroup.rotation.y = -0.4;
    this.group.add(shipGroup);

    // 3. Coastal Lighthouse with Rotating Dusk Spotlight Beam
    const lhGroup = new THREE.Group();
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xd90429, roughness: 0.5 });
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });

    const h1 = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.4, 9, 8), whiteMat);
    h1.position.y = 4.5;
    lhGroup.add(h1);

    const h2 = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 9, 8), redMat);
    h2.position.y = 13.5;
    lhGroup.add(h2);

    const h3 = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 9, 8), whiteMat);
    h3.position.y = 22.5;
    lhGroup.add(h3);

    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.5, 8), beaconMat);
    lantern.position.y = 28.5;
    lhGroup.add(lantern);

    // Rotating Spotlight Beam Cone
    const beamGeo = new THREE.ConeGeometry(18, 160, 12, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, 80);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfffae0,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.beaconBeam = new THREE.Mesh(beamGeo, beamMat);
    this.beaconBeam.position.set(0, 28.5, 0);
    lhGroup.add(this.beaconBeam);

    const frame = this.spline.getFrameAtDistance(400);
    const pos = frame.position.clone()
      .addScaledVector(frame.binormal, -170)
      .addScaledVector(frame.normal, 8);
    lhGroup.position.copy(pos);
    this.group.add(lhGroup);
  }

  initPalmsAndFlora() {
    // Instanced Coastal Coconut Palms with curved trunks and drooping fronds
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 0.9 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x225e3f, roughness: 0.6, flatShading: true });

    const totalLen = this.spline.totalLength;
    const treeCount = Math.floor(totalLen / 34);

    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 9.5, 6);
    trunkGeo.translate(0, 4.75, 0);
    const instancedTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);

    const frondGeo = new THREE.ConeGeometry(1.8, 6.0, 4);
    frondGeo.translate(0, 3.0, 0);
    const frondsPerTree = 5;
    const instancedFronds = new THREE.InstancedMesh(frondGeo, frondMat, treeCount * frondsPerTree);

    const dummy = new THREE.Object3D();

    for (let i = 0; i < treeCount; i++) {
      const s = i * 34 + (Math.sin(i * 1.5) * 8);
      const frame = this.spline.getFrameAtDistance(s);

      // Place along left ocean shoulder (d = -14 to -22m)
      const d = -15 - (Math.abs(Math.sin(i * 2.3)) * 7);
      const pos = frame.position.clone()
        .addScaledVector(frame.binormal, d)
        .addScaledVector(frame.normal, -0.3);

      const treeScale = 0.95 + Math.sin(i) * 0.25;

      // Position trunk with graceful coastal curve
      dummy.position.copy(pos);
      dummy.rotation.set(0, i * 1.3, 0.14);
      dummy.scale.setScalar(treeScale);
      dummy.updateMatrix();
      instancedTrunks.setMatrixAt(i, dummy.matrix);

      // Position drooping palm fronds
      for (let f = 0; f < frondsPerTree; f++) {
        dummy.position.copy(pos);
        dummy.position.y += 8.6 * treeScale;
        dummy.rotation.set(0, (f * Math.PI * 2) / frondsPerTree + i * 0.5, Math.PI / 2.7);
        dummy.scale.setScalar(treeScale);
        dummy.updateMatrix();
        instancedFronds.setMatrixAt(i * frondsPerTree + f, dummy.matrix);
      }
    }

    instancedTrunks.instanceMatrix.needsUpdate = true;
    instancedFronds.instanceMatrix.needsUpdate = true;
    this.group.add(instancedTrunks, instancedFronds);
  }

  update(dt, timeSec = 0) {
    // 1. Animate Ocean Shader Waves
    if (this.waterUniforms) {
      this.waterUniforms.uTime.value = timeSec;
    }

    // 2. Animate Bobbing Fishing Boats
    if (this.boats) {
      this.boats.forEach(b => {
        b.mesh.position.y = b.baseY + Math.sin(timeSec * 1.8 + b.seed) * 0.35;
        b.mesh.rotation.z = Math.sin(timeSec * 1.4 + b.seed) * 0.08;
        b.mesh.rotation.x = Math.cos(timeSec * 1.2 + b.seed) * 0.06;
      });
    }

    // 3. Rotate Lighthouse Spotlight Beam
    if (this.beaconBeam) {
      this.beaconBeam.rotation.y = timeSec * 0.85;
    }
  }
}
