import { NextResponse } from 'next/server';
import os from 'os';
import { execSync } from 'child_process';

// Store previous CPU measurement for delta calculation
let prevCpuTimes = null;

function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  const currentTimes = { idle: totalIdle, total: totalTick };

  if (!prevCpuTimes) {
    prevCpuTimes = currentTimes;
    // First call: can't calculate delta, use load average as fallback
    const loadAvg = os.loadavg();
    return Math.min((loadAvg[0] / cpus.length) * 100, 100).toFixed(1);
  }

  const idleDiff = currentTimes.idle - prevCpuTimes.idle;
  const totalDiff = currentTimes.total - prevCpuTimes.total;
  prevCpuTimes = currentTimes;

  if (totalDiff === 0) return '0.0';
  return ((1 - idleDiff / totalDiff) * 100).toFixed(1);
}

function getMemoryInfo() {
  const totalMem = os.totalmem();
  let availableMem = os.freemem(); // fallback

  // On macOS, os.freemem() only reports truly unused pages.
  // We can use vm_stat to get a more realistic "available" figure.
  if (os.platform() === 'darwin') {
    try {
      const vmstat = execSync('vm_stat', { encoding: 'utf8' });
      const pageSize = 16384; // macOS ARM default; Intel uses 4096
      const pageSizeMatch = vmstat.match(/page size of (\d+) bytes/);
      const ps = pageSizeMatch ? parseInt(pageSizeMatch[1]) : 16384;

      const free = vmstat.match(/Pages free:\s+(\d+)/);
      const inactive = vmstat.match(/Pages inactive:\s+(\d+)/);
      const purgeable = vmstat.match(/Pages purgeable:\s+(\d+)/);

      const freePages = free ? parseInt(free[1]) : 0;
      const inactivePages = inactive ? parseInt(inactive[1]) : 0;
      const purgeablePages = purgeable ? parseInt(purgeable[1]) : 0;

      availableMem = (freePages + inactivePages + purgeablePages) * ps;
    } catch {
      // Fallback to os.freemem()
    }
  }

  const usedMem = totalMem - availableMem;
  const usagePct = ((usedMem / totalMem) * 100).toFixed(1);

  return {
    memUsagePct: usagePct,
    freeMemGb: (availableMem / 1024 ** 3).toFixed(2),
    totalMemGb: (totalMem / 1024 ** 3).toFixed(2),
  };
}

export async function GET() {
  try {
    const cpuPct = getCpuUsage();
    const mem = getMemoryInfo();

    return NextResponse.json({
      success: true,
      data: {
        cpuLoadPct: cpuPct,
        memUsagePct: mem.memUsagePct,
        freeMemGb: mem.freeMemGb,
        totalMemGb: mem.totalMemGb,
        platform: os.platform(),
        uptimeSec: os.uptime()
      }
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
