/**
 * Fly-ghost animation. Clone a DOM node (just the pictogram tile, not the
 * surrounding chip with its label) and animate it from one rect to another.
 *
 * We transition only the pictogram so the ghost scales uniformly: the chip's
 * label would make the ghost's bounding box width-dependent on the item's
 * name, which looks heavy. Scaling just the 32×32 ic tile up to the focus
 * card's ~120px tile is clean and matches the prototype's visual intent.
 */

export function motionOK(): boolean {
  if (typeof window === "undefined") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fly the pictogram from a source chip's `.ic` tile to a destination rect
 * (the focus card's `.ic` tile).
 *
 * We don't use CSS `transform: scale()`, because scaling a chip's small
 * `.ic` (24px, 1.5px border, 2.2 stroke-width) up to the focus card's
 * 120px size scales borders and strokes along with it, giving a thick
 * cartoony result. Instead we animate `width`, `height`, `top`, `left`
 * directly, so the SVG re-renders at the target size with the correct
 * stroke widths given by CSS at that size.
 *
 * We also strip the chip's border and background from the clone so it ends
 * up matching the focus card's `.fpic .ic` styling (no border, transparent
 * bg, 1.6 stroke-width on paths — see globals.css line 125-128).
 */
export async function flyPictogram(
  srcIc: HTMLElement | null,
  toRect: DOMRect | null,
): Promise<void> {
  if (!motionOK() || !srcIc || !toRect) return;
  const fromRect = srcIc.getBoundingClientRect();
  if (fromRect.width === 0) return;

  const clone = srcIc.cloneNode(true) as HTMLElement;
  // Match the focus card's `.fpic .ic` look: no border, transparent bg.
  // The element-symbol variant (.ic.el) keeps its border in the focus too,
  // so we leave that alone.
  if (!clone.classList.contains("el")) {
    clone.style.border = "0";
    clone.style.background = "transparent";
  } else {
    // Element tile grows a touch smaller than the pictogram tile at the
    // destination (108px vs 120px). Scaling to toRect dimensions is close
    // enough — the border already matches.
  }
  // Make SVG paths render with the focus card's thinner stroke-width.
  clone.querySelectorAll<SVGPathElement>("svg .b, svg .l").forEach((p) => {
    p.setAttribute("stroke-width", "1.6");
  });
  // Element symbols: the chip version has font-size driven by container
  // query (46cqw of 24px ≈ 11px); the focus version is 60px. We let the
  // clone grow its font with its box so the glyph scales naturally.
  if (clone.classList.contains("el")) {
    clone.style.fontSize = `${toRect.height * 0.55}px`;
  }

  const g = document.createElement("div");
  g.className = "ghost";
  g.appendChild(clone);
  Object.assign(g.style, {
    position: "fixed",
    left: `${fromRect.left}px`,
    top: `${fromRect.top}px`,
    width: `${fromRect.width}px`,
    height: `${fromRect.height}px`,
    pointerEvents: "none",
    zIndex: "50",
  });
  // Clone must fill the ghost box so size animation flows into the SVG.
  // Keep `display: inline-grid` + `place-items: center` from .ic so the
  // SVG inside stays centred as the box grows; block/inline-block would
  // let the SVG hug the top-left.
  Object.assign(clone.style, {
    width: "100%",
    height: "100%",
    display: "inline-grid",
    placeItems: "center",
    boxSizing: "border-box",
  });
  document.body.appendChild(g);

  try {
    const anim = g.animate(
      [
        {
          left: `${fromRect.left}px`,
          top: `${fromRect.top}px`,
          width: `${fromRect.width}px`,
          height: `${fromRect.height}px`,
        },
        {
          left: `${toRect.left}px`,
          top: `${toRect.top}px`,
          width: `${toRect.width}px`,
          height: `${toRect.height}px`,
        },
      ],
      { duration: 460, easing: "cubic-bezier(.3,.7,.15,1)", fill: "forwards" },
    );
    await anim.finished;
  } catch {
    /* ignore cancellations */
  } finally {
    g.remove();
  }
}
