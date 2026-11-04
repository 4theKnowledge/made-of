# pm/ ways of working

How to actually use the pm store day-to-day.

- **README.md** is reference (what commands exist).
- **schema.md** is field-level (what a record looks like).
- **This doc** is workflow (when to file a task, when to append a changelog, what a status means).

## Norms (read these first)

- **Update task status before starting work, and again when finishing.** `open` → `in_progress` on pickup; `in_progress` → `done` on landing. Don't skip the intermediate state — it's how anyone else (human or agent) knows what's live.
- **Only work tasks assigned to `claude`.** Other assignees own their queues. If you find something unassigned that needs doing, either claim it explicitly (`assignee: "claude"`) or leave it for the owner to triage.
- **Always leave a comment on completion**, even a one-liner ("no notes, straightforward"). The absence of a comment is ambiguous; a boring comment is signal. A **changelog entry does not substitute** — different audiences: the changelog is world-facing ("this landed"), the task comment is task-local ("what happened while doing it, gotchas, what future-me should know, why the bug report's framing was misleading"). If you close a task without a comment, you've thrown away context that only exists in your head.
- **If the user asks for something noteworthy, file it as a task.** Everything should be traceable back to a request — a stranger reading the tasks + changelog months later should be able to reconstruct why the code looks the way it does.
- **Tasks about the pm tool itself are tagged `pm`.** Use additional tags (`ui`, `bug`, `dx`, `docs`) as they apply.
- **Don't clear `needs_review` on tasks you're working.** That flag is the user's inbox — the user clears it, not you. See "Review-tracking" below.
- **Keep the MCP server in sync with pm code changes.** Whenever you touch `pm/store.py` or `pm/server.py`, decide whether the MCP surface has to change too:
  - Changed the **signature or semantics** of an operation in `store.py` (new arg, new field, renamed key)? → Update the matching `@mcp.tool()` wrapper in `pm/server.py` **and** restart the MCP server so Claude Code re-fetches the tool schemas. Also update `README.md`'s tool list and `schema.md` if the record shape changed.
  - Changed only **internal behavior** in `store.py` (bug fix, refactor, no signature change)? → Still restart the MCP server so it loads the new code. `pm/serve.py` (HTTP UI) hot-reloads on its own via `./pm/run.sh`; the MCP server does not.
  - **The HTTP UI stays in sync automatically.** Any API change (new endpoint, new query param) should land in both `pm/serve.py` and the UI's `apiSend`/`apiGet` calls in the same edit, and the browser will pick it up on next refresh.

  If you skip this, you get "unknown fields" / "unknown tool" errors that look like real bugs but are just stale processes (see the pattern that produced T-0041).

  **"Restart the MCP server" means kill the process AND restart the client.** Claude Code connects to `pm/server.py` once at session start and *keeps* that connection — if the process is still alive when you restart Claude Code, the client reconnects to the same stale process and reads the same stale schema. The reliable sequence:

  1. `pkill -f "pm/server.py"` — kills any lingering MCP process. Verify with `ps aux | grep "pm/server.py"` (should be empty).
  2. Restart Claude Code — it spawns a fresh `pm/server.py` and re-reads the current `@mcp.tool()` decorators.

  You can tell the MCP client noticed the disconnect: the `mcp__pm__*` tools drop out of the tool list, and a "MCP server disconnected" system message appears. If neither happens after `pkill`, the client is talking to an orphan process — try `pkill -9 -f "pm/server.py"` and repeat.

  **`pm/serve.py` (HTTP UI) is different** — `./pm/run.sh` wraps it in `watchfiles` and auto-restarts on `pm/*.py` edits. No manual step needed. Symmetry breaks here because MCP has a long-lived client connection; HTTP is per-request.

  Fallback while MCP is stale: every MCP operation has an HTTP twin (see `README.md`). If you need `add_comment` and the tool isn't callable, `curl -X POST /api/tasks/<id>/comments` still works — same `store.py` code path, same lock.

## Task lifecycle

The seven statuses model reality, not aspiration.

- `open` — filed, not started. If it sits open for weeks, either promote priority or `wont_do`/`cancelled` it.
- `in_progress` — actively being worked *right now*. Move here **when you start**, not before.
- `blocked` — cannot progress because of an *external* dependency: a decision from someone else, an upstream bug, a missing spec. Name the blocker in the body or a comment.
- `on_hold` — paused deliberately. Different from `blocked`: nothing external is missing; we've chosen not to work it (scope-cut, deprioritized). If the reason evaporates, move back to `open`.
- `done` — landed. For code: merged/committed. For docs: published. Not "draft ready".
- `cancelled` — was underway or filed and then abandoned. The work was going to happen but circumstances changed.
- `wont_do` — deliberate "no". A decision that this work should *not* be done, ever (barring new information). Use this to record deferred/rejected ideas so future you doesn't propose them again. **Always put the rationale in the body or a comment** — this is the whole point.

`wont_do` vs `cancelled`: `cancelled` = "we stopped"; `wont_do` = "we decided no". If a `wont_do` gets revisited because the world changed, file a *new* task rather than resurrecting the old one — the historical decision stays intact.

Delete only for genuine mistakes (accidental double-file, typo test rows). Everything else stays as `cancelled` or `wont_do` — the record has value.

## Priority

Ordinal, not a queue. Priority sets what the *next* task should be, not a strict order.

- `P0` **critical** — drop other work. Broken prod, blocked user, security issue. Rare.
- `P1` **high** — schedule this soon. Blocking someone else, or a bug that costs time every day.
- `P2` **normal** — the default. Most work.
- `P3` **low** — nice to have. Polish, non-urgent cleanup. Fine to leave open indefinitely.

If everything is P1, nothing is. Recalibrate.

## Group vs. tag

Both group tasks, differently.

- `group` — **one** logical unit of work per task. A refactor, an initiative, a mode. Use when you'd want to see *only these tasks together* to reason about the whole. Examples: `combine-rework`, `admin-polish`, `pm-polish`.
- `tags` — **many** free-form labels. Domain area (`ui`, `docs`, `bug`), subsystem (`combine`, `craft`, `admin`, `api`, `db`), or anything you'd want to filter by. Examples: `["combine", "ui", "bug"]`.

Rule of thumb: if the label describes a *body of work*, it's a group. If it describes an *attribute*, it's a tag.

## When to file a task vs. handle inline

File a task if **any** of these are true:
- The work spans more than the current session.
- Someone other than the current worker needs to see it (assignee ≠ current agent).
- It has a decision or discussion attached (comments are useful).
- It's a real bug, not a passing observation.
- The user asked for something noteworthy (see Norms — traceability).

Handle inline (no task) if:
- You can finish it before the next user message.
- It's a trivial cleanup on your way through the code.
- The user asked for something specific and you're doing it right now.

When in doubt, file. Ten small tasks are easier to manage than one drift-y session.

## Review-tracking

Two task fields exist so the user can triage agent work without drowning in it:

- `needs_review` (bool) — the user's inbox flag. "Something changed here I should look at."
- `reviewed_at` (ISO-8601 UTC or null) — "I've looked at the state as of this timestamp."

**Who sets what:**

- **Agents set `needs_review=true` implicitly.** It flips on whenever an agent (author `null` or `"claude"`) calls `add_comment`, and whenever any caller sets `status=done`. You don't need to (and shouldn't) set it explicitly — the store handles it. Don't clear it either; that's the user's call.
- **The user sets `reviewed_at`.** Via the UI or `update_task(id, {"reviewed_at": "now"})`. Setting `reviewed_at` to a non-null value also clears `needs_review=false` — one action, both signals updated.
- **Any mutation clears `reviewed_at`.** If a task is edited, commented on, or has its status changed after being reviewed, `reviewed_at` auto-resets to `null`. Rationale: the moment state changes, the prior review is stale. This is the "have I seen the *current* state" invariant.

**Filters:**

- `list_tasks(needs_review=True)` — the user's inbox. What agents have flagged for attention.
- `list_tasks(reviewed=False)` — never-reviewed *or* recently-changed since last review.
- `list_tasks(reviewed=True)` — reviewed and untouched since.

**Common gotcha:** if you're doing a series of updates on a task the user just reviewed, expect `reviewed_at` to clear on the first mutation. That's intentional — don't work around it.

### Review checklist (`review_items`)

The binary `needs_review` flag says *that* a task needs a look; a **`review_items` checklist** says *what* to check. Prefer authoring a checklist on landing over hoping the reviewer reconstructs the agenda from your comment.

- **Author on landing.** After the landing comment, before or with `status=done`, call `add_review_item` for each thing worth eyeballing. Aim for concrete, verifiable statements — "run `tests/pm/test_review_items.py`", "sanity-check the auto-clear rule in the store", "eyeball the modal on a task with 5+ items". A vague "review the changes" earns nothing over the binary flag.
- **Use `ref` to point at the thing.** Free-form pointer — `file:line`, route path, test module, URL. Empty string / null when there's nothing to point at.
- **One item per verifiable act.** Splitting is cheap; bundling forces partial-check ambiguity. A user who checked half of a compound item has nowhere to record that.
- **Skip the checklist for trivial tasks.** A one-line "fixed typo" landing doesn't need a checklist. If the change is small enough that the diff *is* the review, skip it — `needs_review` alone still works.
- **Don't clear items on tasks you're working.** Same rule as `needs_review` — the user resolves items (via check or dismiss). The auto-clear rule (see below) is the only agent path that touches the flag through the checklist.

**Auto-clear rule:** resolving the last open item on a task with `needs_review=true` sets `needs_review=false` and stamps `reviewed_at=now`. The checklist is the explicit review act — one click per item, no separate "mark reviewed" step needed. Adding a new item on an already-reviewed task clears `reviewed_at` (a fresh item invalidates the prior review).

**Check vs. dismiss:** both terminal, both count as resolved. `checked` = "I verified this"; `dismissed` = "I read it and decided it's not worth checking". Reach for `dismissed` before `delete_review_item` — deletion is for accidental duplicates only, and it loses the "user saw this" signal.

## Comment shape

Task comments are the load-bearing record of what happened on a task (see CLAUDE.md — "How to handle requests"). Two comments are expected per task-of-substance: an **approach** comment before work starts, and a **landing** comment when it's done. Both use the same two-part shape so a reader can scan or drill in.

**Shape:**

```
**<Approach | Landing>**

<tl;dr — one or two lines. What's about to be done, or what shipped. Scannable from the task list.>

**Detail**
- what: <files/functions touched, or planned>
- why: <the request or constraint driving the choice>
- tradeoffs: <what was weighed and what was picked; "none" if genuinely none>
- benefit: <what this unlocks or fixes>
- follow-ups: <deferred work, filed as new tasks — link ids; "none" if none>
```

Per-stage guidance:

- **Approach comment** — filed after `status=in_progress`, before touching code. tl;dr = the plan in a sentence. Detail's `what` is planned files/functions, `tradeoffs` is what you're choosing between right now. Skip `benefit` if it's obvious from the task body.
- **Landing comment** — filed after the work is done, before `status=done`. tl;dr = what shipped in a sentence. Detail's `what` is `files:lines` actually changed, `tradeoffs` is what was taken (and what was left on the floor), `follow-ups` includes any tests skipped/blocked with the reason.

Rules of thumb:

- **The tl;dr is not optional.** Its job is to make the task list readable at a glance — if a reader has to open the comment to know what happened, the tl;dr failed.
- **Detail bullets can be omitted when they'd say "n/a".** Prefer four honest bullets over six padded ones. `tradeoffs: none` is fine when true; don't invent tradeoffs to fill the field.
- **Don't restate the task body in the comment.** The body is the ask; the comment is the response. If the tl;dr reads like the title, it's not adding signal.
- **Landing summary is not the changelog.** The changelog is world-facing ("this landed"); the comment is task-local ("here's what I actually did and why, including the parts a stranger reading the diff wouldn't guess"). Same event, different audiences — write both.
- **One-liner escape hatch.** For trivial tasks ("fixed typo in docs") a one-line comment without the full shape is fine — the norm is "always comment", and the shape kicks in when there's substance to record.

## Questions vs. comments

Both live on a task; they're for different jobs. Getting this split wrong buries open questions in narrative history — which was the point of adding questions as a separate surface.

- **Comment** — narrative. Approach, landing summary, incidental discussion. Append-only in spirit. What *happened*, what *shipped*, why the diff looks the way it does.
- **Question** — actionable state. Someone owes an answer. Unresolved questions surface as a `?N` badge on the task list; you can filter with `list_tasks(open_questions_for="claude" | "user")`.

Rules of thumb:

- **If you'd write "I'm not sure whether X — flagging it" in a comment, file a question instead.** The comment gets read once and forgotten; the question stays visible until someone resolves it.
- **`asked_of` is the routing hint.** `"claude"` means an agent owes an answer; `"user"` means the user does. Leave it null only when the question is genuinely for whoever gets there first.
- **Answering doesn't auto-resolve.** You can record an answer and leave the question open (e.g. "here's my best guess, confirm?"); the asker resolves once satisfied. Or resolve without an answer for "moot" / "no longer relevant" — put the reason in the question body or a comment if it's non-obvious.
- **Question ops do NOT touch `needs_review` / `reviewed_at`.** Questions are a separate inbox axis. An open `asked_of: user` question is its own signal — don't conflate it with the review flag.

When to file a question vs. update the task body:
- **Body edit** if the ambiguity is structural (scope isn't clear, the ask needs restating).
- **Question** if the body is right and you just need a specific answer to proceed.

## Changelog

**Append-only in spirit.** Old entries are historical fact; if you were wrong, add a new entry (a correction or retraction) — don't rewrite the old one.

The store *permits* deletion (`delete_changelog(id)` / `DELETE /api/changelog/<id>` / a Delete button in the detail modal), but that hatch exists **only for accidental noise**: typos in the summary, smoke-test rows, wrong refs before anyone acted on them. If the entry has been out in the world for any length of time — someone read it, referenced it, based a decision on it — you don't get to delete it. Append a correction instead.

Rule of thumb: would a future reader be confused by seeing the entry and its correction, or by the entry silently vanishing? If it's the former, delete. If it's the latter (or you can't tell), append.

Kinds:
- `feature` — user-visible new capability. New mode, new admin surface, new puzzle variant.
- `fix` — a bug is gone. Not a refactor, not a cleanup — an actual behavior change from wrong to right.
- `refactor` — internal shape change with no user-visible behavior difference. Extract, rename, move, split.
- `decision` — a choice was made and it will affect future work. Architecture calls, "we're not doing X", API shape locks.
- `note` — everything else worth remembering: an incident summary, a benchmark result, a link to context. Use sparingly.

Append when:
- You landed a user-visible change (`feature` or `fix`).
- You made a call the next agent needs to know about (`decision`).
- You did a refactor that reshaped a boundary (`refactor` — not every rename).

Don't append for: work-in-progress checkpoints, todo lists, or things that belong in commit messages.

## Refs conventions

`refs` is a free-form dict on changelog entries. Consistent keys make filtering possible.

- `{"task": "T-0001"}` — one task the entry relates to.
- `{"tasks": "T-0001,T-0002,T-0003"}` — multiple (comma-separated string; the UI linkifies each).
- `{"commit": "abc1234"}` — short SHA of the landing commit.
- `{"pr": 42}` — GitHub PR number.
- `{"issue": 17}` — GitHub issue number.

Include what applies. Skip what doesn't. Don't invent new keys unless the value is genuinely a new concept.

## Bulk operations

The MCP + HTTP surface has bulk variants: `bulk_update_tasks`, `bulk_delete_tasks`, `bulk_delete_changelog`. They take one of two selectors:

- **`ids: [...]`** — explicit list of ids. Preferred for anything destructive.
- **`filter: {...}`** — same filter keys as `list_tasks` / `recent_changes` (`status`, `tag`, `assignee`, `group`, `priority`, `ready` for tasks; `kind`, `since` for changelog). Use with care — one typo can hit dozens of rows.

Exactly one of `ids` / `filter` per call. Both or neither errors out.

Rules of engagement:

- **List first, then mutate.** Always run `list_tasks(...)` (or `recent_changes(...)`) with your intended filter first to preview the match set. Read the ids back. *Then* run the bulk op — with `ids` populated from the preview if the change is destructive.
- **`bulk_update_tasks` returns partial results.** `{"updated": [...], "errors": [{"id": ..., "error": ...}]}`. Valid records still apply even if some fail. Check `errors` — don't assume success from a 200.
- **`bulk_delete_tasks` is all-or-nothing on the dep guard.** If any matched task is referenced by an *unmatched* task, the whole call errors — nothing is deleted. Fix the referrer's `depends_on` first, or add the referrer to the match set.
- **Log a `note` for large bulk changes.** If you re-prioritized 20 tasks or deleted 15 changelog rows, append a one-line `note` explaining why. Future readers seeing a bulk change in the file history will thank you.
- **Bulk creates don't exist by design.** No `bulk_add_tasks`, no `bulk_append_changelog`. Twenty new tasks at once is almost always work that belongs in a single task with a checklist body; twenty changelog entries at once is one entry with multiple refs.

## UI vs. MCP tools

Same data, two surfaces. Both go through `store.py`, so they can't diverge.

- **UI** (`./pm/run.sh` → browser): humans, quick edits, browsing. Row-click modals, filter chips, free-text search across id/title/body/tags/group/assignee/comments.
- **MCP tools** (via Claude Code): agents, scripted flows, bulk work. Same operations plus `add_task`, `delete_task`, `add_comment`.

Both are safe to use concurrently — writes take an advisory lock on the target file. Reminder: MCP schema changes require restarting `pm/server.py`; UI/HTTP changes hot-reload automatically.

## Common flows

**Starting a task:**
1. `list_tasks(assignee="claude", ready=True)` to find work assigned to you whose deps are done.
2. `update_task(id, {"status": "in_progress"})`.
3. Do the work.
4. `add_comment(id, "…")` — **required**, even a one-liner. Task-local: what happened, what surprised you, what future-you needs to know. Not "landed X" (that's the changelog). Follow the two-part shape in "Comment shape" above (tl;dr + detail) for anything beyond a trivial fix. This auto-sets `needs_review=true` so the user sees the task in their inbox.
5. `update_task(id, {"status": "done"})` — also auto-flags `needs_review=true` (redundant with step 4, but explicit).
6. `add_review_item(id, "…")` — one per thing the user should eyeball, unless the change is trivial. See "Review checklist" above.
7. `append_changelog(kind, summary, refs={"tasks": ...})` if it's user-visible or a decision. World-facing.

**Filing a follow-up during a task:**
- Don't inline "we should also do X" — file it. `add_task(title="...", tags=[...], group=...)`. Reference the current task if related.

**Finding stale work:**
- `list_tasks(status="in_progress")` — anything here longer than the current session is drift. Either finish or downgrade.
- `list_tasks(status="blocked")` — check if the blocker is still real.

**Reviewing (user flow):**
- `list_tasks(needs_review=True)` — the inbox. What agents have flagged since the last look.
- After reading, `update_task(id, {"reviewed_at": "now"})` — clears `needs_review` and records when. If the task changes again later, `reviewed_at` auto-clears.

**Grouping related work:**
- Give related tasks the same `group` string. Then filter by that group in the UI or `list_tasks(group="...")`.

**Editing pm code itself:**
1. Change `pm/store.py` and/or `pm/serve.py` — the running `./pm/run.sh` picks these up automatically.
2. If you touched `pm/store.py` **or** `pm/server.py`, update `pm/server.py`'s `@mcp.tool()` wrappers to match (new args, new tools, changed docstrings). Then refresh the MCP client (see Norms — "Restart the MCP server" means kill the process AND restart the client):
   - `pkill -f "pm/server.py"` (verify empty with `ps aux | grep "pm/server.py"`)
   - Restart Claude Code
   - Confirm the `mcp__pm__*` tool list reflects the new/changed tools before relying on them.
3. Update `README.md` (tool list) and `schema.md` (record shape) if either changed.
4. Add a task for the change if it's noteworthy (per Norms — traceability).
