# pm/

Lightweight project-management store for AI agents working on this repo.
Two append-friendly JSONL files + a tiny MCP server that exposes them as tools.

Not part of the Made Of app. Nothing under `src/` imports from here.
Standalone Python tool (requires `uv`); runs alongside the Next.js app.

## Layout

- `tasks.jsonl` — mutable task records (open/in_progress/blocked/done). One JSON object per line.
- `changelog.jsonl` — append-only history of notable changes. One JSON object per line.
- `schema.md` — field definitions for both files.
- `server.py` — MCP server (stdio transport). Same operations as the HTTP API, backed by the same `store.py`.
- `serve.py` — HTTP server: static files + JSON API. Backs the UI.
- `store.py` — read/write helpers over the two JSONL files. Atomic writes (`os.replace`), advisory `fcntl.flock` per file, cycle detection on deps.
- `index.html` — Tasks page (list, filters sidebar, task modal). Talks to `serve.py`'s `/api/tasks*` endpoints.
- `changelog.html` — Changelog page (list, kind filter, entry + create modals). Talks to `/api/changelog*`. Task refs in entries link back to `/index.html?task=<id>`.

## Running the UI

One-shot launcher (starts the server and opens the browser). Auto-restarts on
edits to `pm/*.py` via `watchfiles`, so `store.py` / `serve.py` changes take
effect immediately without a manual kill/restart:

```bash
./pm/run.sh              # http://127.0.0.1:8765/
./pm/run.sh 9000         # custom port
```

Or run the server yourself (no hot-reload):

```bash
uv run pm/serve.py --port 8765
```

Add tasks via the form; change status via the inline dropdown per row; log
changes via the changelog form. Writes hit `serve.py`, which delegates to
`store.py` — the same code path the MCP server uses.

## Why JSONL, not SQLite

Single-writer (one agent at a time), <10k rows expected, git-diffable.
If filtering gets painful or we need concurrent writers, migrate to SQLite
then — the JSONL imports trivially.

## HTTP API (live, backs the UI)

- `GET    /api/tasks?status=&tag=&assignee=&ready=&limit=&group=&priority=&needs_review=&reviewed=&pinned=&parent_task_id=&open_questions_for=` → `[task, ...]`. `parent_task_id=<id>` filters to children of a parent; `parent_task_id=` (empty) filters to top-level tasks. `open_questions_for=<who>` filters to tasks with any unresolved question `asked_of == <who>` (e.g. `claude` or `user`).
- `POST   /api/tasks` `{title, body?, tags?, assignee?, depends_on?, priority?, group?, pinned?, parent_task_id?}` → `task`
- `PATCH  /api/tasks/<id>` `{status?, title?, body?, tags?, assignee?, depends_on?, priority?, group?, needs_review?, reviewed_at?, pinned?, parent_task_id?}` → `task`. `reviewed_at` accepts ISO-8601 UTC, `null`, or the sentinel `"now"`. Toggling `pinned` does not stale `reviewed_at`. `parent_task_id` is a task id (str) or null; distinct from `depends_on` (scope vs. ordering); cycles rejected.
- `DELETE /api/tasks/<id>` → `task` (the deleted record). Fails 400 if any other task depends on it or has it as a parent.
- `POST   /api/tasks/<id>/comments` `{body, author?}` → `task` (with the new comment appended)
- `DELETE /api/tasks/<id>/comments/<ts>` → `task` (with the comment removed). `<ts>` is the comment's ISO `ts` (URL-encoded). Errors 404 if unknown. Does not touch `needs_review` / `reviewed_at`.
- `POST   /api/tasks/<id>/questions` `{question, asked_by?, asked_of?}` → `task` (with the new question appended). Question mutations DO NOT touch `needs_review` / `reviewed_at`.
- `PATCH  /api/tasks/<id>/questions/<qid>` `{answer?, answered_by?, resolved?}` → `task`. `answer` records a response (does not auto-resolve); `resolved` closes/reopens.
- `DELETE /api/tasks/<id>/questions/<qid>` → `task` (with the question removed).
- `POST   /api/tasks/<id>/review_items` `{body, ref?, author?}` → `task` (with the new review item appended). Adding an item clears `reviewed_at` if set.
- `PATCH  /api/tasks/<id>/review_items/<rid>` `{status?, resolved_by?, body?, ref?}` → `task`. `status ∈ {open, checked, dismissed}` — resolving the last open item on a flagged task auto-clears `needs_review` and stamps `reviewed_at`. `body`/`ref` are inline edits.
- `DELETE /api/tasks/<id>/review_items/<rid>` → `task` (with the item removed).
- `POST   /api/tasks/bulk_update` `{ids? | filter?, patch}` → `{updated, errors}`. Exactly one of `ids`/`filter`; filter keys: status, tag, assignee, group, priority, ready.
- `POST   /api/tasks/bulk_delete` `{ids? | filter?}` → `{deleted}`. Refuses whole call if any matched task is referenced by an unmatched task's `depends_on`.
- `GET    /api/changelog?since=&kind=&limit=` → `[entry, ...]` (newest first)
- `POST   /api/changelog` `{kind, summary, refs?}` → `entry`
- `DELETE /api/changelog/<id>` → `entry` (the deleted record). Errors 404 if unknown.
- `POST   /api/changelog/bulk_delete` `{ids? | filter?}` → `{deleted}`. Filter keys: kind, since.

Errors: `400` `{"error": "..."}` for validation, `404` for unknown, `500` for unexpected.

## MCP server

Requires the `pm` dep group (adds `mcp` SDK). Not installed by default:

```bash
uv sync --group pm
```

Tools exposed (identical semantics to the HTTP API):

- `list_tasks(status?, tag?, assignee?, ready?, limit?, group?, priority?, needs_review?, reviewed?, pinned?, parent_task_id?, open_questions_for?)`  — `ready=true` → open tasks with all deps done; `needs_review=true` → user's inbox; `reviewed=false` → never-reviewed or stale-since-review; `pinned=true` → user's personal shortlist; `parent_task_id="<id>"` → children of a parent; `parent_task_id=""` → top-level (no parent); `open_questions_for="<who>"` → tasks with any unresolved question `asked_of == <who>`
- `get_task(id)`
- `add_task(title, body?, tags?, assignee?, depends_on?, priority?, group?, pinned?, parent_task_id?)`
- `update_task(id, patch)`  — status, title, body, tags, assignee, depends_on, priority, group, needs_review, reviewed_at (accepts `"now"` sentinel), pinned (bool; personal shortlist marker, does not touch review flags), parent_task_id (str id or null; scope containment, distinct from depends_on; cycles rejected)
- `delete_task(id)`  — hard-delete; errors if any other task depends on it or has it as a parent
- `add_comment(task_id, body, author?)`  — append inline comment
- `delete_comment(task_id, comment_ts)`  — hard-delete a comment by its ISO `ts` (accidental duplicates only; no undo). Does not touch `needs_review` / `reviewed_at`.
- `add_question(task_id, question, asked_by?, asked_of?)`  — raise a question; `asked_of` names who owes an answer (conventional: `"claude"`, `"user"`, or omit for "anyone"). Question mutations do NOT touch `needs_review` / `reviewed_at`.
- `answer_question(task_id, question_id, answer, answered_by?)`  — record a response; does NOT auto-resolve
- `resolve_question(task_id, question_id, resolved=True)`  — mark resolved (default) or reopen
- `delete_question(task_id, question_id)`  — hard-delete a question
- `add_review_item(task_id, body, ref?, author?)`  — author a review checklist item on landing. `ref` is a free-form pointer (file:line, scenario, test). Clears `reviewed_at` if set.
- `resolve_review_item(task_id, item_id, status, resolved_by?)`  — `status ∈ {checked, dismissed, open}`. Resolving the last open item on a task with `needs_review=true` auto-clears the flag and stamps `reviewed_at`.
- `update_review_item(task_id, item_id, patch)`  — edit `body` and/or `ref`. Status changes go through `resolve_review_item`.
- `delete_review_item(task_id, item_id)`  — hard-delete a review item (accidental duplicates only; real "skip" is `dismissed`).
- `append_changelog(kind, summary, refs?)`  — kind: feature | fix | refactor | note | decision
- `delete_changelog(entry_id)`  — hard-delete a changelog entry; use only for accidental noise (see `ways_of_working.md`)
- `bulk_update_tasks(patch, ids? | filter?)`  — apply the same patch to many tasks; returns `{updated, errors}` (per-record errors don't abort)
- `bulk_delete_tasks(ids? | filter?)`  — hard-delete matched tasks; refuses whole call if a matched task is depended on by an unmatched task
- `bulk_delete_changelog(ids? | filter?)`  — hard-delete matched changelog entries; same "accidental noise" spirit as `delete_changelog`
- `recent_changes(since?, kind?, limit?)`

Task fields: `status` ∈ {open, in_progress, blocked, on_hold, done, cancelled, wont_do}; `priority` ∈ {P0, P1, P2, P3} (default P2); `group` is an optional string. See `schema.md`.

Wire into Claude Code (`~/.claude.json` → `mcpServers`). Pass the script as an
absolute path — `uv run` only treats the arg as a script when it looks like a
path; otherwise it searches `PATH` for an executable named `server.py` and
fails with ENOENT when launched from a CWD outside `pm/`. Use absolute paths
for `command` too so the subprocess doesn't depend on Claude Code's launch
`PATH` (GUI launches often don't inherit the shell `PATH`).

```json
"pm": {
  "command": "/abs/path/to/uv",
  "args": ["run", "--group", "pm", "--project", "/abs/path/to/made-of/pm", "/abs/path/to/made-of/pm/server.py"]
}
```

Claude `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__pm__list_tasks",
      "mcp__pm__get_task",
      "mcp__pm__add_task",
      "mcp__pm__update_task",
      "mcp__pm__add_comment"
    ]
  }
}
```

Add MCP server to Claude
```bash
claude mcp add pm --scope local -- "$(command -v uv)" run --group pm --project /Users/tylerbikaun/Repos/made-of/pm /Users/tylerbikaun/Repos/made-of/pm/server.py
```