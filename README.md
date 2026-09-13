# Material Control — RORO Transport

Predictive material-control / inventory system for hardware & construction purchases.
Supabase-backed, runs locally in your browser, stays Excel-compatible.

## What it does

- **Purchases ledger** — one row per line item, grouped into invoices (DATE + SI# + supplier),
  per-invoice subtotals and a grand total, like your `PURCHASES (1).xlsx` but error-proof:
  amounts are computed (and kept when a receipt differs, e.g. fuel rounded at the pump).
- **Encode per category** — pick the category; the form shows exactly the right attributes
  (DEGREES appears only for elbows/bends, MODEL for tools, sizes for pipes...).
- **Predictive entry with historical memory** — type `MOLDEX WYE` and the system suggests
  `MOLDEX PVC WYE 6X6` (learned from everything ever entered), prefills brand/type/size
  and the last price paid. Every accepted entry strengthens the suggestion.
- **Dual number systems** — every size keeps its native system (english/metric) and the
  text as printed (`6X10`, `1/2`, `10MM`, `400CC`).
- **Excel in/out** — import the old spreadsheet (with a preview of every repair) and export
  the ledger back to the same PURCHASES layout any time.

## First-time setup (once, ~10 minutes)

1. **Install once:** open PowerShell in this folder → `npm install`
2. **Create the database:** follow the on-screen steps in the app (`npm run dev` shows them),
   or in short:
   - supabase.com → new project `material-control` (region Singapore, free tier)
   - SQL Editor → paste ALL of `supabase/schema.sql` → Run
   - Authentication → Sign In/Providers → Email → turn **off** "Confirm email"
   - Authentication → Users → Add user (tick **Auto confirm**). **The first user = owner.**
   - Project Settings → API → copy the **Project URL** and **anon public** key into `.env`
     (copy `.env.example` → `.env` first)
3. `npm run dev` → open http://localhost:5173 → sign in → **Import** the old
   `PURCHASES (1).xlsx` (preview shows every repair before writing).

## Everyday use

```
npm run dev        # start the app (leave the window open)
```

- **Ledger** — browse, filter, export to Excel, delete stray lines.
- **Entry** — encode a new invoice: date, SI#, supplier, lines. Subtotal is automatic.
- **Materials** — the structured catalog; click a row to see its remembered aliases.
- **Import / Export** — Excel compatibility in both directions.
- **Users** (owner) — roles: owner (everything) / encoder (encode+import) / viewer (read).

## Data model (Supabase)

| Table | Purpose |
|---|---|
| `categories` | attribute templates per category (which fields exist, when DEGREES shows) |
| `materials` | the structured catalog: brand / type / model / size / degrees / unit-system |
| `material_aliases` | the predictive memory: every text ever typed → material, with hit counts |
| `suppliers` | normalized supplier list |
| `purchases` | one row per line item; `amount` = receipt truth, `amount_recomputed` = price × qty |
| `import_batches` | file SHA-256 guard so the same workbook is never double-imported |

Search RPC `search_materials(q)` ranks by trigram similarity over names **and** aliases,
then by usage frequency; also returns the last price paid.

## Import repairs handled automatically (from the real file)

- rows 83–87: amounts missing → filled from price × qty (₱135, ₱880, ₱129, ₱51, ₱27)
- row 88: wrong stored subtotal (₱5,629.95 was copied from another invoice) → ledger always recomputes
- rows 13/19: fuel rounded at the pump (700 / 200 vs 699.61 / 199.80) → receipt amount kept, flagged
- row 17: `*RECEIPT UNREADABLE*` → kept as its own unattributed line (no supplier/invoice —
  the original file's own subtotal excludes it from SUNTRADE), flagged `unreadable`
- `N/A` invoice numbers → kept, flagged `no-invoice`
- typos (EMEREALD, SOLVEN, FUSHION) → fixed during material parsing
- repeated item+price+qty (rows 122/123) → imported as-is, flagged for review

Imported grand total with repairs: **₱500,206.89** — the original file itself records
₱498,984.89 (the difference is exactly the five filled amounts). Both numbers are shown
by the import preview.

## Desktop app

The same app runs as a native Windows desktop window (Electron):

```
npm run app          # build once, then open the desktop app
npm run app:dev      # open the desktop window against a running npm run dev
npm run app:installer # build release\Material Control Setup <version>.exe installer
```

- `npm run app` needs a one-time `npm install` (already done) — it rebuilds the
  bundle and opens the Material Control window. Your login and data are the
  same online Supabase database, so the desktop app and the browser stay in sync.
- `npm run app:installer` produces a standalone installer in `release\` —
  run it once on any Windows PC and Material Control installs like normal
  software (Start-menu shortcut, own window, no browser needed).

## Light & dark mode

Use the sun/moon button in the top bar. **Dark** (default) is the navy look;
**light** turns the sidebar, header, and content white. The choice is remembered
per browser/device, and the sidebar logo swaps automatically (dark variant on
navy, full-color on white).

## Supplier typo guard

When encoding, the supplier box suggests existing suppliers as you type. If the
typed name doesn't exist but is close to one (e.g. "CEBU LUCKY MACHINERY" or a
typo like "SUNTRAD"), the app asks **"did you mean?"** before saving — new
suppliers are only created deliberately (via the "Add new supplier" option or
when nothing similar exists). The same guard applies when editing a line's
supplier inline.

## Product demo video

`Material Control Demo.mp4` (on the `Material Control` desktop folder) shows the
full workflow — predictive entry, supplier typo guard, inline editing, panel
minimizing, light/dark themes. To re-record it after UI changes:

```
npm run demo
```

## Verification commands

```
npm run build        # type-check + production build
npm run check:parse  # parser self-check against the 104 real item names
```

## Backups

Supabase free tier does not auto-backup. Weekly: **Ledger → Export (Excel)** and keep the
file (that IS your backup, and it opens in Excel). Optionally `supabase db dump` if you
ever install the CLI (needs the DB password from project creation).

Note: the app runs locally but the database is online — no internet, no app.
