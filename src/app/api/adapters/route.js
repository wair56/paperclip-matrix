import { NextResponse } from 'next/server';

let cachedAdapters = null;
let lastFetch = 0;

export async function GET() {
  const now = Date.now();
  // Cache for 1 hour to avoid GitHub API rate limits
  if (cachedAdapters && now - lastFetch < 3600000) {
    return NextResponse.json({ success: true, adapters: cachedAdapters });
  }

  try {
    const res = await fetch('https://api.github.com/repos/paperclipai/paperclip/contents/packages/adapters', {
      headers: {
        'User-Agent': 'Paperclip-Matrix-Dashboard',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status}`);
    }

    const data = await res.json();
    const adapters = data
      .filter(item => item.type === 'dir')
      .map(item => item.name);

    if (adapters.length > 0) {
      cachedAdapters = adapters;
      lastFetch = now;
      return NextResponse.json({ success: true, adapters });
    } else {
      throw new Error('No adapters found');
    }
  } catch (error) {
    console.error('[adapters] Failed to fetch from Github:', error.message);
    // Fallback to defaults if fetch fails
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      adapters: ['claude-local', 'codex-local', 'gemini-local'] 
    });
  }
}
