### Persistent Memory Protocol (memo-mcp)

1. Before starting complex architectural tasks, unfamiliar module refactoring, or troubleshooting obscure errors:
   - Call `search_memory` with specific technical keywords.
   - If the task relates to project origin, legacy decisions, or returns zero initial hits, re-run with `deep_history: true`.
   - Inspect the returned preview cards. If a card is directly relevant, call `get_entry_context(entry_id)` to review full code snippets and trade-offs.

2. At the end of every completed milestone, bugfix, or structural decision:
   - Call `append_memory`.
   - Use `type: "decision"` or `type: "architecture"` ONLY for permanent conventions and designs.
   - Use `type: "bugfix"` or `type: "note"` for transient implementation quirks or troubleshooting steps.
   - Select 2-5 tags adhering to known tags from `get_active_tags`.
