import { NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const db = getDb();
    const company = db.prepare(`SELECT apiUrl, boardKey FROM companies WHERE id = ?`).get(id);

    if (!company) {
      return NextResponse.json({ success: false, error: 'Company not found locally' }, { status: 404 });
    }

    const { apiUrl, boardKey } = company;
    
    // Proxy request securely to remote Paperclip Server
    const remoteRes = await fetch(`${apiUrl}/api/companies/${id}/live-runs`, {
      headers: { 
        "Authorization": `Bearer ${boardKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!remoteRes.ok) {
      throw new Error(`Remote API error: ${remoteRes.status}`);
    }

    const data = await remoteRes.json();
    
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

