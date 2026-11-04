import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from '../src/db/client.js';
import { insertMemoryEntry, getActiveTags } from '../src/db/queries.js';

describe('getActiveTags query', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty array when database is empty', () => {
    const tags = getActiveTags(db);
    expect(tags).toEqual([]);
  });

  it('returns tags with >= 3 occurrences within 60 days', () => {
    // Tag 'sqlite' used 3 times recently
    insertMemoryEntry(db, { summary: 'S1', body: 'B1', tags: ['sqlite'] });
    insertMemoryEntry(db, { summary: 'S2', body: 'B2', tags: ['sqlite'] });
    insertMemoryEntry(db, { summary: 'S3', body: 'B3', tags: ['sqlite'] });

    // Tag 'wal' used 2 times recently
    insertMemoryEntry(db, { summary: 'W1', body: 'B1', tags: ['wal'] });
    insertMemoryEntry(db, { summary: 'W2', body: 'B2', tags: ['wal'] });

    // With limit 1: only 'sqlite' qualifies for 60-day window (count >= 3)
    const top1 = getActiveTags(db, 1);
    expect(top1).toEqual(['sqlite']);
  });

  it('ignores tags with < 3 occurrences within 60 days unless needed for backfill', () => {
    // Tag 'rare' used only once recently
    insertMemoryEntry(db, { summary: 'R1', body: 'B1', tags: ['rare'] });

    // Tag 'active' used 3 times recently
    insertMemoryEntry(db, { summary: 'A1', body: 'B1', tags: ['active'] });
    insertMemoryEntry(db, { summary: 'A2', body: 'B2', tags: ['active'] });
    insertMemoryEntry(db, { summary: 'A3', body: 'B3', tags: ['active'] });

    // Without backfill needed (limit = 1), only active is returned
    const limit1 = getActiveTags(db, 1);
    expect(limit1).toEqual(['active']);

    // With limit = 2, 'active' (count 3 >= 3) is returned first, then 'rare' is backfilled
    const limit2 = getActiveTags(db, 2);
    expect(limit2).toEqual(['active', 'rare']);
  });

  it('filters out old tags (> 60 days) from active window but backfills them by all-time count', () => {
    // Create an old entry (> 60 days old) with tag 'legacy' used 5 times
    const insertEntryWithDate = (tag: string, daysAgo: number) => {
      const entryRes = db.prepare(`
        INSERT INTO memory_entries (type, summary, body, created_at)
        VALUES ('decision', 'Summary', 'Body', datetime('now', ?))
      `).run(`-${daysAgo} days`);

      const entryId = Number(entryRes.lastInsertRowid);
      db.prepare('INSERT INTO keywords (keyword) VALUES (?) ON CONFLICT(keyword) DO NOTHING').run(tag);
      const kw = db.prepare('SELECT id FROM keywords WHERE keyword = ?').get(tag) as { id: number };
      db.prepare('INSERT INTO memory_tags (entry_id, keyword_id) VALUES (?, ?)').run(entryId, kw.id);
    };

    // 'legacy' has 5 usages 70 days ago
    for (let i = 0; i < 5; i++) {
      insertEntryWithDate('legacy', 70);
    }

    // 'fresh' has 3 usages 10 days ago
    for (let i = 0; i < 3; i++) {
      insertEntryWithDate('fresh', 10);
    }

    // Limit 1: only 'fresh' qualifies in 60-day window (even though 'legacy' has 5 all-time uses)
    const top1 = getActiveTags(db, 1);
    expect(top1).toEqual(['fresh']);

    // Limit 2: 'fresh' qualifies first, then 'legacy' backfills because it is all-time popular
    const top2 = getActiveTags(db, 2);
    expect(top2).toEqual(['fresh', 'legacy']);
  });

  it('caps results at limit (default 40) and deduplicates between active and backfill', () => {
    // Insert 50 distinct tags
    for (let i = 1; i <= 50; i++) {
      const tagName = `tag-${String(i).padStart(2, '0')}`;
      // Make first 5 active (>= 3 times)
      const count = i <= 5 ? 3 : 1;
      for (let c = 0; c < count; c++) {
        insertMemoryEntry(db, {
          summary: `Summary for ${tagName}`,
          body: 'Body',
          tags: [tagName],
        });
      }
    }

    const tags = getActiveTags(db); // default limit 40
    expect(tags).toHaveLength(40);

    // First 5 must be the active ones (tag-01 .. tag-05)
    for (let i = 1; i <= 5; i++) {
      const tagName = `tag-${String(i).padStart(2, '0')}`;
      expect(tags.slice(0, 5)).toContain(tagName);
    }

    // Check distinct elements
    const set = new Set(tags);
    expect(set.size).toBe(40);
  });
});
