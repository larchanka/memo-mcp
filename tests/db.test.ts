import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createDb, getDefaultDbPath } from '../src/db/client.js';

describe('SQLite Client and Schema Initialization', () => {
  let db: Database.Database | null = null;
  const tempDirs: string[] = [];

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
    for (const dir of tempDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirs.length = 0;
  });

  it('initializes in-memory database with schema and pragmas', () => {
    db = createDb(':memory:');

    // Verify foreign keys enabled
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);

    // Verify busy timeout configured to 5000ms
    const timeout = db.pragma('busy_timeout', { simple: true });
    expect(timeout).toBe(5000);

    // In-memory sqlite reports 'memory' for journal mode
    const journalMode = db.pragma('journal_mode', { simple: true });
    expect(journalMode).toBe('memory');

    // Verify tables exist in sqlite_master
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'shadow') ORDER BY name"
      )
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('memory_entries');
    expect(tableNames).toContain('keywords');
    expect(tableNames).toContain('memory_tags');
    expect(tableNames).toContain('memory_fts');
  });

  it('initializes persistent file database with WAL journal mode and creates parent directories', () => {
    const tempDir = path.join(os.tmpdir(), `memo-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, 'nested', 'memo.db');

    db = createDb(dbPath);

    expect(fs.existsSync(dbPath)).toBe(true);

    const journalMode = db.pragma('journal_mode', { simple: true });
    expect(journalMode).toBe('wal');

    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);

    const timeout = db.pragma('busy_timeout', { simple: true });
    expect(timeout).toBe(5000);
  });

  it('indexes and matches code-safe token characters (-_/@) in memory_fts', () => {
    db = createDb(':memory:');

    db.prepare(`
      INSERT INTO memory_fts (entry_id, summary, body, tags)
      VALUES (?, ?, ?, ?)
    `).run(
      1,
      'Integration with @modelcontextprotocol/sdk',
      'Configuring src/utils/auth-token.ts with better-sqlite3',
      'mcp-server node_next'
    );

    // Match exact symbol containing '@' and '/'
    const matchScopedPkg = db
      .prepare("SELECT entry_id FROM memory_fts WHERE memory_fts MATCH '\"@modelcontextprotocol/sdk\"'")
      .all() as { entry_id: number }[];
    expect(matchScopedPkg.length).toBe(1);
    expect(matchScopedPkg[0].entry_id).toBe(1);

    // Match path with '/' and '-'
    const matchPath = db
      .prepare("SELECT entry_id FROM memory_fts WHERE memory_fts MATCH '\"src/utils/auth-token.ts\"'")
      .all() as { entry_id: number }[];
    expect(matchPath.length).toBe(1);

    // Match underscore tag
    const matchTag = db
      .prepare("SELECT entry_id FROM memory_fts WHERE memory_fts MATCH 'node_next'")
      .all() as { entry_id: number }[];
    expect(matchTag.length).toBe(1);
  });

  it('resolves default db path using MEMO_DB_PATH or home directory fallback', () => {
    const originalEnv = process.env.MEMO_DB_PATH;
    try {
      process.env.MEMO_DB_PATH = '/custom/path/memo.db';
      expect(getDefaultDbPath()).toBe('/custom/path/memo.db');

      delete process.env.MEMO_DB_PATH;
      const defaultPath = getDefaultDbPath();
      expect(defaultPath).toBe(path.join(os.homedir(), '.memo', 'memo.db'));
    } finally {
      if (originalEnv !== undefined) {
        process.env.MEMO_DB_PATH = originalEnv;
      } else {
        delete process.env.MEMO_DB_PATH;
      }
    }
  });
});
