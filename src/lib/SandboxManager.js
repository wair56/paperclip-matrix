import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

// Define the unbreakable base paths relative to the NextJS root.
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, '.data');
const IDENTITIES_DIR = path.join(DATA_DIR, 'identities');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');

export class SandboxManager {
  
  /**
   * Generates a fully weaponized yet restricted payload to spawn an agent CLI safely.
   */
  static getExecutionPayload(roleName) {
    const identityPath = path.join(IDENTITIES_DIR, `${roleName}.env`);
    const workspacePath = path.join(WORKSPACES_DIR, roleName);

    if (!existsSync(identityPath)) {
      throw new Error(`Identity File Missing: ${roleName} has no credentials.`);
    }
    
    // Ensure the physical sandbox directory exists
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }

    // 1. Purge and rebuild isolated environment dictionary
    const rawEnvText = readFileSync(identityPath, 'utf8');
    const isolatedEnv = {
      // The Holy Trinity of OS survival without leaking absolute host secrets
      PATH: process.env.PATH,
      HOME: workspacePath,       // Fake HOME so it doesn't write to actual ~/.config
      USERPROFILE: workspacePath 
    };

    rawEnvText.split('\n').forEach(line => {
      const match = line.trim().match(/^export\s+([A-Z0-9_]+)=(.*)$/);
      // Also catch non-export lines for broader dotenv compatibility
      const matchNoExport = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
      
      const res = match || matchNoExport;
      if (res && res[1] !== 'PATH') {
          isolatedEnv[res[1]] = res[2].replace(/(^"|"$)/g, '');
      }
    });

    // Enforce the strict working directory bound
    isolatedEnv.WORK_DIR = workspacePath;

    // 2. Setup strict Deno/Node security bounds if executing TS/JS directly (optional)
    const runtimeArgs = [
      `--allow-fs-read=${workspacePath}`,
      `--allow-fs-write=${workspacePath}`
    ];

    // 3. Resolve the actual Adapter Runner Binary path
    const executorName = isolatedEnv.RUNNER_EXECUTOR || 'claude-local';
    
    // We expect natively copied adapters situated directly in the monorepo's 'adapters' folder
    const adapterPath = path.resolve(ROOT_DIR, 'adapters', executorName);
    const cliEntryFile = path.join(adapterPath, 'src/cli/index.ts');

    // Default bun runtime execution matrix
    const execCommand = ['bun', 'run', cliEntryFile];

    return {
      cwd: workspacePath,
      env: isolatedEnv,
      runtimeArgs, // can be passed to Next/Deno execution commands safely
      executorName,
      execCommand
    };
  }
}
