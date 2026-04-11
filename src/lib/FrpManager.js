import { spawn, spawnSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync, renameSync, chmodSync, rmSync, unlinkSync, openSync } from 'fs';
import path from 'path';
import os from 'os';
import { getNodeSettings } from './nodeSettings';
import { DATA_DIR, BIN_DIR } from './paths';

const isWin = os.platform() === 'win32';
const FRP_BIN = path.join(BIN_DIR, isWin ? 'frpc.exe' : 'frpc');
const PID_FILE = path.join(DATA_DIR, 'frp.pid');
const TOML_FILE = path.join(DATA_DIR, 'frpc.toml');
const LOG_FILE = path.join(DATA_DIR, 'frpc.log');

function getFrpDownloadUrl() {
  const arch = os.arch();
  let farch = 'amd64';
  if (arch === 'arm64') farch = 'arm64';
  const platform = isWin ? 'windows' : (os.platform() === 'darwin' ? 'darwin' : 'linux');
  const ext = isWin ? 'zip' : 'tar.gz';
  return `https://github.com/fatedier/frp/releases/download/v0.67.0/frp_0.67.0_${platform}_${farch}.${ext}`;
}

export async function ensureFrpInstalled() {
  if (existsSync(FRP_BIN)) return true;
  console.log('[FRP-Installer] frpc binary not found. Downloading v0.67.0...');
  
  const url = getFrpDownloadUrl();
  const archivePath = path.join(BIN_DIR, isWin ? 'frp.zip' : 'frp.tar.gz');
  
  try {
    const settings = getNodeSettings();

    // Download using spawn with array args (no shell injection)
    const curlArgs = ['-L', '-o', archivePath, url];
    if (settings.proxy?.httpsProxy) {
      curlArgs.unshift('-x', settings.proxy.httpsProxy);
    }
    const dlResult = spawnSync('curl', curlArgs, { stdio: 'inherit' });
    if (dlResult.status !== 0) throw new Error('curl download failed');

    console.log('[FRP-Installer] Extracting archive...');
    if (isWin) {
      spawnSync('powershell', [
        '-command',
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${BIN_DIR}' -Force`
      ], { stdio: 'inherit' });
    } else {
      spawnSync('tar', ['-xzf', archivePath, '-C', BIN_DIR], { stdio: 'inherit' });
    }
    
    const folderMatch = path.basename(url, isWin ? '.zip' : '.tar.gz');
    const extractedBin = path.join(BIN_DIR, folderMatch, isWin ? 'frpc.exe' : 'frpc');
    
    if (existsSync(extractedBin)) {
      // Use Node.js fs methods instead of shell commands
      renameSync(extractedBin, FRP_BIN);
      if (!isWin) {
        chmodSync(FRP_BIN, 0o755);
      }
      rmSync(path.join(BIN_DIR, folderMatch), { recursive: true, force: true });
      unlinkSync(archivePath);
      console.log('[FRP-Installer] Installation successful!');
      return true;
    }
    throw new Error('frpc binary not found in extracted archive.');
  } catch (err) {
    console.error('[FRP-Installer] Failed to install:', err);
    return false;
  }
}

export async function stopFrp() {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    try {
      process.kill(pid); // send SIGTERM
      console.log(`[FRP-Manager] Terminated frpc (PID: ${pid})`);
    } catch(e) {
      // process might not exist
    }
    try { unlinkSync(PID_FILE); } catch(e) {}
  }
  // NOTE: Removed `killall -9 frpc` — only kill the PID we manage,
  // to avoid terminating unrelated frpc processes on the machine.
  return true;
}

export async function startFrp(settings) {
  await stopFrp();
  await ensureFrpInstalled();

  // Generate toml
  const tomlContent = `
serverAddr = "${settings.serverAddr}"
serverPort = ${settings.serverPort}
auth.method = "token"
auth.token = "${settings.token}"

[[proxies]]
name = "matrix-webhook-tcp"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3000
remotePort = ${settings.remotePort}
`;
  writeFileSync(TOML_FILE, tomlContent.trim(), 'utf8');

  console.log(`[FRP-Manager] Starting frpc tunnel...`);
  const outLog = openSync(LOG_FILE, 'a');
  
  const child = spawn(FRP_BIN, ['-c', TOML_FILE], {
    detached: true,
    stdio: ['ignore', outLog, outLog]
  });
  
  child.unref();
  writeFileSync(PID_FILE, child.pid.toString(), 'utf8');
  console.log(`[FRP-Manager] frpc running with PID: ${child.pid}`);
  return child.pid;
}

export function getFrpStatus() {
  if (!existsSync(PID_FILE)) return { isRunning: false };
  const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  try {
    process.kill(pid, 0); // Check if process exists
    return { isRunning: true, pid };
  } catch(e) {
    return { isRunning: false };
  }
}
