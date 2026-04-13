import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import os from 'os';

const HOME = os.homedir();

/**
 * Install commands per adapter.
 * Each entry has: cmd (the shell command), type ('npm'|'pip'|'manual')
 */
const INSTALL_COMMANDS = {
  'claude-local': {
    cmd: 'npm install -g @anthropic-ai/claude-code',
    type: 'npm',
  },
  'codex-local': {
    cmd: 'npm install -g @openai/codex',
    type: 'npm',
  },
  'gemini-local': {
    cmd: 'npm install -g @anthropic-ai/gemini-cli',
    type: 'npm',
  },
  'opencode-local': {
    cmd: 'npm install -g opencode',
    type: 'npm',
  },
  'pi-local': {
    cmd: 'npm install -g @anthropic-ai/pi',
    type: 'npm',
  },
  'hermes-local': {
    cmd: 'pip3 install hermes-agent',
    type: 'pip',
  },
  'cursor-local': {
    cmd: null,  // Manual install only
    type: 'manual',
  },
  'openclaw-gateway': {
    cmd: null,  // No CLI to install
    type: 'none',
  },
};

function getExtendedPath() {
  return `${HOME}/.local/bin:${HOME}/.bun/bin:${HOME}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const adapterName = body.adapter;

    if (!adapterName || !INSTALL_COMMANDS[adapterName]) {
      return NextResponse.json({
        success: false,
        error: `Unknown adapter: ${adapterName}`,
      }, { status: 400 });
    }

    const entry = INSTALL_COMMANDS[adapterName];

    if (!entry.cmd) {
      return NextResponse.json({
        success: false,
        error: entry.type === 'manual'
          ? 'This adapter requires manual installation (see docs link)'
          : 'This adapter has no CLI to install',
      }, { status: 400 });
    }

    // Run the install command
    const output = await new Promise((resolve, reject) => {
      const parts = entry.cmd.split(' ');
      const proc = spawn(parts[0], parts.slice(1), {
        env: { ...process.env, PATH: getExtendedPath() },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,  // 2 minute max
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', (code) => {
        resolve({ code, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) });
      });
      proc.on('error', (err) => {
        reject(err);
      });
    });

    if (output.code === 0) {
      return NextResponse.json({
        success: true,
        adapter: adapterName,
        command: entry.cmd,
        output: output.stdout || output.stderr,
        message: `${adapterName} installed successfully`,
      });
    } else {
      return NextResponse.json({
        success: false,
        adapter: adapterName,
        command: entry.cmd,
        exitCode: output.code,
        output: output.stderr || output.stdout,
        error: `Install exited with code ${output.code}`,
      });
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
