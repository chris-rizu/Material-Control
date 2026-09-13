// Parser self-check against the real data extracted from PURCHASES (1).xlsx.
// Run: npm run check:parse
// Reads ../_study/purchases_flat.csv (written during the workbook study) and
// asserts the tricky cases; prints a table of every distinct parse.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseParticulars, canonicalKey } from "../src/lib/parse";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = join(here, "..", "..", "_study", "purchases_flat.csv");

// Minimal CSV reader (python csv module output: quoted fields, embedded commas).
function readCsv(path: string): string[][] {
  const text = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

let failures = 0;
function expect(label: string, actual: unknown, wanted: unknown) {
  const ok = String(actual) === String(wanted);
  if (!ok) {
    failures++;
    console.log(`  FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(wanted)}`);
  }
}

const rows = readCsv(csvPath);
const dataRows = rows.slice(1); // header
const particularsList = [...new Set(dataRows.map((r) => r[4]).filter(Boolean))];

console.log(`${particularsList.length} distinct particulars strings\n`);

// --- the tricky cases -------------------------------------------------------

const t = (s: string) => parseParticulars(s);

let p = t("MOLDEX PVC ELBOW 6X90");
expect("elbow brand", p.brand, "MOLDEX");
expect("elbow type", p.type, "PVC ELBOW");
expect("elbow size", p.size_native, "6");
expect("elbow degrees", p.degrees, "90");

p = t("MOLDEX PVC WYE 6X6");
expect("wye type", p.type, "PVC WYE");
expect("wye size", p.size_native, "6X6");
expect("wye degrees (must stay 0 — wyes have none)", p.degrees, "0");

p = t("MOLDEX PVC 4X10");
expect("pipe size", p.size_native, "4X10");
expect("pipe degrees", p.degrees, "0");

p = t("EMEREALD TEE 2 IN");
expect("typo brand", p.brand, "EMERALD");
expect("tee size", p.size_native, "2 IN");

p = t("LESSO PPR COUPLING 1 1/4 IN");
expect("ppr size", p.size_native, "1 1/4 IN");

p = t("DRILL BIT BOSCH 1/2");
expect("mid-brand", p.brand, "BOSCH");
expect("drill type", p.type, "DRILL BIT");
expect("drill size", p.size_native, "1/2");

p = t("ATLANTA PVC SOLVEN 400CC");
expect("solvent typo+brand", p.brand, "ATLANTA");
expect("solvent size", p.size_native, "400CC");
expect("solvent system", p.size_system, "n/a");

p = t("FULL THREADED ROD 3/8 (10MM)");
expect("rod size", p.size_native, "3/8 10MM");

p = t("MOLDEX P-TRAP 2");
expect("ptrap size", p.size_native, "2");

p = t("MOLDEX PVC BLUE PIPE 1 1/2 X 10");
expect("blue pipe size", p.size_native, "1 1/2X10");
expect("blue pipe type", p.type, "PVC BLUE PIPE");

p = t("LESSO PPR PIPE 1 1/4 IN");
expect("spaced-frac size", p.size_native, "1 1/4 IN");

p = t("UNIDEX PVC CLEAN-OUT 3 IN");
expect("spaced-in size", p.size_native, "3 IN");
expect("spaced-in type", p.type, "UNIDEX PVC CLEAN-OUT".replace("UNIDEX ", ""));

p = t("ANGLE BAR 1/4X1 5MM");
expect("mixed-axb size", p.size_native, "1/4X1 5MM");
expect("mixed-axb type", p.type, "ANGLE BAR");

p = t("MOLDEX BLUE PIPE 3/4X10");
expect("frac-first size", p.size_native, "3/4X10");
expect("frac-first type", p.type, "BLUE PIPE");

p = t("FUSHION MACHINE 1/2 TO 2 IN");
expect("range size", p.size_native, "1/2-2IN");
expect("range type", p.type, "FUSION MACHINE");

p = t("G.I. WIRE #16 35KGS");
expect("wire size", p.size_native, "#16 35KGS");

p = t("CHB #4");
expect("chb size", p.size_native, "#4");

p = t("XCS");
expect("fuel type", p.type, "XCS");

// PIPE-infix dedupe
expect("pipe-infix dedupe",
  canonicalKey("MOLDEX PVC 4X10") === canonicalKey("MOLDEX PVC PIPE 4X10"), "true");

console.log(failures === 0 ? "All tricky cases passed.\n" : `\n${failures} FAILURES\n`);

// --- full table -------------------------------------------------------------

console.log("DISTINCT PARSES");
console.log("-".repeat(100));
for (const s of [...particularsList].sort()) {
  const r = t(s);
  const deg = r.degrees ? ` ${r.degrees}°` : "";
  console.log(
    `${s.padEnd(48).slice(0, 48)} -> brand=${(r.brand || "-").padEnd(8)} type=${(r.type || "-").padEnd(24)} size=${(r.size_native || "-").padEnd(12)}${deg}`,
  );
}
