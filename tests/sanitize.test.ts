import { describe, it, expect } from 'vitest';
import {
  sanitizeMemoryType,
  sanitizeTags,
  sanitizeMemoryInput,
  type MemoryType,
} from '../src/engine/sanitize.js';

describe('Sanitize and Soft-Validation Ingestion Engine', () => {
  describe('sanitizeMemoryType', () => {
    it('preserves valid memory types', () => {
      expect(sanitizeMemoryType('decision')).toBe('decision');
      expect(sanitizeMemoryType('architecture')).toBe('architecture');
      expect(sanitizeMemoryType('bugfix')).toBe('bugfix');
      expect(sanitizeMemoryType('note')).toBe('note');
    });

    it('handles uppercase or whitespace in valid memory types', () => {
      expect(sanitizeMemoryType(' DECISION ')).toBe('decision');
      expect(sanitizeMemoryType('Architecture')).toBe('architecture');
      expect(sanitizeMemoryType('BUGFIX')).toBe('bugfix');
    });

    it('coerces invalid or unknown types to "note"', () => {
      expect(sanitizeMemoryType('feature')).toBe('note');
      expect(sanitizeMemoryType('todo')).toBe('note');
      expect(sanitizeMemoryType('')).toBe('note');
      expect(sanitizeMemoryType(null)).toBe('note');
      expect(sanitizeMemoryType(undefined)).toBe('note');
      expect(sanitizeMemoryType(123)).toBe('note');
      expect(sanitizeMemoryType({})).toBe('note');
    });
  });

  describe('sanitizeTags', () => {
    it('lowercases and trims tags', () => {
      const input = [' TypeScript ', 'NODEJS '];
      expect(sanitizeTags(input)).toEqual(['typescript', 'nodejs']);
    });

    it('preserves code symbols (-_/@) and strips invalid punctuation', () => {
      const input = [
        '#@modelcontextprotocol/sdk!',
        'src/utils/auth',
        'better-sqlite3',
        'node_next',
        'weird$?*tag',
      ];
      expect(sanitizeTags(input)).toEqual([
        '@modelcontextprotocol/sdk',
        'src/utils/auth',
        'better-sqlite3',
        'node_next',
        'weirdtag',
      ]);
    });

    it('deduplicates tags while maintaining order', () => {
      const input = ['sqlite', 'wal', 'SQLITE', 'wal', 'concurrency'];
      expect(sanitizeTags(input)).toEqual(['sqlite', 'wal', 'concurrency']);
    });

    it('removes empty tags after punctuation stripping', () => {
      const input = ['!!!', '   ', 'valid', '***'];
      expect(sanitizeTags(input)).toEqual(['valid']);
    });

    it('caps tags to a maximum of 6 tags', () => {
      const input = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7', 'tag8'];
      const result = sanitizeTags(input);
      expect(result).toHaveLength(6);
      expect(result).toEqual(['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6']);
    });

    it('handles comma-separated string input gracefully', () => {
      expect(sanitizeTags('sqlite, wal, concurrency')).toEqual([
        'sqlite',
        'wal',
        'concurrency',
      ]);
    });

    it('handles non-array, null, or undefined inputs gracefully', () => {
      expect(sanitizeTags(null)).toEqual([]);
      expect(sanitizeTags(undefined)).toEqual([]);
      expect(sanitizeTags(123)).toEqual([]);
      expect(sanitizeTags({})).toEqual([]);
    });
  });

  describe('sanitizeMemoryInput', () => {
    it('sanitizes a well-formed input object', () => {
      const raw = {
        type: 'decision',
        summary: 'Use SQLite WAL mode',
        body: 'Details about concurrency and performance',
        tags: ['sqlite', 'wal'],
      };

      const result = sanitizeMemoryInput(raw);
      expect(result).toEqual({
        type: 'decision',
        summary: 'Use SQLite WAL mode',
        body: 'Details about concurrency and performance',
        tags: ['sqlite', 'wal'],
      });
    });

    it('soft-validates and coerces malformed inputs safely', () => {
      const raw = {
        type: 'invalid_type',
        summary: '   ',
        body: null,
        tags: ['#tag1!', 'tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'],
      };

      const result = sanitizeMemoryInput(raw);
      expect(result.type).toBe('note');
      expect(result.summary).toBe('(No summary provided)');
      expect(result.body).toBe('');
      expect(result.tags).toHaveLength(6);
      expect(result.tags[0]).toBe('tag1');
    });

    it('handles non-object inputs safely', () => {
      expect(sanitizeMemoryInput(null)).toEqual({
        type: 'note',
        summary: '(No summary provided)',
        body: '',
        tags: [],
      });

      expect(sanitizeMemoryInput('some random string')).toEqual({
        type: 'note',
        summary: 'some random string',
        body: '',
        tags: [],
      });
    });
  });
});
