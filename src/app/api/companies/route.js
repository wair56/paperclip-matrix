import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');

function getCompanies() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(COMPANIES_FILE)) {
    writeFileSync(COMPANIES_FILE, JSON.stringify([]));
    return [];
  }
  try {
    return JSON.parse(readFileSync(COMPANIES_FILE, 'utf8'));
  } catch(e) {
    return [];
  }
}

function saveCompanies(data) {
  writeFileSync(COMPANIES_FILE, JSON.stringify(data, null, 2));
}

export async function GET() {
  try {
    const companies = getCompanies();
    // Do not transmit the boardKey back to the client!
    const secureList = companies.map(c => ({ 
      id: c.id, 
      name: c.name, 
      apiUrl: c.apiUrl 
    }));
    return NextResponse.json({ success: true, companies: secureList });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { apiUrl, boardKey } = await req.json();
    if (!apiUrl || !boardKey) {
      return NextResponse.json({ success: false, error: 'Missing API URL or Board Key' }, { status: 400 });
    }

    let id, name;
    
    // Auto-Discover Company ID via Official GET /api/companies standard
    try {
      const authRes = await fetch(`${apiUrl}/api/companies`, {
        headers: { "Authorization": `Bearer ${boardKey}` }
      });
      if (!authRes.ok) throw new Error(`Remote API returned HTTP ${authRes.status}`);
      
      const payload = await authRes.json();
      
      // Handle either raw array or nested `{ companies: [] }`
      const companyList = Array.isArray(payload) ? payload : (payload.companies || payload.data || []);
      if (!companyList || companyList.length === 0) {
         throw new Error("No companies returned for this token.");
      }
      
      const comp = companyList[0];
      id = comp.id || comp.companyId;
      name = comp.name || comp.companyName || id;
      
    } catch (err) {
      // Degrade gracefully if token doesn't work for global enumeration
      id = "ceo"; // standard fallback based on known structure
      name = "Main Board (ceo)";
      console.warn("Probe failed, applying default fallback:", err.message);
    }

    const companies = getCompanies();
    
    const existingIdx = companies.findIndex(c => c.id === id);
    if (existingIdx >= 0) {
      companies[existingIdx] = { ...companies[existingIdx], name, apiUrl, boardKey };
    } else {
      companies.push({ id, name, apiUrl, boardKey, addedAt: Date.now() });
    }
    
    saveCompanies(companies);
    return NextResponse.json({ success: true, message: `Successfully Linked ${name}` });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
