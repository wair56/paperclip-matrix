import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');

export async function POST(req) {
  try {
    const { companyId } = await req.json();

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing required field (Company ID)." }, { status: 400 });
    }

    if (!existsSync(COMPANIES_FILE)) {
      return NextResponse.json({ success: false, error: "No companies vault found. Please configure a company first." }, { status: 400 });
    }
    
    const companies = JSON.parse(readFileSync(COMPANIES_FILE, 'utf8'));
    const company = companies.find(c => c.id === companyId);
    if (!company) {
      return NextResponse.json({ success: false, error: `Company ${companyId} not found in local vault.` }, { status: 404 });
    }

    const { apiUrl: url, boardKey } = company;

    // Fetch existing agents from the remote server
    const res = await fetch(`${url}/api/companies/${companyId}/agents`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${boardKey}`, "Content-Type": "application/json" }
    });

    if (!res.ok) throw new Error(`Remote API returned HTTP ${res.status}`);
    const result = await res.json();
    
    // Sometimes APIs return an array directly, sometimes inside a 'data' wrapper
    const agents = Array.isArray(result) ? result : (result.data || []);

    // Define standard roles a typical matrix node might need
    const standardRoles = ['ceo', 'cto', 'pm', 'developer', 'qa', 'designer', 'ops'];
    
    // Extract existing roles
    const existingRoles = agents.map(a => (a.role || '').toLowerCase()).filter(Boolean);

    // Find what hasn't been hired yet
    const neededRoles = standardRoles.filter(r => !existingRoles.includes(r));

    return NextResponse.json({ 
      success: true, 
      neededRoles: neededRoles.length > 0 ? neededRoles : standardRoles, // fallback to all if couldn't determine
      existingAgents: existingRoles
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
