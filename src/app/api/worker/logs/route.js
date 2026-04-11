import { NextResponse } from 'next/server';
import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import { LOGS_DIR } from '@/lib/paths';
const MAX_LOG_BYTES = 100 * 1024; // 100KB

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');

    if (!role) {
      return NextResponse.json({ success: false, error: 'Role parameter is required.' }, { status: 400 });
    }

    const logPath = path.join(LOGS_DIR, `${role}.log`);
    
    if (!existsSync(logPath)) {
      return NextResponse.json({ success: true, logs: '--- [No log output detected yet] ---' });
    }

    const stats = statSync(logPath);
    // If log file is huge, only tail the last 100KB to prevent dashboard lag
    const start = Math.max(0, stats.size - MAX_LOG_BYTES);
    
    // Simple slice approach for tailing
    const fileContent = readFileSync(logPath, 'utf8');
    const logs = fileContent.length > MAX_LOG_BYTES 
      ? '... [Log truncated due to size. Showing tail] ...\n' + fileContent.slice(-MAX_LOG_BYTES)
      : fileContent;

    return NextResponse.json({ success: true, logs });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
