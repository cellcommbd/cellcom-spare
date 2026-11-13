// scripts/proof.ts
//
// Proof harness for lib/csv-parser.ts (v36.0).
// Runs a corpus of raw descriptions through parseCSV() and prints a table so
// you can see, per row: generated SKU, warnings, status, and whether the SKU
// exists in `items` today.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/proof.ts [corpus.txt]
//
// corpus.txt: one raw description per line. If omitted, uses scripts/corpus.txt.
// Blank lines and lines starting with '#' are ignored.

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config() // also load .env if present (does not override existing)
import fs from 'node:fs'
import path from 'node:path'
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
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY (or NEXT_PUBLIC_* equivalents).')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const ALIAS_TABLES = [
  'brand_aliases',
  'part_type_aliases',
  'parser_color_aliases',
  'flag_aliases',
  'quality_aliases',
  'variant_aliases',
  'typo_rules',
] as const

async function loadAliases() {
  const [brand, part, color, flag, quality, variant, typo] = await Promise.all(
    ALIAS_TABLES.map(async (t) => {
      const { data, error } = await supabase.from(t).select('*')
      if (error) throw new Error(`${t}: ${error.message}`)
      return data ?? []
    })
  )

  const toMap = (rows: any[], k: string, v: string) => {
    const out: Record<string, string> = {}
    for (const r of rows) {
      const key = String(r[k] ?? '').trim().toUpperCase()
      const val = String(r[v] ?? '').trim()
      if (key && val) out[key] = val
    }
    return out
  }

  const brandAliases = toMap(brand, 'csv_code', 'brand_code')
  const partAliases = toMap(part, 'csv_text', 'part_code')
  const colorAliases = toMap(color, 'csv_text', 'color_value')
  const flagAliases = toMap(flag, 'source_text', 'target_flag')
  const qualityAliases = toMap(quality, 'source_text', 'target_quality')
  const variantAliases = toMap(variant, 'source_text', 'target_variant')

  const typoRules = typo.map((r: any) => ({
    pattern: r.pattern,
    replacement: r.replacement,
    match_type: r.match_type,
    priority: r.priority ?? 100,
  }))

  setDBMessages({
    brandAliases,
    partAliases,
    colorAliases,
    flagAliases,
    qualityAliases,
    variantAliases,
    typoRules,
  })

  const aliasMaps: AliasMaps = {
    brandAliases,
    partAliases,
    colorAliases,
  }
  return aliasMaps
}

async function loadItems() {
  const { data, error } = await supabase
    .from('items')
    .select('item_id, sku, brand_id, model_id, part_id, quality')
    .limit(20000)
  if (error) throw new Error(`items: ${error.message}`)
  return (data ?? []).map((r: any) => ({
    item_id: r.item_id,
    sku: r.sku,
    brand_id: r.brand_id,
    model_id: r.model_id,
    part_id: r.part_id,
    quality: r.quality,
  }))
}

function readCorpus(customPath?: string): string[] {
  const p = customPath
    ? path.isAbsolute(customPath)
      ? customPath
      : path.resolve(process.cwd(), customPath)
    : path.resolve(process.cwd(), 'scripts/corpus.txt')

  if (!fs.existsSync(p)) {
    throw new Error(`Corpus file not found: ${p}`)
  }

  const raw = fs.readFileSync(p, 'utf8')
  const ext = path.extname(p).toLowerCase()

  if (ext === '.csv') {
    // Minimal CSV parse: split into rows, respect quoted fields, pull the
    // `description` column (or first column if no header match).
    const rows: string[][] = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      const fields: string[] = []
      let cur = ''
      let inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
          else inQ = !inQ
        } else if (ch === ',' && !inQ) {
          fields.push(cur); cur = ''
        } else cur += ch
      }
      fields.push(cur)
      rows.push(fields.map((f) => f.trim()))
    }
    if (rows.length === 0) return []
    const header = rows[0].map((h) => h.toLowerCase())
    let col = header.findIndex((h) => h === 'description')
    if (col === -1) col = header.findIndex((h) => h.includes('description'))
    if (col === -1) col = 0 // fall back to first column
    return rows
      .slice(1)
      .map((r) => (r[col] ?? '').trim())
      .filter((d) => d.length > 0 && !d.toLowerCase().includes('total'))
  }

  // .txt: one description per line
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

function buildCsv(descriptions: string[]): string {
  // Escape quotes per CSV rules
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
  const lines = ['description,quantity,price']
  for (const d of descriptions) lines.push(`${esc(d)},1,1`)
  return lines.join('\n')
}

type RowOut = {
  input: string
  sku: string | null
  warnings: string[]
  status: ParsedRow['status']
  error: string | undefined
  dbMatch: boolean
}

async function main() {
  const corpusArg = process.argv[2]
  const descriptions = readCorpus(corpusArg)
  if (descriptions.length === 0) {
    throw new Error('Corpus is empty.')
  }
  console.log(`Corpus: ${descriptions.length} rows from ${corpusArg ?? 'scripts/corpus.txt'}`)

  const aliases = await loadAliases()
  if (!hasDBMessages()) throw new Error('setDBMessages failed')
  const items = await loadItems()
  console.log(`Loaded ${items.length} items for matching`)

  const csv = buildCsv(descriptions)
  const parsed = parseCSV(csv, aliases, items)

  const dbSkus = new Set(items.map((i) => i.sku.toUpperCase()))
  const byInput = new Map<string, string[]>()
  for (const r of parsed) {
    const key = r.rawDescription.toUpperCase()
    if (!byInput.has(key)) byInput.set(key, [])
    byInput.get(key)!.push(r.generatedSku ?? '(none)')
  }

  const outputs: RowOut[] = parsed.map((r) => ({
    input: r.rawDescription,
    sku: r.generatedSku,
    warnings: r.warnings,
    status: r.status,
    error: r.errorMessage,
    dbMatch: r.generatedSku ? dbSkus.has(r.generatedSku.toUpperCase()) : false,
  }))

  // Print table — column widths tuned for readability, truncation is fine since
  // the summary below carries the counts that matter most.
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n - 1) + '…' : s.padEnd(n))
  console.log('')
  console.log(
    pad('INPUT', 42) + ' ' +
    pad('SKU', 38) + ' ' +
    pad('STATUS', 17) + ' ' +
    pad('DB', 3) + ' ' +
    'WARNINGS'
  )
  console.log('-'.repeat(140))
  for (const o of outputs) {
    console.log(
      pad(o.input, 42) + ' ' +
      pad(o.sku ?? '(none)', 38) + ' ' +
      pad(o.status + (o.error ? `:${o.error}` : ''), 17) + ' ' +
      pad(o.dbMatch ? 'yes' : 'no', 3) + ' ' +
      (o.warnings.length > 0 ? o.warnings.join('; ') : '')
    )
  }

  // Summary
  const counts = {
    matched: 0,
    new: 0,
    needs_correction: 0,
    withWarnings: 0,
    noSku: 0,
    dbHit: 0,
  }
  const errorReasons: Record<string, number> = {}
  for (const o of outputs) {
    ;(counts as Record<string, number>)[o.status]++
    if (o.warnings.length > 0) counts.withWarnings++
    if (!o.sku) counts.noSku++
    if (o.dbMatch) counts.dbHit++
    if (o.error) errorReasons[o.error] = (errorReasons[o.error] ?? 0) + 1
  }

  console.log('')
  console.log('SUMMARY')
  console.log(`  total           : ${outputs.length}`)
  console.log(`  matched (in DB) : ${counts.matched}`)
  console.log(`  new (not in DB) : ${counts.new}`)
  console.log(`  needs_correction: ${counts.needs_correction}`)
  console.log(`  with warnings   : ${counts.withWarnings}`)
  console.log(`  no SKU          : ${counts.noSku}`)
  console.log(`  DB SKU hit      : ${counts.dbHit}`)
  if (Object.keys(errorReasons).length > 0) {
    console.log('  correction reasons:')
    for (const [reason, n] of Object.entries(errorReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${reason}: ${n}`)
    }
  }

  // Duplicate inputs (same description → two different SKUs)
  const conflicts: { input: string; skus: string[] }[] = []
  for (const [input, skus] of byInput.entries()) {
    const uniq = Array.from(new Set(skus))
    if (uniq.length > 1) conflicts.push({ input, skus: uniq })
  }
  if (conflicts.length > 0) {
    console.log('')
    console.log(`DUPLICATE INPUTS WITH DIVERGENT SKUs (${conflicts.length})`)
    for (const c of conflicts) {
      console.log(`  "${c.input}" → ${c.skus.join(' | ')}`)
    }
  }

  const exitOk = counts.needs_correction === 0 || counts.needs_correction < outputs.length
  process.exit(exitOk ? 0 : 2)
}

main().catch((e) => {
  console.error('proof harness failed:', e)
  process.exit(1)
})