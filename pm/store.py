"""JSONL read/write helpers for pm/ tasks and changelog.

Single source of truth for both the MCP server (server.py) and the HTTP
write-server (serve.py). All mutations go through here.

Concurrency: fcntl.flock on the target file for the whole read-modify-write.
Atomicity: writes go to a tempfile in the same dir, then os.replace.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

PM_DIR = Path(__file__).parent
TASKS_PATH = PM_DIR / "tasks.jsonl"
CHANGELOG_PATH = PM_DIR / "changelog.jsonl"

TASK_STATUSES = {"open", "in_progress", "blocked", "on_hold", "done", "cancelled", "wont_do"}
CHANGELOG_KINDS = {"feature", "fix", "refactor", "note", "decision"}
REVIEW_ITEM_STATUSES = {"open", "checked", "dismissed"}

# P0 = highest urgency, P3 = lowest. Default is P2.
TASK_PRIORITIES = {
    "P0": "critical — drop other work",
    "P1": "high — schedule this soon",
    "P2": "normal — default",
    "P3": "low — nice to have",
}
DEFAULT_PRIORITY = "P2"


class StoreError(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_all(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _write_all(path: Path, records: list[dict]) -> None:
    # Tempfile in same dir so os.replace is atomic (same filesystem).
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        os.replace(tmp_path, path)
    except Exception:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp_path)
        raise


def _append_one(path: Path, record: dict) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


@contextlib.contextmanager
def _locked(path: Path):
    """Exclusive lock on the target file for the whole read-modify-write.

    Opens (creating if needed) and flocks; releases on exit. The lock is
    advisory and cooperative — only holds against other flock users.
    """
    path.touch(exist_ok=True)
    with path.open("r+", encoding="utf-8") as lock_f:
        fcntl.flock(lock_f.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_f.fileno(), fcntl.LOCK_UN)


def _next_id(records: list[dict], prefix: str) -> str:
    max_n = 0
    for r in records:
        rid = r.get("id", "")
        if rid.startswith(prefix + "-"):
            with contextlib.suppress(ValueError):
                max_n = max(max_n, int(rid.split("-", 1)[1]))
    return f"{prefix}-{max_n + 1:04d}"


def _apply_review_semantics(target: dict, patch: dict) -> dict:
    """Normalize `needs_review` / `reviewed_at` in a patch before it's applied.

    - `reviewed_at: "now"` → current UTC timestamp.
    - If patch sets `reviewed_at` to a non-null value and doesn't explicitly set
      `needs_review`, force `needs_review=False` (review acknowledges the flag).
    - If the patch mutates the task (any field other than reviewed_at itself)
      and doesn't explicitly set `reviewed_at`, clear `reviewed_at=None` — the
      prior review is stale by definition.
    - If patch sets `"status": "done"` and doesn't explicitly set `needs_review`,
      set `needs_review=True` (the task just landed; user should look).

    Returns a new patch dict; does not mutate the input.
    """
    out = dict(patch)
    sets_reviewed_at = "reviewed_at" in out
    sets_needs_review = "needs_review" in out

    if sets_reviewed_at and out["reviewed_at"] == "now":
        out["reviewed_at"] = _now()

    if sets_reviewed_at and out["reviewed_at"] is not None and not sets_needs_review:
        out["needs_review"] = False
        sets_needs_review = True

    if out.get("status") == "done" and not sets_needs_review:
        out["needs_review"] = True
        sets_needs_review = True

    mutates_other_fields = any(k for k in out if k not in ("reviewed_at", "pinned"))
    if mutates_other_fields and not sets_reviewed_at and target.get("reviewed_at") is not None:
        out["reviewed_at"] = None

    return out


def _would_cycle(tasks_by_id: dict[str, dict], task_id: str, new_deps: list[str]) -> bool:
    """True if adding new_deps to task_id would create a cycle."""
    for dep in new_deps:
        if dep == task_id:
            return True
        # Walk dep's transitive deps; if we hit task_id, it's a cycle.
        seen: set[str] = set()
        stack = [dep]
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            if cur == task_id:
                return True
            node = tasks_by_id.get(cur)
            if node:
                stack.extend(node.get("depends_on") or [])
    return False


def _would_parent_cycle(tasks_by_id: dict[str, dict], task_id: str, new_parent: str) -> bool:
    """True if setting task_id.parent = new_parent would create a cycle.

    Walks the parent chain up from new_parent; if we hit task_id, it's a cycle.
    Self-parenting (new_parent == task_id) is also a cycle.
    """
    if new_parent == task_id:
        return True
    seen: set[str] = set()
    cur: str | None = new_parent
    while cur is not None:
        if cur in seen:
            return False  # unrelated cycle in existing data; don't add to it, but not our fault
        seen.add(cur)
        if cur == task_id:
            return True
        node = tasks_by_id.get(cur)
        cur = node.get("parent_task_id") if node else None
    return False


# ─────────────────────────── tasks ───────────────────────────

def _has_open_question_for(task: dict, who: str) -> bool:
    for q in task.get("questions") or []:
        if q.get("resolved"):
            continue
        if (q.get("asked_of") or None) == who:
            return True
    return False


def list_tasks(status=None, tag=None, assignee=None, ready=None, limit=None,
               group=None, priority=None, needs_review=None, reviewed=None,
               pinned=None, parent_task_id=None, open_questions_for=None) -> list[dict]:
    """List tasks with optional filters.

    parent_task_id sentinel: pass an id ("T-0184") to match children of that
    parent. Pass the empty string "" to match top-level tasks (parent is null).
    Pass None (default) to skip the filter entirely.

    open_questions_for: pass a name (e.g. "claude", "user") to filter to tasks
    that have at least one unresolved question with asked_of == that name.
    """
    records = _read_all(TASKS_PATH)
    by_id = {r["id"]: r for r in records}

    def is_ready(t):
        if t.get("status") != "open":
            return False
        for d in t.get("depends_on") or []:
            dep = by_id.get(d)
            if not dep or dep.get("status") != "done":
                return False
        return True

    out = []
    for t in records:
        if status is not None and t.get("status") != status:
            continue
        if tag is not None and tag not in (t.get("tags") or []):
            continue
        if assignee is not None and t.get("assignee") != assignee:
            continue
        if group is not None and t.get("group") != group:
            continue
        if priority is not None and (t.get("priority") or DEFAULT_PRIORITY) != priority:
            continue
        if ready is True and not is_ready(t):
            continue
        if ready is False and is_ready(t):
            continue
        if needs_review is not None and bool(t.get("needs_review")) != needs_review:
            continue
        if reviewed is not None and (t.get("reviewed_at") is not None) != reviewed:
            continue
        if pinned is not None and bool(t.get("pinned")) != pinned:
            continue
        if parent_task_id is not None:
            want = parent_task_id or None  # "" → match null
            if t.get("parent_task_id") != want:
                continue
        if open_questions_for is not None and not _has_open_question_for(t, open_questions_for):
            continue
        out.append(t)

    if limit is not None:
        out = out[:limit]
    return out


def get_task(task_id: str) -> dict | None:
    for t in _read_all(TASKS_PATH):
        if t.get("id") == task_id:
            return t
    return None


def add_task(title: str, body=None, tags=None, assignee=None, depends_on=None,
             priority=None, group=None, pinned=False, parent_task_id=None) -> dict:
    if not title or not title.strip():
        raise StoreError("title is required")
    if priority is not None and priority not in TASK_PRIORITIES:
        raise StoreError(f"bad priority: {priority}")
    if not isinstance(pinned, bool):
        raise StoreError(f"pinned must be bool: {pinned!r}")
    if parent_task_id is not None and not isinstance(parent_task_id, str):
        raise StoreError(f"parent_task_id must be str or null: {parent_task_id!r}")
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        for d in depends_on or []:
            if d not in by_id:
                raise StoreError(f"unknown dep: {d}")
        if parent_task_id is not None and parent_task_id not in by_id:
            raise StoreError(f"unknown parent: {parent_task_id}")
        now = _now()
        task = {
            "id": _next_id(records, "T"),
            "title": title.strip(),
            "body": body or "",
            "status": "open",
            "priority": priority or DEFAULT_PRIORITY,
            "group": (group or "").strip() or None,
            "tags": list(tags or []),
            "assignee": assignee,
            "depends_on": list(depends_on or []),
            "parent_task_id": parent_task_id,
            "comments": [],
            "questions": [],
            "review_items": [],
            "needs_review": False,
            "reviewed_at": None,
            "pinned": pinned,
            "created_at": now,
            "updated_at": now,
        }
        records.append(task)
        _write_all(TASKS_PATH, records)
    return task


def update_task(task_id: str, patch: dict) -> dict:
    _validate_task_patch(patch)

    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        if "depends_on" in patch:
            new_deps = list(patch["depends_on"] or [])
            for d in new_deps:
                if d not in by_id:
                    raise StoreError(f"unknown dep: {d}")
            if _would_cycle(by_id, task_id, new_deps):
                raise StoreError("dep would create a cycle")
            patch = {**patch, "depends_on": new_deps}
        if "parent_task_id" in patch:
            new_parent = patch["parent_task_id"]
            if new_parent is not None:
                if new_parent not in by_id:
                    raise StoreError(f"unknown parent: {new_parent}")
                if _would_parent_cycle(by_id, task_id, new_parent):
                    raise StoreError("parent would create a cycle")
        if "group" in patch:
            g = patch["group"]
            patch = {**patch, "group": (g or "").strip() or None if isinstance(g, str) else g}
        target = by_id[task_id]
        patch = _apply_review_semantics(target, patch)
        target.update(patch)
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


def _resolve_selector(ids, filter, kind: str):
    """Normalize selector inputs. Exactly one of `ids` / `filter` must be provided.

    Returns (mode, value) — mode ∈ {"ids", "filter"}; value is the list-or-dict.
    `kind` is "task" or "changelog" for error phrasing.
    """
    has_ids = ids is not None
    has_filter = filter is not None
    if has_ids == has_filter:
        raise StoreError(
            f"exactly one of ids or filter required for bulk {kind} op"
        )
    if has_ids:
        if not isinstance(ids, (list, tuple)) or not all(isinstance(i, str) for i in ids):
            raise StoreError("ids must be a list of strings")
        return "ids", list(ids)
    if not isinstance(filter, dict):
        raise StoreError("filter must be a dict")
    return "filter", dict(filter)


def _match_tasks(records: list[dict], sel_mode: str, sel_value) -> list[dict]:
    """Apply a resolved selector to task records, preserving file order."""
    if sel_mode == "ids":
        wanted = set(sel_value)
        return [r for r in records if r["id"] in wanted]
    # filter: reuse list_tasks predicates. Compute ready over the *full* set
    # so deps resolve correctly even if the matcher narrows to a subset.
    by_id = {r["id"]: r for r in records}

    def is_ready(t):
        if t.get("status") != "open":
            return False
        for d in t.get("depends_on") or []:
            dep = by_id.get(d)
            if not dep or dep.get("status") != "done":
                return False
        return True

    f = sel_value
    status = f.get("status")
    tag = f.get("tag")
    assignee = f.get("assignee")
    group = f.get("group")
    priority = f.get("priority")
    ready = f.get("ready")
    needs_review = f.get("needs_review")
    reviewed = f.get("reviewed")
    pinned = f.get("pinned")

    unknown = set(f) - {"status", "tag", "assignee", "group", "priority", "ready",
                        "needs_review", "reviewed", "pinned", "parent_task_id",
                        "open_questions_for"}
    if unknown:
        raise StoreError(f"unknown filter keys: {sorted(unknown)}")

    parent_task_id = f.get("parent_task_id")
    open_questions_for = f.get("open_questions_for")

    out = []
    for t in records:
        if status is not None and t.get("status") != status:
            continue
        if tag is not None and tag not in (t.get("tags") or []):
            continue
        if assignee is not None and t.get("assignee") != assignee:
            continue
        if group is not None and t.get("group") != group:
            continue
        if priority is not None and (t.get("priority") or DEFAULT_PRIORITY) != priority:
            continue
        if ready is True and not is_ready(t):
            continue
        if ready is False and is_ready(t):
            continue
        if needs_review is not None and bool(t.get("needs_review")) != needs_review:
            continue
        if reviewed is not None and (t.get("reviewed_at") is not None) != reviewed:
            continue
        if pinned is not None and bool(t.get("pinned")) != pinned:
            continue
        if parent_task_id is not None:
            want = parent_task_id or None
            if t.get("parent_task_id") != want:
                continue
        if open_questions_for is not None and not _has_open_question_for(t, open_questions_for):
            continue
        out.append(t)
    return out


def _match_changelog(records: list[dict], sel_mode: str, sel_value) -> list[dict]:
    if sel_mode == "ids":
        wanted = set(sel_value)
        return [r for r in records if r["id"] in wanted]
    f = sel_value
    unknown = set(f) - {"kind", "since"}
    if unknown:
        raise StoreError(f"unknown filter keys: {sorted(unknown)}")
    kind = f.get("kind")
    since = f.get("since")
    out = []
    for r in records:
        if kind is not None and r.get("kind") != kind:
            continue
        if since is not None and (r.get("ts") or "") < since:
            continue
        out.append(r)
    return out


def _validate_task_patch(patch: dict) -> None:
    """Shared validation for update_task + bulk_update_tasks (per-record checks
    that don't need to know about the record). Dep-cycle checks are per-record
    and stay inline.
    """
    allowed = {"title", "body", "status", "tags", "assignee", "depends_on", "priority",
               "group", "needs_review", "reviewed_at", "pinned", "parent_task_id"}
    unknown = set(patch) - allowed
    if unknown:
        raise StoreError(f"unknown fields: {sorted(unknown)}")
    if "status" in patch and patch["status"] not in TASK_STATUSES:
        raise StoreError(f"bad status: {patch['status']}")
    if "priority" in patch and patch["priority"] not in TASK_PRIORITIES:
        raise StoreError(f"bad priority: {patch['priority']}")
    if "needs_review" in patch and not isinstance(patch["needs_review"], bool):
        raise StoreError(f"needs_review must be bool: {patch['needs_review']!r}")
    if "pinned" in patch and not isinstance(patch["pinned"], bool):
        raise StoreError(f"pinned must be bool: {patch['pinned']!r}")
    if "reviewed_at" in patch:
        v = patch["reviewed_at"]
        if v is not None and not isinstance(v, str):
            raise StoreError(f"reviewed_at must be str or null: {v!r}")
    if "parent_task_id" in patch:
        v = patch["parent_task_id"]
        if v is not None and not isinstance(v, str):
            raise StoreError(f"parent_task_id must be str or null: {v!r}")


def bulk_update_tasks(patch: dict, ids=None, filter=None) -> dict:
    """Apply the same patch to every matched task.

    Selector: exactly one of `ids` or `filter` (see `list_tasks` for filter keys,
    plus `ready`). Per-record errors (unknown id, cycle, unknown dep) are
    collected in the `errors` list; other records still apply. Returns
    `{"updated": [task, ...], "errors": [{"id": ..., "error": ...}, ...]}`.
    """
    sel_mode, sel_value = _resolve_selector(ids, filter, "task")
    _validate_task_patch(patch)

    updated: list[dict] = []
    errors: list[dict] = []
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}

        # For explicit-id mode, report unknown ids as errors (don't silently drop).
        if sel_mode == "ids":
            for want in sel_value:
                if want not in by_id:
                    errors.append({"id": want, "error": "unknown task"})
            matched = [by_id[i] for i in sel_value if i in by_id]
        else:
            matched = _match_tasks(records, sel_mode, sel_value)

        now = _now()
        for target in matched:
            local_patch = dict(patch)
            if "depends_on" in local_patch:
                new_deps = list(local_patch["depends_on"] or [])
                bad_dep = next((d for d in new_deps if d not in by_id), None)
                if bad_dep is not None:
                    errors.append({"id": target["id"], "error": f"unknown dep: {bad_dep}"})
                    continue
                if _would_cycle(by_id, target["id"], new_deps):
                    errors.append({"id": target["id"], "error": "dep would create a cycle"})
                    continue
                local_patch["depends_on"] = new_deps
            if "parent_task_id" in local_patch:
                new_parent = local_patch["parent_task_id"]
                if new_parent is not None:
                    if new_parent not in by_id:
                        errors.append({"id": target["id"], "error": f"unknown parent: {new_parent}"})
                        continue
                    if _would_parent_cycle(by_id, target["id"], new_parent):
                        errors.append({"id": target["id"], "error": "parent would create a cycle"})
                        continue
            if "group" in local_patch:
                g = local_patch["group"]
                if isinstance(g, str):
                    local_patch["group"] = g.strip() or None
            local_patch = _apply_review_semantics(target, local_patch)
            target.update(local_patch)
            target["updated_at"] = now
            updated.append(target)

        if updated:
            _write_all(TASKS_PATH, records)
    return {"updated": updated, "errors": errors}


def bulk_delete_tasks(ids=None, filter=None) -> dict:
    """Hard-delete matched tasks. Refuses the whole call if any matched task is
    referenced by an *unmatched* task's `depends_on` (mirrors single delete).

    Returns `{"deleted": [id, ...]}`.
    """
    sel_mode, sel_value = _resolve_selector(ids, filter, "task")
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}

        if sel_mode == "ids":
            missing = [i for i in sel_value if i not in by_id]
            if missing:
                raise StoreError(f"unknown tasks: {missing}")
            matched_ids = set(sel_value)
        else:
            matched_ids = {t["id"] for t in _match_tasks(records, sel_mode, sel_value)}

        if not matched_ids:
            return {"deleted": []}

        # Any unmatched task that depends on or is parented by a matched task blocks the whole op.
        blockers = []
        for r in records:
            if r["id"] in matched_ids:
                continue
            for d in r.get("depends_on") or []:
                if d in matched_ids:
                    blockers.append({"referrer": r["id"], "target": d, "via": "depends_on"})
            pt = r.get("parent_task_id")
            if pt in matched_ids:
                blockers.append({"referrer": r["id"], "target": pt, "via": "parent_task_id"})
        if blockers:
            raise StoreError(f"tasks are referenced by unmatched tasks: {blockers}")

        deleted = [r["id"] for r in records if r["id"] in matched_ids]
        records = [r for r in records if r["id"] not in matched_ids]
        _write_all(TASKS_PATH, records)
    return {"deleted": deleted}


def bulk_delete_changelog(ids=None, filter=None) -> dict:
    """Hard-delete matched changelog entries. Filter supports `kind` and `since`.

    Same "accidental noise" spirit as single delete — the caller owns the
    confirm burden. Returns `{"deleted": [id, ...]}`.
    """
    sel_mode, sel_value = _resolve_selector(ids, filter, "changelog")
    with _locked(CHANGELOG_PATH):
        records = _read_all(CHANGELOG_PATH)
        by_id = {r["id"]: r for r in records}

        if sel_mode == "ids":
            missing = [i for i in sel_value if i not in by_id]
            if missing:
                raise StoreError(f"unknown changelog entries: {missing}")
            matched_ids = set(sel_value)
        else:
            matched_ids = {r["id"] for r in _match_changelog(records, sel_mode, sel_value)}

        if not matched_ids:
            return {"deleted": []}
        deleted = [r["id"] for r in records if r["id"] in matched_ids]
        records = [r for r in records if r["id"] not in matched_ids]
        _write_all(CHANGELOG_PATH, records)
    return {"deleted": deleted}


def delete_task(task_id: str) -> dict:
    """Hard-delete a task. Errors if any other task depends_on it or has it as parent."""
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        referrers = [r["id"] for r in records if task_id in (r.get("depends_on") or [])]
        if referrers:
            raise StoreError(f"task is referenced by: {referrers}")
        subtasks = [r["id"] for r in records if r.get("parent_task_id") == task_id]
        if subtasks:
            raise StoreError(f"task has subtasks: {subtasks}")
        target = by_id[task_id]
        records = [r for r in records if r["id"] != task_id]
        _write_all(TASKS_PATH, records)
    return target


def add_comment(task_id: str, body: str, author: str | None = None) -> dict:
    """Append a comment to a task. Returns the updated task.

    Agent comments (author is None or "claude") set `needs_review=True` and
    clear `reviewed_at`. Human comments (any other author) leave both alone.
    """
    if not body or not body.strip():
        raise StoreError("comment body is required")
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        target = by_id[task_id]
        comments = list(target.get("comments") or [])
        comments.append({
            "ts": _now(),
            "author": author,
            "body": body.strip(),
        })
        target["comments"] = comments
        if author is None or author == "claude":
            target["needs_review"] = True
            target["reviewed_at"] = None
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


def delete_comment(task_id: str, comment_ts: str) -> dict:
    """Hard-delete a comment on a task, keyed by its `ts`. Returns the updated task.

    Use only for accidental duplicates or content that shouldn't have been
    posted. Comments are the task's narrative record — deletion is destructive
    and there's no undo. Does NOT touch `needs_review` / `reviewed_at`: removing
    a comment isn't a review action, it's housekeeping.
    """
    if not comment_ts or not comment_ts.strip():
        raise StoreError("comment_ts is required")
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        target = by_id[task_id]
        comments = list(target.get("comments") or [])
        if not any(c.get("ts") == comment_ts for c in comments):
            raise StoreError(f"unknown comment ts: {comment_ts}")
        target["comments"] = [c for c in comments if c.get("ts") != comment_ts]
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


# ──────────────────────── questions ────────────────────────
# Questions are actionable state on a task, distinct from comments (narrative).
# Each question is {id, question, asked_by, asked_at, asked_of, answer,
# answered_by, answered_at, resolved}. Ids are per-task monotonic ("Q1", "Q2").
# Question mutations bump `updated_at` but intentionally DO NOT touch
# `needs_review` / `reviewed_at` — questions are a separate inbox axis. (An
# unanswered question `asked_of: user` doesn't mean the task's *contents*
# changed, so the review-tracking flags shouldn't fire.)

def _next_question_id(questions: list[dict]) -> str:
    max_n = 0
    for q in questions:
        qid = q.get("id") or ""
        if qid.startswith("Q"):
            with contextlib.suppress(ValueError):
                max_n = max(max_n, int(qid[1:]))
    return f"Q{max_n + 1}"


def _find_question(questions: list[dict], qid: str) -> dict | None:
    for q in questions:
        if q.get("id") == qid:
            return q
    return None


def add_question(task_id: str, question: str, asked_by: str | None = None,
                 asked_of: str | None = None) -> dict:
    """Append a question to a task. Returns the updated task.

    `asked_of` is who owes the answer (free-form; conventional values are
    "claude" and "user"). Question mutations do NOT touch needs_review /
    reviewed_at — questions are a separate inbox axis (see module docstring
    above `_next_question_id`).
    """
    if not question or not question.strip():
        raise StoreError("question is required")
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        target = by_id[task_id]
        questions = list(target.get("questions") or [])
        q = {
            "id": _next_question_id(questions),
            "question": question.strip(),
            "asked_by": asked_by,
            "asked_at": _now(),
            "asked_of": asked_of,
            "answer": None,
            "answered_by": None,
            "answered_at": None,
            "resolved": False,
        }
        questions.append(q)
        target["questions"] = questions
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


def answer_question(task_id: str, question_id: str, answer: str,
                    answered_by: str | None = None) -> dict:
    """Record an answer on an existing question. Returns the updated task.

    Does not auto-resolve — callers can answer and leave open for follow-up,
    or resolve separately. Overwrites any existing answer (v1 has no answer
    thread).
    """
    if not answer or not answer.strip():
        raise StoreError("answer is required")
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        target = by_id[task_id]
        questions = list(target.get("questions") or [])
        q = _find_question(questions, question_id)
        if q is None:
            raise StoreError(f"unknown question: {question_id}")
        q["answer"] = answer.strip()
        q["answered_by"] = answered_by
        q["answered_at"] = _now()
        target["questions"] = questions
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


def resolve_question(task_id: str, question_id: str, resolved: bool = True) -> dict:
    """Mark a question resolved (default) or reopen it (resolved=False)."""
    if not isinstance(resolved, bool):
        raise StoreError(f"resolved must be bool: {resolved!r}")
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        target = by_id[task_id]
        questions = list(target.get("questions") or [])
        q = _find_question(questions, question_id)
        if q is None:
            raise StoreError(f"unknown question: {question_id}")
        q["resolved"] = resolved
        target["questions"] = questions
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


def delete_question(task_id: str, question_id: str) -> dict:
    """Hard-delete a question from a task. Returns the updated task."""
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        target = by_id[task_id]
        questions = list(target.get("questions") or [])
        if _find_question(questions, question_id) is None:
            raise StoreError(f"unknown question: {question_id}")
        target["questions"] = [q for q in questions if q.get("id") != question_id]
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


# ──────────────────────── review items ────────────────────────
# A structured review checklist per task, complementing the binary needs_review
# flag. Items are {id, body, ref, author, created_at, status, resolved_by,
# resolved_at}. status ∈ {open, checked, dismissed}. Ids are per-task monotonic
# ("R1", "R2", …).
#
# Interaction with review-tracking:
#   - Adding an item on an already-reviewed task clears reviewed_at (a new item
#     means the review is no longer complete).
#   - Resolving the last open item (via check or dismiss) on a task with
#     needs_review=True auto-clears the flag and stamps reviewed_at=now (the
#     checklist IS the explicit act of reviewing).
#   - Otherwise, review-item mutations do not touch needs_review / reviewed_at.
#
# A task with zero items behaves exactly like today — the flag is toggled by
# add_comment / status=done and cleared by the user marking reviewed_at.

def _next_review_item_id(items: list[dict]) -> str:
    max_n = 0
    for it in items:
        rid = it.get("id") or ""
        if rid.startswith("R"):
            with contextlib.suppress(ValueError):
                max_n = max(max_n, int(rid[1:]))
    return f"R{max_n + 1}"


def _find_review_item(items: list[dict], item_id: str) -> dict | None:
    for it in items:
        if it.get("id") == item_id:
            return it
    return None


def add_review_item(task_id: str, body: str, ref: str | None = None,
                    author: str | None = None) -> dict:
    """Append a review checklist item to a task. Returns the updated task.

    Clears `reviewed_at` if it was set (a new item means the prior review is
    no longer complete). Does not touch `needs_review` — the inbox flag is
    set by add_comment / status=done in the same landing flow.
    """
    if not body or not body.strip():
        raise StoreError("review item body is required")
    if ref is not None and not isinstance(ref, str):
        raise StoreError(f"ref must be str or null: {ref!r}")
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        target = by_id[task_id]
        items = list(target.get("review_items") or [])
        item = {
            "id": _next_review_item_id(items),
            "body": body.strip(),
            "ref": (ref or "").strip() or None if isinstance(ref, str) else None,
            "author": author,
            "created_at": _now(),
            "status": "open",
            "resolved_by": None,
            "resolved_at": None,
        }
        items.append(item)
        target["review_items"] = items
        if target.get("reviewed_at") is not None:
            target["reviewed_at"] = None
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


def resolve_review_item(task_id: str, item_id: str, status: str,
                        resolved_by: str | None = None) -> dict:
    """Resolve or reopen a review item. Returns the updated task.

    status ∈ {open, checked, dismissed}. `checked` / `dismissed` are terminal
    (both count as resolved for the auto-clear rule); `open` reopens.

    Auto-clear: when this call resolves the last open item on a task with
    needs_review=True, sets needs_review=False and reviewed_at=now — the
    checklist is the explicit review act.
    """
    if status not in REVIEW_ITEM_STATUSES:
        raise StoreError(f"bad review item status: {status}")
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        target = by_id[task_id]
        items = list(target.get("review_items") or [])
        it = _find_review_item(items, item_id)
        if it is None:
            raise StoreError(f"unknown review item: {item_id}")
        it["status"] = status
        if status == "open":
            it["resolved_by"] = None
            it["resolved_at"] = None
        else:
            it["resolved_by"] = resolved_by
            it["resolved_at"] = _now()
        target["review_items"] = items
        # Auto-clear rule: all items resolved + inbox flag set → mark reviewed.
        any_open = any(x.get("status") == "open" for x in items)
        if not any_open and target.get("needs_review"):
            target["needs_review"] = False
            target["reviewed_at"] = _now()
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


def update_review_item(task_id: str, item_id: str, patch: dict) -> dict:
    """Edit body/ref of a review item. Returns the updated task.

    Only `body` and `ref` are editable — status changes go through
    resolve_review_item so the auto-clear rule is applied consistently.
    """
    allowed = {"body", "ref"}
    unknown = set(patch) - allowed
    if unknown:
        raise StoreError(f"unknown fields: {sorted(unknown)}")
    if "body" in patch:
        v = patch["body"]
        if not isinstance(v, str) or not v.strip():
            raise StoreError("body must be a non-empty str")
    if "ref" in patch:
        v = patch["ref"]
        if v is not None and not isinstance(v, str):
            raise StoreError(f"ref must be str or null: {v!r}")
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        target = by_id[task_id]
        items = list(target.get("review_items") or [])
        it = _find_review_item(items, item_id)
        if it is None:
            raise StoreError(f"unknown review item: {item_id}")
        if "body" in patch:
            it["body"] = patch["body"].strip()
        if "ref" in patch:
            v = patch["ref"]
            it["ref"] = (v.strip() or None) if isinstance(v, str) else None
        target["review_items"] = items
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


def delete_review_item(task_id: str, item_id: str) -> dict:
    """Hard-delete a review item. Returns the updated task.

    Use only for accidental duplicates — "not worth checking" is `dismissed`,
    not delete. Deleting the last open item may satisfy the auto-clear
    condition; that runs here too.
    """
    with _locked(TASKS_PATH):
        records = _read_all(TASKS_PATH)
        by_id = {r["id"]: r for r in records}
        if task_id not in by_id:
            raise StoreError(f"unknown task: {task_id}")
        target = by_id[task_id]
        items = list(target.get("review_items") or [])
        if _find_review_item(items, item_id) is None:
            raise StoreError(f"unknown review item: {item_id}")
        items = [it for it in items if it.get("id") != item_id]
        target["review_items"] = items
        # If the deletion closes out the checklist and the inbox flag is set,
        # honour the auto-clear (the pending items are gone, nothing left to review).
        if items and not any(x.get("status") == "open" for x in items) and target.get("needs_review"):
            target["needs_review"] = False
            target["reviewed_at"] = _now()
        target["updated_at"] = _now()
        _write_all(TASKS_PATH, records)
    return target


# ──────────────────────── changelog ────────────────────────

def append_changelog(kind: str, summary: str, refs=None) -> dict:
    if kind not in CHANGELOG_KINDS:
        raise StoreError(f"bad kind: {kind}")
    if not summary or not summary.strip():
        raise StoreError("summary is required")
    with _locked(CHANGELOG_PATH):
        records = _read_all(CHANGELOG_PATH)
        entry = {
            "id": _next_id(records, "C"),
            "ts": _now(),
            "kind": kind,
            "summary": summary.strip(),
            "refs": dict(refs or {}),
        }
        _append_one(CHANGELOG_PATH, entry)
    return entry


def delete_changelog(entry_id: str) -> dict:
    """Hard-delete a changelog entry. Returns the deleted record.

    The changelog is append-only *in spirit* — use this only for genuine noise
    (smoke-test rows, typos, wrong refs before anyone acted on them). For
    "changed my mind" cases, append a correction/retraction entry instead.
    """
    with _locked(CHANGELOG_PATH):
        records = _read_all(CHANGELOG_PATH)
        by_id = {r["id"]: r for r in records}
        if entry_id not in by_id:
            raise StoreError(f"unknown changelog entry: {entry_id}")
        target = by_id[entry_id]
        records = [r for r in records if r["id"] != entry_id]
        _write_all(CHANGELOG_PATH, records)
    return target


def recent_changes(since=None, kind=None, limit=None) -> list[dict]:
    records = _read_all(CHANGELOG_PATH)
    out = []
    for e in records:
        if since is not None and (e.get("ts") or "") < since:
            continue
        if kind is not None and e.get("kind") != kind:
            continue
        out.append(e)
    out.sort(key=lambda e: e.get("ts", ""), reverse=True)
    if limit is not None:
        out = out[:limit]
    return out
