"""Static file server + write endpoints for the pm/ UI.

Run:
    uv run pm/serve.py            # default port 8765
    uv run pm/serve.py --port 9000

Then open http://localhost:8765/ .

Endpoints:
    GET    /                          → index.html
    GET    /changelog.html            → changelog.html
    GET    /<file>                    → static (tasks.jsonl, changelog.jsonl, index.html, changelog.html)
    GET    /api/tasks                       → list_tasks(?status=&tag=&assignee=&ready=&limit=&group=&priority=&needs_review=&reviewed=&pinned=&parent_task_id=&open_questions_for=)
    POST   /api/tasks                       → add_task(body)
    PATCH  /api/tasks/<id>                  → update_task(id, body)
    DELETE /api/tasks/<id>                  → delete_task(id)
    POST   /api/tasks/<id>/comments         → add_comment(id, body)
    DELETE /api/tasks/<id>/comments/<ts>    → delete_comment(id, ts) — ts is URL-encoded ISO
    POST   /api/tasks/<id>/questions        → add_question(id, {question, asked_by?, asked_of?})
    PATCH  /api/tasks/<id>/questions/<qid>  → answer_question / resolve_question ({answer?, answered_by?, resolved?})
    DELETE /api/tasks/<id>/questions/<qid>  → delete_question(id, qid)
    POST   /api/tasks/<id>/review_items     → add_review_item(id, {body, ref?, author?})
    PATCH  /api/tasks/<id>/review_items/<rid> → resolve_review_item / update_review_item ({status?, resolved_by?, body?, ref?})
    DELETE /api/tasks/<id>/review_items/<rid> → delete_review_item(id, rid)
    POST   /api/tasks/bulk_update           → bulk_update_tasks({ids? | filter?, patch})
    POST   /api/tasks/bulk_delete           → bulk_delete_tasks({ids? | filter?})
    GET    /api/changelog             → recent_changes(?since=&kind=&limit=)
    POST   /api/changelog             → append_changelog(body)
    DELETE /api/changelog/<id>        → delete_changelog(id)
    POST   /api/changelog/bulk_delete → bulk_delete_changelog({ids? | filter?})

All /api responses are JSON. Errors → {"error": "..."} with 400/404/500.
"""

from __future__ import annotations

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import store

PM_DIR = Path(__file__).parent
STATIC_ALLOW = {
    "index.html", "changelog.html", "tasks.jsonl", "changelog.jsonl",
    "vendor/marked.esm.js", "vendor/purify.es.mjs",
}

TASK_ID_RE = re.compile(r"^/api/tasks/(T-\d+)$")
TASK_COMMENT_RE = re.compile(r"^/api/tasks/(T-\d+)/comments$")
TASK_COMMENT_TS_RE = re.compile(r"^/api/tasks/(T-\d+)/comments/(.+)$")
TASK_QUESTIONS_RE = re.compile(r"^/api/tasks/(T-\d+)/questions$")
TASK_QUESTION_RE = re.compile(r"^/api/tasks/(T-\d+)/questions/(Q\d+)$")
TASK_REVIEW_ITEMS_RE = re.compile(r"^/api/tasks/(T-\d+)/review_items$")
TASK_REVIEW_ITEM_RE = re.compile(r"^/api/tasks/(T-\d+)/review_items/(R\d+)$")
CL_ID_RE = re.compile(r"^/api/changelog/(C-\d+)$")


class Handler(BaseHTTPRequestHandler):
    # Silence per-request stderr noise; keep errors.
    def log_message(self, fmt, *args):
        if "code 4" in (fmt % args) or "code 5" in (fmt % args):
            super().log_message(fmt, *args)

    # ── helpers ──
    def _send_json(self, status: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, name: str) -> None:
        if name not in STATIC_ALLOW:
            self._send_json(404, {"error": "not found"})
            return
        path = PM_DIR / name
        if not path.exists():
            # Empty JSONL is valid; index.html missing is a real 404.
            if name.endswith(".jsonl"):
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
                self.send_header("Content-Length", "0")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            self._send_json(404, {"error": "not found"})
            return
        data = path.read_bytes()
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".jsonl": "application/x-ndjson; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".mjs": "application/javascript; charset=utf-8",
        }[path.suffix]
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    # ── verbs ──
    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path == "/" or path == "/index.html":
            self._send_static("index.html")
            return
        if path == "/changelog.html":
            self._send_static("changelog.html")
            return
        if path == "/tasks.jsonl":
            self._send_static("tasks.jsonl")
            return
        if path == "/changelog.jsonl":
            self._send_static("changelog.jsonl")
            return
        if path == "/vendor/marked.esm.js":
            self._send_static("vendor/marked.esm.js")
            return
        if path == "/vendor/purify.es.mjs":
            self._send_static("vendor/purify.es.mjs")
            return

        if path == "/api/tasks":
            q = parse_qs(url.query)
            ready = q.get("ready", [None])[0]
            ready_val = None if ready is None else (ready.lower() == "true")
            needs_review = q.get("needs_review", [None])[0]
            needs_review_val = None if needs_review is None else (needs_review.lower() == "true")
            reviewed = q.get("reviewed", [None])[0]
            reviewed_val = None if reviewed is None else (reviewed.lower() == "true")
            pinned = q.get("pinned", [None])[0]
            pinned_val = None if pinned is None else (pinned.lower() == "true")
            limit = q.get("limit", [None])[0]
            # parent_task_id: absent → None (no filter); present with any value
            # (including empty string) → filter. Empty string means "top-level only".
            parent_task_id = q.get("parent_task_id", [None])[0]
            open_questions_for = q.get("open_questions_for", [None])[0]
            self._send_json(200, store.list_tasks(
                status=q.get("status", [None])[0],
                tag=q.get("tag", [None])[0],
                assignee=q.get("assignee", [None])[0],
                ready=ready_val,
                limit=int(limit) if limit else None,
                group=q.get("group", [None])[0],
                priority=q.get("priority", [None])[0],
                needs_review=needs_review_val,
                reviewed=reviewed_val,
                pinned=pinned_val,
                parent_task_id=parent_task_id,
                open_questions_for=open_questions_for,
            ))
            return

        if path == "/api/changelog":
            q = parse_qs(url.query)
            limit = q.get("limit", [None])[0]
            self._send_json(200, store.recent_changes(
                since=q.get("since", [None])[0],
                kind=q.get("kind", [None])[0],
                limit=int(limit) if limit else None,
            ))
            return

        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        try:
            body = self._read_json_body()
        except json.JSONDecodeError as e:
            self._send_json(400, {"error": f"bad json: {e}"})
            return

        try:
            if url.path == "/api/tasks":
                task = store.add_task(
                    title=body.get("title", ""),
                    body=body.get("body"),
                    tags=body.get("tags"),
                    assignee=body.get("assignee"),
                    depends_on=body.get("depends_on"),
                    priority=body.get("priority"),
                    group=body.get("group"),
                    pinned=bool(body.get("pinned", False)),
                    parent_task_id=body.get("parent_task_id"),
                )
                self._send_json(201, task)
                return
            m = TASK_COMMENT_RE.match(url.path)
            if m:
                task = store.add_comment(
                    task_id=m.group(1),
                    body=body.get("body", ""),
                    author=body.get("author"),
                )
                self._send_json(201, task)
                return
            m = TASK_QUESTIONS_RE.match(url.path)
            if m:
                task = store.add_question(
                    task_id=m.group(1),
                    question=body.get("question", ""),
                    asked_by=body.get("asked_by"),
                    asked_of=body.get("asked_of"),
                )
                self._send_json(201, task)
                return
            m = TASK_REVIEW_ITEMS_RE.match(url.path)
            if m:
                task = store.add_review_item(
                    task_id=m.group(1),
                    body=body.get("body", ""),
                    ref=body.get("ref"),
                    author=body.get("author"),
                )
                self._send_json(201, task)
                return
            if url.path == "/api/changelog":
                entry = store.append_changelog(
                    kind=body.get("kind", ""),
                    summary=body.get("summary", ""),
                    refs=body.get("refs"),
                )
                self._send_json(201, entry)
                return
            if url.path == "/api/tasks/bulk_update":
                result = store.bulk_update_tasks(
                    patch=body.get("patch") or {},
                    ids=body.get("ids"),
                    filter=body.get("filter"),
                )
                self._send_json(200, result)
                return
            if url.path == "/api/tasks/bulk_delete":
                result = store.bulk_delete_tasks(
                    ids=body.get("ids"),
                    filter=body.get("filter"),
                )
                self._send_json(200, result)
                return
            if url.path == "/api/changelog/bulk_delete":
                result = store.bulk_delete_changelog(
                    ids=body.get("ids"),
                    filter=body.get("filter"),
                )
                self._send_json(200, result)
                return
        except store.StoreError as e:
            self._send_json(400, {"error": str(e)})
            return
        except Exception as e:
            self._send_json(500, {"error": f"{type(e).__name__}: {e}"})
            return

        self._send_json(404, {"error": "not found"})

    def do_DELETE(self):
        url = urlparse(self.path)
        try:
            m = TASK_QUESTION_RE.match(url.path)
            if m:
                task = store.delete_question(m.group(1), m.group(2))
                self._send_json(200, task)
                return
            m = TASK_REVIEW_ITEM_RE.match(url.path)
            if m:
                task = store.delete_review_item(m.group(1), m.group(2))
                self._send_json(200, task)
                return
            # Comments are keyed by ISO ts (contains ":") — the regex is broad
            # so this must come after the more specific /comments/... matchers
            # would-be but there are none, so order doesn't matter.
            m = TASK_COMMENT_TS_RE.match(url.path)
            if m:
                task = store.delete_comment(m.group(1), unquote(m.group(2)))
                self._send_json(200, task)
                return
            m = TASK_ID_RE.match(url.path)
            if m:
                self._send_json(200, store.delete_task(m.group(1)))
                return
            m = CL_ID_RE.match(url.path)
            if m:
                self._send_json(200, store.delete_changelog(m.group(1)))
                return
        except store.StoreError as e:
            # Unknown id → 404; other validation → 400.
            code = 404 if str(e).startswith("unknown") else 400
            self._send_json(code, {"error": str(e)})
            return
        except Exception as e:
            self._send_json(500, {"error": f"{type(e).__name__}: {e}"})
            return
        self._send_json(404, {"error": "not found"})

    def do_PATCH(self):
        url = urlparse(self.path)
        try:
            patch = self._read_json_body()
        except json.JSONDecodeError as e:
            self._send_json(400, {"error": f"bad json: {e}"})
            return
        # Review-item patch: {status?, resolved_by?, body?, ref?}. Body/ref
        # go through update_review_item; status goes through resolve_review_item
        # so the auto-clear rule applies. Both may be present — apply the edit
        # first (state is what the user saw when they clicked), then resolve.
        m = TASK_REVIEW_ITEM_RE.match(url.path)
        if m:
            task_id, rid = m.group(1), m.group(2)
            try:
                task = None
                edit_patch = {k: patch[k] for k in ("body", "ref") if k in patch}
                if edit_patch:
                    task = store.update_review_item(
                        task_id=task_id, item_id=rid, patch=edit_patch,
                    )
                if "status" in patch:
                    task = store.resolve_review_item(
                        task_id=task_id, item_id=rid, status=patch["status"],
                        resolved_by=patch.get("resolved_by"),
                    )
                if task is None:
                    task = store.get_task(task_id)
                    if task is None:
                        self._send_json(404, {"error": f"unknown task: {task_id}"})
                        return
                self._send_json(200, task)
            except store.StoreError as e:
                code = 404 if str(e).startswith("unknown") else 400
                self._send_json(code, {"error": str(e)})
            except Exception as e:
                self._send_json(500, {"error": f"{type(e).__name__}: {e}"})
            return
        # Question patch: {answer?, answered_by?, resolved?}. Answer and resolve
        # are independent — either or both may be present. Ordering: answer
        # first (records the response), then resolve (closes it).
        m = TASK_QUESTION_RE.match(url.path)
        if m:
            task_id, qid = m.group(1), m.group(2)
            try:
                task = None
                if "answer" in patch and patch["answer"] is not None:
                    task = store.answer_question(
                        task_id=task_id, question_id=qid,
                        answer=patch["answer"],
                        answered_by=patch.get("answered_by"),
                    )
                if "resolved" in patch:
                    task = store.resolve_question(
                        task_id=task_id, question_id=qid,
                        resolved=bool(patch["resolved"]),
                    )
                if task is None:
                    # No-op patch: return the current task so the caller sees state.
                    task = store.get_task(task_id)
                    if task is None:
                        self._send_json(404, {"error": f"unknown task: {task_id}"})
                        return
                self._send_json(200, task)
            except store.StoreError as e:
                code = 404 if str(e).startswith("unknown") else 400
                self._send_json(code, {"error": str(e)})
            except Exception as e:
                self._send_json(500, {"error": f"{type(e).__name__}: {e}"})
            return
        m = TASK_ID_RE.match(url.path)
        if not m:
            self._send_json(404, {"error": "not found"})
            return
        try:
            task = store.update_task(m.group(1), patch)
            self._send_json(200, task)
        except store.StoreError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:
            self._send_json(500, {"error": f"{type(e).__name__}: {e}"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"pm serving on http://{args.host}:{args.port}/  (Ctrl-C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
