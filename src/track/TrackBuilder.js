import * as THREE from 'three';

/**
 * TrackBuilder — Generates 3D Road Mesh Ribbon along RoadSpline
 * Supports 'coastal', 'monsoon' (wet asphalt reflection & 2 lanes), and 'neon' (wet dark expressway & 4 lanes).
 */
export class TrackBuilder {
  constructor(spline, trackData) {
    this.spline = spline;
    this.trackData = trackData || {};
    this.roadWidth = this.trackData.roadWidth || 14;
    this.lanes = Math.max(2, this.trackData.lanes || 3);
    this.envType = this.trackData.environment || 'coastal';
    this.stepMeters = 6.0;
    this.mesh = null;
  }

  buildRoadMesh() {
    const totalLength = this.spline.totalLength;
    const steps = Math.floor(totalLength / this.stepMeters);
    const halfWidth = this.roadWidth / 2;
    const shoulderWidth = 2.2;
    const totalHalfWidth = halfWidth + shoulderWidth;

    const crossSections = [-totalHalfWidth, -halfWidth, halfWidth, totalHalfWidth];
    const numCross = crossSections.length;

    const vertexCount = (steps + 1) * numCross;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 3);

    let vIdx = 0;
    let uvIdx = 0;
    let cIdx = 0;

    for (let i = 0; i <= steps; i++) {
      const s = (i / steps) * totalLength;
      const frame = this.spline.getFrameAtDistance(s);
      const vProgress = s / 12.0;

      for (let j = 0; j < numCross; j++) {
        const d = crossSections[j];
        const isShoulder = Math.abs(d) > halfWidth;

        const pos = frame.position.clone().addScaledVector(frame.binormal, d);
        if (isShoulder) {
          pos.addScaledVector(frame.normal, -0.08);
        }

        positions[vIdx * 3] = pos.x;
        positions[vIdx * 3 + 1] = pos.y;
        positions[vIdx * 3 + 2] = pos.z;

        normals[vIdx * 3] = frame.normal.x;
        normals[vIdx * 3 + 1] = frame.normal.y;
        normals[vIdx * 3 + 2] = frame.normal.z;

        uvs[uvIdx * 2] = (d + totalHalfWidth) / (2 * totalHalfWidth);
        uvs[uvIdx * 2 + 1] = vProgress;

        if (isShoulder) {
          colors[cIdx * 3] = 0.85;
          colors[cIdx * 3 + 1] = 0.75;
          colors[cIdx * 3 + 2] = 0.65;
        } else {
          colors[cIdx * 3] = 1.0;
          colors[cIdx * 3 + 1] = 1.0;
          colors[cIdx * 3 + 2] = 1.0;
        }

        vIdx++;
        uvIdx++;
        cIdx++;
      }
    }

    const indices = [];
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < numCross - 1; j++) {
        const row1 = i * numCross;
        const row2 = (i + 1) * numCross;
        const a = row1 + j;
        const b = row1 + j + 1;
        const c = row2 + j;
        const d = row2 + j + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);

    const roadTexture = this.generateRoadTexture();
    roadTexture.wrapS = THREE.ClampToEdgeWrapping;
    roadTexture.wrapT = THREE.RepeatWrapping;

    const isMonsoon = this.envType === 'monsoon';
    const isNeon = this.envType === 'neon';

    const material = new THREE.MeshStandardMaterial({
      map: roadTexture,
      roughness: isMonsoon ? 0.16 : (isNeon ? 0.22 : 0.75),
      metalness: isMonsoon ? 0.58 : (isNeon ? 0.64 : 0.15),
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    return this.mesh;
  }

  generateRoadTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    const isMonsoon = this.envType === 'monsoon';
    const isNeon = this.envType === 'neon';

    // 1. Shoulder base
    ctx.fillStyle = isMonsoon ? '#3e4c3a' : (isNeon ? '#1e293b' : '#947858');
    ctx.fillRect(0, 0, 1024, 512);

    // 2. Asphalt surface
    const roadLeft = 124;
    const roadRight = 900;
    const roadWidthPx = roadRight - roadLeft;

    ctx.fillStyle = isMonsoon ? '#1c2229' : (isNeon ? '#111626' : '#282a2f');
    ctx.fillRect(roadLeft, 0, roadWidthPx, 512);

    // Subtle aggregate & wet puddle streaks
    ctx.fillStyle = isMonsoon || isNeon ? 'rgba(148, 197, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)';
    for (let i = 0; i < 3200; i++) {
      ctx.fillRect(roadLeft + Math.random() * roadWidthPx, Math.random() * 512, 2, isMonsoon || isNeon ? 8 : 2);
    }

    // 3. Tyre wear / wet tracks across this.lanes
    const laneWidth = (roadWidthPx - 28) / this.lanes;
    ctx.fillStyle = isMonsoon ? 'rgba(8, 12, 18, 0.42)' : 'rgba(15, 16, 20, 0.35)';
    for (let l = 0; l < this.lanes; l++) {
      const cx = roadLeft + 14 + laneWidth * (l + 0.5);
      ctx.fillRect(cx - 34, 0, 20, 512);
      ctx.fillRect(cx + 14, 0, 20, 512);
    }

    // 4. Shoulder rumble strips / neon stripes
    const rumbleWidth = 28;
    for (let y = 0; y < 512; y += 32) {
      if (isNeon) {
        ctx.fillStyle = (y % 64 === 0) ? '#06b6d4' : '#d946ef';
      } else {
        ctx.fillStyle = (y % 64 === 0) ? '#dc2626' : '#f8fafc';
      }
      ctx.fillRect(roadLeft - rumbleWidth, y, rumbleWidth, 32);
      ctx.fillRect(roadRight, y, rumbleWidth, 32);
    }

    // 5. Outer solid boundary lines
    ctx.fillStyle = isNeon ? 'rgba(56, 189, 248, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    ctx.fillRect(roadLeft + 4, 0, 10, 512);
    ctx.fillRect(roadRight - 14, 0, 10, 512);

    // 6. Dashed center lane dividers matching actual lane count
    ctx.fillStyle = isMonsoon ? 'rgba(250, 204, 21, 0.92)' : 'rgba(248, 250, 252, 0.92)';
    for (let d = 1; d < this.lanes; d++) {
      const divX = roadLeft + 14 + laneWidth * d;
      for (let y = 0; y < 512; y += 64) {
        ctx.fillRect(divX - 5, y + 14, 10, 36);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  dispose(scene) {
    if (!this.mesh) return;
    scene?.remove(this.mesh);
    this.mesh.geometry?.dispose();
    this.mesh.material?.map?.dispose();
    this.mesh.material?.dispose();
    this.mesh = null;
  }
}
