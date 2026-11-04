import type Database from 'better-sqlite3';
import { searchMemory } from '../db/queries.js';
import type { McpToolDefinition, McpToolResponse } from './types.js';

export const searchMemoryTool: McpToolDefinition = {
  name: 'search_memory',
  description:
    'Executes FTS5 token search and returns compact index cards ranked by decayed relevance.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          "Keywords, code symbols, or natural language query (e.g. 'sqlite wal mode concurrent writes').",
      },
      deep_history: {
        type: 'boolean',
        default: false,
        description:
          'Set to true to disable time-decay and search across all historical entries purely by textual relevance.',
      },
      limit: {
        type: 'number',
        default: 5,
        description: 'Max index cards to return (default: 5, max: 15).',
      },
    },
    required: ['query'],
  },
  handler: (db: Database.Database, args: any): McpToolResponse => {
    try {
      const query = typeof args?.query === 'string' ? args.query : '';
      const deep_history = Boolean(args?.deep_history);
      const limit = typeof args?.limit === 'number' ? args.limit : 5;

      const results = searchMemory(db, {
        query,
        deep_history,
        limit,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Failed to search memory: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
};
