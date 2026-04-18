import { NextResponse } from 'next/server';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { DATA_DIR } from '@/lib/paths';
import getDb from '@/lib/db';

export async function POST(req) {
  try {
    const { companyId, agentId, roleName, executor, model } = await req.json();

    if (!companyId || !agentId || !roleName) {
      return NextResponse.json({ success: false, error: "Missing required fields." }, { status: 400 });
    }

    const db = getDb();
    const company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(companyId);
    
    if (!company) {
      return NextResponse.json({ success: false, error: "Company not found locally." }, { status: 400 });
    }

    // Fetch keys for the existing agent from Paperclip remote server
    let apiKey = null;
    try {
      const remoteRes = await fetch(`${company.apiUrl}/api/agents/${agentId}/keys`, {
        headers: { "Authorization": `Bearer ${company.boardKey}` }
      });

      if (remoteRes.ok) {
        const keys = await remoteRes.json();
        // Handle various response shapes: { key }, { agentKey }, { data: [...] }, [{ key }], { plaintextKey }, { token }
        if (Array.isArray(keys)) {
          apiKey = keys[0]?.key || keys[0]?.plaintextKey || keys[0]?.token || keys[0]?.agentKey;
        } else if (keys.data && Array.isArray(keys.data)) {
          apiKey = keys.data[0]?.key || keys.data[0]?.plaintextKey || keys.data[0]?.token;
        } else {
          apiKey = keys.agentKey || keys.key || keys.plaintextKey || keys.token;
        }
      }
    } catch (e) {
      console.warn(`[Takeover] Could not fetch agent keys for ${agentId}:`, e.message);
    }

    // Fallback: use the company boardKey which has company-level access
    if (!apiKey) {
      apiKey = company.boardKey;
    }

    // Provision local identity vault file into SQLite
    db.prepare(`
      INSERT OR REPLACE INTO identities 
      (role, agentId, apiUrl, companyId, executor, model, timeoutMs, apiKey, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      roleName,
      agentId,
      company.apiUrl,
      companyId,
      executor || 'claude-local',
      model || null,
      1800000,
      apiKey
    );

    // Make sure workspace sandbox directory exists
    const workspaceDir = path.join(DATA_DIR, 'workspaces', agentId);
    if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });

    return NextResponse.json({ 
      success: true, 
      message: `Successfully adopted agent ${agentId} into local namespace ${roleName}.`,
      role: roleName 
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
