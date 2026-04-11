import path from 'path';
import { existsSync, mkdirSync } from 'fs';

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.join(ROOT_DIR, '.data');
export const IDENTITIES_DIR = path.join(DATA_DIR, 'identities');
export const RETIRED_DIR = path.join(DATA_DIR, 'retired_identities');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');
export const BIN_DIR = path.join(DATA_DIR, 'bin');
export const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');
export const SETTINGS_FILE = path.join(DATA_DIR, 'node-settings.json');
export const DB_FILE = path.join(DATA_DIR, 'matrix.db');

// Ensure critical directories exist on first import
for (const dir of [DATA_DIR, IDENTITIES_DIR, RETIRED_DIR, LOGS_DIR, WORKSPACES_DIR, BIN_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
