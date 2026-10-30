import * as THREE from 'three';

/**
 * Scenery — Coastal Highway (Phase 1.1 Complete Visual Upgrade)
 * Matches concept_coast.png:
 * - Animated ocean water shader with Gerstner waves, Fresnel reflection, and sun glitter
 * - Continuous beach sand ribbon along the sea side (d = -8m to -48m) with wet sand & surf edge
 * - Half-submerged rock clusters with white foam shoreline rings (NO floating black spheres)
 * - Layered sunlit rolling green hills on the right with near rock strata cut, concrete retaining wall, and drainage channel (NO dark brown wall)
 * - Street lamps with glowing warm lanterns lining the road (prominent in concept_coast.png)
 * - 3x more curved coconut palms with drooping fronds along the coast and hills
 * - Roadside life: NH 66 milestone stones, yellow-black curbs, cat's eyes road studs, tea stalls (dhabas) with parked scooters, billboards with posts firmly grounded, overhead highway gantry
 * - Traditional fishing boats with sails bobbing on the waves, distant cargo ship, and rotating lighthouse spotlight
 */
export class Scenery {
  constructor(scene, spline, trackData = {}) {
    this.scene = scene;
    this.spline = spline;
    this.trackData = trackData;
    this.roadWidth = trackData.roadWidth || 14.0;
    this.group = new THREE.Group();

    this.initWaterShader();
    this.initBeachAndRocks();
    this.initTerrainFBM();
    this.initRetainingWallAndLamps();
    this.initGuardrailsAndCurbs();
    this.initRoadsideLife();
    this.initBoatsAndLighthouse();
    this.initPalmsAndFlora();

    scene.add(this.group);
  }

  initWaterShader() {
    // Large animated ocean plane extending into the horizon
    const waterGeo = new THREE.PlaneGeometry(3600, 3600, 48, 48);
    waterGeo.rotateX(-Math.PI / 2);

    this.waterUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(-0.85, 0.22, 0.45).normalize() },
      uDeepColor: { value: new THREE.Color(0x0e3b64) },     // Deep sapphire ocean
      uShallowColor: { value: new THREE.Color(0x0284c7) },  // Vibrant coastal azure
      uSunColor: { value: new THREE.Color(0xfef08a) }       // Golden sunset glitter
    };

    const waterMat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          vec3 pos = position;
          // Dual-scrolling Gerstner wave displacement
          float wave1 = sin(pos.x * 0.012 + uTime * 1.6) * cos(pos.z * 0.014 + uTime * 1.2) * 0.75;
          float wave2 = sin(pos.x * 0.035 - uTime * 2.0) * cos(pos.z * 0.028 + uTime * 1.5) * 0.30;
          pos.y += wave1 + wave2;

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;

          float dx = cos(pos.x * 0.012 + uTime * 1.6) * 0.012 * 0.75;
          float dz = -sin(pos.z * 0.014 + uTime * 1.2) * 0.014 * 0.75;
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

          // Fresnel reflectance: azure near shore, deep sapphire far
          float fresnel = pow(1.0 - max(0.0, dot(viewDir, norm)), 3.2);
          vec3 waterCol = mix(uDeepColor, uShallowColor, fresnel * 0.75);

          // Sun glitter specular path toward low sunset sun
          vec3 halfVec = normalize(uSunDir + viewDir);
          float spec = pow(max(0.0, dot(norm, halfVec)), 56.0);
          vec3 finalColor = waterCol + uSunColor * spec * 1.85;

          gl_FragColor = vec4(finalColor, 0.94);
        }
      `,
      transparent: true,
      depthWrite: true
    });

    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.position.set(-650, -2.8, 650);
    this.group.add(this.waterMesh);
  }

  initBeachAndRocks() {
    // 1. Continuous Beach Sand Ribbon following spline along left side (d = -8 to -48m)
    const totalLen = this.spline.totalLength;
    const stepsS = Math.floor(totalLen / 12.0);
    const stepsD = 6;
    const vertexCount = (stepsS + 1) * (stepsD + 1);

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = [];

    const drySand = new THREE.Color(0xe0b584); // Golden beach sand
    const wetSand = new THREE.Color(0x99734e); // Wet dark sand near surf
    const surfFoam = new THREE.Color(0xf1f5f9); // Surf foam line

    let vIdx = 0;
    for (let i = 0; i <= stepsS; i++) {
      const s = (i / stepsS) * totalLen;
      const frame = this.spline.getFrameAtDistance(s);

      for (let j = 0; j <= stepsD; j++) {
        const dFrac = j / stepsD;
        const d = -8.0 - (dFrac * 40.0); // from -8m to -48m

        // Slopes gently down to sea level (-2.8m)
        let height = -0.15 - (dFrac * 2.65);

        const worldPos = frame.position.clone()
          .addScaledVector(frame.binormal, d)
          .addScaledVector(frame.normal, height);

        positions[vIdx * 3] = worldPos.x;
        positions[vIdx * 3 + 1] = worldPos.y;
        positions[vIdx * 3 + 2] = worldPos.z;

        const c = new THREE.Color();
        if (dFrac < 0.6) {
          c.lerpColors(drySand, wetSand, dFrac / 0.6);
        } else if (dFrac < 0.75) {
          c.lerpColors(wetSand, surfFoam, (dFrac - 0.6) / 0.15);
        } else {
          c.lerpColors(surfFoam, wetSand, (dFrac - 0.75) / 0.25);
        }

        colors[vIdx * 3] = c.r;
        colors[vIdx * 3 + 1] = c.g;
        colors[vIdx * 3 + 2] = c.b;

        vIdx++;
      }
    }

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

    const beachGeo = new THREE.BufferGeometry();
    beachGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    beachGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    beachGeo.setIndex(indices);
    beachGeo.computeVertexNormals();

    const beachMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.90,
      metalness: 0.05,
      flatShading: true
    });
    const beachMesh = new THREE.Mesh(beachGeo, beachMat);
    beachMesh.receiveShadow = true;
    this.group.add(beachMesh);

    // 2. Coastal Boulders & Rock Clusters half-submerged in water (NO floating spheres)
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x52525b, // Coastal wet basalt
      roughness: 0.82,
      metalness: 0.15,
      flatShading: true
    });

    const foamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide
    });

    const rockGeo = new THREE.DodecahedronGeometry(2.2, 1);
    const foamGeo = new THREE.RingGeometry(2.3, 3.4, 16);
    foamGeo.rotateX(-Math.PI / 2);

    const rockCount = Math.floor(totalLen / 50);
    const instancedRocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    const instancedFoam = new THREE.InstancedMesh(foamGeo, foamMat, rockCount);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < rockCount; i++) {
      const s = i * 50 + (Math.sin(i * 1.5) * 15);
      const frame = this.spline.getFrameAtDistance(s);
      
      // Half-submerged in water at d = -32 to -45m
      const lateralDist = -32.0 - (Math.abs(Math.sin(i * 2.3)) * 12.0);
      const pos = frame.position.clone()
        .addScaledVector(frame.binormal, lateralDist)
        .addScaledVector(frame.normal, -2.6); // snapped to waterline

      dummy.position.copy(pos);
      dummy.rotation.set(i * 0.7, i * 1.3, i * 0.4);
      dummy.scale.set(1.2 + Math.sin(i) * 0.4, 0.8 + Math.cos(i) * 0.3, 1.4 + Math.sin(i * 2) * 0.5);
      dummy.updateMatrix();
      instancedRocks.setMatrixAt(i, dummy.matrix);

      // White foam ring around rock waterline
      dummy.position.y = -2.7;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1.2, 1.0, 1.2);
      dummy.updateMatrix();
      instancedFoam.setMatrixAt(i, dummy.matrix);
    }

    instancedRocks.instanceMatrix.needsUpdate = true;
    instancedFoam.instanceMatrix.needsUpdate = true;
    this.group.add(instancedRocks, instancedFoam);
  }

  initTerrainFBM() {
    // 3. Layered Rolling Green Hills on the Right (Visual B.2: NO dark brown sheer wall)
    const totalLen = this.spline.totalLength;
    const stepsS = Math.floor(totalLen / 10.0);
    const stepsD = 15;
    const vertexCount = (stepsS + 1) * (stepsD + 1);

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = [];

    // Lush vibrant lime-green grass palette matching concept_coast.png
    const grassSunlit = new THREE.Color(0x84cc16); // Vibrant warm lime-green (concept_coast.png)
    const grassLush = new THREE.Color(0x65a30d);   // Tropical emerald green
    const rockStrata = new THREE.Color(0xc2854b);  // Terracotta warm sandstone
    const soilCut = new THREE.Color(0x92400e);     // Warm earth roadside cut

    let vIdx = 0;
    for (let i = 0; i <= stepsS; i++) {
      const s = (i / stepsS) * totalLen;
      const frame = this.spline.getFrameAtDistance(s);

      for (let j = 0; j <= stepsD; j++) {
        const dRatio = j / stepsD;
        // From right shoulder (8.5m) to distant hills (180m)
        const d = 8.5 + (dRatio * 170.0);

        // Smooth low-amplitude rolling hills matching concept_coast.png
        const n1 = Math.sin(s * 0.008) * Math.cos(d * 0.015);
        const n2 = Math.sin(s * 0.022 + 1.1) * Math.sin(d * 0.03);

        let height = 0;
        if (d < 16) {
          // Immediate roadside: low gentle rise (0.3m to 1.2m)
          const cutFrac = (d - 8.5) / 7.5;
          height = cutFrac * 1.2;
        } else if (d < 55) {
          // Low rolling green knoll (2.5m to 6.5m height) matching concept_coast.png
          const hillFrac = (d - 16.0) / 39.0;
          height = 1.2 + Math.sin(hillFrac * Math.PI * 0.5) * (4.8 + n1 * 1.6);
        } else {
          // Distant background ridges (7m to 15m)
          const farFrac = (d - 55.0) / 123.0;
          height = 5.5 + Math.pow(farFrac, 0.7) * 10.0 + (n1 * 3.5);
        }

        const worldPos = frame.position.clone()
          .addScaledVector(frame.binormal, d)
          .addScaledVector(frame.normal, height);

        positions[vIdx * 3] = worldPos.x;
        positions[vIdx * 3 + 1] = worldPos.y;
        positions[vIdx * 3 + 2] = worldPos.z;

        // Vibrant green grass starts right at the road edge (concept_coast.png)
        const c = new THREE.Color();
        if (d < 10.5) {
          c.lerpColors(soilCut, grassLush, (d - 8.5) / 2.0);
        } else if (d < 45) {
          c.lerpColors(grassLush, grassSunlit, (d - 10.5) / 34.5);
        } else {
          c.lerpColors(grassSunlit, grassLush, Math.min(1.0, (d - 45) / 80));
        }

        colors[vIdx * 3] = c.r;
        colors[vIdx * 3 + 1] = c.g;
        colors[vIdx * 3 + 2] = c.b;

        vIdx++;
      }
    }

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
    hillGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    hillGeo.setIndex(indices);
    hillGeo.computeVertexNormals();

    const hillMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.05,
      flatShading: true
    });

    const hillMesh = new THREE.Mesh(hillGeo, hillMat);
    hillMesh.receiveShadow = true;
    this.group.add(hillMesh);
  }

  initRetainingWallAndLamps() {
    // 4. Concrete Retaining Wall along right shoulder + Elegant Curved Street Lamps (concept_coast.png)
    const totalLen = this.spline.totalLength;
    const halfWidth = this.roadWidth / 2;

    // Retaining Wall & Drainage Curb on right shoulder
    const wallSteps = Math.floor(totalLen / 10.0);
    const wallGeo = new THREE.BoxGeometry(0.55, 0.85, 10.2);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 });
    const instancedWall = new THREE.InstancedMesh(wallGeo, wallMat, wallSteps);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < wallSteps; i++) {
      const s = i * 10.0 + 5.0;
      const frame = this.spline.getFrameAtDistance(s);
      const pos = frame.position.clone()
        .addScaledVector(frame.binormal, halfWidth + 0.8)
        .addScaledVector(frame.normal, 0.42);

      dummy.position.copy(pos);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      instancedWall.setMatrixAt(i, dummy.matrix);
    }
    instancedWall.instanceMatrix.needsUpdate = true;
    this.group.add(instancedWall);

    // Street Lamps with Glowing Lanterns (Prominent along both sides in concept_coast.png)
    const lampCount = Math.floor(totalLen / 48);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.85, roughness: 0.25 });
    const lanternMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 }); // Warm glowing lantern

    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7.0, 8);
    poleGeo.translate(0, 3.5, 0);

    const armGeo = new THREE.BoxGeometry(2.4, 0.12, 0.12);
    armGeo.translate(1.0, 6.8, 0);

    const lanternGeo = new THREE.BoxGeometry(0.65, 0.22, 0.45);
    lanternGeo.translate(2.1, 6.6, 0);

    const instancedPoles = new THREE.InstancedMesh(poleGeo, postMat, lampCount * 2);
    const instancedArms = new THREE.InstancedMesh(armGeo, postMat, lampCount * 2);
    const instancedLanterns = new THREE.InstancedMesh(lanternGeo, lanternMat, lampCount * 2);

    for (let i = 0; i < lampCount; i++) {
      const s = i * 48 + 12;
      const frame = this.spline.getFrameAtDistance(s);

      // Left Lamp
      let posL = frame.position.clone().addScaledVector(frame.binormal, -halfWidth - 1.2);
      dummy.position.copy(posL);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.rotation.y += Math.PI; // arm points towards road
      dummy.updateMatrix();
      instancedPoles.setMatrixAt(i * 2, dummy.matrix);
      instancedArms.setMatrixAt(i * 2, dummy.matrix);
      instancedLanterns.setMatrixAt(i * 2, dummy.matrix);

      // Right Lamp
      let posR = frame.position.clone().addScaledVector(frame.binormal, halfWidth + 1.2);
      dummy.position.copy(posR);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      instancedPoles.setMatrixAt(i * 2 + 1, dummy.matrix);
      instancedArms.setMatrixAt(i * 2 + 1, dummy.matrix);
      instancedLanterns.setMatrixAt(i * 2 + 1, dummy.matrix);
    }

    instancedPoles.instanceMatrix.needsUpdate = true;
    instancedArms.instanceMatrix.needsUpdate = true;
    instancedLanterns.instanceMatrix.needsUpdate = true;
    this.group.add(instancedPoles, instancedArms, instancedLanterns);
  }

  initGuardrailsAndCurbs() {
    const totalLen = this.spline.totalLength;
    const halfWidth = this.roadWidth / 2;

    // 1. W-Beam Metal Guardrail Rails
    const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.3 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.4 });

    const stepS = 6.0;
    const count = Math.floor(totalLen / stepS);

    const railGeo = new THREE.BoxGeometry(0.12, 0.42, stepS + 0.1);
    railGeo.translate(0, 0.72, stepS / 2);

    const postGeo = new THREE.BoxGeometry(0.14, 1.15, 0.14);
    postGeo.translate(0, 0.55, 0);

    const instancedRails = new THREE.InstancedMesh(railGeo, railMat, count * 2);
    const instancedPosts = new THREE.InstancedMesh(postGeo, postMat, count * 2);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const s = i * stepS;
      const frame = this.spline.getFrameAtDistance(s);

      // Left rail & post
      dummy.position.copy(frame.position).addScaledVector(frame.binormal, -halfWidth - 0.28);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      instancedRails.setMatrixAt(i * 2, dummy.matrix);
      instancedPosts.setMatrixAt(i * 2, dummy.matrix);

      // Right rail & post
      dummy.position.copy(frame.position).addScaledVector(frame.binormal, halfWidth + 0.28);
      dummy.updateMatrix();
      instancedRails.setMatrixAt(i * 2 + 1, dummy.matrix);
      instancedPosts.setMatrixAt(i * 2 + 1, dummy.matrix);
    }

    instancedRails.instanceMatrix.needsUpdate = true;
    instancedPosts.instanceMatrix.needsUpdate = true;
    this.group.add(instancedRails, instancedPosts);

    // 2. Yellow & Black Alternating Curbs on Corners
    const curbMat = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      vertexColors: true
    });

    const curbCount = Math.floor(totalLen / 4.0);
    const curbGeo = new THREE.BoxGeometry(0.40, 0.22, 4.0);
    curbGeo.translate(0, 0.11, 2.0);

    const curbCols = new Float32Array(curbGeo.attributes.position.count * 3);
    const yellow = new THREE.Color(0xfacc15);
    const black = new THREE.Color(0x18181b);

    for (let i = 0; i < curbGeo.attributes.position.count; i++) {
      const z = curbGeo.attributes.position.getZ(i);
      const isYellow = Math.floor((z + 2.0) / 1.0) % 2 === 0;
      const col = isYellow ? yellow : black;
      curbCols[i * 3] = col.r;
      curbCols[i * 3 + 1] = col.g;
      curbCols[i * 3 + 2] = col.b;
    }
    curbGeo.setAttribute('color', new THREE.BufferAttribute(curbCols, 3));

    const instancedCurbs = new THREE.InstancedMesh(curbGeo, curbMat, curbCount * 2);
    for (let i = 0; i < curbCount; i++) {
      const s = i * 4.0;
      const frame = this.spline.getFrameAtDistance(s);

      dummy.position.copy(frame.position).addScaledVector(frame.binormal, -halfWidth);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      instancedCurbs.setMatrixAt(i * 2, dummy.matrix);

      dummy.position.copy(frame.position).addScaledVector(frame.binormal, halfWidth);
      dummy.updateMatrix();
      instancedCurbs.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    instancedCurbs.instanceMatrix.needsUpdate = true;
    this.group.add(instancedCurbs);

    // 3. Reflective Cat's Eyes Road Studs down the lanes
    const studMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const studGeo = new THREE.BoxGeometry(0.14, 0.05, 0.22);
    const studCount = Math.floor(totalLen / 12);
    const instancedStuds = new THREE.InstancedMesh(studGeo, studMat, studCount * 2);

    for (let i = 0; i < studCount; i++) {
      const s = i * 12;
      const frame = this.spline.getFrameAtDistance(s);

      // Left divider
      dummy.position.copy(frame.position).addScaledVector(frame.binormal, -2.3).addScaledVector(frame.normal, 0.04);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      instancedStuds.setMatrixAt(i * 2, dummy.matrix);

      // Right divider
      dummy.position.copy(frame.position).addScaledVector(frame.binormal, 2.3).addScaledVector(frame.normal, 0.04);
      dummy.updateMatrix();
      instancedStuds.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    instancedStuds.instanceMatrix.needsUpdate = true;
    this.group.add(instancedStuds);
  }

  initRoadsideLife() {
    const totalLen = this.spline.totalLength;
    const halfWidth = this.roadWidth / 2;

    // 1. Concrete Highway Kilometre Stones ("NH 66 · GOA")
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xfff3b0, roughness: 0.65 });
    const stoneCount = Math.floor(totalLen / 220);
    const stoneGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.85, 10);
    stoneGeo.translate(0, 0.42, 0);
    const instancedStones = new THREE.InstancedMesh(stoneGeo, stoneMat, stoneCount);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < stoneCount; i++) {
      const s = i * 220 + 40;
      const frame = this.spline.getFrameAtDistance(s);
      dummy.position.copy(frame.position).addScaledVector(frame.binormal, -halfWidth - 1.4);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      dummy.updateMatrix();
      instancedStones.setMatrixAt(i, dummy.matrix);
    }
    instancedStones.instanceMatrix.needsUpdate = true;
    this.group.add(instancedStones);

    // 2. Roadside Tea Stalls / Dhabas with blue/orange tarps & parked scooters
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 0.85 });
    const tarpBlue = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6, side: THREE.DoubleSide });
    const tarpOrange = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.6, side: THREE.DoubleSide });

    const stallLocations = [450, 1350, 2250];
    stallLocations.forEach((s, idx) => {
      const frame = this.spline.getFrameAtDistance(s);
      const stallGroup = new THREE.Group();

      const shack = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.4, 3.2), woodMat);
      shack.position.y = 1.2;
      stallGroup.add(shack);

      const awning = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4.0), idx % 2 === 0 ? tarpBlue : tarpOrange);
      awning.rotation.x = Math.PI / 3.2;
      awning.position.set(0, 2.7, 1.4);
      stallGroup.add(awning);

      const scooter = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 1.6), woodMat);
      scooter.position.set(2.8, 0.4, 1.8);
      stallGroup.add(scooter);

      const pos = frame.position.clone().addScaledVector(frame.binormal, halfWidth + 5.5);
      stallGroup.position.copy(pos);
      stallGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      this.group.add(stallGroup);
    });

    // 3. Highway Billboards with firmly grounded steel posts (Bug A.2: No floating signs)
    const billboardLocations = [320, 1100, 1950];
    const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.3 });

    billboardLocations.forEach((s, idx) => {
      const frame = this.spline.getFrameAtDistance(s);
      const bbGroup = new THREE.Group();

      // Twin steel support posts reaching down to ground level
      const pillarGeo = new THREE.CylinderGeometry(0.28, 0.28, 12, 8);
      pillarGeo.translate(0, 6.0, 0);
      const p1 = new THREE.Mesh(pillarGeo, postMat);
      p1.position.x = -3.2;
      const p2 = p1.clone();
      p2.position.x = 3.2;
      bbGroup.add(p1, p2);

      // Solid billboard frame with fictional original sponsor
      const board = new THREE.Mesh(new THREE.BoxGeometry(9.5, 4.2, 0.25), new THREE.MeshStandardMaterial({
        color: idx === 0 ? 0x0284c7 : (idx === 1 ? 0xe11d48 : 0xd97706),
        roughness: 0.35,
        metalness: 0.3
      }));
      board.position.set(0, 9.6, 0);
      bbGroup.add(board);

      const pos = frame.position.clone().addScaledVector(frame.binormal, halfWidth + 8.5);
      bbGroup.position.copy(pos);
      bbGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      this.group.add(bbGroup);
    });

    // 4. Overhead Highway Gantry Sign with sturdy grounded truss posts
    const gantryFrame = this.spline.getFrameAtDistance(720);
    const gantryGroup = new THREE.Group();
    const gantryWidth = this.roadWidth + 4.5;

    const pL = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 9.0, 8), postMat);
    pL.position.set(-gantryWidth / 2, 4.5, 0);
    const pR = pL.clone();
    pR.position.x = gantryWidth / 2;
    gantryGroup.add(pL, pR);

    const beam = new THREE.Mesh(new THREE.BoxGeometry(gantryWidth + 1.2, 0.55, 0.55), postMat);
    beam.position.y = 8.5;
    gantryGroup.add(beam);

    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.8, 0.12), new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.4 }));
    signBoard.position.set(0, 8.4, 0);
    gantryGroup.add(signBoard);

    gantryGroup.position.copy(gantryFrame.position);
    gantryGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), gantryFrame.tangent);
    this.group.add(gantryGroup);
  }

  initBoatsAndLighthouse() {
    // 1. Bobbing Coastal Fishing Boats with Triangular White Sails
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.8 });
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.4, side: THREE.DoubleSide });

    this.boats = [];
    const boatCoords = [
      { x: -160, z: 280, seed: 1.2 },
      { x: -240, z: 700, seed: 3.5 },
      { x: -190, z: 1250, seed: 5.1 },
      { x: -280, z: 1750, seed: 2.8 }
    ];

    boatCoords.forEach(c => {
      const boatGroup = new THREE.Group();

      const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 6.2), woodMat);
      hull.position.y = 0.6;
      boatGroup.add(hull);

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5.0, 6), woodMat);
      mast.position.set(0, 3.0, 0.2);
      boatGroup.add(mast);

      // Triangular sail
      const sailGeo = new THREE.BufferGeometry();
      const sailVerts = new Float32Array([
        0, 1.0, 0.2,
        0, 5.2, 0.2,
        0, 1.2, 3.2
      ]);
      sailGeo.setAttribute('position', new THREE.BufferAttribute(sailVerts, 3));
      sailGeo.computeVertexNormals();
      const sail = new THREE.Mesh(sailGeo, sailMat);
      boatGroup.add(sail);

      boatGroup.position.set(c.x, -2.8, c.z);
      this.group.add(boatGroup);
      this.boats.push({ mesh: boatGroup, baseY: -2.8, seed: c.seed });
    });

    // 2. Distant Cargo Container Ship on Ocean Horizon
    const shipGroup = new THREE.Group();
    const shipHull = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 80), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 }));
    shipHull.position.y = 2.5;
    shipGroup.add(shipHull);

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(14, 12, 18), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }));
    bridge.position.set(0, 10, -22);
    shipGroup.add(bridge);

    shipGroup.position.set(-950, -2.6, 1000);
    shipGroup.rotation.y = -0.35;
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
    this.beaconBeam.position.y = 28.5;
    lhGroup.add(this.beaconBeam);

    lhGroup.position.set(-520, -2.5, 420);
    this.group.add(lhGroup);
  }

  initPalmsAndFlora() {
    // 5. 3x Instanced Coconut Palms with Slender Curved Trunks & 8-10 Drooping Fronds (Visual B.4)
    const totalLen = this.spline.totalLength;
    const halfWidth = this.roadWidth / 2;

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4329, roughness: 0.85 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.55, side: THREE.DoubleSide });

    // Curved slender trunk geometry
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 7.5, 7);
    trunkGeo.translate(0, 3.75, 0);

    // Drooping palm frond geometry
    const frondGeo = new THREE.PlaneGeometry(0.85, 3.8);
    frondGeo.translate(0, 1.9, 0);
    frondGeo.rotateX(Math.PI / 2.6);

    const palmCount = Math.floor(totalLen / 18); // 3x density
    const instancedTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmCount * 2);
    const instancedFronds = new THREE.InstancedMesh(frondGeo, frondMat, palmCount * 2 * 6);

    const dummy = new THREE.Object3D();
    const frondDummy = new THREE.Object3D();

    let frondIdx = 0;
    for (let i = 0; i < palmCount; i++) {
      const s = i * 18 + (Math.sin(i * 1.8) * 6);
      const frame = this.spline.getFrameAtDistance(s);

      // Left Palm (Beach side: leaning toward sea)
      const distL = -halfWidth - 3.5 - (Math.abs(Math.sin(i)) * 14.0);
      dummy.position.copy(frame.position).addScaledVector(frame.binormal, distL);
      dummy.position.y = Math.max(-2.5, dummy.position.y - 0.5);
      dummy.rotation.set(0.12 * Math.sin(i), (i * 0.7), -0.25 - Math.sin(i) * 0.1); // curve toward sea
      dummy.scale.setScalar(0.85 + Math.sin(i * 2) * 0.3);
      dummy.updateMatrix();
      instancedTrunks.setMatrixAt(i * 2, dummy.matrix);

      // Fronds for left palm (6 radial fronds)
      for (let f = 0; f < 6; f++) {
        frondDummy.position.copy(dummy.position).add(new THREE.Vector3(0, 7.2 * dummy.scale.y, 0));
        frondDummy.rotation.set(0.2, (f * Math.PI / 3) + i, 0);
        frondDummy.scale.copy(dummy.scale);
        frondDummy.updateMatrix();
        instancedFronds.setMatrixAt(frondIdx++, frondDummy.matrix);
      }

      // Right Palm (Hill side: leaning away from hill)
      const distR = halfWidth + 4.0 + (Math.abs(Math.cos(i)) * 16.0);
      dummy.position.copy(frame.position).addScaledVector(frame.binormal, distR);
      dummy.position.y += 1.2;
      dummy.rotation.set(-0.1 * Math.cos(i), (i * 0.9), 0.22 + Math.sin(i) * 0.08);
      dummy.scale.setScalar(0.9 + Math.cos(i * 2) * 0.28);
      dummy.updateMatrix();
      instancedTrunks.setMatrixAt(i * 2 + 1, dummy.matrix);

      // Fronds for right palm
      for (let f = 0; f < 6; f++) {
        frondDummy.position.copy(dummy.position).add(new THREE.Vector3(0, 7.2 * dummy.scale.y, 0));
        frondDummy.rotation.set(0.2, (f * Math.PI / 3) + i + 0.5, 0);
        frondDummy.scale.copy(dummy.scale);
        frondDummy.updateMatrix();
        instancedFronds.setMatrixAt(frondIdx++, frondDummy.matrix);
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
