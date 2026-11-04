import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from '../src/db/client.js';
import {
  insertMemoryEntry,
  formatFtsQuery,
  searchMemory,
  getEntryContext,
} from '../src/db/queries.js';

describe('FTS5 Search & Context Retrieval Pipeline', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('formatFtsQuery', () => {
    it('safely wraps single words and phrases in quotes', () => {
      expect(formatFtsQuery('sqlite')).toBe('"sqlite"');
      expect(formatFtsQuery('sqlite wal')).toBe('"sqlite" "wal"');
    });

    it('handles code symbols (-_/@) without causing syntax errors', () => {
      expect(formatFtsQuery('@modelcontextprotocol/sdk')).toBe('"@modelcontextprotocol/sdk"');
      expect(formatFtsQuery('src/utils/auth.ts')).toBe('"src/utils/auth.ts"');
      expect(formatFtsQuery('better-sqlite3')).toBe('"better-sqlite3"');
      expect(formatFtsQuery('node_next')).toBe('"node_next"');
    });

    it('escapes internal quotes safely', () => {
      expect(formatFtsQuery('hello "world"')).toBe('"hello" "world"');
    });

    it('returns empty string for empty or whitespace-only queries', () => {
      expect(formatFtsQuery('')).toBe('');
      expect(formatFtsQuery('   ')).toBe('');
      expect(formatFtsQuery('***')).toBe('');
    });
  });

  describe('searchMemory (Stage 1)', () => {
    it('returns empty array when query is empty or no matches found', () => {
      insertMemoryEntry(db, {
        type: 'note',
        summary: 'Something unrelated',
        body: 'Content',
        tags: ['misc'],
      });

      expect(searchMemory(db, { query: '' })).toEqual([]);
      expect(searchMemory(db, { query: 'nonexistenttermxyz' })).toEqual([]);
    });

    it('finds entries matching terms in summary, body, or tags', () => {
      const e1 = insertMemoryEntry(db, {
        type: 'decision',
        summary: 'Adopted SQLite WAL mode',
        body: 'Better concurrency for multi-agent writes',
        tags: ['sqlite', 'wal'],
      });

      const e2 = insertMemoryEntry(db, {
        type: 'architecture',
        summary: 'Architecture diagram created',
        body: 'Details in memory-mcp pipeline',
        tags: ['diagram'],
      });

      // Match by summary
      const resSummary = searchMemory(db, { query: 'Adopted' });
      expect(resSummary).toHaveLength(1);
      expect(resSummary[0].id).toBe(e1.id);
      expect(resSummary[0].tags).toEqual(['sqlite', 'wal']);

      // Match by body
      const resBody = searchMemory(db, { query: 'concurrency' });
      expect(resBody).toHaveLength(1);
      expect(resBody[0].id).toBe(e1.id);

      // Match by tag
      const resTag = searchMemory(db, { query: 'diagram' });
      expect(resTag).toHaveLength(1);
      expect(resTag[0].id).toBe(e2.id);
    });

    it('matches exact code symbols with slashes, hyphens, and @', () => {
      const e1 = insertMemoryEntry(db, {
        type: 'architecture',
        summary: 'Configured @modelcontextprotocol/sdk transport',
        body: 'Using StdioServerTransport in src/index.ts',
        tags: ['@modelcontextprotocol/sdk', 'mcp'],
      });

      const results = searchMemory(db, { query: '@modelcontextprotocol/sdk' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(e1.id);
    });

    it('applies time decay when deep_history is false, demoting older notes', () => {
      // Seed background entries so IDF is non-zero
      for (let i = 0; i < 5; i++) {
        insertMemoryEntry(db, {
          type: 'note',
          summary: `Background document ${i}`,
          body: 'Unrelated content',
          tags: ['misc'],
        });
      }

      // Create an old note (60 days old) and a fresh note (today) with identical term
      const insertOldEntry = (daysAgo: number, type: 'note' | 'decision') => {
        const res = db.prepare(`
          INSERT INTO memory_entries (type, summary, body, created_at)
          VALUES (?, 'Database locking bug in production', 'Details about lock wait timeout', datetime('now', ?))
        `).run(type, `-${daysAgo} days`);
        const id = Number(res.lastInsertRowid);
        db.prepare('INSERT INTO keywords (keyword) VALUES (?) ON CONFLICT(keyword) DO NOTHING').run('sqlite');
        const kw = db.prepare('SELECT id FROM keywords WHERE keyword = ?').get('sqlite') as { id: number };
        db.prepare('INSERT INTO memory_tags (entry_id, keyword_id) VALUES (?, ?)').run(id, kw.id);
        db.prepare('INSERT INTO memory_fts (entry_id, summary, body, tags) VALUES (?, ?, ?, ?)').run(
          id,
          'Database locking bug in production',
          'Details about lock wait timeout',
          'sqlite'
        );
        return id;
      };

      const oldNoteId = insertOldEntry(60, 'note');
      const freshNoteId = insertOldEntry(0, 'note');

      // Stage 1 search with deep_history = false: fresh note must rank higher than 60-day old note
      const results = searchMemory(db, { query: 'locking bug', deep_history: false });
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].id).toBe(freshNoteId);
      expect(results[1].id).toBe(oldNoteId);
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('bypasses decay when deep_history is true or for immune types', () => {
      const insertWithDate = (daysAgo: number, type: 'note' | 'decision', summary: string) => {
        const res = db.prepare(`
          INSERT INTO memory_entries (type, summary, body, created_at)
          VALUES (?, ?, 'Body text for caching', datetime('now', ?))
        `).run(type, summary, `-${daysAgo} days`);
        const id = Number(res.lastInsertRowid);
        db.prepare('INSERT INTO memory_fts (entry_id, summary, body, tags) VALUES (?, ?, ?, ?)').run(
          id,
          summary,
          'Body text for caching',
          'cache'
        );
        return id;
      };

      // 60-day old decision should NOT decay
      const oldDecisionId = insertWithDate(60, 'decision', 'Decision on caching layer');
      const resDecision = searchMemory(db, { query: 'caching layer', deep_history: false });
      expect(resDecision[0].id).toBe(oldDecisionId);
      expect(resDecision[0].age_days).toBeCloseTo(60, -1);

      // 60-day old note with deep_history: true should NOT decay
      const oldNoteId = insertWithDate(60, 'note', 'Note on caching layer');
      const resDeep = searchMemory(db, { query: 'caching layer', deep_history: true });
      expect(resDeep.length).toBe(2);
      // Both should have equal raw score since text is nearly identical
      expect(resDeep[0].score).toBeCloseTo(resDeep[1].score, 1);
    });

    it('clamps limit between 1 and 15, defaulting to 5', () => {
      for (let i = 1; i <= 20; i++) {
        insertMemoryEntry(db, {
          summary: `Entry ${i} about benchmarking`,
          body: `Content ${i}`,
          tags: ['benchmark'],
        });
      }

      // Default limit is 5
      const defaultRes = searchMemory(db, { query: 'benchmarking' });
      expect(defaultRes).toHaveLength(5);

      // Max limit is 15
      const maxRes = searchMemory(db, { query: 'benchmarking', limit: 30 });
      expect(maxRes).toHaveLength(15);

      // Min limit is 1
      const minRes = searchMemory(db, { query: 'benchmarking', limit: 0 });
      expect(minRes).toHaveLength(1);
    });
  });

  describe('getEntryContext (Stage 2)', () => {
    it('returns full entry context for valid entry ID', () => {
      const inserted = insertMemoryEntry(db, {
        type: 'decision',
        summary: 'Adopt WAL Mode',
        body: 'WAL mode enables concurrent reads while writing.',
        tags: ['sqlite', 'wal'],
      });

      const context = getEntryContext(db, inserted.id);
      expect(context).not.toBeNull();
      expect(context?.id).toBe(inserted.id);
      expect(context?.type).toBe('decision');
      expect(context?.summary).toBe('Adopt WAL Mode');
      expect(context?.body).toBe('WAL mode enables concurrent reads while writing.');
      expect(context?.tags).toEqual(['sqlite', 'wal']);
      expect(context?.created_at).toBeDefined();
    });

    it('returns null for nonexistent entry ID', () => {
      const context = getEntryContext(db, 999999);
      expect(context).toBeNull();
    });
  });
});
