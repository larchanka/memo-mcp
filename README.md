# memo (`memo-mcp`)

> **Your AI agents forget everything between sessions. `memo` gives them a shared, local-first memory — one SQLite file, zero cloud.**

---

### The Fundamental Contrast

$$\text{AGENTS.md is what humans write. \textbf{memo} is what agents remember.}$$

`AGENTS.md` defines static instructions and project boundaries. `memo` accumulates real-world developer experience across sessions: architectural decisions made, tricky toolchain bugs resolved, and library quirks discovered.

```
┌────────────────────────────────────────────────────────────────────────┐
│ SESSION 1 (Claude Code): Solves obscure iOS audio streaming bug        │
│ └─► Calls append_memory([free-ai-translation-ios-app] Implemented ...) │
│                                                                        │
│ ──────────────────────── 2 WEEKS LATER ────────────────────────────── │
│                                                                        │
│ SESSION 2 (Cursor / Antigravity): New session, clean context           │
│ └─► Natural Language Search: "translation pipeline WhisperKit NLLB"   │
│ └─► Result: Relevant card found in one shot with decayed score         │
│ └─► Agent reads full context via get_entry_context(51)                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 30-Second Quickstart

Add `memo` to your MCP client configuration:

### Claude Code CLI
```bash
claude mcp add memo npx -y @larchanka/memo-mcp
```

### Cursor
Add to `.cursor/mcp.json` or your Global Cursor MCP settings:
```json
{
  "mcpServers": {
    "memo": {
      "command": "npx",
      "args": ["-y", "@larchanka/memo-mcp"]
    }
  }
}
```

### Antigravity
Add to `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "memo": {
      "command": "npx",
      "args": ["-y", "@larchanka/memo-mcp"]
    }
  }
}
```

### Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):
```json
{
  "mcpServers": {
    "memo": {
      "command": "npx",
      "args": ["-y", "@larchanka/memo-mcp"]
    }
  }
}
```

### OpenCode
Add to `~/.config/opencode/opencode.jsonc`:
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "memo": {
      "enabled": true,
      "type": "local",
      "command": ["npx", "-y", "@larchanka/memo-mcp"]
    }
  }
}
```

---

## Why It's Different

Most agent memory projects (Mem0, Zep, Letta, Cognee) require cloud accounts, API keys, external vector databases, or complex background daemons. `memo` takes a fundamentally different engineering approach:

### 1. Forgetting Is a Feature (Time-Decayed Relevance)
Stale troubleshooting tips and temporary workarounds pollute context windows. `memo` applies in-process exponential time-decay:
- **`bugfix` and `note`** decay with a **30-day half-life**. Recent fixes rank high; yesterday's transient workaround naturally fades away.
- **`decision` and `architecture`** are **permanently immune** to decay ($T_{\text{half}} = \infty$). Core conventions never expire.
- Need a historical post-mortem? Toggle `deep_history: true` to bypass decay and search purely by textual BM25 relevance.

### 2. Append-Only ADRs (Written by Agents, for Agents)
Instead of messy raw conversation dumps, agents log structured, atomic records: problem context, trade-offs evaluated, and decisions taken. It's an automated Architecture Decision Record (ADR) system for your codebase.

### 3. Token-Economy Two-Stage Retrieval
LLM context windows are expensive. Dumping full documents on every search wastes prompt budget.
- **Stage 1 (`search_memory`):** Executes fast, disjunctive SQLite FTS5 search and returns compact **preview index cards** (~25 tokens each) containing ID, summary, tags, and decayed score.
- **Stage 2 (`get_entry_context`):** The agent inspects the cards and pulls the full Markdown body and code snippets **only** for the exact entries it needs.

### 4. One SQLite File. Zero Cloud.
- Stored locally in WAL mode at `~/.memo/memo.db` (configurable via `MEMO_DB_PATH`).
- No external vector DB, no embeddings bill, no daemon processes, zero telemetry.
- Fully offline, trivially backuppable, and instantly inspectable using the `sqlite3` CLI.

---

## Agent Instruction Protocol

Copy this snippet into your project's `AGENTS.md` (or global `~/.gemini/GEMINI.md` / `~/.config/opencode/AGENTS.md`) so your agents automatically search and record memories:

```markdown
### Persistent Memory Protocol (memo-mcp)

1. **Before starting complex architectural tasks, unfamiliar refactoring, or troubleshooting obscure errors:**
   - Identify current project context: project name (from `package.json`, root folder, or git repo) and root path.
   - Call `search_memory` using natural language keywords or code symbols.
   - If the task relates to project origin, legacy decisions, or returns zero initial hits, re-run with `deep_history: true`.
   - Inspect the returned preview cards. If a card is directly relevant, call `get_entry_context(entry_id)` to review full code snippets, context, and trade-offs.

2. **At the end of every completed milestone, bugfix, or structural decision:**
   - Call `append_memory` with explicit project identification:
     - **Project Context:** Identify project name (e.g. from `package.json`, root folder, or git repo) and workspace path.
     - **Summary:** Prefix summary with `[<project-name>]` (e.g., `[my-project] Configured SQLite WAL mode...`).
     - **Body:** Begin body with a metadata header:
       ```markdown
       - **Project:** <project-name>
       - **Path:** `<workspace-folder-path>`
       ```
       followed by the detailed narrative, decisions, trade-offs, or instructions.
     - **Tags:** Include the sanitized project name as a tag, plus 2-4 semantic tags adhering to known tags from `get_active_tags` (max 6 tags total).
     - **Type selection:**
       - Use `type: "decision"` or `type: "architecture"` ONLY for permanent conventions and designs (immune to time decay).
       - Use `type: "bugfix"` or `type: "note"` for transient implementation quirks or troubleshooting steps (decay with 30-day half-life).
```

---

## MCP Tools & Resources API

### Tools

#### 1. `search_memory` (Stage 1)
Searches entries using code-safe FTS5 BM25 ranking and exponential time decay. Multi-term natural language queries are evaluated with disjunctive ranking, ensuring relevant entries match even when terminology differs across entries.

```json
{
  "query": "translation pipeline WhisperKit NLLB audio session",
  "deep_history": false,
  "limit": 5
}
```

**Output:**
```json
[
  {
    "id": 51,
    "type": "architecture",
    "summary": "[free-ai-translation-ios-app] Implemented WhisperKitService and AudioLevelMonitor",
    "tags": ["audio", "whisper", "free-ai-translation-ios-app"],
    "age_days": 2,
    "score": 9.99
  }
]
```

#### 2. `get_entry_context` (Stage 2)
Deep retrieval of the complete Markdown narrative, code diffs, and context by ID.

```json
{
  "entry_id": 51
}
```

#### 3. `append_memory`
Records an atomic insight or decision. Soft validation automatically coerces malformed inputs to `type: "note"` so agent writes never fail.

```json
{
  "type": "decision",
  "summary": "Adopted SQLite WAL mode with 5000ms busy_timeout for multi-agent writes",
  "tags": ["sqlite", "wal", "concurrency"],
  "body": "WAL mode enables concurrent readers while writing. Busy timeout handles lock contention across agent workers."
}
```

#### 4. `get_active_tags`
Returns the top 40 candidate tags from a 60-day rolling window to prevent vocabulary fragmentation across agents.

---

### Resources

- `memo://tags/popular`: Exposes the top active tags as an MCP text resource to seed agent context on session boot.

---

## Under the Hood

### Database Schema (WAL Mode)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS memory_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('decision', 'architecture', 'bugfix', 'note')),
    summary TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_tags (
    entry_id INTEGER NOT NULL,
    keyword_id INTEGER NOT NULL,
    PRIMARY KEY (entry_id, keyword_id),
    FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
);

-- Code-safe tokenization keeps symbols like @modelcontextprotocol/sdk or src/utils/auth.ts intact
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    entry_id UNINDEXED,
    summary,
    body,
    tags,
    tokenize = "unicode61 tokenchars '-_/@'"
);
```

### Mathematical Scoring & Time-Decay

In SQLite FTS5, the internal `bm25()` returns a negative score, where values closer to $-\infty$ indicate higher match quality:

$$\text{Relevance}_{\text{raw}} = -1 \times \text{bm25}$$

$$\Delta t_{\text{days}} = \frac{\text{now} - \text{created\_at}}{86,400,000\text{ ms}}$$

$$\text{DecayMultiplier} = \begin{cases} 1.0 & \text{if } \text{deep\_history} = \text{true} \\ 1.0 & \text{if } \text{type} \in \{\text{'decision'}, \text{'architecture'}\} \\ (0.5)^{\frac{\Delta t_{\text{days}}}{30}} & \text{if } \text{type} \in \{\text{'bugfix'}, \text{'note'}\} \end{cases}$$

$$\text{FinalScore} = \text{Relevance}_{\text{raw}} \times \text{DecayMultiplier}$$

---

## Local Development & Testing

```bash
# Install dependencies
npm install

# Run test suite (68 tests across FTS5, decay, and MCP tools)
npm test

# Build TypeScript to dist/
npm run build
```

---

## License

[MIT](LICENSE)
