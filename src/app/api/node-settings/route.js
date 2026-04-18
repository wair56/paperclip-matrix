import { NextResponse } from 'next/server';
import { getNodeSettings, saveNodeSettings } from '@/lib/nodeSettings';
import { parseEnvText } from '@/lib/cliEnv';

export async function GET() {
  return NextResponse.json(getNodeSettings());
}

export async function POST(req) {
  try {
    const changes = await req.json();
    const existing = getNodeSettings();
    const mergedCli = { ...existing.cli, ...(changes.cli || {}) };
    const cliParseResult = parseEnvText(mergedCli.envText || '');
    mergedCli.envVars = cliParseResult.envVars;

    const nextSettings = {
      frp: { ...existing.frp, ...(changes.frp || {}) },
      proxy: { ...existing.proxy, ...(changes.proxy || {}) },
      cli: mergedCli,
      agentRules: { ...existing.agentRules, ...(changes.agentRules || {}) }
    };
    saveNodeSettings({
      ...nextSettings
    });
    return NextResponse.json({ success: true, warnings: cliParseResult.errors, settings: nextSettings });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
