import type { Confidence, ItemKind, ItemStatus, LinkType, Tier } from "@/db/schema";

export interface LinkRow {
  linkId: string;
  recipeId: string | null;
  itemId: string | null;
  targetItemId: string;
  type: LinkType;
  confidence: Confidence;
}

export interface RecipeRow {
  id: string;
  itemId: string;
  label: string | null;
  position: number;
}

export interface ItemRow {
  id: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  status: ItemStatus;
  firstAppeared: string | null;
  symbol: string | null;
  fact: string;
  tags: string[];
  isCanary: boolean;
  updatedAt: string;
}

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `request_failed_${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  createLink: (body: {
    type: LinkType;
    targetItemId: string;
    recipeId?: string | null;
    itemId?: string | null;
    confidence?: Confidence;
    note?: string | null;
    isCanary?: boolean;
  }) =>
    send<{ link: { id: string; type: LinkType; confidence: Confidence; recipeId: string | null; itemId: string | null; targetItemId: string } }>(
      "/api/admin/links",
      { method: "POST", body: JSON.stringify(body) },
    ),

  patchLink: (
    id: string,
    body: { confidence?: Confidence; note?: string | null; isCanary?: boolean },
  ) =>
    send<{ link: { id: string; confidence: Confidence; note: string | null; isCanary: boolean } }>(
      `/api/admin/links/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  deleteLink: (id: string) =>
    send<{ ok: true }>(`/api/admin/links/${encodeURIComponent(id)}`, { method: "DELETE" }),

  createRecipe: (body: { itemId: string; label?: string | null; position?: number }) =>
    send<{ recipe: RecipeRow }>("/api/admin/recipes", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  patchRecipe: (id: string, body: { label?: string | null; position?: number }) =>
    send<{ recipe: RecipeRow }>(`/api/admin/recipes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteRecipe: (id: string) =>
    send<{ ok: true }>(`/api/admin/recipes/${encodeURIComponent(id)}`, { method: "DELETE" }),

  createItem: (body: { name: string; tier: Tier; kind: ItemKind }) =>
    send<{ id: string; slug: string }>("/api/admin/items", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  patchItem: (
    id: string,
    body: Partial<{
      name: string;
      tier: Tier;
      kind: ItemKind;
      firstAppeared: string | null;
      symbol: string | null;
      fact: string;
      tags: string[];
      status: ItemStatus;
      isCanary: boolean;
    }>,
  ) =>
    send<{ item: ItemRow }>(
      `/api/admin/items/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  deleteItem: (id: string) =>
    send<{ ok: true }>(`/api/admin/items/${encodeURIComponent(id)}`, { method: "DELETE" }),

  publishItem: (id: string) =>
    send<{ item: ItemRow }>(`/api/admin/items/${encodeURIComponent(id)}/publish`, { method: "POST" }),

  unpublishItem: (id: string) =>
    send<{ item: ItemRow }>(`/api/admin/items/${encodeURIComponent(id)}/unpublish`, { method: "POST" }),

  searchItems: (q: string) =>
    send<{ items: { id: string; name: string; tier: Tier; kind: ItemKind }[] }>(
      `/api/admin/items?q=${encodeURIComponent(q)}&limit=20`,
      { method: "GET" },
    ),
};
