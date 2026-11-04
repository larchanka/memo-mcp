import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createDb } from '../src/db/client.js';
import {
  appendMemoryTool,
  searchMemoryTool,
  getContextTool,
  getTagsTool,
  handleToolCall,
  ALL_TOOLS,
} from '../src/tools/index.js';

describe('MCP Tool Handlers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('Tool Definitions', () => {
    it('exposes valid MCP tool definitions for all 4 tools', () => {
      expect(ALL_TOOLS).toHaveLength(4);

      const toolNames = ALL_TOOLS.map((t) => t.name);
      expect(toolNames).toContain('append_memory');
      expect(toolNames).toContain('search_memory');
      expect(toolNames).toContain('get_entry_context');
      expect(toolNames).toContain('get_active_tags');

      for (const tool of ALL_TOOLS) {
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    it('has correct input schemas matching info.md specifications', () => {
      expect(appendMemoryTool.inputSchema.required).toEqual(['summary', 'tags', 'body']);
      expect(searchMemoryTool.inputSchema.required).toEqual(['query']);
      expect(getContextTool.inputSchema.required).toEqual(['entry_id']);
    });
  });

  describe('append_memory handler', () => {
    it('appends a valid memory entry and returns structured success response', async () => {
      const response = await appendMemoryTool.handler(db, {
        type: 'decision',
        summary: 'Adopted WAL Mode',
        tags: ['sqlite', 'wal'],
        body: 'Improves write concurrency.',
      });

      expect(response.isError).toBeFalsy();
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.id).toBeGreaterThan(0);
      expect(parsed.type).toBe('decision');
      expect(parsed.summary).toBe('Adopted WAL Mode');
      expect(parsed.tags).toEqual(['sqlite', 'wal']);
    });

    it('soft-validates malformed or missing parameters without throwing', async () => {
      const response = await appendMemoryTool.handler(db, {
        type: 'unsupported_type',
        summary: '',
        tags: null,
      });

      expect(response.isError).toBeFalsy();
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.type).toBe('note');
      expect(parsed.summary).toBe('(No summary provided)');
      expect(parsed.tags).toEqual([]);
    });
  });

  describe('search_memory handler', () => {
    it('returns empty array formatted as JSON when no matches found', async () => {
      const response = await searchMemoryTool.handler(db, {
        query: 'nonexistent',
      });

      expect(response.isError).toBeFalsy();
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed).toEqual([]);
    });

    it('returns ranked index cards matching query', async () => {
      await appendMemoryTool.handler(db, {
        type: 'architecture',
        summary: 'Setup SQLite persistent memory bus',
        tags: ['sqlite', 'mcp'],
        body: 'Details on FTS5 and WAL mode.',
      });

      const response = await searchMemoryTool.handler(db, {
        query: 'persistent memory',
      });

      expect(response.isError).toBeFalsy();
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('architecture');
      expect(parsed[0].summary).toBe('Setup SQLite persistent memory bus');
      expect(parsed[0].tags).toEqual(['sqlite', 'mcp']);
      expect(parsed[0].score).toBeDefined();
      expect(parsed[0].age_days).toBeDefined();
    });

    it('supports deep_history and custom limit', async () => {
      for (let i = 1; i <= 10; i++) {
        await appendMemoryTool.handler(db, {
          summary: `Entry ${i} for testing limit`,
          tags: ['test'],
          body: 'Test body',
        });
      }

      const response = await searchMemoryTool.handler(db, {
        query: 'testing limit',
        limit: 3,
        deep_history: true,
      });

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed).toHaveLength(3);
    });
  });

  describe('get_entry_context handler', () => {
    it('returns complete entry context for existing entry ID', async () => {
      const appendRes = await appendMemoryTool.handler(db, {
        type: 'decision',
        summary: 'Decided on WAL mode',
        tags: ['sqlite', 'wal'],
        body: 'Full markdown body text with ```sql PRAGMA journal_mode = WAL; ```',
      });
      const { id } = JSON.parse(appendRes.content[0].text);

      const response = await getContextTool.handler(db, {
        entry_id: id,
      });

      expect(response.isError).toBeFalsy();
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.id).toBe(id);
      expect(parsed.type).toBe('decision');
      expect(parsed.summary).toBe('Decided on WAL mode');
      expect(parsed.body).toContain('PRAGMA journal_mode = WAL;');
      expect(parsed.tags).toEqual(['sqlite', 'wal']);
    });

    it('returns isError: true when entry ID does not exist', async () => {
      const response = await getContextTool.handler(db, {
        entry_id: 999999,
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('not found');
    });

    it('returns isError: true when entry_id is missing or invalid', async () => {
      const response = await getContextTool.handler(db, {});
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Invalid or missing entry_id');
    });
  });

  describe('get_active_tags handler', () => {
    it('returns JSON array of active tags', async () => {
      for (let i = 0; i < 3; i++) {
        await appendMemoryTool.handler(db, {
          summary: `Entry ${i}`,
          tags: ['active-tag', 'sqlite'],
          body: 'Body',
        });
      }

      const response = await getTagsTool.handler(db, { limit: 10 });
      expect(response.isError).toBeFalsy();
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed).toContain('active-tag');
      expect(parsed).toContain('sqlite');
    });
  });

  describe('handleToolCall dispatcher', () => {
    it('dispatches known tools correctly and returns error for unknown tool', async () => {
      const response = await handleToolCall(db, 'get_active_tags', {});
      expect(response.isError).toBeFalsy();

      const unknownRes = await handleToolCall(db, 'unknown_tool', {});
      expect(unknownRes.isError).toBe(true);
      expect(unknownRes.content[0].text).toContain('Unknown tool');
    });
  });
});
