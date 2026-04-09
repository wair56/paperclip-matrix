import { NextResponse } from 'next/server';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, '.data');
const IDENTITIES_DIR = path.join(DATA_DIR, 'identities');
const RETIRED_DIR = path.join(DATA_DIR, 'retired_identities');

if (!existsSync(IDENTITIES_DIR)) mkdirSync(IDENTITIES_DIR, { recursive: true });

export async function POST(req) {
  try {
    const { role } = await req.json();
    if (!role) return NextResponse.json({ success: false, error: "Role missing." }, { status: 400 });

    const activeFile = path.join(IDENTITIES_DIR, `${role}.env`);
    const retiredFile = path.join(RETIRED_DIR, `${role}.env`);

    if (!existsSync(retiredFile)) {
      return NextResponse.json({ success: false, error: `Agent ${role} is not found in the recycling bin.` }, { status: 404 });
    }

    if (existsSync(activeFile)) {
      return NextResponse.json({ success: false, error: `Agent ${role} is already active.` }, { status: 409 });
    }

    // Physical File Move back to active duty
    const fileData = readFileSync(retiredFile, 'utf8');
    writeFileSync(activeFile, fileData, 'utf8');
    require('fs').unlinkSync(retiredFile);

    return NextResponse.json({ success: true, message: `Node ${role} successfully restored to Active Duty.` });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
