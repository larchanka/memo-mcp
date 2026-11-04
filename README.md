# SQLite Persistent Memory MCP Server (`memo-mcp`)

A lightweight, local-first Model Context Protocol (MCP) server providing persistent, cross-agent episodic and architectural memory using pure SQLite in WAL mode.

---

## 1. Problem & Architecture Overview

When running multiple AI coding agents (Claude Code, Cursor, OpenCode, Codex), shared context between sessions is lost. Dumping conversations into raw vector databases introduces high hallucination risk, token bloat, and poor token-level symbol matching.

`memo-mcp` provides an append-only, structured memory bus backed by **SQLite FTS5** and **in-process exponential time-decay scoring**.

```
┌─────────────────────────────────────────────────────────────┐
│                       Host Clients                          │
│               (Cursor / Claude Code / OpenCode)             │
└───────────────┬─────────────────────────────▲───────────────┘
                │                             │
 (1) Seed Tags: │ readResource()              │ (2) Read: search_memory()
     top 40     │                             │           get_entry_context()
                ▼                             │
┌─────────────────────────────────────────────┴───────────────┐
│                      Node.js MCP Server                     │
│                                                             │
│  • Memory Append:                                           │
│    - Soft validation (coerces bad formats to 'note')        │
│    - Auto-sanitizes tags (lowercase, trim, symbol removal)  │
│                                                             │
│  • Two-Stage Retrieval Pipeline:                            │
│    - FTS5 BM25 raw match (top 30 candidates)                │
│    - If deep_history == false:                              │
│        decay = ('decision' | 'architecture') ? 1.0          │
│                : (0.5) ^ (Δt_days / 30)                     │
│        score = -bm25 * decay                                │
│    - If deep_history == true:                               │
│        score = -bm25 (pure BM25, no age penalty)            │
│    - Stage 1: Returns lightweight Index Cards (top N)       │
│    - Stage 2: Deep fetch full Markdown narrative by ID      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    SQLite Database (WAL)                    │
│                                                             │
│  TABLE memory_entries (id, type, summary, body, ...)        │
│  TABLE keywords (id, keyword UNIQUE)                        │
│  TABLE memory_tags (entry_id, keyword_id)                   │
│  VIRTUAL TABLE memory_fts USING fts5(...)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Core Design Principles

1. **Flat, Non-Hierarchical Tags with Dynamic Seeding:**
   No rigid directory paths or project silos. The server dynamically extracts the **top 40 active tags** (frequency $\ge 3$ within the last 60 days, backfilled by all-time popular tags) and exposes them via MCP resources/tools to prevent vocabulary fragmentation across agents.
2. **Append-Only Rolling Log:**
   Entries are immutable records of decisions, discoveries, and fixes. Eliminates chunk-invalidation race conditions and mutation deadlocks.
3. **Type-Aware Exponential Decay & Deep Search Toggle:**
   Recent notes rank higher, preventing stale solutions from crowding the prompt context.
   - `decision` and `architecture` entries are **permanently immune** to decay ($T_{\text{half}} = \infty$).
   - `bugfix` and `note` decay with a **30-day half-life**.
   - Setting `deep_history: true` completely disables decay on demand for historical retrospectives.
4. **Two-Stage Retrieval (Token Budget Protection):**
   - **Stage 1 (`search_memory`):** Returns compact preview cards (`id`, `type`, `summary`, `tags`, `age_days`, `score`).
   - **Stage 2 (`get_entry_context`):** The agent fetches the full Markdown body, rationale, and code snippets only for entries deemed strictly relevant.
5. **Code-Safe FTS5 Tokenizer (`tokenchars '-_/@'`):**
   Tokens like `@modelcontextprotocol/sdk`, `src/utils/auth.ts`, and `better-sqlite3` remain indexed as unified terms rather than fragmented into useless single words. Periods (`.`) remain standard delimiters to prevent sentence endings from corrupting token vocabulary.
6. **Soft-Validation Ingestion:**
   Malformed agent inputs (missing required fields, invalid types) are automatically coerced into a fallback `type: "note"` rather than throwing fatal validation errors and losing context.

---

## 3. Database Schema

The database uses `better-sqlite3` in WAL mode with foreign keys and busy timeout:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- 1. Main append-only storage
CREATE TABLE IF NOT EXISTS memory_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('decision', 'architecture', 'bugfix', 'note')),
    summary TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Normalized keywords catalog
CREATE TABLE IF NOT EXISTS keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT UNIQUE NOT NULL
);

-- 3. Many-to-many junction
CREATE TABLE IF NOT EXISTS memory_tags (
    entry_id INTEGER NOT NULL,
    keyword_id INTEGER NOT NULL,
    PRIMARY KEY (entry_id, keyword_id),
    FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
);

-- 4. Full-Text Search index with code-safe tokenchars
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    entry_id UNINDEXED,
    summary,
    body,
    tags,
    tokenize = "unicode61 tokenchars '-_/@'"
);
```

---

## 4. Mathematical Scoring Function

In SQLite FTS5, the internal `bm25()` function returns a negative float, where values closer to $-\infty$ indicate higher term match quality:

$$\text{Relevance}_{\text{raw}} = -1 \times \text{bm25}$$

### Time Decay Calculation

$$\Delta t_{\text{days}} = \frac{\text{now} - \text{created\_at}}{86,400,000\text{ ms}}$$

$$\text{DecayMultiplier} = \begin{cases} 1.0 & \text{if } \text{deep\_history} = \text{true} \\ 1.0 & \text{if } \text{type} \in \{\text{'decision'}, \text{'architecture'}\} \\ (0.5)^{\frac{\Delta t_{\text{days}}}{30}} & \text{if } \text{type} \in \{\text{'bugfix'}, \text{'note'}\} \end{cases}$$

$$\text{FinalScore} = \text{Relevance}_{\text{raw}} \times \text{DecayMultiplier}$$

---

## 5. MCP Protocol Specification

### Resources

#### `memo://tags/popular`
- **MIME Type:** `text/plain`
- **Description:** Newline-delimited list of the top 40 candidate tags calculated using the 60-day rolling window + all-time backfill formula. Injected into agent system prompts on session boot.

---

### Tools

#### 1. `append_memory`
Appends an atomic milestone, bugfix, or architectural decision to the persistent store.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "enum": ["decision", "architecture", "bugfix", "note"],
      "description": "Category. 'decision' and 'architecture' never decay. 'bugfix' and 'note' decay with a 30-day half-life."
    },
    "summary": {
      "type": "string",
      "description": "A crisp, 1-2 sentence preview card describing the insight or change."
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Normalized lowercase tags (e.g. ['sqlite', 'wal', 'auth']). Max 6 tags."
    },
    "body": {
      "type": "string",
      "description": "Detailed Markdown narrative: problem context, trade-offs, code diffs, or instructions."
    }
  },
  "required": ["summary", "tags", "body"]
}
```

#### 2. `search_memory` (Stage 1)
Executes FTS5 token search and returns compact index cards ranked by decayed relevance.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Keywords, code symbols, or natural language query (e.g. 'sqlite wal mode concurrent writes')."
    },
    "deep_history": {
      "type": "boolean",
      "default": false,
      "description": "Set to true to disable time-decay and search across all historical entries purely by textual relevance."
    },
    "limit": {
      "type": "number",
      "default": 5,
      "description": "Max index cards to return (default: 5, max: 15)."
    }
  },
  "required": ["query"]
}
```

**Output Format:**
```json
[
  {
    "id": 42,
    "type": "architecture",
    "summary": "Configured SQLite WAL mode with 5000ms busy_timeout for multi-agent writes.",
    "tags": ["sqlite", "wal", "concurrency"],
    "age_days": 12,
    "score": 14.82
  }
]
```

#### 3. `get_entry_context` (Stage 2)
Retrieves the complete narrative and code snippets for a specific entry ID.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "entry_id": {
      "type": "number",
      "description": "The target entry ID obtained from search_memory."
    }
  },
  "required": ["entry_id"]
}
```

#### 4. `get_active_tags` (Fallback Tool)
Returns the top 40 active tags directly for clients that do not support dynamic MCP Resource inspection.

---

## 6. Host Setup & Configuration Examples

### Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "memo": {
      "command": "node",
      "args": ["/absolute/path/to/memo-mcp/dist/index.js"],
      "env": {
        "MEMO_DB_PATH": "/Users/username/.memo/memo.db"
      }
    }
  }
}
```

### Cursor
Add to `.cursor/mcp.json` or Global Cursor Settings:

```json
{
  "mcpServers": {
    "memo": {
      "command": "node",
      "args": ["/absolute/path/to/memo-mcp/dist/index.js"]
    }
  }
}
```

### Environment Variables
- `MEMO_DB_PATH`: Custom path to SQLite database file. Defaults to `~/.memo/memo.db`. Parent directories are created automatically.

---

## 7. Development & Verification

### Install Dependencies
```bash
npm install
```

### Build
```bash
npm run build
```

### Run Tests
```bash
npm test
```

### Direct Execution
```bash
npm start
# or directly with node
node dist/index.js
```
