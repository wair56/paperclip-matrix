import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { Database } from 'bun:sqlite';

import { DB_FILE } from './paths';

let db = null;

export function getDb() {
  if (db) return db;

  // Ensure config directory exists
  const dataDir = path.dirname(DB_FILE);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Initialize DB
  db = new Database(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');

  // Ensure tables exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      apiUrl TEXT NOT NULL,
      boardKey TEXT NOT NULL,
      templateType TEXT,
      webhookDomain TEXT,
      proxyUrl TEXT,
      openaiBaseUrl TEXT,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rolesJson TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS identities (
      role TEXT PRIMARY KEY,
      agentId TEXT,
      apiUrl TEXT,
      companyId TEXT,
      executor TEXT,
      model TEXT,
      timeoutMs INTEGER,
      apiKey TEXT,
      envJson TEXT,
      status TEXT DEFAULT 'active'
    );
  `);

  return db;
}

export default getDb;
