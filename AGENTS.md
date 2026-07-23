# Project Rules

### 0. OUTPUT STYLE: Absolute Mode (tone contract — subordinate to the rules below)
System Instruction: Absolute Mode governs TONE only. It never overrides rules 1-4 or the prod safety gate, and never suppresses a clarifying question, a safety confirmation, or a surfaced tradeoff. When terseness conflicts with asking or confirming, asking/confirming wins.
- Eliminate: emojis, filler, hype, soft asks, conversational transitions, call-to-action appendixes.
- Assume: user is technically deep but wants PLAIN language — full sentences, categorical answers, no jargon walls or clipped fragments. "I don't get it" / "no lecture" means the explanation failed: re-frame simpler and plainer, never terser.
- Prioritize: blunt, directive phrasing.
- Disable: engagement/sentiment-boosting behaviors.
- Suppress: metrics like satisfaction scores, emotional softening, continuation bias.
- Never mirror: user's diction, mood, or affect.
- Explain at the altitude of the question: a one-line plain re-frame beats a dense technical fragment.
- No: engagement questions, offers, motivational content, CTA closers. Clarifying questions, safety confirmations, and tradeoff callouts are REQUIRED — not banned.
- Terminate reply: after the substance — no closers, no "let me know if".

---

### 1. Use the capability library on demand
Skill descriptions are surfaced every session — pull one when it genuinely fits (facts, contracts, wiring, an actuator you can't derive). Before claiming a capability or tool does not exist, check `~/.Codex/INDEX.md`. Don't route routine work through a mandatory skill-lookup ritual, and don't roleplay an "expert persona" in place of your own reasoning.

---

### Database = the self-host BOX ONLY (no managed Supabase, no Supabase MCP)

The app cut over to the self-hosted Supabase BOX on 2026-07-03. The managed Supabase project and every Supabase MCP server are DEAD and were removed. Do NOT use `mcp__supabase*` tools, and do NOT reference the managed project refs `zjkqprrfbibjoslvlmxf` / `pcgvfwqkzyozzxktfogi`.

**The ONLY DB interface = `~/.igrowfast/db.sh`** — streams raw-stdin SQL over SSH `igf` into `docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1`.
- Reads: pipe SQL in; use `--csv` / `-t -A` / `-x` (NOT `-F'|'` — the remote shell eats the pipe). db.sh runs READ-ONLY by default (accidental writes fail).
- Writes/DDL: pass `--write` (without it db.sh runs read-only and the write fails), and wrap in `BEGIN;…COMMIT;` (atomic; first error rolls back). Codex's `--write` runs are confirm-gated by the PreToolUse hook (`~/.igrowfast/confirm-guard.py`). `postgres` is NOT superuser on the box — superuser DDL/restores run as `supabase_admin` (passwordless via socket).

**Edge functions:** source of truth is repo `supabase/functions/`. Deploy = rsync `supabase/functions/` → box `/opt/supabase-project/volumes/functions/` (bind-mounted). A rsync ALONE does not reliably take effect: the edge runtime caches WARM workers, so a function with recent traffic keeps serving the OLD module. After rsync you MUST `ssh igf 'docker restart supabase-edge-functions'`, wait for health = healthy, then smoke-test. (A first deploy of an *idle* function cold-loads without a restart — which is why an initial deploy can look fine and a redeploy silently doesn't.) The router `volumes/functions/main/index.ts` also needs the restart when the PUBLIC_FUNCTIONS allowlist changes (self-host `VERIFY_JWT` is global).

**Before ANY database work:**
1. NEVER assume schema — inspect the live box first via `db.sh` (tables, columns, RPCs, triggers, RLS). Managed-DB facts are stale; re-verify on the box.
2. Schema changes go through the repo migration files under `supabase/migrations/` and are applied to the box via `db.sh`; never leave ad-hoc DDL undocumented.
3. Confirm destructive/schema changes with the user before applying.

Box: `207.180.232.102`, SSH `igf`→root; public via Cloudflare Tunnel `api.igrowfast.com` (kong); Studio `studio.igrowfast.com` (CF Access).

---

## 1. Think Before Coding

**Don't assume. Resolve uncertainty at its source. Surface tradeoffs.**

Before implementing:
- Uncertainty about the WORLD (schema, current behavior, what's deployed, why something is the way it is) → inspect ground truth first: db.sh, SSH, the repo, logs. Don't ask what you can observe.
- Uncertainty about the OWNER's intent, preferences, or risk tolerance → ask. That's the part your instruments can't answer.
- When the owner explicitly delegates a call ("do what's best"), make it and state it with a one-line rationale — don't bounce options back. Honor named carve-outs verbatim: an asset the owner calls valuable is untouchable without their sign-off. Delegation never waives the safety gate.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

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

## 5. Prod safety gate + work doctrine (this operation)

**Confirm before applying any irreversible/production action** — DB writes/DDL via `~/.igrowfast/db.sh`, box SSH state changes, mail/DNS changes, deploys, offensive tooling — regardless of success-criteria strength or permission mode. Reads are free.

**Doctrine, split by task type** (owner rulings — override rules 2-3 where they conflict):
- Feature work → surgical/minimal (rules 2-3).
- Perf/scale/security work → end-state only: finish the workstream (deferring = leaving a landmine), ship the real fix not a quick patch, and convert `postgres_changes`→broadcast on contact. (Broadcast rule = dated owner ruling, 2026-07; holds while realtime CDC on this box = wal2json — re-evaluate if the realtime stack changes.)

**Managed Supabase MCP is denied at the permission layer here** (box-only, enforced in `.Codex/settings.local.json`). A needed `mcp__supabase*` call is a signal something is wrong — stop and inspect the box via `db.sh`.

## graphify

An optional knowledge-graph index may exist at graphify-out/. It can be a fast way to get cross-file relationships (`graphify query "<q>"` / `path "<A>" "<B>"` / `explain "<concept>"`) — but it is a CACHE: check freshness against HEAD before trusting it, and prefer reading ground-truth source when in doubt. It is never a prerequisite to reading or grepping. If you rebuild it, `graphify update .` keeps it current (AST-only, no API cost).
