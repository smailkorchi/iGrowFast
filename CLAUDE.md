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

### Database = the self-host BOX ONLY (no managed Supabase, no Supabase MCP)

The app cut over to the self-hosted Supabase BOX on 2026-07-03. The managed Supabase project and every Supabase MCP server are DEAD and were removed. Do NOT use `mcp__supabase*` tools, and do NOT reference the managed project refs `zjkqprrfbibjoslvlmxf` / `pcgvfwqkzyozzxktfogi`.

**The ONLY DB interface = `~/.igrowfast/db.sh`** — streams raw-stdin SQL over SSH `igf` into `docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1`.
- Reads: pipe SQL in; use `--csv` / `-t -A` / `-x` (NOT `-F'|'` — the remote shell eats the pipe).
- Writes/DDL: wrap in `BEGIN;…COMMIT;` (atomic; first error rolls back). `postgres` is NOT superuser on the box — superuser DDL/restores run as `supabase_admin` (passwordless via socket).

**Edge functions:** source of truth is repo `supabase/functions/`. Deploy = rsync `supabase/functions/` → box `/opt/supabase-project/volumes/functions/` (bind-mounted, hot-loads per request — no restart to update a function). Only the router `volumes/functions/main/index.ts` needs a restart, and only when the PUBLIC_FUNCTIONS allowlist changes (self-host `VERIFY_JWT` is global).

**Before ANY database work:**
1. NEVER assume schema — inspect the live box first via `db.sh` (tables, columns, RPCs, triggers, RLS). Managed-DB facts are stale; re-verify on the box.
2. Schema changes go through the repo migration files under `supabase/migrations/` and are applied to the box via `db.sh`; never leave ad-hoc DDL undocumented.
3. Confirm destructive/schema changes with the user before applying.

Box: `207.180.232.102`, SSH `igf`→root; public via Cloudflare Tunnel `api.igrowfast.com` (kong); Studio `studio.igrowfast.com` (CF Access).

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
