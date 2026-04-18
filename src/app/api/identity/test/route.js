import { NextResponse } from 'next/server';
import { SandboxManager } from '@/lib/SandboxManager';
import { spawnSync } from 'child_process';
import { getExecutorFamily } from '@/lib/executors';
import { buildIdentityTestInvocation } from '@/lib/cliInvocation';

const TEST_PROMPT = 'Hello! What model are you? Please reply in 1 sentence.';
const TIMEOUT_MS = 30000;

export async function POST(request) {
  try {
    const { role } = await request.json();
    if (!role) {
      return NextResponse.json({ success: false, error: 'Missing role' }, { status: 400 });
    }

    // 1. Get sandbox payload (env, cwd, resolvedBinary, executorName)
    const sandbox = SandboxManager.getExecutionPayload(role);
    const baseCmd = getExecutorFamily(sandbox.executorName);
    const modelArg = sandbox.env.RUNNER_MODEL && sandbox.env.RUNNER_MODEL !== 'auto'
      ? sandbox.env.RUNNER_MODEL
      : null;

    // 2. Build the command based on executor type.
    //    We pipe the prompt via stdin for maximum compatibility.
    const { args } = buildIdentityTestInvocation({
      family: baseCmd,
      prompt: TEST_PROMPT,
      modelArg,
    });

    console.log(`[Test-Agent] ${sandbox.resolvedBinary} ${args.join(' ')} (role: ${role})`);

    // 3. Execute synchronously with prompt piped to stdin
    const result = spawnSync(sandbox.resolvedBinary, args, {
      cwd: sandbox.cwd,
      env: sandbox.env,
      input: TEST_PROMPT,
      timeout: TIMEOUT_MS,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });

    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();

    if (result.error) {
      console.error(`[Test-Agent] spawnSync error:`, result.error);
      return NextResponse.json({ 
        success: false, 
        error: result.error.message,
        stderr: stderr.substring(0, 500)
      });
    }

    if (!stdout && (result.status ?? 1) !== 0) {
      return NextResponse.json({ 
        success: false,
        error: `Agent exited with code ${result.status}`,
        stderr: stderr.substring(0, 500)
      });
    }

    // Extract the last meaningful line from stdout as the response
    const lines = stdout.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('>') && !l.startsWith('◆'));
    const response = lines.length > 0 ? lines[lines.length - 1] : stdout.substring(0, 200);

    return NextResponse.json({ 
      success: true, 
      response: response.substring(0, 300),
      executor: sandbox.executorName,
      model: sandbox.env.RUNNER_MODEL || null,
    });

  } catch (error) {
    console.error('[Test-Agent] Fatal:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
