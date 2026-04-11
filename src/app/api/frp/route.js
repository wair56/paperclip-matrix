import { NextResponse } from 'next/server';
import { startFrp, stopFrp, getFrpStatus } from '@/lib/FrpManager';
import { getNodeSettings } from '@/lib/nodeSettings';

export async function GET() {
  const status = getFrpStatus();
  return NextResponse.json({ success: true, ...status });
}

export async function POST(req) {
  try {
    const { action } = await req.json();
    
    if (action === 'start') {
      const settings = getNodeSettings().frp;
      if (!settings.serverAddr || !settings.serverPort || !settings.remotePort) {
        return NextResponse.json({ success: false, error: 'FRP Configuration is incomplete in Node Settings' }, { status: 400 });
      }
      const pid = await startFrp(settings);
      return NextResponse.json({ success: true, pid });
    } 
    
    if (action === 'stop') {
      await stopFrp();
      return NextResponse.json({ success: true, stopped: true });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });

  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
