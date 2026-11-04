import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from '../src/db/client.js';
import { insertMemoryEntry } from '../src/db/queries.js';

describe('insertMemoryEntry transaction', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('inserts memory entry and creates keywords, junction rows, and FTS index', () => {
    const input = {
      type: 'decision',
      summary: 'Use SQLite WAL mode for multi-agent concurrency',
      body: 'Detailed rationale and benchmarks for WAL mode with 5000ms busy timeout.',
      tags: ['sqlite', 'wal', 'concurrency'],
    };

    const result = insertMemoryEntry(db, input);

    expect(result.id).toBeGreaterThan(0);
    expect(result.type).toBe('decision');
    expect(result.summary).toBe(input.summary);
    expect(result.tags).toEqual(['sqlite', 'wal', 'concurrency']);
    expect(result.createdAt).toBeDefined();

    // Verify row in memory_entries
    const entry = db
      .prepare('SELECT id, type, summary, body, created_at FROM memory_entries WHERE id = ?')
      .get(result.id) as { id: number; type: string; summary: string; body: string; created_at: string };
    expect(entry).toBeDefined();
    expect(entry.summary).toBe(input.summary);
    expect(entry.body).toBe(input.body);

    // Verify keywords table
    const keywords = db
      .prepare('SELECT keyword FROM keywords ORDER BY keyword ASC')
      .all() as { keyword: string }[];
    expect(keywords.map((k) => k.keyword)).toEqual(['concurrency', 'sqlite', 'wal']);

    // Verify memory_tags junction
    const tagsJunction = db
      .prepare(`
        SELECT k.keyword
        FROM memory_tags mt
        JOIN keywords k ON mt.keyword_id = k.id
        WHERE mt.entry_id = ?
        ORDER BY k.keyword ASC
      `)
      .all(result.id) as { keyword: string }[];
    expect(tagsJunction.map((t) => t.keyword)).toEqual(['concurrency', 'sqlite', 'wal']);

    // Verify searchable in memory_fts by summary term
    const ftsSummaryMatch = db
      .prepare("SELECT entry_id FROM memory_fts WHERE memory_fts MATCH 'concurrency'")
      .all() as { entry_id: number }[];
    expect(ftsSummaryMatch).toHaveLength(1);
    expect(ftsSummaryMatch[0].entry_id).toBe(result.id);

    // Verify searchable in memory_fts by tag term
    const ftsTagMatch = db
      .prepare("SELECT entry_id FROM memory_fts WHERE memory_fts MATCH 'wal'")
      .all() as { entry_id: number }[];
    expect(ftsTagMatch).toHaveLength(1);
    expect(ftsTagMatch[0].entry_id).toBe(result.id);
  });

  it('handles code symbol tags correctly and prevents duplicate keywords', () => {
    const input1 = {
      type: 'architecture',
      summary: 'Add @modelcontextprotocol/sdk server',
      body: 'Setup server transport',
      tags: ['@modelcontextprotocol/sdk', 'mcp-server'],
    };

    const input2 = {
      type: 'note',
      summary: 'Update @modelcontextprotocol/sdk handlers',
      body: 'Updated tool definitions',
      tags: ['@modelcontextprotocol/sdk', 'node_next'],
    };

    const res1 = insertMemoryEntry(db, input1);
    const res2 = insertMemoryEntry(db, input2);

    expect(res1.id).not.toBe(res2.id);

    // Keyword '@modelcontextprotocol/sdk' must be deduplicated in keywords table
    const keywordRows = db
      .prepare("SELECT keyword FROM keywords WHERE keyword = '@modelcontextprotocol/sdk'")
      .all();
    expect(keywordRows).toHaveLength(1);

    // FTS exact phrase match on code symbol
    const ftsMatch = db
      .prepare("SELECT entry_id FROM memory_fts WHERE memory_fts MATCH '\"@modelcontextprotocol/sdk\"'")
      .all() as { entry_id: number }[];
    expect(ftsMatch.map((m) => m.entry_id).sort()).toEqual([res1.id, res2.id].sort());
  });

  it('soft-validates malformed input and empty tags safely', () => {
    const malformed = {
      type: 'UNKNOWN_TYPE',
      summary: '   ',
      body: undefined,
      tags: [],
    };

    const result = insertMemoryEntry(db, malformed);

    expect(result.type).toBe('note');
    expect(result.summary).toBe('(No summary provided)');
    expect(result.tags).toEqual([]);

    const entry = db
      .prepare('SELECT type, summary, body FROM memory_entries WHERE id = ?')
      .get(result.id) as { type: string; summary: string; body: string };
    expect(entry.type).toBe('note');
    expect(entry.summary).toBe('(No summary provided)');
    expect(entry.body).toBe('');

    // memory_fts should index row without error
    const count = db.prepare('SELECT COUNT(*) as cnt FROM memory_fts').get() as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  it('rolls back completely if transaction fails midway', () => {
    const initialCount = (
      db.prepare('SELECT COUNT(*) as cnt FROM memory_entries').get() as { cnt: number }
    ).cnt;

    // Simulate an error inside a transaction
    expect(() => {
      const tx = db.transaction(() => {
        insertMemoryEntry(db, {
          type: 'decision',
          summary: 'Should be rolled back',
          body: 'Rollback test body',
          tags: ['rollback-test'],
        });
        throw new Error('Simulated failure during transaction');
      });
      tx();
    }).toThrow('Simulated failure during transaction');

    const finalCount = (
      db.prepare('SELECT COUNT(*) as cnt FROM memory_entries').get() as { cnt: number }
    ).cnt;
    expect(finalCount).toBe(initialCount);

    const ftsCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM memory_fts WHERE memory_fts MATCH '\"rollback-test\"'").get() as {
        cnt: number;
      }
    ).cnt;
    expect(ftsCount).toBe(0);
  });
});
