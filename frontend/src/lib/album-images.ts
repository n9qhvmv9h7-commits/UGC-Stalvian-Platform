/* Resolve an album's display name to its portrait in /assets/albums.
   Names from the panel don't always match the image files exactly
   ("Pershing Square" vs "Pershing Square Capital Management"), so match
   on normalized token overlap. */

import catalog from "./album-images.json";

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(capital|management|asset|assets|investment|investments|advisors|family|office|technologies|associates|fund|lp|llc|inc)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

const index = catalog.map((entry) => ({ ...entry, key: norm(entry.name) }));

export function albumImage(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const key = norm(displayName);
  if (!key) return null;
  const hit =
    index.find((e) => e.key === key) ||
    index.find((e) => e.key.startsWith(key) || key.startsWith(e.key)) ||
    index.find((e) => e.key.includes(key) || key.includes(e.key));
  return hit ? `/assets/albums/${hit.file}` : null;
}
