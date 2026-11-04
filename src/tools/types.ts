import type Database from 'better-sqlite3';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type McpToolResponse = CallToolResult;

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (db: Database.Database, args: any) => Promise<CallToolResult> | CallToolResult;
}
