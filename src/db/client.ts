import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export function resolveDbPath(targetPath: string): string {
  if (targetPath === ':memory:') {
    return targetPath;
  }
  if (targetPath.startsWith('~')) {
    return path.join(os.homedir(), targetPath.slice(1));
  }
  return path.resolve(targetPath);
}

export function getDefaultDbPath(): string {
  if (process.env.MEMO_DB_PATH) {
    return resolveDbPath(process.env.MEMO_DB_PATH);
  }
  return path.join(os.homedir(), '.memo', 'memo.db');
}

export function createDb(dbPath?: string): Database.Database {
  const finalPath = dbPath !== undefined ? resolveDbPath(dbPath) : getDefaultDbPath();

  if (finalPath !== ':memory:') {
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(finalPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(SCHEMA_SQL);

  return db;
}
