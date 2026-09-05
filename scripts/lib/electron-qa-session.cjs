const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { delay, allocatePort, waitForPage, DevToolsClient, stopChild } = require('./electron-test-driver.cjs');

async function waitUntil(check, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}

async function startSession(root, executable, dataDir) {
  const port = await allocatePort();
  const clients = [];
  const errors = [];
  let diagnostics = '';
  const child = spawn(executable, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${dataDir}`,
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'], {
    cwd: root,
    env: { ...process.env, OKNOTE_DATA_DIR: dataDir, OKNOTE_E2E_TEST: '1', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-8000); });
  child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-8000); });
  child.on('error', (error) => { errors.push(error.message); });
  const session = {
    port, errors,
    async page(fragment) {
      const target = await waitForPage(port, fragment);
      const client = new DevToolsClient(target.webSocketDebuggerUrl);
      clients.push(client);
      await client.connect();
      client.socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') {
          errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        }
      });
      await client.call('Runtime.enable');
      await waitUntil(() => client.evaluate('return Boolean(window.electronAPI && document.body && document.body.children.length);'), 'renderer readiness');
      return client;
    },
    async stop() {
      if (session.calendar) {
        try { await session.calendar.evaluate('return await window.electronAPI.finishIsolatedTest();'); } catch {}
      }
      clients.forEach((client) => client.close());
      await stopChild(child);
      assert.ok(child.exitCode !== null || child.signalCode !== null, 'isolated Electron process must stop');
    },
    diagnostics: () => diagnostics,
  };
  try {
    session.calendar = await session.page('#/calendar');
    await waitUntil(() => session.calendar.evaluate('return Boolean(document.querySelector(".cal-month-title"));'), 'calendar initial render');
  }
  catch (error) { await session.stop(); throw new Error(`${error.message}\n${diagnostics}`); }
  return session;
}

async function click(client, selector, text) {
  await client.call('Page.bringToFront');
  const point = await waitUntil(() => client.evaluate(`
    const elements = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const target = elements.find((el) => el.getClientRects().length && !el.closest('[aria-hidden="true"]')
      && (${JSON.stringify(text)} === undefined || el.textContent.trim() === ${JSON.stringify(text)}));
    if (!target) return null;
    target.scrollIntoView({ block: 'nearest' });
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !target.contains(hit)) return null;
    return { x, y };
  `), `clickable control: ${selector}${text ? ` / ${text}` : ''}`, 5000);
  await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await delay(80);
}

async function fill(client, selector, value) {
  await client.call('Page.bringToFront');
  await client.evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus();`);
  // Let React commit focus-driven mode changes before delivering text input.
  await delay(80);
  await client.evaluate(`
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error('Missing input: ' + ${JSON.stringify(selector)});
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (input.type !== 'range' && input.type !== 'color') {
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setter.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  `);
  await delay(80);
}

async function key(client, keyName, code) {
  await client.call('Page.bringToFront');
  const codes = { Enter: 13, Escape: 27, Tab: 9, ' ': 32, ArrowDown: 40, ArrowUp: 38 };
  const params = { key: keyName, code: code || keyName, windowsVirtualKeyCode: codes[keyName] || 0 };
  await client.call('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
  await client.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  await delay(80);
}

module.exports = { startSession, waitUntil, click, fill, key };
