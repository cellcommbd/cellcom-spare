# CELLCOM SPARE ERP — SESSION HANDOFF (Updated 2026-10-21)

## Stack
- Next.js 16 (App Router, 'use client' components, no server actions)
- Supabase (Postgres + PostgREST + RPC functions)
- Vercel for deploy (CLI: `vercel --prod` — GitHub auto-deploy connected to `cellcommbd/cellcom-spare` branch `main`, but manual CLI still sometimes needed)
- TypeScript
- Path alias: `@/` maps to project root. Both `@/lib/...` and `../../lib/...` used.
- Mobile-first responsive is a hard requirement.
- User is often on phone — keep queries short, one at a time.
- User's number keys sometimes broken — provide copy-paste-ready SQL, avoid requiring digit typing.
- User's laptop is temporary — sometimes different hardware with the same disk. Vercel CLI auth can expire; run `vercel login` if "Not authorized".

## Project directory structure
cellcomspare/
├── app/
│ ├── brands/page.tsx
│ ├── categories/page.tsx
│ ├── expenses/page.tsx (NEW 2026-10-21 — owner-only expense entry)
│ ├── find-stock/page.tsx (main staff page)
│ ├── imports/skipped/page.tsx
│ ├── items/page.tsx
│ ├── login/page.tsx
│ ├── losses/page.tsx (FIXED 2026-10-21 — RPC item search)
│ ├── parties/
│ │ ├── page.tsx (REBUILT 2026-10-21 — mobile cards, Open/Edit/Delete pads, default filter=Customer)
│ │ └── [id]/page.tsx (NEW 2026-10-20 — per-customer account view)
│ ├── payments/page.tsx (REBUILT 2026-10-20 — outstanding bills, receipt after payment)
│ ├── pinset/page.tsx
│ ├── purchase-returns/page.tsx
│ ├── purchases/page.tsx
│ ├── purchases/[id]/edit/page.tsx (never audited)
│ ├── reference/page.tsx
│ ├── reports/
│ │ ├── page.tsx (UPDATED 2026-10-21 — Expenses + Profit cards)
│ │ ├── cost-history/page.tsx
│ │ ├── expenses/page.tsx (NEW 2026-10-21 — grouped by type, owner-only)
│ │ ├── low-stock/page.tsx
│ │ ├── dead-stock/page.tsx (RPC-based)
│ │ ├── profit/page.tsx (NEW 2026-10-21 — P&L, owner-only)
│ │ └── stock-value/page.tsx (RPC-based)
│ ├── returns/page.tsx (FIXED 2026-10-21 — detail_id keying, scoped SKU fetch)
│ ├── sales/page.tsx (UPDATED 2026-10-21 — ?party_id= prefill + item focus)
│ └── statement/page.tsx
├── components/ui/
│ ├── button.tsx
│ ├── combobox.tsx
│ ├── date-grouped-list.tsx (NEW 2026-10-20 — shared date-grouped list renderer)
│ ├── ImportCSVDialog.tsx
│ ├── input-group.tsx
│ ├── input.tsx
│ ├── new-item-dialog.tsx
│ ├── new-party-dialog.tsx
│ ├── smart-combobox.tsx
│ └── textarea.tsx
├── lib/
│ ├── auth.ts (local-only role: localStorage)
│ ├── csv-mapper.ts
│ ├── csv-parser.ts (v28)
│ ├── item-search.ts (soft-fail try/catch)
│ ├── statement-format.ts (shared WhatsApp text builder)
│ ├── supabase.ts
│ └── utils.ts
├── app/globals.css
├── app/layout.tsx
└── app/page.tsx (REBUILT 2026-10-21 — customer search, today stats, top debtors)

text

## Database schema (public)

### Core
- **items** — `item_id` serial PK, `sku` varchar UNIQUE, `brand_id`/`model_id`/`part_id`/`category_id` int FK (NULLABLE), `is_phone_part` bool DEFAULT true, `quality` text (Normal|OG|100 OG|Care OG|China OG), `variant`/`color` text, `cost_price` numeric DEFAULT 0, `selling_price` numeric DEFAULT 0, `current_stock` int DEFAULT 0, `is_active` bool DEFAULT true, `reorder_point` int DEFAULT 0
- **brands** — `brand_id`, `brand_name`, `brand_code`, `purchase_prefix`
- **brand_aliases** — `id`, `csv_code`, `brand_code`
- **part_types** — `part_id`, `part_code` UNIQUE (constraint `^[A-Z0-9]+$`), `part_name`
- **part_type_aliases** — `id`, `csv_text` UNIQUE, `part_code`
- **categories** — `category_id`, `category_code` UNIQUE, `category_name` (TOOL|CLEANING|CONSUMABLE|ACCESSORY|SPRAY|OTHER)
- **parser_color_aliases** — `csv_text` UNIQUE, `color_value`
- **models** — `model_id`, `brand_id`, `model_name`, `network` (4G/5G/null)

### Transactions
- **purchases** — `purchase_id`, `party_id` int, `invoice_no` varchar(50), `purchase_date` date NOT NULL, `total_amount` numeric, `freight_charges` numeric DEFAULT 0, `cash_paid` numeric DEFAULT 0, `credit_applied` numeric DEFAULT 0, `created_at` timestamptz
- **purchase_items** — `detail_id` serial PK, `purchase_id` int FK, `item_id` int FK, `quantity` int, `rate` numeric (LANDED, includes freight), `invoice_rate` numeric NULLABLE (RAW, backfilled = rate for old purchases), `amount` numeric
- **sales** — `sale_id`, `party_id`, `bill_date` date, `entry_date` timestamptz, `total_amount` numeric, `status` varchar (Pending|Partially Paid|Paid), **`paid_amount` numeric DEFAULT 0** (ADDED 2026-10-20)
- **sale_items** — `detail_id`, `sale_id`, `item_id`, `quantity`, `rate`, `amount`, `cost_at_sale` (set at sale time), `returned_qty` int (incremented by returns, line is NEVER deleted)
- **payments** — `payment_id`, `party_id`, `payment_date` date, `amount` numeric, `payment_mode` varchar, `created_at`
- **parties** — `party_id`, `party_name` varchar, `phone` varchar NULLABLE, `party_type` (Customer|Supplier), `current_balance` numeric, `purchase_prefix` text
- **returns** — `return_id`, `party_id`, `item_id`, `return_date`, `quantity`, `rate`, `total_amount`, `is_sellable`, `reason`, `return_type` ('Customer'|'Supplier'), `created_at`
- **losses** — `loss_id`, `item_id`, `loss_date`, `quantity`, `rate` (COST price, not selling), `total_amount` (= qty × cost), `reason`, `notes`, `created_at`
- **expenses** — `expense_id` serial PK, `expense_date` date NOT NULL, `expense_type` text NOT NULL CHECK (expense_type IN ('Rent','Staff','Kitty','Bill','Others')), `amount` numeric NOT NULL CHECK (amount > 0), `note` text NULLABLE, `created_at` timestamptz DEFAULT now(). Index: `idx_expenses_date` on `expense_date DESC`. (ADDED 2026-10-21)
- **skipped_import_rows**, **settings** — standard. `settings` stores `staff_pin`, `owner_pin`, `pin_version`

## RPC functions
- **search_items(p_query text, p_limit int DEFAULT 25)** — searches SKU, brand, model, part, quality, variant, color. Token-based AND. Network-aware ranking: for query with 5g → 5G first, null second, 4G third; with 4g → 4G first, null second, 5G third; no network → all networks. ORDER BY uses conditionally-built `order_prefix` variable (fixed 2026-10-19 — bare `0` was being treated as column position).
- **purchase_line_counts(p_ids int[])**
- **stock_value_by_brand()**
- **top_items_by_brand(p_brand_id int, p_limit int DEFAULT 10)**
- **dead_stock_summary()**
- **dead_stock_items(p_never_only bool, p_min_stock int, p_search text, p_limit int)**
- **save_purchase_full(...)** — atomic purchase save, creates brands/models/parts/items as needed
- **delete_purchase(p_id int)**
- **update_purchase(...)** — exists but NOT updated for `invoice_rate`

## Triggers (automatic — do NOT manually adjust stock in app code)
- `trg_sale_items_insert` → decrements `items.current_stock`
- `trg_sale_items_delete` → increments `items.current_stock`
- `trg_purchase_items_insert` → increments stock + weighted avg cost
- `trg_purchase_items_delete` → decrements stock
- `trg_update_cost_price` → recomputes weighted avg cost
- `trg_returns_insert` → increments `items.current_stock` by return qty
- `trg_returns_delete` → decrements stock
- `trg_losses_insert` → decrements stock
- `trg_losses_delete` → increments stock

**Critical:** app code must NEVER touch `items.current_stock` directly — triggers own it. Doing so causes double-increment. Verified 2026-10-21 via full test cycle.

## CRITICAL: Returns / Losses / Profit model (verified 2026-10-21 via end-to-end test)

### Returns model
- Returns do NOT delete the sale line
- Returns **increment `sale_items.returned_qty`** on the line
- Returns do NOT change `quantity`, `amount`, or `cost_at_sale`
- Returns **reduce `parties.current_balance`** (khata goes down)
- Returns **increment `items.current_stock`** via trigger
- Returns insert into `returns` table with `return_type = 'Customer'`

### Losses model
- Losses insert into `losses` table
- `losses.rate` = **cost price** (not selling price)
- `losses.total_amount` = quantity × cost
- Losses **decrement `items.current_stock`** via trigger

### Profit formula (PROVEN against real DB behavior)
Sales = Σ((quantity − returned_qty) × rate) [net of returns]
COGS = Σ((quantity − returned_qty) × cost_at_sale) [net of returns]
Gross = Sales − COGS
Losses = Σ(losses.total_amount) [cost-valued]
Expenses = Σ(expenses.amount) in range
Net = Gross − Losses − Expenses

text

**Do NOT subtract returns separately** — they're already reflected via `(quantity − returned_qty)`. **Do NOT use `Σ(amount)`** for sales — that's gross, not net of returns.

## lib/csv-parser.ts (v28)
SKU grammar: `BRAND - MODEL - PART - [YEAR] - [VARIANT] - [NETWORK] - [FLAG] - [COLOR] - [QUALITY]`

Key features:
- `normalizeTypos` — SAMRT→SMART, BORD→BOARD, CONVETOR→CONVERTER, SILVAR→SILVER
- `extractPartFromDescription(desc, aliases)` — DB aliases + hardcoded, longest-first
- Multi-word brand matching, model extraction
- `normalizeModelName` — strips trailing part codes, quality markers, size markers
- Spacing rules 1-3: `CE 2 → CE2`, `10 R → 10R`, `11 X → 11X`
- **v26 fix (PRO+ → PRO PLUS):** `([A-Z])\+` → `$1 PLUS` after digit-plus rule; removed trailing `+` strip in normalizeModelName
- **v28 fix:** part-strip runs BEFORE spacing rules (prevents 10 CG → 10CG fusion)

## lib/statement-format.ts (shared)
Functions:
- `buildStatementText(data: StatementData): string` — WhatsApp-ready text. Uses `*bold*`, `_italic_`, `━━━` dividers, `Rs.` not `₹`. No emoji.
- `normalizePhoneForWhatsApp(raw): string | null`
- `buildWhatsAppUrl(phone, message): string | null`

`StatementData`: `{ shopName?, customerName, fromDate, toDate, items[], purchasesTotal, previousBalance, cashPaid, upiPaid, netDue }`

**Shared by:** `/statement`, `/parties/[id]`, `/payments`. Any change affects all three — defer helper changes unless needed in all.

## components/ui/date-grouped-list.tsx (NEW 2026-10-20)
Generic list renderer that inserts date header bands with day totals between consecutive same-date rows.
Props: `rows, getDate, getAmount, getKey, renderRow, emptyState, dayTotalLabel, amountPrefix, hideRowCount`.
Not sticky — flat slate bands. Making it `sticky top-0` requires removing `overflow-hidden` from parent card, which loses rounded corners. Flat is correct for short lists.
**Used by:** `/sales` report, `/payments` outstanding bills, `/parties/[id]` Purchases/Payments/Ledger tabs.

## Session 2026-10-19 additions
- Parser v28: part-strip BEFORE spacing rules (prevents 10 CG → 10CG fusion)
- Search network-aware ranking (5g/4g priority)
- search_items RPC ORDER BY bug fixed — bare `0` was treated as column position, replaced with `order_prefix` variable
- Data cleanup: all Nord duplicates merged (7 pairs); MI 11X, RM 14PRO, SAM S21FE, TEC KE5, VV V50E merged; 0 normalized duplicates; GEN-TOOL-OG removed; 0 orphaned FKs

## Session 2026-10-20 additions
- **`sales.paid_amount`** column added, backfilled (Paid→total, Pending→0, Partially Paid reconciled manually: sale 56 Anas ₹3,000 of ₹4,300; sale 83 Counter Sale was actually paid). Anas (party 9) current_balance fixed to ₹1,300 (was ₹1,500, ₹200 drift).
- **Counter Sale:** always walk-in, cash-and-carry in the physical shop, BUT can also be "known person, pays later." No special code path — treats like any customer.
- **`applyFIFO` in `/payments`** rewritten — reads `paid_amount` per bill, writes back `paid_amount` + derived `status`. Oldest-first allocation preserved.
- **`/payments` rebuilt:**
  - Outstanding bills list (all bills with `paid_amount < total_amount`, oldest first, days-old coloring)
  - Last-payment banner (amount + date + N days ago)
  - "All clear" green card when nothing outstanding
  - Statement card + Copy + WhatsApp available **without saving first**
  - **Receipt after payment** — statement switches to receipt shape after save (paid X, due Y, itemizes just-touched bills)
  - `?party_id=` prefill via `useSearchParams` (requires `<Suspense>` wrapper — `PaymentsPageInner()` + default export `PaymentsPage()` with Suspense)
- **`/parties` rebuilt:** mobile cards, no whole-row click, three explicit 44px pads per row (Open ›/Edit/Delete), search, balance-sorted, Opening Balance removed from add form, Enter-to-save, cursor returns to Name after save. Default filter = Customer (2026-10-21).
- **`/parties/[id]` (NEW):** per-customer account view. Balance chip, Copy + WhatsApp, date range with quick buttons, 4 tabs (Summary/Purchases/Payments/Ledger). Ledger opening balance = `current_balance − Σ(sales ≥ fromDate) + Σ(payments ≥ fromDate)` — correct for any range, not just "today."
- **`/sales` `?party_id=` prefill:** reads `searchParams`, preselects shop, focuses item field. **Critical:** `loadData`'s Counter Sale default must be guarded with `&& !prefillPartyId` — otherwise `loadData` overwrites URL selection (race). Focus requires explicit `document.querySelectorAll('input[data-row-item="row-1"]')` + `offsetParent !== null` + 50/150/300ms retries (mobile + desktop DOM duplication).

## Session 2026-10-21 additions

### `/expenses` (NEW)
- Owner-only entry form. Date, Type (5-option dropdown), Amount, optional Note.
- Enter saves. After save: keeps date + type, clears amount + note, refocuses amount.
- This-month list below with per-row delete. Month summary card at top showing total + per-type breakdown.

### `/reports/expenses` (NEW)
- Owner-only. Grouped by expense_type, from/to defaulting to month-start → today.
- Quick buttons: Today / This Month / Last Month.
- Grand total card (rose gradient). Each type row: count, total, percentage bar, expandable to show individual entries.
- Zero-count types still shown (dimmed).

### `/reports/profit` (NEW)
- Owner-only. From/to defaulting to month-start → today.
- Uses the PROVEN formula above.
- Net Profit hero card (green if profit, rose if loss). Shows margin % + bill count.
- Two warning cards:
  - "No expenses recorded" — if expenses table empty for range
  - "N lines have no cost" — if `cost_at_sale = 0` on sale lines
- P&L breakdown: Sales (net of returns) → COGS → Gross Profit (with margin) → Losses → Operating Expenses (with per-type breakdown) → Net Profit.

### `/reports` (UPDATED)
- Two new cards: Expenses by Type (amber, Wallet icon), Profit Report (indigo, BarChart3 icon — was TrendingDown, changed because downward arrow implies "profit falling").
- Removed old "Monthly P&L" card pointing to non-existent `/reports/monthly-pnl`. New `/reports/profit` replaces it.

### `/` home (REBUILT)
- **Customer search** at top — type 2+ chars, debounced 250ms, dropdown, tap → `/parties/[id]`. Outside-click closes. Clear button.
- **Today at a glance** — Sales / Cash In / Pending Khata (3 numbers), plus **Purchases** for owner only (4th number). Gradient indigo card.
- **Quick Actions** — 6 tiles: Sales, Payments, Find Stock, Purchases, Returns, Reports.
- **Recent Sales** — last 5 bills, tappable → party account.
- **Top Debtors** — top 10 positive-balance customers, sorted by biggest owed, each with `Open ›` → party account.
- **Removed:** date range bar, 4 big stat cards (Sales/Payments/Purchases/Gross Profit), 4 mini stats (Khata/Payable/Losses/Low Stock), Top Shops list, Recent Purchases list. **No profit anywhere on home** — lives in `/reports/profit`.

### `/returns` (FIXED — real bugs)
- **Bug 1:** Was loading ALL items via `supabase.from('items').select(...)` with no filter → hit PostgREST 1000-row cap → SKU showed `'—'` for items beyond row 1000 (like SAM-TEST1-BP at item_id 2723).
- **Bug 2:** `checkedItemIds` and `rows` were keyed on `item_id` instead of `detail_id` → two lines of same SKU shared a checkbox, unchecking one removed both.
- **Fix:** removed full items load; `loadSaleItems` now fetches SKUs scoped to the bill's `item_id`s via `.in('item_id', itemIds)`. All state keyed on `detail_id` (`checkedDetailIds`).
- Save logic unchanged — insert returns, increment `returned_qty`, reduce khata.

### `/losses` (FIXED — same class of bug)
- Was loading ALL items with no limit → same 1000-row truncation → SKU search couldn't find items beyond row 1000.
- **Fix:** item search now uses `searchItemsShared` (RPC) via SmartCombobox `onSearch`. `todayItems` fetched scoped to today's loss rows via `.in('item_id', itemIds)`. `handleItemSelect` fetches `cost_price` reliably for auto-filling rate.
- Removed `overflow-x-auto` from table wrapper — it was clipping the combobox dropdown and creating a horizontal scrollbar. **Rule: never put `overflow-*` on a wrapper containing SmartCombobox.**

### End-to-end test cycle (2026-10-21)
Ran a full test cycle to prove the returns/losses/profit model:
1. Purchased 10 × SAM-TEST1-BP @ 100 → stock 10, cost 100 ✅
2. Sold 4 @ 150 to Anas → stock 6, Anas +600 ✅
3. Returned 1 @ 150 → stock 7, Anas −150, `returned_qty` = 1 ✅
4. Lost 2 (broken) @ cost 100 → stock 5, losses 200 ✅
5. Cleaned up all test data, Anas reset to 1300, item deleted, purchase deleted ✅

**Lessons from cleanup:**
- Delete test rows by `item_id` + date range, NOT by note text (notes may not match)
- Delete triggers fire and restore stock — verify stock after each delete, adjust at the end if needed
- Test item itself + its purchase must be deleted too if the item was phantom

### `expenses` table (CREATED 2026-10-21)
```sql
CREATE TABLE expenses (
  expense_id serial PRIMARY KEY,
  expense_date date NOT NULL,
  expense_type text NOT NULL
    CHECK (expense_type IN ('Rent','Staff','Kitty','Bill','Others')),
  amount numeric NOT NULL CHECK (amount > 0),
  note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_expenses_date ON expenses (expense_date DESC);
Note: table was initially created with different columns (category, description, no CHECK constraint, no index), then dropped and recreated cleanly. No migration file exists in the repo — schema is only in Supabase. Worth adding db/2026-10-21_expenses.sql for documentation.

Standing rules for AI assistant
Never guess at code you haven't seen. Ask for the file.

Never delete or rename items without checking purchase_items, sale_items, returns, losses for references first.

Full files, one per message. No fragments. No ... placeholders. Split into 2-3 parts only if file exceeds ~800 lines, and clearly label "Part 1 of 2" / "Part 2 of 2".

Mobile-first for every UI change.

Ask for SQL output / raw data before proposing fixes.

Same 6-column CSV header for purchases and returns: Description of Goods,Type of Goods,Quality,Quantity,Price,Unit

One CSV per source invoice.

User is often on phone — keep queries short, one at a time.

When user says "give me csv" — they mean the full CSV content to paste into import dialog, not SQL.

Stock/cost changes are handled by DB triggers — do NOT add app-level stock updates.

Real production data — no destructive SQL without first showing SELECT COUNT(*) with the same WHERE and getting explicit confirmation.

User's number keys sometimes broken — provide copy-paste-ready SQL, avoid requiring digit typing.

PostgREST caps responses at 1000 rows by default. Any query fetching full items table must use RPC aggregation OR scoped .in('item_id', ids) filtering, NOT client-side array search. This bit twice on /returns and /losses — always scope item fetches.

Verify writes: after a save, refetch and confirm the value persisted. Never say "saved" unless it landed.

Party creation modal flow: staff types new name → SmartCombobox reports isNew = true → parent opens NewPartyDialog → on OK, insert with title case, duplicate check, verify, append to list.

NEVER put overflow-* on a wrapper containing a SmartCombobox — clips the dropdown.

Prefill from URL requires disabling competing defaults — any loadData/useEffect setting a "default selection" must check the query param and bail (&& !prefillPartyId).

Compute due from total_amount − paid_amount, never trust current_balance alone. current_balance can drift (Anas had ₹200 drift). Bills are truth for per-bill dues.

Profit formula uses (quantity − returned_qty) — never amount directly.

Test data cleanup: delete by item_id + date range, not by note text. Verify stock/khata after. Delete triggers fire.

Known open items (parked)
Auto-deploy: Vercel connected but pushes don't always trigger. Manual vercel --prod if needed.

Junk models cleanup — trailing quotes, quality words in names, part codes stuck in models.

Unique constraints on models(brand_id, model_name, network) and part_types(part_code) — need dup check first.

Historical invoice_rate — old purchases have invoice_rate = rate (backfilled). New purchases correct.

UTC date default bug — toISOString().slice(0,10) shows previous day 00:00-05:30 IST. User doesn't care — parked.

app/purchases/[id]/edit/page.tsx — never audited.

update_purchase RPC — not updated for invoice_rate.

Post-dialog autofocus — tries selector input[data-row-item="row-1"] but sales page has mobile + desktop copies; focus lands on hidden one. Non-blocking (the 2026-10-20 prefill fix added retries + offsetParent !== null, so mostly resolved).

Form B SKU migration — dash-everything SKU (e.g. RM-NOTE-12-PRO-BP-5G-BLACK). Deferred 2026-10-19. Scope: rewrite normalizeModelName (~40 lines), bulk items.sku UPDATE, optional models.model_name UPDATE. No other file changes needed. Before committing: run collision-check SQL (normalize model_name, group, count dups >1). If near zero, defer indefinitely. Form B is layer 1 of 3; still needs alias tables + Levenshtein warning.

Coming-soon reports — supplier-prices, fast-moving, profit-per-item, khata-aging, recent-activity (all still marked comingSoon in /reports). Verify page file exists before removing comingSoon: true.

/parties/[id] per-bill paid/due display — Purchases tab shows status pill only, not "₹3,000 paid / ₹1,300 due." /payments shows this clearly, so info isn't missing from the app. Parked: not urgent.

Statement post-payment receipt shape — /payments switches to receipt after save. But statement detail could be richer. Parked.

Migration file for expenses — schema exists in Supabase only, not in repo. Worth db/2026-10-21_expenses.sql for documentation.

Working state at end of 2026-10-21
Anas (party 9): current_balance = 1300 (one partial bill: sale 56, ₹4,300 total, ₹3,000 paid, ₹1,300 due)

Counter Sale (party 3): balance ₹0, all historical sales marked Paid

All other customers: ₹0

Test item SAM-TEST1-BP: deleted (item, purchase 41, purchase line 3117 all gone)

expenses table: 1 real entry (₹6,000 Staff)

sale_items.cost_at_sale: 917 lines, 0 with zero cost — COGS is accurate

Profit report: works, verified against real data

Useful shortcuts
Item count: SELECT COUNT(*) FROM items;

Recent purchases: SELECT purchase_id, invoice_no, total_amount FROM purchases ORDER BY purchase_id DESC LIMIT 10;

Recent sales: SELECT sale_id, bill_date, total_amount FROM sales ORDER BY sale_id DESC LIMIT 10;

Zero-cost sale lines: SELECT COUNT(*) FROM sale_items WHERE cost_at_sale = 0 OR cost_at_sale IS NULL;

Expense totals by type this month: SELECT expense_type, COUNT(*), SUM(amount) FROM expenses WHERE expense_date >= date_trunc('month', CURRENT_DATE) GROUP BY expense_type;

Recent commit history (approximate)
2026-10-19: parser v28, network-aware search ranking, search_items ORDER BY fix, data cleanup

2026-10-20: sales.paid_amount migration, /payments rebuild (outstanding bills + receipt), /parties rebuild, /parties/[id] new, /sales prefill

2026-10-21: /expenses new, /reports/expenses new, /reports/profit new, /reports updated, home rebuilt, /returns + /losses fixed, /parties default filte