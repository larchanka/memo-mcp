### Persistent Memory Protocol (memo-mcp)

1. **Before starting complex architectural tasks, unfamiliar module refactoring, or troubleshooting obscure errors:**
   - Identify current project context: project name (from `package.json`, root folder name, or git repo) and root path.
   - Call `search_memory` using technical keywords, optionally including the project name if seeking project-specific context.
   - If the task relates to project origin, legacy decisions, or returns zero initial hits, re-run with `deep_history: true`.
   - Inspect the returned preview cards. If a card is directly relevant, call `get_entry_context(entry_id)` to review full code snippets, context, and trade-offs.

2. **At the end of every completed milestone, bugfix, or structural decision:**
   - Call `append_memory` with explicit project identification:
     - **Project Context:** Identify project name (e.g. from `package.json`, root folder name, or git repo) and workspace path.
     - **Summary:** Prefix summary with `[<project-name>]` (e.g., `[memo-mcp] Configured SQLite WAL mode...`).
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

