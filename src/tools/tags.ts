import type Database from 'better-sqlite3';
import { getActiveTags } from '../db/queries.js';
import type { McpToolDefinition, McpToolResponse } from './types.js';

export const getTagsTool: McpToolDefinition = {
  name: 'get_active_tags',
  description:
    'Returns the top 40 active tags directly for clients that do not support dynamic MCP Resource inspection.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        default: 40,
        description: 'Maximum number of active tags to return.',
      },
    },
  },
  handler: (db: Database.Database, args: any): McpToolResponse => {
    try {
      const limit = typeof args?.limit === 'number' ? args.limit : 40;
      const tags = getActiveTags(db, limit);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(tags, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Failed to retrieve active tags: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
};
