/**
 * Automated Headless Chrome CDP Verification Suite for GHAT RUSH
 * Runs real browser checks + full 3-lap races on all 3 tracks per phase.
 * Usage: node scripts/verify_phase.js --phase=1
 */
import http from 'node:http';
import WebSocket from 'ws';

const PHASE = Number(process.argv.find(a => a.startsWith('--phase='))?.split('=')[1] || 1);
const CDP_PORT = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 9222);
const BASE_URL = process.env.GHAT_URL || 'http://localhost:3006';
const TRACKS = ['coast_route_1', 'monsoon_route_1', 'neon_route_1'];

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function openNewTab(url) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: CDP_PORT,
      path: `/json/new?${encodeURI(url)}`,
      method: 'PUT'
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Failed to parse /json/new response: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
        } else if (msg.method) {
          if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
            const text = (msg.params.args || []).map(a => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
            this.consoleErrors.push(text);
          }
          if (msg.method === 'Runtime.exceptionThrown') {
            const desc = msg.params?.exceptionDetails?.exception?.description
              || msg.params?.exceptionDetails?.text
              || JSON.stringify(msg.params);
            this.exceptions.push(desc);
          }
        }
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      const msg = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Page eval exception: ${msg}`);
    }
    return res.result?.value;
  }

  async waitUntil(expr, desc = 'condition', timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await this.eval(expr).catch(() => false);
      if (ok) return true;
      await sleep(50);
    }
    throw new Error(`Timed out waiting for: ${desc}`);
  }

  async navigate(url) {
    await this.send('Page.bringToFront').catch(() => {});
    await this.send('Page.navigate', { url });
    await this.waitUntil('Boolean(window.gameInstance && document.readyState === "complete")', `gameInstance ready at ${url}`, 8000);
    await sleep(200);
  }

  async pressKey(key, code) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
    await sleep(50);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
    await sleep(100);
  }

  async clickCenter() {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
    await sleep(80);
  }

  clearErrors() {
    this.consoleErrors.length = 0;
    this.exceptions.length = 0;
  }

  assertCleanErrors(context) {
    assert(this.consoleErrors.length === 0, `[${context}] Console errors: ${this.consoleErrors.join(' | ')}`);
    assert(this.exceptions.length === 0, `[${context}] Uncaught exceptions: ${this.exceptions.join(' | ')}`);
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function runPhase1Checks(client) {
  console.log('--- Phase 1 Functional Checks (coast_route_1) ---');
  await client.navigate(`${BASE_URL}/?track=coast_route_1&autostart=1`);
  client.clearErrors();
  await client.clickCenter();

  // Advance countdown cleanly into RACING
  await client.eval(`(() => {
    const g = window.gameInstance;
    g.loop.stop();
    let guard = 0;
    while (g.state === 'COUNTDOWN' && guard++ < 300) {
      g.update(1 / 60);
    }
    g.render(0, performance.now());
    g.loop.start();
    return g.state;
  })()`);
  assert(await client.eval('window.gameInstance.state') === 'RACING', 'Expected RACING after countdown');

  // 1. F3 overlay toggle & stats check
  await client.pressKey('F3', 'F3');
  await client.waitUntil('!document.getElementById("f3-overlay").classList.contains("f3-hidden")', 'F3 overlay visible');
  const f3Info = await client.eval(`(() => {
    const g = window.gameInstance;
    g.render(0, performance.now());
    const stats = g.renderer.getStats();
    return { drawCalls: stats.drawCalls, triangles: stats.triangles };
  })()`);
  console.log(`F3 Stats (coast_route_1): drawCalls=${f3Info.drawCalls}, triangles=${f3Info.triangles}`);
  await client.pressKey('F3', 'F3');

  // 2. Lap total dynamic check
  const lapText = await client.eval('({ ui: document.getElementById("lap-total").innerText, total: String(window.gameInstance.totalLaps) })');
  assert(lapText.ui === lapText.total, `HUD lap-total (${lapText.ui}) != game.totalLaps (${lapText.total})`);

  // 3. Pause via Esc + Resume + Pause via P + Camera + visibilitychange
  await client.pressKey('Escape', 'Escape');
  await client.waitUntil('window.gameInstance.state === "PAUSED" && !document.getElementById("pause-menu").classList.contains("hidden")', 'Esc pauses game');
  console.log('✓ Pause via Esc');

  await client.eval('document.getElementById("pause-btn-resume").click()');
  await client.waitUntil('window.gameInstance.state === "RACING"', 'Resume button returns to RACING');

  await client.pressKey('p', 'KeyP');
  await client.waitUntil('window.gameInstance.state === "PAUSED"', 'KeyP pauses game');
  console.log('✓ Pause via P');

  const camBefore = await client.eval('window.gameInstance.cameraRig.mode');
  await client.eval('document.getElementById("pause-btn-camera").click()');
  const camAfter = await client.eval('window.gameInstance.cameraRig.mode');
  assert(camBefore !== camAfter, 'Pause camera button must cycle camera mode');
  await client.eval('document.getElementById("pause-btn-resume").click()');
  await client.waitUntil('window.gameInstance.state === "RACING"', 'Resume after camera cycle');

  await client.eval(`(() => {
    const orig = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    if (orig) Object.defineProperty(document, 'hidden', orig);
    else delete document.hidden;
  })()`);
  await client.waitUntil('window.gameInstance.state === "PAUSED"', 'visibilitychange hidden pauses game');
  console.log('✓ Auto-pause via visibilitychange');
  await client.eval('document.getElementById("pause-btn-resume").click()');
  await client.waitUntil('window.gameInstance.state === "RACING"', 'Resume after visibilitychange');

  // 4. Mute toggle via M key & HUD mute button + localStorage persistence
  const muteStart = await client.eval('!!JSON.parse(localStorage.getItem("ghat_rush_save_v1") || "{}")?.settings?.audioMuted');
  await client.pressKey('m', 'KeyM');
  await client.waitUntil(`!!JSON.parse(localStorage.getItem("ghat_rush_save_v1") || "{}")?.settings?.audioMuted === ${!muteStart}`, 'KeyM toggles persisted audioMuted');
  await client.eval('document.getElementById("hud-mute-btn").click()');
  await client.waitUntil(`!!JSON.parse(localStorage.getItem("ghat_rush_save_v1") || "{}")?.settings?.audioMuted === ${muteStart}`, 'HUD mute button toggles persisted audioMuted back');
  console.log('✓ Mute hotkey (M), HUD button & Save persistence');

  // 5. Ghost transparency & comboResetTimer dt check
  const bug6Check = await client.eval(`(() => {
    const g = window.gameInstance;
    const bike = g.playerBike;
    bike.enterGhostMode(1.5);
    const allTransOnEnter = bike.ghostMaterials.every(m => m.mat.transparent === true);
    bike.exitGhostMode();
    const restoredOnExit = bike.ghostMaterials.every(m => m.mat.transparent === m.baseTransparent);

    bike.nearMissCombo = 3;
    bike.comboResetTimer = 0.8;
    bike.checkNearMisses([], 0.5);
    const afterHalfSec = bike.comboResetTimer;
    bike.checkNearMisses([], 0.4);
    const afterExpiry = { timer: bike.comboResetTimer, combo: bike.nearMissCombo };
    return { allTransOnEnter, restoredOnExit, afterHalfSec, afterExpiry };
  })()`);
  assert(bug6Check.allTransOnEnter && bug6Check.restoredOnExit, 'Ghost mode must toggle transparent cleanly on enter/exit');
  assert(Math.abs(bug6Check.afterHalfSec - 0.3) < 1e-4, `comboResetTimer should decrement by dt=0.5 to 0.3, got ${bug6Check.afterHalfSec}`);
  assert(bug6Check.afterExpiry.timer === 0 && bug6Check.afterExpiry.combo === 0, 'Near miss combo must reset when timer expires');

  // 6. Restart reset check
  await client.eval(`(() => {
    const g = window.gameInstance;
    g.hud.showPopup('DUMMY', 'POPUP', 'system');
    g.playerBike.nearMissCombo = 4;
    g.bestLapTime = 12.34;
    g.totalTime = 55.5;
    g.rivalAI.rivals[0].bike.triggerCrash();
    g.pauseGame();
    document.getElementById('pause-btn-restart').click();
  })()`);
  await client.waitUntil('window.gameInstance.state === "COUNTDOWN"', 'Pause Restart resets to COUNTDOWN');
  const afterRestart = await client.eval(`(() => {
    const g = window.gameInstance;
    return {
      state: g.state,
      resultsHidden: document.getElementById('results-screen').classList.contains('hidden'),
      nearMissCombo: g.playerBike.nearMissCombo,
      bestLapIsInf: g.bestLapTime === Infinity,
      totalTime: g.totalTime,
      popupsCount: document.getElementById('hud-center-popups').children.length,
      rivalsClean: g.rivalAI.rivals.every(r => !r.bike.isCrashed && r.bike.ghostTimer === 0)
    };
  })()`);
  assert(afterRestart.resultsHidden, 'Restart must hide results screen');
  assert(afterRestart.nearMissCombo === 0 && afterRestart.bestLapIsInf && afterRestart.totalTime === 0, 'Restart must reset combo, bestLapTime, totalTime');
  assert(afterRestart.popupsCount === 0 && afterRestart.rivalsClean, 'Restart must clear HUD popups and rival crash/ghost states');

  client.assertCleanErrors('Phase 1 checks');
  console.log('✓ Phase 1 functional checks passed');
}

async function runFullThreeLapRace(client, trackId, verifyReplay = false) {
  console.log(`--- Running 3-lap race on ${trackId} ---`);
  await client.navigate(`${BASE_URL}/?track=${trackId}&autostart=1`);
  client.clearErrors();
  await client.clickCenter();

  const result = await client.eval(`(async () => {
    const g = window.gameInstance;
    g.loop.stop();

    const lanes = g.spline.getLaneCenters
      ? g.spline.getLaneCenters()
      : [-3.5, 0, 3.5];
    const totalLen = g.spline.totalLength;
    let steps = 0;
    const maxSteps = 26000;

    while (g.state !== 'FINISHED' && steps < maxSteps) {
      if (g.state === 'COUNTDOWN') {
        g.update(1 / 60);
        steps++;
        continue;
      }

      const bike = g.playerBike;
      const curFrame = g.spline.getFrameAtDistance(bike.s);
      const aheadFrame1 = g.spline.getFrameAtDistance(g.spline.wrapDistance(bike.s + 25));
      const aheadFrame2 = g.spline.getFrameAtDistance(g.spline.wrapDistance(bike.s + 55));
      const aheadFrame3 = g.spline.getFrameAtDistance(g.spline.wrapDistance(bike.s + 95));
      const peakCurv = Math.max(
        Math.abs(curFrame.curvature || 0),
        Math.abs(aheadFrame1.curvature || 0),
        Math.abs(aheadFrame2.curvature || 0),
        Math.abs(aheadFrame3.curvature || 0)
      );

      const activeTraffic = g.traffic.getActiveList();
      let bestLaneD = lanes[Math.floor(lanes.length / 2)] || 0;
      let bestScore = -1e9;
      for (const ld of lanes) {
        let minFwdDist = 120;
        for (const v of activeTraffic) {
          let ds = v.s - bike.s;
          if (ds < -totalLen * 0.5) ds += totalLen;
          if (ds > totalLen * 0.5) ds -= totalLen;
          if (ds > -4 && ds < 70 && Math.abs(v.d - ld) < 1.9) {
            if (ds < minFwdDist) minFwdDist = ds;
          }
        }
        const score = minFwdDist - Math.abs(ld - bike.d) * 0.15;
        if (score > bestScore) {
          bestScore = score;
          bestLaneD = ld;
        }
      }

      const hasDriftPhysics = typeof bike.gripDemandRatio === 'number';
      const driftComp = hasDriftPhysics ? -(curFrame.curvature || 0) * bike.speed * bike.speed * 0.029 : 0;
      const dErr = bestLaneD - bike.d;
      const steerCmd = Math.max(-1, Math.min(1, dErr * 0.55 + driftComp));

      let safeMs = 95;
      if (hasDriftPhysics && peakCurv > 0.004) {
        safeMs = Math.min(safeMs, Math.sqrt(6.6 / (peakCurv * 0.21)));
      }
      const brake = bike.speed > safeMs + 2 ? 0.95 : 0;
      const throttle = brake > 0 ? 0 : 1;

      g.input.keys.clear();
      if (throttle > 0.5) g.input.keys.add('KeyW');
      if (brake > 0.5) g.input.keys.add('KeyS');
      if (steerCmd < -0.15) g.input.keys.add('KeyA');
      if (steerCmd > 0.15) g.input.keys.add('KeyD');
      if (peakCurv < 0.004 && bike.nitro > 1.2 && bestScore > 40) {
        g.input.keys.add('Space');
      }

      g.update(1 / 60);
      steps++;

      if (steps % 120 === 0) {
        g.render(0, performance.now());
        await new Promise(r => setTimeout(r, 0));
      }
    }

    g.input.keys.clear();
    g.render(0, performance.now());
    g.loop.start();

    const stats = g.renderer.getStats();
    const resEl = document.getElementById('results-screen');
    const saved = JSON.parse(localStorage.getItem('ghat_rush_save_v1') || '{}');
    return {
      trackId: g.trackConfig.id,
      state: g.state,
      steps,
      raceTime: g.raceTime,
      bestLapTime: g.bestLapTime,
      lap: g.playerBike.lap,
      totalLaps: g.totalLaps,
      resultsVisible: Boolean(resEl && !resEl.classList.contains('hidden')),
      resultsPos: document.querySelector('#results-screen .pos-big')?.textContent || '',
      replayLen: g.replayRecorder?.length || 0,
      cash: saved.cash,
      stars: saved.stars,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles
    };
  })()`);

  assert(result.state === 'FINISHED', `${trackId} failed to finish 3 laps cleanly (state=${result.state}, lap=${result.lap}/${result.totalLaps}, steps=${result.steps})`);
  assert(result.resultsVisible, `${trackId} ResultsScreen did not appear`);
  if (PHASE >= 5) {
    assert(result.drawCalls <= 180, `${trackId} drawCalls ${result.drawCalls} exceeded 180 budget`);
    assert(result.triangles <= 60000, `${trackId} triangles ${result.triangles} exceeded 60000 budget`);
  }
  console.log(`✓ ${trackId} finished 3/${result.totalLaps} laps in ${result.raceTime.toFixed(1)}s (pos=${result.resultsPos}, replayFrames=${result.replayLen}, drawCalls=${result.drawCalls}, tris=${result.triangles})`);

  if (verifyReplay) {
    assert(result.replayLen > 100, 'ReplayRecorder should contain >100 frames after 3-lap race');
    await client.eval('document.getElementById("btn-replay").click()');
    await client.waitUntil('window.gameInstance.state === "REPLAY" && window.gameInstance.replayReadIdx > 5', 'Replay mode advances');
    const replayBannerVisible = await client.eval('!document.getElementById("replay-banner").classList.contains("hidden")');
    assert(replayBannerVisible, 'Replay banner should be visible in REPLAY state');

    // Esc exits replay back to results without double awarding cash/stars
    await client.pressKey('Escape', 'Escape');
    await client.waitUntil('window.gameInstance.state === "FINISHED" && !document.getElementById("results-screen").classList.contains("hidden")', 'Esc exits REPLAY to FINISHED + ResultsScreen');
    const afterExit = await client.eval('(() => { const s = JSON.parse(localStorage.getItem("ghat_rush_save_v1") || "{}"); return { cash: s.cash, stars: s.stars }; })()');
    assert(afterExit.cash === result.cash && afterExit.stars === result.stars, 'Exiting replay must NOT double-award cash or stars');

    // Click Race Again and verify clean reset
    await client.eval('document.getElementById("btn-restart").click()');
    await client.waitUntil('window.gameInstance.state === "COUNTDOWN" && document.getElementById("results-screen").classList.contains("hidden")', 'Race Again restarts to COUNTDOWN');
    console.log('✓ Watch Replay + Esc exit + Race Again checks passed');
  }

  client.assertCleanErrors(trackId);
}

async function runPhase2Checks(client) {
  console.log('--- Phase 2 Functional Checks (Cornering, Warnings, Traffic, Crashes, R Reset) ---');

  // 1. Verify lane counts match tracks.json on all 3 tracks
  for (const tId of TRACKS) {
    await client.navigate(`${BASE_URL}/?track=${tId}&autostart=1`);
    const info = await client.eval(`(() => {
      const g = window.gameInstance;
      return {
        expectedLanes: g.trackConfig.lanes,
        splineLanes: g.spline.getLaneCenters().length,
        trafficLanes: g.traffic.lanes.length,
        corners: g.spline.corners?.length || 0,
        chevrons: g.scenery.cornerChevrons?.length || 0
      };
    })()`);
    assert(info.splineLanes === info.expectedLanes && info.trafficLanes === info.expectedLanes,
      `${tId}: lanes mismatch (config=${info.expectedLanes}, spline=${info.splineLanes}, traffic=${info.trafficLanes})`);
    assert(info.corners > 0 && info.chevrons > 0, `${tId}: expected corners & Scenery chevron signs`);
    console.log(`✓ ${tId}: lanes=${info.trafficLanes}, sharpCorners=${info.corners}, chevronSigns=${info.chevrons}`);
  }

  // 2. Cornering physics, HUD warning, Traffic fairness/signals, Crashes, R reset on Konkan Cliffs
  await client.navigate(`${BASE_URL}/?track=coast_route_1&autostart=1`);
  client.clearErrors();
  await client.clickCenter();

  const physicsCheck = await client.eval(`(() => {
    const g = window.gameInstance;
    g.loop.stop();
    while (g.state === 'COUNTDOWN') g.update(1 / 60);

    const bike = g.playerBike;
    const tightCorner = g.spline.corners[1]; // s ~ 2482, safe ~185 km/h

    // Test 2a: Approaching tight bend without steering -> curvature drift pushes outside (+d)
    bike.exitGhostMode();
    bike.isCrashed = false;
    bike.s = tightCorner.startS;
    bike.d = 0;
    bike.lean = 0;
    bike.steerSmoothed = 0;
    bike.speed = 215 / 3.6;
    g.input.keys.clear();
    g.input.keys.add('KeyW');
    for (let i = 0; i < 45; i++) g.update(1 / 60);
    const unsteeredDriftD = bike.d;
    const unsteeredCrashed = bike.isCrashed;

    // Test 2b: Same bend at 235 km/h even with full counter-lean exceeds grip & runs wide
    bike.isCrashed = false;
    bike.exitGhostMode();
    bike.s = tightCorner.startS;
    bike.d = 0;
    bike.lean = 0;
    bike.steerSmoothed = 0;
    bike.speed = 240 / 3.6;
    g.input.keys.clear();
    g.input.keys.add('KeyW');
    g.input.keys.add('KeyA');
    let overspeedMaxD = 0;
    let overspeedGripDemand = 0;
    let overspeedCrashed = false;
    for (let i = 0; i < 65; i++) {
      g.update(1 / 60);
      if (bike.d > overspeedMaxD) overspeedMaxD = bike.d;
      if (bike.gripDemandRatio > overspeedGripDemand) overspeedGripDemand = bike.gripDemandRatio;
      if (bike.isCrashed) overspeedCrashed = true;
    }

    // Test 2c: Same bend at 172 km/h WITH KeyW + counter-lean holds inside cleanly without crashing
    bike.isCrashed = false;
    bike.exitGhostMode();
    bike.s = tightCorner.startS;
    bike.d = 0;
    bike.lean = 0;
    bike.steerSmoothed = 0;
    bike.speed = 172 / 3.6;
    g.input.keys.clear();
    g.input.keys.add('KeyW');
    g.input.keys.add('KeyA');
    for (let i = 0; i < 65; i++) g.update(1 / 60);
    const controlled = { crashed: bike.isCrashed, d: bike.d };

    // Test 2c-gentle: Full throttle (285 km/h) on gentle bend holds lane with counter-lean
    let gentleS = 200;
    for (let i = 0; i < g.spline.sampleCount; i++) {
      const k = Math.abs(g.spline.samples[i].curvature);
      if (k >= 0.002 && k <= 0.004) { gentleS = g.spline.samples[i].s; break; }
    }
    bike.isCrashed = false;
    bike.exitGhostMode();
    bike.s = gentleS;
    bike.d = 0;
    bike.lean = 0;
    bike.steerSmoothed = 0;
    bike.speed = 285 / 3.6;
    const gFrame = g.spline.getFrameAtDistance(gentleS);
    g.input.keys.clear();
    g.input.keys.add('KeyW');
    if (gFrame.curvature > 0) g.input.keys.add('KeyA');
    else g.input.keys.add('KeyD');
    for (let i = 0; i < 45; i++) g.update(1 / 60);
    const gentleControlled = { crashed: bike.isCrashed, d: bike.d };

    // Test 2d: HUD corner warning appears 100m before tight corner
    bike.isCrashed = false;
    bike.exitGhostMode();
    bike.s = g.spline.wrapDistance(tightCorner.startS - 95);
    bike.d = 0;
    bike.speed = 35;
    g.input.keys.clear();
    g.update(1 / 60);
    const cwEl = document.getElementById('hud-corner-warning');
    const cornerWarn = {
      visible: cwEl && !cwEl.classList.contains('hidden'),
      chevrons: cwEl?.querySelector('.cw-chevrons')?.textContent || '',
      dist: cwEl?.querySelector('.cw-dist')?.textContent || ''
    };

    // Test 2e: Traffic 80m clear-lane invariant + 1s telegraphed indicator test
    g.traffic.reset();
    let invariantViolated = false;
    let observedSignalThenMove = false;
    {
      const savedMax = g.traffic.maxActive;
      g.traffic.maxActive = 1;
      const laneCenters = g.traffic.lanes;
      const sv = g.traffic.vehicles[0];
      sv.active = true;
      sv.s = g.spline.wrapDistance(bike.s + 110);
      sv.d = laneCenters[0];
      sv.targetD = laneCenters[0];
      sv.pendingLaneIdx = 1;
      sv.pendingTargetD = laneCenters[1];
      sv.laneChangeState = 'signaling';
      sv.signalTimer = 1.0;
      sv.speed = 15;
      sv.group.visible = true;
      g.traffic.activeVehicles.push(sv);

      let movedEarly = false;
      let blinked = false;
      const startD = sv.d;
      for (let tStep = 0; tStep < 80; tStep++) {
        g.traffic.update(1 / 60, bike.s, 40);
        const tSec = (tStep + 1) / 60;
        if (sv.posXIndicator.visible || sv.negXIndicator.visible) blinked = true;
        if (tSec < 0.92 && Math.abs(sv.d - startD) > 0.05) movedEarly = true;
        if (tSec > 1.2 && Math.abs(sv.d - startD) > 0.15 && !movedEarly && blinked) {
          observedSignalThenMove = true;
        }
      }
      g.traffic.maxActive = savedMax;
      g.traffic.reset();
    }

    for (let step = 0; step < 500; step++) {
      g.traffic.update(1 / 60, bike.s, 40);
      const active = g.traffic.getActiveList();
      if (step % 15 === 0) {
        const lanesCount = g.traffic.lanes.length;
        for (const anchor of active) {
          const occ = new Set();
          for (const other of active) {
            const ds = g.traffic.wrapSigned(other.s - anchor.s);
            if (ds >= 0 && ds <= 80) {
              occ.add(g.traffic.getNearestLaneIndex(other.d));
            }
          }
          if (occ.size >= lanesCount) {
            invariantViolated = true;
            break;
          }
        }
      }
    }

    // Test 2f: Traffic crash vs Rail crash + 0.3s @ 0.4x slow-mo + R reset (+1s penalty, no crash animation)
    g.traffic.reset();
    bike.isCrashed = false;
    bike.exitGhostMode();
    bike.s = 200;
    bike.d = 0;
    bike.speed = 52;
    bike.lean = 0;
    const tv = g.traffic.vehicles[0];
    tv.active = true;
    tv.s = 202.5;
    tv.d = 0;
    tv.targetD = 0;
    tv.speed = 12;
    tv.group.visible = true;
    g.traffic.activeVehicles.push(tv);
    g.slowMoTimer = 0;
    for (let i = 0; i < 16; i++) g.update(1 / 60);
    const afterTrafficCrash = {
      isCrashed: bike.isCrashed,
      crashType: bike.crashType,
      d: bike.d,
      slowMo: g.slowMoTimer,
      shake: g.cameraRig.crashShakeTimer,
      riderRotZ: bike.rider.group.rotation.z,
      leftArmRotZ: bike.rider.leftArm.rotation.z
    };

    // Wait out crash respawn
    for (let i = 0; i < 150 && bike.isCrashed; i++) g.update(1 / 60);
    const lanes = g.spline.getLaneCenters();
    const respawnedOnLane = lanes.some(ld => Math.abs(bike.d - ld) < 0.05);
    const riderResetOk = Math.abs(bike.rider.group.rotation.x) < 0.01;

    // Test Rail crash puts bike at rail
    bike.exitGhostMode();
    bike.isCrashed = false;
    bike.d = 6.9;
    bike.speed = 55;
    bike.triggerCrash('rail');
    const halfW = (g.trackConfig.roadWidth || 14) / 2;
    const railD = bike.d;
    const railType = bike.crashType;
    for (let i = 0; i < 150 && bike.isCrashed; i++) g.update(1 / 60);

    // Test R Reset (+1s penalty, no crash animation)
    bike.isCrashed = false;
    bike.exitGhostMode();
    bike.speed = 50;
    bike.d = 1.2;
    const tBeforeR = g.raceTime;
    g.input.resetJustPressed = true;
    g.update(1 / 60);
    const afterR = {
      isCrashed: bike.isCrashed,
      dtPenalty: g.raceTime - tBeforeR,
      speed: bike.speed,
      ghostTimer: bike.ghostTimer,
      onLane: lanes.some(ld => Math.abs(bike.d - ld) < 0.05)
    };

    g.loop.start();
    return {
      unsteeredDriftD,
      unsteeredCrashed,
      overspeedMaxD,
      overspeedGripDemand,
      overspeedCrashed,
      controlled,
      gentleControlled,
      cornerWarn,
      invariantViolated,
      observedSignalThenMove,
      afterTrafficCrash,
      respawnedOnLane,
      riderResetOk,
      railD,
      halfW,
      railType,
      afterR
    };
  })()`);

  assert(physicsCheck.unsteeredDriftD > 4.0 || physicsCheck.unsteeredCrashed,
    `Expected unsteered bike at 215 km/h to drift wide on tight corner, got d=${physicsCheck.unsteeredDriftD}`);
  assert(physicsCheck.overspeedCrashed || physicsCheck.overspeedMaxD > 5.0 || physicsCheck.overspeedGripDemand > 1.0,
    `Expected 240 km/h on tight corner to exceed grip / run wide, got ${JSON.stringify(physicsCheck)}`);
  assert(!physicsCheck.controlled.crashed && Math.abs(physicsCheck.controlled.d) < 5.5,
    `Expected controlled 172 km/h counter-lean to hold corner cleanly, got ${JSON.stringify(physicsCheck.controlled)}`);
  assert(!physicsCheck.gentleControlled.crashed && Math.abs(physicsCheck.gentleControlled.d) < 6.0,
    `Expected full throttle on gentle bend to hold cleanly, got ${JSON.stringify(physicsCheck.gentleControlled)}`);
  assert(physicsCheck.cornerWarn.visible && physicsCheck.cornerWarn.chevrons.length >= 1,
    `Expected HUD corner warning within 150m, got ${JSON.stringify(physicsCheck.cornerWarn)}`);
  assert(!physicsCheck.invariantViolated, '80m clear-lane traffic invariant violated!');
  assert(physicsCheck.observedSignalThenMove, 'Traffic lane change must telegraph 1s with blinker before moving');
  assert(physicsCheck.afterTrafficCrash.isCrashed && physicsCheck.afterTrafficCrash.crashType === 'traffic'
    && Math.abs(physicsCheck.afterTrafficCrash.d) < 3.0 && physicsCheck.afterTrafficCrash.slowMo > 0.01
    && physicsCheck.afterTrafficCrash.shake > 0.1 && Math.abs(physicsCheck.afterTrafficCrash.riderRotZ) > 0.15
    && physicsCheck.afterTrafficCrash.leftArmRotZ < -1.0,
    `Traffic crash physics mismatch: ${JSON.stringify(physicsCheck.afterTrafficCrash)}`);
  assert(physicsCheck.respawnedOnLane && physicsCheck.riderResetOk, 'Crash respawn must snap to valid lane and reset rider pose');
  assert(physicsCheck.railType === 'rail' && Math.abs(Math.abs(physicsCheck.railD) - (physicsCheck.halfW - 0.45)) < 0.1,
    `Rail crash must place bike at rail edge: ${JSON.stringify(physicsCheck)}`);
  assert(!physicsCheck.afterR.isCrashed && physicsCheck.afterR.dtPenalty >= 1.0 && physicsCheck.afterR.onLane && physicsCheck.afterR.ghostTimer > 1.0,
    `R reset mismatch: ${JSON.stringify(physicsCheck.afterR)}`);

  client.assertCleanErrors('Phase 2 checks');
  console.log('✓ Phase 2 cornering, chevron warnings, fair signaling traffic, crash split & R reset checks passed');
}

async function main() {
  const newTarget = await openNewTab(`${BASE_URL}/?track=coast_route_1&autostart=1`);
  const client = new CDPClient(newTarget.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });

  try {
    if (PHASE === 1) {
      await runPhase1Checks(client);
    } else if (PHASE === 2) {
      await runPhase2Checks(client);
    }

    for (let i = 0; i < TRACKS.length; i++) {
      await runFullThreeLapRace(client, TRACKS[i], i === 0);
    }

    console.log(`\nALL PHASE ${PHASE} VERIFICATION CHECKS PASSED.`);
  } finally {
    await client.send('Target.closeTarget', { targetId: newTarget.id }).catch(() => {});
    client.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
