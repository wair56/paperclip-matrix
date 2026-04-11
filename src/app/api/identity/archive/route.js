import { NextResponse } from 'next/server';
import { existsSync, unlinkSync, readdirSync } from 'fs';
import path from 'path';
import { DATA_DIR } from '@/lib/paths';
import getDb from '@/lib/db';

const RETIRED_WORKSPACES_DIR = path.join(DATA_DIR, 'retired_workspaces');

export async function DELETE(req) {
  try {
    const { role } = await req.json();

    if (!role) {
      return NextResponse.json({ success: false, error: "Role missing." }, { status: 400 });
    }

    const db = getDb();
    db.prepare(`DELETE FROM identities WHERE role = ?`).run(role);

    // Attempt to delete any associated packed workspaces
    if (existsSync(RETIRED_WORKSPACES_DIR)) {
      const files = readdirSync(RETIRED_WORKSPACES_DIR);
      const roleArchives = files.filter(f => f.startsWith(`${role}-`) && f.endsWith('.tar.gz'));
      roleArchives.forEach(f => {
        try {
          unlinkSync(path.join(RETIRED_WORKSPACES_DIR, f));
        } catch (e) { console.error('Failed to obliterate archive', f) }
      });
    }

    return NextResponse.json({ success: true, message: `Permanently obliterated agent ${role} and its archives.` });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

