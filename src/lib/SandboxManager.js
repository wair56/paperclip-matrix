import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { WORKSPACES_DIR } from './paths';
import getDb from './db';

export class SandboxManager {
  
  /**
   * Generates a securely isolated execution payload for an agent CLI process.
   * The sandbox:
   *  - Sets HOME to the workspace dir (prevents writing to real ~/.config)
   *  - Only passes explicitly declared environment variables
   *  - Confines working directory to workspace path
   */
  static getExecutionPayload(roleName, providedEnv = null) {
    const db = getDb();
    const identity = db.prepare(`SELECT * FROM identities WHERE role = ? AND status = 'active'`).get(roleName);
    if (!identity) {
      throw new Error(`Identity record missing for role "${roleName}". Register this agent first.`);
    }

    // Use the unique agentId to prevent workspace collisions across duplicate roles
    const workspacePath = path.join(WORKSPACES_DIR, identity.agentId);
    
    // Ensure the physical sandbox directory exists
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }

    let parsedEnv = {};
    if (identity.envJson) {
      try { parsedEnv = JSON.parse(identity.envJson); } catch (e) {}
    }

    // Always inject core structural variables from the discrete columns
    parsedEnv.PAPERCLIP_API_URL = identity.apiUrl;
    parsedEnv.PAPERCLIP_COMPANY_ID = identity.companyId;
    parsedEnv.PAPERCLIP_AGENT_ID = identity.agentId;
    if (identity.apiKey) parsedEnv.PAPERCLIP_API_KEY = identity.apiKey;
    if (identity.executor) parsedEnv.RUNNER_EXECUTOR = identity.executor;
    if (identity.model) parsedEnv.RUNNER_MODEL = identity.model;
    if (identity.timeoutMs) parsedEnv.RUNNER_TIMEOUT_MS = identity.timeoutMs.toString();

    const isolatedEnv = {
      // Core OS survival variables
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE || process.env.HOME,
    };

    // Merge parsed conf vars (except PATH, which we control)
    for (const [key, value] of Object.entries(parsedEnv)) {
      if (key !== 'PATH') {
        isolatedEnv[key] = value;
      }
    }

    // Enforce the strict working directory bound
    isolatedEnv.WORK_DIR = workspacePath;

    // 2. Resolve the executor name
    const executorName = isolatedEnv.RUNNER_EXECUTOR || 'claude-local';
    
    // 3. Resolve the CLI command
    //    We extract the pure tool name by removing prefixes/suffixes 
    //    (e.g., gemini-local -> gemini, openclaw-gateway -> openclaw)
    const baseCmdName = executorName.split('-')[0] || 'claude';
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

    return {
      cwd: workspacePath,
      env: isolatedEnv,
      executorName,
      resolvedBinary,
    };
  }
}

