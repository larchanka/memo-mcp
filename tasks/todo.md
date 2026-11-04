# Task List: SQLite Persistent Memory MCP Server (`memo-mcp`)

### Phase 1: Foundation & Project Setup
- [x] Task 1: Project Initialization & TypeScript Configuration
- [x] Task 2: SQLite Client & Schema Initialization
- [x] Checkpoint: Foundation (Tests pass, DB initializes in WAL mode, clean build)

### Phase 2: Ingestion & Math Scoring Engines
- [x] Task 3: Tag Normalization & Soft-Validation Ingestion Engine
- [x] Task 4: Exponential Time-Decay Scoring Engine
- [x] Checkpoint: Ingestion & Scoring Engines (Sanitization & decay math verified)

### Phase 3: Data Access Layer & FTS5 Query Pipeline
- [x] Task 5: Memory Append Transaction
- [x] Task 6: Tag Seeding & Dynamic Top Active Tags Query
- [x] Task 7: FTS5 Search & Context Retrieval Pipeline
- [x] Checkpoint: Data Access Layer (FTS5 search with code tokenchars, decay ranking, transactions verified)

### Phase 4: MCP Protocol & Tools Integration
- [x] Task 8: MCP Tool Handlers Implementation (`append_memory`, `search_memory`, `get_entry_context`, `get_active_tags`)
- [x] Task 9: Server Entrypoint & MCP Stdio Transport (`memo://tags/popular` resource & tools registration)
- [x] Checkpoint: MCP Protocol Integration (All tools & resources work over MCP transport)

### Phase 5: Documentation & Agent Protocol
- [x] Task 10: `AGENTS.md`, Documentation & CLI Configuration
- [x] Checkpoint: Complete (Full test suite passing, build clean, ready for review)
