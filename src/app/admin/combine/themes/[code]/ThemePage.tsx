"use client";

import { useState } from "react";
import type { ClosureConfig } from "@/combine/closure";
import type { Tier, ItemKind } from "@/db/schema";
import { ThemeBuilder, type BuilderItem, type BuilderRecipe } from "./ThemeBuilder";
import { ThemeSettings } from "./ThemeSettings";

/** Client wrapper that keeps ThemeSettings' publish gate in sync with the
 *  builder's live member set. Without it, `memberCount` is a snapshot from
 *  the server page and the publish button stays stuck on "Needs items to
 *  publish" until a full reload. */
export function ThemePage({
  themeCode,
  initialIsPublished,
  initialPictogram,
  initialMemberIds,
  initialMemberSources,
  initialClosureConfig,
  items,
  recipes,
  availableTiers,
  availableKinds,
  availableTags,
  themeLabel,
}: {
  themeCode: string;
  initialIsPublished: boolean;
  initialPictogram: string | null;
  initialMemberIds: string[];
  initialMemberSources: Record<string, string>;
  initialClosureConfig: ClosureConfig | null;
  items: BuilderItem[];
  recipes: BuilderRecipe[];
  availableTiers: Tier[];
  availableKinds: ItemKind[];
  availableTags: string[];
  themeLabel: string;
}) {
  const [memberCount, setMemberCount] = useState(initialMemberIds.length);
  return (
    <>
      <ThemeSettings
        themeCode={themeCode}
        initialIsPublished={initialIsPublished}
        initialPictogram={initialPictogram}
        memberCount={memberCount}
      />
      <ThemeBuilder
        themeCode={themeCode}
        themeLabel={themeLabel}
        initialMemberIds={initialMemberIds}
        initialMemberSources={initialMemberSources}
        initialClosureConfig={initialClosureConfig}
        items={items}
        recipes={recipes}
        availableTiers={availableTiers}
        availableKinds={availableKinds}
        availableTags={availableTags}
        onMembersChange={setMemberCount}
      />
    </>
  );
}
