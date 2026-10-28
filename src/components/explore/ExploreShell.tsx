"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pictogram } from "@/pictograms/Pictogram";
import { Bowtie } from "@/components/bowtie/Bowtie";
import { flyPictogram } from "@/components/bowtie/fly";
import { formatFirstAppeared } from "@/lib/year";
import type { ExploreView } from "./types";

/**
 * Explore wrapper: puts the shared Bowtie on the page plus the panels the
 * Explore mode-specific panels — a chain from the big bang.
 *
 * Chip clicks are intercepted: instead of navigating via <Link>, we fetch
 * /api/view/<code> and swap the bowtie in place. The URL is updated with
 * history.replaceState so refresh and back-button still work. This gives
 * the "flying chip" animation parity with the prototype.
 */
export function ExploreShell({ view: initial }: { view: ExploreView }) {
  const router = useRouter();
  const [view, setView] = useState<ExploreView>(initial);
  const [loading, setLoading] = useState(false);
  const focusHeadRef = useRef<HTMLDivElement | null>(null);

  // Sync when the server-driven prop changes (e.g. first mount, or on back/forward).
  useEffect(() => {
    setView(initial);
  }, [initial]);

  const onChipClick = useCallback(
    async (targetCode: string, el: HTMLElement) => {
      if (loading) return;
      setLoading(true);
      // Pluck the chip's pictogram tile before React swaps the view away.
      const srcIc = el.querySelector<HTMLElement>(".ic");
      try {
        const res = await fetch(`/api/view/${targetCode}`);
        if (!res.ok) return;
        const body = (await res.json()) as ExploreView;
        setView(body);
        router.replace(`/explore/${body.item.slug}`, { scroll: false });

        requestAnimationFrame(() => {
          const head = focusHeadRef.current?.querySelector<HTMLElement>(".fpic .ic");
          const headWrap = focusHeadRef.current?.querySelector<HTMLElement>(".fhead");
          if (!head || !headWrap) return;
          headWrap.style.visibility = "hidden";
          flyPictogram(srcIc, head.getBoundingClientRect()).then(() => {
            headWrap.style.visibility = "";
            try {
              headWrap.animate(
                [{ opacity: 0.3 }, { opacity: 1 }],
                { duration: 180 },
              );
            } catch {
              /* animate() unsupported */
            }
          });
        });
      } finally {
        setLoading(false);
      }
    },
    [loading, router],
  );

  return (
    <>
      <div ref={focusHeadRef} style={{ display: "contents" }}>
        <Bowtie view={view} mode="explore" onChipClick={onChipClick} />
      </div>

      {view.originChain.length > 1 && (
        <section className="panel">
          <h3>From the big bang to {view.item.name}</h3>
          <p className="sub">
            The most direct chain from the start of the universe, following
            what things are made from and, for living things, what they
            evolved from. Each step shows when it first appeared.
          </p>
          <div className="chain">
            {view.originChain.map((step, idx) => (
              <div
                key={step.slug}
                className={`node${idx === view.originChain.length - 1 ? " end" : ""}`}
                style={{ "--i": idx } as React.CSSProperties}
              >
                <Pictogram
                  name={step.name}
                  tier={step.tier}
                  kind={step.kind}
                  symbol={step.symbol}
                  className="sm"
                />
                <span className="tx">
                  <span className="v">{step.name}</span>
                  <span className="y">
                    {formatFirstAppeared(step.firstAppeared)?.short ??
                      "date unknown"}
                  </span>
                </span>
                {idx < view.originChain.length - 1 ? (
                  <span className="arr" aria-hidden="true">
                    ›
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
