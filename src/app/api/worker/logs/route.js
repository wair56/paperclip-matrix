import { NextResponse } from 'next/server';
import { closeSync, existsSync, openSync, readSync, statSync } from 'fs';
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
    const fd = openSync(logPath, 'r');
    const buffer = Buffer.alloc(stats.size - start);
    try {
      readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      closeSync(fd);
    }

    const fileContent = buffer.toString('utf8');
    const logs = start > 0
      ? '... [Log truncated due to size. Showing tail] ...\n' + fileContent
      : fileContent;

    return NextResponse.json({ success: true, logs });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
