import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import getDb from '@/lib/db';

export async function POST(req) {
  try {
    const { companyId, templateId } = await req.json();

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing required field (Company ID)." }, { status: 400 });
    }

    const db = getDb();
    const company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(companyId);
    
    if (!company) {
      return NextResponse.json({ success: false, error: `Company ${companyId} not found in local vault.` }, { status: 404 });
    }

    const { apiUrl: url, boardKey } = company;

    // Fetch existing agents from the remote server gracefully
    let agents = [];
    try {
      const res = await fetch(`${url}/api/companies/${companyId}/agents`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${boardKey}`, "Content-Type": "application/json" }
      });
      if (res.ok) {
        const result = await res.json();
        agents = Array.isArray(result) ? result : (result.data || []);
      }
    } catch (e) {
      console.error("Failed to fetch remote agents during discover:", e);
    }

    let roleTemplates = [];
    try {
      const db = getDb();
      const rows = db.prepare(`SELECT * FROM templates`).all();
      roleTemplates = rows.map(r => ({
        id: r.id,
        name: r.name,
        roles: JSON.parse(r.rolesJson || '[]')
      }));
    } catch (e) {
      console.error("Failed to load templates from DB:", e);
    }
    
    // Provide template list to the frontend
    const uiTemplates = roleTemplates.map(t => ({ id: t.id, name: t.name }));

    // Extract existing roles
    const existingRoles = agents.map(a => (a.role || '').toLowerCase()).filter(Boolean);

    let neededRoles = [];
    if (templateId) {
      const selectedTpl = roleTemplates.find(t => t.id === templateId);
      if (selectedTpl) {
         // Return FULL role definitions with a hired flag for any role
         neededRoles = selectedTpl.roles.map(r => ({
           ...r,
           hired: existingRoles.includes(r.role.toLowerCase())
         }));
      }
    }

    return NextResponse.json({ 
      success: true, 
      neededRoles,
      availableTemplates: uiTemplates,
      existingAgents: existingRoles,
      agents // return the full agent payload so frontend can do "Takeover"
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

