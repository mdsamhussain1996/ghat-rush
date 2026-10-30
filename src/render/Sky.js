import * as THREE from 'three';

/**
 * Sky & Atmospheric Lighting (Phase 1 Visual Upgrade)
 * Matches concept_coast.png:
 * - Gradient sky dome: deep twilight purple/indigo zenith -> warm salmon/coral -> radiant golden horizon
 * - fog: false on sky so it stays crisp and vivid
 * - Visible glowing sun disc low over the sea with radial halo & horizontal anamorphic flare
 * - 2 layers of slow-moving clouds lit with golden light from below
 * - Directional sunlight angled to warmly illuminate the right-side hills and track
 */
export class Sky {
  constructor(scene, envType = 'coastal') {
    this.scene = scene;
    this.envType = envType;
    this.cloudTime = 0;

    this.initLighting();
    this.initSkyDome();
    this.initClouds();
  }

  initLighting() {
    // 1. Hemisphere Light: warm golden sky illumination + soft ocean turquoise bounce
    this.hemiLight = new THREE.HemisphereLight(0xffd8a8, 0x1e40af, 0.95);
    this.scene.add(this.hemiLight);

    // 2. Directional Sun Light (Warm sunset sun low over the sea on the left)
    // Angled across the highway so the right-side hills are brightly sunlit (no black faces)
    this.sunLight = new THREE.DirectionalLight(0xffecd1, 1.6);
    this.sunLight.position.set(-240, 110, 80);
    this.sunLight.castShadow = true;

    const d = 50;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 500;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.bias = -0.0006;

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // 3. Sunset Atmospheric Distance Fog (warm golden haze)
    this.scene.fog = new THREE.Fog(0xf59e6b, 240, 1600);
  }

  initSkyDome() {
    // Large hemisphere dome with vibrant sunset gradient
    const skyGeo = new THREE.SphereGeometry(1500, 36, 20);
    const count = skyGeo.attributes.position.count;
    const colors = new Float32Array(count * 3);

    const pos = skyGeo.attributes.position;
    // Dusk / sunset color stops matching concept_coast.png
    const zenithCol = new THREE.Color(0x6d4c6d);  // Soft twilight violet
    const upperCol = new THREE.Color(0x946b88);   // Muted rose-purple
    const roseCol = new THREE.Color(0xc27ba0);    // Warm pastel rose
    const coralCol = new THREE.Color(0xeb967a);   // Soft salmon-peach
    const sunsetOrange = new THREE.Color(0xf6ad67); // Warm golden orange
    const horizonAmber = new THREE.Color(0xfde047); // Glowing golden horizon
    const groundCol = new THREE.Color(0x422838);   // Warm ground fade

    for (let i = 0; i < count; i++) {
      const y = pos.getY(i) / 1500; // -1 to 1

      const c = new THREE.Color();
      if (y > 0.65) {
        c.lerpColors(upperCol, zenithCol, (y - 0.65) / 0.35);
      } else if (y > 0.35) {
        c.lerpColors(roseCol, upperCol, (y - 0.35) / 0.30);
      } else if (y > 0.15) {
        c.lerpColors(coralCol, roseCol, (y - 0.15) / 0.20);
      } else if (y > 0.02) {
        c.lerpColors(sunsetOrange, coralCol, (y - 0.02) / 0.13);
      } else if (y > -0.05) {
        c.lerpColors(horizonAmber, sunsetOrange, (y + 0.05) / 0.07);
      } else {
        c.lerpColors(horizonAmber, groundCol, THREE.MathUtils.clamp(-y * 4, 0, 1));
      }

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // fog: false ensures sky gradient is NEVER washed out by distance fog
    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });

    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyMesh);

    // 4. Visible Glowing Sun Disc (Low over ocean horizon on the left)
    const sunPos = new THREE.Vector3(-920, 85, 480);

    const sunDiscGeo = new THREE.CircleGeometry(58, 32);
    const sunDiscMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false
    });
    this.sunDisc = new THREE.Mesh(sunDiscGeo, sunDiscMat);
    this.sunDisc.position.copy(sunPos);
    this.sunDisc.lookAt(0, 85, 0);
    this.skyMesh.add(this.sunDisc);

    // Soft Circular Golden Sun Halo
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = 128;
    haloCanvas.height = 128;
    const hctx = haloCanvas.getContext('2d');
    const grad = hctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 240, 200, 0.95)');
    grad.addColorStop(0.35, 'rgba(251, 191, 36, 0.65)');
    grad.addColorStop(0.7, 'rgba(249, 115, 22, 0.25)');
    grad.addColorStop(1, 'rgba(249, 115, 22, 0.0)');
    hctx.fillStyle = grad;
    hctx.fillRect(0, 0, 128, 128);

    const haloTex = new THREE.CanvasTexture(haloCanvas);
    const haloMat = new THREE.MeshBasicMaterial({
      map: haloTex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });
    const haloMesh = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), haloMat);
    haloMesh.position.copy(sunPos);
    haloMesh.quaternion.copy(this.sunDisc.quaternion);
    this.skyMesh.add(haloMesh);

    // Horizontal Anamorphic Lens Flare Streak (Matching concept_coast.png)
    const flareGeo = new THREE.PlaneGeometry(540, 20);
    const flareMat = new THREE.MeshBasicMaterial({
      color: 0xffedd5,
      transparent: true,
      opacity: 0.70,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false
    });
    const flare = new THREE.Mesh(flareGeo, flareMat);
    flare.position.copy(sunPos);
    flare.quaternion.copy(this.sunDisc.quaternion);
    this.skyMesh.add(flare);
  }

  initClouds() {
    // 2 Layers of slow-moving clouds lit with warm golden under-glow
    this.cloudGroup = new THREE.Group();
    this.skyMesh.add(this.cloudGroup);

    const cloudTex = this.generateCloudTexture();

    // Layer 1: Low golden clouds
    const mat1 = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.45,
      color: 0xfdba74, // Warm peach-orange
      depthWrite: false,
      fog: false
    });

    // Layer 2: High wispy sunset clouds
    const mat2 = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.35,
      color: 0xf472b6, // Rose-pink twilight
      depthWrite: false,
      fog: false
    });

    this.cloudPlanes = [];

    // Distribute cloud planes across the upper sky
    const configs = [
      { y: 260, x: -350, z: 250, size: 480, mat: mat1, speed: 0.012 },
      { y: 320, x: 200, z: 450, size: 550, mat: mat1, speed: 0.015 },
      { y: 380, x: -500, z: 800, size: 620, mat: mat1, speed: 0.010 },
      { y: 440, x: -100, z: 600, size: 680, mat: mat2, speed: 0.008 },
      { y: 490, x: 350, z: 900, size: 750, mat: mat2, speed: 0.006 }
    ];

    configs.forEach(c => {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(c.size, c.size * 0.42), c.mat);
      plane.position.set(c.x, c.y, c.z);
      plane.rotation.x = Math.PI / 2;
      this.cloudGroup.add(plane);
      this.cloudPlanes.push({ mesh: plane, baseX: c.x, speed: c.speed });
    });
  }

  generateCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, 256, 128);

    // Draw fluffy overlapping soft circles
    const circles = [
      { x: 70, y: 70, r: 42, a: 0.4 },
      { x: 110, y: 55, r: 52, a: 0.5 },
      { x: 160, y: 60, r: 48, a: 0.45 },
      { x: 200, y: 75, r: 38, a: 0.35 },
      { x: 135, y: 75, r: 40, a: 0.55 }
    ];

    circles.forEach(c => {
      const g = ctx.createRadialGradient(c.x, c.y, c.r * 0.2, c.x, c.y, c.r);
      g.addColorStop(0, `rgba(255, 255, 255, ${c.a})`);
      g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  update(playerBike) {
    if (!playerBike || !playerBike.group) return;

    // Follow player position so sky dome and sun shadow box travel with the bike
    const pos = playerBike.group.position;
    this.skyMesh.position.copy(pos);

    // Shift sun shadow target along with bike
    this.sunLight.target.position.copy(pos);
    this.sunLight.position.set(pos.x - 220, pos.y + 120, pos.z + 80);

    // Slowly drift clouds horizontally
    this.cloudTime += 0.016;
    if (this.cloudPlanes) {
      this.cloudPlanes.forEach(c => {
        c.mesh.position.x = c.baseX + Math.sin(this.cloudTime * c.speed) * 45;
      });
    }
  }
}
