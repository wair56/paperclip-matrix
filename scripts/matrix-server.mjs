import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, '.data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const PID_FILE = path.join(DATA_DIR, 'matrix-server.pid');
const LOG_FILE = path.join(LOGS_DIR, 'matrix-server.log');
const PORT = String(process.env.MATRIX_APP_PORT || process.env.PORT || 3010);
const HOST = String(process.env.MATRIX_APP_HOST || '127.0.0.1');
const SERVER_BASE_URL = `http://${HOST}:${PORT}`;
const STARTUP_TIMEOUT_MS = 30000;
const STARTUP_POLL_MS = 500;

for (const dir of [DATA_DIR, LOGS_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readTrackedPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number.parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  return Number.isFinite(pid) ? pid : null;
}

function clearPidFile() {
  if (existsSync(PID_FILE)) rmSync(PID_FILE, { force: true });
}

function writePidFile(pid) {
  writeFileSync(PID_FILE, `${pid}\n`, 'utf8');
}

function stopTrackedProcess() {
  const pid = readTrackedPid();
  if (!pid) {
    clearPidFile();
    return { stopped: false, reason: 'No tracked server pid file.' };
  }

  if (!isPidRunning(pid)) {
    clearPidFile();
    return { stopped: false, reason: `Tracked pid ${pid} is not running.` };
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
  clearPidFile();
  return { stopped: true, pid };
}

function ensureBuild() {
  const result = spawnSync('bun', ['--bun', 'next', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT,
      MATRIX_APP_PORT: PORT,
      MATRIX_APP_HOST: HOST,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

async function waitForServerReady() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_BASE_URL}/api/identity`, {
        headers: { accept: 'application/json' },
      });
      if (res.ok) return true;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(STARTUP_POLL_MS);
  }

  throw lastError || new Error('Timed out waiting for server readiness');
}

async function requestFrpAction(action) {
  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/frp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.warn(`[matrix-server] FRP ${action} skipped: ${res.status}${text ? ` ${text}` : ''}`);
      return false;
    }
    console.log(`[matrix-server] FRP ${action} ok${text ? `: ${text}` : ''}`);
    return true;
  } catch (error) {
    console.warn(`[matrix-server] FRP ${action} failed: ${error?.message || String(error)}`);
    return false;
  }
}

async function startServer() {
  const existing = readTrackedPid();
  if (existing && isPidRunning(existing)) {
    await requestFrpAction('start');
    console.log(JSON.stringify({ ok: true, alreadyRunning: true, pid: existing, host: HOST, port: Number(PORT) }));
    return;
  }

  clearPidFile();
  ensureBuild();

  const out = openSync(LOG_FILE, 'a');
  const child = spawn('bun', ['--bun', 'next', 'start', '--hostname', HOST, '--port', PORT], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT,
      MATRIX_APP_PORT: PORT,
      MATRIX_APP_HOST: HOST,
    },
  });

  child.unref();
  writePidFile(child.pid);

  await waitForServerReady();
  await requestFrpAction('start');

  console.log(JSON.stringify({
    ok: true,
    started: true,
    pid: child.pid,
    host: HOST,
    port: Number(PORT),
    logFile: LOG_FILE,
  }));
}

function printStatus() {
  const pid = readTrackedPid();
  const running = pid ? isPidRunning(pid) : false;
  if (!running && pid) clearPidFile();
  console.log(JSON.stringify({
    ok: true,
    running,
    pid: running ? pid : null,
    host: HOST,
    port: Number(PORT),
    logFile: LOG_FILE,
  }));
}

const command = process.argv[2] || 'status';

switch (command) {
  case 'start':
    await startServer();
    break;
  case 'stop':
    console.log(JSON.stringify({ ok: true, ...stopTrackedProcess() }));
    break;
  case 'restart':
    stopTrackedProcess();
    await startServer();
    break;
  case 'status':
    printStatus();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
