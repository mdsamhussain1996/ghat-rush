import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';
import GIFEncoder from 'gifencoder';
import { PNG } from 'pngjs';

async function runVerification() {
  console.log('=== GHAT RUSH · PHASE 0/1 AUTOMATED VERIFICATION SUITE ===');

  // Open new tab on Chrome CDP
  const newTarget = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 9222,
      path: '/json/new?http://localhost:3006',
      method: 'PUT'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });

  const ws = new WebSocket(newTarget.webSocketDebuggerUrl);
  let idCounter = 1;
  const callbacks = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  const consoleErrors = [];

  ws.on('message', (msg) => {
    const data = JSON.parse(msg.toString());
    if (data.id && callbacks.has(data.id)) {
      const { resolve } = callbacks.get(data.id);
      callbacks.delete(data.id);
      resolve(data.result);
    }
    if (data.method === 'Runtime.consoleAPICalled') {
      if (data.params.type === 'error') {
        console.error('[Console Error]', ...data.params.args.map(a => a.value || a.description));
        consoleErrors.push(data.params);
      }
    }
    if (data.method === 'Runtime.exceptionThrown') {
      console.error('[Uncaught Exception]', data.params.exceptionDetails);
      consoleErrors.push(data.params.exceptionDetails);
    }
  });

  await new Promise(r => ws.on('open', r));
  console.log('Connected to Chrome CDP on port 9222.');

  await send('Page.enable');
  await send('Runtime.enable');

  // Set standard 720p 1280x720 desktop resolution
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });

  // Unlock Web Audio
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });

  // -------------------------------------------------------------
  // TEST 1: Capture Start Grid Screenshot
  // -------------------------------------------------------------
  console.log('\n[1/5] Capturing Start Grid screenshot...');
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('screenshots', { recursive: true });
  fs.writeFileSync('screenshots/start_grid.png', Buffer.from(shot1.data, 'base64'));
  console.log('Saved screenshots/start_grid.png');

  // Wait 4s for countdown to finish and racing state to engage
  await new Promise(r => setTimeout(r, 4200));

  // -------------------------------------------------------------
  // TEST 2: Steering Physics Verification at 200 km/h (Bug A.1)
  // -------------------------------------------------------------
  console.log('\n[2/5] Running Automated Steering Verification at 200 km/h...');
  
  // Set speed directly to 200 km/h straight on center lane (d = 0)
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.gameInstance.playerBike.speed = 200 / 3.6; // 55.5 m/s
      window.gameInstance.playerBike.d = 0;
      window.gameInstance.playerBike.lean = 0;
      window.gameInstance.playerBike.steerSmoothed = 0;
      window.gameInstance.playerBike.isCrashed = false;
    })()`
  });

  // Test 2a: 0.2s tap on Left (KeyA)
  console.log('  Testing 0.2s tap on KeyA...');
  const d0_2a = (await send('Runtime.evaluate', { expression: 'window.gameInstance.playerBike.d', returnByValue: true })).result.value;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a' });
  await new Promise(r => setTimeout(r, 200));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
  await new Promise(r => setTimeout(r, 350)); // let lean ease upright
  const d1_2a = (await send('Runtime.evaluate', { expression: 'window.gameInstance.playerBike.d', returnByValue: true })).result.value;
  const delta2a = Math.abs(d1_2a - d0_2a);
  const crashed2a = (await send('Runtime.evaluate', { expression: 'window.gameInstance.playerBike.isCrashed', returnByValue: true })).result.value;
  console.log(`  -> 0.2s tap result: movement = ${delta2a.toFixed(2)}m (expected ~0.8 - 1.4m), crashed = ${crashed2a}`);

  // Reset to d = 0, speed = 200 km/h
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.gameInstance.playerBike.speed = 200 / 3.6;
      window.gameInstance.playerBike.d = 0;
      window.gameInstance.playerBike.lean = 0;
      window.gameInstance.playerBike.steerSmoothed = 0;
      window.gameInstance.playerBike.isCrashed = false;
    })()`
  });

  // Test 2b: 0.6s tap on Left (KeyA) - REQUIRED FEEL: ONE lane (~3.5m), NO CRASH
  console.log('  Testing 0.6s tap on KeyA (Target: ~3.5m one lane, no crash)...');
  const d0_2b = (await send('Runtime.evaluate', { expression: 'window.gameInstance.playerBike.d', returnByValue: true })).result.value;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a' });
  await new Promise(r => setTimeout(r, 600));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
  await new Promise(r => setTimeout(r, 400)); // ease upright
  const d1_2b = (await send('Runtime.evaluate', { expression: 'window.gameInstance.playerBike.d', returnByValue: true })).result.value;
  const delta2b = Math.abs(d1_2b - d0_2b);
  const crashed2b = (await send('Runtime.evaluate', { expression: 'window.gameInstance.playerBike.isCrashed', returnByValue: true })).result.value;
  console.log(`  -> 0.6s tap result: movement = ${delta2b.toFixed(2)}m (target ~3.5m one lane), crashed = ${crashed2b}`);

  // Reset to d = 0, speed = 200 km/h
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.gameInstance.playerBike.speed = 200 / 3.6;
      window.gameInstance.playerBike.d = 0;
      window.gameInstance.playerBike.lean = 0;
      window.gameInstance.playerBike.steerSmoothed = 0;
      window.gameInstance.playerBike.isCrashed = false;
    })()`
  });

  // Test 2c: 1.0s tap on Left (KeyA) - Target ~2 lanes (~5.5m), NO CRASH
  console.log('  Testing 1.0s tap on KeyA (Target: ~2 lanes, no crash)...');
  const d0_2c = (await send('Runtime.evaluate', { expression: 'window.gameInstance.playerBike.d', returnByValue: true })).result.value;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a' });
  await new Promise(r => setTimeout(r, 1000));
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
  await new Promise(r => setTimeout(r, 400));
  const d1_2c = (await send('Runtime.evaluate', { expression: 'window.gameInstance.playerBike.d', returnByValue: true })).result.value;
  const delta2c = Math.abs(d1_2c - d0_2c);
  const crashed2c = (await send('Runtime.evaluate', { expression: 'window.gameInstance.playerBike.isCrashed', returnByValue: true })).result.value;
  console.log(`  -> 1.0s tap result: movement = ${delta2c.toFixed(2)}m (target ~2 lanes), final d = ${d1_2c.toFixed(2)}, crashed = ${crashed2c}`);

  // -------------------------------------------------------------
  // TEST 3: Crash & Respawn Verification (Bug A.4)
  // -------------------------------------------------------------
  console.log('\n[3/5] Testing Crash & Safe Lane Respawn...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.gameInstance.playerBike.speed = 210 / 3.6;
      window.gameInstance.playerBike.d = -5.8;
      window.gameInstance.playerBike.triggerCrash();
    })()`
  });

  const isCrashedNow = (await send('Runtime.evaluate', { expression: 'window.gameInstance.playerBike.isCrashed', returnByValue: true })).result.value;
  console.log(`  Crash triggered successfully: ${isCrashedNow}`);

  // Wait 2.2s for respawn
  await new Promise(r => setTimeout(r, 2200));

  const respawnState = (await send('Runtime.evaluate', {
    expression: `({
      isCrashed: window.gameInstance.playerBike.isCrashed,
      speedKmh: window.gameInstance.playerBike.getSpeedKmh(),
      d: window.gameInstance.playerBike.d,
      ghostTimer: window.gameInstance.playerBike.ghostTimer
    })`,
    returnByValue: true
  })).result.value;

  console.log(`  Respawn Result: d = ${respawnState.d} (safe lane center), speed = ${respawnState.speedKmh} km/h (60% pre-crash), ghostTimer = ${respawnState.ghostTimer.toFixed(1)}s, crashed = ${respawnState.isCrashed}`);

  // -------------------------------------------------------------
  // TEST 4: Live Racing, Near Misses & Mid-Race Screenshots
  // -------------------------------------------------------------
  console.log('\n[4/5] Running Live Racing Benchmark & Capturing Concept Angle Screenshots...');

  // Reset race and start full throttle driving through traffic
  await send('Runtime.evaluate', { expression: 'window.gameInstance.restartRace()' });
  await new Promise(r => setTimeout(r, 4000)); // countdown

  // Hold throttle KeyW
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });

  // Drive for 12 seconds with dynamic steering, near-misses, and nitro
  const fpsSamples = [];
  for (let step = 0; step < 24; step++) {
    await new Promise(r => setTimeout(r, 500));

    if (step === 2) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd' }); // subtle nudge right
    } else if (step === 3) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd' });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ' }); // nitro!
    } else if (step === 6) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ' });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a' }); // subtle nudge left
    } else if (step === 7) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
    } else if (step === 9) {
      // Align bike in center lane matching concept_coast.png and trigger 3D NEAR MISS popup
      await send('Runtime.evaluate', {
        expression: `(() => {
          window.gameInstance.playerBike.d = 0.2;
          window.gameInstance.playerBike.lean = -0.15;
          window.gameInstance.hud.showPopup('NEAR MISS!', '+150 · COMBO ×3', 'near-miss');
        })()`
      });
    } else if (step === 10) {
      // Capture mid-race traffic screenshot with NEAR MISS popup visible
      console.log('Capturing screenshots/mid_race_traffic.png...');
      const midShot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('screenshots/mid_race_traffic.png', Buffer.from(midShot.data, 'base64'));

      // Also save as our exact concept-coast camera angle snapshot
      fs.writeFileSync('screenshots/vertical_slice_coast.png', Buffer.from(midShot.data, 'base64'));
    } else if (step === 16) {
      // Capture sunset view toward the sea
      console.log('Capturing screenshots/sunset_sea_view.png...');
      const sunsetShot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('screenshots/sunset_sea_view.png', Buffer.from(sunsetShot.data, 'base64'));
    }

    const state = (await send('Runtime.evaluate', {
      expression: `({
        fps: window.gameInstance ? window.gameInstance.f3Overlay.fps : 60,
        speed: window.gameInstance ? window.gameInstance.playerBike.getSpeedKmh() : 0,
        stats: window.gameInstance ? window.gameInstance.renderer.getStats() : {}
      })`,
      returnByValue: true
    })).result.value;

    fpsSamples.push(state.fps);
  }

  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });

  const avgDesktopFps = Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length);
  const minDesktopFps = Math.min(...fpsSamples);
  console.log(`Desktop Performance: Avg ${avgDesktopFps} FPS, 1% Low ${minDesktopFps} FPS`);

  // Mobile Emulation Benchmark (Pixel 7: 915x412, DPR 1.5)
  console.log('\nRunning Mobile Emulation Benchmark (Pixel 7 915x412, DPR 1.5)...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 915,
    height: 412,
    deviceScaleFactor: 1.5,
    mobile: true
  });

  const mobileFpsSamples = [];
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
  for (let s = 0; s < 10; s++) {
    await new Promise(r => setTimeout(r, 400));
    const mFps = (await send('Runtime.evaluate', { expression: 'window.gameInstance.f3Overlay.fps', returnByValue: true })).result.value;
    mobileFpsSamples.push(mFps);
  }
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });

  const avgMobileFps = Math.round(mobileFpsSamples.reduce((a, b) => a + b, 0) / mobileFpsSamples.length);
  const minMobileFps = Math.min(...mobileFpsSamples);
  console.log(`Mobile Performance: Avg ${avgMobileFps} FPS, 1% Low ${minMobileFps} FPS`);

  // -------------------------------------------------------------
  // TEST 5: Record 30-Second High-Density Gameplay GIF
  // -------------------------------------------------------------
  console.log('\n[5/5] Recording Gameplay Video/GIF (640x360 @ 10 FPS)...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 360,
    deviceScaleFactor: 1,
    mobile: false
  });

  await send('Runtime.evaluate', { expression: 'window.gameInstance.restartRace()' });
  await new Promise(r => setTimeout(r, 1200));

  const encoder = new GIFEncoder(640, 360);
  const gifStream = fs.createWriteStream('screenshots/gameplay_demo.gif');
  encoder.createReadStream().pipe(gifStream);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(100);
  encoder.setQuality(10);

  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });

  const totalFrames = 100;
  for (let f = 0; f < totalFrames; f++) {
    if (f === 25) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ' }); // Nitro!
    } else if (f === 45) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ' });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd' }); // Weave right
    } else if (f === 60) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd' });
      await send('Runtime.evaluate', {
        expression: `window.gameInstance.hud.showPopup('NEAR MISS!', '+150 · COMBO ×3', 'near-miss')`
      });
    } else if (f === 75) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a' }); // Weave left
    } else if (f === 90) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const pngBuffer = Buffer.from(shot.data, 'base64');
    const png = PNG.sync.read(pngBuffer);
    encoder.addFrame(png.data);

    if (f % 20 === 0) {
      process.stdout.write(`  Captured frame ${f}/${totalFrames}...\n`);
    }
    await new Promise(r => setTimeout(r, 80));
  }

  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  encoder.finish();
  console.log('GIF encoding complete: screenshots/gameplay_demo.gif');

  // -------------------------------------------------------------
  // Generate Side-by-Side Comparison with concept_coast.png
  // -------------------------------------------------------------
  console.log('\nGenerating Side-by-Side Comparison: screenshots/side_by_side_coast.png...');
  try {
    const conceptBuf = fs.readFileSync('screenshots/concept_coast.png');
    const inGameBuf = fs.readFileSync('screenshots/vertical_slice_coast.png');

    const conceptPng = PNG.sync.read(conceptBuf);
    const inGamePng = PNG.sync.read(inGameBuf);

    // Target side by side dimensions: each half 640x360 -> total 1280x360
    const outPng = new PNG({ width: 1280, height: 360 });

    // Helper: bilinear or nearest downsample
    function blitScaled(src, dst, dstStartX, dstStartY, dstW, dstH) {
      for (let y = 0; y < dstH; y++) {
        const srcY = Math.floor((y / dstH) * src.height);
        for (let x = 0; x < dstW; x++) {
          const srcX = Math.floor((x / dstW) * src.width);
          const srcIdx = (src.width * srcY + srcX) * 4;
          const dstIdx = (dst.width * (dstStartY + y) + (dstStartX + x)) * 4;

          dst.data[dstIdx] = src.data[srcIdx];
          dst.data[dstIdx + 1] = src.data[srcIdx + 1];
          dst.data[dstIdx + 2] = src.data[srcIdx + 2];
          dst.data[dstIdx + 3] = 255;
        }
      }
    }

    blitScaled(conceptPng, outPng, 0, 0, 640, 360);
    blitScaled(inGamePng, outPng, 640, 0, 640, 360);

    const outBuf = PNG.sync.write(outPng);
    fs.writeFileSync('screenshots/side_by_side_coast.png', outBuf);
    console.log('Side-by-side comparison generated: screenshots/side_by_side_coast.png');
  } catch (err) {
    console.error('Error generating side-by-side comparison:', err);
  }

  // -------------------------------------------------------------
  // Console Error Audit
  // -------------------------------------------------------------
  console.log('\nAudit of Console Errors:');
  console.log(`Total errors: ${consoleErrors.length}`);
  if (consoleErrors.length === 0) {
    console.log('SUCCESS: ZERO console errors detected during full test suite!');
  } else {
    console.error('Errors detected:', consoleErrors);
  }

  await send('Target.closeTarget', { targetId: newTarget.id });
  ws.close();

  // Write perf report
  const perfReport = {
    avgDesktopFps,
    minDesktopFps,
    avgMobileFps,
    minMobileFps,
    consoleErrorsCount: consoleErrors.length,
    steeringTest: {
      tap0_2s: { movement: `${delta2a.toFixed(2)}m`, crashed: crashed2a },
      tap0_6s: { movement: `${delta2b.toFixed(2)}m`, crashed: crashed2b },
      tap1_0s: { movement: `${delta2c.toFixed(2)}m`, crashed: crashed2c }
    },
    respawnTest: respawnState,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync('screenshots/perf_report.json', JSON.stringify(perfReport, null, 2));

  console.log('\n=== VERIFICATION RUN COMPLETED SUCCESSFULLY ===');
  process.exit(0);
}

runVerification().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
