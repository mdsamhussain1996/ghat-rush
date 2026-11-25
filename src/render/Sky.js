import * as THREE from 'three';

/**
 * Sky & Atmospheric Lighting
 * Supports three environment presets:
 * - 'coastal': Golden Konkan sunset dome, directional sun over sea, warm haze
 * - 'monsoon': Dark stormy slate sky, dense mist fog, 3D falling rain particles
 * - 'neon': Midnight indigo expressway sky, violet/cyan horizon glow, night fog
 */
export class Sky {
  constructor(scene, envType = 'coastal') {
    this.scene = scene;
    this.envType = envType;
    this.cloudTime = 0;
    this.rainSystem = null;
    this.rainPositions = null;
    this.rainCount = 900;

    this.initLighting();
    this.initSkyDome();
    this.initClouds();
    if (this.envType === 'monsoon') {
      this.initRain();
    }
  }

  initLighting() {
    if (this.envType === 'monsoon') {
      this.hemiLight = new THREE.HemisphereLight(0x94a3b8, 0x1e293b, 0.92);
      this.scene.add(this.hemiLight);

      this.sunLight = new THREE.DirectionalLight(0xcbd5e1, 1.05);
      this.sunLight.position.set(-140, 180, 90);
      this.scene.fog = new THREE.Fog(0x4b5c6b, 95, 720);
    } else if (this.envType === 'neon') {
      this.hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x1e1b4b, 0.85);
      this.scene.add(this.hemiLight);

      this.sunLight = new THREE.DirectionalLight(0xc4b5fd, 1.05);
      this.sunLight.position.set(160, 170, 80);
      this.scene.fog = new THREE.Fog(0x090d1f, 145, 1100);
    } else {
      this.hemiLight = new THREE.HemisphereLight(0xffd8a8, 0x1e40af, 0.95);
      this.scene.add(this.hemiLight);

      this.sunLight = new THREE.DirectionalLight(0xffecd1, 1.6);
      this.sunLight.position.set(-240, 110, 80);
      this.scene.fog = new THREE.Fog(0xf59e6b, 240, 1600);
    }

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
  }

  initSkyDome() {
    const skyGeo = new THREE.SphereGeometry(1500, 32, 18);
    const count = skyGeo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const pos = skyGeo.attributes.position;

    let stops;
    if (this.envType === 'monsoon') {
      stops = {
        zenith: new THREE.Color(0x0f172a),
        upper: new THREE.Color(0x1e293b),
        mid: new THREE.Color(0x334155),
        lower: new THREE.Color(0x475569),
        horizon: new THREE.Color(0x64748b),
        ground: new THREE.Color(0x1e293b)
      };
    } else if (this.envType === 'neon') {
      stops = {
        zenith: new THREE.Color(0x020617),
        upper: new THREE.Color(0x090d24),
        mid: new THREE.Color(0x17153b),
        lower: new THREE.Color(0x311056),
        horizon: new THREE.Color(0x0ea5e9),
        ground: new THREE.Color(0x020617)
      };
    } else {
      stops = {
        zenith: new THREE.Color(0x6d4c6d),
        upper: new THREE.Color(0x946b88),
        mid: new THREE.Color(0xc27ba0),
        lower: new THREE.Color(0xeb967a),
        horizon: new THREE.Color(0xfde047),
        ground: new THREE.Color(0x422838)
      };
    }

    for (let i = 0; i < count; i++) {
      const y = pos.getY(i) / 1500;
      const c = new THREE.Color();
      if (y > 0.65) c.lerpColors(stops.upper, stops.zenith, (y - 0.65) / 0.35);
      else if (y > 0.35) c.lerpColors(stops.mid, stops.upper, (y - 0.35) / 0.30);
      else if (y > 0.14) c.lerpColors(stops.lower, stops.mid, (y - 0.14) / 0.21);
      else if (y > -0.02) c.lerpColors(stops.horizon, stops.lower, (y + 0.02) / 0.16);
      else c.lerpColors(stops.horizon, stops.ground, THREE.MathUtils.clamp(-y * 4, 0, 1));

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });

    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyMesh);

    if (this.envType === 'coastal') {
      const sunPos = new THREE.Vector3(-920, 85, 480);
      const sunDisc = new THREE.Mesh(
        new THREE.CircleGeometry(58, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthWrite: false, fog: false })
      );
      sunDisc.position.copy(sunPos);
      sunDisc.lookAt(0, 85, 0);
      this.skyMesh.add(sunDisc);

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

      const haloMat = new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(haloCanvas),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false
      });
      const haloMesh = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), haloMat);
      haloMesh.position.copy(sunPos);
      haloMesh.quaternion.copy(sunDisc.quaternion);
      this.skyMesh.add(haloMesh);

      const flare = new THREE.Mesh(
        new THREE.PlaneGeometry(540, 20),
        new THREE.MeshBasicMaterial({
          color: 0xffedd5,
          transparent: true,
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false
        })
      );
      flare.position.copy(sunPos);
      flare.quaternion.copy(sunDisc.quaternion);
      this.skyMesh.add(flare);
    } else if (this.envType === 'neon') {
      // Glowing crescent moon + city skyline night glow
      const moonPos = new THREE.Vector3(680, 320, -760);
      const moon = new THREE.Mesh(
        new THREE.CircleGeometry(36, 20),
        new THREE.MeshBasicMaterial({ color: 0xe0f2fe, side: THREE.DoubleSide, depthWrite: false, fog: false })
      );
      moon.position.copy(moonPos);
      moon.lookAt(0, 120, 0);
      this.skyMesh.add(moon);
    }
  }

  initClouds() {
    this.cloudGroup = new THREE.Group();
    this.skyMesh.add(this.cloudGroup);

    const cloudTex = this.generateCloudTexture();
    const c1 = this.envType === 'monsoon' ? 0x334155 : (this.envType === 'neon' ? 0x1e1b4b : 0xfdba74);
    const c2 = this.envType === 'monsoon' ? 0x475569 : (this.envType === 'neon' ? 0x3b0764 : 0xf472b6);

    const mat1 = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: this.envType === 'monsoon' ? 0.72 : (this.envType === 'neon' ? 0.25 : 0.45),
      color: c1,
      depthWrite: false,
      fog: false
    });
    const mat2 = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: this.envType === 'monsoon' ? 0.65 : (this.envType === 'neon' ? 0.2 : 0.35),
      color: c2,
      depthWrite: false,
      fog: false
    });

    this.cloudPlanes = [];
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

  initRain() {
    // 3D falling rain streak field centered dynamically on player
    const count = this.rainCount;
    const positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 70;
      const y = Math.random() * 28;
      const z = (Math.random() - 0.5) * 70;
      const idx = i * 6;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
      positions[idx + 3] = x - 0.18;
      positions[idx + 4] = y - 1.35;
      positions[idx + 5] = z - 0.25;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0.48,
      fog: false
    });

    this.rainPositions = positions;
    this.rainSystem = new THREE.LineSegments(geo, mat);
    this.rainSystem.frustumCulled = false;
    this.scene.add(this.rainSystem);
  }

  generateCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 128);

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

  update(playerBike, dt = 0.016) {
    if (!playerBike || !playerBike.group) return;
    const pos = playerBike.group.position;

    if (this.skyMesh) {
      this.skyMesh.position.copy(pos);
    }

    if (this.sunLight) {
      this.sunLight.target.position.copy(pos);
      if (this.envType === 'monsoon') {
        this.sunLight.position.set(pos.x - 140, pos.y + 180, pos.z + 90);
      } else if (this.envType === 'neon') {
        this.sunLight.position.set(pos.x + 160, pos.y + 170, pos.z + 80);
      } else {
        this.sunLight.position.set(pos.x - 220, pos.y + 120, pos.z + 80);
      }
    }

    this.cloudTime += dt;
    if (this.cloudPlanes) {
      this.cloudPlanes.forEach(c => {
        c.mesh.position.x = c.baseX + Math.sin(this.cloudTime * c.speed) * 45;
      });
    }

    if (this.rainSystem && this.rainPositions) {
      this.rainSystem.position.copy(pos);
      const fallSpeed = 32 * dt;
      const arr = this.rainPositions;
      for (let i = 0; i < this.rainCount; i++) {
        const idx = i * 6;
        arr[idx + 1] -= fallSpeed;
        arr[idx + 4] -= fallSpeed;
        if (arr[idx + 4] < -2) {
          const yTop = 22 + Math.random() * 6;
          arr[idx + 1] = yTop;
          arr[idx + 4] = yTop - 1.35;
        }
      }
      this.rainSystem.geometry.attributes.position.needsUpdate = true;
    }
  }

  dispose() {
    [this.hemiLight, this.sunLight, this.sunLight?.target, this.skyMesh, this.rainSystem].forEach(obj => {
      if (!obj) return;
      this.scene.remove(obj);
      obj.traverse?.(child => {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else if (child.material) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      });
    });
    this.scene.fog = null;
  }
}
