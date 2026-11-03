/**
 * Minimal markdown renderer for admin-authored changelog entries.
 *
 * Supports: headings (##/###), paragraphs, bold (**text**), italic (*text*),
 * inline code (`code`), links ([label](url)), unordered lists (- item),
 * ordered lists (1. item), blockquotes (> text), fenced code blocks (```).
 *
 * Content is admin-only, but we still escape raw HTML so a copy-paste of a
 * stray `<script>` can't execute. We don't bring in a parser dependency for
 * what's effectively release-note formatting.
 */

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  // Code first so its contents don't get re-formatted.
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  // Links [label](url) — url allowed: http(s) or relative paths/anchors.
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label: string, href: string) => {
      const safe = /^(https?:\/\/|\/|#)/i.test(href) ? href : "#";
      const external = /^https?:\/\//i.test(safe);
      const attrs = external
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      return `<a href="${safe}"${attrs}>${label}</a>`;
    },
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  return out;
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block.
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // Headings.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 6);
      out.push(`<h${level}>${renderInline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote block.
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderInline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list.
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Paragraph: consume consecutive non-blank, non-special lines.
    const paragraph: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|>\s?|[-*]\s+|\d+\.\s+|```)/.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return out.join("\n");
}
