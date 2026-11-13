// scripts/reconcile.ts — v2
//
// Reconcilation audit v2. Key = brand|model|part|quality|flag|network|year
// (7 fields, all confirmed reliable). variant/size/color are DRIFT fields:
// compared after a key match, reported when they differ, never used to
// decide "different item".
//
// variant gets special treatment: values in MEANINGFUL_VARIANTS that conflict
// between DB and invoice are flagged as `variant_conflict` (possible different
// part, e.g. OCTA vs MAIN). Other variant values (sizes, model refs) are junk
// from past imports → `variant_junk`, ignored for matching.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//     npx tsx scripts/reconcile.ts "C:\Cellcom\Invoices\Outbox"

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  parseCSV,
  setDBMessages,
  hasDBMessages,
  type AliasMaps,
  type ParsedRow,
} from '../lib/csv-parser'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const RATE_TOL_BELOW = 0.10
const RATE_TOL_ABOVE = 0.15

// Variant values that are MEANINGFUL (different physical part if they conflict).
// Everything else in items.variant is junk from past imports (sizes, model refs).
const MEANINGFUL_VARIANTS = new Set([
  'MAIN', 'OCTA', 'NEW', 'REFRESH', 'MIX', 'METAL', 'BOX-PACKING', 'DAMD',
])

// ---------------------------------------------------------------------------
// Normalization + key
// ---------------------------------------------------------------------------

const norm = (s: string | null | undefined): string =>
  (s ?? '').toString().trim().toUpperCase().replace(/\s+/g, ' ')

const normModel = (s: string | null | undefined): string =>
  norm(s).replace(/\s+/g, '-')

// Normalize quality: 'Normal' -> '' (so NULL and 'Normal' are the same key)
const normQuality = (s: string | null | undefined): string => {
  const v = norm(s)
  return v === 'NORMAL' ? '' : v
}

const normVariant = (s: string | null | undefined): string => norm(s)

type KeyParts = {
  brand: string
  model: string
  part: string
  quality: string
  flag: string
  network: string
  year: string
}

type DriftFields = {
  variant: string
  size: string
  color: string
}

function makeKey(k: KeyParts): string {
  return [k.brand, k.model, k.part, k.quality, k.flag, k.network, k.year].join('|')
}

function keyFromParsed(r: ParsedRow): { key: string; drift: DriftFields } {
  const k: KeyParts = {
    brand: norm(r.brandCode),
    model: normModel(r.modelName),
    part: norm(r.partCode),
    quality: normQuality(r.quality),
    flag: norm(r.flag),
    network: norm(r.network),
    year: norm(r.year),
  }
  return {
    key: makeKey(k),
    drift: {
      variant: normVariant(r.variant),
      size: norm(r.size),
      color: norm(r.color),
    },
  }
}

function keyToParts(key: string): KeyParts {
  const [brand, model, part, quality, flag, network, year] = key.split('|')
  return { brand, model, part, quality, flag, network, year }
}

// ---------------------------------------------------------------------------
// DB loading
// ---------------------------------------------------------------------------

async function loadAliases(): Promise<AliasMaps> {
  const tables = [
    ['brand_aliases', 'csv_code', 'brand_code'],
    ['part_type_aliases', 'csv_text', 'part_code'],
    ['parser_color_aliases', 'csv_text', 'color_value'],
    ['flag_aliases', 'source_text', 'target_flag'],
    ['quality_aliases', 'source_text', 'target_quality'],
    ['variant_aliases', 'source_text', 'target_variant'],
  ] as const

  const maps: Record<string, Record<string, string>> = {}
  for (const [table, k, v] of tables) {
    const { data, error } = await supabase.from(table).select('*')
    if (error) throw new Error(`${table}: ${error.message}`)
    const m: Record<string, string> = {}
    for (const row of data ?? []) {
      const key = norm(row[k])
      const val = norm(row[v])
      if (key && val) m[key] = val
    }
    maps[table] = m
  }

  const { data: typoData, error: typoErr } = await supabase.from('typo_rules').select('*')
  if (typoErr) throw new Error(`typo_rules: ${typoErr.message}`)
  const typoRules = (typoData ?? []).map((r: any) => ({
    pattern: r.pattern,
    replacement: r.replacement,
    match_type: r.match_type,
    priority: r.priority ?? 100,
  }))

  setDBMessages({
    brandAliases: maps['brand_aliases'],
    partAliases: maps['part_type_aliases'],
    colorAliases: maps['parser_color_aliases'],
    flagAliases: maps['flag_aliases'],
    qualityAliases: maps['quality_aliases'],
    variantAliases: maps['variant_aliases'],
    typoRules,
  })
  if (!hasDBMessages()) throw new Error('setDBMessages failed')

  return {
    brandAliases: maps['brand_aliases'],
    partAliases: maps['part_type_aliases'],
    colorAliases: maps['parser_color_aliases'],
  }
}

type DBItem = {
  item_id: number
  sku: string
  brand: string
  model: string
  part: string
  quality: string
  flag: string
  network: string
  year: string
  variant: string
  color: string
  current_stock: number
  cost_price: number | null
  key: string
}

async function loadItems(): Promise<DBItem[]> {
  const pageSize = 1000
  let from = 0
  const all: any[] = []
  while (true) {
    const { data, error } = await supabase
      .from('items')
      .select(
        `item_id, sku, current_stock, cost_price,
         brands!inner(brand_code), models(model_name), part_types(part_code),
         quality, flag, network, year, variant, color`
      )
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`items: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }

  return all.map((r: any) => {
    const brand = norm(r.brands?.brand_code)
    const model = normModel(r.models?.model_name)
    const part = norm(r.part_types?.part_code)
    const quality = normQuality(r.quality)
    const flag = norm(r.flag)
    const network = norm(r.network)
    const year = norm(r.year)
    const variant = normVariant(r.variant)
    const color = norm(r.color)
    const key = makeKey({ brand, model, part, quality, flag, network, year })
    return {
      item_id: r.item_id,
      sku: r.sku,
      brand, model, part, quality, flag, network, year,
      variant, color,
      current_stock: Number(r.current_stock ?? 0),
      cost_price: r.cost_price === null ? null : Number(r.cost_price),
      key,
    }
  })
}

type ItemStats = {
  recorded_qty: number
  rate_min: number | null
  rate_max: number | null
  sold_qty: number
  lost_qty: number
}

async function loadItemStats(): Promise<Map<number, ItemStats>> {
  const stats = new Map<number, ItemStats>()
  const get = (id: number): ItemStats => {
    let s = stats.get(id)
    if (!s) {
      s = { recorded_qty: 0, rate_min: null, rate_max: null, sold_qty: 0, lost_qty: 0 }
      stats.set(id, s)
    }
    return s
  }

  {
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('purchase_items')
        .select('item_id, quantity, rate')
        .range(from, from + 999)
      if (error) throw new Error(`purchase_items: ${error.message}`)
      if (!data || data.length === 0) break
      for (const r of data as any[]) {
        const s = get(r.item_id)
        s.recorded_qty += Number(r.quantity ?? 0)
        const rate = Number(r.rate ?? 0)
        if (rate > 0 && Number(r.quantity) > 0) {
          if (s.rate_min === null || rate < s.rate_min) s.rate_min = rate
          if (s.rate_max === null || rate > s.rate_max) s.rate_max = rate
        }
      }
      if (data.length < 1000) break
      from += 1000
    }
  }

  {
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('sale_items')
        .select('item_id, quantity, returned_qty')
        .range(from, from + 999)
      if (error) throw new Error(`sale_items: ${error.message}`)
      if (!data || data.length === 0) break
      for (const r of data as any[]) {
        const s = get(r.item_id)
        s.sold_qty += Number(r.quantity ?? 0) - Number(r.returned_qty ?? 0)
      }
      if (data.length < 1000) break
      from += 1000
    }
  }

  {
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('losses')
        .select('item_id, quantity')
        .range(from, from + 999)
      if (error) throw new Error(`losses: ${error.message}`)
      if (!data || data.length === 0) break
      for (const r of data as any[]) {
        const s = get(r.item_id)
        s.lost_qty += Number(r.quantity ?? 0)
      }
      if (data.length < 1000) break
      from += 1000
    }
  }

  return stats
}

// ---------------------------------------------------------------------------
// CSV folder scan
// ---------------------------------------------------------------------------

type InvoiceAgg = {
  qty: number
  rates: number[]
  examples: string[]
  files: Set<string>
  drift: DriftFields
}

function scanCSVs(folder: string): { files: string[]; dupFiles: string[] } {
  if (!fs.existsSync(folder)) throw new Error(`Folder not found: ${folder}`)
  const entries = fs.readdirSync(folder)
  const csvs = entries.filter((f) => f.toLowerCase().endsWith('.csv'))
  const seen = new Map<string, string>()
  const dupFiles: string[] = []
  const kept: string[] = []
  for (const f of csvs) {
    const buf = fs.readFileSync(path.join(folder, f))
    const hash = crypto.createHash('sha256').update(buf).digest('hex')
    if (seen.has(hash)) {
      dupFiles.push(f)
    } else {
      seen.set(hash, f)
      kept.push(f)
    }
  }
  return { files: kept, dupFiles }
}

function aggregateInvoices(
  folder: string,
  files: string[],
  aliases: AliasMaps,
  itemsForMatch: any[]
): Map<string, InvoiceAgg> {
  const agg = new Map<string, InvoiceAgg>()
  for (const f of files) {
    const csvText = fs.readFileSync(path.join(folder, f), 'utf8')
    const rows = parseCSV(csvText, aliases, itemsForMatch)
    for (const r of rows) {
      if (r.status === 'needs_correction') continue
      const { key, drift } = keyFromParsed(r)
      let a = agg.get(key)
      if (!a) {
        a = { qty: 0, rates: [], examples: [], files: new Set(), drift }
        agg.set(key, a)
      }
      a.qty += r.qty
      if (r.rate > 0) a.rates.push(r.rate)
      if (a.examples.length < 3) a.examples.push(r.rawDescription)
      a.files.add(f)
    }
  }
  return agg
}

// ---------------------------------------------------------------------------
// Classify
// ---------------------------------------------------------------------------

type Finding = {
  status: string
  item_id: number | null
  current_sku: string
  key_parts: KeyParts | null
  invoice_qty: number
  recorded_qty: number
  sold_qty: number
  lost_qty: number
  expected_stock: number
  current_stock: number
  stock_delta: number
  invoice_rate_min: number | null
  invoice_rate_max: number | null
  db_rate_min: number | null
  db_rate_max: number | null
  price_status: string
  drift_notes: string
  examples: string
  files: string
  notes: string
}

// Compare two variants. Returns a drift note, or null if no meaningful drift.
function variantDriftNote(dbVariant: string, invVariant: string): string | null {
  if (dbVariant === invVariant) return null
  const dbMeaningful = MEANINGFUL_VARIANTS.has(dbVariant)
  const invMeaningful = MEANINGFUL_VARIANTS.has(invVariant)
  if (dbMeaningful || invMeaningful) {
    return `variant_conflict(DB=${dbVariant || '-'}, inv=${invVariant || '-'})`
  }
  return `variant_junk(DB=${dbVariant || '-'}, inv=${invVariant || '-'})`
}

function colorDriftNote(dbColor: string, invColor: string): string | null {
  if (dbColor === invColor) return null
  if (!dbColor || !invColor) return null // null-tolerant: one side empty = no drift
  return `color(DB=${dbColor}, inv=${invColor})`
}

function classify(
  key: string,
  inv: InvoiceAgg | undefined,
  dbItems: DBItem[],
  stats: Map<number, ItemStats>
): Finding[] {
  const findings: Finding[] = []

  if (dbItems.length === 0) {
    if (!inv) return []
    const parts = keyToParts(key)
    findings.push({
      status: 'missing_item',
      item_id: null,
      current_sku: '',
      key_parts: parts,
      invoice_qty: inv.qty,
      recorded_qty: 0,
      sold_qty: 0,
      lost_qty: 0,
      expected_stock: 0,
      current_stock: 0,
      stock_delta: 0,
      invoice_rate_min: inv.rates.length ? Math.min(...inv.rates) : null,
      invoice_rate_max: inv.rates.length ? Math.max(...inv.rates) : null,
      db_rate_min: null,
      db_rate_max: null,
      price_status: '',
      drift_notes: '',
      examples: inv.examples.join(' ; '),
      files: Array.from(inv.files).join(','),
      notes: 'Invoice item not in DB — create it',
    })
    return findings
  }

  for (const it of dbItems) {
    const s = stats.get(it.item_id) ?? { recorded_qty: 0, rate_min: null, rate_max: null, sold_qty: 0, lost_qty: 0 }
    const invoice_qty = inv?.qty ?? 0
    const expected_stock = s.recorded_qty - s.sold_qty - s.lost_qty
    const stock_delta = it.current_stock - expected_stock

    const statuses: string[] = []
    const driftNotes: string[] = []

    if (invoice_qty > s.recorded_qty) statuses.push('missing_purchase')
    if (invoice_qty < s.recorded_qty) statuses.push('over_purchased')
    if (stock_delta !== 0) statuses.push('stock_stale')
    if (s.sold_qty > 0 && s.recorded_qty === 0) statuses.push('orphan_sales')
    if (it.current_stock > 0 && s.sold_qty === 0) statuses.push('dead_stock')

    // drift fields — only meaningful when there's an invoice to compare against
    if (inv) {
      const vNote = variantDriftNote(it.variant, inv.drift.variant)
      if (vNote) driftNotes.push(vNote)
      const cNote = colorDriftNote(it.color, inv.drift.color)
      if (cNote) driftNotes.push(cNote)
    }

    // price check
    let price_status = 'unknown'
    if (inv && inv.rates.length && s.rate_min !== null && s.rate_max !== null) {
      const imin = Math.min(...inv.rates)
      const imax = Math.max(...inv.rates)
      const band_lo = s.rate_min * (1 - RATE_TOL_BELOW)
      const band_hi = s.rate_max * (1 + RATE_TOL_ABOVE)
      const within = imin >= band_lo && imax <= band_hi
      price_status = within ? 'within_band' : 'outside_band'
      if (!within) statuses.push('price_off')
    }

    const baseStatus = statuses.length === 0 ? 'ok' : statuses.join('+')
    const status = baseStatus

    findings.push({
      status,
      item_id: it.item_id,
      current_sku: it.sku,
      key_parts: keyToParts(it.key),
      invoice_qty,
      recorded_qty: s.recorded_qty,
      sold_qty: s.sold_qty,
      lost_qty: s.lost_qty,
      expected_stock,
      current_stock: it.current_stock,
      stock_delta,
      invoice_rate_min: inv && inv.rates.length ? Math.min(...inv.rates) : null,
      invoice_rate_max: inv && inv.rates.length ? Math.max(...inv.rates) : null,
      db_rate_min: s.rate_min,
      db_rate_max: s.rate_max,
      price_status,
      drift_notes: driftNotes.join(' '),
      examples: inv?.examples.join(' ; ') ?? '',
      files: inv ? Array.from(inv.files).join(',') : '',
      notes: '',
    })
  }

  if (dbItems.length > 1) {
    findings.push({
      status: 'duplicate',
      item_id: null,
      current_sku: '',
      key_parts: keyToParts(key),
      invoice_qty: inv?.qty ?? 0,
      recorded_qty: 0, sold_qty: 0, lost_qty: 0,
      expected_stock: 0, current_stock: 0, stock_delta: 0,
      invoice_rate_min: null, invoice_rate_max: null,
      db_rate_min: null, db_rate_max: null,
      price_status: '',
      drift_notes: '',
      examples: inv?.examples.join(' ; ') ?? '',
      files: inv ? Array.from(inv.files).join(',') : '',
      notes: `${dbItems.length} DB items share this key: ${dbItems.map((x) => x.item_id).join(',')}`,
    })
  }

  return findings
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function rowToCsv(f: Finding): string {
  const k = f.key_parts
  const cols = [
    f.status,
    f.item_id ?? '',
    f.current_sku,
    k?.brand ?? '', k?.model ?? '', k?.part ?? '',
    k?.quality ?? '', k?.flag ?? '', k?.network ?? '', k?.year ?? '',
    f.invoice_qty, f.recorded_qty, f.sold_qty, f.lost_qty,
    f.expected_stock, f.current_stock, f.stock_delta,
    f.invoice_rate_min ?? '', f.invoice_rate_max ?? '',
    f.db_rate_min ?? '', f.db_rate_max ?? '',
    f.price_status,
    f.drift_notes,
    f.examples, f.files, f.notes,
  ]
  return cols.map((c) => csvEscape(String(c))).join(',')
}

const CSV_HEADER = [
  'status', 'item_id', 'current_sku',
  'brand', 'model', 'part', 'quality', 'flag', 'network', 'year',
  'invoice_qty', 'recorded_qty', 'sold_qty', 'lost_qty',
  'expected_stock', 'current_stock', 'stock_delta',
  'invoice_rate_min', 'invoice_rate_max',
  'db_rate_min', 'db_rate_max',
  'price_status',
  'drift_notes',
  'examples', 'files', 'notes',
].join(',')

function rowToTxt(f: Finding): string {
  const k = f.key_parts
  const label = k
    ? `${k.brand} ${k.model} ${k.part} ${k.quality} ${k.flag} ${k.network} ${k.year}`.replace(/\s+/g, ' ').trim()
    : f.current_sku || '(unknown)'
  return [
    `[${f.status}]`,
    `  item_id=${f.item_id ?? '-'}  sku=${f.current_sku || '-'}`,
    `  ${label}`,
    `  invoice_qty=${f.invoice_qty}  recorded_qty=${f.recorded_qty}  sold_qty=${f.sold_qty}  lost_qty=${f.lost_qty}`,
    `  expected_stock=${f.expected_stock}  current_stock=${f.current_stock}  stock_delta=${f.stock_delta}`,
    `  invoice_rate=${f.invoice_rate_min ?? '-'}..${f.invoice_rate_max ?? '-'}  db_rate=${f.db_rate_min ?? '-'}..${f.db_rate_max ?? '-'}  price=${f.price_status || '-'}`,
    f.drift_notes ? `  drift: ${f.drift_notes}` : '',
    f.examples ? `  invoices: ${f.examples}` : '',
    f.files ? `  files: ${f.files}` : '',
    f.notes ? `  notes: ${f.notes}` : '',
  ].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const folder = process.argv[2]
  if (!folder) {
    console.error('Usage: npx tsx scripts/reconcile.ts "<csv-folder>"')
    process.exit(1)
  }

  console.log(`Loading aliases…`)
  const aliases = await loadAliases()
  console.log(`Loading items…`)
  const dbItems = await loadItems()
  console.log(`  ${dbItems.length} items`)
  console.log(`Loading item stats (purchases/sales/losses)…`)
  const stats = await loadItemStats()
  console.log(`  stats for ${stats.size} items`)

  console.log(`Scanning CSVs in ${folder}…`)
  const { files, dupFiles } = scanCSVs(folder)
  console.log(`  ${files.length} unique files, ${dupFiles.length} duplicate-hash files skipped`)
  if (dupFiles.length) {
    console.log(`  duplicates skipped: ${dupFiles.join(', ')}`)
  }

  const itemsForMatch = dbItems.map((it) => ({
    item_id: it.item_id,
    sku: it.sku,
    brand_id: null,
    model_id: null,
    part_id: null,
    quality: it.quality,
  }))

  console.log(`Parsing CSVs and aggregating invoice lines…`)
  const invoices = aggregateInvoices(folder, files, aliases, itemsForMatch)
  console.log(`  ${invoices.size} distinct keys from invoices`)

  const dbByKey = new Map<string, DBItem[]>()
  for (const it of dbItems) {
    if (!dbByKey.has(it.key)) dbByKey.set(it.key, [])
    dbByKey.get(it.key)!.push(it)
  }

  const allKeys = new Set<string>([...invoices.keys(), ...dbByKey.keys()])

  console.log(`Reconciling ${allKeys.size} keys…`)
  const findings: Finding[] = []
  for (const key of allKeys) {
    const inv = invoices.get(key)
    const db = dbByKey.get(key) ?? []
    findings.push(...classify(key, inv, db, stats))
  }

  const severity = (s: string): number => {
    if (s.includes('missing_item')) return 0
    if (s.includes('missing_purchase')) return 1
    if (s.includes('stock_stale')) return 2
    if (s.includes('duplicate')) return 3
    if (s.includes('price_off')) return 4
    if (s.includes('over_purchased')) return 5
    if (s.includes('orphan_sales')) return 6
    if (s.includes('dead_stock')) return 7
    if (s === 'ok') return 99
    return 50
  }
  findings.sort((a, b) => {
    const d = severity(a.status) - severity(b.status)
    if (d !== 0) return d
    return Math.abs(b.stock_delta) - Math.abs(a.stock_delta)
  })

  const counts: Record<string, number> = {}
  for (const f of findings) {
    const primary = f.status.split('+')[0]
    counts[primary] = (counts[primary] ?? 0) + 1
  }

  // Drift counts (items that matched but have drift notes)
  let variantJunk = 0
  let variantConflict = 0
  let colorDrift = 0
  for (const f of findings) {
    if (f.drift_notes.includes('variant_junk')) variantJunk++
    if (f.drift_notes.includes('variant_conflict')) variantConflict++
    if (f.drift_notes.includes('color(')) colorDrift++
  }

  const totalMissingPurchase = findings
    .filter((f) => f.status.includes('missing_purchase'))
    .reduce((acc, f) => acc + Math.max(0, f.invoice_qty - f.recorded_qty), 0)
  const totalStockDelta = findings.reduce((acc, f) => acc + f.stock_delta, 0)

  console.log('')
  console.log('=== SUMMARY ===')
  console.log(`items in DB            : ${dbItems.length}`)
  console.log(`invoice keys           : ${invoices.size}`)
  console.log(`total keys evaluated   : ${allKeys.size}`)
  console.log(`duplicate-hash files   : ${dupFiles.length}`)
  for (const [status, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(20)} : ${count}`)
  }
  console.log(`drift: variant_junk    : ${variantJunk}`)
  console.log(`drift: variant_conflict: ${variantConflict}`)
  console.log(`drift: color           : ${colorDrift}`)
  console.log(`total missing purchase units : ${totalMissingPurchase}`)
  console.log(`total stock delta (sum)      : ${totalStockDelta}`)

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const csvPath = path.resolve(process.cwd(), `reconcile_${stamp}.csv`)
  const txtPath = path.resolve(process.cwd(), `reconcile_${stamp}.txt`)

  fs.writeFileSync(csvPath, [CSV_HEADER, ...findings.map(rowToCsv)].join('\n'), 'utf8')

  const txtLines: string[] = []
  txtLines.push(`RECONCILE ${stamp}`)
  txtLines.push(`Folder: ${folder}`)
  txtLines.push(`Files scanned: ${files.length} (duplicates skipped: ${dupFiles.length})`)
  txtLines.push(`Items in DB: ${dbItems.length}`)
  txtLines.push('')
  txtLines.push('SUMMARY')
  for (const [status, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    txtLines.push(`  ${status.padEnd(20)} : ${count}`)
  }
  txtLines.push(`  variant_junk drift   : ${variantJunk}`)
  txtLines.push(`  variant_conflict     : ${variantConflict}`)
  txtLines.push(`  color drift          : ${colorDrift}`)
  txtLines.push('')
  txtLines.push('DETAIL')
  txtLines.push('')
  for (const f of findings) {
    txtLines.push(rowToTxt(f))
    txtLines.push('')
  }
  fs.writeFileSync(txtPath, txtLines.join('\n'), 'utf8')

  console.log('')
  console.log(`Wrote ${csvPath}`)
  console.log(`Wrote ${txtPath}`)
}

main().catch((e) => {
  console.error('reconcile failed:', e)
  process.exit(1)
})