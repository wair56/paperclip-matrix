import { NextResponse } from 'next/server';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { DATA_DIR } from '@/lib/paths';
const RETIRED_WORKSPACES_DIR = path.join(DATA_DIR, 'retired_workspaces');

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');

    if (!role) {
      return NextResponse.json({ success: false, error: 'Role parameter is required.' }, { status: 400 });
    }

    if (!existsSync(RETIRED_WORKSPACES_DIR)) {
      return NextResponse.json({ success: false, error: 'No archived workspaces found.' }, { status: 404 });
    }

    const files = readdirSync(RETIRED_WORKSPACES_DIR);
    // Find the latest archive for this role
    const roleArchives = files.filter(f => f.startsWith(`${role}-`) && f.endsWith('.tar.gz'));
    
    if (roleArchives.length === 0) {
      return NextResponse.json({ success: false, error: `No packed archive found for ${role}.` }, { status: 404 });
    }

    // Sort descending by timestamp (timestamp is between role- and .tar.gz)
    roleArchives.sort((a, b) => b.localeCompare(a));
    const targetFile = roleArchives[0];
    const targetPath = path.join(RETIRED_WORKSPACES_DIR, targetFile);

    const fileBuffer = readFileSync(targetPath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${targetFile}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
