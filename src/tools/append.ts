import type Database from 'better-sqlite3';
import { insertMemoryEntry } from '../db/queries.js';
import type { McpToolDefinition, McpToolResponse } from './types.js';

export const appendMemoryTool: McpToolDefinition = {
  name: 'append_memory',
  description:
    "Appends an atomic milestone, bugfix, or architectural decision to the persistent store.",
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['decision', 'architecture', 'bugfix', 'note'],
        description:
          "Category. 'decision' and 'architecture' never decay. 'bugfix' and 'note' decay with a 30-day half-life.",
      },
      summary: {
        type: 'string',
        description:
          'A crisp, 1-2 sentence preview card describing the insight or change.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description:
          "Normalized lowercase tags (e.g. ['sqlite', 'wal', 'auth']). Max 6 tags.",
      },
      body: {
        type: 'string',
        description:
          'Detailed Markdown narrative: problem context, trade-offs, code diffs, or instructions.',
      },
    },
    required: ['summary', 'tags', 'body'],
  },
  handler: (db: Database.Database, args: any): McpToolResponse => {
    try {
      const result = insertMemoryEntry(db, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Failed to append memory: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
};
