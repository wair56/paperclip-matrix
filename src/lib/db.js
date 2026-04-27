import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { Database } from 'bun:sqlite';

import { DB_FILE } from './paths';

let db = null;

function shouldMarkStaleRunsOnStartup() {
  if (process.env.MATRIX_MARK_STALE_RUNS_ON_STARTUP === 'true') return true;
  if (process.env.MATRIX_SKIP_STARTUP_CLEANUP === 'true') return false;
  const argv = process.argv.join(' ');
  // Only the long-lived Matrix web server should perform this cleanup.
  // Short-lived scripts/tests also import getDb(); if they run this cleanup
  // against the production DB, they can incorrectly interrupt active tasks.
  return /\bnext\b/.test(argv) && /\bstart\b/.test(argv);
}

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
      name TEXT,
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

    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      runId TEXT,
      sourceEventId TEXT,
      companyId TEXT,
      agentId TEXT,
      role TEXT,
      prompt TEXT,
      response TEXT,
      receivedAt INTEGER,
      repliedAt INTEGER,
      status TEXT
    );
  `);

  // Safe migration for existing DBs
  try {
    db.exec(`ALTER TABLE identities ADD COLUMN name TEXT;`);
  } catch (e) {}

  try {
    // 1. Cleanup duplicates before adding unique index (keep latest)
    db.exec(`
      DELETE FROM task_runs 
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, MAX(receivedAt) OVER (PARTITION BY runId) as max_at FROM task_runs
        ) WHERE id = id AND (runId IS NULL OR runId = '') OR max_at IS NOT NULL
      ) AND runId IS NOT NULL AND runId != '';
    `);
    
    // 2. Create unique index on runId
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_task_runs_runId ON task_runs(runId) WHERE runId IS NOT NULL AND runId != '';`);
  } catch (e) {
    console.error("[Matrix-DB] Migration failed for task_runs unique index:", e);
  }

  // Migration: Add isActive column for persistent running state
  try {
    db.exec(`ALTER TABLE identities ADD COLUMN isActive INTEGER DEFAULT 0;`);
  } catch (e) {} // Column already exists - ignore

  // Migration: Separate cloud-synced runtime config from local overrides
  try {
    db.exec(`ALTER TABLE identities ADD COLUMN localEnvJson TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE identities ADD COLUMN cloudEnvJson TEXT;`);
  } catch (e) {}

  // Migration: Add taskId column to task_runs for cross-run idempotency
  try {
    db.exec(`ALTER TABLE task_runs ADD COLUMN taskId TEXT;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_taskId ON task_runs(taskId) WHERE taskId IS NOT NULL AND taskId != '';`);
  } catch (e) {}

  // Migration: Add sourceEventId for deduping repeated webhook deliveries
  try {
    db.exec(`ALTER TABLE task_runs ADD COLUMN sourceEventId TEXT;`);
  } catch (e) {}
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_task_runs_sourceEventId ON task_runs(sourceEventId) WHERE sourceEventId IS NOT NULL AND sourceEventId != '';`);
  } catch (e) {}

  // Query-performance indexes for the task history page
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_receivedAt ON task_runs(receivedAt DESC);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_company_receivedAt ON task_runs(companyId, receivedAt DESC);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_agent_receivedAt ON task_runs(agentId, receivedAt DESC);`);
  } catch (e) {}

  if (shouldMarkStaleRunsOnStartup()) {
    // Startup Cleanup: Mark any tasks stuck in 'running' as interrupted (since process handles are lost)
    try {
      db.prepare(`UPDATE task_runs SET status = 'interrupted', response = 'Task was interrupted by server restart' WHERE status = 'running'`).run();
    } catch (e) {
      console.error("[Matrix-DB] Startup cleanup failed:", e.message);
    }
  }

  return db;
}

export default getDb;
