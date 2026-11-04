# Implementation Plan: SQLite Persistent Memory MCP Server (`memo-mcp`)

## Overview
`memo-mcp` is a lightweight, local-first Model Context Protocol (MCP) server providing persistent, cross-agent episodic and architectural memory using pure SQLite in WAL mode. It solves multi-agent context loss without vector database overhead by combining an append-only SQLite log, FTS5 code-safe full-text search (`tokenchars '-_/@'`), in-process exponential time decay scoring with type immunity, and a two-stage retrieval pipeline (index cards → deep context).

## Architecture Decisions
- **Database Engine:** `better-sqlite3` with WAL mode (`PRAGMA journal_mode = WAL`), foreign keys enabled (`PRAGMA foreign_keys = ON`), and `busy_timeout = 5000` to handle multi-agent concurrent writes smoothly.
- **Full-Text Search:** SQLite FTS5 virtual table (`memory_fts`) with unicode61 tokenizer configured with `tokenchars '-_/@'` to preserve code symbols, file paths (`src/utils/auth.ts`), and package names (`@modelcontextprotocol/sdk`).
- **Scoring Pipeline:** Two-stage retrieval. Stage 1 searches FTS5 BM25, applies time-decay scoring in-process in TypeScript, and returns compact preview index cards. Stage 2 fetches the full Markdown body by ID on demand to preserve agent token budgets.
- **Decay Rule:** Entries of type `decision` and `architecture` have permanent immunity ($T_{\text{half}} = \infty$). Entries of type `bugfix` and `note` decay with a 30-day half-life: $\text{score} = -\text{bm25} \times (0.5)^{\Delta t / 30}$. Flag `deep_history: true` disables decay entirely.
- **Tag Management & Fallback Ingestion:** Non-hierarchical tag junction (`keywords` and `memory_tags`). Top 40 tags exposed via MCP Resource `memo://tags/popular` and fallback tool `get_active_tags` using a 60-day rolling window ($\ge 3$ occurrences) with all-time backfill. Soft-validation coerces malformed types to `note` and sanitizes tags (lowercase, trim, symbol removal, max 6).
- **Transport:** Standard MCP SDK `@modelcontextprotocol/sdk` using `StdioServerTransport` for compatibility with Claude Code, Cursor, and other agent hosts.

---

## Detailed Task Breakdown

### Phase 1: Foundation & Project Setup

#### Task 1: Project Initialization & TypeScript Configuration
**Description:** Initialize `package.json`, TypeScript configuration (`tsconfig.json`), and testing framework (Vitest). Install dependencies including `@modelcontextprotocol/sdk`, `better-sqlite3`, and dev dependencies (`typescript`, `@types/node`, `@types/better-sqlite3`, `vitest`).

**Acceptance criteria:**
- [ ] `package.json` contains valid scripts for `build`, `test`, `start`, and dependencies for `@modelcontextprotocol/sdk` and `better-sqlite3`.
- [ ] `tsconfig.json` configured for Node.js ESM/CJS build targeting ES2022+ with strict typing.
- [ ] Test harness passes a basic smoke test.

**Verification:**
- [ ] Tests pass: `npm test`
- [ ] Build succeeds: `npm run build`

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`

**Estimated scope:** Small (3 files)

---

#### Task 2: SQLite Client & Schema Initialization
**Description:** Define the SQLite schema in `src/db/schema.sql` including `memory_entries`, `keywords`, `memory_tags`, and virtual table `memory_fts` with FTS5 tokenchars. Implement `src/db/client.ts` to establish database connection with WAL mode, foreign keys, and busy timeout, and auto-run schema migrations.

**Acceptance criteria:**
- [ ] `src/db/schema.sql` creates all tables and virtual table with `unicode61 tokenchars '-_/@'`.
- [ ] `src/db/client.ts` initializes SQLite in WAL mode with `busy_timeout = 5000` and `foreign_keys = ON`.
- [ ] Database connection initializes schema without errors in both persistent file and `:memory:` mode for tests.

**Verification:**
- [ ] Tests pass: `npm test -- tests/db.test.ts`
- [ ] Manual check: verify table creation and pragmas with an in-memory SQLite instance.

**Dependencies:** Task 1

**Files likely touched:**
- `src/db/schema.sql`
- `src/db/client.ts`
- `tests/db.test.ts`

**Estimated scope:** Small (3 files)

---

### Checkpoint: Foundation
- [ ] Database initializes in memory and file without errors.
- [ ] Pragmas (`journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`) verified.
- [ ] All foundational tests pass and TypeScript compiles cleanly.

---

### Phase 2: Ingestion & Math Scoring Engines

#### Task 3: Tag Normalization & Soft-Validation Ingestion Engine
**Description:** Implement `src/engine/sanitize.ts` to provide soft-validation for memory append payloads. Validate and coerce entry types (fallback to `'note'` for missing or unrecognized values), sanitize summary and body, and normalize tags (lowercase, trim whitespace, remove invalid symbols, cap at 6 tags).

**Acceptance criteria:**
- [ ] Invalid or missing `type` coerces to `'note'`.
- [ ] Tags are sanitized: converted to lowercase, trimmed, special punctuation stripped, duplicates removed, and truncated to max 6 tags.
- [ ] Empty strings or missing bodies/summaries are safely defaulted or coerced without throwing fatal exceptions.

**Verification:**
- [ ] Tests pass: `npm test -- tests/sanitize.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/engine/sanitize.ts`
- `tests/sanitize.test.ts`

**Estimated scope:** Small (2 files)

---

#### Task 4: Exponential Time-Decay Scoring Engine
**Description:** Implement `src/engine/decay.ts` calculating raw BM25 relevance ($\text{Relevance}_{\text{raw}} = -1 \times \text{bm25}$) and time-decay multipliers based on delta time in days ($\Delta t_{\text{days}} = (\text{now} - \text{created\_at}) / 86400000$). Support permanent immunity for `decision` and `architecture`, 30-day half-life decay for `bugfix` and `note`, and bypass decay when `deep_history: true`.

**Acceptance criteria:**
- [ ] Correctly calculates $\Delta t_{\text{days}}$ from ISO timestamps.
- [ ] Multiplier is $1.0$ for `decision` and `architecture` regardless of age.
- [ ] Multiplier follows $(0.5)^{(\Delta t / 30)}$ for `bugfix` and `note` when `deep_history` is false.
- [ ] Multiplier is $1.0$ when `deep_history: true` for all entry types.
- [ ] Multiplies raw BM25 relevance by the decay multiplier to yield final float score.

**Verification:**
- [ ] Tests pass: `npm test -- tests/decay.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/engine/decay.ts`
- `tests/decay.test.ts`

**Estimated scope:** Small (2 files)

---

### Checkpoint: Ingestion & Scoring Engines
- [ ] Unit tests for sanitization and soft-validation pass with 100% coverage on edge cases.
- [ ] Time-decay formulas verified against mathematical expectations across diverse ages and entry types.

---

### Phase 3: Data Access Layer & FTS5 Query Pipeline

#### Task 5: Memory Append Transaction
**Description:** Implement data access function `insertMemoryEntry` in `src/db/queries.ts`. Execute within a SQLite transaction: insert into `memory_entries`, upsert into `keywords`, insert junction rows into `memory_tags`, and insert text terms into `memory_fts`.

**Acceptance criteria:**
- [ ] Inserts into `memory_entries` and returns the newly generated ID.
- [ ] Normalizes tags into `keywords` table without duplication.
- [ ] Populates `memory_tags` junction table.
- [ ] Synchronously indexes `summary`, `body`, and space-separated tags into `memory_fts`.
- [ ] Executed within an atomic transaction (`db.transaction`).

**Verification:**
- [ ] Tests pass: `npm test -- tests/append.test.ts`

**Dependencies:** Tasks 2, 3

**Files likely touched:**
- `src/db/queries.ts`
- `tests/append.test.ts`

**Estimated scope:** Small (2 files)

---

#### Task 6: Tag Seeding & Dynamic Top Active Tags Query
**Description:** Implement `getActiveTags` query in `src/db/queries.ts`. Calculate top 40 candidate tags using a 60-day rolling window with frequency $\ge 3$, backfilled by all-time popular tags to ensure up to 40 tags are returned.

**Acceptance criteria:**
- [ ] Selects tags with $\ge 3$ usages in the past 60 days.
- [ ] Backfills with highest frequency all-time tags if fewer than 40 tags qualify in the rolling window.
- [ ] Returns at most 40 distinct lowercase tags ordered by frequency.

**Verification:**
- [ ] Tests pass: `npm test -- tests/tags.test.ts`

**Dependencies:** Task 5

**Files likely touched:**
- `src/db/queries.ts`
- `tests/tags.test.ts`

**Estimated scope:** Small (2 files)

---

#### Task 7: FTS5 Search & Context Retrieval Pipeline
**Description:** Implement `searchMemory` and `getEntryContext` in `src/db/queries.ts`. `searchMemory` queries `memory_fts` matching query terms using FTS5 `bm25(memory_fts)`, joins `memory_entries` and tags, applies in-process decay scoring from Task 4, and returns top $N$ compact index cards (`id`, `type`, `summary`, `tags`, `age_days`, `score`). `getEntryContext` fetches full entry details (including `body`).

**Acceptance criteria:**
- [ ] `searchMemory` executes code-safe FTS5 queries (matching terms like `@modelcontextprotocol/sdk` and `src/utils/auth.ts`).
- [ ] Ranks results using decay-adjusted score when `deep_history: false`, and pure BM25 when `deep_history: true`.
- [ ] Returns index cards formatted with `id`, `type`, `summary`, `tags`, `age_days`, and `score`.
- [ ] `getEntryContext` retrieves complete markdown body, type, summary, tags, and timestamps for given `entry_id`.

**Verification:**
- [ ] Tests pass: `npm test -- tests/fts.test.ts`

**Dependencies:** Tasks 4, 5

**Files likely touched:**
- `src/db/queries.ts`
- `tests/fts.test.ts`

**Estimated scope:** Medium (2 files)

---

### Checkpoint: Data Access Layer
- [ ] Full end-to-end SQLite integration tests pass: append entries, query active tags, run code-safe FTS queries, and retrieve full entry context.
- [ ] FTS5 tokenizer behavior verified for symbols with hyphens, underscores, slashes, and `@`.

---

### Phase 4: MCP Protocol & Tools Integration

#### Task 8: MCP Tool Handlers Implementation
**Description:** Implement tool handler modules in `src/tools/` for `append_memory` (`append.ts`), `search_memory` (`search.ts`), `get_entry_context` (`context.ts`), and `get_active_tags` (`tags.ts`) matching the tool input schemas and return contracts in `info.md`.

**Acceptance criteria:**
- [ ] `append_memory` validates inputs softly, calls sanitization and insert transaction, and returns created entry ID and status.
- [ ] `search_memory` validates `query`, `deep_history`, `limit` (default 5, max 15), and returns JSON array of preview index cards.
- [ ] `get_entry_context` fetches full entry or returns a clean not-found error for invalid IDs.
- [ ] `get_active_tags` returns list of active tags.

**Verification:**
- [ ] Tests pass: `npm test -- tests/tools.test.ts`

**Dependencies:** Tasks 6, 7

**Files likely touched:**
- `src/tools/append.ts`
- `src/tools/search.ts`
- `src/tools/context.ts`
- `src/tools/tags.ts`
- `tests/tools.test.ts`

**Estimated scope:** Medium (5 files)

---

#### Task 9: Server Entrypoint & MCP Stdio Transport
**Description:** Implement `src/index.ts` initializing the `Server` from `@modelcontextprotocol/sdk/server/index.js` and connecting via `StdioServerTransport`. Register the tool list, tool execution handlers, and the `memo://tags/popular` resource handler (`text/plain` newline-delimited tags).

**Acceptance criteria:**
- [ ] MCP Server initializes with server name `memo-mcp` and semantic version.
- [ ] Exposes resource `memo://tags/popular` delivering newline-delimited tags.
- [ ] Registers `append_memory`, `search_memory`, `get_entry_context`, and `get_active_tags` tools with JSON Schema definitions.
- [ ] Connects cleanly over stdio transport.

**Verification:**
- [ ] Tests pass: `npm test -- tests/server.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: execute binary / script with stdio ping or MCP inspector.

**Dependencies:** Task 8

**Files likely touched:**
- `src/index.ts`
- `tests/server.test.ts`

**Estimated scope:** Small (2 files)

---

### Checkpoint: MCP Protocol Integration
- [ ] MCP server starts up and responds to protocol requests (`ListTools`, `CallTool`, `ListResources`, `ReadResource`).
- [ ] All four tools and the resource return expected data over MCP transport.

---

### Phase 5: Documentation & Agent Protocol

#### Task 10: AGENTS.md, Documentation & CLI Configuration
**Description:** Create `AGENTS.md` containing the agent instructions protocol specified in `info.md`, complete `README.md` with usage instructions, setup guide, and configuration examples for Claude Code / Cursor. Add executable shebang and bin definition in `package.json` for direct `npx` execution.

**Acceptance criteria:**
- [ ] `AGENTS.md` matches Section 7 of `info.md`.
- [ ] `README.md` documents setup, schema, tool specifications, decay math, and MCP client config.
- [ ] `package.json` contains `bin` entrypoint for `memo-mcp`.

**Verification:**
- [ ] Build succeeds: `npm run build`
- [ ] CLI runs: `node dist/index.js --help` or starts cleanly without error.

**Dependencies:** Task 9

**Files likely touched:**
- `AGENTS.md`
- `README.md`
- `package.json`

**Estimated scope:** Small (3 files)

---

### Checkpoint: Complete
- [ ] All tasks completed.
- [ ] 100% of test suites pass (`npm test`).
- [ ] TypeScript build succeeds (`npm run build`).
- [ ] Ready for review and deployment.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Multi-agent concurrent write locks on SQLite | High | Enable WAL mode (`PRAGMA journal_mode = WAL`) and configure `busy_timeout = 5000` so queries wait up to 5s before failing with SQLITE_BUSY. |
| FTS5 tokenizing code paths and package names | High | Use `tokenize = "unicode61 tokenchars '-_/@'"` so `@scope/pkg` and `path/to/file` remain intact tokens. |
| Stale entries dominating prompt context | Medium | In-process exponential decay with a 30-day half-life for notes/bugfixes, while decisions/architecture have permanent immunity. |
| Agent sending malformed tool inputs | Medium | Soft validation engine coerces invalid types to `'note'` and sanitizes tags instead of crashing or rejecting the append. |
| Prompt token bloat from large memory records | Medium | Two-stage retrieval: `search_memory` returns compact index cards (~50 tokens each); agents fetch full details only for relevant entries via `get_entry_context`. |

---

## Open Questions
- None. Requirements, schemas, decay formulas, and tool interfaces are fully specified in `info.md`.
