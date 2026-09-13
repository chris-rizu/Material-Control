import { matchSuppliers } from "../src/lib/supplierMatch";
import type { Supplier } from "../src/lib/types";

const names = [
  "ANTECRISTO BUILDERS & DESIGN", "CEBU LUCKY MACHINERY, INC.", "PETRON MAMBALING, CEBU CITY",
  "SUNTRADE", "OCTAGON", "METRO", "WORLDWIDE HOME DEPOT", "SHELL SRP",
  "CEBU ATLANTIC HARDWARE", "CEBU HOME & BUILDERS CENTRE", "CITI HARDWARE",
  "NEW MILLENIUM HARDWARE, INC.", "BELMONT HARDWARE DEPOT", "MAMA MARY HARDWARE",
  "ATLAST BOLT FASTENERS CORP.",
];
const suppliers: Supplier[] = names.map((name, i) => ({ id: i + 1, name }));

let fails = 0;
function check(label: string, cond: boolean, detail = "") {
  if (!cond) { fails++; console.log(`FAIL ${label} ${detail}`); }
  else console.log(`ok   ${label}`);
}

let m = matchSuppliers("CEBU LUCKY MACHINERY, INC.", suppliers);
check("verbatim input → exact", m.exact?.name === "CEBU LUCKY MACHINERY, INC.");

m = matchSuppliers("cebu lucky machinery inc", suppliers);
check("no punctuation → exact (loose)", m.exact?.name === "CEBU LUCKY MACHINERY, INC.");

m = matchSuppliers("CEBU LUCKY MACHINERY", suppliers);
check("missing suffix → suggests CEBU LUCKY",
  m.exact === null && m.candidates[0]?.name === "CEBU LUCKY MACHINERY, INC.");

m = matchSuppliers("SUNTRAD", suppliers);
check("typo SUNTRAD → suggests SUNTRADE",
  m.exact === null && m.candidates.some((c) => c.name === "SUNTRADE"));

m = matchSuppliers("ATLAST BOLT FASTENERS CORP", suppliers);
check("corp without dot → exact (loose)", m.exact?.name === "ATLAST BOLT FASTENERS CORP.");

m = matchSuppliers("petron", suppliers);
check("short 'petron' → suggests PETRON MAMBALING",
  m.candidates.some((c) => c.name.startsWith("PETRON")));

m = matchSuppliers("BRAND NEW UNKNOWN SUPPLY XYZQ", suppliers);
check("genuinely new name → no candidates, no exact",
  m.exact === null && m.candidates.length === 0);

m = matchSuppliers("", suppliers);
check("empty input → nothing", m.exact === null && m.candidates.length === 0);

console.log(fails === 0 ? "\nAll supplier-match tests passed." : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
