/**
 * Allowlist-based sanitiser for pictogram SVG inner-markup.
 *
 * `Pictogram.tsx` renders the stored string via `dangerouslySetInnerHTML`,
 * so every write path (admin editor, bulk upload) must go through this.
 * The format is intentionally narrow: a flat sequence of shape elements
 * on a 32×32 viewBox, no `<script>`, no event handlers, no external
 * references. We reject anything outside the allowlist with an actionable
 * error so admins can fix pack issues without guessing.
 *
 * This is not a full XML parser — the pictogram format is simple and
 * consistent, and a strict regex scan catches every malformed input the
 * authoring process can produce. The alternative (JSDOM) would pull in a
 * heavy dependency for a well-bounded format.
 */

/** Elements that may appear inside a pictogram. */
const ALLOWED_ELEMENTS = new Set([
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "g",
]);

/** Attributes that may appear on allowed elements. `class` is restricted
 *  further to the style vocabulary below. */
const ALLOWED_ATTRS = new Set([
  "class",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "d",
  "points",
  "transform",
]);

/** The pictogram CSS vocabulary. See globals.css `.ic svg .b/.l/.k/.w`. */
const ALLOWED_CLASSES = new Set(["b", "l", "k", "w"]);

export interface SanitiseResult {
  ok: boolean;
  /** The normalised markup if `ok`, otherwise the original. */
  value: string;
  /** Human-readable list of what's wrong when !ok. */
  errors: string[];
}

export function sanitisePictogram(svg: string): SanitiseResult {
  const errors: string[] = [];
  const trimmed = svg.trim();
  if (trimmed === "") {
    return { ok: true, value: "", errors: [] };
  }

  // Fast reject: anything inside <script>, <style>, <foreignObject>, or
  // <?xml?>/<!DOCTYPE> / HTML comments is out.
  if (/<\s*(script|style|foreignObject|iframe|image|use)[\s>]/i.test(trimmed)) {
    errors.push("Disallowed element (script/style/foreignObject/iframe/image/use).");
  }
  if (/<!--|<!\[CDATA\[/.test(trimmed)) {
    errors.push("Comments and CDATA sections are not allowed.");
  }
  if (/<\?/.test(trimmed)) {
    errors.push("Processing instructions are not allowed.");
  }

  // Scan every tag. Pictograms are a flat list, so a simple regex over
  // `<tagname ...>` is enough. Self-closing (`/>`) and container
  // (`<g>...</g>`) forms both match.
  const tagRe = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(trimmed)) !== null) {
    const tag = m[1].toLowerCase();
    const rest = m[2];
    if (!ALLOWED_ELEMENTS.has(tag)) {
      errors.push(`Element <${tag}> is not allowed. Allowed: ${[...ALLOWED_ELEMENTS].join(", ")}.`);
      continue;
    }
    // Scan attributes on this tag. Attribute names are the group before `=`.
    const attrRe = /([a-zA-Z_:][a-zA-Z0-9_.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(rest)) !== null) {
      const name = a[1].toLowerCase();
      const value = a[3] ?? a[4] ?? "";
      // Any attribute starting with `on` (event handlers) is forbidden
      // regardless of allowlist membership.
      if (name.startsWith("on")) {
        errors.push(`Event handler attribute "${name}" is not allowed.`);
        continue;
      }
      if (name === "xmlns" || name.startsWith("xmlns:") || name.startsWith("xlink:")) {
        errors.push(`Namespace attribute "${name}" is not allowed.`);
        continue;
      }
      if (!ALLOWED_ATTRS.has(name)) {
        errors.push(`Attribute "${name}" on <${tag}> is not allowed.`);
        continue;
      }
      if (name === "class") {
        for (const cls of value.split(/\s+/).filter(Boolean)) {
          if (!ALLOWED_CLASSES.has(cls)) {
            errors.push(
              `Class "${cls}" on <${tag}> is not allowed. Use one of: ${[...ALLOWED_CLASSES].join(", ")}.`,
            );
          }
        }
      }
      // url(...) / data:... in any attribute is suspicious — the format
      // never needs it and it's a common SVG XSS vector.
      if (/url\s*\(/i.test(value) || /\bdata:/i.test(value) || /\bjavascript:/i.test(value)) {
        errors.push(`Attribute "${name}" contains a disallowed URL scheme.`);
      }
    }
  }

  // Normalise whitespace — the stored form is a single line.
  const normalised = trimmed.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();

  return { ok: errors.length === 0, value: normalised, errors };
}
