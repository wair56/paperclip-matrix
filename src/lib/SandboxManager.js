import { existsSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { WORKSPACES_DIR } from './paths';
import getDb from './db';
import { getExecutorBinaryName } from './executors';
import { getPrimaryWorkspacePathForIdentity } from './workspaces';
import { getNodeSettings, resolveCliRuntimeEnv } from './nodeSettings';
import { buildMergedIdentityEnv } from './identityEnv';

export class SandboxManager {
  
  /**
   * Generates a securely isolated execution payload for an agent CLI process.
   * The sandbox:
   *  - Sets HOME to the workspace dir (prevents writing to real ~/.config)
   *  - Only passes explicitly declared environment variables
   *  - Confines working directory to workspace path
   */
  static getExecutionPayload(roleName, providedEnv = null, executorOverride = null) {
    const db = getDb();
    const identity = db.prepare(`SELECT * FROM identities WHERE role = ? AND status = 'active'`).get(roleName);
    if (!identity) {
      throw new Error(`Identity record missing for role "${roleName}". Register this agent first.`);
    }

    // Use the unique agentId to prevent workspace collisions across duplicate roles
    const workspacePath = getPrimaryWorkspacePathForIdentity(identity) || path.join(WORKSPACES_DIR, identity.agentId);
    
    // Ensure the physical sandbox directory exists
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }

    const parsedEnv = buildMergedIdentityEnv(identity);

    const nodeSettings = getNodeSettings();
    const globalCliEnv = resolveCliRuntimeEnv(nodeSettings);

    const isolatedEnv = {
      // Core OS survival variables
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE || process.env.HOME,
    };

    // 1. Global runtime env from dashboard settings
    for (const [key, value] of Object.entries(globalCliEnv)) {
      if (key !== 'PATH') {
        isolatedEnv[key] = value;
      }
    }

    // 2. Global proxy/base-url settings
    if (nodeSettings.proxy?.httpsProxy) {
      isolatedEnv.HTTPS_PROXY = nodeSettings.proxy.httpsProxy;
      isolatedEnv.HTTP_PROXY = nodeSettings.proxy.httpsProxy;
      isolatedEnv.ALL_PROXY = nodeSettings.proxy.httpsProxy;
    }
    if (nodeSettings.proxy?.openaiBaseUrl) {
      isolatedEnv.OPENAI_BASE_URL = nodeSettings.proxy.openaiBaseUrl;
    }

    // 3. Per-identity runtime env (except PATH, which we control)
    for (const [key, value] of Object.entries(parsedEnv)) {
      if (key !== 'PATH') {
        isolatedEnv[key] = value;
      }
    }

    // 4. Core structural variables from discrete identity columns
    isolatedEnv.PAPERCLIP_API_URL = identity.apiUrl;
    isolatedEnv.PAPERCLIP_COMPANY_ID = identity.companyId;
    isolatedEnv.PAPERCLIP_AGENT_ID = identity.agentId;
    if (identity.apiKey) isolatedEnv.PAPERCLIP_API_KEY = identity.apiKey;
    if (identity.executor) isolatedEnv.RUNNER_EXECUTOR = identity.executor;
    if (identity.model) isolatedEnv.RUNNER_MODEL = identity.model;
    if (identity.timeoutMs) isolatedEnv.RUNNER_TIMEOUT_MS = identity.timeoutMs.toString();

    // Enforce the strict working directory bound
    isolatedEnv.WORK_DIR = workspacePath;

    // 2. Resolve the executor name
    const executorName = executorOverride || isolatedEnv.RUNNER_EXECUTOR || 'claude-local';
    
    // 3. Resolve the CLI command
    //    We extract the pure tool name by removing prefixes/suffixes 
    //    (e.g., gemini-local -> gemini, openclaw-gateway -> openclaw)
    const baseCmdName = getExecutorBinaryName(executorName);
    const homeDir = os.homedir();
    const binaryPaths = [
      `${homeDir}/.local/bin/${baseCmdName}`,
      `${homeDir}/.bun/bin/${baseCmdName}`,
      `${homeDir}/.npm-global/bin/${baseCmdName}`,
      `/opt/homebrew/bin/${baseCmdName}`,
      `/usr/local/bin/${baseCmdName}`,
    ];
    
    let resolvedBinary = baseCmdName; // fallback
    for (const p of binaryPaths) {
      if (existsSync(p)) {
        resolvedBinary = p;
        break;
      }
    }

    // Extend PATH with common binary locations
    isolatedEnv.PATH = `${process.env.PATH || ''}:${homeDir}/.local/bin:${homeDir}/.bun/bin:/opt/homebrew/bin:/usr/local/bin`;

    // Executor-specific homes for CLIs that maintain local state databases.
    if (executorName === 'codex-local') {
      const codexHome = path.join(workspacePath, '.codex');
      if (!existsSync(codexHome)) {
        mkdirSync(codexHome, { recursive: true });
      }

      for (const relativePath of ['auth.json', 'config.toml']) {
        const source = path.join(homeDir, '.codex', relativePath);
        const target = path.join(codexHome, relativePath);
        try {
          if (existsSync(source) && !existsSync(target)) {
            copyFileSync(source, target);
          }
        } catch {}
      }

      isolatedEnv.CODEX_HOME = codexHome;
    }

    return {
      cwd: workspacePath,
      env: isolatedEnv,
      executorName,
      resolvedBinary,
    };
  }
}
