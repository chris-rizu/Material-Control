// Excel I/O: read PURCHASES workbooks into blocks, and write the ledger back
// out ("can be opened in Excel"): 8 columns (PROJECT included), every cell
// center-aligned, Arial 11, dates as long dates, money in the accounting
// format, every line carrying its own date / SI# / supplier / project. The
// data sits in a real Excel table with the blue Table Style Medium 9. Nothing
// sits to the right of AMOUNT. exceljs is loaded lazily to keep startup fast.
// The reader accepts BOTH layouts — the legacy 7-column workbook (optional
// col-H subtotals) and this app's own 8-column export (PROJECT in E, amount
// in H) — detected by the header row, so an export round-trips losslessly.

import type ExcelJSNS from "exceljs";

export const ACCOUNTING_FMT = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@_-';
export const LONG_DATE_FMT = "[$-F800]dddd\\,\\ mmmm\\ dd\\,\\ yyyy";

export const COL_WIDTHS = [32.53, 16.73, 30.6, 54.27, 20.0, 18.13, 14.0, 16.33];
export const HEADERS = [
  "DATE", "INVOICE/RECEIPT", "SUPPLIER'S NAME", "PARTICULARS", "PROJECT",
  "UNIT PRICE", "QUANTITY", "AMOUNT",
];
export const FONT_NAME = "Arial";

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
  kind: "missing-amount" | "wrong-subtotal" | "fuel-rounding" | "unreadable" | "possible-duplicate";
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
    const line: ImportedLine = {
      row: r,
      date: curDate,
      siNo: unreadable ? "" : curSi,
      supplier: unreadable ? "" : curSupplier,
      project: curProject,
      particulars,
      unitPrice: price ?? 0,
      quantity: qty ?? 1,
      amountStored: amount,
      receiptQuality: unreadable ? "unreadable" : curSi === "" || curSi === "N/A" ? "no-invoice" : "ok",
    };
    lines.push(line);
    if (amount !== null) storedTotal += amount;

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

// --- export -----------------------------------------------------------------

export interface ExportRow {
  purchase_date: string;
  si_no: string;
  supplier: string | null;
  particulars_raw: string;
  project_name?: string | null;
  unit_price: number;
  quantity: number;
  amount: number;
  line_seq: number;
}

/**
 * Build the PURCHASES-layout workbook from flat ledger rows. Returns a Blob.
 * Title in A1, headers on row 3, data from row 4 — every line carries its own
 * date / SI# / supplier / project (nothing left blank). Styling per the user's
 * spec: the data sits in a real Excel table with the blue "Table Style Medium
 * 9" (banded rows), Arial 11 everywhere, headers capitalized+bold in white on
 * the style's blue, every cell center-aligned, accounting/long-date number
 * formats — and nothing to the right of AMOUNT. The PROJECT column means an
 * export re-imports losslessly (the reader detects this 8-column layout).
 */
export async function buildPurchasesWorkbook(rows: ExportRow[]): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Material Control";
  const ws = wb.addWorksheet("Sheet1");

  // column widths + column-wide styles (centered, money/dates formatted)
  for (let i = 1; i <= COL_WIDTHS.length; i++) {
    const col = ws.getColumn(i);
    col.width = COL_WIDTHS[i - 1];
    col.alignment = { horizontal: "center" };
    if (i === 1) col.numFmt = LONG_DATE_FMT;
    if (i === 6 || i === 8) col.numFmt = ACCOUNTING_FMT;
  }

  // Title (row 1); the table itself starts at A3 (headers) → A4 (data).
  const title = ws.getCell("A1");
  title.value = "PURCHASES";
  title.font = { name: FONT_NAME, size: 11 };

  // UTC midnight: exceljs serializes Dates as UTC, so a local-midnight Date
  // in Manila (UTC+8) would land on the PREVIOUS day in Excel.
  const tableRows: ExcelJSNS.CellValue[][] = rows.map((x) => {
    const [y, m, d] = x.purchase_date.slice(0, 10).split("-").map(Number);
    return [
      new Date(Date.UTC(y, m - 1, d)),
      x.si_no,
      x.supplier ?? "",
      x.particulars_raw,
      x.project_name ?? "",
      Number(x.unit_price),
      Number(x.quantity),
      Number(x.amount),
    ];
  });

  ws.addTable({
    name: "Purchases",
    ref: "A3",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium9", showRowStripes: true },
    columns: HEADERS.map((h) => ({ name: h, filterButton: false })),
    rows: tableRows,
  });

  // direct formatting wins over the table style, so pin everything per cell:
  // Arial 11 everywhere, headers bold in white (the style's blue header and
  // row banding come from Table Style Medium 9), money/dates formatted,
  // everything centered — per-cell styles also keep the formats safe in
  // readers that ignore column-level styles
  const headerRow = ws.getRow(3);
  headerRow.eachCell((cell) => {
    cell.font = { name: FONT_NAME, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center" };
  });
  for (let r = 4; r < 4 + tableRows.length; r++) {
    ws.getRow(r).eachCell((cell, col) => {
      cell.font = { name: FONT_NAME, size: 11 };
      cell.alignment = { horizontal: "center" };
      if (col === 1) cell.numFmt = LONG_DATE_FMT;
      if (col === 6 || col === 8) cell.numFmt = ACCOUNTING_FMT;
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
