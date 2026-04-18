import { NextResponse } from 'next/server';
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';

import { getNodeSettings, resolveCliRuntimeEnv } from '@/lib/nodeSettings';
import { hasNonEmptyString } from '@/lib/cliEnv';

const HOME = os.homedir();
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const QUOTA_PROBE_TIMEOUT_MS = 15000;

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
  'hermes-local': [
    { id: 'codex', label: 'Codex' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'dmx-gpt-5.4', label: 'DMX GPT-5.4' },
    { id: 'dmx-gpt-5.4-mini', label: 'DMX GPT-5.4 Mini' },
    { id: 'dmx-claude-sonnet-4-6', label: 'DMX Claude Sonnet 4.6' },
    { id: 'codechn-gpt-5.4', label: 'CodeCHN GPT-5.4' },
    { id: 'openai-gpt-5.4', label: 'OpenAI GPT-5.4' },
    { id: 'ark-coding-claude-sonnet', label: 'Ark Claude Sonnet' },
    { id: 'ark-coding-gpt-5.4', label: 'Ark GPT-5.4' },
    { id: 'codechn-gpt-5.2-codex', label: 'CodeCHN GPT-5.2 Codex' },
    { id: 'codechn-gpt-5.3-codex', label: 'CodeCHN GPT-5.3 Codex' },
    { id: 'ark-code-latest', label: 'Ark Code Latest' },
    { id: 'doubao-seed-code', label: 'Doubao Seed Code' },
    { id: 'kimi-k2.5', label: 'Kimi K2.5' },
    { id: 'glm-4.7', label: 'GLM 4.7' },
    { id: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
    { id: 'doubao-seed-2.0-code', label: 'Doubao Seed 2.0 Code' },
    { id: 'doubao-seed-2.0-pro', label: 'Doubao Seed 2.0 Pro' },
    { id: 'doubao-seed-2.0-lite', label: 'Doubao Seed 2.0 Lite' },
    { id: 'minimax-m2.5', label: 'MiniMax M2.5' },
    { id: 'glm-5.1', label: 'GLM 5.1' },
  ],
  'openclaw-gateway': [],
};

function dedupeModels(models = []) {
  const seen = new Set();
  return models.filter((model) => {
    const id = model?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readTomlString(raw, key) {
  const match = raw.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]+)"`, 'm'));
  return match?.[1] || null;
}

function readTomlBoolean(raw, key) {
  const match = raw.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(true|false)`, 'm'));
  return match ? match[1] === 'true' : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (hasNonEmptyString(value)) return value.trim();
  }
  return null;
}

function dedupeStrings(values = []) {
  return Array.from(new Set(values.filter((value) => hasNonEmptyString(value)).map((value) => value.trim())));
}

function readJsonFile(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────
// Config file readers
// ──────────────────────────────────────────────────────

function readClaudeConfig() {
  try {
    const settingsPath = path.join(/* turbopackIgnore: true */ HOME, '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return null;
    const raw = JSON.parse(readFileSync(/* turbopackIgnore: true */ settingsPath, 'utf-8'));
    const env = raw?.env || {};
    const models = [];
    if (env.CLAUDE_CODE_DEFAULT_MODEL) models.push({ id: env.CLAUDE_CODE_DEFAULT_MODEL, label: env.CLAUDE_CODE_DEFAULT_MODEL });
    if (env.ANTHROPIC_DEFAULT_SONNET_MODEL) models.push({ id: env.ANTHROPIC_DEFAULT_SONNET_MODEL, label: env.ANTHROPIC_DEFAULT_SONNET_MODEL });
    if (env.ANTHROPIC_DEFAULT_OPUS_MODEL) models.push({ id: env.ANTHROPIC_DEFAULT_OPUS_MODEL, label: env.ANTHROPIC_DEFAULT_OPUS_MODEL });
    if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL) models.push({ id: env.ANTHROPIC_DEFAULT_HAIKU_MODEL, label: env.ANTHROPIC_DEFAULT_HAIKU_MODEL });

    return {
      currentModel: env.CLAUDE_CODE_DEFAULT_MODEL || null,
      baseUrl: env.ANTHROPIC_BASE_URL || null,
      hasApiKey: Boolean(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY),
      defaultSonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL || null,
      defaultOpus: env.ANTHROPIC_DEFAULT_OPUS_MODEL || null,
      defaultHaiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || null,
      models,
    };
  } catch {
    return null;
  }
}

function readCodexConfig() {
  try {
    const tomlPath = path.join(/* turbopackIgnore: true */ HOME, '.codex', 'config.toml');
    if (!existsSync(tomlPath)) return null;
    const raw = readFileSync(/* turbopackIgnore: true */ tomlPath, 'utf-8');
    return {
      currentModel: readTomlString(raw, 'model'),
      modelProvider: readTomlString(raw, 'model_provider'),
      baseUrl: readTomlString(raw, 'base_url'),
      envKey: readTomlString(raw, 'env_key'),
      wireApi: readTomlString(raw, 'wire_api'),
      disableResponseStorage: readTomlBoolean(raw, 'disable_response_storage'),
    };
  } catch {
    return null;
  }
}

function readCodexAuthSummary() {
  const authPath = path.join(/* turbopackIgnore: true */ HOME, '.codex', 'auth.json');
  const parsed = readJsonFile(authPath);
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    path: authPath,
    hasOpenAiApiKey: Boolean(parsed.OPENAI_API_KEY),
    authMode: parsed.auth_mode || null,
    lastRefresh: parsed.last_refresh || null,
    hasTokens: Boolean(parsed.tokens),
  };
}

function readGeminiConfig() {
  try {
    const settingsPath = path.join(/* turbopackIgnore: true */ HOME, '.gemini', 'settings.json');
    if (!existsSync(settingsPath)) return null;
    const raw = JSON.parse(readFileSync(/* turbopackIgnore: true */ settingsPath, 'utf-8'));
    return {
      authType: raw?.security?.auth?.selectedType || null,
      theme: raw?.ui?.theme || null,
    };
  } catch {
    return null;
  }
}

function readOpencodeConfig() {
  try {
    const possiblePaths = [
      path.join(/* turbopackIgnore: true */ HOME, '.config', 'opencode', 'config.json'),
      path.join(/* turbopackIgnore: true */ HOME, '.config', 'opencode', 'config.toml'),
      path.join(/* turbopackIgnore: true */ HOME, '.opencode', 'config.json'),
    ];
    for (const filePath of possiblePaths) {
      if (!existsSync(filePath)) continue;
      const raw = readFileSync(/* turbopackIgnore: true */ filePath, 'utf-8');
      if (filePath.endsWith('.json')) {
        const data = JSON.parse(raw);
        return { currentModel: data?.model || null, path: filePath };
      }
      return { currentModel: readTomlString(raw, 'model'), path: filePath };
    }
    return null;
  } catch {
    return null;
  }
}

function readHermesConfig() {
  try {
    const configPath = path.join(/* turbopackIgnore: true */ HOME, '.hermes', 'config.yaml');
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(/* turbopackIgnore: true */ configPath, 'utf-8');
    const modelMatch = raw.match(/^\s*default:\s*(.+)$/m);
    const providerMatch = raw.match(/^\s*provider:\s*(.+)$/m);
    const baseUrlMatch = raw.match(/^\s*base_url:\s*(.+)$/m);
    const maxTurnsMatch = raw.match(/^\s*max_turns:\s*(\d+)/m);

    const models = [];
    const providerLines = raw.split('\n');
    let inCustomProviders = false;
    providerLines.forEach((line) => {
      if (line.trim().startsWith('custom_providers:')) inCustomProviders = true;
      else if (inCustomProviders && line.trim().startsWith('model:')) {
        const model = line.trim().split(':').slice(1).join(':').trim();
        if (model) models.push({ id: model, label: model });
      } else if (inCustomProviders && !line.startsWith(' ') && !line.startsWith('-') && line.trim() !== '') {
        inCustomProviders = false;
      }
    });

    return {
      currentModel: modelMatch?.[1]?.trim() || null,
      provider: providerMatch?.[1]?.trim() || null,
      baseUrl: baseUrlMatch?.[1]?.trim() || null,
      maxTurns: maxTurnsMatch ? parseInt(maxTurnsMatch[1], 10) : null,
      models,
    };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────
// CLI command runners
// ──────────────────────────────────────────────────────

function getCliPath() {
  return `${HOME}/.local/bin:${HOME}/.bun/bin:${HOME}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`;
}

function runCliCommand(binary, args, { timeout = 8000, env = process.env } = {}) {
  return execFileSync(binary, args, {
    stdio: 'pipe',
    timeout,
    encoding: 'utf-8',
    env: { ...env, PATH: getCliPath() },
  }).trim();
}

function runCliVersion(binary) {
  try {
    const out = runCliCommand(binary, ['--version']);
    return out.split('\n')[0].substring(0, 80);
  } catch {
    try {
      const out = runCliCommand(binary, ['version']);
      return out.split('\n')[0].substring(0, 80);
    } catch {
      return null;
    }
  }
}

function runClaudeAuthStatus() {
  try {
    const out = runCliCommand('claude', ['auth', 'status'], { timeout: 5000 });
    const parsed = JSON.parse(out);
    return {
      loggedIn: parsed.loggedIn === true,
      authMethod: typeof parsed.authMethod === 'string' ? parsed.authMethod : null,
      subscriptionType: typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : null,
    };
  } catch {
    return null;
  }
}

function runHermesStatus() {
  try {
    const out = runCliCommand('hermes', ['status'], { timeout: 10000 });
    const modelMatch = out.match(/Model:\s+(.+)/);
    const providerMatch = out.match(/Provider:\s+(.+)/);
    const apiKeys = {};
    const lines = out.split('\n');
    for (const line of lines) {
      const keyMatch = line.match(/^\s{2}(\w[\w\s/.()-]*?)\s{2,}(✓|✗)\s*(\(.*?\))?$/);
      if (!keyMatch) continue;
      const keyName = keyMatch[1].trim();
      if (keyName && !keyName.startsWith('◆')) {
        apiKeys[keyName] = keyMatch[2] === '✓';
      }
    }
    return {
      currentModel: modelMatch?.[1]?.trim() || null,
      provider: providerMatch?.[1]?.trim() || null,
      apiKeys,
    };
  } catch {
    return null;
  }
}

function runOpencodeModels() {
  try {
    const out = runCliCommand('opencode', ['models'], { timeout: 10000 });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.includes('/'))
      .map((id) => ({ id, label: id }));
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────
// Runtime + quota helpers
// ──────────────────────────────────────────────────────

function getDashboardRuntimeEnv() {
  const nodeSettings = getNodeSettings();
  return {
    nodeSettings,
    dashboardEnv: resolveCliRuntimeEnv(nodeSettings),
  };
}

function detectShellEnvPresence(keys = []) {
  const targetKeys = dedupeStrings(keys).filter((key) => ENV_NAME_RE.test(key));
  if (targetKeys.length === 0) return {};

  const script = targetKeys
    .map((key) => `if [[ -n \"\${${key}:-}\" ]]; then echo ${key}=1; else echo ${key}=0; fi`)
    .join('; ');

  try {
    const out = execFileSync('/bin/zsh', ['-lc', script], {
      stdio: 'pipe',
      timeout: 3000,
      encoding: 'utf-8',
      env: { ...process.env, PATH: getCliPath() },
    });
    const result = {};
    for (const line of out.split('\n')) {
      const match = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(0|1)$/);
      if (match) result[match[1]] = match[2] === '1';
    }
    return result;
  } catch {
    return {};
  }
}

function buildEnvChecks(keys, dashboardEnv) {
  const uniqueKeys = dedupeStrings(keys).filter((key) => ENV_NAME_RE.test(key));
  const shellPresence = detectShellEnvPresence(uniqueKeys);
  return uniqueKeys.map((key) => ({
    key,
    dashboardConfigured: hasNonEmptyString(dashboardEnv[key]),
    processConfigured: hasNonEmptyString(process.env[key]),
    shellConfigured: shellPresence[key] === true,
    runtimeConfigured: hasNonEmptyString(dashboardEnv[key]) || hasNonEmptyString(process.env[key]),
  }));
}

function makeRuntimeHealth({ status = 'info', summary, envChecks = [], setupHints = [] } = {}) {
  const missingEnvKeys = envChecks.filter((entry) => !entry.runtimeConfigured).map((entry) => entry.key);
  const shellOnlyEnvKeys = envChecks
    .filter((entry) => !entry.runtimeConfigured && entry.shellConfigured)
    .map((entry) => entry.key);
  return {
    status,
    summary: summary || null,
    ready: status === 'ready',
    requiredEnvKeys: envChecks.map((entry) => entry.key),
    missingEnvKeys,
    shellOnlyEnvKeys,
    envChecks,
    setupHints: dedupeStrings(setupHints),
  };
}

function formatResetLabel(isoString) {
  if (!hasNonEmptyString(isoString)) return null;
  const ms = Date.parse(isoString);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

function summarizeQuotaWindows(windows = []) {
  return windows
    .slice(0, 3)
    .map((window) => {
      if (window.valueLabel) return `${window.label} ${window.valueLabel}`;
      if (window.usedPercent != null) return `${window.label} ${window.usedPercent}%`;
      return window.label;
    })
    .join(' · ');
}

function normalizeQuotaPayload(payload, adapterName) {
  if (!payload || typeof payload !== 'object') {
    return { supported: true, ok: false, windows: [], error: '额度探测返回为空' };
  }

  if (adapterName === 'codex-local') {
    const aggregated = payload.aggregated || null;
    const windows = Array.isArray(aggregated?.windows)
      ? aggregated.windows
      : Array.isArray(payload.rpc?.windows)
        ? payload.rpc.windows
        : Array.isArray(payload.wham?.windows)
          ? payload.wham.windows
          : [];
    const normalizedWindows = windows.map((window) => ({
      label: window.label || 'Quota',
      usedPercent: typeof window.usedPercent === 'number' ? window.usedPercent : null,
      resetsAt: window.resetsAt || null,
      resetLabel: formatResetLabel(window.resetsAt || null),
      valueLabel: window.valueLabel || null,
      detail: window.detail || null,
    }));
    const account = {
      email: payload.auth?.email || null,
      planType: payload.auth?.planType || null,
      lastRefresh: payload.auth?.lastRefresh || null,
    };
    const summary = summarizeQuotaWindows(normalizedWindows)
      || firstNonEmpty(account.planType ? `plan ${account.planType}` : null, account.email);
    return {
      supported: true,
      ok: aggregated?.ok === true || payload.rpc?.ok === true || payload.wham?.ok === true,
      source: aggregated?.source || (payload.rpc?.ok ? 'codex-rpc' : payload.wham?.ok ? 'codex-wham' : null),
      provider: aggregated?.provider || 'openai',
      summary,
      error: aggregated?.error || payload.rpc?.error || payload.wham?.error || null,
      windows: normalizedWindows,
      account,
      fetchedAt: payload.timestamp || new Date().toISOString(),
    };
  }

  if (adapterName === 'claude-local') {
    const aggregated = payload.aggregated || null;
    const windows = Array.isArray(aggregated?.windows)
      ? aggregated.windows
      : Array.isArray(payload.oauth?.windows)
        ? payload.oauth.windows
        : Array.isArray(payload.cli?.windows)
          ? payload.cli.windows
          : [];
    const normalizedWindows = windows.map((window) => ({
      label: window.label || 'Quota',
      usedPercent: typeof window.usedPercent === 'number' ? window.usedPercent : null,
      resetsAt: window.resetsAt || null,
      resetLabel: formatResetLabel(window.resetsAt || null),
      valueLabel: window.valueLabel || null,
      detail: window.detail || null,
    }));
    const account = {
      authMethod: payload.authStatus?.authMethod || null,
      subscriptionType: payload.authStatus?.subscriptionType || null,
    };
    const summary = summarizeQuotaWindows(normalizedWindows)
      || firstNonEmpty(account.subscriptionType ? `plan ${account.subscriptionType}` : null, account.authMethod);
    return {
      supported: true,
      ok: aggregated?.ok === true || payload.oauth?.ok === true || payload.cli?.ok === true,
      source: aggregated?.source || (payload.oauth?.ok ? 'anthropic-oauth' : payload.cli?.ok ? 'claude-cli' : null),
      provider: aggregated?.provider || 'anthropic',
      summary,
      error: aggregated?.error || payload.oauth?.error || payload.cli?.error || null,
      windows: normalizedWindows,
      account,
      fetchedAt: payload.timestamp || new Date().toISOString(),
    };
  }

  return { supported: false, ok: false, windows: [], error: '当前适配器未接入额度探测' };
}

function runQuotaProbe(adapterName, dashboardEnv) {
  const probePath = adapterName === 'codex-local'
    ? path.join(/* turbopackIgnore: true */ process.cwd(), 'adapters', 'codex-local', 'dist', 'cli', 'quota-probe.js')
    : adapterName === 'claude-local'
      ? path.join(/* turbopackIgnore: true */ process.cwd(), 'adapters', 'claude-local', 'dist', 'cli', 'quota-probe.js')
      : null;

  if (!probePath || !existsSync(probePath)) {
    return { supported: false, ok: false, windows: [], error: '当前适配器未接入额度探测' };
  }

  const result = spawnSync(process.execPath, [probePath, '--json'], {
    cwd: /* turbopackIgnore: true */ process.cwd(),
    env: { ...process.env, ...dashboardEnv, PATH: getCliPath() },
    timeout: QUOTA_PROBE_TIMEOUT_MS,
    encoding: 'utf-8',
    maxBuffer: 4 * 1024 * 1024,
  });

  if (result.error) {
    return { supported: true, ok: false, windows: [], error: result.error.message };
  }

  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    return {
      supported: true,
      ok: false,
      windows: [],
      error: (result.stderr || `额度探测退出码 ${result.status}`).trim(),
    };
  }

  try {
    return normalizeQuotaPayload(JSON.parse(stdout), adapterName);
  } catch {
    return {
      supported: true,
      ok: false,
      windows: [],
      error: `额度探测输出无法解析: ${stdout.slice(0, 160)}`,
    };
  }
}

function inferRuntimeHealth(adapterName, base, dashboardEnv) {
  switch (adapterName) {
    case 'codex-local': {
      const envChecks = buildEnvChecks(base.config?.envKey ? [base.config.envKey] : [], dashboardEnv);
      const missingEnvKeys = envChecks.filter((entry) => !entry.runtimeConfigured).map((entry) => entry.key);
      const shellOnlyEnvKeys = envChecks.filter((entry) => !entry.runtimeConfigured && entry.shellConfigured).map((entry) => entry.key);
      const setupHints = [];
      if (missingEnvKeys.length > 0) {
        setupHints.push(`在页面 CLI Runtime Config 中补充 ${missingEnvKeys.join(', ')}。`);
      }
      if (shellOnlyEnvKeys.length > 0) {
        setupHints.push(`检测到登录 shell 已有 ${shellOnlyEnvKeys.join(', ')}，但当前 Paperclip 运行时拿不到；可直接在页面保存，或带着这些环境变量重启服务。`);
      }
      if (base.config?.baseUrl) {
        setupHints.push(`当前 Codex 走 ${base.config.baseUrl}${base.config.envKey ? `，请确认 ${base.config.envKey} 对应该网关凭证。` : '。'}`);
      }
      if (!base.auth?.authenticated) {
        setupHints.push('如果你依赖本机登录态，请先确认 ~/.codex/auth.json 可用；如果依赖 API Key，请把对应 key 放到页面 runtime config。');
      }

      if (missingEnvKeys.length > 0) {
        return makeRuntimeHealth({
          status: shellOnlyEnvKeys.length > 0 ? 'warning' : 'needs_config',
          summary: shellOnlyEnvKeys.length > 0
            ? `Shell 已有 ${shellOnlyEnvKeys.join(', ')}，但当前服务运行时未注入。`
            : `Codex 运行时缺少 ${missingEnvKeys.join(', ')}。`,
          envChecks,
          setupHints,
        });
      }

      return makeRuntimeHealth({
        status: 'ready',
        summary: base.config?.envKey
          ? `Codex 运行时已具备 ${base.config.envKey}${base.currentModel ? `，当前模型 ${base.currentModel}` : ''}。`
          : 'Codex 未声明额外 env_key，当前将沿用本机登录态/配置。',
        envChecks,
        setupHints,
      });
    }
    case 'claude-local': {
      const envChecks = buildEnvChecks(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'], dashboardEnv);
      const runtimeHasKey = envChecks.some((entry) => entry.runtimeConfigured);
      const shellOnlyEnvKeys = envChecks.filter((entry) => !entry.runtimeConfigured && entry.shellConfigured).map((entry) => entry.key);
      const setupHints = [];
      if (base.auth?.authenticated) {
        if (base.config?.baseUrl) {
          setupHints.push(`当前 Claude 已配置第三方网关 ${base.config.baseUrl}。`);
        }
        return makeRuntimeHealth({
          status: 'ready',
          summary: `Claude 认证可用${base.auth?.method ? `（${base.auth.method}）` : ''}。`,
          envChecks,
          setupHints,
        });
      }
      setupHints.push('先执行 claude auth login，或者在页面 CLI Runtime Config 中配置 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN。');
      if (base.config?.baseUrl) {
        setupHints.push(`当前 Claude 已设置 ANTHROPIC_BASE_URL=${base.config.baseUrl}，缺少对应 key 时调用会失败。`);
      }
      if (shellOnlyEnvKeys.length > 0) {
        setupHints.push(`登录 shell 中已有 ${shellOnlyEnvKeys.join(', ')}，但当前服务进程拿不到；可以直接在页面保存。`);
      }
      return makeRuntimeHealth({
        status: runtimeHasKey || shellOnlyEnvKeys.length > 0 ? 'warning' : 'needs_config',
        summary: runtimeHasKey
          ? '已检测到 Claude API Key，但尚未确认完整登录态。'
          : shellOnlyEnvKeys.length > 0
            ? `Shell 已有 ${shellOnlyEnvKeys.join(', ')}，但当前服务未注入。`
            : 'Claude 尚未登录，也未检测到可用 API Key。',
        envChecks,
        setupHints,
      });
    }
    case 'gemini-local': {
      const envChecks = buildEnvChecks(['GOOGLE_API_KEY', 'GEMINI_API_KEY'], dashboardEnv);
      const runtimeHasKey = envChecks.some((entry) => entry.runtimeConfigured);
      const shellOnlyEnvKeys = envChecks.filter((entry) => !entry.runtimeConfigured && entry.shellConfigured).map((entry) => entry.key);
      const setupHints = [];
      if (base.config?.authType || runtimeHasKey) {
        return makeRuntimeHealth({
          status: 'ready',
          summary: base.config?.authType
            ? `Gemini 已配置 ${base.config.authType}。`
            : `Gemini 运行时已检测到 ${envChecks.filter((entry) => entry.runtimeConfigured).map((entry) => entry.key).join(', ')}。`,
          envChecks,
          setupHints,
        });
      }
      setupHints.push('先运行 Gemini 登录流程，或在页面 CLI Runtime Config 中配置 GOOGLE_API_KEY / GEMINI_API_KEY。');
      if (shellOnlyEnvKeys.length > 0) {
        setupHints.push(`登录 shell 中已有 ${shellOnlyEnvKeys.join(', ')}，但当前服务进程拿不到。`);
      }
      return makeRuntimeHealth({
        status: shellOnlyEnvKeys.length > 0 ? 'warning' : 'needs_config',
        summary: shellOnlyEnvKeys.length > 0
          ? `Shell 已有 ${shellOnlyEnvKeys.join(', ')}，但当前服务未注入。`
          : 'Gemini 尚未检测到登录态或 API Key。',
        envChecks,
        setupHints,
      });
    }
    case 'opencode-local': {
      const hintedKeys = [];
      const providerPrefix = firstNonEmpty(base.currentModel, base.config?.currentModel)?.split('/')?.[0] || null;
      if (providerPrefix === 'openai') hintedKeys.push('OPENAI_API_KEY');
      if (providerPrefix === 'anthropic') hintedKeys.push('ANTHROPIC_API_KEY');
      if (providerPrefix === 'google') hintedKeys.push('GOOGLE_API_KEY');
      const envChecks = buildEnvChecks(hintedKeys, dashboardEnv);
      const setupHints = [];
      if (base.models?.length > 0) {
        return makeRuntimeHealth({
          status: 'ready',
          summary: `OpenCode 已探测到 ${base.models.length} 个模型${base.currentModel ? `，当前 ${base.currentModel}` : ''}。`,
          envChecks,
          setupHints,
        });
      }
      setupHints.push('如果 OpenCode 没有列出模型，请先在本机 provider 配置中补齐对应 API Key。');
      return makeRuntimeHealth({
        status: envChecks.some((entry) => entry.runtimeConfigured) ? 'warning' : 'needs_config',
        summary: 'OpenCode 尚未列出可用模型。',
        envChecks,
        setupHints,
      });
    }
    case 'hermes-local': {
      const activeKeys = base.auth?.apiKeys
        ? Object.entries(base.auth.apiKeys).filter(([, ok]) => ok).map(([key]) => key)
        : [];
      const inactiveKeys = base.auth?.apiKeys
        ? Object.entries(base.auth.apiKeys).filter(([, ok]) => !ok).map(([key]) => key)
        : [];
      const setupHints = [];
      if (inactiveKeys.length > 0) {
        setupHints.push(`Hermes 上游 key 未全部就绪：${inactiveKeys.join('、')}。`);
      }
      if (activeKeys.length > 0 || base.currentModel) {
        return makeRuntimeHealth({
          status: 'ready',
          summary: activeKeys.length > 0
            ? `Hermes 已检测到 ${activeKeys.join('、')} 可用。`
            : `Hermes 当前模型 ${base.currentModel || '已配置'}。`,
          setupHints,
        });
      }
      setupHints.push('先在 Hermes 本地配置至少一个可用 provider key，再回到这里复查。');
      return makeRuntimeHealth({
        status: 'needs_config',
        summary: 'Hermes 尚未检测到可用 provider key。',
        setupHints,
      });
    }
    case 'cursor-local':
      return makeRuntimeHealth({
        status: 'info',
        summary: 'Cursor 主要依赖本地订阅/桌面端登录，当前仅做基础可用性展示。',
        setupHints: ['如需进一步探测，请先确保本机 Cursor Agent 可直接在终端运行。'],
      });
    case 'pi-local':
      return makeRuntimeHealth({
        status: 'info',
        summary: 'PI 需要额外 provider/model 参数，建议在具体 agent 上按需填写。',
        setupHints: ['如果要在 Paperclip 中跑 PI，请明确 provider/model，并在 agent 或全局 runtime env 中补齐凭证。'],
      });
    case 'openclaw-gateway':
      return makeRuntimeHealth({
        status: 'ready',
        summary: 'Gateway 模式不依赖本地 CLI 凭证。',
      });
    default:
      return makeRuntimeHealth({ status: 'info', summary: '暂无运行时诊断规则。' });
  }
}

// ──────────────────────────────────────────────────────
// Per-adapter status assembly
// ──────────────────────────────────────────────────────

function getAdapterStatus(adapterName, { includeQuota = false } = {}) {
  const { nodeSettings, dashboardEnv } = getDashboardRuntimeEnv();
  const models = ADAPTER_MODELS[adapterName] || [];
  const base = {
    adapter: adapterName,
    models: dedupeModels(models),
    config: null,
    liveStatus: null,
    version: null,
    quota: includeQuota ? runQuotaProbe(adapterName, dashboardEnv) : null,
    runtimeDashboard: {
      configuredKeys: Object.keys(dashboardEnv).sort(),
      configuredKeyCount: Object.keys(dashboardEnv).length,
      openaiBaseUrl: nodeSettings.proxy?.openaiBaseUrl || null,
      httpsProxyConfigured: Boolean(nodeSettings.proxy?.httpsProxy),
    },
  };

  switch (adapterName) {
    case 'claude-local': {
      base.version = runCliVersion('claude');
      base.config = readClaudeConfig();
      const authStatus = runClaudeAuthStatus();
      if (base.config?.models?.length > 0) {
        base.models = dedupeModels([...base.models, ...base.config.models]);
      }
      if (base.config?.currentModel) {
        base.currentModel = base.config.currentModel;
        base.currentProvider = base.config.baseUrl ? `API via ${base.config.baseUrl}` : 'Anthropic Direct';
      }
      base.auth = {
        authenticated: Boolean(authStatus?.loggedIn || base.config?.hasApiKey),
        method: authStatus?.loggedIn
          ? `${authStatus.authMethod || 'Claude login'}${authStatus.subscriptionType ? ` (${authStatus.subscriptionType})` : ''}`
          : base.config?.baseUrl
            ? 'API Key (3rd party)'
            : base.config?.hasApiKey
              ? 'API Key'
              : 'Not configured',
        authStatus,
      };
      break;
    }
    case 'codex-local': {
      base.version = runCliVersion('codex');
      base.config = readCodexConfig();
      const authSummary = readCodexAuthSummary();
      if (base.config?.currentModel) {
        base.currentModel = base.config.currentModel;
      }
      base.currentProvider = firstNonEmpty(
        base.config?.modelProvider,
        base.config?.baseUrl ? `API via ${base.config.baseUrl}` : null,
      );
      base.auth = {
        authenticated: Boolean(authSummary || hasNonEmptyString(dashboardEnv[base.config?.envKey || ''])),
        method: authSummary ? 'OAuth / local auth.json' : (base.config?.envKey ? `${base.config.envKey} (runtime env)` : 'Not configured'),
        details: authSummary,
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
      const liveModels = runOpencodeModels();
      if (liveModels.length > 0) {
        base.models = dedupeModels(liveModels);
        base.liveStatus = { source: 'opencode models', modelCount: liveModels.length };
      }
      if (base.config?.currentModel) base.currentModel = base.config.currentModel;
      base.currentProvider = base.currentModel?.split('/')?.[0] || null;
      base.auth = { authenticated: liveModels.length > 0 || Boolean(base.currentModel), method: 'Provider config' };
      break;
    }
    case 'hermes-local': {
      base.version = runCliVersion('hermes');
      const hermesConfig = readHermesConfig();
      base.config = hermesConfig;
      const live = runHermesStatus();
      if (live) {
        base.liveStatus = { source: 'hermes status', apiKeys: live.apiKeys };
        base.currentModel = live.currentModel || hermesConfig?.currentModel;
        base.currentProvider = live.provider || hermesConfig?.provider;
      } else if (hermesConfig) {
        base.currentModel = hermesConfig.currentModel;
        base.currentProvider = hermesConfig.provider;
      }
      const activeKeys = live?.apiKeys
        ? Object.entries(live.apiKeys).filter(([, value]) => value).map(([key]) => key)
        : [];
      base.auth = {
        authenticated: activeKeys.length > 0 || Boolean(base.currentModel),
        method: activeKeys.length > 0 ? activeKeys.join(', ') : (hermesConfig?.provider || 'Config'),
        apiKeys: live?.apiKeys || {},
      };
      if (hermesConfig?.models?.length > 0) {
        base.models = dedupeModels([...base.models, ...hermesConfig.models]);
      }
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

  base.runtimeHealth = inferRuntimeHealth(adapterName, base, dashboardEnv);
  base.setupHints = base.runtimeHealth.setupHints;
  return base;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const adapterName = body.adapter;
    const includeQuota = body.includeQuota === true;

    if (!adapterName) {
      return NextResponse.json({ success: false, error: 'Missing adapter name' }, { status: 400 });
    }

    const status = getAdapterStatus(adapterName, { includeQuota });
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
