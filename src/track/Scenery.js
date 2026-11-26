import * as THREE from 'three';
import { mergeColoredParts } from '../render/GeomMerge.js';

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
    this.envType = trackData.environment || 'coastal';
    this.surfaceGrip = this.envType === 'monsoon' ? 0.85 : (this.envType === 'neon' ? 0.94 : 1.0);
    this.group = new THREE.Group();
    this.waterfalls = [];
    this.neonGlowMats = [];
    this.scalableInstances = [];
    this.sectors = [];
    this.initSectors(8);

    if (this.envType === 'monsoon') {
      this.initGuardrailsAndCurbs();
      this.initMonsoonScenery();
      this.initCornerChevrons();
    } else if (this.envType === 'neon') {
      this.initGuardrailsAndCurbs();
      this.initNeonScenery();
      this.initCornerChevrons();
    } else {
      this.initWaterShader();
      this.initBeachAndRocks();
      this.initTerrainFBM();
      this.initRetainingWallAndLamps();
      this.initGuardrailsAndCurbs();
      this.initRoadsideLife();
      this.initBoatsAndLighthouse();
      this.initPalmsAndFlora();
      this.initCornerChevrons();
    }
    this.initFinishGantry();

    scene.add(this.group);
  }

  initFinishGantry() {
    const startFrame = this.spline.getFrameAtDistance(0);
    const gantryW = this.roadWidth + 2.4;
    const gantryGrp = new THREE.Group();
    gantryGrp.position.copy(startFrame.position);
    gantryGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), startFrame.tangent);

    // Checkered Overhead Banner Canvas Texture
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 512;
    bannerCanvas.height = 128;
    const bctx = bannerCanvas.getContext('2d');
    const sq = 16;
    for (let y = 0; y < 128; y += sq) {
      for (let x = 0; x < 512; x += sq) {
        const isBorder = y < 24 || y >= 104 || x < 48 || x >= 464;
        if (isBorder) {
          bctx.fillStyle = ((x / sq) + (y / sq)) % 2 === 0 ? '#ffffff' : '#0f172a';
        } else {
          bctx.fillStyle = '#0f172a';
        }
        bctx.fillRect(x, y, sq, sq);
      }
    }
    bctx.fillStyle = '#ff4d29';
    bctx.font = '900 44px Outfit, sans-serif';
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';
    bctx.fillText('GHAT RUSH · FINISH', 256, 66);

    const bannerTex = new THREE.CanvasTexture(bannerCanvas);
    bannerTex.needsUpdate = true;

    const pillarG = new THREE.CylinderGeometry(0.24, 0.28, 7.6, 8);
    const trussG = new THREE.BoxGeometry(gantryW + 0.8, 0.45, 0.45);
    const frameGeo = mergeColoredParts([
      { geo: pillarG, color: 0xe11d48, pos: [-gantryW / 2, 3.8, 0] },
      { geo: pillarG, color: 0xe11d48, pos: [gantryW / 2, 3.8, 0] },
      { geo: trussG, color: 0x1e293b, pos: [0, 7.5, 0] }
    ]);
    pillarG.dispose();
    trussG.dispose();

    const frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.55 });
    gantryGrp.add(new THREE.Mesh(frameGeo, frameMat));

    const bannerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(gantryW - 0.6, 1.55, 0.16),
      new THREE.MeshBasicMaterial({ map: bannerTex })
    );
    bannerMesh.position.set(0, 6.75, 0);
    gantryGrp.add(bannerMesh);

    // Fluttering side flags
    const flagGeo = new THREE.PlaneGeometry(1.4, 0.9, 4, 1);
    flagGeo.translate(0.7, 0, 0);
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xff4d29, side: THREE.DoubleSide });
    this.finishFlags = [];
    for (const side of [-1, 1]) {
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(side * (gantryW / 2), 7.95, 0);
      if (side === 1) flag.rotation.y = Math.PI;
      gantryGrp.add(flag);
      this.finishFlags.push({ mesh: flag, side });
    }

    (this.getSectorForS(0)?.group || this.group).add(gantryGrp);
  }

  getSurfaceGrip() {
    return this.surfaceGrip;
  }

  initSectors(count = 8) {
    const totalLen = this.spline.totalLength;
    const halfSectorSpan = totalLen / (count * 2);
    for (let i = 0; i < count; i++) {
      const sMid = ((i + 0.5) / count) * totalLen;
      const frame = this.spline.getFrameAtDistance(sMid);
      const grp = new THREE.Group();
      this.group.add(grp);
      this.sectors.push({
        group: grp,
        sMid,
        center: frame.position.clone(),
        radius: halfSectorSpan + 75
      });
    }
  }

  getSectorForS(s) {
    const totalLen = this.spline.totalLength;
    const wrapped = this.spline.wrapDistance(s);
    const idx = Math.min(this.sectors.length - 1, Math.floor((wrapped / totalLen) * this.sectors.length));
    return this.sectors[idx];
  }

  applyQuality(preset = 'high') {
    const p = preset === 'med' ? 'medium' : preset;
    const factor = p === 'low' ? 0.45 : (p === 'medium' ? 0.75 : 1.0);
    for (const entry of this.scalableInstances) {
      const unit = entry.unit || 1;
      const scaled = Math.floor((entry.fullCount * factor) / unit) * unit;
      entry.mesh.count = Math.max(unit, Math.min(entry.fullCount, scaled));
    }
  }

  isClearOfRoadXZ(x, z, minClearance = 18) {
    const samples = this.spline.samples || [];
    const minSq = minClearance * minClearance;
    for (let i = 0; i < samples.length; i += 4) {
      const p = samples[i].position;
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < minSq) return false;
    }
    return true;
  }

  initWaterShader() {
    // Large animated ocean plane extending into the horizon (optimized segment count)
    const waterGeo = new THREE.PlaneGeometry(3600, 3600, 16, 16);
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
    const stepsS = Math.floor(totalLen / 20.0);
    const stepsD = 4;
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

    const rockGeo = new THREE.DodecahedronGeometry(2.2, 0);
    const foamGeo = new THREE.RingGeometry(2.3, 3.4, 8);
    foamGeo.rotateX(-Math.PI / 2);

    const rockCount = Math.floor(totalLen / 55);
    const instancedRocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    const instancedFoam = new THREE.InstancedMesh(foamGeo, foamMat, rockCount);
    this.scalableInstances.push({ mesh: instancedRocks, fullCount: rockCount }, { mesh: instancedFoam, fullCount: rockCount });

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
    const stepsS = Math.floor(totalLen / 18.0);
    const stepsD = 8;
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
    const wallSteps = Math.floor(totalLen / 16.0);
    const wallGeo = new THREE.BoxGeometry(0.55, 0.85, 16.2);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 });
    const instancedWall = new THREE.InstancedMesh(wallGeo, wallMat, wallSteps);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < wallSteps; i++) {
      const s = i * 16.0 + 8.0;
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

    // Street Lamps with Glowing Lanterns (optimized spacing & segment count)
    const lampCount = Math.floor(totalLen / 64);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.85, roughness: 0.25 });
    const lanternMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });

    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7.0, 5);
    poleGeo.translate(0, 3.5, 0);

    const armGeo = new THREE.BoxGeometry(2.4, 0.12, 0.12);
    armGeo.translate(1.0, 6.8, 0);

    const lanternGeo = new THREE.BoxGeometry(0.65, 0.22, 0.45);
    lanternGeo.translate(2.1, 6.6, 0);

    const instancedPoles = new THREE.InstancedMesh(poleGeo, postMat, lampCount * 2);
    const instancedArms = new THREE.InstancedMesh(armGeo, postMat, lampCount * 2);
    const instancedLanterns = new THREE.InstancedMesh(lanternGeo, lanternMat, lampCount * 2);
    this.scalableInstances.push(
      { mesh: instancedPoles, fullCount: lampCount * 2, unit: 2 },
      { mesh: instancedArms, fullCount: lampCount * 2, unit: 2 },
      { mesh: instancedLanterns, fullCount: lampCount * 2, unit: 2 }
    );

    for (let i = 0; i < lampCount; i++) {
      const s = i * 64 + 12;
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

    // 1. W-Beam Metal Guardrail Rails (optimized 10m step + 4-quadrant culling)
    const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.3 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.4 });

    const stepS = 10.0;
    const count = Math.floor(totalLen / stepS);

    const railGeo = new THREE.BoxGeometry(0.12, 0.42, stepS + 0.1);
    railGeo.translate(0, 0.72, stepS / 2);

    const postGeo = new THREE.BoxGeometry(0.14, 1.15, 0.14);
    postGeo.translate(0, 0.55, 0);

    const curbMat = new THREE.MeshStandardMaterial({
      roughness: 0.8,
      vertexColors: true
    });
    const curbGeo = new THREE.BoxGeometry(0.40, 0.22, stepS);
    curbGeo.translate(0, 0.11, stepS / 2);
    const curbCols = new Float32Array(curbGeo.attributes.position.count * 3);
    const yellow = new THREE.Color(0xfacc15);
    const black = new THREE.Color(0x18181b);
    for (let i = 0; i < curbGeo.attributes.position.count; i++) {
      const z = curbGeo.attributes.position.getZ(i);
      const isYellow = Math.floor(z / 2.5) % 2 === 0;
      const col = isYellow ? yellow : black;
      curbCols[i * 3] = col.r;
      curbCols[i * 3 + 1] = col.g;
      curbCols[i * 3 + 2] = col.b;
    }
    curbGeo.setAttribute('color', new THREE.BufferAttribute(curbCols, 3));

    const numQuads = 6;
    const itemsPerQuad = Math.ceil(count / numQuads);
    this.quadrants = [];
    const dummy = new THREE.Object3D();

    for (let q = 0; q < numQuads; q++) {
      const startI = q * itemsPerQuad;
      const endI = Math.min(count, (q + 1) * itemsPerQuad);
      const sliceLen = Math.max(0, endI - startI);
      if (sliceLen === 0) continue;

      const sMid = ((startI + endI) * 0.5) * stepS;
      const midFrame = this.spline.getFrameAtDistance(sMid);
      const qGroup = new THREE.Group();
      this.group.add(qGroup);

      const rails = new THREE.InstancedMesh(railGeo, railMat, sliceLen * 2);
      const posts = new THREE.InstancedMesh(postGeo, postMat, sliceLen * 2);
      const curbs = new THREE.InstancedMesh(curbGeo, curbMat, sliceLen * 2);

      for (let localIdx = 0; localIdx < sliceLen; localIdx++) {
        const s = (startI + localIdx) * stepS;
        const frame = this.spline.getFrameAtDistance(s);
        dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);

        dummy.position.copy(frame.position).addScaledVector(frame.binormal, -halfWidth - 0.28);
        dummy.updateMatrix();
        rails.setMatrixAt(localIdx * 2, dummy.matrix);
        posts.setMatrixAt(localIdx * 2, dummy.matrix);

        dummy.position.copy(frame.position).addScaledVector(frame.binormal, halfWidth + 0.28);
        dummy.updateMatrix();
        rails.setMatrixAt(localIdx * 2 + 1, dummy.matrix);
        posts.setMatrixAt(localIdx * 2 + 1, dummy.matrix);

        dummy.position.copy(frame.position).addScaledVector(frame.binormal, -halfWidth);
        dummy.updateMatrix();
        curbs.setMatrixAt(localIdx * 2, dummy.matrix);

        dummy.position.copy(frame.position).addScaledVector(frame.binormal, halfWidth);
        dummy.updateMatrix();
        curbs.setMatrixAt(localIdx * 2 + 1, dummy.matrix);
      }

      rails.instanceMatrix.needsUpdate = true;
      posts.instanceMatrix.needsUpdate = true;
      curbs.instanceMatrix.needsUpdate = true;
      qGroup.add(rails, posts, curbs);

      this.quadrants.push({
        group: qGroup,
        center: midFrame.position.clone(),
        radius: (totalLen / (numQuads * 2)) + 85
      });
    }

    // 3. Reflective Cat's Eyes Road Studs down the lanes
    const studMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const studGeo = new THREE.BoxGeometry(0.14, 0.05, 0.22);
    const studCount = Math.floor(totalLen / 24);
    const instancedStuds = new THREE.InstancedMesh(studGeo, studMat, studCount * 2);

    for (let i = 0; i < studCount; i++) {
      const s = i * 24;
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

    // 2. Roadside Tea Stalls / Dhabas (merged per stall, sector-culled)
    const stallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide });
    const stallLocations = [450, 1350, 2250];
    stallLocations.forEach((s, idx) => {
      const frame = this.spline.getFrameAtDistance(s);
      const shackG = new THREE.BoxGeometry(4.5, 2.4, 3.2);
      const awningG = new THREE.PlaneGeometry(5.2, 4.0);
      const scooterG = new THREE.BoxGeometry(0.6, 0.8, 1.6);
      const stallGeo = mergeColoredParts([
        { geo: shackG, color: 0x5a3d28, pos: [0, 1.2, 0] },
        { geo: awningG, color: idx % 2 === 0 ? 0x0284c7 : 0xea580c, pos: [0, 2.7, 1.4], rot: [Math.PI / 3.2, 0, 0] },
        { geo: scooterG, color: 0x5a3d28, pos: [2.8, 0.4, 1.8] }
      ]);
      shackG.dispose();
      awningG.dispose();
      scooterG.dispose();

      const stallMesh = new THREE.Mesh(stallGeo, stallMat);
      const pos = frame.position.clone().addScaledVector(frame.binormal, halfWidth + 5.5);
      stallMesh.position.copy(pos);
      stallMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      (this.getSectorForS(s)?.group || this.group).add(stallMesh);
    });

    // 3. Highway Billboards (merged pillars + sign per billboard, sector-culled)
    const billboardLocations = [320, 1100, 1950];
    const billboardMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.45 });
    const bbPillarG = new THREE.CylinderGeometry(0.28, 0.28, 12, 8);
    const bbBoardG = new THREE.BoxGeometry(9.5, 4.2, 0.25);

    billboardLocations.forEach((s, idx) => {
      const frame = this.spline.getFrameAtDistance(s);
      const boardCol = idx === 0 ? 0x0284c7 : (idx === 1 ? 0xe11d48 : 0xd97706);
      const bbGeo = mergeColoredParts([
        { geo: bbPillarG, color: 0x334155, pos: [-3.2, 6.0, 0] },
        { geo: bbPillarG, color: 0x334155, pos: [3.2, 6.0, 0] },
        { geo: bbBoardG, color: boardCol, pos: [0, 9.6, 0] }
      ]);

      const bbMesh = new THREE.Mesh(bbGeo, billboardMat);
      const pos = frame.position.clone().addScaledVector(frame.binormal, halfWidth + 8.5);
      bbMesh.position.copy(pos);
      bbMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent);
      (this.getSectorForS(s)?.group || this.group).add(bbMesh);
    });
    bbPillarG.dispose();
    bbBoardG.dispose();

    // 4. Overhead Highway Gantry Sign (merged pillars + truss beam + board, sector-culled)
    const gantryFrame = this.spline.getFrameAtDistance(720);
    const gantryWidth = this.roadWidth + 4.5;
    const gPillarG = new THREE.CylinderGeometry(0.25, 0.25, 9.0, 8);
    const gBeamG = new THREE.BoxGeometry(gantryWidth + 1.2, 0.55, 0.55);
    const gBoardG = new THREE.BoxGeometry(7.2, 1.8, 0.12);
    const gantryGeo = mergeColoredParts([
      { geo: gPillarG, color: 0x334155, pos: [-gantryWidth / 2, 4.5, 0] },
      { geo: gPillarG, color: 0x334155, pos: [gantryWidth / 2, 4.5, 0] },
      { geo: gBeamG, color: 0x334155, pos: [0, 8.5, 0] },
      { geo: gBoardG, color: 0x15803d, pos: [0, 8.4, 0] }
    ]);
    gPillarG.dispose();
    gBeamG.dispose();
    gBoardG.dispose();

    const gantryMesh = new THREE.Mesh(gantryGeo, billboardMat);
    gantryMesh.position.copy(gantryFrame.position);
    gantryMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), gantryFrame.tangent);
    (this.getSectorForS(720)?.group || this.group).add(gantryMesh);
  }

  initBoatsAndLighthouse() {
    // 1. Bobbing Coastal Fishing Boats with Triangular White Sails (merged 1 mesh per boat)
    const boatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, side: THREE.DoubleSide });
    const hullG = new THREE.BoxGeometry(2.4, 1.2, 6.2);
    const mastG = new THREE.CylinderGeometry(0.08, 0.08, 5.0, 6);
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 1.0, 0.2,
      0, 5.2, 0.2,
      0, 1.2, 3.2
    ]), 3));
    sailGeo.computeVertexNormals();
    const boatGeo = mergeColoredParts([
      { geo: hullG, color: 0x5c4033, pos: [0, 0.6, 0] },
      { geo: mastG, color: 0x5c4033, pos: [0, 3.0, 0.2] },
      { geo: sailGeo, color: 0xfef3c7 }
    ]);
    hullG.dispose();
    mastG.dispose();
    sailGeo.dispose();

    this.boats = [];
    const boatCoords = [
      { x: -160, z: 280, seed: 1.2 },
      { x: -240, z: 700, seed: 3.5 },
      { x: -190, z: 1250, seed: 5.1 },
      { x: -280, z: 1750, seed: 2.8 }
    ];

    boatCoords.forEach(c => {
      const boatMesh = new THREE.Mesh(boatGeo, boatMat);
      boatMesh.position.set(c.x, -2.8, c.z);
      this.group.add(boatMesh);
      this.boats.push({ mesh: boatMesh, baseY: -2.8, seed: c.seed });
    });

    // 2. Distant Cargo Container Ship on Ocean Horizon (merged 1 mesh)
    const shipHullG = new THREE.BoxGeometry(18, 5, 80);
    const shipBridgeG = new THREE.BoxGeometry(14, 12, 18);
    const shipGeo = mergeColoredParts([
      { geo: shipHullG, color: 0x1e293b, pos: [0, 2.5, 0] },
      { geo: shipBridgeG, color: 0xf8fafc, pos: [0, 10, -22] }
    ]);
    shipHullG.dispose();
    shipBridgeG.dispose();
    const shipMesh = new THREE.Mesh(shipGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    shipMesh.position.set(-950, -2.6, 1000);
    shipMesh.rotation.y = -0.35;
    this.group.add(shipMesh);

    // 3. Coastal Lighthouse with Rotating Dusk Spotlight Beam (tower merged into 1 mesh)
    const lhGroup = new THREE.Group();
    const towerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });

    const h1G = new THREE.CylinderGeometry(3.2, 4.4, 9, 8);
    const h2G = new THREE.CylinderGeometry(2.4, 3.2, 9, 8);
    const h3G = new THREE.CylinderGeometry(1.8, 2.4, 9, 8);
    const towerGeo = mergeColoredParts([
      { geo: h1G, color: 0xf8fafc, pos: [0, 4.5, 0] },
      { geo: h2G, color: 0xd90429, pos: [0, 13.5, 0] },
      { geo: h3G, color: 0xf8fafc, pos: [0, 22.5, 0] }
    ]);
    h1G.dispose();
    h2G.dispose();
    h3G.dispose();
    lhGroup.add(new THREE.Mesh(towerGeo, towerMat));

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

    // Curved slender trunk geometry (optimized 6-seg cylinder + 22m spacing)
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 7.5, 6);
    trunkGeo.translate(0, 3.75, 0);

    const frondGeo = new THREE.PlaneGeometry(0.85, 3.8);
    frondGeo.translate(0, 1.9, 0);
    frondGeo.rotateX(Math.PI / 2.6);

    const palmSpacing = 24;
    const palmCount = Math.floor(totalLen / palmSpacing);
    const instancedTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmCount * 2);
    const instancedFronds = new THREE.InstancedMesh(frondGeo, frondMat, palmCount * 2 * 6);
    this.scalableInstances.push(
      { mesh: instancedTrunks, fullCount: palmCount * 2, unit: 2 },
      { mesh: instancedFronds, fullCount: palmCount * 2 * 6, unit: 12 }
    );

    const dummy = new THREE.Object3D();
    const frondDummy = new THREE.Object3D();

    let frondIdx = 0;
    for (let i = 0; i < palmCount; i++) {
      const s = i * palmSpacing + (Math.sin(i * 1.8) * 6);
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

  initCornerChevrons() {
    const corners = this.spline.corners || [];
    if (corners.length === 0) return;

    const placements = [];
    const halfW = this.roadWidth / 2;
    for (const c of corners) {
      const outsideSign = c.direction === 'left' ? 1 : -1;
      const offsets = c.severity >= 2 ? [-42, -16, 10] : [-38, -12];
      for (const off of offsets) {
        const s = this.spline.wrapDistance(c.startS + off);
        placements.push({ s, outsideSign, direction: c.direction, d: outsideSign * (halfW + 1.15) });
      }
    }

    if (placements.length === 0) return;

    // Procedural high-contrast yellow/black reflective chevron texture pointing left (<)
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#facc15';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 118, 118);
    ctx.lineWidth = 22;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(86, 22);
    ctx.lineTo(36, 64);
    ctx.lineTo(86, 106);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;

    const postGeo = new THREE.CylinderGeometry(0.055, 0.055, 2.2, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.5 });
    const panelGeo = new THREE.BoxGeometry(1.15, 1.05, 0.08);
    const panelMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.35,
      emissive: new THREE.Color(0x423000),
      emissiveIntensity: 0.45
    });

    const posts = new THREE.InstancedMesh(postGeo, postMat, placements.length);
    const panels = new THREE.InstancedMesh(panelGeo, panelMat, placements.length);
    const dummy = new THREE.Object3D();

    placements.forEach((p, idx) => {
      const frame = this.spline.getFrameAtDistance(p.s);
      const pos = frame.position.clone().addScaledVector(frame.binormal, p.d);

      dummy.position.set(pos.x, pos.y + 1.1, pos.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      posts.setMatrixAt(idx, dummy.matrix);

      // Face back toward approaching riders (-tangent)
      dummy.position.set(pos.x, pos.y + 1.95, pos.z);
      const lookTarget = dummy.position.clone().sub(frame.tangent);
      dummy.lookAt(lookTarget);
      if (p.direction === 'right') {
        dummy.rotateZ(Math.PI);
      }
      dummy.updateMatrix();
      panels.setMatrixAt(idx, dummy.matrix);
    });

    posts.instanceMatrix.needsUpdate = true;
    panels.instanceMatrix.needsUpdate = true;
    this.cornerChevrons = placements;
    this.group.add(posts, panels);
  }

  initMonsoonScenery() {
    const halfW = this.roadWidth / 2;
    const totalLen = this.spline.totalLength;

    // 1. Lush wet emerald mountain cliff ribbon along right shoulder & misty gorge floor on left
    const steps = 220;
    const cliffCols = [halfW + 2.2, halfW + 10, halfW + 26, halfW + 58];
    const cliffHeights = [-0.4, 8.5, 24.0, 46.0];
    const verts = new Float32Array((steps + 1) * 4 * 3);
    const cols = new Float32Array((steps + 1) * 4 * 3);
    const colBase = new THREE.Color(0x1f3a26);
    const colHigh = new THREE.Color(0x14532d);
    const colMoss = new THREE.Color(0x2d4a32);

    let ptr = 0;
    for (let i = 0; i <= steps; i++) {
      const s = (i / steps) * totalLen;
      const frame = this.spline.getFrameAtDistance(s);
      for (let j = 0; j < 4; j++) {
        const d = cliffCols[j];
        const noise = Math.sin(s * 0.045 + j * 1.9) * 2.8 + Math.cos(s * 0.11 + j) * 1.4;
        const pos = frame.position.clone()
          .addScaledVector(frame.binormal, d)
          .addScaledVector(frame.normal, cliffHeights[j] + (j > 0 ? noise : 0));
        verts[ptr * 3] = pos.x;
        verts[ptr * 3 + 1] = pos.y;
        verts[ptr * 3 + 2] = pos.z;

        const c = j === 0 ? colMoss : (j >= 2 ? colHigh : colBase);
        cols[ptr * 3] = c.r;
        cols[ptr * 3 + 1] = c.g;
        cols[ptr * 3 + 2] = c.b;
        ptr++;
      }
    }

    const indices = [];
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < 3; j++) {
        const r1 = i * 4 + j;
        const r2 = (i + 1) * 4 + j;
        indices.push(r1, r2, r1 + 1, r1 + 1, r2, r2 + 1);
      }
    }
    const cliffGeo = new THREE.BufferGeometry();
    cliffGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    cliffGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    cliffGeo.setIndex(indices);
    cliffGeo.computeVertexNormals();
    const cliffMesh = new THREE.Mesh(
      cliffGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true })
    );
    this.group.add(cliffMesh);

    // Misty valley plane underneath
    const valley = new THREE.Mesh(
      new THREE.PlaneGeometry(3200, 3200),
      new THREE.MeshStandardMaterial({ color: 0x28363c, roughness: 0.95 })
    );
    valley.rotation.x = -Math.PI / 2;
    valley.position.y = -28;
    this.group.add(valley);

    // 2. Animated Roadside Waterfalls (4 cascades down right-side cliffs + misty spray)
    const wfCanvas = document.createElement('canvas');
    wfCanvas.width = 64;
    wfCanvas.height = 128;
    const wctx = wfCanvas.getContext('2d');
    const grad = wctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(186, 230, 253, 0.85)');
    grad.addColorStop(0.5, 'rgba(224, 242, 254, 0.92)');
    grad.addColorStop(1, 'rgba(241, 245, 249, 0.25)');
    wctx.fillStyle = grad;
    wctx.fillRect(0, 0, 64, 128);
    wctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    for (let y = 0; y < 128; y += 16) {
      wctx.fillRect(10 + (y % 24), y, 8, 12);
      wctx.fillRect(38 - (y % 18), y + 4, 6, 10);
    }
    const wfTex = new THREE.CanvasTexture(wfCanvas);
    wfTex.wrapS = THREE.RepeatWrapping;
    wfTex.wrapT = THREE.RepeatWrapping;

    const wfMat = new THREE.MeshBasicMaterial({
      map: wfTex,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide
    });
    const mistMat = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    });

    const wfCount = 4;
    for (let i = 0; i < wfCount; i++) {
      const s = ((i + 0.5) / wfCount) * totalLen;
      const frame = this.spline.getFrameAtDistance(s);
      const wfPos = frame.position.clone()
        .addScaledVector(frame.binormal, halfW + 9.5)
        .addScaledVector(frame.normal, 12.0);
      const wfMesh = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 24), wfMat);
      wfMesh.position.copy(wfPos);
      wfMesh.lookAt(wfPos.clone().sub(frame.binormal));
      wfMesh.rotateX(-0.22);

      const spray = new THREE.Mesh(new THREE.SphereGeometry(4.2, 8, 6), mistMat);
      spray.position.copy(frame.position)
        .addScaledVector(frame.binormal, halfW + 4.8)
        .addScaledVector(frame.normal, 0.8);
      spray.scale.set(1.5, 0.65, 1.5);

      this.group.add(wfMesh, spray);
      this.waterfalls.push({ tex: wfTex, spray, seed: i * 1.7 });
    }

    // 3. Instanced wet boulders & monsoon foliage
    const boulderGeo = new THREE.DodecahedronGeometry(1.4, 0);
    const boulderMat = new THREE.MeshStandardMaterial({ color: 0x3f4742, roughness: 0.65, flatShading: true });
    const boulderCount = 45;
    const boulders = new THREE.InstancedMesh(boulderGeo, boulderMat, boulderCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < boulderCount; i++) {
      const s = (i / boulderCount) * totalLen;
      const frame = this.spline.getFrameAtDistance(s);
      const pos = frame.position.clone()
        .addScaledVector(frame.binormal, halfW + 3.2 + (i % 3) * 1.4)
        .addScaledVector(frame.normal, 0.5);
      dummy.position.copy(pos);
      dummy.rotation.set(i * 0.7, i * 1.2, 0);
      dummy.scale.set(0.8 + (i % 3) * 0.35, 0.65 + (i % 2) * 0.3, 0.9);
      dummy.updateMatrix();
      boulders.setMatrixAt(i, dummy.matrix);
    }
    boulders.instanceMatrix.needsUpdate = true;
    this.group.add(boulders);
  }

  initNeonScenery() {
    const halfW = this.roadWidth / 2;
    const totalLen = this.spline.totalLength;

    // 1. Glowing Neon Rim Strips along left (magenta) and right (cyan) barriers
    const steps = 260;
    const buildNeonStrip = (dOffset, hexColor) => {
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const s = (i / steps) * totalLen;
        const frame = this.spline.getFrameAtDistance(s);
        const pos = frame.position.clone()
          .addScaledVector(frame.binormal, dOffset)
          .addScaledVector(frame.normal, 0.85);
        pts.push(pos);
      }
      const curve = new THREE.CatmullRomCurve3(pts, true);
      const geo = new THREE.TubeGeometry(curve, 220, 0.11, 5, true);
      const mat = new THREE.MeshBasicMaterial({ color: hexColor });
      this.neonGlowMats.push(mat);
      this.group.add(new THREE.Mesh(geo, mat));
    };
    buildNeonStrip(-(halfW + 0.55), 0xd946ef);
    buildNeonStrip(halfW + 0.55, 0x06b6d4);

    // Ground city dark slab
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3400, 3400),
      new THREE.MeshStandardMaterial({ color: 0x070a14, roughness: 0.85 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -18;
    this.group.add(ground);

    // 2. Instanced Emissive Skyscrapers (strictly clear of closed highway loops)
    const winCanvas = document.createElement('canvas');
    winCanvas.width = 128;
    winCanvas.height = 256;
    const ctx = winCanvas.getContext('2d');
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, 128, 256);
    const palette = ['#38bdf8', '#e879f9', '#fbbf24', '#22d3ee'];
    for (let y = 10; y < 246; y += 16) {
      for (let x = 10; x < 118; x += 18) {
        if ((x * 7 + y * 13) % 5 !== 0) {
          ctx.fillStyle = palette[(x + y) % palette.length];
          ctx.fillRect(x, y, 10, 9);
        }
      }
    }
    const winTex = new THREE.CanvasTexture(winCanvas);
    winTex.wrapS = THREE.RepeatWrapping;
    winTex.wrapT = THREE.RepeatWrapping;
    winTex.repeat.set(2, 5);

    const bldgGeo = new THREE.BoxGeometry(14, 1, 14);
    const bldgMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      map: winTex,
      emissive: new THREE.Color(0x38bdf8),
      emissiveMap: winTex,
      emissiveIntensity: 0.95,
      roughness: 0.35,
      metalness: 0.4
    });

    const bldgMatrices = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 110; i++) {
      const s = (i / 110) * totalLen;
      const frame = this.spline.getFrameAtDistance(s);
      for (const side of [-1, 1]) {
        const distOut = halfW + 24 + ((i * 19 + (side > 0 ? 7 : 3)) % 28);
        const pos = frame.position.clone().addScaledVector(frame.binormal, side * distOut);
        if (!this.isClearOfRoadXZ(pos.x, pos.z, halfW + 15)) continue;
        const h = 38 + ((i * 23 + (side > 0 ? 11 : 0)) % 75);
        dummy.position.set(pos.x, pos.y + h * 0.5 - 12, pos.z);
        dummy.rotation.set(0, (i * 0.4) % Math.PI, 0);
        dummy.scale.set(0.9 + (i % 3) * 0.35, h, 0.9 + ((i + 1) % 3) * 0.35);
        dummy.updateMatrix();
        bldgMatrices.push(dummy.matrix.clone());
      }
    }

    if (bldgMatrices.length > 0) {
      const bldgs = new THREE.InstancedMesh(bldgGeo, bldgMat, bldgMatrices.length);
      bldgMatrices.forEach((m, idx) => bldgs.setMatrixAt(idx, m));
      bldgs.instanceMatrix.needsUpdate = true;
      this.group.add(bldgs);
    }

    // 3. Instanced Highway Streetlights every 65m
    const lampSpacing = 65;
    const lampCount = Math.floor(totalLen / lampSpacing);
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7.2, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 });
    const headGeo = new THREE.BoxGeometry(2.4, 0.22, 0.45);
    const headMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampCount * 2);
    const heads = new THREE.InstancedMesh(headGeo, headMat, lampCount * 2);
    let lIdx = 0;
    for (let i = 0; i < lampCount; i++) {
      const s = i * lampSpacing;
      const frame = this.spline.getFrameAtDistance(s);
      for (const side of [-1, 1]) {
        const base = frame.position.clone().addScaledVector(frame.binormal, side * (halfW + 1.4));
        dummy.position.set(base.x, base.y + 3.6, base.z);
        dummy.rotation.set(0, Math.atan2(frame.tangent.x, frame.tangent.z), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poles.setMatrixAt(lIdx, dummy.matrix);

        const headPos = frame.position.clone()
          .addScaledVector(frame.binormal, side * (halfW + 0.3))
          .addScaledVector(frame.normal, 7.1);
        dummy.position.copy(headPos);
        dummy.lookAt(headPos.clone().add(frame.tangent));
        dummy.rotateY(Math.PI / 2);
        dummy.updateMatrix();
        heads.setMatrixAt(lIdx, dummy.matrix);
        lIdx++;
      }
    }
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    this.group.add(poles, heads);
  }

  update(dt, timeSec = 0, camera = null) {
    // 0. Behind-camera spatial sector & quadrant culling
    if (camera) {
      if (!this._camDir) {
        this._camDir = new THREE.Vector3();
        this._toSec = new THREE.Vector3();
      }
      camera.getWorldDirection(this._camDir);
      const cullList = (list) => {
        if (!list) return;
        for (const sec of list) {
          this._toSec.subVectors(sec.center, camera.position);
          const distSq = this._toSec.lengthSq();
          const inside = distSq < sec.radius * sec.radius;
          sec.group.visible = inside || this._camDir.dot(this._toSec) >= -sec.radius * 0.65;
        }
      };
      cullList(this.sectors);
      cullList(this.quadrants);
    }

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

    // 4. Animate Monsoon Waterfalls & Mist Spray
    if (this.waterfalls && this.waterfalls.length > 0) {
      this.waterfalls[0].tex.offset.y = -(timeSec * 1.6) % 1;
      for (const wf of this.waterfalls) {
        wf.spray.scale.setScalar(1.0 + Math.sin(timeSec * 4.2 + wf.seed) * 0.14);
      }
    }

    // 5. Animate Finish Gantry Flags
    if (this.finishFlags) {
      for (const f of this.finishFlags) {
        f.mesh.rotation.y = (f.side === 1 ? Math.PI : 0) + Math.sin(timeSec * 6.5 + f.side) * 0.28;
      }
    }
  }

  dispose() {
    if (this.scene && this.group) {
      this.scene.remove(this.group);
    }
    const geos = new Set();
    const mats = new Set();
    this.group?.traverse((child) => {
      if (child.geometry && !geos.has(child.geometry)) {
        geos.add(child.geometry);
        child.geometry.dispose();
      }
      if (child.material) {
        const list = Array.isArray(child.material) ? child.material : [child.material];
        list.forEach(m => {
          if (!mats.has(m)) {
            mats.add(m);
            m.map?.dispose();
            m.emissiveMap?.dispose();
            m.dispose();
          }
        });
      }
    });
  }
}
