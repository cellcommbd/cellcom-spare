// lib/csv-parser.ts
// Parses CSV text from supplier quotations/invoices and generates SKUs.

export type Quality = 'Normal' | 'OG' | '100 OG' | 'ORG' | 'Care OG'

export type ParsedRow = {
  rowNumber: number
  rawDescription: string
  rawType: string
  qty: number
  rate: number
  brandCode: string | null
  modelName: string | null
  network: string | null
  partCode: string | null
  quality: Quality
  variant: string | null
  yearForSku: string | null
  generatedSku: string | null
  matchedItemId: number | null
  matchedItemSku: string | null
  status: 'matched' | 'new' | 'error'
  errorMessage?: string
}

export type AliasMaps = {
  brandAliases: Record<string, string>
  partAliases: Record<string, string>
}

export type ItemLookup = {
  item_id: number
  sku: string
  brand_id: number | null
  model_id: number | null
  part_id: number | null
  quality: string
  variant?: string | null
}

// ---------- Part type phrases ----------
// Order matters: LONGEST FIRST so "MIDDLE FRAME WITH FLEX" wins before "MIDDLE FRAME"
const PART_TYPE_PHRASES = [
  'MIDDLE FRAME WITH FLEX',
  'ONLY SPEAKER FLEX',
  'ONLY FLEX',
  'BATTERY CONNECTOR',
  'BATTERY CONN.',
  'BATTERY CONN',
  'SPEAKER JALI',
  'SPEAKER FLEX',
  'CAMERA GLASS',
  'CAMERA LENS',
  'CAMERA FLEX',
  'CHARGING FLEX',
  'LCD CONNECTOR',
  'LCD CONN.',
  'LCD CONN',
  'BOARD CONN.',
  'BOARD CONN',
  'MIDDLE FRAME',
  'BACK PANEL',
  'FULL HOUSING',
  'LCD FLEX',
  'ON OFF SWITCH',
  'ON OFF FLEX',
  'OUT SIM TRAY',
  'OUT SIM TRY',
  'SIM TRAY',
  'SIM TRY',
  'RINGER BOX',
  'VOLUME FLEX',
  'VOL FLEX',
  'SPEAKER',
  'VIBRATOR',
  'ANTENNA',
  'B/C',
  'MIC',
]

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

// ---------- Header detection ----------
function findColumnIndex(headers: string[], candidates: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().replace(/[^a-z]/g, '')
    for (const c of candidates) {
      if (h.includes(c)) return i
    }
  }
  return -1
}

// ---------- Extract part type ----------
function extractPartFromDescription(desc: string): {
  partText: string | null
  cleanedDesc: string
} {
  const upper = desc.toUpperCase()
  for (const phrase of PART_TYPE_PHRASES) {
    if (upper.includes(phrase)) {
      const cleaned = desc
        .replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
        .replace(/\s+/g, ' ')
        .trim()
      return { partText: phrase, cleanedDesc: cleaned }
    }
  }
  return { partText: null, cleanedDesc: desc }
}

// ---------- Extract quality ----------
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

  if (/\bCARE\s*OG\b/i.test(upper)) {
    cleaned = cleaned.replace(/\bCARE\s*OG\b/gi, ' ')
    return { quality: 'Care OG', cleanedDesc: cleaned }
  }

  if (/\bORG\b/i.test(upper)) {
    cleaned = cleaned.replace(/\bORG\b/gi, ' ')
    return { quality: 'ORG', cleanedDesc: cleaned }
  }

  if (/\bCHINA\s*OG\b/i.test(upper)) {
    cleaned = cleaned.replace(/\bCHINA\s*OG\b/gi, ' ')
    return { quality: 'OG', cleanedDesc: cleaned }
  }

  if (/\bOG\b/i.test(upper)) {
    cleaned = cleaned.replace(/\bOG\b/gi, ' ')
    return { quality: 'OG', cleanedDesc: cleaned }
  }

  return { quality: 'Normal', cleanedDesc: cleaned }
}

// ---------- Extract variant (year / model version) ----------
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

// ---------- Clean leftover notes ----------
function cleanSupplierNotes(desc: string): string {
  let cleaned = desc
  cleaned = cleaned.replace(/\[[^\]]*\]/g, ' ')
  cleaned = cleaned.replace(/\([^)]*\)/g, ' ')
  cleaned = cleaned.replace(
    /\b(BOX\s*PACK(ING)?|BOX\s*PECKING|CHINA|100%|W\/C|W\/CL|WC|ORI|ORIG|METAL|SMALL|EXX\s*-?\s*BEE|EXXBEE)\b/gi,
    ' '
  )
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  return cleaned
}

// ---------- Extract network ----------
function extractNetwork(text: string): string | null {
  const m = text.match(/\b(4G|5G)\b/i)
  return m ? m[1].toUpperCase() : null
}

// ---------- Parse description to brand + model ----------
function parseDescriptionParts(
  description: string,
  aliases: AliasMaps
): {
  brandCode: string | null
  modelName: string | null
  network: string | null
} {
  const cleaned = description.toUpperCase().trim()

  const network = extractNetwork(cleaned)

  let noNet = cleaned.replace(/\((4G|5G)\)/gi, ' ')
  noNet = noNet.replace(/\b(4G|5G)\b/gi, ' ')
  noNet = noNet.replace(/[-_]/g, ' ')

  const words = noNet.split(/\s+/).filter(Boolean)
  if (words.length === 0) return { brandCode: null, modelName: null, network }

  // Try matching aliases in priority order:
  // 1. First three words joined (no separator) — e.g. "1 + NORD" -> "1+NORD" won't match, but try "1 +"
  // 2. First two words joined with space
  // 3. First two words joined without space
  // 4. First word
  let brandCode: string | null = null
  let matchedWords = 0

  const candidates: { key: string; take: number }[] = []

  if (words.length >= 3) {
    candidates.push({ key: words.slice(0, 3).join(' '), take: 3 })
    candidates.push({ key: words.slice(0, 3).join(''), take: 3 })
  }
  if (words.length >= 2) {
    candidates.push({ key: words.slice(0, 2).join(' '), take: 2 })
    candidates.push({ key: words.slice(0, 2).join(''), take: 2 })
  }
  candidates.push({ key: words[0], take: 1 })

  for (const c of candidates) {
    if (aliases.brandAliases[c.key]) {
      brandCode = aliases.brandAliases[c.key]
      matchedWords = c.take
      break
    }
  }

  if (!brandCode) {
    // No alias found — return null so the caller can flag an error
    return { brandCode: null, modelName: null, network }
  }

  const modelWords = words.slice(matchedWords)
  return { brandCode, modelName: modelWords.join(' ') || null, network }
}

// ---------- Generate SKU ----------
export function generateSku(
  brandCode: string | null,
  modelName: string | null,
  partCode: string | null,
  network: string | null,
  quality: Quality,
  yearForSku: string | null
): string | null {
  if (!brandCode || !modelName || !partCode) return null

  const modelPart = modelName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  const seg: string[] = [brandCode, modelPart]
  if (yearForSku) seg.push(yearForSku)
  seg.push(partCode)
  if (network) seg.push(network)
  if (quality === 'OG') seg.push('OG')
  if (quality === '100 OG') seg.push('100OG')
  if (quality === 'ORG') seg.push('ORG')
  if (quality === 'Care OG') seg.push('CARE')

  return seg.join('-')
}

// ---------- Main Parse ----------
export function parseCSV(
  text: string,
  aliases: AliasMaps,
  items: ItemLookup[]
): ParsedRow[] {
  const lines = splitCSVLines(text)
  if (lines.length < 2) return []

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
      'Could not find a header row with Brand (or Description), Quantity, and Rate columns.'
    )
  }

  const colBrand = findColumnIndex(header, ['brand'])
  const colModel = findColumnIndex(header, ['model'])
  const colPart = findColumnIndex(header, ['parttype'])
  const colDesc = findColumnIndex(header, [
    'descriptionofgoods',
    'description',
    'item',
    'product',
  ])
  const colType = findColumnIndex(header, ['typeofgoods'])
  const colQty = findColumnIndex(header, ['quantity', 'qty'])
  const colRate = findColumnIndex(header, ['rate', 'price'])

  const isNewFormat = colBrand !== -1 && colModel !== -1 && colPart !== -1

  const itemBySku: Record<string, ItemLookup> = {}
  for (const it of items) {
    itemBySku[it.sku.toUpperCase()] = it
  }

  const result: ParsedRow[] = []

  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const row = lines[i]
    if (!row || row.length === 0) continue

    const firstCell = (row[0] || '').toLowerCase().trim()
    if (firstCell.includes('total') || firstCell === '') continue

    const qtyStr = colQty >= 0 ? row[colQty] || '0' : '0'
    const rateStr = colRate >= 0 ? row[colRate] || '0' : '0'

    const qty = parseFloat(String(qtyStr).replace(/[^\d.-]/g, '')) || 0
    const rate = parseFloat(String(rateStr).replace(/[^\d.-]/g, '')) || 0

    if (qty <= 0) continue

    let rawDescription = ''
    let rawType = ''
    let brandCode: string | null = null
    let modelName: string | null = null
    let network: string | null = null
    let partCode: string | null = null
    let quality: Quality = 'Normal'
    let variant: string | null = null
    let yearForSku: string | null = null

    if (isNewFormat) {
      const brandRaw = (row[colBrand] || '').toUpperCase().trim()
      const modelRaw = (row[colModel] || '').trim()
      const partRaw = (row[colPart] || '').toUpperCase().trim()

      rawDescription = `${brandRaw} ${modelRaw}`
      rawType = partRaw

      network = extractNetwork(modelRaw)
      brandCode = aliases.brandAliases[brandRaw] || brandRaw
      modelName = modelRaw.replace(/\(4G\)|\(5G\)/gi, '').trim() || null
      partCode = aliases.partAliases[partRaw] || null
    } else {
      rawDescription = colDesc >= 0 ? row[colDesc] || '' : ''
      rawType = colType >= 0 ? row[colType] || '' : ''

      if (!rawDescription) continue

      const v = extractVariant(rawDescription)
      variant = v.variant
      yearForSku = v.yearForSku
      let working = v.cleanedDesc

      const q = extractQuality(working)
      quality = q.quality
      working = q.cleanedDesc

      if (rawType) {
        const typeUpper = rawType.toUpperCase().trim()
        partCode = aliases.partAliases[typeUpper] || null
      } else {
        const extracted = extractPartFromDescription(working)
        if (extracted.partText) {
          rawType = extracted.partText
          partCode =
            aliases.partAliases[extracted.partText.toUpperCase()] || null
          working = extracted.cleanedDesc
        }
      }

      working = cleanSupplierNotes(working)

      const parsed = parseDescriptionParts(working, aliases)
      brandCode = parsed.brandCode
      modelName = parsed.modelName
      network = parsed.network
    }

    // ---------- status determination ----------
    let matchedItemId: number | null = null
    let matchedItemSku: string | null = null
    let status: 'matched' | 'new' | 'error' = 'new'
    let errorMessage: string | undefined

    if (!brandCode) {
      status = 'error'
      errorMessage = `Unknown brand in: "${rawDescription}"`
    } else if (!modelName) {
      status = 'error'
      errorMessage = `Could not extract model from: "${rawDescription}"`
    } else if (!partCode) {
      status = 'error'
      errorMessage = `Unknown part type: "${rawType}"`
    } else {
      const sku = generateSku(
        brandCode,
        modelName,
        partCode,
        network,
        quality,
        yearForSku
      )
      if (sku && itemBySku[sku.toUpperCase()]) {
        const found = itemBySku[sku.toUpperCase()]
        matchedItemId = found.item_id
        matchedItemSku = found.sku
        status = 'matched'
      }
    }

    const finalSku =
      brandCode && modelName && partCode
        ? generateSku(
            brandCode,
            modelName,
            partCode,
            network,
            quality,
            yearForSku
          )
        : null

    result.push({
      rowNumber: i,
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
      generatedSku: finalSku,
      matchedItemId,
      matchedItemSku,
      status,
      errorMessage,
    })
  }

  return result
}

// ---------- Group Parsed Rows ----------
export function groupParsedRows(rows: ParsedRow[]): {
  matched: ParsedRow[]
  newItems: ParsedRow[]
  errors: ParsedRow[]
} {
  const matched: ParsedRow[] = []
  const newItems: ParsedRow[] = []
  const errors: ParsedRow[] = []

  for (const r of rows) {
    if (r.status === 'matched') matched.push(r)
    else if (r.status === 'new') newItems.push(r)
    else errors.push(r)
  }

  return { matched, newItems, errors }
}