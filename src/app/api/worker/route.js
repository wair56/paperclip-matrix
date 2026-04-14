import { NextResponse } from 'next/server';
import { SandboxManager } from '@/lib/SandboxManager';
import { getNodeSettings } from '@/lib/nodeSettings';
import getDb from '@/lib/db';
import { appendFileSync } from 'fs';
import path from 'path';
import { LOGS_DIR } from '@/lib/paths';

// Use globalThis to persist across HMR in development
if (!globalThis.__matrixActiveWorkers) {
  globalThis.__matrixActiveWorkers = new Map();
}
const activeWorkers = globalThis.__matrixActiveWorkers;

export async function POST(req) {
  try {
    const { role } = await req.json();

    if (!role) {
      return NextResponse.json({ success: false, error: 'Role is required to start a worker.' }, { status: 400 });
    }

    if (activeWorkers.has(role)) {
      return NextResponse.json({ success: false, error: `Worker ${role} is already running.` }, { status: 409 });
    }

    // 0. Securely pull latest Identity keys/variables from the Cloud before Sandboxing
    const db = getDb();
    const identity = db.prepare(`SELECT name, agentId, apiUrl, companyId, envJson FROM identities WHERE role = ? AND status = 'active'`).get(role);
    if (identity && identity.agentId && identity.companyId) {
      const company = db.prepare(`SELECT boardKey FROM companies WHERE id = ?`).get(identity.companyId);
      if (company && company.boardKey) {
        try {
          const fetchRes = await fetch(`${identity.apiUrl}/api/agents/${identity.agentId}`, {
            headers: { "Authorization": `Bearer ${company.boardKey}` }
          });
          if (fetchRes.ok) {
            const data = await fetchRes.json();
            const cloudAgent = data.data || data.agent || data;
            if (cloudAgent) {
              const envPayload = (cloudAgent.runtimeConfig && Object.keys(cloudAgent.runtimeConfig).length > 0)
                ? JSON.stringify(cloudAgent.runtimeConfig)
                : identity.envJson || null;
              db.prepare(`UPDATE identities SET envJson = ?, name = ? WHERE role = ?`)
                .run(envPayload, cloudAgent.name || identity.name, role);
              console.log(`[Matrix-Orchestrator] Pulled latest secure API keys & name for agent ${role} from Cloud.`);
            }
          }
        } catch (e) {
          console.warn(`[Matrix-Orchestrator] Failed to pull latest secure keys from cloud during ignite: ${e.message}`);
        }
      }
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
    console.log(`[Matrix-Orchestrator] MAPPED CLI: ${payload.resolvedBinary}`);
    // Auto-Heal: Ensure the remote Agent natively maps to its core adapter module.
    // e.g. "claude-local" -> "claude_local"
    if (payload.env.PAPERCLIP_API_URL && payload.env.PAPERCLIP_AGENT_ID && payload.env.PAPERCLIP_API_KEY) {
      let mappedAdapterType = (payload.executorName || "claude_local").replace(/-/g, '_');
      const adapterConfig = {};
      
      const nodeSettings = getNodeSettings();
      // Ensure the remote agent targets THIS MATRIX as a Webhook Node
      if (nodeSettings.frp?.serverAddr && nodeSettings.frp?.remotePort) {
         mappedAdapterType = "http";
         adapterConfig.url = `http://${nodeSettings.frp.serverAddr}:${nodeSettings.frp.remotePort}/api/webhook/paperclip`;
      }

      if (payload.env.RUNNER_MODEL) {
        adapterConfig.model = payload.env.RUNNER_MODEL;
      }
      
      const patchPayload = { adapterType: mappedAdapterType };
      if (Object.keys(adapterConfig).length > 0) {
        patchPayload.adapterConfig = adapterConfig;
      }
      
      try {
        const patchRes = await fetch(`${payload.env.PAPERCLIP_API_URL}/api/agents/${payload.env.PAPERCLIP_AGENT_ID}`, {
          method: "PATCH",
          headers: { 
            "Authorization": `Bearer ${payload.env.PAPERCLIP_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(patchPayload)
        });
        if (!patchRes.ok) {
          const errText = await patchRes.text();
          console.error(`[Matrix-Orchestrator] Cloud sync failed [${patchRes.status}]:`, errText);
          return NextResponse.json({ success: false, error: `Cloud sync rejected the adapter update: ${patchRes.status} - ${errText}` }, { status: 502 });
        }
      } catch (err) {
        console.error(`[Matrix-Orchestrator] Auto-heal sync network error for ${role}:`, err);
        return NextResponse.json({ success: false, error: `Could not reach ${payload.env.PAPERCLIP_API_URL} to ignite agent: ${err.message}` }, { status: 502 });
      }
    }

    // Open log file stream to capture output
    const logPath = path.join(LOGS_DIR, `${role}.log`);
    appendFileSync(logPath, `\n[Matrix] Node ${role} is IGNITED. Listening for HTTP Webhooks...\n`);

    // In Webhook Native Mode, we don't spawn a detached CLI process.
    // Instead we register a Virtual PID to tell the UI that this node is "Running" and ready.
    const virtualPid = Date.now();
    activeWorkers.set(role, virtualPid);

    return NextResponse.json({ 
      success: true, 
      message: `Worker [${role}] fully Sandboxed and Ignited! Waiting for Webhooks.`, 
      pid: virtualPid 
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
    
    // Virtual PID (Date.now()) is not a real process — just remove from tracking map.
    // Do NOT call process.kill() on it.
    activeWorkers.delete(role);

    return NextResponse.json({ success: true, message: `Terminated Worker [${role}]` });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
