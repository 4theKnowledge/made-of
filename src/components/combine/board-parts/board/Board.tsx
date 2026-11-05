import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { GameState } from "@/combine/engine";
import type { ThemeBundle } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import type { Fx, Preview } from "@/components/combine/board-parts/types";
import { fillVar } from "@/components/combine/board-parts/util";
import { ChainOverlay } from "@/components/combine/board-parts/board/ChainOverlay";

export function Board({
  state,
  bundle,
  fx,
  preview,
  dragOver,
  clearMode,
  moveMode,
  shoreMode,
  pluckMode,
  lastChance,
  onCellTap,
  onCellPointerDown,
}: {
  state: GameState;
  bundle: ThemeBundle;
  fx: Fx;
  preview: Map<number, Preview>;
  dragOver: { cell: number | null; ok: boolean } | null;
  clearMode: boolean;
  moveMode: { from: number | null } | null;
  shoreMode: boolean;
  pluckMode: boolean;
  lastChance: boolean;
  onCellTap: (cell: number) => void;
  onCellPointerDown: (cell: number, e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const size = state.n;
  return (
    <div
      className={"cbboard" + (lastChance ? " cbboard-lastchance" : "")}
      style={{ "--cbn": size } as React.CSSProperties}
      role="grid"
      aria-label="Board"
    >
      {state.board.map((v, i) => {
        const crumbleTick =
          v && state.crumb[i]?.id === v ? state.crumb[i]!.n : 0;
        const over =
          dragOver && dragOver.cell === i
            ? dragOver.ok
              ? "ok"
              : "no"
            : null;
        const isClearable = clearMode && v != null;
        const isMovable =
          moveMode != null && moveMode.from == null && v != null;
        const isMoving = moveMode != null && moveMode.from === i;
        const isShored = state.shored[i] === true;
        const isShoreable = shoreMode && crumbleTick > 0 && !isShored;
        // Pluck targets any tile on the board — cosmetically reuse the
        // "clearable" affordance since both modes want "any full tile is
        // tappable". The onCellTap handler enforces capacity.
        const isPluckable = pluckMode && v != null;
        return (
          <Cell
            key={i}
            cell={i}
            id={v}
            bundle={bundle}
            crumbleTick={crumbleTick}
            fx={fx}
            preview={preview.get(i)}
            over={over}
            clearable={isClearable || isPluckable}
            movable={isMovable}
            moving={isMoving}
            shoreable={isShoreable}
            shored={isShored}
            onTap={() => onCellTap(i)}
            onPointerDown={(e) => onCellPointerDown(i, e)}
          />
        );
      })}
      {fx.trace && <ChainOverlay trace={fx.trace} />}
    </div>
  );
}

export const CRUMBLE_TTL = 3;

function Cell({
  cell,
  id,
  bundle,
  crumbleTick,
  fx,
  preview,
  over,
  clearable,
  movable,
  moving,
  shoreable,
  shored,
  onTap,
  onPointerDown,
}: {
  cell: number;
  id: string | null;
  bundle: ThemeBundle;
  crumbleTick: number;
  fx: Fx;
  preview: Preview | undefined;
  over: "ok" | "no" | null;
  clearable: boolean;
  movable: boolean;
  moving: boolean;
  shoreable: boolean;
  shored: boolean;
  onTap: () => void;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  // Visual-only overlays: the engine has already mutated state (consumed
  // ingredients, placed/removed outputs) by the time the UI applies fx, so
  // for the animation window we may need to render a tile the engine no
  // longer has. In priority order: fuseGhost (ingredient during pulse) →
  // popGhost (output that will ship this frame) → shipped (output flying
  // off) → actual state tile.
  const fuseGhostId = fx.fuseGhosts?.get(cell);
  const isPop = fx.pop === cell;
  const popGhostId = isPop ? fx.popGhost : undefined;
  const isShipped = fx.shipped?.at === cell;
  const shipGhostId = isShipped ? fx.shipped?.out : undefined;
  const displayId = fuseGhostId || popGhostId || id || shipGhostId || null;
  const empty = !displayId;
  const item = displayId ? bundle.items.get(displayId) : null;
  const ghostItem = preview?.out ? bundle.items.get(preview.out) : null;

  const inFuse = fx.fuse?.has(cell) ?? false;
  const inCrumble = fx.crumble?.has(cell) ?? false;
  const isPlaced = fx.placed === cell;
  const isNope = fx.nope === cell;
  const burst = fx.burst?.at === cell ? fx.burst : null;
  const isDiscover = fx.discover === cell;
  const inChain =
    !!fx.trace && !fx.trace.solo && fx.trace.members.has(cell);

  const classes = ["cbc"];
  if (!empty) classes.push("full");
  if (isPlaced) classes.push("placed");
  if (inFuse) classes.push("fuse");
  if (isPop) classes.push("cbpopc");
  if (isDiscover) classes.push("cbdiscovered");
  if (inChain) classes.push("cbchainm");
  if (isNope) classes.push("nope");
  if (isShipped) classes.push("ship");
  if (crumbleTick > 0 && !inCrumble) classes.push("crumbling");
  if (inCrumble) classes.push("crumble");
  // Preview classes: empty cells where the selected tile would combine → .can;
  // occupied cells where drop-on-top would combine → .over (via .full.over).
  if (empty && preview) classes.push("can");
  if (!empty && preview?.on) classes.push("over");
  // Drag-ghost over highlighting takes precedence over preview.
  if (over === "ok") classes.push("over");
  if (over === "no") classes.push("overno");
  // Helper modes.
  if (clearable) classes.push("clearable");
  if (movable) classes.push("movable");
  if (moving) classes.push("moving");
  if (shoreable) classes.push("shoreable");
  if (shored) classes.push("shored");

  const words = displayId ? displayId.split("-") : [];
  const longest = Math.max(0, ...words.map((w) => w.length));
  const lenClass = longest >= 10 ? " l2" : longest >= 7 ? " l1" : "";

  const ariaLabel = item
    ? `${cap(item.name)}${moving ? ", selected to move" : ""}${
        shored
          ? ", shored: won't crumble"
          : crumbleTick > 0
          ? `, crumbling: nothing in this age uses it, gone in ${CRUMBLE_TTL + 1 - crumbleTick} turns`
          : ""
      }`
    : preview?.out
      ? `Empty. Placing here makes ${cap(preview.out)}`
      : `Empty cell ${cell}`;

  return (
    <button
      type="button"
      className={classes.join(" ")}
      data-cb={cell}
      style={{
        ...(item ? fillVar(item) : {}),
        ...(inChain && fx.trace
          ? ({ "--chain-tier": `var(--f${fx.trace.tier})` } as React.CSSProperties)
          : {}),
      }}
      onClick={onTap}
      onPointerDown={onPointerDown}
      aria-label={ariaLabel}
      {...(moving ? { "aria-pressed": true } : {})}
    >
      {item && (
        <>
          <Pictogram
            name={item.name}
            tier={item.tier}
            kind={item.kind}
            symbol={item.symbol}
          />
          <span className={`cbn${lenClass}`}>{cap(item.name)}</span>
        </>
      )}
      {empty && ghostItem && (
        <>
          <span className="ghost2">
            <Pictogram
              name={ghostItem.name}
              tier={ghostItem.tier}
              kind={ghostItem.kind}
              symbol={ghostItem.symbol}
            />
          </span>
          {preview && preview.n && preview.n > 1 && (
            <span className="alts" aria-hidden="true">
              +{preview.n - 1}
            </span>
          )}
        </>
      )}
      {burst && <span className="pts">+{burst.pts}</span>}
      {isDiscover && <span className="cbspark" aria-hidden="true" />}
      {isNope && <span className="pts nope">no recipe</span>}
      {isShipped && (
        <span className="pts ship">shipped +{fx.shipped!.bonus}</span>
      )}
      {crumbleTick > 0 && !inCrumble && (
        <span className="crk" aria-hidden="true">
          {CRUMBLE_TTL + 1 - crumbleTick}
        </span>
      )}
    </button>
  );
}
