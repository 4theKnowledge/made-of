"""MCP server for pm/ tasks and changelog.

Exposes the same operations as pm/serve.py (HTTP), backed by the same store.py.
Runs over stdio — the transport Claude Code and other MCP clients speak.

Install:
    uv sync --group pm

Run standalone (rare — usually launched by an MCP client):
    uv run --group pm pm/server.py

Wire into Claude Code (~/.claude.json → mcpServers):
    "pm": {
        "command": "uv",
        "args": ["run", "--group", "pm", "--project", "/abs/path/to/made-of/pm",
                 "server.py"]
    }
"""

from __future__ import annotations

from mcp.server import MCPServer

import store

mcp = MCPServer(
    name="pm",
    instructions=(
        "Project management for the Made Of repo. Two stores: tasks (mutable, "
        "with status/tags/deps) and changelog (append-only). Use list_tasks "
        "with ready=true to find work whose deps are all done. Prefer that "
        "over browsing all open tasks."
    ),
)


# ─────────────────────────── tasks ───────────────────────────

@mcp.tool()
def list_tasks(
    status: str | None = None,
    tag: str | None = None,
    assignee: str | None = None,
    ready: bool | None = None,
    limit: int | None = None,
    group: str | None = None,
    priority: str | None = None,
    needs_review: bool | None = None,
    reviewed: bool | None = None,
    pinned: bool | None = None,
    parent_task_id: str | None = None,
    open_questions_for: str | None = None,
) -> list[dict]:
    """List tasks with optional filters.

    Args:
        status: one of open, in_progress, blocked, on_hold, done, cancelled, wont_do
        tag: match tasks containing this tag
        assignee: match by assignee string
        ready: true → only open tasks whose depends_on are all done
        limit: max rows to return
        group: match by group string (exact)
        priority: one of P0, P1, P2, P3
        needs_review: true → only tasks flagged for user review; false → only unflagged
        reviewed: true → only tasks the user has marked reviewed; false → only unreviewed
        pinned: true → only pinned tasks (user's personal shortlist); false → only unpinned
        parent_task_id: match children of this parent id. Pass "" (empty string) to match
            top-level tasks (parent is null). Omit / null to skip the filter.
        open_questions_for: match tasks with any unresolved question whose
            asked_of equals this value (e.g. "claude" or "user").
    """
    return store.list_tasks(
        status=status, tag=tag, assignee=assignee, ready=ready, limit=limit,
        group=group, priority=priority, needs_review=needs_review, reviewed=reviewed,
        pinned=pinned, parent_task_id=parent_task_id,
        open_questions_for=open_questions_for,
    )


@mcp.tool()
def get_task(task_id: str) -> dict | None:
    """Fetch one task by id (e.g. "T-0001"). Returns null if not found."""
    return store.get_task(task_id)


@mcp.tool()
def add_task(
    title: str,
    body: str | None = None,
    tags: list[str] | None = None,
    assignee: str | None = None,
    depends_on: list[str] | None = None,
    priority: str | None = None,
    group: str | None = None,
    pinned: bool = False,
    parent_task_id: str | None = None,
) -> dict:
    """Create a new task. Returns the created task with its allocated id.

    depends_on must reference existing task ids or the call errors.
    priority is one of P0/P1/P2/P3 (default P2). group is an optional label
    for logically grouping tasks together. pinned=true marks the task on
    the user's personal shortlist (orthogonal to priority).
    parent_task_id (optional) links this task as a subtask of another task —
    distinct from depends_on (which is ordering). Must reference an existing task.
    """
    return store.add_task(
        title=title, body=body, tags=tags, assignee=assignee,
        depends_on=depends_on, priority=priority, group=group, pinned=pinned,
        parent_task_id=parent_task_id,
    )


@mcp.tool()
def update_task(task_id: str, patch: dict) -> dict:
    """Mutate a task. patch may contain: status, title, body, tags, assignee,
    depends_on, priority, group, needs_review, reviewed_at, pinned, parent_task_id.

    status ∈ {open, in_progress, blocked, on_hold, done, cancelled, wont_do}.
    priority ∈ {P0, P1, P2, P3}. group is a free-form string or null to clear.
    reviewed_at is ISO-8601 UTC or null; the sentinel "now" sets to current UTC.
    pinned is a bool — user's personal shortlist flag, orthogonal to priority.
    Toggling pinned does NOT affect needs_review / reviewed_at.
    parent_task_id is a task id (str) or null to clear. Distinct from depends_on:
    parent = scope containment; depends_on = ordering. Cycles forbidden.

    Review-tracking semantics (see pm/ways_of_working.md):
      - Setting status=done auto-flags needs_review=true (unless patch sets it explicitly).
      - Setting reviewed_at to a non-null value auto-clears needs_review=false.
      - Any other mutation (except pinned) auto-clears reviewed_at=null (prior review is stale).

    Rejects unknown fields, bad status/priority values, unknown deps/parent, and cycles.
    """
    return store.update_task(task_id, patch)


@mcp.tool()
def bulk_update_tasks(
    patch: dict,
    ids: list[str] | None = None,
    filter: dict | None = None,
) -> dict:
    """Apply the same patch to every matched task.

    Selector: exactly one of `ids` (explicit list) or `filter` (dict of
    status/tag/assignee/group/priority/ready/needs_review/reviewed/pinned/parent_task_id —
    same keys as list_tasks; parent_task_id uses "" for top-level).
    Patch fields: title, body, status, tags, assignee, depends_on, priority, group,
    needs_review, reviewed_at, pinned, parent_task_id. Same review-tracking semantics as update_task.

    Returns {"updated": [task, ...], "errors": [{"id": ..., "error": ...}, ...]}.
    Per-record errors (unknown id, unknown dep/parent, cycle) do NOT abort the call —
    valid records still apply. Always list first to preview the match set.
    """
    return store.bulk_update_tasks(patch=patch, ids=ids, filter=filter)


@mcp.tool()
def bulk_delete_tasks(
    ids: list[str] | None = None,
    filter: dict | None = None,
) -> dict:
    """Hard-delete matched tasks. Selector: exactly one of `ids` or `filter`.

    Refuses the WHOLE call (raises) if any matched task is referenced by an
    unmatched task's `depends_on` or `parent_task_id`. Returns {"deleted": [id, ...]}.

    Destructive — prefer `ids` over `filter` so the match set is explicit.
    """
    return store.bulk_delete_tasks(ids=ids, filter=filter)


@mcp.tool()
def bulk_delete_changelog(
    ids: list[str] | None = None,
    filter: dict | None = None,
) -> dict:
    """Hard-delete matched changelog entries. Selector: exactly one of `ids`
    or `filter` (filter supports `kind` and `since`).

    Same "accidental noise" spirit as delete_changelog — use for smoke rows /
    bulk typo cleanup, not for retroactively rewriting history. For "changed
    my mind" cases, append a correction entry instead. Returns {"deleted": [id, ...]}.
    """
    return store.bulk_delete_changelog(ids=ids, filter=filter)


@mcp.tool()
def delete_task(task_id: str) -> dict:
    """Hard-delete a task. Returns the deleted record.

    Fails if any other task depends_on this one, or has it as a parent
    (reparent the subtasks first, or set the task's status to cancelled instead).
    """
    return store.delete_task(task_id)


@mcp.tool()
def add_comment(task_id: str, body: str, author: str | None = None) -> dict:
    """Append a comment to a task. Returns the updated task.

    Comments are inline on the task record: {ts, author, body}. Use these for
    discussion notes, blockers, or context that doesn't belong in the body.
    """
    return store.add_comment(task_id=task_id, body=body, author=author)


@mcp.tool()
def delete_comment(task_id: str, comment_ts: str) -> dict:
    """Hard-delete a comment on a task, keyed by its `ts`. Returns the updated task.

    Comments are the task's narrative record — deletion is destructive and there
    is no undo. Use only for accidental duplicates or content that shouldn't
    have been posted. Does NOT touch `needs_review` / `reviewed_at`.
    """
    return store.delete_comment(task_id=task_id, comment_ts=comment_ts)


# ──────────────────────── questions ────────────────────────
# Questions are a separate axis from comments (narrative log). Use questions
# when someone owes an answer; use comments for approach/landing/discussion.
# Mutating questions does NOT touch needs_review / reviewed_at.

@mcp.tool()
def add_question(
    task_id: str,
    question: str,
    asked_by: str | None = None,
    asked_of: str | None = None,
) -> dict:
    """Raise a question on a task. Returns the updated task.

    `asked_of` is who owes the answer (free-form; conventional values are
    "claude" and "user"). Filter tasks awaiting an answer from someone with
    list_tasks(open_questions_for="claude" | "user").
    """
    return store.add_question(
        task_id=task_id, question=question, asked_by=asked_by, asked_of=asked_of,
    )


@mcp.tool()
def answer_question(
    task_id: str,
    question_id: str,
    answer: str,
    answered_by: str | None = None,
) -> dict:
    """Record an answer on a question. Returns the updated task.

    Does not auto-resolve the question — call resolve_question to close it.
    Overwrites any prior answer (v1 has no answer thread).
    """
    return store.answer_question(
        task_id=task_id, question_id=question_id, answer=answer, answered_by=answered_by,
    )


@mcp.tool()
def resolve_question(
    task_id: str,
    question_id: str,
    resolved: bool = True,
) -> dict:
    """Resolve (default) or reopen (resolved=false) a question. Returns the updated task."""
    return store.resolve_question(
        task_id=task_id, question_id=question_id, resolved=resolved,
    )


@mcp.tool()
def delete_question(task_id: str, question_id: str) -> dict:
    """Hard-delete a question from a task. Returns the updated task."""
    return store.delete_question(task_id=task_id, question_id=question_id)


# ──────────────────────── review items ────────────────────────
# Structured review checklist per task. Prefer this over just flipping
# needs_review on landing: the checklist tells the reviewer *what* to check,
# and its resolution auto-clears the flag. Items are per-task ("R1", "R2").

@mcp.tool()
def add_review_item(
    task_id: str,
    body: str,
    ref: str | None = None,
    author: str | None = None,
) -> dict:
    """Add a review checklist item to a task. Returns the updated task.

    Use this on task landing (alongside the landing comment) to author the
    review agenda — one item per thing the user should eyeball. `ref` is a
    free-form pointer (e.g. "src/app/combine/page.tsx:142", a file:line, a
    test name); optional.

    Adding an item clears `reviewed_at` if it was set (a new item invalidates
    a prior review). Does NOT set needs_review — that's set by add_comment /
    status=done in the same landing flow.
    """
    return store.add_review_item(task_id=task_id, body=body, ref=ref, author=author)


@mcp.tool()
def resolve_review_item(
    task_id: str,
    item_id: str,
    status: str,
    resolved_by: str | None = None,
) -> dict:
    """Resolve or reopen a review item. Returns the updated task.

    status ∈ {checked, dismissed, open}. `checked` = verified. `dismissed` =
    read and decided not worth checking. `open` = reopen.

    Auto-clear: resolving the last open item on a task with needs_review=true
    clears the flag and stamps reviewed_at=now (the checklist IS the review).
    """
    return store.resolve_review_item(
        task_id=task_id, item_id=item_id, status=status, resolved_by=resolved_by,
    )


@mcp.tool()
def update_review_item(task_id: str, item_id: str, patch: dict) -> dict:
    """Edit body/ref of a review item. Returns the updated task.

    patch may contain `body` (non-empty str) and/or `ref` (str or null).
    Status changes go through resolve_review_item so the auto-clear rule
    applies consistently.
    """
    return store.update_review_item(task_id=task_id, item_id=item_id, patch=patch)


@mcp.tool()
def delete_review_item(task_id: str, item_id: str) -> dict:
    """Hard-delete a review item. Returns the updated task.

    Use only for accidental duplicates — real "not worth checking" is
    resolve_review_item(status="dismissed"), not delete.
    """
    return store.delete_review_item(task_id=task_id, item_id=item_id)


# ──────────────────────── changelog ────────────────────────

@mcp.tool()
def delete_changelog(entry_id: str) -> dict:
    """Hard-delete a changelog entry. Returns the deleted record.

    Use only for genuine noise (smoke-test rows, typos, wrong refs before
    anyone acted on them). For "changed my mind" cases, append a correction
    entry instead — the changelog is append-only in spirit.
    """
    return store.delete_changelog(entry_id)


@mcp.tool()
def append_changelog(kind: str, summary: str, refs: dict | None = None) -> dict:
    """Append a changelog entry.

    Args:
        kind: one of feature, fix, refactor, note, decision
        summary: one-line description
        refs: optional dict of pointers, e.g. {"task": "T-0001", "commit": "abc1234"}
    """
    return store.append_changelog(kind=kind, summary=summary, refs=refs)


@mcp.tool()
def recent_changes(
    since: str | None = None,
    kind: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """List changelog entries, newest first.

    Args:
        since: ISO-8601 UTC timestamp; entries at or after this time
        kind: filter by kind
        limit: max rows to return
    """
    return store.recent_changes(since=since, kind=kind, limit=limit)


def main():
    mcp.run()


if __name__ == "__main__":
    main()
