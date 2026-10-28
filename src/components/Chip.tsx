import Link from "next/link";
import type { ItemKind, Tier } from "@/db/schema";
import { Pictogram } from "@/pictograms/Pictogram";

export interface ChipProps {
  slug: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
  size?: "sm" | "md";
  as?: "a" | "span";
}

/**
 * The `.chip` from the prototype: pictogram tile + name, outlined, clickable.
 * Links to the public item page.
 */
export function Chip({
  slug,
  name,
  tier,
  kind,
  symbol,
  size = "md",
  as = "a",
}: ChipProps) {
  const content = (
    <>
      <Pictogram
        name={name}
        tier={tier}
        kind={kind}
        symbol={symbol}
        className={size === "sm" ? "sm" : undefined}
      />
      <span className="nm">{name}</span>
    </>
  );
  const cls = `chip${size === "sm" ? " sm" : ""}`;
  if (as === "span") {
    return <span className={cls}>{content}</span>;
  }
  return (
    <Link href={`/i/${slug}`} className={cls}>
      {content}
    </Link>
  );
}
