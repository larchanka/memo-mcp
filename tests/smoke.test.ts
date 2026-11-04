import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SERVER_NAME, SERVER_VERSION } from '../src/index.js';

describe('Smoke Test Suite', () => {
  it('should assert truthy values correctly', () => {
    expect(true).toBe(true);
  });

  it('should export valid server metadata', () => {
    expect(SERVER_NAME).toBe('memo-mcp');
    expect(SERVER_VERSION).toBe('0.1.0');
  });

  it('should instantiate an in-memory better-sqlite3 database', () => {
    const db = new Database(':memory:');
    const row = db.prepare('SELECT 1 AS alive').get() as { alive: number };
    expect(row.alive).toBe(1);
    db.close();
  });
});
