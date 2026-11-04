import type Database from 'better-sqlite3';
import { appendMemoryTool } from './append.js';
import { searchMemoryTool } from './search.js';
import { getContextTool } from './context.js';
import { getTagsTool } from './tags.js';
import type { McpToolDefinition, McpToolResponse } from './types.js';

export * from './types.js';
export { appendMemoryTool } from './append.js';
export { searchMemoryTool } from './search.js';
export { getContextTool } from './context.js';
export { getTagsTool } from './tags.js';

export const ALL_TOOLS: McpToolDefinition[] = [
  appendMemoryTool,
  searchMemoryTool,
  getContextTool,
  getTagsTool,
];

export async function handleToolCall(
  db: Database.Database,
  toolName: string,
  args: any
): Promise<McpToolResponse> {
  const tool = ALL_TOOLS.find((t) => t.name === toolName);
  if (!tool) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Unknown tool: '${toolName}'. Supported tools: ${ALL_TOOLS.map((t) => t.name).join(', ')}`,
        },
      ],
    };
  }

  return tool.handler(db, args);
}
