import React from "react";
import { Pictogram } from "@/pictograms/Pictogram";
import type { CombineItem } from "@/combine/types";
import { cap } from "@/lib/taxonomy";
import { fillVar } from "@/components/combine/board-parts/util";

export type TileVariant = "board" | "tray" | "slot" | "book";

const VARIANT_CLASS: Record<TileVariant, string> = {
  board: "cbc",
  tray: "cbp",
  slot: "cbslot",
  book: "bk",
};

type As = "button" | "span" | "div";

type BaseProps = {
  item: CombineItem;
  variant: TileVariant;
  /** Render the item's name beneath the pictogram. Length-aware `l1`/`l2`
   *  classes are applied automatically to match the prototype's typography
   *  rules in `.cbc .cbn` and `.cbp .cbn`. */
  label?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

type ButtonTileProps = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "children"> & {
    as?: "button";
  };

type SpanTileProps = BaseProps &
  Omit<React.HTMLAttributes<HTMLSpanElement>, "className" | "style" | "children"> & {
    as: "span";
  };

type DivTileProps = BaseProps &
  Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "style" | "children"> & {
    as: "div";
  };

export type CombineTileProps = ButtonTileProps | SpanTileProps | DivTileProps;

export function CombineTile(props: CombineTileProps) {
  const {
    item,
    variant,
    label,
    className,
    style,
    children,
    as = "button",
    ...rest
  } = props as BaseProps & { as?: As } & Record<string, unknown>;

  const classes = [VARIANT_CLASS[variant]];
  // `.cbc` (board) has an "empty" state by default; `.full` flips it to the
  // filled tile look. Other variants are filled by default and use their own
  // modifier for the empty state (e.g. `.cbp.empty`, `.cbslot.cbslot-ph`).
  if (variant === "board") classes.push("full");
  if (className) classes.push(className);

  const merged: React.CSSProperties = { ...fillVar(item), ...(style ?? {}) };

  const picto = (
    <Pictogram
      name={item.name}
      tier={item.tier}
      kind={item.kind}
      symbol={item.symbol}
      pictogram={item.pictogram}
    />
  );
  const labelNode = label ? <TileLabel name={item.name} /> : null;

  const content = (
    <>
      {picto}
      {labelNode}
      {children}
    </>
  );

  if (as === "span") {
    return (
      <span
        {...(rest as React.HTMLAttributes<HTMLSpanElement>)}
        className={classes.join(" ")}
        style={merged}
      >
        {content}
      </span>
    );
  }
  if (as === "div") {
    return (
      <div
        {...(rest as React.HTMLAttributes<HTMLDivElement>)}
        className={classes.join(" ")}
        style={merged}
      >
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      className={classes.join(" ")}
      style={merged}
    >
      {content}
    </button>
  );
}

function TileLabel({ name }: { name: string }) {
  const longest = Math.max(0, ...name.split(/[\s-]/).map((w) => w.length));
  const total = name.length;
  const len =
    longest >= 13 || total >= 22
      ? " l3"
      : longest >= 10
        ? " l2"
        : longest >= 7
          ? " l1"
          : "";
  return <span className={`cbn${len}`}>{cap(name)}</span>;
}
