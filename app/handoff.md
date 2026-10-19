CELLCOM SPARE ERP — SESSION HANDOFF (Updated 2026-10-16)

Stack

Next.js 16 (App Router, 'use client' components, no server actions)

Supabase (Postgres + PostgREST + RPC functions)

Vercel for deploy (CLI: vercel --prod — GitHub auto-deploy connected to cellcommbd/cellcom-spare branch main but manual CLI still sometimes needed)

TypeScript

Path alias: @/ maps to project root. Both @/lib/... and ../../lib/... used.

Mobile-first responsive is a hard requirement.

User is often on phone — keep queries short, one at a time.

User's number keys sometimes broken — provide copy-paste-ready SQL, avoid requiring digit typing.

User's laptop is temporary — sometimes different hardware with the same disk. Vercel CLI auth can expire; run vercel login if "Not authorized".

Project directory structure

text
cellcomspare/
├── app/
│   ├── brands/page.tsx
│   ├── categories/page.tsx
│   ├── find-stock/page.tsx           (redesigned — main staff page)
│   ├── imports/skipped/page.tsx
│   ├── items/page.tsx
│   ├── login/page.tsx
│   ├── losses/page.tsx
│   ├── parties/page.tsx
│   ├── payments/page.tsx             (redesigned — Cash/Online split + statement)
│   ├── pinset/page.tsx
│   ├── purchase-returns/page.tsx
│   ├── purchases/
│   │   ├── page.tsx                  (uses save_purchase_full RPC)
│   │   └── [id]/edit/page.tsx        (never audited)
│   ├── reference/page.tsx
│   ├── reports/
│   │   ├── page.tsx                  (index with cards)
│   │   ├── cost-history/page.tsx
│   │   ├── low-stock/page.tsx
│   │   ├── dead-stock/page.tsx       (RPC-based)
│   │   └── stock-value/page.tsx      (RPC-based)
│   ├── returns/page.tsx
│   ├── sales/page.tsx                (NewPartyDialog wired)
│   └── statement/page.tsx            (new — WhatsApp statement)
├── components/ui/
│   ├── button.tsx
│   ├── combobox.tsx
│   ├── ImportCSVDialog.tsx
│   ├── input-group.tsx
│   ├── input.tsx
│   ├── new-item-dialog.tsx
│   ├── new-party-dialog.tsx          (NEW — shared party creation modal)
│   ├── smart-combobox.tsx            (has fallbackLabel prop)
│   └── textarea.tsx
├── lib/
│   ├── auth.ts                       (local-only role: localStorage)
│   ├── csv-mapper.ts
│   ├── csv-parser.ts                 (v26 — preserves "+" in model names)
│   ├── item-search.ts                (soft-fail try/catch)
│   ├── statement-format.ts           (NEW — shared WhatsApp text builder)
│   ├── supabase.ts
│   └── utils.ts
├── app/globals.css
├── app/layout.tsx
└── app/page.tsx
Database schema (public)

items

item_id serial PK, sku varchar UNIQUE

brand_id int FK → brands (NULLABLE)

model_id int FK → models (NULLABLE)

part_id int FK → part_types (NULLABLE)

category_id int FK → categories (NULLABLE)

is_phone_part bool DEFAULT true

quality text (Normal | OG | 100 OG | Care OG | China OG)

variant text, color text

cost_price numeric DEFAULT 0, selling_price numeric DEFAULT 0

current_stock int DEFAULT 0

is_active bool DEFAULT true

reorder_point int DEFAULT 0

brands — brand_id, brand_name, brand_code, purchase_prefix (text NULLABLE)

brand_aliases — id, csv_code, brand_code

part_types — part_id, part_code UNIQUE (constraint ^[A-Z0-9]+$), part_name

part_type_aliases — id, csv_text UNIQUE, part_code

categories — category_id, category_code UNIQUE, category_name (TOOL, CLEANING, CONSUMABLE, ACCESSORY, SPRAY, OTHER)

parser_color_aliases — csv_text UNIQUE, color_value (SILVAR→SILVER, GR→GREY, etc.)

models — model_id, brand_id, model_name, network (4G/5G/null)

purchases

purchase_id, party_id int, invoice_no varchar(50), purchase_date date NOT NULL

total_amount numeric, freight_charges numeric DEFAULT 0, cash_paid numeric DEFAULT 0

credit_applied numeric DEFAULT 0, created_at timestamptz

purchase_items

detail_id serial PK, purchase_id int FK, item_id int FK

quantity int, rate numeric (LANDED — includes freight)

invoice_rate numeric NULLABLE (RAW — added 2026-10-11, backfilled = rate)

amount numeric

sales

sale_id, party_id, bill_date date, entry_date timestamptz

total_amount numeric, status varchar (Pending | Partially Paid | Paid)

sale_items

detail_id, sale_id, item_id, quantity, rate, amount, cost_at_sale, returned_qty

payments

payment_id, party_id, payment_date date, amount numeric, payment_mode varchar, created_at

parties

party_id, party_name varchar, phone varchar NULLABLE, party_type (Customer|Supplier), current_balance numeric, purchase_prefix text

returns — return_id, party_id, item_id, return_date, quantity, rate, total_amount, is_sellable, reason, return_type ('Supplier'|'Customer'), created_at

losses, skipped_import_rows, settings — standard

settings — key varchar, value varchar (stores staff_pin, owner_pin, pin_version)

RPC functions

Search:

search_items(p_query text, p_limit int DEFAULT 25) — searches SKU, brand, model, part, quality, variant, color. Token-based AND.

Aggregation:

purchase_line_counts(p_ids int[]) — (purchase_id, line_count)

stock_value_by_brand() — (brand_id, brand_code, brand_name, items, units, stock_value). No row cap.

top_items_by_brand(p_brand_id int, p_limit int DEFAULT 10)

dead_stock_summary() — (total_value, total_items, never_sold_value, never_sold_items)

dead_stock_items(p_never_only bool, p_min_stock int, p_search text, p_limit int) — (item_id, sku, current_stock, cost_price, selling_price, stock_value, last_sale)

Mutation (atomic):

save_purchase_full(p_party_id int, p_invoice_no text, p_purchase_date date, p_freight numeric, p_cash_paid numeric, p_items jsonb) — creates brands/models/parts/items as needed, creates purchase + lines, returns purchase_id. Rolls back on any error. Used by app/purchases/page.tsx.

delete_purchase(p_id int)

update_purchase(...) — exists but not updated for invoice_rate. Needs review.

Triggers (automatic — do NOT manually adjust stock in app code):

trg_sale_items_insert → decrements items.current_stock

trg_sale_items_delete → increments items.current_stock

trg_purchase_items_insert → increments stock + weighted avg cost

trg_purchase_items_delete → decrements stock

trg_update_cost_price → recomputes weighted avg cost

trg_returns_insert/delete → adjusts stock

trg_losses_insert/delete → adjusts stock

lib/csv-parser.ts (v26)

SKU grammar: BRAND - MODEL - PART - [YEAR] - [VARIANT] - [NETWORK] - [FLAG] - [COLOR] - [QUALITY]

Key features:

normalizeTypos — SAMRT→SMART, BORD→BOARD, CONVETOR→CONVERTER, SILVAR→SILVER, etc.

extractPartFromDescription(desc, aliases) — merges DB aliases (part_type_aliases) + hardcoded phrases, longest-first

Multi-word brand matching, model extraction

normalizeModelName — strips trailing part codes, quality markers, size markers

extractQualityFromMarkers — 100 OG / OG / Care OG / China OG / Normal

classifyMarkers — variant, year, network, flag, size, color (with color aliases)

GR/GREY fix: trailing color check runs twice — once before part extraction, once after

v26 fix (PRO+ → PRO PLUS): two edits:

In extractBrandAndModel: added noNet = noNet.replace(/([A-Z])\+/gi, '$1 PLUS ') after digit-plus rule
In normalizeModelName: removed the .replace(/\s*\+\s*$/, '') line that was stripping trailing +
Result: MI NOTE 12 PRO+ OUT SIM TRY → MI-NOTE-12-PRO-PLUS-ST

AliasMaps type:

ts
{
  brandAliases: Record<string, string>
  partAliases: Record<string, string>
  colorAliases?: Record<string, string>
  validBrandCodes?: string[]
}
lib/item-search.ts

Wrapper around search_items RPC. Has try/catch — fails soft, returns [] on network error.

lib/auth.ts (local-only)

getRole(): 'staff' | 'owner' | null — reads from localStorage key cellcom_role

setRole(role, pinVersion) — writes role + pin version

clearRole()

isOwner() — helper

getPins() — fetches from settings table

validateSession() — checks pin_version from DB matches stored version. Soft-fails: network errors keep session alive.

No Supabase auth session — all requests use anon key. RLS not relied on for permissions.

lib/statement-format.ts (NEW)

Shared helper that builds WhatsApp-ready statement text. Used by /statement and /payments.

Functions:

buildStatementText(data: StatementData): string — builds the WhatsApp text with *bold* and _italic_ markers. No emoji (WhatsApp mangles them). Uses Rs. instead of ₹ for compatibility.

normalizePhoneForWhatsApp(raw): string | null — accepts 10-digit or with prefix, returns 91XXXXXXXXXX or null

buildWhatsAppUrl(phone, message): string | null — builds wa.me URL

StatementData type:

ts
{
  shopName?: string          // defaults to 'CELLCOM SPARE'
  customerName: string
  fromDate: string           // YYYY-MM-DD
  toDate: string
  items: StatementItem[]     // { sku, quantity, rate, amount }
  purchasesTotal: number
  previousBalance: number
  cashPaid: number
  upiPaid: number
  netDue: number
}
Example output:

text
*CELLCOM SPARE*
━━━━━━━━━━━━━━━
_Customer:_ *Anas*
_Date:_ 16 Oct 2026

*ITEMS*
━━━━━━━━━━━━━━━
*VV-Y21-2020-FH*
   2 × Rs.90.00 = *Rs.180.00*

*Total Purchases: Rs.290.00*

*ACCOUNT SUMMARY*
━━━━━━━━━━━━━━━
   Previous Balance:Rs.1500.00
          Purchases:+Rs.290.00
        Paid (Cash):-Rs.500.00
━━━━━━━━━━━━━━━

*NET DUE:  Rs.1290.00*

_Thank you for your business!_
components/ui/smart-combobox.tsx

Props:

options, value, onValueChange(value, label, isNew), onSearch, onTabKey, focusNextOnSelect, inputRef, showReferenceLink, onCreateNew

fallbackLabel?: string | null — text to display when value is set but no matching option exists

allowCreate — default true; shows "Add [X] as new" when typed text doesn't match an option exactly AND filteredOptions.length === 0

components/ui/new-party-dialog.tsx (NEW)

Shared modal for creating customers/suppliers.

Props:

open: boolean

initialName: string

partyType: 'Customer' | 'Supplier'

onClose: () => void

onCreated: (party: CreatedParty) => void

Behavior:

Prefilled name, autofocus + select-all

Live duplicate check (300ms debounce) — case-insensitive exact match within same party_type

Title case applied on save (ramu kirana → Ramu Kirana). Special: M/S, Mr, Mrs, Dr, S/O, D/O, W/O preserved as-is.

Add button disabled while: checking, duplicated, empty, or saving

On save: verify insert landed, show "Saved" before calling onCreated

Never silent failure — shows error if insert fails

Escape = close, Enter = save (if valid)

Purchases page

Supplier picker with auto invoice-no suggestion using purchase_prefix

Item rows with search_items lookup

Freight auto-distributed proportionally to line amount

Single RPC call save_purchase_full — atomic

fallbackLabel on SmartComboboxes for matched CSV rows

Delete uses delete_purchase RPC

Sales page

Shop picker with Counter Sale default

Focus flow: shop → item → qty (default 1) → rate → new row

NewPartyDialog wired: if isNew in shop onValueChange → setPendingNewParty(label) → dialog opens

On creation: appends to shops list, sets pickedShop, closes dialog

Sales Report section with From/To date pickers

Uses nested join for report: sale_items!inner(sales!inner(bill_date)), items!inner(sku)

Payments page

Redesigned:

Modern slate UI

Cash/Online toggle — default Cash

Online mode reveals UPI field, mirrors amount, editable

Preview shows split: "UPI ₹X · Cash ₹Y"

Save splits into 2 payment rows if UPI < amount

Verify after save: check balance persisted, warn if mismatch

Statement card appears after successful save with Copy + WhatsApp buttons

Inline phone add (same as statement page)

Shop balances table — click row to select

NewPartyDialog wired

FIFO logic preserved (marks old sales Paid/Partially Paid)

Delete payment reverses balance

Statement page (/statement)

Route: top-level, both roles see

Customer picker (searchable, shows balances)

Date range with quick buttons (Today / Yesterday / This Week / This Month)

Summary card (dark) showing Previous / Purchases / Paid / Net Due

Copy button — copies WhatsApp text to clipboard

WhatsApp button — opens wa.me with prefilled text

Inline phone add — with verify step

Preview panel showing exact copied text

Find-stock (/find-stock) — THE MAIN PAGE FOR STAFF

No search button — auto-search on 300ms debounce (no flicker)

Top thin loading bar

Autofocus on load, Enter to force search

Filters: search input with X clear, "In stock only" toggle (default ON), brand dropdown, Clear all

Mobile: cards with big touch targets; Desktop: compact table

CP shown ABOVE SP (staff need cost for bargaining)

Stock badge color-coded: grey (0), amber (1-5), green (6+)

"sold N" badge if item has sales history

One-line summary: "X items · Y units · ₹Z retail"

Reports:

Reports index — cards with href, title, description, Icon, color, ownerOnly, comingSoon

Cost-history — dual rate columns (Inv ₹ / Landed ₹), "Changed only" toggle, CSV, sort. Uses invoice_rate for raw, rate for landed.

Low-stock — threshold input (default 0) with quick-picks 0/2/3/5, checkbox per row, qty input per row, sticky bottom bar with totals, "Copy list" button copies SKU x QTY lines. Threshold-based (no reorder_point needed).

Dead-stock — two tabs (Highest Stock Value / Never Sold). Uses RPCs. Totals: ₹5.18L / ₹4.53L never-sold.

Stock-value — brand-aggregated via RPC. Dark summary card, expandable brand rows showing top 10 items.

Current data state

Purchases: 29 real purchases. SS-1 to SS-10 (SS-10 = purchase 26 labeled SS-06-10 meaning Selfside dated 6 Oct), RG-1 to RG-13, AS-1 to AS-3, ASK-1, OT-1.

Sales: a handful. Anas has 1 sale ₹4,300 marked Partially Paid, ₹3,000 paid, ₹1,300 balance.

Items: ~2565 total, 2506 with stock > 0

Total stock value: ₹5,18,421.10

Never-sold value: ₹4,52,837.33 (2223 items)

Top brands: OP ₹1.20L, VV ₹1.01L, IP ₹76.6K, RM ₹67.4K, SAM ₹50.4K

Brand code map:

IP/IPHONE/APPLE → IP; SAM/SAMSUNG → SAM; OP/OPPO → OP; VV/VIVO → VV; RM/REALME → RM; MI/POCO/REDMI → MI; MT/MOTO → MT; TEC/TECHNO → TEC; INF/INFINIX → INF; ONE/1+ → ONE; NOTH/NOTHING → NOTH; ITL → ITL; NK → NK; JIO → JIO; GEN → GEN

Part code samples (see part_types table for full):

BP (Back Panel/Cover/BK), FH (Full Housing), MF (Middle Frame/MD), MFF (Middle Frame with Flex), LCD, LCDCON, LCDRING, BATCON (Battery Conn/B/C), BOARDCONN (Board Conn/BORD CONN), SENSORCONN, SENSORSIDE, SENSOR, ONOFF (On Off Flex), ONOFFSWITCH (On Off Switch/Tikli/Switch), VOL (Volume Flex), CCFLEX (Charging Flex/CC Flex), CHG, RB (Ringer Box), SPK, SPKF, SPKFL, SPKJ (Speaker Jali), ESPK (Ear Speaker/EXX-BEE), ESPKF, ESPKFL, CG (Camera Glass), CL (Camera Lens), CAM, BCAM, FCAM, FF (Flash Flex), ST (Sim Tray/SIM TRY), GASKITF/GASKITB/GASKIT, OUTKEY, MIC, VIB, ANT, INRUBBER, BACKGLASS, CONVHOUSING, NETWORKWIRE

Quality markers:

{OG}, {Ori}, {ORIG}, {ORIGINAL} → OG

{100%}, {100% OG} → 100 OG

{CARE}, {CARE OG} → Care OG

{CHINA OG}, {C+ 100% ORIG} → China OG

none → Normal

Standing rules for AI assistant

Never guess at code you haven't seen. Ask for the file.

Never delete or rename items without checking purchase_items, sale_items, returns for references first.

Full files, split into 2-3 parts if long. No ... placeholders.

Mobile-first for every UI change.

Ask for SQL output / raw data before proposing fixes.

Same 6-column CSV header for purchases and returns: Description of Goods,Type of Goods,Quality,Quantity,Price,Unit

One CSV per source invoice.

User is often on phone — keep queries short, one at a time.

When user says "give me csv" — they mean the full CSV content to paste into import dialog, not SQL.

Stock/cost changes are handled by DB triggers — do NOT add app-level stock updates.

Real production data — no destructive SQL without first showing SELECT COUNT(*) with the same WHERE and getting explicit confirmation.

User's number keys sometimes broken — provide copy-paste-ready SQL, avoid requiring digit typing.

PostgREST caps responses at 1000 rows by default. Any query fetching full items table must use RPC aggregation, not client-side filtering.

Verify writes: after a save (party, payment, phone, etc.), refetch and confirm the value persisted. Never say "saved" unless it landed.

Party creation modal: staff type new name → SmartCombobox reports isNew = true → parent opens NewPartyDialog → on OK, insert with title case, duplicate check, verify, append to list.

Known open items

Auto-deploy: Vercel connected to cellcommbd/cellcom-spare main, but pushes don't always trigger. Manual vercel --prod if needed. Auth expires periodically.

Junk models cleanup — trailing quotes, quality words in names (100 OG, SAMRT 8 .), part codes stuck in models.

Unique constraints on models(brand_id, model_name, network) and part_types(part_code) — need dup check first.

Historical invoice_rate — old purchases have invoice_rate = rate (backfilled). New purchases correct.

UTC date default bug — toISOString().slice(0,10) shows previous day 00:00-05:30 IST. User doesn't care — parked.

app/purchases/[id]/edit/page.tsx — never audited.

update_purchase RPC — not updated for invoice_rate.

Auto-focus after NewPartyDialog: currently tries selector input[data-row-item="row-1"] but sales page has both mobile + desktop copies in DOM; focus lands on hidden one. Non-blocking.

Reports still marked "coming soon"

Supplier Price Comparison (/reports/supplier-prices)

Fast-Moving Items (/reports/fast-moving)

Profit per Item (/reports/profit-per-item)

Khata Aging (/reports/khata-aging)

Monthly P&L (/reports/monthly-pnl)

Recent Activity (/reports/recent-activity)

Verify page file exists before removing comingSoon: true from any card.

PDF-to-CSV workflow

User pastes raw invoice text.

AI reads description column.

Splits into: Description of Goods (brand + model + markers), Type of Goods (part type).

Emits 6-column CSV: Description of Goods,Type of Goods,Quality,Quantity,Price,Unit

Rules: rate = per-Pcs rate (pre-freight); qty format N Pcs; negative = credit line (remove); merge duplicate SKUs; brand text kept as source.

Before emitting CSVs, ask user to run:

sql
SELECT csv_code, brand_code FROM brand_aliases;
SELECT csv_text, part_code FROM part_type_aliases;
SELECT part_code, part_name FROM part_types ORDER BY part_code;
SELECT csv_text, color_value FROM parser_color_aliases;
Useful shortcuts

Item count: SELECT COUNT(*) FROM items;

Recent purchases: SELECT purchase_id, invoice_no, total_amount FROM purchases ORDER BY purchase_id DESC LIMIT 10;

Recent sales: SELECT sale_id, bill_date, total_amount FROM sales ORDER BY sale_id DESC LIMIT 10;

Full purchase list: SELECT p.purchase_id, p.invoice_no, p.total_amount, (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.purchase_id) AS lines FROM purchases p ORDER BY p.purchase_id;

What was done in this session (2026-10-16)

Find-stock redesign — removed search button (flicker fix), removed part/quality dropdowns, removed advanced panel, one-line summary, mobile cards, top loading bar, autofocus, CP shown above SP.

Stock-value report built with stock_value_by_brand and top_items_by_brand RPCs. Dark summary card, expandable brand rows.

Dead-stock report fixed (was capped at 1000 rows) with dead_stock_summary and dead_stock_items RPCs.

Statement page (/statement) — new. Customer picker, date range, item list, balance summary, Copy button for WhatsApp. Uses lib/statement-format.ts.

Statement format helper (lib/statement-format.ts) — shared text builder. Plain text (no emoji) — WhatsApp-safe. Uses *bold*, _italic_, ━━━ dividers, Rs. instead of ₹.

NewPartyDialog component (components/ui/new-party-dialog.tsx) — shared modal for adding customers/suppliers. Duplicate check, title case, verify on save.

Sales page — wired NewPartyDialog. Intercepts isNew = true from SmartCombobox → opens modal → on create appends to list, selects, closes.

Payments page redesign — modern slate UI, Cash/Online toggle with UPI split (2 rows on save), verify balance update, statement card appears after save, inline phone add, WhatsApp button.

Parser v26 fix — PRO+ → PRO PLUS in model names (was collapsing PRO+ and PRO to same SKU).

Imported invoice: 90-row Selfside-type invoice with duplicate merges and C25Y BP split (3 BLUE + 1 BLACK).

Added DB aliases: ON/OFF FLEX → ONOFF, BACK PAANEL → BP, VOLLUME FLEX → VOL.

End of handoff.

this is for sku generation in new way
SKU Generation — Design Decisions (2026-10-19)
Current State (what's live now)
Parser rules 1-3 in lib/csv-parser.ts normalizeModelName:

ts
cleaned = cleaned.replace(/\b([A-Z]{1,2})\s+(\d)/g, '$1$2')    // Rule 1: CE 2 → CE2
cleaned = cleaned.replace(/\b(\d+)\s+([A-Z]{1,2})\b/g, '$1$2') // Rule 2: 10 R → 10R
cleaned = cleaned.replace(/\b(\d+)\s+([A-Z])\b/g, '$1$2')      // Rule 3: 11 X → 11X
Covers:

NORD CE 2 → NORD CE2

10 R → 10R

11 X → 11X

KE 5 → KE5 (via rule 1)

V50 E → V50E (via rule 3)

Does NOT cover:

14 PRO vs 14PRO (multi-letter suffix after digit)

S21 FE vs S21FE (multi-letter suffix)

V50 E handled by rule 3, but a V50 MAX would not be

Result: ~90% of duplicates prevented. Remaining ~10% require manual cleanup periodically.

Completed cleanup tonight:

All Nord pairs merged (CE, CE2, CE2 LITE, CE3, CE3 LITE, CE4 LITE, CE5, 10R)

MI 11 X / 11X

RM 14 PRO / 14PRO

SAM S21FE / S21 FE

TEC KE5 / KE 5

VV V50 E / V50E

Form B — Planned Future State (NOT implemented yet)
Vision: every SKU segment dash-separated. Every word, digit, and modifier its own segment.

Examples:

text
BRAND - MODEL - [YEAR] - PART - [NETWORK] - [FLAG] - [VARIANT] - [COLOR] - [QUALITY]

ONE-NORD-CE-4-LITE-FH-MEGA-BLUE
RM-NOTE-12-PRO-BP-5G-BLACK
SAM-A-15-BP-WL
Rule: split on every letter↔digit boundary, dash-separate everything.

NOTE 12 PRO → NOTE-12-PRO

NOTE12PRO → NOTE-12-PRO (same)

CE4 → CE-4

NORD CE 4 LITE → NORD-CE-4-LITE

S21FE → S-21-FE

Why Form B wins over Form A (current):

One rule vs. unbounded rules. Form A needs a new rule for every naming pattern. Form B needs only one.

Error-proof by construction. Any spacing/case/punctuation variation produces identical output.

Zero maintenance. No new rules as vendors introduce new patterns.

Search always works. Every token is a segment.

Deterministic sorting. Lexicographic, no edge cases.

Form B does NOT solve:

Typos (NTOE vs NOTE) → needs alias table

Abbreviations (N vs NOTE) → needs alias table

Position swaps that change meaning (NOTE 12 vs 12 NOTE) → rare in practice

Brand omission (model without brand prefix) → needs brand inference

Layers needed on top of Form B:

Canonical tokenization (Form B)

Alias tables for typos/abbreviations

Fuzzy duplicate warnings (Levenshtein near-match check before creating new model)

Form B Migration — Scope (when implemented)
Critical fact: all FKs reference item_id, not sku. Renaming SKUs is safe — no relationship breaks.

Files/tables affected:

Item	Change	Est.
lib/csv-parser.ts normalizeModelName	Rewrite for Form B tokenization	~40 lines
items.sku	Bulk migration to Form B	One SQL UPDATE
models.model_name	Optional — migrate for consistency	One SQL UPDATE (optional)
save_purchase_full	No change IF models migrated; else add alias check	0-15 lines
ImportCSVDialog.tsx	No change	0
app/purchases/page.tsx	No change	0
app/sales/page.tsx	No change	0
app/find-stock/page.tsx	No change	0
search_items RPC	No change (token-based, works with Form B)	0
Total: 1 source file + 2 bulk SQL migrations. ~1 hour focused work.

Migration approach:

Dry run — compute new SKUs, export diff, review (30 min)

Collision check — any two items normalize to same SKU? Merge first.

Backup — CREATE TABLE items_backup_YYYYMMDD AS SELECT * FROM items;

Transaction — BEGIN; UPDATE items SET sku = <form_b>; COMMIT; (or ROLLBACK if verification fails)

Deploy parser change — push Form B normalizeModelName

Test — import CSV, verify Form B output matches migrated SKUs

Rollback: transaction rollback + backup restore. Safe.

Form B Decision — Not Final
Pro: cleaner long-term, one rule, error-proof
Con: 1-2 hours work, cosmetic SKU change

Defer until:

Fresh session with 2-3 hours

Decision confirmed (do it or accept current state)

Current parser (rules 1-3) prevents ~90% of duplicates. Form B prevents ~99%. Remaining 1% needs aliases + fuzzy warnings