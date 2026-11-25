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
    this.laneCenters = this.getLaneCenters();
    this.corners = this.analyzeCorners();
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

    // Compute curvature from adjacent tangents (using real 3D world spacing)
    for (let i = 0; i < this.sampleCount; i++) {
      const curr = this.samples[i];
      const next = this.samples[(i + 1) % this.sampleCount];
      const cross = new THREE.Vector3().crossVectors(curr.tangent, next.tangent);
      const dot = curr.tangent.dot(next.tangent);
      const angle = Math.atan2(cross.y, dot);
      const ds = curr.position.distanceTo(next.position) || 2.0;
      curr.curvature = angle / ds;
    }

    // 5-point circular moving-average smoothing pass on curvature
    const rawCurv = this.samples.slice(0, this.sampleCount).map(s => s.curvature);
    for (let i = 0; i < this.sampleCount; i++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) {
        sum += rawCurv[(i + k + this.sampleCount) % this.sampleCount];
      }
      this.samples[i].curvature = sum / 5;
    }
    this.samples[this.sampleCount].curvature = this.samples[0].curvature;
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

  getLaneCenters() {
    const lanes = Math.max(2, Math.round(this.trackData?.lanes || 3));
    const roadWidth = this.trackData?.roadWidth || 14;
    const laneW = (roadWidth - 2.4) / lanes;
    const centers = [];
    for (let i = 0; i < lanes; i++) {
      centers.push(((i + 0.5) - lanes / 2) * laneW);
    }
    return centers;
  }

  analyzeCorners(maxSafeKmh = 220, driftK = 0.21, gripVel = 7.2) {
    const corners = [];
    let current = null;

    for (let i = 0; i < this.sampleCount; i++) {
      const sample = this.samples[i];
      const absK = Math.abs(sample.curvature);
      const safeMs = Math.sqrt(gripVel / (Math.max(0.0001, absK) * driftK));
      const safeKmh = safeMs * 3.6;

      if (safeKmh < maxSafeKmh) {
        if (!current) {
          current = {
            startS: sample.s,
            endS: sample.s,
            apexS: sample.s,
            maxAbsCurvature: absK,
            apexCurvature: sample.curvature,
            safeSpeedKmh: safeKmh
          };
        } else if (sample.s - current.endS <= 48) {
          current.endS = sample.s;
          if (absK > current.maxAbsCurvature) {
            current.maxAbsCurvature = absK;
            current.apexCurvature = sample.curvature;
            current.apexS = sample.s;
            current.safeSpeedKmh = safeKmh;
          }
        } else {
          corners.push(current);
          current = {
            startS: sample.s,
            endS: sample.s,
            apexS: sample.s,
            maxAbsCurvature: absK,
            apexCurvature: sample.curvature,
            safeSpeedKmh: safeKmh
          };
        }
      }
    }
    if (current) corners.push(current);

    // Merge wrap-around corner if close across start/finish line
    if (corners.length >= 2) {
      const first = corners[0];
      const last = corners[corners.length - 1];
      if ((this.totalLength - last.endS) + first.startS <= 48) {
        if (first.maxAbsCurvature > last.maxAbsCurvature) {
          last.maxAbsCurvature = first.maxAbsCurvature;
          last.apexCurvature = first.apexCurvature;
          last.apexS = first.apexS;
          last.safeSpeedKmh = first.safeSpeedKmh;
        }
        last.endS = first.endS;
        corners.shift();
      }
    }

    return corners.map((c, idx) => ({
      index: idx,
      startS: c.startS,
      apexS: c.apexS,
      endS: c.endS,
      maxAbsCurvature: c.maxAbsCurvature,
      apexCurvature: c.apexCurvature,
      safeSpeedKmh: Math.round(c.safeSpeedKmh),
      // positive curvature bends toward -binormal (left from rider's perspective); sign preserved
      direction: c.apexCurvature > 0 ? 'left' : 'right',
      severity: c.safeSpeedKmh < 165 ? 3 : (c.safeSpeedKmh < 195 ? 2 : 1)
    }));
  }

  roadToWorld(s, d, h = 0) {
    const frame = this.getFrameAtDistance(s);
    const worldPos = frame.position.clone()
      .addScaledVector(frame.binormal, d)
      .addScaledVector(frame.normal, h);
    return worldPos;
  }
}
