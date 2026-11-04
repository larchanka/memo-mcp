import type Database from 'better-sqlite3';
import {
  sanitizeMemoryInput,
  type MemoryType,
  type RawMemoryInput,
} from '../engine/sanitize.js';
import { calculateDeltaDays, calculateFinalScore } from '../engine/decay.js';

export interface InsertMemoryResult {
  id: number;
  type: MemoryType;
  summary: string;
  tags: string[];
  createdAt: string;
}

export interface SearchMemoryOptions {
  query: string;
  deep_history?: boolean;
  limit?: number;
  now?: Date;
}

export interface MemoryIndexCard {
  id: number;
  type: MemoryType;
  summary: string;
  tags: string[];
  age_days: number;
  score: number;
}

export interface MemoryEntryContext {
  id: number;
  type: MemoryType;
  summary: string;
  body: string;
  tags: string[];
  created_at: string;
}

export function insertMemoryEntry(
  db: Database.Database,
  input: RawMemoryInput
): InsertMemoryResult {
  const sanitized = sanitizeMemoryInput(input);

  const insertEntryStmt = db.prepare(`
    INSERT INTO memory_entries (type, summary, body)
    VALUES (?, ?, ?)
  `);

  const selectCreatedStmt = db.prepare(`
    SELECT created_at FROM memory_entries WHERE id = ?
  `);

  const insertKeywordStmt = db.prepare(`
    INSERT INTO keywords (keyword)
    VALUES (?)
    ON CONFLICT(keyword) DO NOTHING
  `);

  const selectKeywordIdStmt = db.prepare(`
    SELECT id FROM keywords WHERE keyword = ?
  `);

  const insertTagJunctionStmt = db.prepare(`
    INSERT INTO memory_tags (entry_id, keyword_id)
    VALUES (?, ?)
  `);

  const insertFtsStmt = db.prepare(`
    INSERT INTO memory_fts (entry_id, summary, body, tags)
    VALUES (?, ?, ?, ?)
  `);

  const executeTransaction = db.transaction(() => {
    const entryResult = insertEntryStmt.run(
      sanitized.type,
      sanitized.summary,
      sanitized.body
    );
    const id = Number(entryResult.lastInsertRowid);

    const row = selectCreatedStmt.get(id) as { created_at: string };
    const createdAt = row?.created_at ?? new Date().toISOString();

    for (const tag of sanitized.tags) {
      insertKeywordStmt.run(tag);
      const kw = selectKeywordIdStmt.get(tag) as { id: number };
      if (kw) {
        insertTagJunctionStmt.run(id, kw.id);
      }
    }

    insertFtsStmt.run(
      id,
      sanitized.summary,
      sanitized.body,
      sanitized.tags.join(' ')
    );

    return {
      id,
      type: sanitized.type,
      summary: sanitized.summary,
      tags: sanitized.tags,
      createdAt,
    };
  });

  return executeTransaction();
}

export function getActiveTags(
  db: Database.Database,
  limit = 40
): string[] {
  if (limit <= 0) {
    return [];
  }

  // 1. Query tags active within the 60-day rolling window (frequency >= 3)
  const activeRows = db
    .prepare(`
      SELECT k.keyword, COUNT(mt.entry_id) as cnt
      FROM memory_tags mt
      JOIN memory_entries me ON mt.entry_id = me.id
      JOIN keywords k ON mt.keyword_id = k.id
      WHERE me.created_at >= datetime('now', '-60 days')
      GROUP BY k.id, k.keyword
      HAVING COUNT(mt.entry_id) >= 3
      ORDER BY cnt DESC, k.keyword ASC
      LIMIT ?
    `)
    .all(limit) as { keyword: string; cnt: number }[];

  const result: string[] = activeRows.map((r) => r.keyword);

  // 2. If fewer than limit, backfill with all-time popular tags
  if (result.length < limit) {
    const allTimeRows = db
      .prepare(`
        SELECT k.keyword, COUNT(mt.entry_id) as cnt
        FROM memory_tags mt
        JOIN keywords k ON mt.keyword_id = k.id
        GROUP BY k.id, k.keyword
        ORDER BY cnt DESC, k.keyword ASC
      `)
      .all() as { keyword: string; cnt: number }[];

    const seen = new Set(result);
    for (const row of allTimeRows) {
      if (!seen.has(row.keyword)) {
        seen.add(row.keyword);
        result.push(row.keyword);
        if (result.length >= limit) {
          break;
        }
      }
    }
  }

  return result;
}

export function formatFtsQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    return '';
  }

  const matches = query.match(/"([^"]+)"|(\S+)/g);
  if (!matches) {
    return '';
  }

  const tokens: string[] = [];
  for (const match of matches) {
    const raw = match.startsWith('"') && match.endsWith('"')
      ? match.slice(1, -1)
      : match;

    const cleaned = raw.replace(/[^\w\-_/@.]/g, '');
    if (cleaned.length > 0) {
      tokens.push(`"${cleaned}"`);
    }
  }

  return tokens.join(' ');
}

export function searchMemory(
  db: Database.Database,
  options: SearchMemoryOptions
): MemoryIndexCard[] {
  const ftsQuery = formatFtsQuery(options.query);
  if (!ftsQuery) {
    return [];
  }

  const effectiveLimit = Math.max(1, Math.min(15, options.limit ?? 5));

  const rows = db
    .prepare(`
      SELECT
        me.id,
        me.type,
        me.summary,
        me.created_at,
        bm25(memory_fts) as raw_bm25,
        (
          SELECT GROUP_CONCAT(k.keyword, ',')
          FROM memory_tags mt
          JOIN keywords k ON mt.keyword_id = k.id
          WHERE mt.entry_id = me.id
        ) as tags_str
      FROM memory_fts
      JOIN memory_entries me ON memory_fts.entry_id = me.id
      WHERE memory_fts MATCH ?
      ORDER BY bm25(memory_fts) ASC
      LIMIT 30
    `)
    .all(ftsQuery) as {
      id: number;
      type: string;
      summary: string;
      created_at: string;
      raw_bm25: number;
      tags_str: string | null;
    }[];

  const candidates: { card: MemoryIndexCard; rawScore: number }[] = [];

  for (const row of rows) {
    const deltaDays = calculateDeltaDays(row.created_at, options.now);
    const score = calculateFinalScore(
      row.raw_bm25,
      row.type as MemoryType,
      deltaDays,
      options.deep_history
    );
    const tags = row.tags_str ? row.tags_str.split(',') : [];

    candidates.push({
      card: {
        id: row.id,
        type: row.type as MemoryType,
        summary: row.summary,
        tags,
        age_days: Math.round(deltaDays),
        score: Number(score.toFixed(2)),
      },
      rawScore: score,
    });
  }

  candidates.sort((a, b) => b.rawScore - a.rawScore);

  return candidates.slice(0, effectiveLimit).map((c) => c.card);
}

export function getEntryContext(
  db: Database.Database,
  entryId: number
): MemoryEntryContext | null {
  const row = db
    .prepare(`
      SELECT
        me.id,
        me.type,
        me.summary,
        me.body,
        me.created_at,
        (
          SELECT GROUP_CONCAT(k.keyword, ',')
          FROM memory_tags mt
          JOIN keywords k ON mt.keyword_id = k.id
          WHERE mt.entry_id = me.id
        ) as tags_str
      FROM memory_entries me
      WHERE me.id = ?
    `)
    .get(entryId) as
    | {
        id: number;
        type: string;
        summary: string;
        body: string;
        created_at: string;
        tags_str: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    type: row.type as MemoryType,
    summary: row.summary,
    body: row.body,
    tags: row.tags_str ? row.tags_str.split(',') : [],
    created_at: row.created_at,
  };
}


