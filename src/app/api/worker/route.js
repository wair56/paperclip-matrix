import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { SandboxManager } from '@/lib/SandboxManager';

// Temporary memory store for running processes (in production, use PM2 or Redis)
const activeWorkers = new Map();

export async function POST(req) {
  try {
    const { role } = await req.json();

    if (!role) {
      return NextResponse.json({ success: false, error: 'Role is required to start a worker.' }, { status: 400 });
    }

    if (activeWorkers.has(role)) {
      return NextResponse.json({ success: false, error: `Worker ${role} is already running.` }, { status: 409 });
    }

    // 1. Obtain the securely isolated Sandbox Payload
    const payload = SandboxManager.getExecutionPayload(role);

    // 2. Map Antidetect Browser Endpoint dynamically if configured in their Env.
    // In a real scenario, this is where we'd fetch (`http://local.adspower.net:50325/start...`)
    // and append `process.env.BROWSER_WS_ENDPOINT` into `payload.env`.
    
    // For now, let's inject a dummy flag to simulate the Antidetect connection
    payload.env.BROWSER_INJECTED = "true";

    console.log(`[Matrix-Orchestrator] IGNITING AGENT: ${role}`);
    console.log(`[Matrix-Orchestrator] ADAPTER: ${payload.executorName}`);
    console.log(`[Matrix-Orchestrator] MAPPED CLI: ${payload.execCommand.join(' ')}`);
    console.log(`[Matrix-Orchestrator] ANCHORED CWD: ${payload.cwd}`);
    
    // 3. Spawn the true Model Orchestration Adapter CLI natively via CWD routing
    // e.g. `bun run /Users/.../adapters/claude-local/src/cli/index.ts`
    const child = spawn(payload.execCommand[0], payload.execCommand.slice(1), {
      cwd: payload.cwd,
      env: payload.env,
      detached: true,
      stdio: 'ignore' // In production you should capture IPC or log pipes to `.data/logs`
    });

    child.unref(); // Allow the dashboard to continue without hanging on this process

    activeWorkers.set(role, child.pid);

    return NextResponse.json({ 
      success: true, 
      message: `Worker [${role}] fully Sandboxed and Ignited!`, 
      pid: child.pid 
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { role } = await req.json();
    if (!activeWorkers.has(role)) {
      return NextResponse.json({ success: false, error: `Worker ${role} is not seemingly active in this session.` }, { status: 404 });
    }
    
    const pid = activeWorkers.get(role);
    process.kill(pid); // Kill it.
    activeWorkers.delete(role);

    return NextResponse.json({ success: true, message: `Terminated Worker [${role}]` });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
