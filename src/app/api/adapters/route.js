import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import os from 'os';
import { existsSync } from 'fs';

/**
 * Registry of all known adapters and their CLI detection/install metadata.
 * 
 * `cli` — the actual binary name to check (null = no local CLI needed, e.g. gateway adapters)
 * `installCmd` — one-liner install command
 * `installDoc` — URL to official install docs
 * `note` — any extra setup guidance
 */
const ADAPTER_REGISTRY = {
  'claude-local': {
    cli: 'claude',
    label: 'Claude Code',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    installDoc: 'https://docs.anthropic.com/en/docs/claude-code',
    note: 'Requires Anthropic API key or Max subscription',
  },
  'codex-local': {
    cli: 'codex',
    label: 'Codex CLI',
    installCmd: 'npm install -g @openai/codex',
    installDoc: 'https://github.com/openai/codex',
    note: 'Requires OpenAI API key',
  },
  'gemini-local': {
    cli: 'gemini',
    label: 'Gemini CLI',
    installCmd: 'npm install -g @anthropic-ai/gemini-cli',
    installDoc: 'https://github.com/anthropics/gemini-cli',
    note: 'Requires Google AI API key or gcloud login',
  },
  'cursor-local': {
    cli: 'agent',
    label: 'Cursor Agent',
    installCmd: 'Install Cursor IDE → Enable CLI from Settings',
    installDoc: 'https://docs.cursor.com/agent',
    note: 'Requires Cursor subscription',
  },
  'opencode-local': {
    cli: 'opencode',
    label: 'OpenCode',
    installCmd: 'npm install -g opencode',
    installDoc: 'https://github.com/nichochar/opencode',
    note: 'Requires LLM provider API key',
  },
  'pi-local': {
    cli: 'pi',
    label: 'Pi Agent',
    installCmd: 'npm install -g @anthropic-ai/pi',
    installDoc: 'https://github.com/anthropics/pi',
    note: 'Requires LLM provider API key',
  },
  'hermes-local': {
    cli: 'hermes',
    label: 'Hermes Agent',
    installCmd: 'pip install hermes-agent',
    installDoc: 'https://github.com/NousResearch/hermes-agent',
    note: 'Requires Python 3.10+ and LLM API key in ~/.hermes/.env',
  },
  'openclaw-gateway': {
    cli: null, // gateway adapter, no local CLI needed
    label: 'OpenClaw Gateway',
    installCmd: null,
    installDoc: 'https://github.com/openclaw/openclaw',
    note: 'WebSocket gateway — no local CLI required',
  },
};

/**
 * Check if a CLI binary is available on the system.
 * Uses `which` (macOS/Linux) to locate the binary.
 */
function isCLIAvailable(binaryName) {
  if (!binaryName) return true; // gateway adapters always "available"
  
  const homeDir = os.homedir();
  
  // Fast check: common install paths (avoids shell overhead)
  const commonPaths = [
    `${homeDir}/.local/bin/${binaryName}`,
    `${homeDir}/.bun/bin/${binaryName}`,
    `${homeDir}/.npm-global/bin/${binaryName}`,
    `/opt/homebrew/bin/${binaryName}`,
    `/usr/local/bin/${binaryName}`,
    `${homeDir}/.cargo/bin/${binaryName}`,
  ];
  
  for (const p of commonPaths) {
    if (existsSync(p)) return true;
  }
  
  // Fallback: use `which` command
  try {
    execSync(`which ${binaryName}`, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect CLI version if available.
 */
function getCLIVersion(binaryName) {
  if (!binaryName) return null;
  try {
    const version = execSync(`${binaryName} --version 2>&1`, {
      stdio: 'pipe',
      timeout: 5000,
      encoding: 'utf-8',
    }).trim();
    // Extract first line, limit to 60 chars
    return version.split('\n')[0].substring(0, 60);
  } catch {
    return null;
  }
}

let cachedResult = null;
let lastDetect = 0;
const CACHE_TTL = 60_000; // Re-detect every 60s

export async function GET() {
  const now = Date.now();
  
  if (cachedResult && now - lastDetect < CACHE_TTL) {
    return NextResponse.json(cachedResult);
  }

  const allAdapters = [];
  const availableAdapters = [];
  
  for (const [name, meta] of Object.entries(ADAPTER_REGISTRY)) {
    const installed = isCLIAvailable(meta.cli);
    const version = installed && meta.cli ? getCLIVersion(meta.cli) : null;
    
    const entry = {
      name,
      label: meta.label,
      cli: meta.cli,
      installed,
      version,
      installCmd: meta.installCmd,
      installDoc: meta.installDoc,
      note: meta.note,
    };
    
    allAdapters.push(entry);
    if (installed) {
      availableAdapters.push(name);
    }
  }

  cachedResult = {
    success: true,
    adapters: availableAdapters,       // only installed ones — used by dropdowns
    allAdapters,                        // full registry with install status — used by setup guide
    detectedAt: new Date().toISOString(),
  };
  lastDetect = now;

  return NextResponse.json(cachedResult);
}
