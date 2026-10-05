// lib/csv-mapper.ts
// Thin wrapper around csv-parser's parseCSV.
// Manual column mapping produces a synthetic CSV in the parser's
// expected 6-column format, then defers to parseCSV for everything else.
//
// This eliminates the drift problem: all parsing logic lives in csv-parser.ts.

import { ParsedRow, AliasMaps, ItemLookup, parseCSV } from './csv-parser'

export type ColumnRole =
  | 'brand'
  | 'model'
  | 'part_type'
  | 'quantity'
  | 'rate'
  | 'description'
  | 'ignore'

export type DetectedColumn = {
  index: number
  header: string
  samples: string[]
  autoRole: ColumnRole
}

export type ColumnMapping = {
  [columnIndex: number]: ColumnRole
}

// ---------- CSV splitter ----------
export function splitCSVLines(text: string): string[][] {
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
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
    fields.push(cur)
    rows.push(fields.map((f) => f.trim()))
  }
  return rows
}

// ---------- Auto-guess role from header text ----------
function guessRole(header: string): ColumnRole {
  const h = header.toLowerCase().replace(/[^a-z]/g, '')

  if (h.includes('brand')) return 'brand'
  if (h.includes('model')) return 'model'
  if (h.includes('part') || h.includes('type')) return 'part_type'
  if (h.includes('quantity') || h.includes('qty')) return 'quantity'
  if (h.includes('rate') || h.includes('price')) return 'rate'
  if (h.includes('description') || h.includes('item') || h.includes('product'))
    return 'description'
  if (h.includes('amount') || h.includes('total')) return 'ignore'
  if (
    h.includes('sno') ||
    h.includes('srno') ||
    h.includes('hscode') ||
    h.includes('hssac') ||
    h.includes('unit') ||
    h.includes('per')
  )
    return 'ignore'

  return 'ignore'
}

// ---------- Detect columns from CSV text ----------
export function detectColumns(csvText: string): {
  columns: DetectedColumn[]
  dataRows: string[][]
  error?: string
} {
  const rows = splitCSVLines(csvText)
  if (rows.length < 1) {
    return { columns: [], dataRows: [], error: 'CSV is empty.' }
  }

  let headerIndex = -1
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i].length >= 3 && rows[i].some((c) => c.length > 0)) {
      headerIndex = i
      break
    }
  }
  if (headerIndex === -1) headerIndex = 0

  const header = rows[headerIndex]
  const dataRows = rows.slice(headerIndex + 1)

  const columns: DetectedColumn[] = header.map((h, i) => {
    const samples = dataRows
      .slice(0, 3)
      .map((r) => r[i] || '')
      .filter(Boolean)
    return {
      index: i,
      header: h || `Column ${i + 1}`,
      samples,
      autoRole: guessRole(h),
    }
  })

  return { columns, dataRows }
}

// ---------- Validate mapping ----------
export function validateMapping(mapping: ColumnMapping): {
  valid: boolean
  missing: ColumnRole[]
} {
  const used = Object.values(mapping)
  const hasDescription = used.includes('description')
  const hasBrand = used.includes('brand')
  const hasModel = used.includes('model')
  const hasPartType = used.includes('part_type')
  const hasQuantity = used.includes('quantity')
  const hasRate = used.includes('rate')

  const missing: ColumnRole[] = []

  if (!hasDescription && !hasBrand) missing.push('brand')
  if (!hasDescription && !hasModel) missing.push('model')
  if (!hasPartType && !hasDescription) missing.push('part_type')
  if (!hasQuantity) missing.push('quantity')
  if (!hasRate) missing.push('rate')

  return { valid: missing.length === 0, missing }
}

// ---------- Build synthetic CSV from user-mapped columns ----------
function buildSyntheticCsv(
  dataRows: string[][],
  mapping: ColumnMapping
): string {
  const roleToCol: Partial<Record<ColumnRole, number>> = {}
  for (const [colIdxStr, role] of Object.entries(mapping)) {
    if (role === 'ignore') continue
    roleToCol[role] = Number(colIdxStr)
  }

  const lines: string[] = ['Description of Goods,Type of Goods,Quality,Quantity,Price,Unit']

  for (const row of dataRows) {
    if (!row || row.length === 0) continue
    const firstCell = (row[0] || '').toLowerCase()
    if (firstCell.includes('total') || firstCell === '') continue

    const qtyStr =
      roleToCol.quantity !== undefined ? row[roleToCol.quantity] || '' : ''
    const rateStr =
      roleToCol.rate !== undefined ? row[roleToCol.rate] || '' : ''
    const qty = parseFloat(qtyStr.replace(/[^\d.-]/g, '')) || 0
    const rate = parseFloat(rateStr.replace(/[^\d.-]/g, '')) || 0
    if (qty <= 0) continue

    let desc = ''
    let rawPart = ''

    if (roleToCol.description !== undefined) {
      desc = (row[roleToCol.description] || '').trim()
      if (roleToCol.part_type !== undefined) {
        rawPart = (row[roleToCol.part_type] || '').trim()
      }
    } else {
      const brand = roleToCol.brand !== undefined ? (row[roleToCol.brand] || '').trim() : ''
      const model = roleToCol.model !== undefined ? (row[roleToCol.model] || '').trim() : ''
      const part = roleToCol.part_type !== undefined ? (row[roleToCol.part_type] || '').trim() : ''
      desc = `${brand} ${model}`.trim()
      rawPart = part
    }

    // Escape commas and quotes in the description
    const esc = (s: string) => {
      if (s.includes(',') || s.includes('"')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }

    lines.push(
      `${esc(desc)},${esc(rawPart)},,${qty},${rate},Pcs`
    )
  }

  return lines.join('\n')
}

// ---------- Main apply mapping ----------
export function applyMapping(
  csvText: string,
  mapping: ColumnMapping,
  aliases: AliasMaps,
  items: ItemLookup[]
): ParsedRow[] {
  const { columns, dataRows, error } = detectColumns(csvText)
  if (error || columns.length === 0) return []

  const synthetic = buildSyntheticCsv(dataRows, mapping)
  return parseCSV(synthetic, aliases, items)
}

// ---------- Default mapping from auto-guess ----------
export function buildDefaultMapping(columns: DetectedColumn[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const used: Record<ColumnRole, boolean> = {
    brand: false,
    model: false,
    part_type: false,
    quantity: false,
    rate: false,
    description: false,
    ignore: false,
  }

  for (const col of columns) {
    let role = col.autoRole
    if (role !== 'ignore' && used[role]) {
      role = 'ignore'
    }
    mapping[col.index] = role
    used[role] = true
  }

  return mapping
}