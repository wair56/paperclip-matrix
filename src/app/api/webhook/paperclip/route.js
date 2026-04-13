import { NextResponse } from 'next/server';
import { existsSync, createWriteStream } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { getNodeSettings } from '@/lib/nodeSettings';
import { LOGS_DIR } from '@/lib/paths';
import { SandboxManager } from '@/lib/SandboxManager';
import getDb from '@/lib/db';

/**
 * Spawn a CLI process and capture its full stdout/stderr.
 * Returns a promise that resolves with { exitCode, stdout, stderr }.
 */
function runProcess(command, args, options) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.onLog) options.onLog('stdout', text);
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.onLog) options.onLog('stderr', text);
    });

    if (options.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    }

    proc.on('close', (code, signal) => {
      resolve({ exitCode: code, signal, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ exitCode: -1, signal: null, stdout, stderr: stderr + '\n' + err.message });
    });
  });
}

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

export async function POST(req) {
  let logStream;
  try {
    // Lightweight auth: if MATRIX_WEBHOOK_SECRET env var is set, require matching header
    const webhookSecret = process.env.MATRIX_WEBHOOK_SECRET;
    if (webhookSecret) {
      const provided = req.headers.get('x-matrix-secret');
      if (provided !== webhookSecret) {
        return NextResponse.json({ errorMessage: 'Unauthorized' }, { status: 401 });
      }
    }

    // Body size check
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_SIZE) {
      return NextResponse.json({ errorMessage: 'Request body too large' }, { status: 413 });
    }

    const body = JSON.parse(rawBody);
    const { runId, agentId, companyId, context } = body;
    console.log(`[Matrix-Webhook] Incoming run payload for Agent ${agentId} (Run: ${runId})`);
    
    // Dump the payload for debugging keys
    require('fs').appendFileSync(
      path.join(LOGS_DIR, 'webhook-debug.log'), 
      `\n[${new Date().toISOString()}] PAYLOAD:\n${JSON.stringify(body, null, 2)}\n`
    );

    // 1. Locate the correct local identity mapping
    const db = getDb();
    const identity = db.prepare(`SELECT role, envJson FROM identities WHERE agentId = ? AND status = 'active'`).get(agentId);

    if (!identity) {
      console.error(`[Matrix-Webhook] Agent ${agentId} not found in local vault.`);
      return NextResponse.json({ errorMessage: 'Agent not found in Matrix Vault' }, { status: 404 });
    }

    const roleName = identity.role;
    let envVars = {};
    try {
      envVars = JSON.parse(identity.envJson || '{}');
    } catch(e) {}

    // 2. Use SandboxManager for isolated execution environment
    //    This sets HOME to the workspace dir, cleans env vars, and resolves the CLI binary.
    const sandbox = SandboxManager.getExecutionPayload(roleName, envVars);
    console.log(`[Matrix-Webhook] Role: ${roleName} | Executor: ${sandbox.executorName} | Command: ${sandbox.resolvedBinary} | Sandbox HOME: ${sandbox.cwd}`);

    // 3. Overlay sandbox env with webhook-specific settings
    const runEnv = {
      ...sandbox.env,
      PAPERCLIP_RUN_ID: runId,
    };

    // Inject proxy settings from global node config
    const nodeSettings = getNodeSettings();
    if (nodeSettings.proxy?.httpsProxy) {
      runEnv.HTTPS_PROXY = nodeSettings.proxy.httpsProxy;
      runEnv.HTTP_PROXY = nodeSettings.proxy.httpsProxy;
      runEnv.ALL_PROXY = nodeSettings.proxy.httpsProxy;
    }
    if (nodeSettings.proxy?.openaiBaseUrl) {
      runEnv.OPENAI_BASE_URL = nodeSettings.proxy.openaiBaseUrl;
    }

    // 4. Build CLI args
    const systemPrompt = body.instructions || body.systemPrompt || '';
    const taskContext = typeof context === 'string' ? context : JSON.stringify(context || '');
    
    let prompt = `You are agent ${agentId} (${roleName}). Continue your Paperclip work.\n`;
    if (systemPrompt) {
      prompt += `\n[YOUR IDENTITY & INSTRUCTIONS]\n${systemPrompt}\n\n`;
    }
    if (taskContext && taskContext !== '""') {
      prompt += `[CURRENT TASK CONTEXT]\n${taskContext}\n`;
    }
    let args = [];

    const baseCmd = sandbox.executorName.split('-')[0];
    const skipPermissions = envVars.RUNNER_SKIP_PERMISSIONS !== 'false';
    const modelArg = (envVars.RUNNER_MODEL && envVars.RUNNER_MODEL !== 'auto') ? envVars.RUNNER_MODEL : null;

    if (baseCmd === 'claude') {
      args = ['--print', '-', '--output-format', 'json', '--verbose'];
      if (skipPermissions) args.push('--dangerously-skip-permissions');
      if (modelArg) args.push('--model', modelArg);
    } else if (baseCmd === 'codex') {
      args = ['exec', '-', '--json'];
      if (skipPermissions) args.push('--dangerously-bypass-approvals-and-sandbox');
      if (modelArg) args.push('--model', modelArg);
    } else if (baseCmd === 'gemini') {
      args = ['-p', '-', '-o', 'stream-json'];
      if (skipPermissions) args.push('-y');
      if (modelArg) args.push('--model', modelArg);
    } else if (baseCmd === 'opencode') {
      args = ['run', prompt, '--format', 'json'];
      if (skipPermissions) args.push('--dangerously-skip-permissions');
      if (modelArg) args.push('--model', modelArg);
    } else if (baseCmd === 'openclaw') {
      args = ['agent', '--message', prompt, '--json'];
      // Model/Skip permissions are ignored logically or managed in conf
    } else if (baseCmd === 'hermes') {
      args = ['chat', '--quiet', '--yolo', '-q', prompt];
      if (modelArg) args.push('--model', modelArg);
    } else {
      // For any generic runners, pass standard model args
      if (modelArg) args.push('--model', modelArg);
    }

    // 5. Async logging via WriteStream
    const logFile = path.join(LOGS_DIR, `${roleName}.log`);
    logStream = createWriteStream(logFile, { flags: 'a' });

    const logToFile = (streamType, chunk) => {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${streamType.toUpperCase()}] `;
      const formatted = chunk.split('\n').map(line => prefix + line).join('\n') + '\n';
      logStream.write(formatted);
      if (process.env.DEBUG) console.log(`[Matrix-Webhook] ${streamType}: ${chunk.length} bytes`);
    };

    logToFile('stdout', `[Matrix-Webhook] Dispatching: ${sandbox.resolvedBinary} ${args.join(' ')}\n`);

    // 6. Execute in sandbox explicitly via Spawn to capture stream descriptors natively
    const proc = spawn(sandbox.resolvedBinary, args, {
      cwd: sandbox.cwd,
      env: runEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (prompt) {
      proc.stdin.write(prompt);
      proc.stdin.end();
    }

    // 7. Establish high-bandwidth HTTP reverse pipeline directly returning to the Cloud Webhook initiator
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        proc.stdout.on('data', (chunk) => {
          logToFile('stdout', chunk.toString());
          // Directly pass real-time JSONL payload native formats (tool calls, reasoning, etc) up to cloud
          controller.enqueue(chunk); 
        });

        proc.stderr.on('data', (chunk) => {
          const errText = chunk.toString();
          logToFile('stderr', errText);
          // Standardize non-fatal adapter stderr warnings into wrapped JSONL objects to maintain JSONL shape
          const errPayload = { type: 'error', message: errText.trim() };
          controller.enqueue(encoder.encode(JSON.stringify(errPayload) + '\n'));
        });

        proc.on('close', (code, signal) => {
          logToFile('stdout', `\n[Matrix-Webhook] Completed with exit code ${code}\n`);
          if (code !== 0) {
            const finalPayload = { type: 'error', message: `Process exited with code ${code}` };
            controller.enqueue(encoder.encode(JSON.stringify(finalPayload) + '\n'));
          }
          controller.close();
          logStream?.end();
        });

        proc.on('error', (err) => {
          logToFile('stderr', err.message);
          const errPayload = { type: 'error', message: `Matrix OS Executor failure: ${err.message}` };
          controller.enqueue(encoder.encode(JSON.stringify(errPayload) + '\n'));
          controller.close();
          logStream?.end();
        });
      }
    });

    // Send the stream back through the proxy tunnel as active streaming data, 
    // eliminating 30/60s proxy timeouts by instantly acknowledging with headers.
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });

  } catch (err) {
    if (logStream) logStream.end();
    console.error(`[Matrix-Webhook] Unhandled Failure:`, err);
    return NextResponse.json({
      type: 'error',
      message: `Matrix Execution Failure: ${err.message}`
    }, { status: 500 });
  }
}

