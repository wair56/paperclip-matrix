import { NextResponse } from 'next/server';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import { getNodeSettings } from '@/lib/nodeSettings';
import { DATA_DIR } from '@/lib/paths';
import getDb from '@/lib/db';

const isValidRoleName = (name) => /^[a-zA-Z0-9_-]+$/.test(name);

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM identities`).all();
    
    const mapRow = (row) => ({
      filename: `${row.role}.conf`, // backward compatibility
      role: row.role,
      agentId: row.agentId || '',
      apiUrl: row.apiUrl || '',
      companyId: row.companyId || '',
      executor: row.executor || 'claude',
      model: row.model || '',
      timeoutMs: row.timeoutMs || 1800000,
    });

    const identities = rows.filter(r => r.status === 'active' && !r.role.startsWith('_')).map(mapRow);
    const retiredIdentities = rows.filter(r => r.status === 'retired' && !r.role.startsWith('_')).map(mapRow);

    return NextResponse.json({ 
      success: true, 
      identities,
      retiredIdentities
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { companyId, roleName, executor, model, initialSoul } = body;

    if (!companyId || !roleName) {
      return NextResponse.json({ success: false, error: "Missing required fields (companyId, roleName) for Auto-Join." }, { status: 400 });
    }

    if (!isValidRoleName(roleName)) {
      return NextResponse.json({ success: false, error: "Invalid role name. Only alphanumeric, hyphens, and underscores allowed." }, { status: 400 });
    }

    const db = getDb();
    const company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(companyId);
    
    if (!company) {
      return NextResponse.json({ success: false, error: `Company ${companyId} not found in local vault.` }, { status: 404 });
    }

    const { apiUrl: url, boardKey } = company;

    const nodeSettings = getNodeSettings();
    const envOverrides = {};
    if (nodeSettings.proxy?.httpsProxy) {
      envOverrides.HTTPS_PROXY = nodeSettings.proxy.httpsProxy;
      envOverrides.HTTP_PROXY = nodeSettings.proxy.httpsProxy;
      envOverrides.ALL_PROXY = nodeSettings.proxy.httpsProxy;
    }
    if (nodeSettings.proxy?.openaiBaseUrl) {
      envOverrides.OPENAI_BASE_URL = nodeSettings.proxy.openaiBaseUrl;
    }

    const adapterConfig = model ? { model } : {};
    if (initialSoul) adapterConfig.bootstrapPrompt = initialSoul;
    if (Object.keys(envOverrides).length > 0) {
      adapterConfig.env = envOverrides;
    }
    
    let remoteAdapterType = (executor || "claude_local").replace(/-/g, '_');
    if (nodeSettings.frp?.serverAddr && nodeSettings.frp?.remotePort) {
       remoteAdapterType = "http";
       adapterConfig.url = `http://${nodeSettings.frp.serverAddr}:${nodeSettings.frp.remotePort}/api/webhook/paperclip`;
    }

    // Edge case: OpenCode strictly requires a provider/model formatted string in adapterConfig
    if (remoteAdapterType === "opencode_local" && !adapterConfig.model) {
      adapterConfig.model = "openai/gpt-5.4";
    } else if (remoteAdapterType === "opencode_local" && !adapterConfig.model.includes('/')) {
      adapterConfig.model = `openai/${adapterConfig.model}`;
    }

    const createRes = await fetch(`${url}/api/companies/${companyId}/agents`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${boardKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Matrix Node ${roleName} (${os.hostname()})`,
        role: roleName,
        adapterType: remoteAdapterType,
        adapterConfig
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Agent create rejected HTTP ${createRes.status}: ${errText}`);
    }
    const agent = await createRes.json();

    const keyRes = await fetch(`${url}/api/agents/${agent.id}/keys`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${boardKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "matrix-auto-key" })
    });

    if (!keyRes.ok) {
      const errText = await keyRes.text();
      throw new Error(`Key creation rejected HTTP ${keyRes.status}: ${errText}`);
    }
    const keyData = await keyRes.json();
    const apiKey = keyData.key || keyData.apiKey || keyData.plaintextKey || keyData.token;

    const timeoutMs = 1800000;
    
    // Write locally to SQLite identities vault
    db.prepare(`
      INSERT OR REPLACE INTO identities 
      (role, agentId, apiUrl, companyId, executor, model, timeoutMs, apiKey, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      roleName,
      agent.id,
      url,
      companyId,
      executor || 'claude',
      model || null,
      timeoutMs,
      apiKey
    );

    // Auto-create sandbox workspace directory for this agent
    const workspaceDir = path.join(DATA_DIR, 'workspaces', agent.id);
    if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });
    
    if (initialSoul) {
      const { writeFileSync } = require('fs');
      writeFileSync(path.join(workspaceDir, 'SOUL.md'), initialSoul, 'utf8');
    }

    return NextResponse.json({ success: true, agentId: agent.id, role: roleName });

  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const { role, executor, model } = await req.json();
    if (!role || !isValidRoleName(role)) {
      return NextResponse.json({ success: false, error: "Role is required and must be valid." }, { status: 400 });
    }

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM identities WHERE role = ?`).get(role);
    
    if (!existing) {
      return NextResponse.json({ success: false, error: `Identity ${role} not found.` }, { status: 404 });
    }

    db.prepare(`UPDATE identities SET executor = COALESCE(?, executor), model = COALESCE(?, model) WHERE role = ?`).run(
      executor || null, 
      model || null, 
      role
    );

    return NextResponse.json({ success: true, message: `Updated ${role}` });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { role } = await req.json();
    if (!role || !isValidRoleName(role)) return NextResponse.json({ success: false, error: "Role missing or invalid." }, { status: 400 });

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM identities WHERE role = ? AND status = 'active'`).get(role);
    
    if (!existing) {
      return NextResponse.json({ success: false, error: `Agent ${role} is not an active node.` }, { status: 404 });
    }

    // Set DB status to retired
    db.prepare(`UPDATE identities SET status = 'retired' WHERE role = ?`).run(role);

    // Sync deletion to Paperclip Cloud
    if (existing.companyId && existing.agentId) {
      const company = db.prepare(`SELECT boardKey FROM companies WHERE id = ?`).get(existing.companyId);
      if (company && company.boardKey) {
        try {
          fetch(`${existing.apiUrl}/api/agents/${existing.agentId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${company.boardKey}` }
          }).catch(e => console.error(`[Matrix-API] Failed to report node obliteration to Cloud:`, e));
        } catch (e) {}
      }
    }

    // Pack Workspace Directory using its unique agentId
    const workspaceDir = path.join(DATA_DIR, 'workspaces', existing.agentId);
    const retiredWorkspacesDir = path.join(DATA_DIR, 'retired_workspaces');
    if (!existsSync(retiredWorkspacesDir)) mkdirSync(retiredWorkspacesDir, { recursive: true });

    if (existsSync(workspaceDir)) {
      try {
        const timestamp = Date.now();
        const tarPath = path.join(retiredWorkspacesDir, `${role}-${timestamp}.tar.gz`);
        spawnSync('tar', ['-czf', tarPath, '-C', path.join(DATA_DIR, 'workspaces'), existing.agentId], { stdio: 'inherit' });
        rmSync(workspaceDir, { recursive: true, force: true });
      } catch (e) {
        console.error(`Failed to pack workspace for ${role}:`, e);
      }
    }

    return NextResponse.json({ success: true, message: `Node ${role} successfully retired and archived.` });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
