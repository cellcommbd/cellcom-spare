# CELLCOM SPARE ERP — FULL SESSION HANDOFF (2026-10-25, end-of-day)

## Stack
- Next.js 16 (App Router, 'use client', no server actions)
- Supabase (Postgres + PostgREST + RPC functions)
- Vercel (`vercel --prod`; GitHub auto-deploy flaky, manual CLI sometimes needed)
- TypeScript
- Path alias `@/` → project root. Both `@/lib/...` and `../../lib/...` used.
- Mobile-first is a hard requirement.
- User is often on phone — short queries, one at a time.
- User's number keys sometimes broken — copy-paste-ready SQL only, avoid digit typing.

## Project directory structure
cellcomspare/
├── app/
│ ├── brands/page.tsx
│ ├── categories/page.tsx
│ ├── expenses/page.tsx (owner-only entry form)
│ ├── find-stock/page.tsx (main staff page)
│ ├── imports/skipped/page.tsx
│ ├── items/page.tsx
│ ├── login/page.tsx
│ ├── losses/page.tsx (RPC item search, no overflow on wrapper)
│ ├── parties/
│ │ ├── page.tsx (mobile cards, 3 pads per row, default filter Customer)
│ │ └── [id]/page.tsx (4 tabs, Balance Breakdown)
│ ├── payments/page.tsx (Suspense wrapper, outstanding + receipt)
│ ├── pinset/page.tsx
│ ├── purchase-returns/page.tsx
│ ├── purchases/
│ │ ├── page.tsx
│ │ └── [id]/edit/page.tsx (fixed 2026-10-24)
│ ├── reference/page.tsx
│ ├── reports/
│ │ ├── page.tsx (12 cards, all live, no comingSoon)
│ │ ├── cost-history/page.tsx
│ │ ├── dead-stock/page.tsx
│ │ ├── expenses/page.tsx
│ │ ├── fast-moving/page.tsx
│ │ ├── khata-aging/page.tsx (opened to staff 2026-10-25)
│ │ ├── low-stock/page.tsx
│ │ ├── profit/page.tsx
│ │ ├── profit-per-item/page.tsx
│ │ ├── recent-activity/page.tsx
│ │ ├── sales-explorer/page.tsx (NEW 2026-10-25)
│ │ ├── stock-value/page.tsx
│ │ └── supplier-prices/page.tsx
│ ├── returns/page.tsx
│ ├── sales/page.tsx (edit modal 2026-10-23)
│ └── statement/page.tsx
├── components/ui/
│ ├── button.tsx
│ ├── combobox.tsx
│ ├── date-grouped-list.tsx
│ ├── ImportCSVDialog.tsx (rewritten 2026-10-25 — scoped SKU lookup)
│ ├── input-group.tsx
│ ├── input.tsx
│ ├── new-item-dialog.tsx
│ ├── new-party-dialog.tsx
│ ├── smart-combobox.tsx
│ └── textarea.tsx
├── lib/
│ ├── auth.ts
│ ├── csv-mapper.ts
│ ├── csv-parser.ts (v34)
│ ├── general-item-parser.ts
│ ├── item-search.ts (searchItems RPC wrapper)
│ ├── statement-format.ts
│ ├── supabase.ts
│ └── utils.ts
├── app/globals.css
├── app/layout.tsx
└── app/page.tsx (home)

text

## DB schema (public)

### Core
- **items** — `item_id` serial PK, `sku` varchar UNIQUE, `brand_id`/`model_id`/`part_id`/`category_id` int FK (NULLABLE), `is_phone_part` bool DEFAULT true, `quality` text (Normal|OG|100 OG|Care OG|China OG), `variant`/`color` text, `cost_price` numeric DEFAULT 0, `selling_price` numeric DEFAULT 0, `current_stock` int DEFAULT 0, `is_active` bool DEFAULT true, `reorder_point` int DEFAULT 0
- **brands** — `brand_id`, `brand_code`, `brand_name`, `purchase_prefix`
- **brand_aliases** — `id`, `csv_code` UNIQUE, `brand_code`
- **part_types** — `part_id`, `part_code` UNIQUE (constraint `^[A-Z0-9]+$`), `part_name`
- **part_type_aliases** — `id`, `csv_text` UNIQUE, `part_code`
- **categories** — `category_id`, `category_code` UNIQUE, `category_name` (TOOL|CLEANING|CONSUMABLE|ACCESSORY|SPRAY|OTHER)
- **parser_color_aliases** — `csv_text` UNIQUE, `color_value`
- **models** — `model_id`, `brand_id`, `model_name`, `network` (4G/5G/null)

### Transactions
- **purchases** — `purchase_id`, `party_id` int, `invoice_no` varchar(50), `purchase_date` date NOT NULL, `total_amount` numeric, `freight_charges` numeric DEFAULT 0, `cash_paid` numeric DEFAULT 0, `credit_applied` numeric DEFAULT 0, `created_at` timestamptz
- **purchase_items** — `detail_id` serial PK, `purchase_id` int FK, `item_id` int FK, `quantity` int, `rate` numeric (LANDED, includes freight), `invoice_rate` numeric NULLABLE (RAW, backfilled = rate for old purchases), `amount` numeric
- **sales** — `sale_id`, `party_id`, `bill_date` date, `entry_date` timestamptz, `total_amount` numeric, `status` varchar (Pending|Partially Paid|Paid), **`paid_amount` numeric DEFAULT 0** (added 2026-10-20)
- **sale_items** — `detail_id`, `sale_id`, `item_id`, `quantity`, `rate`, `amount`, `cost_at_sale` (set at sale time), `returned_qty` int (incremented by returns, line is NEVER deleted)
- **payments** — `payment_id`, `party_id`, `payment_date` date, `amount` numeric, `payment_mode` varchar, `created_at`
- **parties** — `party_id`, `party_name` varchar, `phone` varchar NULLABLE, `party_type` (Customer|Supplier), `current_balance` numeric, `purchase_prefix` text
- **returns** — `return_id`, `party_id`, `item_id`, `return_date`, `quantity`, `rate`, `total_amount`, `is_sellable`, `reason`, `return_type` ('Customer'|'Supplier'), `created_at`
- **losses** — `loss_id`, `item_id`, `loss_date`, `quantity`, `rate` (COST price, not selling), `total_amount` (= qty × cost), `reason`, `notes`, `created_at`
- **expenses** — `expense_id` serial PK, `expense_date` date NOT NULL, `expense_type` text NOT NULL CHECK (expense_type IN ('Rent','Staff','Kitty','Bill','Others')), `amount` numeric NOT NULL CHECK (amount > 0), `note` text NULLABLE, `created_at` timestamptz DEFAULT now(). Index: `idx_expenses_date` on `expense_date DESC`. (Added 2026-10-21)
- **skipped_import_rows**, **settings** — standard. `settings` stores `staff_pin`, `owner_pin`, `pin_version`

### Brand landscape (verified 2026-10-25)
1,SAM,Samsung
2,OP,Oppo
3,VV,Vivo
4,RM,Realme
5,IP,Apple
6,MI,Xiaomi (includes Redmi, Poco)
7,INF,Infinix
8,TEC,Techno
9,MT,Moto
10,HUA,Huawei
11,ONE,One+
13,NOTH,Nothing
16,JIO,Jio
18,GEN,Generic
20,NK,Nokia
21,ITL,Itel
22,GEN4,Generic 4 Pin
23,GEN5,Generic 5 Pin
26,TOOL,TOOL

text

**Clarifications:**
- `MI` = Xiaomi + Redmi + Poco (all under Xiaomi umbrella)
- `RM` = Realme (only, not Redmi)
- No `RE` brand — `RE` is an alias for `RM`
- No `POCO` brand — Poco items live as `MI-POCO-*` (POCO in model position)
- `OP RE` in vendor CSVs = Realme, kept as `OP-RE-*` prefix by convention (313 existing items, not migrating)
- `VV` = Vivo, `OP` = Oppo

### RPC functions
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

## Payment allocation
- `applyFIFO` in `/payments` applies payments to bills **oldest-first**
- Reads `paid_amount` per bill, writes back `paid_amount` + derived `status`
- **Decision 2026-10-22:** keep oldest-first. Oldest debt gets cleared first, prevents "old ₹500 sits forever" problem. If customer asks "which bill does my balance come from?", answer via **Balance Breakdown** on `/parties/[id]` Summary tab.
- **Counter Sale** behaves like any customer — sale inserts `Pending`, `paid_amount = 0`, balance increments, payment clears. No special code path.

## lib/csv-parser.ts — v34 (CURRENT)

### Signature
- `parseCSV(text: string, aliases: AliasMaps, items: ItemLookup[] = []): ParsedRow[]`
- `items` optional (default `[]`) — dialog does scoped SKU lookup after parse
- Exports: `parseCSV`, `generateSku`, `flagDuplicates`, `groupParsedRows`, `resetBrandCodeWarnings`, `findColumnIndex`, `splitCSVLines`, types `Quality`, `ParsedRow`, `AliasMaps`, `ItemLookup`

### SKU grammar
BRAND - MODEL - PART - [YEAR] - [VARIANT] - [NETWORK] - [FLAG] - [COLOR] - [QUALITY]

text

### v34 fixes applied (2026-10-25)
1. **`1+NORD` bug** — `normalizeTypos` splits `1+` from following letter, skips `1+` in PLUS conversion. `1+NORD` → `1+ NORD` → brand `ONE`.
   ```ts
   .replace(/\b1\s*\+\s*(?=[A-Z])/gi, '1+ ')
   .replace(/(\d)\+/g, (m, d) => (d === '1' ? m : d + ' PLUS'))
Brand-consume bug — scanDescription's brand loop doesn't consume brand token when brandCode is already set. So OP RE RINGER → OP brand, RE stays in model → OP-RE-RB.

ts
if (!brandCode) { brandCode = ...; consume(...); }
// else: skip, don't consume
Curly-brace quality — parseCSV extracts quality from {...} blocks explicitly before [...] strip. {CARE}, {OG}, {100% OG}, {CHINA OG} all picked up.

Square-bracket quality regex extended — includes CARE, 100% OG, CHINA OG so [...] quality isn't dropped.

Glued-brand split — normalizeTypos rule:

ts
.replace(/\b(SAM|MI|IP|VV|OP|RM|NK|TEC|INF|HUA|ITL|JIO|MT|NOTH|ONE)([A-Z])(\d)/g, '$1 $2$3')
SAMA23 → SAM A23, VVY20 → VV Y20, MIA1 → MI A1

IPHONE (no digit after H) → no match ✅

SAMSUNG (letter after SAM) → no match ✅

OPPO (letter after OP) → no match ✅

Architecture: scanDescription (single-pass dictionary scanner)
Walks left-to-right, tries at each position in priority order:

Part phrase (longest first, from aliases.partAliases + PART_TYPE_PHRASES)
Quality (100% OG, 100%, CHINA OG, CARE, OG, C+)
Network (4G / 5G)
Year (19xx / 20xx)
Size markers (20MM, 4PIN, BIG, SMALL, MEDIUM, 3 PIN, 4 PIN)
Flag (WL, WC, WCL, FLEX, SET, COPY, METAL)
Color (from COLOR_WORDS + aliases)
Variant (MAIN, OCTA, BOX PACKING, NEW, DAMD, DISPLAY, FOR, MAINBOARD)
Brand phrase (longest first, from aliases.brandAliases)
Advance 1 char
Word-boundary enforced in tryMatchAt — BK never matches inside BLACK, MF never inside MIDFRAME

Longest phrase wins — MIDDLE FRAME WITH FLEX before MIDDLE FRAME before MF

Matches consumed — never re-scanned

Leftover unconsumed tokens = model text, then normalizeModelName

normalizePartCode rejects strings >10 chars (prevents BACKPANELOGBLACK mangles)

extendColor absorbs one adjacent alpha token for multi-word colors (BUBBLEGUM BLUE, BLACK VELVET, SUNSET GOLD, DUSK PINK, NATURAL TITANIUM)

Fusion rule (in normalizeModelName)
1–2 letter tokens + digit fuse: CE 3 → CE3, 9 A → 9A, 11 X → 11X, 15 T → 15T

Longer tokens keep dashes: NOTE 12 → NOTE-12, 11 PRO → 11-PRO

Why fusion exists: prevents 20 MM → 20-MM (wire length should stay 20MM), CE 3 → CE-3 (real model is CE3), and prevents duplicate SKUs when vendor writes both CE3 and CE 3 for the same part

Do NOT remove fusion — would break existing catalog SKUs and requires mass migration

normalizeTypos current rules
1+NORD → 1+ NORD split (before PLUS rule)

1+ NOT converted to 1 PLUS (only 2+–99+ converted)

OPPO - REALME / OPPO-REALME → REALME

Glued brand split: SAMA23 → SAM A23, etc.

Typos: SAMRT→SMART, BORD→BOARD, CONVETOR/CONNVETOR→CONVERTER, COVERT→CONVERT, SILVAR→SILVER, VOLLUME→VOLUME, EXXBEE/EXX BEE/EXX-BEE→EXX-BEE, PANLE/PANAL/PANNEL/PAANEL→PANEL, HOUSIG→HOUSING, BOX PECKING→BOX PACKING, C/C→CC, OUT SIM TRY→OUT SIM TRAY, SIM TRY→SIM TRAY, B/C CONN→B/C CONN

Strips * ' " backtick to spaces; collapses ### to space; collapses whitespace

Known remaining parser quirks (accepted, not bugs)
OP RE → OP-RE-* (compromise, not RM-*) — matches 313 existing items, decision 2026-10-24

part_type_aliases has 2 PIN/3 PIN/4 PIN → ONOFFSWITCH — intentional. All pins = on-off switch specs. Do NOT delete.

Vendor junk like OPPO - VIVO 4 PIN ON OFF SWITCH [ SMALL EXX - BEE] → OP-VIVO-ONOFFSWITCH-SMALL — secondary part dropped, ambiguity not resolvable from description

{BARCODE} — not a flag, falls into model or discarded. Confirmed junk (2026-10-25).

New vendor typos will surface — add to normalizeTypos as they appear

Not applied (parked)
Reading Quality column from CSV directly (currently inferred from {...} and [...] in description — works for current CSVs)

Form B SKU migration (dash-everything) — deferred since 2026-10-19

Parser test results (2026-10-25)
Input	Output
NK 5200 RINGER {CARE}	NK-5200-RB-CARE ✅
SM A50 RINGER {OG}	SAM-A50-RB-OG ✅
OP RE RINGER {100% OG}	OP-RE-RB-100OG ✅
1+NORD CE 3 LITE LCD FLEX	ONE-NORD-CE3-LITE-LCD ✅
SAMA23 5G OUT SIM TRAY	SAM-A23-ST-5G ✅ (was GEN-SAMA23-ST-5G)
IPHONE - 14+ SPEAKER [100% OG]	IP-14-PLUS-SPK-100OG ✅
OPPO - REALME 5 OUT SIM TRAY	RM-5-ST ✅
lib/statement-format.ts (shared)
buildStatementText(data: StatementData): string — WhatsApp-ready. *bold*, _italic_, ━━━ dividers, Rs. not ₹. No emoji.

normalizePhoneForWhatsApp(raw): string | null

buildWhatsAppUrl(phone, message): string | null

StatementData: { shopName?, customerName, fromDate, toDate, items[], purchasesTotal, previousBalance, cashPaid, upiPaid, netDue }

Shared by: /statement, /parties/[id], /payments. Any change affects all three.

lib/item-search.ts
searchItems(query): Promise<SearchItemResult[]> — thin wrapper around search_items RPC

Soft-fail on error (returns [])

Minimum query length 2

Imported as searchItemsShared in some pages

components/ui/date-grouped-list.tsx
Generic list renderer, inserts date header bands with day totals between consecutive same-date rows

Props: rows, getDate, getAmount, getKey, renderRow, emptyState, dayTotalLabel, amountPrefix, hideRowCount

Not sticky — flat slate bands

Used by: /sales report, /payments outstanding, /parties/[id] Purchases/Payments/Ledger

text

**End of Part 1.** Say "go" for Part 2 (pages, sessions, rules, open items, SQL shortcuts).
---

## components/ui/ImportCSVDialog.tsx — rewritten 2026-10-25

### Key change
- **Removed full-table `items` load.** Old code paginated 1000 rows at a time with `break` on any error, silently truncating at 20000 rows → false NEW for items past the truncation. Caught row 522, 525, 527, 530 as "new" despite existing.
- **Added `lookupItemsBySku(skus: string[]): Promise<ItemLookup[]>`** — scoped `.in('sku', slice)` lookups, chunked at 500 to stay within PostgREST query-string limits. Throws on error instead of returning partial.
- **Added `reclassify(rows: ParsedRow[]): Promise<ParsedRow[]>`** — after parse, fetch real DB state via scoped lookup and flip `matched`/`new` per row.
- **`handleParseAuto` and `handleParseManual` became async** — call `reclassify` before `setParsedRows`.
- **Parser called with empty `items` array** — `parseCSV(csvText, aliases, [])`, `parseGeneralCSV(csvText, [])`, `applyMapping(csvText, mapping, aliases, [])`. Parser marks everything as `'new'`, then reclassify fixes.
- **Errors in lookup throw** — no silent "everything is NEW". User sees error message.
- **`updateRow`** (manual edit) clears `matchedItemId`/`matchedItemSku` and marks `'new'` — reclassify will be triggered by re-parse if user saves with edits.

### Unchanged
- Skip/unskip rows (persists to `/imports/skipped` via `onSkipRows` prop)
- `EditRowPanel` for manual per-row edits (brand, model, part, year, variant, network, flag, color, quality, qty, rate, live SKU preview)
- Manual mapping mode
- Margin input
- All UI/sorting/grouping (errors first, then new, then matched)
- `flagDuplicates` for duplicate SKU detection across parsed rows

### Why this matters
- No more silent false NEW
- Fast (2-3 queries per import instead of 20-page pagination)
- Scales to any catalog size
- Fails loudly on error

---

## Key pages

### `/sales`
- Shop picker (Counter Sale default), item rows via `searchItems` RPC, focus chain, Enter-to-save
- `?party_id=` prefill (guarded `&& !prefillPartyId` — CRITICAL race fix), `?prefill_item_id=` prefill
- **Edit modal** (built 2026-10-23): pencil icon on today's sales rows, editable customer/date/qty/rate/items, balance adjusts by delta, `paid_amount` untouched (guard: block if new total < paid_amount), status recomputed from new total vs paid_amount
- **Today's Sales** section grouped by customer, collapsible, grand total
- **Sales report at bottom** — filters by `bill_date` (not `entry_date`)
- Focus retries at 50/150/300ms with `offsetParent !== null` check (mobile + desktop DOM duplication)

### `/payments`
- Cash/Online toggle, UPI split (2 rows on save), `applyFIFO` (returns touched sale_ids)
- Receipt after save; statement available without save (`outstandingBills.length > 0 || success`)
- **Outstanding grouped by day**: date · item count · day total · day paid · day due · days-old
- Tap day → expands to flat items list
- Last-payment banner (amount + date + N days ago)
- "All clear" green card when nothing outstanding
- `?party_id=` prefill requires `<Suspense>` (`PaymentsPageInner()` + default export wraps in Suspense)
- Shop balances table when no shop picked

### `/parties`
- Mobile cards, no whole-row click
- 3 pads per row (44px): `Open ›` (→ `/parties/[id]`), Edit, Delete (confirm)
- No Opening Balance field (defaults 0)
- Phone `type="tel" inputMode="numeric"`
- Enter saves, cursor returns to Name
- Search client-side, sorted by balance desc
- Default filter = Customer

### `/parties/[id]`
- Balance chip (solid color: rose owed / emerald credit / slate settled)
- Copy + WhatsApp under balance
- **Balance Breakdown** in Summary tab — outstanding days oldest-first, aging badge, expandable items. Answers "why do I owe ₹500?" without changing FIFO.
- Date range with Today/Yesterday/Week/Month quick buttons
- 4 tabs: Summary, Purchases (day-grouped), Payments, Ledger (chronological)
- Ledger opening balance = `current_balance − Σ(sales ≥ fromDate) + Σ(payments ≥ fromDate)`
- Sticky mobile bottom: New Sale, New Payment (links to `/sales?party_id=X`, `/payments?party_id=X`)

### `/purchases/[id]/edit`
- **Fixed 2026-10-24** — detail not captured, verify before relying
- RPC search (`searchItems`), `fallbackLabel` on both SmartComboboxes
- Scoped `.in('item_id', lineItemIds)` load (NOT full table)
- `rowItemCache` + `itemOptionsFor(rowId)` combines selected + search results

### `/losses`
- Item search via `searchItems` RPC
- `todayItems` scoped to today's rows via `.in('item_id', itemIds)`
- NO `overflow-x-auto` on table wrapper (clips combobox dropdown)

### `/returns`
- SKUs scoped to bill's `item_id`s via `.in('item_id', itemIds)`
- All state keyed on `detail_id` (not `item_id`)

### `/expenses` (owner-only)
- Date, Type (Rent|Staff|Kitty|Bill|Others), Amount, Note
- Enter saves; after save keeps date + type, clears amount + note, refocuses amount
- Month summary card (total + per-type breakdown)
- This-month list with per-row delete

### Home `/`
- Customer search (2+ chars, debounced 250ms, dropdown → `/parties/[id]`, outside-click closes, clear button)
- Today at a glance: Sales / Cash In / Pending Khata (+ Purchases for owner)
- 9 Quick Actions (3×3): Sales, Payments, Find Stock, Parties, Returns, Reports, Purchases, Purchase Returns (`PackageX` icon), Expenses
- Recent Sales (5, tappable → party account)
- Top Debtors (10, `Open ›`)
- No profit anywhere on home (lives in `/reports/profit`)

### `/reports` (index)
- 12 cards all live, no `comingSoon` logic
- Owner-only cards hidden via `getRole()`
- Tighter UI: icon in rounded square, hover lift, active scale
- Sales Explorer card between Fast-Moving and Dead Stock (visible to all)

### Reports (12)

| Report | Route | Owner-only | Default range | Notes |
|---|---|---|---|---|
| Cost Change Tracker | `/reports/cost-history` | No | — | Rate history per SKU, dual Inv/Landed cols, CSV export |
| Supplier Price Comparison | `/reports/supplier-prices` | Yes | 90 days | Only SKUs from 2+ suppliers, cheapest highlighted, savings potential |
| Fast-Moving Items | `/reports/fast-moving` | No | This Month | Sort units/revenue, top 50 + show all |
| **Sales Explorer** | `/reports/sales-explorer` | **No** | **30 days** | **NEW 2026-10-25** |
| Dead Stock | `/reports/dead-stock` | No | — | RPC-based, 2 tabs |
| Profit per Item | `/reports/profit-per-item` | Yes | This Month | sort profit/margin/revenue |
| Khata Aging | `/reports/khata-aging` | **No (was Yes)** | — (as of today) | 4 buckets 0-30/31-60/61-90/90+; **opened to staff 2026-10-25** |
| Expenses by Type | `/reports/expenses` | Yes | This Month | Grouped, expandable, % bars |
| Profit Report (P&L) | `/reports/profit` | Yes | This Month | Warnings if no expenses / zero-cost lines |
| Low Stock & Reorder | `/reports/low-stock` | No | — | Threshold, quick-picks, copy list |
| Stock Value | `/reports/stock-value` | Yes | — | RPC brand aggregation |
| Recent Activity | `/reports/recent-activity` | No | This Month | Unified timeline 5 types, filter pills, 200-row cap |

### `/reports/sales-explorer` — new page (2026-10-25)
- **Default view: `line` group mode** — flat table: Date · Party · SKU · Qty · Rate · Amount
- **Group modes:** `line` (default) / `day` / `party` / `item` / `bill`
- **Sort modes:** `date` (default) / `entry` / `qty` / `amount`
- **Filters:**
  - Date range (default last 30 days) + **Bill/Entry toggle** — filter by `bill_date` or `entry_date::date`
  - Party SmartCombobox (load all customers once at mount, client-side filter)
  - Item search via `searchItems` RPC
  - Counter Sale checkbox
- **Summary card** with Lines · Qty · Total · Paid · Due · Bills
- **Copy** button for summary text
- **`Open ›` links** only on `party` group (→ `/parties/[id]`); removed from `bill` group
- **`entry` sort** shows entry time under date in flat view (for backfilling historical sales: "what did I last enter for date X")
- Uses `toLocaleDateString('en-CA')` for default dates — IST-safe
- Data flow:
  1. Fetch `sales` in date window (filtered by party/counter if set)
  2. Fetch `sale_items` scoped `.in('sale_id', ids)`
  3. Fetch `items` scoped `.in('item_id', ids)` for SKUs
  4. Aggregate or flat per group mode

---

## Session 2026-10-25 additions

### Sales Explorer page (new)
- `app/reports/sales-explorer/page.tsx` created
- `app/reports/page.tsx` — added 12th card (Sales Explorer, `Search` icon, `slate` color, not owner-only), placed between Fast-Moving and Dead Stock

### Khata Aging opened to staff
- `app/reports/khata-aging/page.tsx` — removed `if (roleChecked && !isOwner)` gate block, removed `isOwner`/`roleChecked` state, removed `getRole` import, removed `AlertCircle` import, changed `useEffect` to always `loadReport()`
- `app/reports/page.tsx` — removed `ownerOnly: true` from Khata Aging card
- Staff now see card and full page (customer names, phones, dues — already visible via `/parties`)

### Parser v34 fixes
- Curly-brace quality extraction
- `1+NORD` split fix
- Brand-consume fix
- Glued-brand split (`SAMA23` → `SAM A23`)
- All tested against real vendor CSV rows

### ImportCSVDialog rewrite
- Scoped SKU lookup — no more full-table load
- Reclassify pass after parse
- No more false NEW for items beyond 1000-row cap

### Data investigation (2026-10-25)
- **Brand landscape confirmed:**
  - `MI` (id 6) = Xiaomi + Redmi + Poco
  - `RM` (id 4) = Realme only
  - No `RE` brand (alias only)
  - No `POCO` brand (items live as `MI-POCO-*`)
  - `OP RE` = Realme but kept as `OP-RE-*` prefix convention
- **`part_type_aliases` investigation:**
  - Found rows: `2 PIN`/`3 PIN`/`4 PIN`/`2 PIN SMALL`/`2 PIN BIG`/`4 PIN BIG` → `ONOFFSWITCH`
  - Confirmed intentional (all pins = on-off switch specs)
  - Do NOT delete
  - Means synthetic test row `GEN 4 PIN BP` → `GEN-ONOFFSWITCH` (correct per current rules, but not a real vendor pattern)

### Purchase 45 phantom item (2026-10-24, continued)
- Item 2777 `IP-14-SPK-100OG` deleted
- Line re-pointed to item 486 `IP-14-PLUS-SPK-100OG`
- Stock 2→4 on item 486
- Parser fix: `(\d)\+` → `$1 PLUS`

### Test data results (2026-10-25)
Tested 16-row synthetic CSV with years, 2/3/4 PIN, and quality markers. Results:

| Row | Input | Output | Status |
|---|---|---|---|
| 1 | `GEN CHARGING FLEX 2PIN {CARE}` | `GEN-CCFLEX-2PIN-CARE` | ✅ |
| 2 | `GEN CC FLEX 3 PIN {OG}` | `GEN-ONOFFSWITCH-OG` (was `GEN-CCFLEX-OG`) | ⚠️ `3 PIN` → ONOFFSWITCH alias consumed it |
| 3 | `GEN ON OFF SWITCH 4PIN {100% OG}` | `GEN-ONOFFSWITCH-4PIN-100OG` | ✅ |
| 4 | `GEN ON OFF FLEX 4 PIN {100%}` | `GEN-ONOFF-100OG` (was missing `4PIN`) | ⚠️ 4 PIN alias consumed, size lost |
| 5-16 | (various with years) | all produced reasonable SKUs | ✅ |

**Row 2 and 4 confirmed the `X PIN` alias behavior** — intentional, per your confirmation that `2 PIN`/`3 PIN`/`4 PIN` are always ONOFFSWITCH specs.

---

## Session 2026-10-24 additions
- **Purchase 45 (SelfSide SS-13, 2026-10-23)** saved — 9 lines, **₹3,262.50**:
  1. `GEN-SPKJ-OG` 230 @ 3.61 = 830.45
  2. `SAM-A21S-SPK-OG` 25 @ 13.41 = 335.28
  3. `SAM-B310-SPK-OG` 25 @ 8.25 = 206.32
  4. `SAM-J7-PRIME-SPK-OG` 25 @ 8.77 = 219.22
  5. `GEN-RB-20MM-CARE` 10 @ 6.19 = 61.90
  6. `MI-8A-SPK-OG` 30 @ 11.35 = 340.43
  7. `GEN-MIC` 100 @ 1.44 = 144.43
  8. `IP-14-ESPKF` 3 @ 154.74 = 464.23
  9. `IP-14-PLUS-SPK-100OG` 2 @ 330.12 = 660.24
- **Phantom item `IP-14-SPK-100OG` (item 2777)** — `14+` not → `14 PLUS`. Deleted phantom line, re-pointed to item 486 (`IP-14-PLUS-SPK-100OG`), stock 2→4, item 2777 deleted
- **Parser fix:** `(\d)\+` → `$1 PLUS` in `normalizeTypos`
- **Parser tested on SelfSide 242-line CSV:** 226 matched / ~10–15 new (was 183/59 before fixes)
- **Catalog inconsistencies documented** (not migrated): 313 `OP-RE-*` mis-branded, Poco MI/RM split, 7 phantom `-SPEAKER-ESPK`, 5 phantom `-ONLY`, `OP-VIVO-4-PIN-ONOFFSWITCH-SMALL`

## Session 2026-10-23 additions
- `/sales` edit modal built (see `/sales` above)

## Session 2026-10-22 additions
- 5 new reports: fast-moving, supplier-prices, profit-per-item, khata-aging, recent-activity
- `/reports/page.tsx` cleaned — removed `comingSoon` entirely, tighter UI
- Home Quick Actions → 9 tiles (3×3)
- `PackageX` icon for Purchase Returns
- Import path depth bug fixed (report page pasted into `/reports/page.tsx` at wrong depth → "Cannot find module")

## Session 2026-10-21 additions
- `/expenses`, `/reports/expenses`, `/reports/profit` new
- `/returns` + `/losses` fixed (1000-row cap + detail_id keying)
- `/parties` default filter = Customer
- `/parties/[id]` Balance Breakdown added
- End-to-end test cycle proved returns/losses/profit model

## Session 2026-10-20 additions
- `sales.paid_amount` added + backfilled (Paid→total, Pending→0, Partially Paid reconciled manually)
- Anas (party 9) `current_balance` fixed to ₹1,300 (was ₹1,500, ₹200 drift)
- `/payments` rebuilt (outstanding + receipt + Suspense prefill)
- `/parties` rebuilt (mobile cards, 3 pads)
- `/parties/[id]` new
- `/sales` `?party_id=` prefill with race guard

## Session 2026-10-19 additions
- Parser v28: part-strip BEFORE spacing rules (prevents `10 CG → 10CG` fusion)
- Network-aware search ranking (5g/4g priority)
- `search_items` ORDER BY bug fixed (`order_prefix` var, not bare `0`)
- Data cleanup: Nord dupes merged (7 pairs), MI 11X / RM 14PRO / SAM S21FE / TEC KE5 / VV V50E merged, GEN-TOOL-OG removed, 0 orphaned FKs

---

## Standing rules for AI assistant
1. Never guess at code you haven't seen. Ask for the file.
2. Never delete/rename items without checking `purchase_items`, `sale_items`, `returns`, `losses` for references first.
3. Full files, one per message. No fragments, no `...` placeholders. Split into 2–3 parts only if >800 lines, clearly labeled "Part 1 of 2".
4. Mobile-first for every UI change.
5. Ask for SQL output / raw data before proposing fixes.
6. CSV header (purchases + returns): `Description of Goods,Type of Goods,Quality,Quantity,Price,Unit`
7. One CSV per source invoice.
8. User is often on phone — short queries, one at a time.
9. "give me csv" = full CSV content to paste into import dialog, not SQL.
10. Stock/cost changes handled by DB triggers — do NOT add app-level stock updates.
11. Real production data — no destructive SQL without first showing `SELECT COUNT(*)` with the same WHERE and getting explicit confirmation.
12. User's number keys sometimes broken — provide copy-paste-ready SQL, avoid requiring digit typing.
13. **PostgREST caps responses at 1000 rows.** Any query fetching full `items` table must use RPC aggregation OR scoped `.in('item_id', ids)` / `.in('sku', ...)` filtering, NOT client-side array search. Bit 3 times now (`/returns`, `/losses`, `ImportCSVDialog`) — always scope.
14. Verify writes: after a save, refetch and confirm the value persisted. Never say "saved" unless it landed.
15. Party creation modal flow: staff types new name → SmartCombobox reports `isNew = true` → parent opens NewPartyDialog → on OK, insert with title case, duplicate check, verify, append to list.
16. **NEVER put `overflow-*` on a wrapper containing a `SmartCombobox`** — clips the dropdown.
17. **Prefill from URL requires disabling competing defaults** — any `loadData`/`useEffect` setting a "default selection" must check the query param and bail (`&& !prefillPartyId`).
18. **Compute due from `total_amount − paid_amount`, never trust `current_balance` alone.** `current_balance` can drift.
19. **Profit formula uses `(quantity − returned_qty)` — never `amount` directly.**
20. **Test data cleanup:** delete by `item_id` + date range, NOT by note text. Verify stock/khata after. Delete triggers fire.
21. **Import path depth matters** — index pages use `'../../lib/...'`, report pages use `'../../../lib/...'`.
22. **`useSearchParams` requires `<Suspense>` boundary** — `Inner()` + default export wraps in Suspense. Used in `/payments`, `/sales`.
23. **`localStorage` changes require hard reload** (Ctrl+Shift+R) to see.
24. One file per message.
25. **`tryMatchAt` boundary check prevents partial brand match when brand is glued to model.** Fixed for `SAMA23` via `normalizeTypos` pre-split rule. Real vendor CSVs may surface more cases.
26. **Fusion rule is intentional** — 1–2 letter tokens + digit fuse (`CE 3 → CE3`, `9 A → 9A`). Longer tokens keep dashes (`NOTE 12 → NOTE-12`). Do NOT remove without mass migration.

---

## Working state (end 2026-10-25)
- Anas (party 9): `current_balance = 1300` (sale 56: ₹4,300 total, ₹3,000 paid, ₹1,300 due)
- Counter Sale (party 3): ₹0
- All other customers: ₹0
- `expenses`: 1 real entry (₹6,000 Staff)
- `sale_items.cost_at_sale`: 917 lines, 0 zero-cost
- Purchase 45: 9 lines, ₹3,262.50, clean
- Item 486 `IP-14-PLUS-SPK-100OG` stock = 4
- Items 466 (`IP-XS-SPKF-OG`) and 544 (`IP-XS-SPKF`) — renamed 2026-10-25, quality set correctly
- Parser v34 shipped
- All 12 reports working
- Khata Aging visible to staff
- No test data

---

## Known open items (parked)

### Data migrations (deferred)
- **313 `OP-RE-*` → `RM-*`** — decision 2026-10-25: keep as-is. `OP-RE-*` prefix accepted as historical convention.
- **Poco MI/RM split** (~22 items) — leave under MI as `MI-POCO-*`
- **7 phantom `-SPEAKER-ESPK` items** (0 stock) — safe delete after ref-check
- **5 phantom `-ONLY` items** — items 466, 544 renamed 2026-10-25; check others with:
  ```sql
  SELECT item_id, sku, quality, current_stock, cost_price FROM items WHERE sku LIKE '%-ONLY';
OP-VIVO-4-PIN-ONOFFSWITCH-SMALL — weird combo SKU from old import

Junk models cleanup — trailing quotes, quality words, part codes in names

Form B SKU migration (dash-everything) — deferred, would break existing fused SKUs

Code
update_purchase RPC — not updated for invoice_rate

Historical invoice_rate — old purchases have invoice_rate = rate (backfilled). New purchases correct.

UTC date default bug — toISOString().slice(0,10) shows previous day 00:00–05:30 IST. Sales Explorer uses toLocaleDateString('en-CA') to avoid; other pages may still have the bug. Parked.

Unique constraints on models(brand_id, model_name, network) and part_types(part_code) — need dup check first

Infrastructure
Auto-deploy flaky — vercel --prod when needed

Missing migration files in repo: expenses, sales.paid_amount — worth db/ folder

Backups — not automated. DB loss = unrecoverable except what's in code.

Vercel Hobby non-commercial — terms say shouldn't, runs fine

Supabase 7-day pause on free tier if inactive — uptime monitor fixes it

Parser quirks (not bugs)
part_type_aliases has 2 PIN, 3 PIN, 4 PIN → ONOFFSWITCH — intentional. Means CHARGING FLEX 2 PIN (if it ever appears) would consume 2 PIN as part before size marker — but CCFLEX doesn't have pin variants in real data, so this doesn't occur.

OP RE → OP-RE-* — accepted convention

{BARCODE} — not a flag, falls into model or is discarded. Confirmed junk.

Useful SQL shortcuts
sql
-- Item count
SELECT COUNT(*) FROM items;

-- Recent purchases
SELECT purchase_id, invoice_no, total_amount FROM purchases ORDER BY purchase_id DESC LIMIT 10;

-- Recent sales
SELECT sale_id, bill_date, total_amount FROM sales ORDER BY sale_id DESC LIMIT 10;

-- Zero-cost sale lines
SELECT COUNT(*) FROM sale_items WHERE cost_at_sale = 0 OR cost_at_sale IS NULL;

-- Expense totals by type this month
SELECT expense_type, COUNT(*), SUM(amount) FROM expenses WHERE expense_date >= date_trunc('month', CURRENT_DATE) GROUP BY expense_type;

-- Outstanding balance per customer
SELECT party_id, party_name, current_balance FROM parties WHERE party_type = 'Customer' AND current_balance > 0 ORDER BY current_balance DESC;

-- Brand aliases
SELECT csv_code, brand_code FROM brand_aliases ORDER BY csv_code;

-- Brands table
SELECT brand_id, brand_code, brand_name FROM brands ORDER BY brand_code;

-- Suspicious part aliases (pins mapping to ONOFFSWITCH is expected)
SELECT csv_text, part_code FROM part_type_aliases WHERE csv_text LIKE '%PIN%' OR csv_text LIKE '%MM%';

-- Items with a given SKU
SELECT item_id, sku, quality, current_stock, cost_price FROM items WHERE sku IN ('...');

-- Last item entered on a given date (IST window)
SELECT s.entry_date, s.sale_id, p.party_name, i.sku, si.quantity, si.rate, si.detail_id
FROM sales s
JOIN sale_items si ON si.sale_id = s.sale_id
JOIN parties p ON p.party_id = s.party_id
JOIN items i ON i.item_id = si.item_id
WHERE s.entry_date >= '2026-10-20 00:00:00+05:30'::timestamptz
  AND s.entry_date <  '2026-10-21 00:00:00+05:30'::timestamptz
ORDER BY s.entry_date DESC, si.detail_id DESC
LIMIT 20;

-- Ref-check before deleting item (replace X)
SELECT 'purchase_items' AS src, COUNT(*) FROM purchase_items WHERE item_id = X
UNION ALL SELECT 'sale_items', COUNT(*) FROM sale_items WHERE item_id = X
UNION ALL SELECT 'returns', COUNT(*) FROM returns WHERE item_id = X
UNION ALL SELECT 'losses', COUNT(*) FROM losses WHERE item_id = X;
Push command (current)
bash
git add lib/csv-parser.ts app/reports/sales-explorer/page.tsx app/reports/page.tsx app/reports/khata-aging/page.tsx components/ui/ImportCSVDialog.tsx
git commit -m "Parser v34 (1+NORD, brand-consume, curly quality, glued brand); Sales Explorer; Khata Aging for staff; scoped SKU lookup in import"
git push
If Vercel auto-deploy doesn't fire:

bash
vercel --prod
Recent commit history
2026-10-19: parser v28, network-aware search, search_items ORDER BY fix, data cleanup

2026-10-20: sales.paid_amount, /payments rebuild, /parties rebuild, /parties/[id] new, /sales prefill

2026-10-21: /expenses, /reports/expenses, /reports/profit, home rebuild, /returns + /losses fixes, /parties filter, balance breakdown

2026-10-22: 5 reports, /reports cleanup, 9 quick actions, import path fix

2026-10-23: /sales edit modal

2026-10-24: purchase 45, phantom IP-14-SPK-100OG fix, parser 14+ fix

2026-10-25: parser v34, Sales Explorer, Khata Aging staff, ImportCSVDialog scoped lookup

End of handoff.