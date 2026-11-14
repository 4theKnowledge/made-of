/**
 * Shared, server-safe module for the pictogram override maps.
 *
 * Both the server (which hydrates `itemOverrides` / `kindOverrides` once at
 * snapshot boot via `applyPictogramOverrides`) and the client Pictogram
 * component (which reads the maps during render, and populates them lazily
 * via /api/pictograms/* fetches) import from here.
 *
 * Because this module has no `"use client"` directive, Next bundles it once
 * per environment. Server has its own instance populated from DB at boot;
 * client has its own instance populated by fetches. They never need to
 * share memory — each render path reads the maps relevant to its runtime.
 */

export const itemOverrides = new Map<string, string>();
export const kindOverrides = new Map<string, string>();

export function applyPictogramOverrides(
  items: Map<string, string>,
  kinds: Map<string, string>,
) {
  itemOverrides.clear();
  for (const [name, svg] of items) itemOverrides.set(name, svg);
  kindOverrides.clear();
  for (const [code, svg] of kinds) kindOverrides.set(code, svg);
}
