import type Database from 'better-sqlite3';
import { getEntryContext } from '../db/queries.js';
import type { McpToolDefinition, McpToolResponse } from './types.js';

export const getContextTool: McpToolDefinition = {
  name: 'get_entry_context',
  description:
    'Retrieves the complete narrative and code snippets for a specific entry ID.',
  inputSchema: {
    type: 'object',
    properties: {
      entry_id: {
        type: 'number',
        description: 'The target entry ID obtained from search_memory.',
      },
    },
    required: ['entry_id'],
  },
  handler: (db: Database.Database, args: any): McpToolResponse => {
    const entryId = args?.entry_id;
    if (typeof entryId !== 'number' || Number.isNaN(entryId)) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Invalid or missing entry_id parameter. Must be a valid integer.',
          },
        ],
      };
    }

    try {
      const context = getEntryContext(db, entryId);
      if (!context) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Memory entry ${entryId} not found.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(context, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Failed to retrieve entry context: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
};
