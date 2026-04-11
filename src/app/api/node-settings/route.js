import { NextResponse } from 'next/server';
import { getNodeSettings, saveNodeSettings } from '@/lib/nodeSettings';

export async function GET() {
  return NextResponse.json(getNodeSettings());
}

export async function POST(req) {
  try {
    const changes = await req.json();
    const existing = getNodeSettings();
    saveNodeSettings({
      frp: { ...existing.frp, ...(changes.frp || {}) },
      proxy: { ...existing.proxy, ...(changes.proxy || {}) }
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
