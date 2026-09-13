// Material-name parser: turns free-text particulars ("MOLDEX PVC WYE 6X6")
// into structured fields (brand / type / size / degrees / number system).
// Pure functions — no network, fully unit-testable (see scripts/parse-check.ts).

import type { ParsedParticulars, SizeSystem } from "./types";

/** Whole-token typo fixes seen in the legacy spreadsheet. */
export const TYPO_FIXES: Record<string, string> = {
  EMEREALD: "EMERALD",
  SOLVEN: "SOLVENT",
  FUSHION: "FUSION",
};

/** Known brand vocabulary (searched anywhere in the text). */
export const BRANDS = [
  "MOLDEX", "ATLANTA", "EMERALD", "UNIDEX", "LESSO",
  "BOSCH", "PETRON", "SHELL", "BULLDOG", "BROTHER",
];

/** Types that carry an angle — only these show/keep a DEGREES field. */
export const ANGLED_TYPES = ["ELBOW", "BEND"];

export const ANGLES = [22.5, 45, 90];

/** Uppercase, collapse whitespace, drop asterisks, unify dashes, strip parens.
 *  Joins spaced sizes onto their number so "2 IN" and "1 1/4 IN" parse. */
export function normalizeText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\*/g, " ")
    .replace(/[()]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/(\d+(?:\.\d+)?|\d+\/\d+)\s+IN\b/g, "$1IN")
    .replace(/(\d+(?:\.\d+)?|\d+\/\d+)\s+TO\s+(\d+(?:\/\d+)?\s?IN|\d+(?:\.\d+)?\s?MM|\d+(?:\/\d+)?|\d+(?:\.\d+)?)/g, "$1-$2")
    .replace(/\s+/g, " ")
    .trim();
}

function fixTypos(token: string): string {
  return TYPO_FIXES[token] ?? token;
}

// --- size token recognition -------------------------------------------------

const FRACTION = /^\d+\/\d+$/;                  // 3/4, 1/4
const WHOLE = /^\d+(?:\.\d+)?$/;                // 4, 10, 1.5
const AXB = /^(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)$/;    // 4X10, 6X90
const FRAC_PAIR = /^(\d+\/\d+)X(\d+\/\d+)$/;    // 1/4X3/4
const MIX_FRAC_FIRST = /^(\d+\/\d+)X(\d+(?:\.\d+)?)$/;  // 3/4X10, 1/4X1
const MIX_WHOLE_FIRST = /^(\d+(?:\.\d+)?)X(\d+\/\d+)$/; // 2X1/2
const RANGE = /^(\d+(?:\.\d+)?|\d+\/\d+)-(\d+(?:\/\d+)?)(?:IN|MM)?$/; // 1/2-2IN
const WITH_IN = /^(\d+(?:\.\d+)?|\d+\/\d+)IN$/; // 2IN
const WITH_MM = /^(\d+(?:\.\d+)?)MM$/;          // 10MM
const WITH_CC = /^\d+CC$/;                      // 400CC
const WITH_KGS = /^\d+KGS?$/;                   // 35KGS
const HASH = /^#\d+$/;                          // #4, #16

function isStrongSize(t: string): boolean {
  return (
    FRACTION.test(t) || AXB.test(t) || FRAC_PAIR.test(t) ||
    MIX_FRAC_FIRST.test(t) || MIX_WHOLE_FIRST.test(t) || RANGE.test(t) ||
    WITH_IN.test(t) || WITH_MM.test(t) || WITH_CC.test(t) ||
    WITH_KGS.test(t) || HASH.test(t) || t === "X"
  );
}

/**
 * The size region is the trailing run of size-ish tokens. A bare whole number
 * joins the region when it sits at the very end ("P-TRAP 2") or when the region
 * is already armed ("PIPE 1 1/2 X 10" keeps the leading "1").
 */
function collectSizeTokens(tokens: string[]): { size: string[]; rest: string[] } {
  const armed: boolean[] = new Array(tokens.length).fill(false);
  let end = tokens.length;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (isStrongSize(t)) {
      armed[i] = true;
      end = i;
    } else if (WHOLE.test(t)) {
      const atEnd = i === tokens.length - 1;
      // e.g. "1" in "1 1/4IN": the next token toward the end starts a size
      const nextStartsSize = i + 1 < tokens.length && /^\d+\/\d+/.test(tokens[i + 1]);
      if (atEnd || (armed[i + 1] && nextStartsSize)) {
        armed[i] = true;
        end = i;
      } else {
        break;
      }
    } else {
      break;
    }
  }
  const raw = tokens.slice(end);

  // Re-join: "1","1/2" -> "1 1/2";  then compact "A","X","B" -> "AXB".
  const joined: string[] = [];
  for (let k = 0; k < raw.length; k++) {
    if (raw[k] === "X") {
      joined.push("X");
    } else if (WHOLE.test(raw[k]) && k + 1 < raw.length && FRACTION.test(raw[k + 1])) {
      joined.push(`${raw[k]} ${raw[k + 1]}`);
      k += 1;
    } else {
      joined.push(raw[k]);
    }
  }
  const compact: string[] = [];
  for (let k = 0; k < joined.length; k++) {
    if (joined[k] === "X" && compact.length > 0 && k + 1 < joined.length) {
      compact[compact.length - 1] = `${compact[compact.length - 1]}X${joined[k + 1]}`;
      k += 1;
    } else {
      compact.push(joined[k]);
    }
  }
  return { size: compact, rest: tokens.slice(0, end) };
}

function classifySizeSystem(sizeTokens: string[]): SizeSystem {
  const s = sizeTokens.join(" ");
  if (/\d+MM/.test(s)) return "metric";
  if (WITH_CC.test(s) || WITH_KGS.test(s) || HASH.test(s) || s === "") return "n/a";
  return "english";
}

/** "2IN" -> "2 IN"; keeps fractions and AXB as written. */
function tidySize(sizeTokens: string[]): string {
  return sizeTokens
    .map((t) => (WITH_IN.test(t) ? t.replace(/IN$/, " IN") : t))
    .join(" ")
    .trim();
}

// --- the main entry point ---------------------------------------------------

/**
 * Parse a free-text particulars string into structured fields.
 *   "MOLDEX PVC ELBOW 6X90" -> brand MOLDEX, type "PVC ELBOW", size "6", degrees 90
 *   "MOLDEX PVC 4X10"       -> brand MOLDEX, type "PVC",       size "4X10" (diameter x length)
 *   "EMEREALD TEE 2 IN"     -> brand EMERALD, type "TEE",      size "2 IN"
 *   "DRILL BIT BOSCH 1/2"   -> brand BOSCH,   type "DRILL BIT", size "1/2"
 */
export function parseParticulars(raw: string): ParsedParticulars {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return { brand: "", type: "", model_ver: "", size_native: "",
      size_system: "n/a", degrees: 0, normalized: "" };
  }

  const tokens = normalized.split(" ").map(fixTypos);

  // 1. Brand: first brand-vocabulary token anywhere (removed from the run).
  let brand = "";
  const rest: string[] = [];
  for (const t of tokens) {
    if (!brand && BRANDS.includes(t)) {
      brand = t;
    } else {
      rest.push(t);
    }
  }

  // 2. Trailing size region on what remains.
  const { size, rest: typeTokens } = collectSizeTokens(rest);

  // 3. Degrees: only for angled types; "AXB" where B is a known angle.
  let degrees = 0;
  const typeText = typeTokens.join(" ");
  const isAngled = ANGLED_TYPES.some((a) => typeText.includes(a));
  if (isAngled && size.length >= 1) {
    const m = AXB.exec(size[size.length - 1]);
    if (m) {
      const b = Number(m[2]);
      if (ANGLES.includes(b)) {
        degrees = b;
        size[size.length - 1] = m[1]; // size becomes the diameter part only
      }
    }
  }

  const size_native = tidySize(size);
  const size_system = classifySizeSystem(size);
  const type = typeTokens.join(" ").trim();

  return {
    brand,
    type,
    model_ver: "",
    size_native,
    size_system,
    degrees,
    normalized: tokens.join(" ").trim(),
  };
}

/**
 * Canonical matching key: the standalone word PIPE is dropped so
 * "MOLDEX PVC 4X10" and "MOLDEX PVC PIPE 4X10" dedupe to one material
 * (each spelling is kept as an alias).
 */
export function canonicalKey(name: string): string {
  return normalizeText(name)
    .split(" ")
    .filter((t) => t !== "PIPE")
    .join(" ");
}

/** Build the search/display name from structured fields. */
export function buildSearchName(p: {
  brand?: string; type?: string; model_ver?: string; size_native?: string;
}): string {
  return [p.brand, p.type, p.model_ver, p.size_native]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}
