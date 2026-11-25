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
      const aheadFrame1 = g.spline.getFrameAtDistance(g.spline.wrapDistance(bike.s + 35));
      const aheadFrame2 = g.spline.getFrameAtDistance(g.spline.wrapDistance(bike.s + 75));
      const peakCurv = Math.max(
        Math.abs(curFrame.curvature || 0),
        Math.abs(aheadFrame1.curvature || 0),
        Math.abs(aheadFrame2.curvature || 0)
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
      const driftComp = hasDriftPhysics ? -(curFrame.curvature || 0) * bike.speed * bike.speed * 0.032 : 0;
      const dErr = bestLaneD - bike.d;
      const steerCmd = Math.max(-1, Math.min(1, dErr * 0.65 + driftComp));

      let safeMs = 95;
      if (hasDriftPhysics && peakCurv > 0.004) {
        safeMs = Math.min(safeMs, Math.sqrt(7.2 / (peakCurv * 0.195)));
      }
      const brake = bike.speed > safeMs + 4 ? 0.9 : 0;
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
