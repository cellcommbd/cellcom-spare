// lib/general-item-parser.ts
// Parser for general-item CSVs (tools, cleaning supplies, misc).
// Triggered when Type of Goods column contains category codes.
//
// SKU format: <CATEGORY>-<DESCRIPTION-WITH-DASHES>
// Categories supported: TOOL, CLEANING, OTHER, SPRAY
// Unknown or empty category → error (no guessing).

import type { ItemLookup } from './csv-parser'

export type GeneralCategory = 'TOOL' | 'CLEANING' | 'OTHER' | 'SPRAY'

export const GENERAL_CATEGORIES: Set<string> = new Set([
  'TOOL',
  'CLEANING',
  'OTHER',
  'SPRAY',
])

export type GeneralParsedRow = {
  rowNumber: number
  rawDescription: string
  rawType: string
  qty: number
  rate: number
  category_code: GeneralCategory | null
  generatedSku: string | null
  matchedItemId: number | null
  matchedItemSku: string | null
  status: 'matched' | 'new' | 'error'
  errorMessage?: string
  is_general_item: true
}

// ============================================================
// CSV helpers (duplicated from csv-parser.ts to keep that file
// untouched. Same shape/semantics.)
// ============================================================
function splitCSVLines(text: string): string[][] {
  const rows: string[][] = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    const fields: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        fields.push(cur)
        cur = ''
      } else cur += ch
    }
    fields.push(cur)
    rows.push(fields.map((f) => f.trim()))
  }
  return rows
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().replace(/[^a-z]/g, '')
    for (const c of candidates) if (h === c) return i
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().replace(/[^a-z]/g, '')
    for (const c of candidates) if (h.includes(c)) return i
  }
  return -1
}

// ============================================================
// SKU generation
// ============================================================
function dashify(s: string): string {
  return s
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function generateGeneralSku(
  categoryCode: string,
  description: string
): string | null {
  const cat = categoryCode.toUpperCase().trim()
  const desc = dashify(description)
  if (!cat || !desc) return null
  return `${cat}-${desc}`
}

// ============================================================
// Detection
// ============================================================

// Returns true if the CSV appears to be a general-items file.
// Heuristic: sample up to 10 data rows, count how many have a
// Type of Goods value matching a known category. If > 50% → general.
export function detectGeneralItemCSV(text: string): boolean {
  const lines = splitCSVLines(text)
  if (lines.length < 2) return false

  // Find header row
  let headerRowIndex = -1
  let header: string[] = []
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i]
    const qty = findColumnIndex(line, ['quantity', 'qty'])
    const rate = findColumnIndex(line, ['rate', 'price'])
    const desc = findColumnIndex(line, [
      'descriptionofgoods',
      'description',
      'item',
      'product',
      'itemname',
    ])
    const brand = findColumnIndex(line, ['brand'])
    if (qty !== -1 && rate !== -1 && (desc !== -1 || brand !== -1)) {
      headerRowIndex = i
      header = line
      break
    }
  }
  if (headerRowIndex === -1) return false

  const colPart = findColumnIndex(header, [
    'parttype',
    'typeofgoods',
    'type',
    'part',
  ])
  if (colPart === -1) return false

  let categoryHits = 0
  let sampled = 0
  for (let i = headerRowIndex + 1; i < lines.length && sampled < 10; i++) {
    const row = lines[i]
    if (!row || row.length === 0) continue
    const firstCell = (row[0] || '').toLowerCase().trim()
    if (firstCell.includes('total') || firstCell === '') continue

    const typeVal = (row[colPart] || '').toUpperCase().trim()
    if (!typeVal) continue
    sampled++
    if (GENERAL_CATEGORIES.has(typeVal)) categoryHits++
  }

  if (sampled === 0) return false
  return categoryHits / sampled > 0.5
}

// ============================================================
// Main parser
// ============================================================
export function parseGeneralCSV(
  text: string,
  items: ItemLookup[]
): GeneralParsedRow[] {
  const lines = splitCSVLines(text)
  if (lines.length < 2) return []

  // Find header
  let headerRowIndex = -1
  let header: string[] = []
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i]
    const qty = findColumnIndex(line, ['quantity', 'qty'])
    const rate = findColumnIndex(line, ['rate', 'price'])
    const desc = findColumnIndex(line, [
      'descriptionofgoods',
      'description',
      'item',
      'product',
      'itemname',
    ])
    const brand = findColumnIndex(line, ['brand'])
    if (qty !== -1 && rate !== -1 && (desc !== -1 || brand !== -1)) {
      headerRowIndex = i
      header = line
      break
    }
  }
  if (headerRowIndex === -1) {
    throw new Error(
      'Could not find a header row with Description, Quantity, and Rate/Price.'
    )
  }

  const colPart = findColumnIndex(header, [
    'parttype',
    'typeofgoods',
    'type',
    'part',
  ])
  const colDesc = findColumnIndex(header, [
    'descriptionofgoods',
    'description',
    'item',
    'product',
    'itemname',
  ])
  const colQty = findColumnIndex(header, ['quantity', 'qty'])
  const colRate = findColumnIndex(header, ['rate', 'price'])

  if (colDesc === -1) {
    throw new Error(
      'Could not find a Description column in general-items CSV.'
    )
  }
  if (colQty === -1 || colRate === -1) {
    throw new Error('Could not find Quantity or Rate column.')
  }

  // Build SKU → item map for matching
  const itemBySku: Record<string, ItemLookup> = {}
  for (const it of items) {
    itemBySku[it.sku.toUpperCase()] = it
  }

  const result: GeneralParsedRow[] = []

  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const row = lines[i]
    if (!row || row.length === 0) continue

    const firstCell = (row[0] || '').toLowerCase().trim()
    if (firstCell.includes('total') || firstCell === '') continue

    const rawDesc = (row[colDesc] || '').trim()
    const rawType = colPart >= 0 ? (row[colPart] || '').toUpperCase().trim() : ''
    const rawQtyCell = row[colQty] || ''
    const rawRateCell = row[colRate] || ''

    const qty = parseFloat(String(rawQtyCell).replace(/[^\d.-]/g, '')) || 0
    const rate = parseFloat(String(rawRateCell).replace(/[^\d.-]/g, '')) || 0

    let pendingError: string | null = null

    if (!rawDesc) {
      pendingError = 'Missing description'
    } else if (qty === 0) {
      pendingError = 'Missing qty'
    } else if (!rawType) {
      pendingError = 'Category required. Use: TOOL, CLEANING, OTHER, SPRAY'
    } else if (!GENERAL_CATEGORIES.has(rawType)) {
      pendingError = `Unknown category "${rawType}". Use: TOOL, CLEANING, OTHER, SPRAY`
    }

    const categoryCode: GeneralCategory | null = GENERAL_CATEGORIES.has(rawType)
      ? (rawType as GeneralCategory)
      : null

    let sku: string | null = null
    if (categoryCode && rawDesc) {
      sku = generateGeneralSku(categoryCode, rawDesc)
    }

    let matchedItemId: number | null = null
    let matchedItemSku: string | null = null
    let status: 'matched' | 'new' | 'error' = 'new'
    let errorMessage: string | undefined = pendingError || undefined

    if (!pendingError) {
      if (!sku) {
        status = 'error'
        errorMessage = 'Could not build SKU'
      } else if (itemBySku[sku.toUpperCase()]) {
        const found = itemBySku[sku.toUpperCase()]
        matchedItemId = found.item_id
        matchedItemSku = found.sku
        status = 'matched'
      } else {
        status = 'new'
      }
    } else {
      status = 'error'
    }

    result.push({
      rowNumber: i,
      rawDescription: rawDesc,
      rawType,
      qty,
      rate,
      category_code: categoryCode,
      generatedSku: sku,
      matchedItemId,
      matchedItemSku,
      status,
      errorMessage,
      is_general_item: true,
    })
  }

  // Flag duplicates within file (same SKU appearing more than once)
  const skuCounts: Record<string, number[]> = {}
  for (let i = 0; i < result.length; i++) {
    const r = result[i]
    if (!r.generatedSku) continue
    if (r.status === 'error' && !r.errorMessage?.startsWith('Duplicate SKU'))
      continue
    const key = r.generatedSku.toUpperCase()
    if (!skuCounts[key]) skuCounts[key] = []
    skuCounts[key].push(i)
  }
  for (const idxs of Object.values(skuCounts)) {
    if (idxs.length > 1) {
      for (const idx of idxs) {
        if (result[idx].status !== 'error') {
          result[idx] = {
            ...result[idx],
            status: 'error',
            errorMessage: 'Duplicate SKU — edit to fix',
          }
        }
      }
    }
  }

  return result
}