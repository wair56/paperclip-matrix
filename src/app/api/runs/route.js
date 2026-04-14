import { NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('companyId');
    const agentId = searchParams.get('agentId');

    const db = getDb();
    
    let query = `SELECT * FROM task_runs WHERE 1=1`;
    const params = [];

    if (companyId) {
      query += ` AND companyId = ?`;
      params.push(companyId);
    }
    if (agentId) {
      query += ` AND agentId = ?`;
      params.push(agentId);
    }

    query += ` ORDER BY receivedAt DESC LIMIT 100`;

    const runs = db.prepare(query).all(...params);

    return NextResponse.json({ success: true, runs });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
