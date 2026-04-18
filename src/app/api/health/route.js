import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import getDb from '@/lib/db';
import { getExistingWorkspacePathForIdentity } from '@/lib/workspaces';

export async function POST(req) {
  try {
    const { role, apiUrl, apiKey } = await req.json();

    if (!role) {
      return NextResponse.json({ success: false, error: 'Role is required.' }, { status: 400 });
    }

    const result = {
      role,
      local: { identity: false, workspace: false },
      remote: { reachable: false, latencyMs: null, error: null }
    };

    // 1. Local checks
    const db = getDb();
    const identity = db.prepare(`SELECT agentId FROM identities WHERE role = ? AND status = 'active'`).get(role);
    
    result.local.identity = !!identity;
    if (identity && identity.agentId) {
      result.local.workspace = !!getExistingWorkspacePathForIdentity(identity);
    } else {
      result.local.workspace = false;
    }

    // 2. Remote check — ping the API server
    if (apiUrl) {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`${apiUrl}/api/health`, {
          method: 'GET',
          headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
          signal: controller.signal,
        });
        clearTimeout(timeout);

        result.remote.latencyMs = Date.now() - start;
        result.remote.reachable = res.ok || res.status === 401 || res.status === 404;
        // 401/404 still means the server is alive, just auth or route issue
      } catch (err) {
        result.remote.latencyMs = Date.now() - start;
        result.remote.reachable = false;
        result.remote.error = err.name === 'AbortError' ? 'Timeout (5s)' : err.message;
      }
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
