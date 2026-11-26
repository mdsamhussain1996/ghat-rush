import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import WebSocket from 'ws';

const CDP_PORT = 9222;
const BASE_URL = 'http://localhost:3006';
const OUT_DIR = path.resolve('screenshots');

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
  const target = await openNewTab(`${BASE_URL}/`);
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

  const snap = async (filename) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(data, 'base64'));
    console.log(`Captured ${filename}`);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  });

  for (let i = 0; i < 60; i++) {
    const ready = await evaluate('Boolean(window.gameInstance && document.readyState === "complete")').catch(() => false);
    if (ready) break;
    await sleep(100);
  }
  await sleep(400);

  // 1. Title Screen screenshot
  await snap('playtest_title.png');

  // Navigate to Coastal race autostart
  await send('Page.navigate', { url: `${BASE_URL}/?track=coast_route_1&autostart=1` });
  for (let i = 0; i < 60; i++) {
    const ready = await evaluate('Boolean(window.gameInstance && window.gameInstance.playerBike)').catch(() => false);
    if (ready) break;
    await sleep(100);
  }
  await sleep(300);

  // Click to unlock audio
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });

  // 2. Straightaway screenshot (after countdown, accelerating with nitro)
  await evaluate(`(() => {
    const g = window.gameInstance;
    g.loop.stop();
    while (g.state === 'COUNTDOWN') g.update(1 / 60);
    g.input.keys.add('KeyW');
    g.input.keys.add('Space');
    for (let i = 0; i < 160; i++) g.update(1 / 60);
    g.render(0, performance.now());
  })()`);
  await snap('playtest_straight.png');

  // 3. Tight leaning corner screenshot (approaching sharp corner with full left lean + tire smoke/skid)
  await evaluate(`(() => {
    const g = window.gameInstance;
    const corner = g.spline.corners[1];
    g.playerBike.s = g.spline.wrapDistance(corner.startS - 10);
    g.playerBike.d = 0.5;
    g.playerBike.speed = 62;
    g.input.keys.clear();
    g.input.keys.add('KeyW');
    g.input.keys.add('KeyA');
    for (let i = 0; i < 38; i++) g.update(1 / 60);
    g.render(0, performance.now());
  })()`);
  await snap('playtest_corner.png');

  // 4. Finish Line / Results Screen screenshot
  await evaluate(`(() => {
    const g = window.gameInstance;
    g.input.keys.clear();
    g.playerBike.lap = g.totalLaps;
    g.playerBike.s = g.spline.totalLength - 4;
    g.playerBike.speed = 55;
    for (let i = 0; i < 20; i++) g.update(1 / 60);
    g.render(0, performance.now());
    g.loop.start();
  })()`);
  await sleep(250);
  await snap('playtest_finish.png');

  const perf = await evaluate(`(() => {
    const g = window.gameInstance;
    const st = g.renderer.getStats();
    return { state: g.state, drawCalls: st.drawCalls, triangles: st.triangles };
  })()`);
  console.log('Playtest final check:', JSON.stringify(perf));
  console.log('Console errors:', consoleErrors.length, 'Exceptions:', exceptions.length);

  if (consoleErrors.length > 0 || exceptions.length > 0) {
    throw new Error(`Errors found: ${consoleErrors.join('; ')} ${exceptions.join('; ')}`);
  }

  await send('Target.closeTarget', { targetId: target.id }).catch(() => {});
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
