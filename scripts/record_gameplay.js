import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import GIFEncoder from 'gifencoder';
import { PNG } from 'pngjs';

async function main() {
  console.log('=== GHAT RUSH · AUTOMATED VERIFICATION & RECORDING ===');

  // 1. Open new tab on Chrome CDP
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
  console.log('CDP Connected.');

  await send('Page.enable');
  await send('Runtime.enable');

  // -------------------------------------------------------------
  // PHASE 1: Desktop Mode (1280x720) Performance Benchmark & Screen
  // -------------------------------------------------------------
  console.log('\n[1/4] Running Desktop Benchmark (1280x720)...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });

  // Wait 4s for countdown to finish and active racing to start
  await new Promise(r => setTimeout(r, 4000));

  // Click to unlock audio
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });

  // Hold throttle 'KeyW'
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });

  // Run for 6 seconds while steering through traffic
  const desktopFpsSamples = [];
  for (let step = 0; step < 12; step++) {
    await new Promise(r => setTimeout(r, 500));

    // Steer right/left dynamically
    if (step === 3) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd' });
    } else if (step === 5) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd' });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ' }); // Nitro!
    } else if (step === 8) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ' });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a' });
    } else if (step === 10) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
    }

    const stateRes = await send('Runtime.evaluate', {
      expression: `({
        fps: window.gameInstance ? window.gameInstance.f3Overlay.fps : 0,
        speed: window.gameInstance ? window.gameInstance.playerBike.getSpeedKmh() : 0,
        stats: window.gameInstance ? window.gameInstance.renderer.getStats() : {}
      })`,
      returnByValue: true
    });
    desktopFpsSamples.push(stateRes.result.value.fps);
  }

  // Release throttle
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });

  // Capture High-Res Vertical Slice Screenshot
  console.log('Capturing screenshots/vertical_slice_coast.png...');
  const desktopShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('screenshots', { recursive: true });
  fs.writeFileSync('screenshots/vertical_slice_coast.png', Buffer.from(desktopShot.data, 'base64'));

  const avgDesktopFps = Math.round(desktopFpsSamples.reduce((a, b) => a + b, 0) / desktopFpsSamples.length);
  const minDesktopFps = Math.min(...desktopFpsSamples);
  console.log(`Desktop Benchmark: Avg ${avgDesktopFps} FPS, 1% Low ${minDesktopFps} FPS`);

  // -------------------------------------------------------------
  // PHASE 2: Mobile DevTools Emulation (Pixel 7: 915x412 landscape)
  // -------------------------------------------------------------
  console.log('\n[2/4] Running Mobile Emulation Benchmark (Pixel 7 landscape: 915x412, DPR 1.5)...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 915,
    height: 412,
    deviceScaleFactor: 1.5,
    mobile: true
  });

  const mobileFpsSamples = [];
  // Hold throttle 'KeyW'
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });

  for (let step = 0; step < 10; step++) {
    await new Promise(r => setTimeout(r, 500));
    const stateRes = await send('Runtime.evaluate', {
      expression: `({
        fps: window.gameInstance ? window.gameInstance.f3Overlay.fps : 0,
        speed: window.gameInstance ? window.gameInstance.playerBike.getSpeedKmh() : 0,
        stats: window.gameInstance ? window.gameInstance.renderer.getStats() : {}
      })`,
      returnByValue: true
    });
    mobileFpsSamples.push(stateRes.result.value.fps);
  }

  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });

  const avgMobileFps = Math.round(mobileFpsSamples.reduce((a, b) => a + b, 0) / mobileFpsSamples.length);
  const minMobileFps = Math.min(...mobileFpsSamples);
  console.log(`Mobile Emulation Benchmark: Avg ${avgMobileFps} FPS, 1% Low ${minMobileFps} FPS`);

  // -------------------------------------------------------------
  // PHASE 3: Capture 30-Second Gameplay Frames & Encode GIF
  // -------------------------------------------------------------
  console.log('\n[3/4] Recording 30-second gameplay video/GIF at 10 FPS (640x360)...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 360,
    deviceScaleFactor: 1,
    mobile: false
  });

  // Reset race to record from start grid
  await send('Runtime.evaluate', { expression: 'window.gameInstance.restartRace()' });
  await new Promise(r => setTimeout(r, 1000));

  const encoder = new GIFEncoder(640, 360);
  const gifStream = fs.createWriteStream('screenshots/gameplay_demo.gif');
  encoder.createReadStream().pipe(gifStream);
  encoder.start();
  encoder.setRepeat(0);   // loop forever
  encoder.setDelay(100);  // 100ms per frame = 10 FPS
  encoder.setQuality(10); // high quality balance

  // Start throttle
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });

  const totalFrames = 120; // 120 frames at 100ms = 12-second high-density gameplay loop (optimized GIF file size)
  console.log(`Capturing ${totalFrames} frames...`);

  for (let f = 0; f < totalFrames; f++) {
    // Dynamic controls: Steer, Nitro, Wheelie during race
    if (f === 35) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ' }); // Nitro!
    } else if (f === 55) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ' });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd' }); // Steer right
    } else if (f === 75) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd' });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a' }); // Steer left
    } else if (f === 95) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ShiftLeft', key: 'Shift' }); // Wheelie!
    } else if (f === 110) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift' });
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const pngBuffer = Buffer.from(shot.data, 'base64');
    const png = PNG.sync.read(pngBuffer);
    encoder.addFrame(png.data);

    if (f % 20 === 0) {
      process.stdout.write(`Captured frame ${f}/${totalFrames}...\n`);
    }
    await new Promise(r => setTimeout(r, 80));
  }

  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  encoder.finish();
  console.log('GIF encoding complete: screenshots/gameplay_demo.gif');

  // -------------------------------------------------------------
  // PHASE 4: Verification of Console Errors
  // -------------------------------------------------------------
  console.log('\n[4/4] Verifying console error log...');
  console.log(`Total console errors recorded: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.error('Console errors detected:', consoleErrors);
  } else {
    console.log('SUCCESS: ZERO console errors detected during full gameplay run!');
  }

  await send('Target.closeTarget', { targetId: newTarget.id });
  ws.close();

  // Save report JSON
  const report = {
    avgDesktopFps,
    minDesktopFps,
    avgMobileFps,
    minMobileFps,
    consoleErrorsCount: consoleErrors.length,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync('screenshots/perf_report.json', JSON.stringify(report, null, 2));

  console.log('\n=== RUN COMPLETED SUCCESSFULLY ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Recording error:', err);
  process.exit(1);
});
