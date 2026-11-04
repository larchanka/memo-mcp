import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDb } from '../src/db/client.js';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from '../src/index.js';

describe('MCP Server Entrypoint & Transport Integration', () => {
  let db: Database.Database;
  let client: Client;

  beforeEach(async () => {
    db = createDb(':memory:');
    const server = createMcpServer(db);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client(
      { name: 'test-mcp-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    db.close();
  });

  it('exposes correct server metadata constants', () => {
    expect(SERVER_NAME).toBe('memo-mcp');
    expect(SERVER_VERSION).toBe('0.1.0');
  });

  it('lists all 4 registered tools via MCP ListTools protocol', async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(4);

    const names = result.tools.map((t) => t.name);
    expect(names).toEqual([
      'append_memory',
      'search_memory',
      'get_entry_context',
      'get_active_tags',
    ]);

    for (const tool of result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('executes append_memory, search_memory, and get_entry_context over MCP CallTool protocol', async () => {
    // 1. Call append_memory
    const appendRes = (await client.callTool({
      name: 'append_memory',
      arguments: {
        type: 'decision',
        summary: 'Adopted pure SQLite WAL mode',
        tags: ['sqlite', 'wal'],
        body: 'Zero vector database overhead with code-safe FTS5.',
      },
    })) as any;

    expect(appendRes.isError).toBeFalsy();
    const created = JSON.parse(appendRes.content[0].text);
    expect(created.id).toBeGreaterThan(0);
    expect(created.summary).toBe('Adopted pure SQLite WAL mode');

    // 2. Call search_memory
    const searchRes = (await client.callTool({
      name: 'search_memory',
      arguments: {
        query: 'SQLite WAL mode',
      },
    })) as any;

    expect(searchRes.isError).toBeFalsy();
    const searchCards = JSON.parse(searchRes.content[0].text);
    expect(searchCards).toHaveLength(1);
    expect(searchCards[0].id).toBe(created.id);
    expect(searchCards[0].type).toBe('decision');

    // 3. Call get_entry_context
    const contextRes = (await client.callTool({
      name: 'get_entry_context',
      arguments: {
        entry_id: created.id,
      },
    })) as any;

    expect(contextRes.isError).toBeFalsy();
    const fullContext = JSON.parse(contextRes.content[0].text);
    expect(fullContext.id).toBe(created.id);
    expect(fullContext.body).toContain('Zero vector database overhead');
    expect(fullContext.tags).toEqual(['sqlite', 'wal']);
  });

  it('lists the popular tags resource with text/plain mimeType', async () => {
    const result = await client.listResources();
    expect(result.resources).toHaveLength(1);

    const resource = result.resources[0];
    expect(resource.uri).toBe('memo://tags/popular');
    expect(resource.mimeType).toBe('text/plain');
    expect(resource.name).toBe('Popular Tags');
  });

  it('reads memo://tags/popular returning newline-delimited tags', async () => {
    // Seed tags
    for (let i = 0; i < 3; i++) {
      await client.callTool({
        name: 'append_memory',
        arguments: {
          summary: `Note ${i}`,
          tags: ['architecture', 'concurrency'],
          body: 'Content',
        },
      });
    }

    const readRes = await client.readResource({
      uri: 'memo://tags/popular',
    });

    expect(readRes.contents).toHaveLength(1);
    const content = readRes.contents[0];
    expect(content.uri).toBe('memo://tags/popular');
    expect(content.mimeType).toBe('text/plain');

    const lines = (content.text as string).split('\n');
    expect(lines).toContain('architecture');
    expect(lines).toContain('concurrency');
  });

  it('rejects unknown resource URIs with an error', async () => {
    await expect(
      client.readResource({
        uri: 'memo://unknown/resource',
      })
    ).rejects.toThrow();
  });
});
