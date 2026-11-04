# pm/ record schemas

Both files are JSONL: one JSON object per line, UTF-8, LF-terminated.
Timestamps are ISO-8601 UTC (`2026-08-15T14:22:00Z`).

## tasks.jsonl

Mutable. Rewritten in place on update (single-writer assumption).

```json
{
  "id": "T-0001",
  "title": "short imperative summary",
  "body": "optional longer description, markdown ok",
  "status": "open",
  "priority": "P2",
  "group": "network-refactor",
  "tags": ["engine", "movement"],
  "assignee": "claude",
  "depends_on": ["T-0003", "T-0007"],
  "parent_task_id": null,
  "comments": [
    {"ts": "2026-08-16T09:10:00Z", "author": "claude", "body": "blocked on T-0007"}
  ],
  "questions": [
    {
      "id": "Q1",
      "question": "should this include a fallback?",
      "asked_by": "user",
      "asked_at": "2026-08-16T09:20:00Z",
      "asked_of": "claude",
      "answer": null,
      "answered_by": null,
      "answered_at": null,
      "resolved": false
    }
  ],
  "review_items": [
    {
      "id": "R1",
      "body": "verify goto_previous edge case",
      "ref": "src/app/combine/page.tsx:142",
      "author": "claude",
      "created_at": "2026-08-16T09:15:00Z",
      "status": "open",
      "resolved_by": null,
      "resolved_at": null
    }
  ],
  "needs_review": true,
  "reviewed_at": null,
  "pinned": false,
  "created_at": "2026-08-15T14:22:00Z",
  "updated_at": "2026-08-15T14:22:00Z"
}
```

- `id` — monotonic `T-####`. Allocated by `store.py`.
- `status` — one of `open`, `in_progress`, `blocked`, `on_hold`, `done`, `cancelled`, `wont_do`. `on_hold` is for work that's paused deliberately (unlike `blocked`, which implies an external dependency). `wont_do` is for a deliberate "no" — the task represents a decision **not** to do the work (distinct from `cancelled`, which is work that was started or filed and later abandoned). The body should capture the rationale.
- `priority` — one of `P0` (critical), `P1` (high), `P2` (normal, default), `P3` (low).
- `group` — optional free-form string for logically grouping related tasks (e.g. `"network-refactor"`, `"traffic-scenarios"`). `null` = ungrouped. Distinct from `tags`: tags are many-per-task; a task belongs to at most one group.
- `tags` — free-form; keep short. Used by `list_tasks(tag=...)`.
- `assignee` — free-form string. `null` = unassigned.
- `depends_on` — list of task ids that must be `done` before this task is ready. Empty list = no deps. A task is "ready" when status is `open` and every dep resolves to a `done` task. Missing/unknown ids are treated as not-done (ready=false). Cycles are the caller's problem — `store.py` refuses to add a dep that would close one. Distinct from `parent_task_id` below: `depends_on` is *ordering* ("A finishes before B starts"), `parent_task_id` is *scope containment* ("B is a subtask of A").
- `parent_task_id` — optional task id or `null`. Marks this task as a subtask of another. Distinct from `depends_on`: a subtask doesn't have to wait for its parent to be `done` — parents are typically tracking wrappers whose status is manual (they can stay `open` while their subtasks land, or close before all subtasks are done). Validated at add/update: must reference an existing task; cycles forbidden (self-parenting, two-cycles, deeper chains all rejected). At most one parent — multi-parent belongs in `tags`. Deleting a task that has subtasks errors; reparent (or clear) the children first. `list_tasks(parent_task_id="<id>")` filters to children of that parent; the empty-string sentinel `parent_task_id=""` filters to top-level tasks (parent is null). Passing `None` (default) skips the filter. Task records written before this field existed are treated as `parent_task_id=null`.
- `comments` — inline (almost) append-only list of `{ts, author, body}`. Add via `add_comment(task_id, body, author?)`. Deletion is possible via `delete_comment(task_id, comment_ts)` — hard-delete keyed by the comment's ISO `ts`; use only for accidental duplicates or content that shouldn't have been posted, since comments are the task's narrative record and there's no undo. `delete_comment` does not touch `needs_review` / `reviewed_at`.
- `questions` — inline list of `{id, question, asked_by, asked_at, asked_of, answer, answered_by, answered_at, resolved}`. Ids are per-task monotonic (`Q1`, `Q2`, …). Distinct from comments: **comments are narrative** (approach / landing / discussion), **questions are actionable state** (someone owes an answer; unresolved questions surface as a `?N` badge on the task list). `asked_of` names who owes the answer (conventional values: `"claude"`, `"user"`, or `null` for "anyone"); filter with `list_tasks(open_questions_for=<who>)`. `resolved` is a bool; setting `answer` does NOT auto-resolve — answer and resolve are independent steps (you can answer and leave open for follow-up, or resolve without an answer for "moot"). **Question mutations do NOT touch `needs_review` / `reviewed_at`** — questions are a separate inbox axis. Ops: `add_question`, `answer_question`, `resolve_question`, `delete_question`. Task records written before this field existed are treated as `questions=[]`.
- `review_items` — inline list of `{id, body, ref, author, created_at, status, resolved_by, resolved_at}`. Ids are per-task monotonic (`R1`, `R2`, …). A **structured review checklist**: the agent authors items on landing (one per thing the user should eyeball); the user resolves them individually. `status ∈ {open, checked, dismissed}` — `checked` = verified, `dismissed` = read and decided not worth checking (both terminal). `ref` is a free-form pointer (e.g. `"src/app/combine/page.tsx:142"`, a file:line, a test name) or `null`. Ops: `add_review_item`, `resolve_review_item`, `update_review_item` (body/ref only — status goes through resolve), `delete_review_item` (accidental duplicates only; real "skip" is `dismissed`). **Interaction with review-tracking:**
  - Adding an item on an already-reviewed task clears `reviewed_at` (a new item invalidates a prior review).
  - Resolving the last open item on a task with `needs_review=true` auto-clears the flag and stamps `reviewed_at=now` — the checklist IS the explicit review act.
  - Otherwise, review-item mutations do not touch `needs_review` / `reviewed_at`.
  - A task with zero items behaves exactly like today (manual flag/reviewed_at semantics via `add_comment` / `update_task`).
  - Task records written before this field existed are treated as `review_items=[]`.
- `needs_review` — bool, default `false`. Agent inbox flag: the user's queue of "something changed here I should look at". Auto-set to `true` when an agent (author `null` or `"claude"`) adds a comment, or when any caller sets `status=done`. The user clears it by patching `needs_review=false` (marking `reviewed_at` also clears it, and resolving the last open review item auto-clears it — see below).
- `reviewed_at` — ISO-8601 UTC timestamp or `null`. Set by the user to record "I've looked at the current state." Semantics:
  - Setting `reviewed_at` to a non-null value auto-clears `needs_review=false` (a review acknowledges the flag).
  - Any mutation to the task (via `update_task` / `bulk_update_tasks` / `add_comment`) that doesn't itself set `reviewed_at` auto-clears it to `null` — the prior review is stale by definition. **Exception:** toggling `pinned` alone does not stale a prior review (pinning is a personal shortlist marker, not a content change).
  - Convenience: `update_task(id, {"reviewed_at": "now"})` sets it to the current UTC timestamp.
- `pinned` — bool, default `false`. User's personal shortlist / "look at next" marker. Orthogonal to `priority` (which is objective urgency): pinning a `P2` doesn't promote it, it just bookmarks it. Toggling `pinned` does **not** touch `needs_review` or `reviewed_at`. Filter via `list_tasks(pinned=True)`. Task records written before this field existed are treated as `pinned=false`.

## changelog.jsonl

Append-only. Never rewritten.

```json
{
  "id": "C-0001",
  "ts": "2026-08-15T14:22:00Z",
  "kind": "feature",
  "summary": "one-line description",
  "refs": {"task": "T-0001", "commit": "abc1234", "pr": 42}
}
```

- `kind` — one of `feature`, `fix`, `refactor`, `note`, `decision`.
- `refs` — optional pointers. All fields optional; include what applies.
