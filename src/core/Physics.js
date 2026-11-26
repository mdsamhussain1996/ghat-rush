import * as THREE from 'three';

/**
 * Modular Arcade Ghat Motorcycle Physics Engine (Road-Space Frenet Dynamics)
 *
 * Implements frame-rate-independent (dt <= 0.05s) longitudinal & lateral bike dynamics:
 * 1. Longitudinal:
 *    - Non-linear torque/acceleration curve (strong low-end punch tapering smoothly near top speed)
 *    - Separate engine compression braking (coasting deceleration), active disc braking, and quadratic aero drag
 *    - 3D ghat slope gravity force along track tangent (-g * sin(theta))
 *    - Off-road / shoulder rolling resistance and speed cap near road edges
 * 2. Lateral & Cornering:
 *    - Speed-synchronized lean/bank interpolation (leaning harder into turns as speed rises, returning smoothly to upright)
 *    - Speed-sensitive steering (agile low-speed handlebar turn, wider high-speed arc)
 *    - Centrifugal outward curvature drift on sharp ghat hairpins
 *    - Controlled corner drifting when braking/drifting into tight bends
 * 3. Collisions & Recovery:
 *    - Frame-rate-independent guardrail deflection with velocity bounce, speed penalty, and wobble
 *    - Severe impact threshold for full crash state
 */
export class BikePhysics {
  static clampDt(rawDt) {
    if (!Number.isFinite(rawDt) || rawDt <= 0) return 1 / 60;
    return Math.min(0.05, rawDt);
  }

  /**
   * Step longitudinal and lateral physics for a Bike instance.
   * Mutates bike state in-place for zero per-frame garbage allocation.
   */
  static step(bike, rawDt, controls, frame) {
    const dt = BikePhysics.clampDt(rawDt);
    const curvature = frame?.curvature || 0;
    const slopeSin = frame?.tangent?.y || 0; // +y = uphill, -y = downhill
    const halfWidth = (bike.spline?.trackData?.roadWidth || 14) / 2;

    // 1. Off-Road / Shoulder Surface Detection (outer 1.15m margin before guardrail)
    const shoulderThreshold = halfWidth - 1.15;
    const absD = Math.abs(bike.d);
    const offRoadFactor = absD > shoulderThreshold
      ? THREE.MathUtils.clamp((absD - shoulderThreshold) / 0.9, 0, 1)
      : 0;
    bike.offRoadFactor = offRoadFactor;
    bike.isOffRoad = offRoadFactor > 0.15;

    // 2. Effective Top Speed (Nitro, Slipstream Drafting, and Off-Road Shoulder Cap)
    const baseMaxSpeed = (bike.topSpeedKmh / 3.6)
      * (bike.isNitro ? 1.24 : 1.0)
      * (bike.isDrafting ? 1.08 : 1.0);
    const shoulderSpeedPenalty = 1.0 - 0.18 * offRoadFactor;
    const currentMaxSpeed = baseMaxSpeed * shoulderSpeedPenalty;

    // 3. Non-Linear Longitudinal Acceleration Curve
    // Strong low-end torque (1.16x off the line) tapering smoothly near top speed
    let forwardAccel = 0;
    if (controls.throttle > 0) {
      const speedNorm = THREE.MathUtils.clamp(bike.speed / Math.max(1, currentMaxSpeed), 0, 1);
      const torqueCurve = Math.max(0.20, Math.pow(1.0 - speedNorm, 0.82) * 1.14);
      forwardAccel = bike.accelRate * controls.throttle * torqueCurve * (bike.isNitro ? 1.65 : 1.0);
    }

    // 4. Separate Engine Braking (Coasting), Active Disc Braking, Aero Drag, Shoulder Friction & Slope Gravity
    const isCoasting = controls.throttle < 0.05 && bike.speed > 0.5;
    const engineBraking = isCoasting ? (1.85 + 0.028 * bike.speed) * (1.0 - controls.throttle / 0.05) : 0;
    const activeBrakeDecel = controls.brake > 0 ? bike.brakeRate * controls.brake : 0;
    const aeroDrag = 0.0018 * (bike.speed * bike.speed);
    const shoulderDrag = offRoadFactor * (4.5 + 0.09 * bike.speed);

    // Gravity along ghat elevation slope: uphill slows bike, downhill adds momentum
    const gravitySlopeAccel = THREE.MathUtils.clamp(-9.81 * slopeSin * 1.15, -4.8, 4.8);

    const prevSpeed = bike.speed;
    const netAccel = forwardAccel + gravitySlopeAccel - activeBrakeDecel - engineBraking - aeroDrag - shoulderDrag;
    bike.speed = Math.max(0, Math.min(currentMaxSpeed, bike.speed + netAccel * dt));
    bike.longitudinalAccel = (bike.speed - prevSpeed) / dt;

    // 5. Dynamic Pitch Coupling (Rear Squat on Acceleration + Front Fork Nose-Dive on Braking)
    const targetSquat = THREE.MathUtils.clamp(
      (forwardAccel / Math.max(10, bike.accelRate)) * 0.065 * (1.0 - bike.speed / (currentMaxSpeed * 1.15)),
      0,
      0.075
    );
    const targetDive = THREE.MathUtils.clamp(
      (activeBrakeDecel / Math.max(15, bike.brakeRate)) * 0.14 * Math.min(1.0, bike.speed / 12),
      0,
      0.15
    );
    const pitchLerp = 1.0 - Math.exp(-14.0 * dt);
    bike.accelSquat = THREE.MathUtils.lerp(bike.accelSquat || 0, targetSquat, pitchLerp);
    bike.brakeDive = THREE.MathUtils.lerp(bike.brakeDive || 0, targetDive, pitchLerp);

    // 6. Controller-Synchronized Steering, Handlebar Angle & Speed-Scaled Lean
    const currentSteerSign = Math.sign(controls.steer);
    if (currentSteerSign !== 0 && currentSteerSign !== bike.lastSteerSign) {
      bike.steerTapCount = (bike.steerTapCount || 0) + 1;
    } else if (currentSteerSign === 0) {
      bike.steerTapCount = 0;
    }
    bike.lastSteerSign = currentSteerSign;

    const speedKmh = bike.speed * 3.6;
    const speedRatio = Math.min(1.0, speedKmh / 300);

    // Lean scales UP with speed from a responsive low-speed base (38%) to full 50 deg lean in fast corners,
    // then tapers slightly at 280+ km/h for high-speed stability
    const lowSpeedLeanScale = THREE.MathUtils.clamp(0.38 + (speedKmh / 95) * 0.62, 0.38, 1.0);
    const highSpeedStabilityScale = 1.0 - Math.max(0, speedRatio - 0.35) * 0.32;
    const currentMaxLean = bike.maxLeanRad * lowSpeedLeanScale * highSpeedStabilityScale;

    // Frame-rate-independent exponential smoothing for steering input
    const steerInAlpha = 1.0 - Math.exp(-dt / 0.085);
    const steerOutAlpha = 1.0 - Math.exp(-dt / 0.11);
    const leanCenterAlpha = 1.0 - Math.exp(-dt / 0.18);
    const maxLeanRate = 2.05; // ~117 deg/s responsive lean rate

    if (Math.abs(controls.steer) < 0.04) {
      bike.steerSmoothed = THREE.MathUtils.lerp(bike.steerSmoothed, 0, steerOutAlpha);
      bike.lean = THREE.MathUtils.lerp(bike.lean, 0, leanCenterAlpha);
    } else {
      bike.steerSmoothed = THREE.MathUtils.lerp(bike.steerSmoothed, controls.steer, steerInAlpha);
      const targetLean = -bike.steerSmoothed * currentMaxLean * (1 - bike.wheelie * 0.65);
      const leanDiff = targetLean - bike.lean;
      const maxLeanChange = maxLeanRate * dt;
      bike.lean += THREE.MathUtils.clamp(leanDiff, -maxLeanChange, maxLeanChange);
    }

    // Visual Front Wheel & Handlebar Steering Angle (turns directly with steering input; larger at low speeds)
    const maxHandlebarRad = THREE.MathUtils.lerp(0.42, 0.18, speedRatio);
    const targetSteerAngle = -bike.steerSmoothed * maxHandlebarRad;
    bike.steerAngle = THREE.MathUtils.lerp(bike.steerAngle || 0, targetSteerAngle, 1.0 - Math.exp(-18.0 * dt));

    // Apply wobble from guardrail scrape if active
    const wobbleOffset = bike.wobbleTimer > 0 ? Math.sin(bike.wobbleTimer * 28) * bike.wobbleMagnitude : 0;
    const effectiveLean = bike.lean + wobbleOffset;

    // 7. Lateral Cornering, Centrifugal Curvature Push & Controlled Drift
    const effectiveSurfaceGrip = bike.surfaceGrip * (1.0 - 0.18 * offRoadFactor);
    const gripLimitVel = 6.9 * (0.78 + 0.28 * bike.handling) * bike.tyreGripBonus * effectiveSurfaceGrip;
    const leanFrac = THREE.MathUtils.clamp(-effectiveLean / Math.max(0.25, currentMaxLean), -1.0, 1.0);

    // Controlled drift when braking/drifting while leaning into a turn at speed
    const wantsDrift = !!(controls.drift && Math.abs(leanFrac) > 0.35 && bike.speed > 18);
    bike.isDrifting = wantsDrift;
    const driftTurnBonus = wantsDrift ? 1.08 : 1.0;

    // Speed-sensitive steering authority: agile at low/mid speeds, realistic arc at top speed
    const lowSpeedAgileFactor = speedKmh < 75 ? (1.0 + (1.0 - speedKmh / 75) * 0.22) : 1.0;
    let steerVel = leanFrac * gripLimitVel * driftTurnBonus * lowSpeedAgileFactor;

    // Outward centrifugal drift on sharp ghat bends: d_drift = kappa * v^2 * k
    const driftVel = curvature * (bike.speed * bike.speed) * 0.21;
    bike.gripDemandRatio = Math.abs(driftVel) / Math.max(1.0, gripLimitVel);
    bike.isSliding = (bike.gripDemandRatio > 0.88 && bike.speed > 22) || (wantsDrift && bike.speed > 24);

    // Smooth drift yaw angle for visual tail-out attitude during slides
    const targetSlideYaw = bike.isSliding
      ? THREE.MathUtils.clamp(-leanFrac * 0.14 * Math.min(1.5, Math.max(0.6, bike.gripDemandRatio)), -0.22, 0.22)
      : 0;
    bike.slideAngle = THREE.MathUtils.lerp(bike.slideAngle || 0, targetSlideYaw, 1.0 - Math.exp(-10.0 * dt));

    // Subtle straight-line rail assist near barriers on straights
    const distToRail = halfWidth - Math.abs(bike.d);
    const steeringTowardRail = (bike.d > 0 && controls.steer > 0.08) || (bike.d < 0 && controls.steer < -0.08);
    if (distToRail < 1.1 && Math.abs(curvature) < 0.0025) {
      if (!steeringTowardRail) {
        bike.d -= Math.sign(bike.d) * (1.1 - distToRail) * 3.2 * dt;
      } else if (bike.steerTapCount < 2) {
        steerVel *= 0.22;
      }
    }

    const netLateralVel = steerVel + driftVel;
    bike.lateralVel = netLateralVel;
    bike.d += netLateralVel * dt;

    // 8. Guardrail Collision Response (Deflection + Speed Penalty + Shake vs Severe Crash)
    if (Math.abs(bike.d) >= halfWidth - 0.25) {
      const impactAngleDeg = Math.atan2(Math.abs(netLateralVel), Math.max(1, bike.speed)) * (180 / Math.PI);
      const hardWideSlide = (Math.abs(netLateralVel) > 3.2 && bike.speed > 38);

      if (impactAngleDeg > 22.0 || hardWideSlide) {
        bike.triggerCrash('rail');
        return { crashed: true, dt };
      }

      // Smooth velocity deflection inward + frame-rate-independent exponential speed penalty
      const railSign = Math.sign(bike.d || 1);
      bike.d = railSign * (halfWidth - 0.34);
      bike.speed *= Math.exp(-7.5 * dt);
      bike.lean = THREE.MathUtils.lerp(bike.lean, railSign * 0.12, 0.5);
      bike.wobbleTimer = 0.45;
      bike.wobbleMagnitude = 0.18;

      if (bike.isPlayer && typeof bike.onRailScrape === 'function') {
        bike.onRailScrape(Math.min(1.0, Math.abs(netLateralVel) / 3.0));
      }
    }

    // Strict safety clamp inside barriers
    bike.d = THREE.MathUtils.clamp(bike.d, -halfWidth + 0.34, halfWidth - 0.34);
    return { crashed: false, dt };
  }
}
