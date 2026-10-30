import * as THREE from 'three';

/**
 * Sky & Atmospheric Lighting
 * Builds the golden sunset atmosphere of Coastal Highway Route 1:
 * - Gradient sky hemisphere with golden sunset horizon & twilight zenith
 * - Low-angle directional sun with soft shadows
 * - Soft ocean bounce ambient lighting
 * - Atmospheric distance fog
 */
export class Sky {
  constructor(scene, envType = 'coastal') {
    this.scene = scene;
    this.envType = envType;

    this.initLighting();
    this.initSkyDome();
  }

  initLighting() {
    // 1. Hemisphere Light (warm sky, soft ocean bounce)
    this.hemiLight = new THREE.HemisphereLight(0xffb07c, 0x1d4e68, 0.85);
    this.scene.add(this.hemiLight);

    // 2. Directional Sun Light (golden hour sunset)
    this.sunLight = new THREE.DirectionalLight(0xffebd2, 1.4);
    this.sunLight.position.set(-250, 90, -120);
    this.sunLight.castShadow = true;

    // Shadow map bounds tuned for tight performance budget & high visual fidelity
    const d = 45;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 450;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.bias = -0.0008;

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // 3. Sunset Atmospheric Fog
    this.scene.fog = new THREE.Fog(0xe89f71, 160, 950);
  }

  initSkyDome() {
    // Large hemisphere with vertex-colored sunset gradient
    const skyGeo = new THREE.SphereGeometry(1400, 32, 16);
    const count = skyGeo.attributes.position.count;
    const colors = new Float32Array(count * 3);

    const pos = skyGeo.attributes.position;
    const zenithCol = new THREE.Color(0x422659); // Twilight purple
    const midCol = new THREE.Color(0xc9583b);    // Fiery amber
    const horizonCol = new THREE.Color(0xf6af65);// Golden orange
    const groundCol = new THREE.Color(0x2d1b2e); // Deep horizon haze

    for (let i = 0; i < count; i++) {
      const y = pos.getY(i) / 1400; // -1 to 1

      let c = new THREE.Color();
      if (y > 0.45) {
        c.lerpColors(midCol, zenithCol, (y - 0.45) / 0.55);
      } else if (y > 0.0) {
        c.lerpColors(horizonCol, midCol, y / 0.45);
      } else {
        c.lerpColors(horizonCol, groundCol, -y);
      }

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false
    });

    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyMesh);

    // Glowing Sunset Sun Disc (Fixed on ocean horizon)
    const sunDiscGeo = new THREE.CircleGeometry(55, 32);
    const sunDiscMat = new THREE.MeshBasicMaterial({
      color: 0xfffae0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.sunDisc = new THREE.Mesh(sunDiscGeo, sunDiscMat);
    this.sunDisc.position.set(-950, 120, 650);
    this.sunDisc.lookAt(0, 120, 0);
    this.skyMesh.add(this.sunDisc);

    // Horizontal Anamorphic Lens Flare (Matching concept_coast.png)
    const flareGeo = new THREE.PlaneGeometry(380, 24);
    const flareMat = new THREE.MeshBasicMaterial({
      color: 0xffe8a3,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const flare = new THREE.Mesh(flareGeo, flareMat);
    flare.position.copy(this.sunDisc.position);
    flare.quaternion.copy(this.sunDisc.quaternion);
    this.skyMesh.add(flare);
  }

  update(playerBike) {
    if (!playerBike || !playerBike.group) return;

    // Follow player position so sky dome and sun shadow box travel with the bike
    const pos = playerBike.group.position;
    this.skyMesh.position.copy(pos);

    // Shift sun shadow target along with bike
    this.sunLight.target.position.copy(pos);
    this.sunLight.position.set(pos.x - 180, pos.y + 110, pos.z - 90);
  }
}
