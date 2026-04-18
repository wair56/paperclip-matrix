import { NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('companyId');
    const agentId = searchParams.get('agentId');
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 30), 1), 200);
    const queryLimit = limit + 1;

    const db = getDb();
    
    let query = `
      SELECT
        id,
        runId,
        taskId,
        companyId,
        agentId,
        role,
        receivedAt,
        repliedAt,
        status,
        length(COALESCE(prompt, '')) AS promptLength,
        length(COALESCE(response, '')) AS responseLength,
        substr(COALESCE(prompt, ''), 1, 240) AS promptPreview,
        substr(COALESCE(response, ''), 1, 240) AS responsePreview
      FROM task_runs
      WHERE 1=1
    `;
    const params = [];

    if (companyId) {
      query += ` AND companyId = ?`;
      params.push(companyId);
    }
    if (agentId) {
      query += ` AND agentId = ?`;
      params.push(agentId);
    }

    query += ` ORDER BY receivedAt DESC LIMIT ?`;
    params.push(queryLimit);

    const rows = db.prepare(query).all(...params);
    const hasMore = rows.length > limit;
    const runs = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({ success: true, runs, hasMore });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
