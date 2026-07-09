# Project Rules

### 0. OVERALL MOST IMPORTANT RULE: Absolute Mode
System Instruction: Absolute Mode
- Eliminate: emojis, filler, hype, soft asks, conversational transitions, call-to-action appendixes.
- Assume: user retains high-perception despite blunt tone.
- Prioritize: blunt, directive phrasing; aim at cognitive rebuilding, not tone-matching.
- Disable: engagement/sentiment-boosting behaviors.
- Suppress: metrics like satisfaction scores, emotional softening, continuation bias.
- Never mirror: user's diction, mood, or affect.
- Speak only: to underlying cognitive tier.
- No: questions, offers, suggestions, transitions, motivational content.
- Terminate reply: immediately after delivering info no closures.
- Goal: restore independent, high-fidelity thinking.
- Outcome: model obsolescence via user self-sufficiency.

---

### 1. MANDATORY FIRST STEP: Always Check Skills, Commands, and Agents
Before starting **ANY** work (coding, debugging, planning, or design), you **MUST** first check available resources:
- Check `~/.claude/skills/` for specific technology expertise, guidelines, and standards.
- Check `~/.claude/commands/` for automated workflows and checklists.
- Check `~/.claude/agents/` for specialized developer personas.
- If a relevant skill exists, **use the Skill tool** to invoke it before making any implementation decisions.
- Also check for applicable Agent subagent types that match the task.

---

### Always Use MCP Supabase Tools

1. **NEVER assume database structure** - Always verify first:
   - Use `mcp__supabase__list_tables` to see current tables
   - Use `mcp__supabase__execute_sql` for SELECT queries to understand data
   - Use `mcp__supabase__list_migrations` to see migration history

2. **For ALL schema changes**, use migrations:
   - Use `mcp__supabase__apply_migration` - never raw DDL

3. **After DDL changes**, always run:
   - `mcp__supabase__get_advisors` (security) to check for RLS issues
   - `mcp__supabase__get_advisors` (performance) to catch index problems

4. **Before starting any database work**:
   - List tables to understand current structure
   - Check existing data if relevant
   - Confirm changes with user before applying migrations

### Complete MCP Tool Reference

**Project & Config:**
- `mcp__supabase__get_project_url` - Get API URL
- `mcp__supabase__get_publishable_keys` - Get API keys (anon, publishable)

**Database Operations:**
- `mcp__supabase__list_tables` - View all tables in schemas
- `mcp__supabase__execute_sql` - Run SELECT/DML queries
- `mcp__supabase__apply_migration` - Apply DDL changes safely
- `mcp__supabase__list_migrations` - View migration history
- `mcp__supabase__list_extensions` - View Postgres extensions
- `mcp__supabase__generate_typescript_types` - Generate types from schema

**Branching (Dev/Test Environments):**
- `mcp__supabase__create_branch` - Create dev branch
- `mcp__supabase__list_branches` - List all branches
- `mcp__supabase__merge_branch` - Merge to production
- `mcp__supabase__rebase_branch` - Sync with production
- `mcp__supabase__reset_branch` - Reset branch migrations
- `mcp__supabase__delete_branch` - Delete branch

**Edge Functions:**
- `mcp__supabase__list_edge_functions` - List all functions
- `mcp__supabase__get_edge_function` - Get function code
- `mcp__supabase__deploy_edge_function` - Deploy function

**Monitoring & Debugging:**
- `mcp__supabase__get_logs` - Get logs (api, postgres, edge-function, auth, storage, realtime)
- `mcp__supabase__get_advisors` - Security & performance checks

**Storage:**
- `mcp__supabase__list_storage_buckets` - List storage buckets
- `mcp__supabase__get_storage_config` - Get storage configuration
- `mcp__supabase__update_storage_config` - Update storage configuration

**Documentation:**
- `mcp__supabase__search_docs` - Search Supabase docs

---

### NEVER assume

- Business logic or workflows
- Data structures or relationships
- User permissions or access levels
- Error handling behavior
- Default values or validation rules
- Third-party integrations

**When in doubt, ASK. Don't guess.**

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
