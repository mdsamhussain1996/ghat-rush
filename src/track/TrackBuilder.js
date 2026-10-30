import * as THREE from 'three';

/**
 * TrackBuilder — Generates 3D Road Mesh Ribbon along RoadSpline
 * Features realistic asphalt texture, lane markings, rumble strips, and road shoulders.
 */
export class TrackBuilder {
  constructor(spline, trackData) {
    this.spline = spline;
    this.trackData = trackData;
    this.roadWidth = trackData.roadWidth || 14;
    this.lanes = trackData.lanes || 3;
    this.stepMeters = 3.0; // Longitudinal resolution
  }

  buildRoadMesh() {
    const totalLength = this.spline.totalLength;
    const steps = Math.floor(totalLength / this.stepMeters);
    const halfWidth = this.roadWidth / 2;
    const shoulderWidth = 2.2;
    const totalHalfWidth = halfWidth + shoulderWidth;

    // We'll generate vertices across cross-section:
    // [-totalHalfWidth, -halfWidth, halfWidth, totalHalfWidth]
    const crossSections = [
      -totalHalfWidth,
      -halfWidth,
      halfWidth,
      totalHalfWidth
    ];
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
      const vProgress = s / 12.0; // Repeat UV every 12m

      for (let j = 0; j < numCross; j++) {
        const d = crossSections[j];
        const isShoulder = Math.abs(d) > halfWidth;

        // Position = centerline + binormal * d
        const pos = frame.position.clone().addScaledVector(frame.binormal, d);
        // Slightly lower the shoulder edge
        if (Math.abs(d) > halfWidth) {
          pos.addScaledVector(frame.normal, -0.08);
        }

        positions[vIdx * 3] = pos.x;
        positions[vIdx * 3 + 1] = pos.y;
        positions[vIdx * 3 + 2] = pos.z;

        normals[vIdx * 3] = frame.normal.x;
        normals[vIdx * 3 + 1] = frame.normal.y;
        normals[vIdx * 3 + 2] = frame.normal.z;

        const uNorm = (d + totalHalfWidth) / (2 * totalHalfWidth);
        uvs[uvIdx * 2] = uNorm;
        uvs[uvIdx * 2 + 1] = vProgress;

        // Vertex coloring: full 1.0 so texture colors and white lines are bright
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

    // Index buffer
    const indices = [];
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < numCross - 1; j++) {
        const row1 = i * numCross;
        const row2 = (i + 1) * numCross;

        const a = row1 + j;
        const b = row1 + j + 1;
        const c = row2 + j;
        const d = row2 + j + 1;

        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);

    // Create procedural canvas texture for road stripes & asphalt grain
    const roadTexture = this.generateRoadTexture();
    roadTexture.wrapS = THREE.ClampToEdgeWrapping;
    roadTexture.wrapT = THREE.RepeatWrapping;
    roadTexture.repeat.set(1, 1);

    const material = new THREE.MeshStandardMaterial({
      map: roadTexture,
      roughness: 0.75,
      metalness: 0.15,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  generateRoadTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // 1. Sandy gravel shoulder edges
    ctx.fillStyle = '#947858';
    ctx.fillRect(0, 0, 1024, 512);

    // 2. Asphalt highway surface (from 124px to 900px)
    const roadLeft = 124;
    const roadRight = 900;
    const roadWidthPx = roadRight - roadLeft;

    ctx.fillStyle = '#282a2f';
    ctx.fillRect(roadLeft, 0, roadWidthPx, 512);

    // Fine asphalt aggregate noise
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    for (let i = 0; i < 4000; i++) {
      ctx.fillRect(roadLeft + Math.random() * roadWidthPx, Math.random() * 512, 2, 2);
    }

    // 3. Tyre Wear Darkening Lines in each of the 3 driving lanes
    const laneWidth = (roadWidthPx - 28) / 3;
    const laneCenters = [
      roadLeft + 14 + laneWidth * 0.5,
      roadLeft + 14 + laneWidth * 1.5,
      roadLeft + 14 + laneWidth * 2.5
    ];

    ctx.fillStyle = 'rgba(15, 16, 20, 0.35)';
    laneCenters.forEach(cx => {
      // Left and right tyre paths in lane
      ctx.fillRect(cx - 38, 0, 22, 512);
      ctx.fillRect(cx + 16, 0, 22, 512);
    });

    // 4. Heavy Skid-mark Decals on bends
    ctx.fillStyle = 'rgba(10, 11, 14, 0.55)';
    ctx.beginPath();
    ctx.ellipse(laneCenters[1] + 18, 180, 12, 140, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(laneCenters[1] - 22, 220, 10, 110, 0.10, 0, Math.PI * 2);
    ctx.fill();

    // 5. Red & White checkered rumble strips along inner shoulder boundary
    const rumbleWidth = 28;
    for (let y = 0; y < 512; y += 32) {
      ctx.fillStyle = (y % 64 === 0) ? '#dc2626' : '#f8fafc';
      ctx.fillRect(roadLeft - rumbleWidth, y, rumbleWidth, 32);
      ctx.fillRect(roadRight, y, rumbleWidth, 32);
    }

    // 6. Solid bright white shoulder boundary lines (with subtle road wear)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillRect(roadLeft + 4, 0, 10, 512);
    ctx.fillRect(roadRight - 14, 0, 10, 512);

    // 7. Dashed center lane dividers with realistic dashed spacing & wear
    const div1X = roadLeft + 14 + laneWidth;
    const div2X = roadLeft + 14 + laneWidth * 2;

    ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
    for (let y = 0; y < 512; y += 64) {
      ctx.fillRect(div1X - 5, y + 14, 10, 36);
      ctx.fillRect(div2X - 5, y + 14, 10, 36);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }
}
