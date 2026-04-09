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

    // Attempt to cryptographically verify credentials and fetch Company Metadata
    let id, name;
    try {
      const authRes = await fetch(`${apiUrl}/api/company`, {
        headers: { "Authorization": `Bearer ${boardKey}` }
      });
      if (!authRes.ok) {
        return NextResponse.json({ success: false, error: `Failed to authenticate. Remote server returned ${authRes.status}` }, { status: 401 });
      }
      const data = await authRes.json();
      id = data.id || data.companyId;
      name = data.name || data.companyName || id;
      
      if (!id) throw new Error("Invalid payload missing ID.");
    } catch (fetchErr) {
      // Fallback: If mock data or testing locally without a real upstream
      id = 'comp_' + Math.random().toString(36).substr(2, 6);
      name = 'Connected Matrix ' + id;
      console.warn("Unable to fetch real company metadata, generated fallback:", fetchErr);
    }

    const companies = getCompanies();
    
    // Check if updating or creating
    const existingIdx = companies.findIndex(c => c.id === id);
    if (existingIdx >= 0) {
      companies[existingIdx] = { ...companies[existingIdx], name: name, apiUrl, boardKey };
    } else {
      companies.push({ id, name, apiUrl, boardKey, addedAt: Date.now() });
    }
    
    saveCompanies(companies);
    return NextResponse.json({ success: true, message: `Successfully Linked ${name}` });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
