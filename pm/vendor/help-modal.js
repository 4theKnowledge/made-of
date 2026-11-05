// Shared "?" quick-reference modal for pm/index.html and pm/changelog.html.
// Self-contained: injects its own styles, overlay, and key bindings. The
// pages own the Esc chain across sibling modals and consult isHelpModalOpen
// before deciding whose Esc this is, so this module never swallows Esc for
// anyone else — it only closes the help overlay when its own open flag is
// set.

const SHARED_SECTIONS = [
  {
    heading: "Keys",
    html: `<ul>
      <li><code>?</code> — open this help</li>
      <li><code>Esc</code> — close the topmost modal</li>
      <li><code>/</code> — focus the search/filter bar (where present)</li>
    </ul>`,
  },
  {
    heading: "Tasks",
    html: `<ul>
      <li>Statuses: <code>open</code>, <code>in_progress</code>, <code>blocked</code>, <code>on_hold</code>, <code>done</code>, <code>cancelled</code>, <code>wont_do</code>.</li>
      <li>Priorities: <code>P0</code> (critical) → <code>P3</code> (low).</li>
      <li>Filter chips cycle: unapplied → include → exclude → unapplied.</li>
    </ul>`,
  },
  {
    heading: "Review",
    html: `<ul>
      <li>Setting <code>status=done</code> auto-flags <code>needs_review</code>.</li>
      <li>Reviewing (set <code>reviewed_at</code>) clears <code>needs_review</code>.</li>
      <li>Any other edit clears <code>reviewed_at</code> — prior review is stale.</li>
    </ul>`,
  },
  {
    heading: "Questions",
    html: `<ul>
      <li>Open questions pin the task to the top of its group.</li>
      <li>Resolving a question records the answer inline on the task.</li>
    </ul>`,
  },
  {
    heading: "Comments",
    html: `<ul>
      <li>Markdown supported (GFM). Fenced code, tables, lists all render.</li>
      <li>Each card has a <em>copy</em> button for the raw markdown source.</li>
    </ul>`,
  },
  {
    heading: "Dependencies",
    html: `<ul>
      <li><code>depends_on</code> = ordering. A task is <em>ready</em> when every dep is <code>done</code>.</li>
      <li><code>parent_task_id</code> = scope containment (subtask), not ordering.</li>
    </ul>`,
  },
];

const STYLE_ID = "help-modal-style";
const OVERLAY_ID = "help-modal-overlay";

let overlayEl = null;
let isOpen = false;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${OVERLAY_ID} {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: none; align-items: flex-start; justify-content: center;
  z-index: 10000; padding: 48px 16px; overflow-y: auto;
}
#${OVERLAY_ID}.open { display: flex; }
#${OVERLAY_ID} .help-card {
  background: var(--bg, #0b0d10); color: var(--fg, #e6e6e6);
  border: 1px solid var(--border, #2a2f36); border-radius: 8px;
  max-width: 720px; width: 100%; padding: 20px 24px 24px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
#${OVERLAY_ID} .help-head {
  display: flex; align-items: center; justify-content: space-between;
  margin: 0 0 12px; padding-bottom: 8px;
  border-bottom: 1px solid var(--border, #2a2f36);
}
#${OVERLAY_ID} .help-head h2 { margin: 0; font-size: 16px; color: var(--fg-strong, #fff); }
#${OVERLAY_ID} .help-close {
  background: transparent; border: 0; color: var(--muted, #888);
  font-size: 18px; cursor: pointer; padding: 2px 8px;
}
#${OVERLAY_ID} .help-close:hover { color: var(--fg-strong, #fff); }
#${OVERLAY_ID} .help-section { margin: 12px 0; }
#${OVERLAY_ID} .help-section h3 {
  margin: 0 0 6px; font-size: 13px; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--muted, #888);
}
#${OVERLAY_ID} .help-section ul { margin: 0; padding-left: 20px; }
#${OVERLAY_ID} .help-section li { margin: 3px 0; line-height: 1.5; }
#${OVERLAY_ID} .help-section code {
  background: var(--code-bg, #1a1d22); border: 1px solid var(--border, #2a2f36);
  border-radius: 3px; padding: 0 4px; font-size: 12px;
}
`;
  document.head.appendChild(style);
}

function renderOverlay(sections) {
  const parts = sections.map(s =>
    `<div class="help-section"><h3>${s.heading}</h3>${s.html}</div>`
  );
  const el = document.createElement("div");
  el.id = OVERLAY_ID;
  el.innerHTML = `
<div class="help-card" role="dialog" aria-modal="true" aria-label="Quick reference">
  <div class="help-head">
    <h2>Quick reference</h2>
    <button type="button" class="help-close" aria-label="Close">×</button>
  </div>
  ${parts.join("")}
</div>`;
  el.addEventListener("click", (e) => {
    if (e.target === el) closeHelpModal();
  });
  el.querySelector(".help-close").addEventListener("click", closeHelpModal);
  document.body.appendChild(el);
  return el;
}

export function installHelpModal(opts = {}) {
  const extra = Array.isArray(opts.extraSections) ? opts.extraSections : [];
  installStyles();
  overlayEl = renderOverlay([...SHARED_SECTIONS, ...extra]);

  const btn = document.getElementById("btn-help");
  if (btn) btn.addEventListener("click", openHelpModal);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "?") return;
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
    e.preventDefault();
    if (isOpen) closeHelpModal();
    else openHelpModal();
  });
}

export function openHelpModal() {
  if (!overlayEl) return;
  overlayEl.classList.add("open");
  isOpen = true;
}

export function closeHelpModal() {
  if (!overlayEl) return;
  overlayEl.classList.remove("open");
  isOpen = false;
}

export function isHelpModalOpen() {
  return isOpen;
}
