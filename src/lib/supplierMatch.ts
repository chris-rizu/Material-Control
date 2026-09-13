// Supplier typo matching: when the typed supplier doesn't exist but is
// similar to one, we can warn ("did you mean?") instead of silently creating
// a duplicate supplier. Pure functions, no network.

import type { Supplier } from "./types";

/** Same normalization the database uses for suppliers.name_norm. */
export function normName(s: string): string {
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

/** Sørensen–Dice coefficient over character bigrams (0..1). */
export function diceSimilarity(a: string, b: string): number {
  const clean = (t: string) => normName(t).replace(/[^A-Z0-9 ]/g, "");
  const A = clean(a);
  const B = clean(b);
  if (A === B) return 1;
  if (A.length < 2 || B.length < 2) return A === B ? 1 : 0;
  const gramsA = new Set<string>();
  for (let i = 0; i < A.length - 1; i++) gramsA.add(A.slice(i, i + 2));
  const gramsB = new Set<string>();
  for (let i = 0; i < B.length - 1; i++) gramsB.add(B.slice(i, i + 2));
  let shared = 0;
  gramsA.forEach((g) => {
    if (gramsB.has(g)) shared++;
  });
  return (2 * shared) / (gramsA.size + gramsB.size);
}

/** Letters/digits only — punctuation-insensitive comparison
 *  ("MACHINERY, INC." === "MACHINERY INC"). */
function foldLoose(s: string): string {
  return normName(s).replace(/[^A-Z0-9]/g, "");
}

/** Suppliers whose normalized name equals the input (punctuation-insensitive). */
function findExact(input: string, suppliers: Supplier[]): Supplier | null {
  const q = normName(input);
  if (!q) return null;
  const loose = foldLoose(input);
  return (
    suppliers.find((s) => normName(s.name) === q || foldLoose(s.name) === loose) ?? null
  );
}

/** Minimum similarity for a "did you mean" candidate. */
const CANDIDATE_THRESHOLD = 0.4;

export interface SupplierMatch {
  /** An existing supplier whose normalized name equals the input. */
  exact: Supplier | null;
  /** Close-but-not-exact suppliers, best first (max 3). */
  candidates: Supplier[];
}

/**
 * Match a typed supplier name against the known list:
 *   - exact normalized hit  → { exact, candidates: [] }          (safe to use)
 *   - similar names found   → { exact: null, candidates: [...] } (typo? warn)
 *   - nothing similar       → { exact: null, candidates: [] }    (genuinely new)
 */
export function matchSuppliers(input: string, suppliers: Supplier[]): SupplierMatch {
  const q = normName(input);
  if (!q) return { exact: null, candidates: [] };

  const exact = findExact(input, suppliers);
  if (exact) return { exact, candidates: [] };

  const candidates = suppliers
    .map((s) => {
      const n = normName(s.name);
      let score = diceSimilarity(input, s.name);
      // containment boost: "PETRON" vs "PETRON MAMBALING, CEBU CITY"
      if (n.includes(q) || q.includes(n)) score = Math.max(score, 0.75);
      return { supplier: s, score };
    })
    .filter((x) => x.score >= CANDIDATE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.supplier);

  return { exact: null, candidates };
}
