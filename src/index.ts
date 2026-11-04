#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import type Database from 'better-sqlite3';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { createDb } from './db/client.js';
import { getActiveTags } from './db/queries.js';
import { ALL_TOOLS, handleToolCall } from './tools/index.js';

export const SERVER_NAME = 'memo-mcp';
export const SERVER_VERSION = '0.1.0';
export const POPULAR_TAGS_RESOURCE_URI = 'memo://tags/popular';

export function createMcpServer(db: Database.Database): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Tools registration
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(db, name, args ?? {});
  });

  // Resources registration
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: POPULAR_TAGS_RESOURCE_URI,
          name: 'Popular Tags',
          description:
            'Newline-delimited list of active memory tags calculated using a 60-day rolling window + all-time backfill.',
          mimeType: 'text/plain',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri !== POPULAR_TAGS_RESOURCE_URI) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unknown resource URI: '${uri}'. Supported resource: '${POPULAR_TAGS_RESOURCE_URI}'`
      );
    }

    const tags = getActiveTags(db, 40);
    return {
      contents: [
        {
          uri: POPULAR_TAGS_RESOURCE_URI,
          mimeType: 'text/plain',
          text: tags.join('\n'),
        },
      ],
    };
  });

  return server;
}

export async function startServer(dbPath?: string): Promise<void> {
  const db = createDb(dbPath);
  const server = createMcpServer(db);
  const transport = new StdioServerTransport();

  const shutdown = () => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
  process.stderr.write(`[memo-mcp] Server running on stdio transport (db: ${db.name})\n`);
}

// Auto-start when executed as the CLI entrypoint
const isDirectExecution =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  startServer().catch((error) => {
    process.stderr.write(
      `[memo-mcp] Fatal error: ${error instanceof Error ? error.stack : String(error)}\n`
    );
    process.exit(1);
  });
}
