// Excel import: read PURCHASES workbooks into blocks. (Export moved to Google
// Sheets — see sheets.ts.) exceljs is loaded lazily to keep startup fast.
// The reader accepts BOTH layouts — the legacy 7-column workbook (optional
// col-H subtotals) and the app's own 8-column export (PROJECT in E, amount
// in H, what a Google Sheets export downloads as .xlsx) — detected by the
// header row, so an export round-trips losslessly.

import type ExcelJSNS from "exceljs";

// --- import -----------------------------------------------------------------

export interface ImportedLine {
  row: number;
  date: string; // YYYY-MM-DD (forward-filled)
  siNo: string; // forward-filled
  supplier: string; // forward-filled
  project: string; // forward-filled (8-column layout only; legacy files have none)
  particulars: string;
  unitPrice: number;
  quantity: number;
  amountStored: number | null;
  receiptQuality: "ok" | "unreadable" | "no-invoice";
  /** true for "DISCOUNT n%" adjustment rows — negated on import, never a material */
  discount: boolean;
}

export interface ImportedBlock {
  date: string;
  siNo: string;
  supplier: string;
  lines: ImportedLine[];
  subtotalStored: number | null;
  subtotalRow: number | null;
}

export interface RepairNote {
  row: number;
  kind: "missing-amount" | "wrong-subtotal" | "fuel-rounding" | "unreadable" | "possible-duplicate" | "discount";
  detail: string;
}

export interface ParsedLedger {
  blocks: ImportedBlock[];
  lineCount: number;
  storedTotal: number; // sum of stored amounts (what the Excel file itself records)
  repairedTotal: number; // stored total + missing amounts filled from E×F
  repairs: RepairNote[];
}

function cellNumber(v: ExcelJSNS.CellValue): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in (v as object)) {
    const r = (v as { result: unknown }).result;
    if (typeof r === "number") return r;
  }
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function cellText(v: ExcelJSNS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in (v as object)) {
    return String((v as { text: unknown }).text ?? "").trim();
  }
  if (typeof v === "object" && "result" in (v as object)) {
    return String((v as { result: unknown }).result ?? "").trim();
  }
  return String(v).trim();
}

function isoDate(v: ExcelJSNS.CellValue): string | null {
  if (v instanceof Date) {
    // exceljs gives local-midnight Dates; format in parts to avoid TZ shifts.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "object" && v !== null && "result" in v) {
    return isoDate((v as { result: ExcelJSNS.CellValue }).result);
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/** A "DISCOUNT n%" row: the workbook records the discount VALUE (positive) and
 *  puts the block's NET total in col H. It is an adjustment, not a purchase —
 *  the import stores it as a negative line so every sum equals what was paid.
 *  (Brand names like "LESSO" don't match: anchored to a whole-word DISCOUNT,
 *  and only on a row with no unit price — real items always have one.) */
export function isDiscountParticulars(particulars: string, unitPrice: number): boolean {
  return /^discount\b/i.test(particulars.trim()) && unitPrice === 0;
}

/** Read the legacy workbook (File from an <input type="file">). */
export async function readPurchasesFile(file: File): Promise<ParsedLedger> {
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no sheets.");

  const repairs: RepairNote[] = [];
  const lines: ImportedLine[] = [];
  let storedTotal = 0;

  let curDate = "";
  let curSi = "";
  let curSupplier = "";
  let curProject = "";

  // Column layout, detected from the header row (row 3): the legacy workbook
  // has price/qty/amount in E/F/G with an optional col-H subtotal; this app's
  // export adds PROJECT in E and shifts them to F/G/H with nothing after.
  const headerAt = (c: number) => cellText(ws.getRow(3).getCell(c).value).toUpperCase();
  const hasProjectCol = headerAt(5) === "PROJECT";
  const colProject = hasProjectCol ? 5 : 0;
  const colPrice = hasProjectCol ? 6 : 5;
  const colQty = hasProjectCol ? 7 : 6;
  const colAmount = hasProjectCol ? 8 : 7;
  const colSubtotal = hasProjectCol ? 0 : 8; // 0 = none (nothing right of AMOUNT)

  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cA = row.getCell(1).value;
    const cB = row.getCell(2).value;
    const cC = row.getCell(3).value;
    const cD = row.getCell(4).value;
    const cE = row.getCell(colPrice).value;
    const cF = row.getCell(colQty).value;
    const cG = row.getCell(colAmount).value;

    const date = isoDate(cA);
    const si = cellText(cB);
    const supplier = cellText(cC);
    const project = colProject ? cellText(row.getCell(colProject).value) : "";
    const particulars = cellText(cD);
    const price = cellNumber(cE);
    const qty = cellNumber(cF);
    const amount = cellNumber(cG);
    const hasHeader = date !== null || si !== "" || supplier !== "";
    const hasItem = particulars !== "" || price !== null || qty !== null;

    if (!hasHeader && !hasItem) continue;

    if (date) curDate = date;
    if (si) curSi = si;
    if (supplier) curSupplier = supplier;
    if (project) curProject = project;

    if (!hasItem) continue;

    const unreadable = /UNREADABLE/.test(particulars);
    // An unreadable-receipt line is NOT attributable to the block above it
    // (the original file's own subtotal SUM(G14:G16) excludes row 17): keep it
    // as its own entry with no supplier/invoice rather than forward-filling.
    // A DISCOUNT row in the legacy layout stores the discount VALUE (positive)
    // and the block's NET total in H — store it as a negative line instead, so
    // the block sums to what was actually paid and col H checks out.
    const discount = isDiscountParticulars(particulars, price ?? 0);
    let stored = amount;
    if (discount && colSubtotal !== 0 && amount !== null && amount > 0) {
      stored = -amount;
      repairs.push({
        row: r,
        kind: "discount",
        detail: `“${particulars}” — kept as an adjustment: imported as −${amount.toFixed(2)} so the block totals what was actually paid (net in col H)`,
      });
    }
    const line: ImportedLine = {
      row: r,
      date: curDate,
      siNo: unreadable ? "" : curSi,
      supplier: unreadable ? "" : curSupplier,
      project: curProject,
      particulars,
      unitPrice: price ?? 0,
      quantity: qty ?? 1,
      amountStored: stored,
      receiptQuality: unreadable ? "unreadable" : curSi === "" || curSi === "N/A" ? "no-invoice" : "ok",
      discount,
    };
    lines.push(line);
    if (stored !== null) storedTotal += stored;

    if (amount === null && price !== null) {
      repairs.push({
        row: r,
        kind: "missing-amount",
        detail: `No AMOUNT stored — filled with ${price} × ${qty} = ${Math.round(price * (qty ?? 1) * 100) / 100}`,
      });
    } else if (amount !== null && price !== null) {
      const recomputed = price * (qty ?? 1);
      if (Math.abs(amount - recomputed) > 0.01 && Math.abs(amount - recomputed) <= 1) {
        repairs.push({
          row: r,
          kind: "fuel-rounding",
          detail: `Receipt amount ${amount.toFixed(2)} kept (arithmetic gives ${recomputed.toFixed(2)}) — pump total rounded to pesos`,
        });
      }
    }
    if (unreadable) {
      repairs.push({ row: r, kind: "unreadable", detail: "Marked *RECEIPT UNREADABLE* in the original — kept with a quality flag" });
    }
  }

  // Second pass: block boundaries + stored subtotals (column H) + notes.
  const blocks: ImportedBlock[] = [];
  for (const line of lines) {
    const key = `${line.date}|${line.siNo}|${line.supplier}`;
    let block = blocks[blocks.length - 1];
    const blockKey = block
      ? `${block.date}|${block.siNo}|${block.supplier}`
      : "";
    if (!block || blockKey !== key) {
      block = { date: line.date, siNo: line.siNo, supplier: line.supplier, lines: [], subtotalStored: null, subtotalRow: null };
      blocks.push(block);
    }
    block.lines.push(line);
  }

  // Attach stored subtotals: an H value sits on the LAST row of its block.
  // (Legacy layout only — the 8-column export has AMOUNT in H and no
  // subtotal column, so those numbers must never read as subtotals.)
  for (let r = 4; colSubtotal !== 0 && r <= ws.rowCount; r++) {
    const hVal = cellNumber(ws.getRow(r).getCell(colSubtotal).value);
    if (hVal === null) continue;
    const owner = blocks.find(
      (b) => b.lines[b.lines.length - 1].row === r || (b.lines[0].row <= r && b.lines[b.lines.length - 1].row >= r),
    );
    if (owner) {
      owner.subtotalStored = hVal;
      owner.subtotalRow = r;
    }
  }

  // Wrong-subtotal + duplicate notes.
  for (const b of blocks) {
    const sum = b.lines.reduce((s, l) => s + (l.amountStored ?? l.unitPrice * l.quantity), 0);
    if (b.subtotalStored !== null && Math.abs(b.subtotalStored - sum) > 0.01) {
      repairs.push({
        row: b.subtotalRow ?? b.lines[b.lines.length - 1].row,
        kind: "wrong-subtotal",
        detail: `Stored subtotal ${b.subtotalStored.toFixed(2)} ≠ line sum ${sum.toFixed(2)} (SI ${b.siNo || "N/A"}, ${b.supplier}) — the ledger always recomputes, nothing to fix`,
      });
    }
  }
  const seen = new Map<string, number>();
  for (const l of lines) {
    if (l.discount) continue; // discount rows recur by nature, never duplicates
    const k = `${l.particulars}|${l.unitPrice}|${l.quantity}`;
    const prev = seen.get(k);
    if (prev !== undefined) {
      repairs.push({
        row: l.row,
        kind: "possible-duplicate",
        detail: `Same item+price+qty as row ${prev} — imported as-is (plausibly two deliveries); flagged for review`,
      });
    } else {
      seen.set(k, l.row);
    }
  }

  const repairedTotal = lines.reduce(
    (s, l) => s + (l.amountStored ?? Math.round(l.unitPrice * l.quantity * 100) / 100),
    0,
  );

  return { blocks, lineCount: lines.length, storedTotal, repairedTotal, repairs };
}
