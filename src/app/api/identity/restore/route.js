import { NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function POST(req) {
  try {
    const { role } = await req.json();
    if (!role) return NextResponse.json({ success: false, error: "Role missing." }, { status: 400 });

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM identities WHERE role = ?`).get(role);

    if (!existing) {
      return NextResponse.json({ success: false, error: `Agent ${role} is not found.` }, { status: 404 });
    }

    if (existing.status === 'active') {
      return NextResponse.json({ success: false, error: `Agent ${role} is already active.` }, { status: 409 });
    }

    // Move back to active duty
    db.prepare(`UPDATE identities SET status = 'active' WHERE role = ?`).run(role);

    return NextResponse.json({ success: true, message: `Node ${role} successfully restored to Active Duty.` });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

