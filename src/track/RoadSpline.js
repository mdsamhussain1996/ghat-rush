import * as THREE from 'three';

/**
 * RoadSpline — Closed Arc-Length Parameterized Track Curve
 * Maps distance s along track to 3D position, Frenet frame (Tangent, Normal, Binormal),
 * banking angle, and curvature.
 */
export class RoadSpline {
  constructor(controlPoints, trackConfigOrLength = 2800) {
    this.controlPoints = controlPoints;
    if (typeof trackConfigOrLength === 'object' && trackConfigOrLength !== null) {
      this.trackData = trackConfigOrLength;
      this.totalLength = trackConfigOrLength.lapLengthMeters || 2800;
    } else {
      this.trackData = {};
      this.totalLength = Number(trackConfigOrLength) || 2800;
    }

    // Build 3D Catmull-Rom curve
    const vectors = controlPoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
    this.curve = new THREE.CatmullRomCurve3(vectors, true, 'catmullrom', 0.5);

    // High-resolution arc-length lookup table (every 2 meters)
    this.sampleCount = Math.max(10, Math.floor(this.totalLength / 2));
    this.samples = [];
    this.initSamples();
  }

  initSamples() {
    const upAxis = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i <= this.sampleCount; i++) {
      const u = i / this.sampleCount;
      const s = u * this.totalLength;
      const pt = this.curve.getPointAt(u);
      const tangent = this.curve.getTangentAt(u).normalize();

      // Compute binormal (perpendicular to tangent and world up)
      let binormal = new THREE.Vector3().crossVectors(tangent, upAxis).normalize();
      if (binormal.lengthSq() < 0.001) {
        binormal.set(1, 0, 0);
      }

      // Compute true surface normal
      const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

      // Interpolate banking angle from nearest control points
      const cpIndex = u * this.controlPoints.length;
      const cp0 = this.controlPoints[Math.floor(cpIndex) % this.controlPoints.length];
      const cp1 = this.controlPoints[(Math.floor(cpIndex) + 1) % this.controlPoints.length];
      const frac = cpIndex - Math.floor(cpIndex);
      const bank = (cp0.bank || 0) * (1 - frac) + (cp1.bank || 0) * frac;

      // Apply banking rotation to binormal & normal
      if (Math.abs(bank) > 0.001) {
        binormal.applyAxisAngle(tangent, bank);
        normal.applyAxisAngle(tangent, bank);
      }

      this.samples.push({
        s,
        u,
        position: pt,
        tangent,
        normal,
        binormal,
        bank,
        curvature: 0
      });
    }

    // Compute curvature from adjacent tangents
    for (let i = 0; i < this.sampleCount; i++) {
      const curr = this.samples[i];
      const next = this.samples[(i + 1) % this.sampleCount];
      const cross = new THREE.Vector3().crossVectors(curr.tangent, next.tangent);
      const dot = curr.tangent.dot(next.tangent);
      const angle = Math.atan2(cross.y, dot);
      curr.curvature = angle / (next.s - curr.s || 2);
    }
  }

  wrapDistance(s) {
    let wrapped = s % this.totalLength;
    if (wrapped < 0) wrapped += this.totalLength;
    return wrapped;
  }

  getFrameAtDistance(s) {
    const wrappedS = this.wrapDistance(s);
    const u = wrappedS / this.totalLength;
    const indexF = u * this.sampleCount;
    const i0 = Math.floor(indexF) % this.sampleCount;
    const i1 = (i0 + 1) % this.sampleCount;
    const frac = indexF - Math.floor(indexF);

    const s0 = this.samples[i0];
    const s1 = this.samples[i1];

    const position = new THREE.Vector3().lerpVectors(s0.position, s1.position, frac);
    const tangent = new THREE.Vector3().lerpVectors(s0.tangent, s1.tangent, frac).normalize();
    const normal = new THREE.Vector3().lerpVectors(s0.normal, s1.normal, frac).normalize();
    const binormal = new THREE.Vector3().lerpVectors(s0.binormal, s1.binormal, frac).normalize();
    const bank = s0.bank * (1 - frac) + s1.bank * frac;
    const curvature = s0.curvature * (1 - frac) + s1.curvature * frac;

    return {
      s: wrappedS,
      position,
      tangent,
      normal,
      binormal,
      bank,
      curvature
    };
  }

  roadToWorld(s, d, h = 0) {
    const frame = this.getFrameAtDistance(s);
    const worldPos = frame.position.clone()
      .addScaledVector(frame.binormal, d)
      .addScaledVector(frame.normal, h);
    return worldPos;
  }
}
