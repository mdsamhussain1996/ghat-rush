/**
 * Comprehensive Headless Chrome CDP Verification for Ghat Rush Upgrades (Steps 2-5)
 */
import http from 'node:http';
import WebSocket from 'ws';

const CDP_PORT = 9222;
const BASE_URL = 'http://localhost:3006';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
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
      res.on('data', c => { body += c; });
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const target = await openNewTab(`${BASE_URL}/?track=coast_route_1&autostart=1`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const consoleErrors = [];
  const exceptions = [];

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        consoleErrors.push(JSON.stringify(msg.params.args));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        exceptions.push(JSON.stringify(msg.params.exceptionDetails));
      }
    });
  });

  const send = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  // Wait for gameInstance
  for (let i = 0; i < 60; i++) {
    const ready = await evaluate('Boolean(window.gameInstance && document.readyState === "complete")').catch(() => false);
    if (ready) break;
    await sleep(100);
  }

  // Click center to unlock AudioContext
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await sleep(100);

  const report = await evaluate(`(() => {
    const g = window.gameInstance;
    g.loop.stop();
    while (g.state === 'COUNTDOWN') g.update(1 / 60);

    const bike = g.playerBike;

    // 1. Verify Gamepad 0.15 deadzone & proportional rescaling + Touch + Keyboard
    const dzBelow = g.input.applyDeadzone(0.14);
    const dzAbove = g.input.applyDeadzone(0.575); // (0.575 - 0.15) / 0.85 = 0.5
    g.input.touchState.steerRight = true;
    g.input.touchState.throttle = true;
    const touchControls = g.input.getControls();
    g.input.clearAllInputs();
    const clearedControls = g.input.getControls();

    // 2. Verify Steerable Front Fork/Handlebar Assembly & Speed-Scaled Lean + Squat/Dive
    bike.reset();
    bike.speed = 12; // Low speed ~43 km/h
    for (let i = 0; i < 20; i++) {
      bike.update(1 / 60, { steer: 1, throttle: 1, brake: 0, nitro: false, wheelie: false, drift: false }, [], []);
    }
    const lowSpeedLean = Math.abs(bike.lean);
    const lowSpeedHandlebarAngle = bike.steerGroup.rotation.y;
    const accelSquatVal = bike.accelSquat;

    bike.speed = 55; // High speed ~198 km/h
    for (let i = 0; i < 25; i++) {
      bike.update(1 / 60, { steer: 1, throttle: 1, brake: 0, nitro: false, wheelie: false, drift: false }, [], []);
    }
    const highSpeedLean = Math.abs(bike.lean);

    // Braking nose-dive check & return to upright
    for (let i = 0; i < 24; i++) {
      bike.update(1 / 60, { steer: 0, throttle: 0, brake: 1, nitro: false, wheelie: false, drift: false }, [], []);
    }
    const brakeDiveVal = bike.brakeDive;
    const centeredLeanAfterRelease = Math.abs(bike.lean);

    // 3. Verify Engine Braking (coasting deceleration) & Slope Gravity & Off-Road Shoulder Friction
    bike.reset();
    bike.speed = 40;
    const speedBeforeCoast = bike.speed;
    for (let i = 0; i < 30; i++) {
      bike.update(1 / 60, { steer: 0, throttle: 0, brake: 0, nitro: false, wheelie: false, drift: false }, [], []);
    }
    const coastDecel = speedBeforeCoast - bike.speed;

    // Off-road shoulder drag check near road edge
    const halfW = (g.trackConfig.roadWidth || 14) / 2;
    bike.d = halfW - 0.5;
    bike.speed = 50;
    bike.update(1 / 60, { steer: 0, throttle: 1, brake: 0, nitro: false, wheelie: false, drift: false }, [], []);
    const offRoadFactor = bike.offRoadFactor;
    const isOffRoad = bike.isOffRoad;

    // 4. Verify Audio Engine & HUD Volume Sliders persistence
    const mixerBtn = document.getElementById('hud-mixer-btn');
    mixerBtn.click();
    const mixerVisible = !document.getElementById('hud-audio-mixer').classList.contains('hidden');
    const musicSlider = document.getElementById('hud-music-slider');
    const sfxSlider = document.getElementById('hud-sfx-slider');
    musicSlider.value = '0.45';
    musicSlider.dispatchEvent(new Event('input'));
    sfxSlider.value = '0.65';
    sfxSlider.dispatchEvent(new Event('input'));
    const savedSettings = JSON.parse(localStorage.getItem('ghat_rush_save_v1') || '{}').settings || {};

    g.render(0, performance.now());
    const stats = g.renderer.getStats();
    g.loop.start();

    return {
      dzBelow,
      dzAbove,
      touchSteer: touchControls.steer,
      touchThrottle: touchControls.throttle,
      clearedSteer: clearedControls.steer,
      lowSpeedLean,
      highSpeedLean,
      lowSpeedHandlebarAngle,
      accelSquatVal,
      brakeDiveVal,
      centeredLeanAfterRelease,
      coastDecel,
      offRoadFactor,
      isOffRoad,
      mixerVisible,
      savedMusicVol: savedSettings.musicVolume,
      savedSfxVol: savedSettings.sfxVolume,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles
    };
  })()`);

  console.log('Upgrade Verification Report:', JSON.stringify(report, null, 2));

  assert(report.dzBelow === 0 && Math.abs(report.dzAbove - 0.5) < 0.01, 'Gamepad 0.15 deadzone rescaling failed');
  assert(report.touchSteer === 1 && report.touchThrottle === 1 && report.clearedSteer === 0, 'Touch input or clearAllInputs failed');
  assert(report.lowSpeedHandlebarAngle < -0.1, `Expected front handlebar/wheel assembly to turn right (< -0.1 rad), got ${report.lowSpeedHandlebarAngle}`);
  assert(report.highSpeedLean > report.lowSpeedLean, `Expected bike to lean harder at higher speed (${report.highSpeedLean} vs ${report.lowSpeedLean})`);
  assert(report.accelSquatVal > 0.01 && report.brakeDiveVal > 0.05, `Expected positive accelSquat (${report.accelSquatVal}) and brakeDive (${report.brakeDiveVal})`);
  assert(report.centeredLeanAfterRelease < 0.15, `Expected lean to return smoothly toward upright, got ${report.centeredLeanAfterRelease}`);
  assert(report.coastDecel > 1.5, `Expected engine braking + aero drag on coasting, got ${report.coastDecel}`);
  assert(report.isOffRoad && report.offRoadFactor > 0.5, `Expected off-road shoulder detection near road edge, got ${report.offRoadFactor}`);
  assert(report.mixerVisible && report.savedMusicVol === 0.45 && report.savedSfxVol === 0.65, 'HUD Audio Mixer sliders did not persist to localStorage');
  assert(report.drawCalls <= 180 && report.triangles <= 60000, `Exceeded perf budget: ${report.drawCalls} draw calls, ${report.triangles} tris`);
  assert(consoleErrors.length === 0 && exceptions.length === 0, `Console errors/exceptions: ${consoleErrors.join(', ')} ${exceptions.join(', ')}`);

  await send('Target.closeTarget', { targetId: target.id }).catch(() => {});
  ws.close();
  console.log('✓ ALL STEP 2-5 UPGRADE CHECKS PASSED!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
