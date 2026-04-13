import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';

const HOME = os.homedir();

/**
 * Hardcoded model lists from adapter index.ts files.
 * Serves as the universal fallback for all adapters.
 */
const ADAPTER_MODELS = {
  'claude-local': [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-6', label: 'Claude Haiku 4.6' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  'codex-local': [
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'o3', label: 'o3' },
    { id: 'o4-mini', label: 'o4-mini' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { id: 'gpt-5-nano', label: 'GPT-5 Nano' },
    { id: 'o3-mini', label: 'o3-mini' },
  ],
  'gemini-local': [
    { id: 'auto', label: 'Auto' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  ],
  'cursor-local': [
    { id: 'auto', label: 'Auto' },
    { id: 'composer-1.5', label: 'Composer 1.5' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { id: 'opus-4.6-thinking', label: 'Opus 4.6 Thinking' },
    { id: 'sonnet-4.6', label: 'Sonnet 4.6' },
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
  ],
  'opencode-local': [
    { id: 'openai/gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { id: 'openai/gpt-5.4', label: 'GPT-5.4' },
    { id: 'openai/gpt-5.2', label: 'GPT-5.2' },
    { id: 'openai/gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { id: 'openai/gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
  ],
  'pi-local': [],
  'hermes-local': [],
  'openclaw-gateway': [],
};

// ──────────────────────────────────────────────────────
// Phase 3: Config file readers
// ──────────────────────────────────────────────────────

function readClaudeConfig() {
  try {
    const settingsPath = path.join(HOME, '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return null;
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const env = raw?.env || {};
    return {
      currentModel: env.CLAUDE_CODE_DEFAULT_MODEL || null,
      baseUrl: env.ANTHROPIC_BASE_URL || null,
      hasApiKey: Boolean(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY),
      defaultSonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL || null,
      defaultOpus: env.ANTHROPIC_DEFAULT_OPUS_MODEL || null,
      defaultHaiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || null,
    };
  } catch { return null; }
}

function readCodexConfig() {
  try {
    const tomlPath = path.join(HOME, '.codex', 'config.toml');
    if (!existsSync(tomlPath)) return null;
    const raw = readFileSync(tomlPath, 'utf-8');
    // Simple TOML parser for model line
    const modelMatch = raw.match(/^model\s*=\s*"([^"]+)"/m);
    return {
      currentModel: modelMatch?.[1] || null,
    };
  } catch { return null; }
}

function readGeminiConfig() {
  try {
    const settingsPath = path.join(HOME, '.gemini', 'settings.json');
    if (!existsSync(settingsPath)) return null;
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return {
      authType: raw?.security?.auth?.selectedType || null,
      theme: raw?.ui?.theme || null,
    };
  } catch { return null; }
}

function readOpencodeConfig() {
  // OpenCode stores config in working dir or XDG — check common locations
  try {
    const possiblePaths = [
      path.join(HOME, '.config', 'opencode', 'config.json'),
      path.join(HOME, '.config', 'opencode', 'config.toml'),
      path.join(HOME, '.opencode', 'config.json'),
    ];
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        const raw = readFileSync(p, 'utf-8');
        if (p.endsWith('.json')) {
          const data = JSON.parse(raw);
          return { currentModel: data?.model || null };
        }
        // Simple TOML
        const m = raw.match(/^model\s*=\s*"([^"]+)"/m);
        return { currentModel: m?.[1] || null };
      }
    }
    return null;
  } catch { return null; }
}

function readHermesConfig() {
  try {
    const configPath = path.join(HOME, '.hermes', 'config.yaml');
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(configPath, 'utf-8');
    // Simple YAML extraction
    const modelMatch = raw.match(/^\s*default:\s*(.+)$/m);
    const providerMatch = raw.match(/^\s*provider:\s*(.+)$/m);
    const baseUrlMatch = raw.match(/^\s*base_url:\s*(.+)$/m);
    const maxTurnsMatch = raw.match(/^\s*max_turns:\s*(\d+)/m);
    return {
      currentModel: modelMatch?.[1]?.trim() || null,
      provider: providerMatch?.[1]?.trim() || null,
      baseUrl: baseUrlMatch?.[1]?.trim() || null,
      maxTurns: maxTurnsMatch ? parseInt(maxTurnsMatch[1]) : null,
    };
  } catch { return null; }
}

// ──────────────────────────────────────────────────────
// Phase 2: CLI command runners
// ──────────────────────────────────────────────────────

function getCliPath() {
  return `${HOME}/.local/bin:${HOME}/.bun/bin:${HOME}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`;
}

function runCliVersion(binary) {
  try {
    const out = execSync(`${binary} --version 2>&1`, {
      stdio: 'pipe', timeout: 8000, encoding: 'utf-8',
      env: { ...process.env, PATH: getCliPath() },
    }).trim();
    return out.split('\n')[0].substring(0, 80);
  } catch {
    // Some CLIs use `version` subcommand
    try {
      const out = execSync(`${binary} version 2>&1`, {
        stdio: 'pipe', timeout: 8000, encoding: 'utf-8',
        env: { ...process.env, PATH: getCliPath() },
      }).trim();
      return out.split('\n')[0].substring(0, 80);
    } catch { return null; }
  }
}

function runHermesStatus() {
  try {
    const out = execSync('hermes status 2>&1', {
      stdio: 'pipe', timeout: 10000, encoding: 'utf-8',
      env: { ...process.env, PATH: getCliPath() },
    });
    const modelMatch = out.match(/Model:\s+(.+)/);
    const providerMatch = out.match(/Provider:\s+(.+)/);
    
    // Parse API keys
    const apiKeys = {};
    const lines = out.split('\n');
    for (const line of lines) {
      const keyMatch = line.match(/^\s{2}(\w[\w\s/.()-]*?)\s{2,}(✓|✗)\s*(\(.*?\))?$/);
      if (keyMatch) {
        const keyName = keyMatch[1].trim();
        if (keyName && !keyName.startsWith('◆')) {
          apiKeys[keyName] = keyMatch[2] === '✓';
        }
      }
    }
    
    return {
      currentModel: modelMatch?.[1]?.trim() || null,
      provider: providerMatch?.[1]?.trim() || null,
      apiKeys,
    };
  } catch { return null; }
}

function runOpencodeModels() {
  try {
    const out = execSync('opencode models 2>&1', {
      stdio: 'pipe', timeout: 10000, encoding: 'utf-8',
      env: { ...process.env, PATH: getCliPath() },
    });
    const models = out.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && l.includes('/'));
    return models.map(id => ({ id, label: id }));
  } catch { return []; }
}

// ──────────────────────────────────────────────────────
// Per-adapter status assembly
// ──────────────────────────────────────────────────────

function getAdapterStatus(adapterName) {
  const models = ADAPTER_MODELS[adapterName] || [];
  const base = {
    adapter: adapterName,
    models,
    config: null,
    liveStatus: null,
    version: null,
  };
  
  switch (adapterName) {
    case 'claude-local': {
      base.version = runCliVersion('claude');
      base.config = readClaudeConfig();
      // Merge config model into current
      if (base.config?.currentModel) {
        base.currentModel = base.config.currentModel;
        base.currentProvider = base.config.baseUrl ? `API via ${base.config.baseUrl}` : 'Anthropic Direct';
      }
      base.auth = {
        authenticated: Boolean(base.config?.hasApiKey),
        method: base.config?.baseUrl ? 'API Key (3rd party)' : 'Anthropic Auth',
      };
      break;
    }
    case 'codex-local': {
      base.version = runCliVersion('codex');
      base.config = readCodexConfig();
      if (base.config?.currentModel) {
        base.currentModel = base.config.currentModel;
      }
      // Check auth file
      const authPath = path.join(HOME, '.codex', 'auth.json');
      base.auth = {
        authenticated: existsSync(authPath),
        method: existsSync(authPath) ? 'OAuth / API Key' : 'Not configured',
      };
      break;
    }
    case 'gemini-local': {
      base.version = runCliVersion('gemini');
      base.config = readGeminiConfig();
      base.currentModel = 'auto (default)';
      base.auth = {
        authenticated: Boolean(base.config?.authType),
        method: base.config?.authType || 'Not configured',
      };
      break;
    }
    case 'opencode-local': {
      base.version = runCliVersion('opencode');
      base.config = readOpencodeConfig();
      // Live models query
      const liveModels = runOpencodeModels();
      if (liveModels.length > 0) {
        base.models = liveModels;
        base.liveStatus = { source: 'opencode models', modelCount: liveModels.length };
      }
      if (base.config?.currentModel) {
        base.currentModel = base.config.currentModel;
      }
      base.auth = { authenticated: true, method: 'Provider config' };
      break;
    }
    case 'hermes-local': {
      base.version = runCliVersion('hermes');
      // Config file first
      const hermesConf = readHermesConfig();
      base.config = hermesConf;
      // Live status
      const live = runHermesStatus();
      if (live) {
        base.liveStatus = { source: 'hermes status', apiKeys: live.apiKeys };
        base.currentModel = live.currentModel || hermesConf?.currentModel;
        base.currentProvider = live.provider || hermesConf?.provider;
      } else if (hermesConf) {
        base.currentModel = hermesConf.currentModel;
        base.currentProvider = hermesConf.provider;
      }
      const activeKeys = live?.apiKeys
        ? Object.entries(live.apiKeys).filter(([, v]) => v).map(([k]) => k)
        : [];
      base.auth = {
        authenticated: activeKeys.length > 0 || Boolean(base.currentModel),
        method: activeKeys.length > 0 ? activeKeys.join(', ') : (hermesConf?.provider || 'Config'),
        apiKeys: live?.apiKeys || {},
      };
      break;
    }
    case 'cursor-local': {
      base.version = runCliVersion('agent');
      base.currentModel = 'auto';
      base.auth = { authenticated: false, method: 'Cursor subscription required' };
      break;
    }
    case 'pi-local': {
      base.version = runCliVersion('pi');
      base.currentModel = null;
      base.auth = { authenticated: false, method: 'Requires provider/model config' };
      break;
    }
    case 'openclaw-gateway': {
      base.currentModel = null;
      base.auth = { authenticated: true, method: 'WebSocket gateway' };
      break;
    }
  }
  
  return base;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const adapterName = body.adapter;
    
    if (!adapterName) {
      return NextResponse.json({ success: false, error: 'Missing adapter name' }, { status: 400 });
    }
    
    const status = getAdapterStatus(adapterName);
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
