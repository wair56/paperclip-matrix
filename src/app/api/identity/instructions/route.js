import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { DATA_DIR } from '@/lib/paths';
import getDb from '@/lib/db';
import { getExistingWorkspacePathForIdentity, getPrimaryWorkspacePathForIdentity } from '@/lib/workspaces';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');
    
    if (!role) {
      return NextResponse.json({ success: false, error: "Missing role parameter" }, { status: 400 });
    }

    const db = getDb();
    const identity = db.prepare(`SELECT role, agentId FROM identities WHERE role = ?`).get(role) || { role };
    const workspaceDir = getExistingWorkspacePathForIdentity(identity) || getPrimaryWorkspacePathForIdentity(identity);
    const soulPath = path.join(workspaceDir, 'SOUL.md');

    if (!existsSync(soulPath)) {
      // Return a default template if it doesn't exist
      const defaultSoul = `# Identity: ${role}

## Core Responsibilities
- Define responsibilities here.

## Behavioral Guidelines
- Be helpful.
- Be precise.
`;
      return NextResponse.json({ success: true, soul: defaultSoul });
    }

    const content = readFileSync(soulPath, 'utf8');
    return NextResponse.json({ success: true, soul: content });

  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { role, soul } = await req.json();
    
    if (!role || soul === undefined) {
      return NextResponse.json({ success: false, error: "Missing identity attributes" }, { status: 400 });
    }

    const db = getDb();
    const identity = db.prepare(`SELECT * FROM identities WHERE role = ?`).get(role) || { role };
    const workspaceDir = getExistingWorkspacePathForIdentity(identity) || getPrimaryWorkspacePathForIdentity(identity);
    if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });

    const soulPath = path.join(workspaceDir, 'SOUL.md');
    writeFileSync(soulPath, soul, 'utf8');

    // Attempt to Push 'SOUL' to Paperclip Cloud as bootstrapPrompt
    try {
      const identity = db.prepare(`SELECT * FROM identities WHERE role = ? AND status = 'active'`).get(role);
      
      if (identity) {
        const company = db.prepare(`SELECT boardKey FROM companies WHERE id = ?`).get(identity.companyId);

        if (company && company.boardKey && identity.apiUrl && identity.agentId) {
           await fetch(`${identity.apiUrl}/api/agents/${identity.agentId}`, {
             method: 'PATCH',
             headers: { 'Authorization': `Bearer ${company.boardKey}`, 'Content-Type': 'application/json' },
             body: JSON.stringify({ adapterConfig: { bootstrapPrompt: soul } })
           });
        }
      }
    } catch (e) {
      console.error("Cloud Sync Failed for Instructions:", e);
      // Soft fail, local write was successful
    }

    return NextResponse.json({ success: true, message: `Updated SOUL.md and pushed to cloud for ${role}` });

  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
