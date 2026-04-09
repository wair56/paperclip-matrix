import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const IDENTITIES_DIR = path.join(DATA_DIR, 'identities');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');

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
    result.local.identity = existsSync(path.join(IDENTITIES_DIR, `${role}.env`));
    result.local.workspace = existsSync(path.join(WORKSPACES_DIR, role));

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
