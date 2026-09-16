// Keyword → category rules shared by the import pipeline and the sheet page.
import type { Category } from "./types";

const RULES: Array<[RegExp, string]> = [
  [/GLUE|ASSORTED| AND /, "Misc Hardware"],
  [/PPR/, "PPR Pipes & Fittings"],
  [/PVC|WYE|P-TRAP|ELBOW|COUPLING|CLEAN-OUT|BUSHING|BEND|TEE/, "PVC Pipes & Fittings"],
  [/BAR|STEEL|WIRE/, "Structural Steel"],
  [/CHB|CEMENT/, "Masonry"],
  [/NUT|WASHER|THREADED|SCREW|NAIL|BOLT/, "Fasteners"],
  [/XCS|XTRA|ADVANCE|DIESEL|GAS/, "Fuel & Oil"],
  [/HARD HAT|SAFETY|LONGSLEEVE|REFLECTOR|VEST/, "Safety Gear"],
  [/DRILL|BIT|PRINTER|FUSION|MACHINE|LEVEL/, "Tools & Equipment"],
  [/BOND|PAPER|STAPLE|PRINTING|INK|TONER/, "Office & Printing"],
  [/SHOES|HAT/, "Safety Gear"],
];

export function guessCategory(text: string, cats: Category[]): Category {
  const t = text.toUpperCase();
  for (const [re, name] of RULES) {
    if (re.test(t)) return cats.find((c) => c.name === name) ?? cats[cats.length - 1];
  }
  return cats.find((c) => c.name === "Misc Hardware") ?? cats[0];
}

// Units for categories the rules may create (matching the schema seed);
// everything the seed doesn't give a special unit defaults to pieces.
const UNITS: Record<string, string> = { "Fuel & Oil": "L" };

export interface CategoryTarget {
  name: string;
  unit: string;
}

/**
 * The category the keyword rules say this text belongs to — by NAME, whether
 * or not the database has it yet. Callers (import, the Purchases entry row)
 * create the missing category with addCategory() instead of letting the item
 * fall into whatever category happens to exist.
 */
export function guessCategoryTarget(text: string): CategoryTarget {
  const t = text.toUpperCase();
  for (const [re, name] of RULES) {
    if (re.test(t)) return { name, unit: UNITS[name] ?? "pc" };
  }
  return { name: "Misc Hardware", unit: "pc" };
}
