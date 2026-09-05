const net = require('node:net');

const DEVTOOLS_TIMEOUT_MS = 15_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function allocatePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForPage(port, urlFragment, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      const pages = await response.json();
      const page = pages.find((candidate) => candidate.type === 'page' && candidate.url.includes(urlFragment));
      if (page) return page;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for Electron page ${urlFragment}`);
}

class DevToolsClient {
  constructor(url, timeoutMs = DEVTOOLS_TIMEOUT_MS) {
    this.nextId = 1;
    this.pending = new Map();
    this.timeoutMs = timeoutMs;
    this.closed = false;
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`DevTools WebSocket connection timed out after ${this.timeoutMs}ms`));
        try { this.socket.close(); } catch {}
      }, this.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.removeEventListener('open', handleOpen);
        this.socket.removeEventListener('error', handleError);
        this.socket.removeEventListener('close', handleClose);
      };
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('DevTools WebSocket failed'));
      };
      const handleClose = () => {
        cleanup();
        reject(new Error('DevTools WebSocket closed before connecting'));
      };
      this.socket.addEventListener('open', handleOpen, { once: true });
      this.socket.addEventListener('error', handleError, { once: true });
      this.socket.addEventListener('close', handleClose, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
      } catch (error) {
        this.rejectPending(new Error(`DevTools returned invalid JSON: ${error.message}`));
        return;
      }
      if (!payload.id || !this.pending.has(payload.id)) return;
      const { resolve, reject, timer } = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      clearTimeout(timer);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result);
    });
    this.socket.addEventListener('close', () => {
      this.closed = true;
      this.rejectPending(new Error('DevTools WebSocket closed'));
    });
    this.socket.addEventListener('error', () => {
      this.rejectPending(new Error('DevTools WebSocket failed'));
    });
  }

  rejectPending(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  call(method, params = {}) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot call ${method}: DevTools WebSocket is not open`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`DevTools call ${method} timed out after ${this.timeoutMs}ms`));
        try { this.socket.close(); } catch {}
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Renderer evaluation failed');
    }
    return response.result.value;
  }

  close() {
    this.closed = true;
    this.rejectPending(new Error('DevTools client closed'));
    try { this.socket.close(); } catch {}
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await Promise.race([exited, delay(3_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([exited, delay(3_000)]);
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(1_000)]);
  }
}

module.exports = { delay, allocatePort, waitForPage, DevToolsClient, stopChild };
