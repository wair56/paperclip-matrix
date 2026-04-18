import { NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { getRunningProcess } from '@/lib/runRegistry';

export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing run id' }, { status: 400 });
    }

    const db = getDb();
    const run = db.prepare(`
      SELECT
        id,
        runId,
        taskId,
        companyId,
        agentId,
        role,
        prompt,
        response,
        receivedAt,
        repliedAt,
        status
      FROM task_runs
      WHERE id = ?
    `).get(id);

    if (!run) {
      return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, run });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing run id' }, { status: 400 });
    }

    const db = getDb();
    const run = db.prepare(`
      SELECT
        id,
        runId,
        status
      FROM task_runs
      WHERE id = ?
    `).get(id);

    if (!run) {
      return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
    }

    if (run.status !== 'running') {
      return NextResponse.json({ success: false, error: `Run is not running (status: ${run.status})` }, { status: 409 });
    }

    const active = getRunningProcess(run.runId);
    if (!active) {
      db.prepare(`UPDATE task_runs SET status = 'interrupted', repliedAt = ? WHERE id = ?`).run(Date.now(), id);
      return NextResponse.json({ success: true, message: 'Run state was stale; marked interrupted locally.' });
    }

    const accepted = active.requestKill?.('Killed by operator from task history');
    if (!accepted) {
      return NextResponse.json({ success: false, error: 'Run was already stopping.' }, { status: 409 });
    }

    db.prepare(`UPDATE task_runs SET status = 'interrupted' WHERE id = ?`).run(id);
    return NextResponse.json({ success: true, message: 'Kill signal sent.' });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
