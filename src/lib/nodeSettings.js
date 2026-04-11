import getDb from './db';

const DEFAULT_SETTINGS = {
  frp: {
    serverAddr: '',
    serverPort: 17000,
    token: '',
    remotePort: 50002
  },
  proxy: {
    httpsProxy: '',
    openaiBaseUrl: ''
  }
};

/**
 * Recursively merge source into target, preserving nested structure.
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function getNodeSettings() {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT key, value FROM settings`).all();
    
    if (rows.length === 0) {
      saveNodeSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }

    const fetchedSettings = {};
    for (const row of rows) {
      try {
        fetchedSettings[row.key] = JSON.parse(row.value);
      } catch (e) {
        // Fallback or ignore unparseable JSON
      }
    }

    return deepMerge(DEFAULT_SETTINGS, fetchedSettings);
  } catch (err) {
    console.error("Failed to fetch node-settings from DB:", err);
    return DEFAULT_SETTINGS;
  }
}

export function saveNodeSettings(settings) {
  try {
    const db = getDb();
    const stmt = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        stmt.run(key, JSON.stringify(value));
      }
    })();
  } catch (err) {
    console.error("Failed to save node-settings to DB:", err);
  }
}
