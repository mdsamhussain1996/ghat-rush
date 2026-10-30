import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';

async function run() {
  console.log('Connecting to Chrome CDP on 9222...');
  
  // 1. Create a new target page using PUT
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

  console.log('New target created:', newTarget.id, newTarget.webSocketDebuggerUrl);
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

  ws.on('open', async () => {
    console.log('WebSocket connected. Initializing domains...');
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false
    });

    console.log('Waiting 5s for track, procedural models, and audio initialization...');
    await new Promise(r => setTimeout(r, 5000));

    // Simulate click on canvas to unlock audio
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 640,
      y: 360,
      button: 'left',
      clickCount: 1
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 640,
      y: 360,
      button: 'left',
      clickCount: 1
    });

    // Check evaluate state
    const evalResult = await send('Runtime.evaluate', {
      expression: `({
        state: window.gameInstance ? window.gameInstance.state : null,
        playerSpeed: window.gameInstance ? window.gameInstance.playerBike.getSpeedKmh() : 0,
        rivalsCount: window.gameInstance ? window.gameInstance.rivalAI.rivals.length : 0,
        activeTraffic: window.gameInstance ? window.gameInstance.traffic.activeVehicles.length : 0,
        fps: window.gameInstance ? window.gameInstance.f3Overlay.fps : 0,
        stats: window.gameInstance ? window.gameInstance.renderer.getStats() : null
      })`,
      returnByValue: true
    });

    console.log('Game state check:', JSON.stringify(evalResult.result.value, null, 2));

    const diagResult = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        riderGroupVisible: window.gameInstance.playerBike.rider.group.visible,
        riderChildren: window.gameInstance.playerBike.rider.group.children.length,
        hipsChildren: window.gameInstance.playerBike.rider.hips.children.length,
        roadMeshInScene: window.gameInstance.scene.children.includes(window.gameInstance.roadMesh),
        roadMeshGeomVerts: window.gameInstance.roadMesh ? window.gameInstance.roadMesh.geometry.attributes.position.count : 0,
        cameraPos: window.gameInstance.cameraRig.camera.position,
        bikePos: window.gameInstance.playerBike.group.position
      })`,
      returnByValue: true
    });
    console.log('DIAGNOSTICS:', diagResult.result.value);

    // Capture initial screenshot
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('screenshots', { recursive: true });
    fs.writeFileSync('screenshots/test_screenshot.png', Buffer.from(shot.data, 'base64'));
    console.log('Saved screenshots/test_screenshot.png');

    console.log('Closing page...');
    await send('Target.closeTarget', { targetId: newTarget.id });
    ws.close();
    process.exit(0);
  });

  ws.on('message', (msg) => {
    const data = JSON.parse(msg.toString());
    if (data.id && callbacks.has(data.id)) {
      const { resolve } = callbacks.get(data.id);
      callbacks.delete(data.id);
      resolve(data.result);
    }
    if (data.method === 'Runtime.consoleAPICalled') {
      console.log('[Browser Console]', data.params.type, ...data.params.args.map(a => a.value || a.description));
      if (data.params.type === 'error') {
        consoleErrors.push(data.params);
      }
    }
    if (data.method === 'Runtime.exceptionThrown') {
      console.error('[Browser Exception]', data.params.exceptionDetails);
      consoleErrors.push(data.params.exceptionDetails);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    process.exit(1);
  });
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
