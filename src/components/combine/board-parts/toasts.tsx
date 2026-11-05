import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { HintResult } from "@/combine/hint";
import type { ThemeBundle } from "@/combine/types";
import type { ReactionState } from "@/combine/useReactions";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";
import { ReactionButtons } from "@/components/combine/board-parts/ReactionButtons";

export function AgeToast({
  toast,
  bundle,
  onDismiss,
}: {
  toast: {
    age: number;
    sample: string[];
    grants: { mv: number; swap: number; clear: number; hint: number; shore: number; pluck: number };
  };
  bundle: ThemeBundle;
  onDismiss: () => void;
}) {
  const ageName = bundle.theme.ages[toast.age];
  const grantBits = [
    toast.grants.mv > 0 ? `${toast.grants.mv} move` : null,
    toast.grants.swap > 0 ? `${toast.grants.swap} swap` : null,
    toast.grants.clear > 0 ? `${toast.grants.clear} clear` : null,
    toast.grants.hint > 0 ? `${toast.grants.hint} hint` : null,
    toast.grants.shore > 0 ? `${toast.grants.shore} shore` : null,
    toast.grants.pluck > 0 ? `${toast.grants.pluck} pluck` : null,
  ].filter(Boolean) as string[];
  return (
    <div
      className="cbdisc cbagetoast cbagebig"
      role="status"
      onClick={onDismiss}
    >
      <span className="cbagesweep" aria-hidden="true" />
      <div className="cbagebody">
        <span className="k">New age · tap to close</span>
        <b>Age {ageName}</b>
        <p>
          New things start arriving. Old ones nobody needs will crumble
          away.
        </p>
        {grantBits.length > 0 && (
          <p className="cbagegrants">Replenished: +{grantBits.join(", +")}.</p>
        )}
        {toast.sample.length > 0 && (
          <div className="cbchip cbchip-sm cbchip-ghost cbagesample">
            {toast.sample.map((id, i) => {
              const it = bundle.items.get(id);
              if (!it) return null;
              return (
                <span
                  key={id}
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <Pictogram
                    name={it.name}
                    tier={it.tier}
                    kind={it.kind}
                    symbol={it.symbol}
                  />
                  {cap(it.name)}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function HintToast({
  hint,
  bundle,
  onDismiss,
}: {
  hint: HintResult;
  bundle: ThemeBundle;
  onDismiss: () => void;
}) {
  const item = bundle.items.get(hint.out);
  if (!item) return null;
  const using = hint.using ? bundle.items.get(hint.using) : null;
  const headline =
    hint.kind === "ready"
      ? using
        ? `Drop ${cap(using.name)} on the board — it combines now.`
        : "A combination is ready on the board."
      : hint.kind === "one-move"
        ? using
          ? `Place ${cap(using.name)} next to its match.`
          : "One placement completes a combination."
        : "Nothing fits right now. Try this:";
  const footer =
    hint.kind === "teach"
      ? "Keep the pieces you have, and watch your tray for the rest."
      : "Tap to close.";
  return (
    <div className="cbdisc" role="status" onClick={onDismiss}>
      <Pictogram
        name={item.name}
        tier={item.tier}
        kind={item.kind}
        symbol={item.symbol}
      />
      <div>
        <span className="k">Hint · tap to close</span>
        <b>{headline}</b>
        <div className="cbchip cbchip-sm cbchip-ghost">
          {hint.recipe.map((pid, k) => {
            const p = bundle.items.get(pid);
            if (!p) return null;
            return (
              <span key={pid}>
                <Pictogram
                  name={p.name}
                  tier={p.tier}
                  kind={p.kind}
                  symbol={p.symbol}
                />
                {cap(p.name)}
                {k < hint.recipe.length - 1 && <i>+</i>}
              </span>
            );
          })}
          <i>=</i>
          <span>
            <Pictogram
              name={item.name}
              tier={item.tier}
              kind={item.kind}
              symbol={item.symbol}
            />
            {cap(item.name)}
          </span>
        </div>
        <p>{footer}</p>
      </div>
    </div>
  );
}

export function DiscoveryToast({
  discovery,
  bundle,
  onDismiss,
  onReport,
  reaction,
  onReact,
  authed,
}: {
  discovery: {
    out: string;
    recipe: string[];
    firstLifetime: boolean;
    /** Recipe row id for the variant the player made. Optional so
     *  mid-game saves that predate the id-carrying event shape still
     *  render the toast — just without reaction buttons. */
    recipeId?: string;
  };
  bundle: ThemeBundle;
  onDismiss: () => void;
  /** Open feedback sheet seeded with this recipe. Hidden when absent. */
  onReport?: () => void;
  /** The player's reaction state for this recipe (if available). */
  reaction?: ReactionState;
  /** Fired when the player taps a thumb. Parent owns the write. */
  onReact?: (value: -1 | 0 | 1) => void;
  /** Signed-in flag so the thumbs can degrade to sign-in prompts. */
  authed?: boolean;
}) {
  const item = bundle.items.get(discovery.out);
  if (!item) return null;
  return (
    <div
      className={`cbdisc${discovery.firstLifetime ? " cbfirst" : ""}`}
      role="status"
      onClick={onDismiss}
      style={fillVar(item)}
    >
      <span className="cbdisc-pic">
        <Pictogram
          name={item.name}
          tier={item.tier}
          kind={item.kind}
          symbol={item.symbol}
        />
      </span>
      <div>
        <span className="k">
          {discovery.firstLifetime
            ? "First time! · tap to close"
            : "New discovery · tap to close"}
        </span>
        <b>{cap(item.name)}</b>
        <div className="cbchip cbchip-sm cbchip-ghost">
          {discovery.recipe.map((pid, k) => {
            const p = bundle.items.get(pid);
            if (!p) return null;
            return (
              <span key={pid}>
                <Pictogram
                  name={p.name}
                  tier={p.tier}
                  kind={p.kind}
                  symbol={p.symbol}
                />
                {cap(p.name)}
                {k < discovery.recipe.length - 1 && <i>+</i>}
              </span>
            );
          })}
          <i>=</i>
          <span>
            <Pictogram
              name={item.name}
              tier={item.tier}
              kind={item.kind}
              symbol={item.symbol}
            />
            {cap(item.name)}
          </span>
        </div>
        {item.fact && <p>{item.fact}</p>}
        {discovery.recipeId && onReact ? (
          <div className="cbdisc-react" onClick={(e) => e.stopPropagation()}>
            <ReactionButtons
              target="recipe"
              state={reaction}
              onVote={(value) => onReact(value)}
              onReport={onReport}
              authed={!!authed}
              size="xs"
            />
          </div>
        ) : (
          onReport && (
            <button
              type="button"
              className="cbdisc-report"
              onClick={(e) => {
                e.stopPropagation();
                onReport();
              }}
              aria-label="Report this recipe"
              title="Report this recipe"
            >
              Report this recipe
            </button>
          )
        )}
      </div>
    </div>
  );
}
