// lib/csv-mapper.ts
// Flexible CSV parser with user-defined column mapping.

import {
  ParsedRow,
  AliasMaps,
  ItemLookup,
  generateSku,
  Quality,
} from './csv-parser'

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

// ---------- CSV Splitter ----------
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

  // Find header row — scan first 15 rows for one with at least 3 non-empty columns
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

// ---------- Extract network from text ----------
function extractNetwork(text: string): string | null {
  const m = text.match(/\b(4G|5G)\b/i)
  return m ? m[1].toUpperCase() : null
}

// ---------- Parse description into brand + model ----------
function parseDescription(
  description: string,
  aliases: AliasMaps
): {
  brandCode: string | null
  modelName: string | null
  network: string | null
} {
  const cleaned = description.trim().toUpperCase()

  let network: string | null = null
  const networkMatch = cleaned.match(/\((4G|5G)\)/i)
  if (networkMatch) network = networkMatch[1].toUpperCase()

  let noNet = cleaned.replace(/\((4G|5G)\)/gi, ' ')
  noNet = noNet.replace(/\((\d{4})\)/g, ' $1 ')
  noNet = noNet.replace(/[()]/g, ' ')
  noNet = noNet.replace(/\+/g, ' PLUS ')

  const words = noNet.split(/\s+/).filter(Boolean)
  if (words.length === 0) return { brandCode: null, modelName: null, network }

  const firstWord = words[0]
  let brandCode: string | null = null

  if (aliases.brandAliases[firstWord]) {
    brandCode = aliases.brandAliases[firstWord]
  } else {
    const twoWord = words.slice(0, 2).join('')
    if (aliases.brandAliases[twoWord]) {
      brandCode = aliases.brandAliases[twoWord]
      words.splice(0, 2)
      return { brandCode, modelName: words.join(' ') || null, network }
    }
    brandCode = firstWord
  }

  const modelWords = words.slice(1)
  return { brandCode, modelName: modelWords.join(' ') || null, network }
}

// ---------- Part type phrases ----------
const PART_TYPE_PHRASES = [
  'MIDDLE FRAME WITH FLEX',
  'MIDDLE FRAME',
  'BACK PANEL',
  'FULL HOUSING',
  'LCD FLEX',
  'ON OFF FLEX',
  'VOL FLEX',
  'RINGER BOX',
  'CAMERA GLASS',
  'CHARGING FLEX',
  'SPEAKER JALI',
  'SPEAKER',
  'LCD CONNECTOR',
  'BATTERY CONNECTOR',
  'CAMERA LENS',
  'CAMERA FLEX',
  'SIM TRAY',
  'VIBRATOR',
  'ANTENNA',
  'MIC',
]

function extractPartFromDescription(desc: string): {
  partText: string | null
  cleanedDesc: string
} {
  const upper = desc.toUpperCase()
  for (const phrase of PART_TYPE_PHRASES) {
    if (upper.includes(phrase)) {
      const cleaned = desc
        .replace(new RegExp(phrase, 'gi'), '')
        .replace(/\s+/g, ' ')
        .trim()
      return { partText: phrase, cleanedDesc: cleaned }
    }
  }
  return { partText: null, cleanedDesc: desc }
}

// ---------- Extract quality from description ----------
function extractQuality(desc: string): {
  quality: Quality
  cleanedDesc: string
} {
  const upper = desc.toUpperCase()
  let cleaned = desc

  if (/\b100\s*%?\s*OG\b/i.test(upper)) {
    cleaned = cleaned.replace(/\b100\s*%?\s*OG\b/gi, ' ')
    return { quality: '100 OG', cleanedDesc: cleaned }
  }

  if (/\bCARE\s*OG\b/i.test(upper) || /\bCARE\b/i.test(upper)) {
    cleaned = cleaned.replace(/\bCARE\s*OG\b/gi, ' ')
    cleaned = cleaned.replace(/\bCARE\b/gi, ' ')
    return { quality: 'Care OG', cleanedDesc: cleaned }
  }

  if (/\bORG\b/i.test(upper)) {
    cleaned = cleaned.replace(/\bORG\b/gi, ' ')
    return { quality: 'ORG', cleanedDesc: cleaned }
  }

  if (/\bOG\b/i.test(upper) || /\bCHINA\s*OG\b/i.test(upper)) {
    cleaned = cleaned.replace(/\bCHINA\s*OG\b/gi, ' ')
    cleaned = cleaned.replace(/\bOG\b/gi, ' ')
    return { quality: 'OG', cleanedDesc: cleaned }
  }

  return { quality: 'Normal', cleanedDesc: cleaned }
}

// ---------- Extract variant (year-based) ----------
function extractVariant(desc: string): {
  variant: string | null
  yearForSku: string | null
  cleanedDesc: string
} {
  const notes: string[] = []
  const bracketRe = /\[([^\]]+)\]/g
  let m: RegExpExecArray | null
  while ((m = bracketRe.exec(desc)) !== null) {
    notes.push(m[1].trim())
  }

  let cleaned = desc.replace(/\[[^\]]*\]/g, ' ')

  let variant: string | null = null
  let yearForSku: string | null = null

  for (const note of notes) {
    const yearMatch = note.match(/\b(19|20)\d{2}\b/)
    if (yearMatch) {
      variant = note
      yearForSku = yearMatch[0]
      break
    }
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  return { variant, yearForSku, cleanedDesc: cleaned }
}

// ---------- Clean leftover supplier notes ----------
function cleanSupplierNotes(desc: string): string {
  let cleaned = desc
  cleaned = cleaned.replace(/\[[^\]]*\]/g, ' ')
  cleaned = cleaned.replace(/\([^)]*\)/g, ' ')
  cleaned = cleaned.replace(
    /\b(BOX\s*PACK(ING)?|BOX\s*PECKING|CHINA|100%|W\/C|W\/CL|WC)\b/gi,
    ' '
  )
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  return cleaned
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

  const itemBySku: Record<string, ItemLookup> = {}
  for (const it of items) {
    itemBySku[it.sku.toUpperCase()] = it
  }

  const roleToCol: Partial<Record<ColumnRole, number>> = {}
  for (const [colIdxStr, role] of Object.entries(mapping)) {
    if (role === 'ignore') continue
    roleToCol[role] = Number(colIdxStr)
  }

  const result: ParsedRow[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    if (!row || row.length === 0) continue

    const firstCell = (row[0] || '').toLowerCase()
    if (firstCell.includes('total') || firstCell === '') continue

    const qtyStr =
      roleToCol.quantity !== undefined ? row[roleToCol.quantity] || '0' : '0'
    const rateStr =
      roleToCol.rate !== undefined ? row[roleToCol.rate] || '0' : '0'

    const qty = parseFloat(qtyStr.replace(/[^\d.-]/g, '')) || 0
    const rate = parseFloat(rateStr.replace(/[^\d.-]/g, '')) || 0

    if (qty <= 0) continue

    let brandCode: string | null = null
    let modelName: string | null = null
    let network: string | null = null
    let partCode: string | null = null
    let quality: Quality = 'Normal'
    let variant: string | null = null
    let yearForSku: string | null = null
    let rawDescription = ''
    let rawType = ''

    if (roleToCol.description !== undefined) {
      // Description-based: extract everything from one column
      const desc = row[roleToCol.description] || ''
      rawDescription = desc

      // Extract variant FIRST (before other removals)
      const v = extractVariant(desc)
      variant = v.variant
      yearForSku = v.yearForSku
      let working = v.cleanedDesc

      // Extract quality
      const q = extractQuality(working)
      quality = q.quality
      working = q.cleanedDesc

      // Extract part type
      const extracted = extractPartFromDescription(working)
      if (extracted.partText) {
        rawType = extracted.partText
        partCode =
          aliases.partAliases[extracted.partText.toUpperCase()] || null
        working = extracted.cleanedDesc
      }

      // Clean remaining notes
      working = cleanSupplierNotes(working)

      const parsed = parseDescription(working, aliases)
      brandCode = parsed.brandCode
      modelName = parsed.modelName
      network = parsed.network
    } else {
      // Separate columns: Brand, Model, Part Type
      const brandRaw =
        roleToCol.brand !== undefined
          ? (row[roleToCol.brand] || '').toUpperCase().trim()
          : ''
      const modelRaw =
        roleToCol.model !== undefined ? (row[roleToCol.model] || '').trim() : ''
      const partRaw =
        roleToCol.part_type !== undefined
          ? (row[roleToCol.part_type] || '').toUpperCase().trim()
          : ''

      rawDescription = `${brandRaw} ${modelRaw}`.trim()
      rawType = partRaw

      network = extractNetwork(modelRaw)
      brandCode = aliases.brandAliases[brandRaw] || brandRaw || null
      modelName = modelRaw.replace(/\(4G\)|\(5G\)/gi, '').trim() || null
      partCode = aliases.partAliases[partRaw] || null
    }

    if (!brandCode || !modelName) continue

    const sku = generateSku(
      brandCode,
      modelName,
      partCode,
      network,
      quality,
      yearForSku
    )

    let matchedItemId: number | null = null
    let matchedItemSku: string | null = null
    let status: 'matched' | 'new' | 'error' = 'new'
    let errorMessage: string | undefined

    if (!partCode) {
      status = 'error'
      errorMessage = `Unknown part type: "${rawType}"`
    } else if (sku && itemBySku[sku.toUpperCase()]) {
      const found = itemBySku[sku.toUpperCase()]
      matchedItemId = found.item_id
      matchedItemSku = found.sku
      status = 'matched'
    }

    result.push({
      rowNumber: i + 1,
      rawDescription,
      rawType,
      qty,
      rate,
      brandCode,
      modelName,
      network,
      partCode,
      quality,
      variant,
      yearForSku,
      generatedSku: sku,
      matchedItemId,
      matchedItemSku,
      status,
      errorMessage,
    })
  }

  return result
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