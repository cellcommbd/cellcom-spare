// lib/csv-parser.ts
// v6 — Canonical identity parser
//
// Every row reduces to 8 canonical fields:
//   brand, model, variant, year, part, network, quality, flag, color
//
// SKU = BRAND-MODEL-[VARIANT]-[YEAR]-PART-[NETWORK]-[QUALITY]-[FLAG]-[COLOR]
//
// Same physical item produces the same SKU regardless of source format.

export type Quality = 'Normal' | 'OG' | '100 OG' | 'ORG' | 'Care OG'

export type ParsedRow = {
  rowNumber: number
  rawDescription: string
  rawType: string
  qty: number
  rate: number

  // Canonical identity fields
  brandCode: string | null
  modelName: string | null
  network: string | null
  year: string | null
  variant: string | null
  partCode: string | null
  quality: Quality
  flag: string | null
  color: string | null

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

// ============================================================
// Part code normalizer — Real Gold and other supplier codes → canonical
// ============================================================
const PART_CODE_MAP: Record<string, string> = {
  // Canonical / common
  BP: 'BP',
  'BACK PANEL': 'BP',
  'BACK COVER': 'BP',
  BK: 'BP',
  'BACK PANEL WITH LENS': 'BP',
  'BACK PANEL WL': 'BP',

  FH: 'FH',
  'FULL HOUSING': 'FH',

  MF: 'MF',
  'MIDDLE FRAME': 'MF',
  MD: 'MF',
  MIDDLE: 'MF',

  MFF: 'MFF',
  'MIDDLE FRAME WITH FLEX': 'MFF',

  LCD: 'LCD',
  'LCD FLEX': 'LCD',

  LCDCON: 'LCDCON',
  'LCD CONNECTOR': 'LCDCON',
  'LCD CONN': 'LCDCON',
  'LCD CONN.': 'LCDCON',

  BATCON: 'BATCON',
  'BATTERY CONNECTOR': 'BATCON',
  'BATTERY CONN': 'BATCON',
  'BATTERY CONN.': 'BATCON',
  'B/C': 'BATCON',

  BOARDCONN: 'BOARDCONN',
  'BOARD CONN': 'BOARDCONN',
  'BOARD CONN.': 'BOARDCONN',

  SENSORCONN: 'SENSORCONN',
  'SENSOR CONN': 'SENSORCONN',
  'ON OFF SENSOR CONN': 'SENSORCONN',

  ONOFF: 'ONOFF',
  'ON OFF FLEX': 'ONOFF',
  'ON OFF SWITCH': 'ONOFF',

  VOL: 'VOL',
  'VOL FLEX': 'VOL',
  'VOLUME FLEX': 'VOL',

  CCFLEX: 'CCFLEX',
  'CC FLEX': 'CCFLEX',
  'CHARGING FLEX': 'CCFLEX',

  RB: 'RB',
  'RINGER BOX': 'RB',
  RINGER: 'RB',

  SPK: 'SPK',
  SPEAKER: 'SPK',

  SPKJ: 'SPKJ',
  'SPEAKER JALI': 'SPKJ',
  'SPEAKER FLEX': 'SPKJ',
  'SPK FLEX': 'SPKJ',

  CG: 'CG',
  'CAMERA GLASS': 'CG',

  CL: 'CL',
  'CAMERA LENS': 'CL',

  CAM: 'CAM',
  CAMERA: 'CAM',

  SIMTRAY: 'SIMTRAY',
  'SIM TRAY': 'SIMTRAY',
  'SIM TRY': 'SIMTRAY',
  'OUT SIM TRY': 'SIMTRAY',
  'OUT SIM TRAY': 'SIMTRAY',

  GASKIT: 'GASKIT',
  'GAS KIT': 'GASKIT',
  'GAS KIT FRONT': 'GASKIT',
  'GAS KIT BACK': 'GASKIT',

  OUTKEY: 'OUTKEY',
  'OUT KEY': 'OUTKEY',

  MIC: 'MIC',
  'CHINA MIC': 'MIC',

  VIB: 'VIB',
  VIBRATOR: 'VIB',

  ANT: 'ANT',
  ANTENNA: 'ANT',

  CHG: 'CHG',
}

// ============================================================
// Flag map — markers that become SKU segments
// ============================================================
const FLAG_MAP: Record<string, string> = {
  WL: 'WL',
  'W/L': 'WL',
  'WITH LENS': 'WL',
  'WITH LOGO': 'WL',
  FLEX: 'FLEX',
  'ON OFF': 'ONOFF',
  ONOFF: 'ONOFF',
  SET: 'SET',
  FRONT: 'FRONT',
  BACK: 'BACK',
  ONLY: 'ONLY',
  'W/C': 'WC',
  WC: 'WC',
  'W/CL': 'WCL',
  WCL: 'WCL',
}

// ============================================================
// Part type phrases — for extracting part from description
// Ordered longest-first
// ============================================================
const PART_TYPE_PHRASES: string[] = [
  'MIDDLE FRAME WITH FLEX',
  'ON OFF SENSOR CONN',
  'BATTERY CONNECTOR',
  'BATTERY CONN.',
  'BATTERY CONN',
  'BOARD CONN.',
  'BOARD CONN',
  'LCD CONNECTOR',
  'LCD CONN.',
  'LCD CONN',
  'ON OFF SWITCH',
  'ON OFF FLEX',
  'OUT SIM TRAY',
  'OUT SIM TRY',
  'SIM TRAY',
  'SIM TRY',
  'SPEAKER JALI',
  'SPEAKER FLEX',
  'SPK FLEX',
  'SPEAKER',
  'CAMERA GLASS',
  'CAMERA LENS',
  'CAMERA FLEX',
  'CHARGING FLEX',
  'CC FLEX',
  'MIDDLE FRAME',
  'BACK GLASS',
  'BACK PANEL',
  'BACK PANLE',
  'BACK PANAL',
  'BACK PANNEL',
  'BACKPANEL',
  'BACK COVER',
  'FULL HOUSING',
  'LCD FLEX',
  'RINGER BOX',
  'RINGER',
  'VOLUME FLEX',
  'VOL FLEX',
  'GAS KIT',
  'OUT KEY',
  'VIBRATOR',
  'ANTENNA',
  'B/C',
  'MIC',
  'BP',
  'FH',
  'MF',
  'MD',
  'BK',
  'LCD',
  'RB',
  'SPK',
]

// ============================================================
// CSV splitter
// ============================================================
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

function findColumnIndex(headers: string[], candidates: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().replace(/[^a-z]/g, '')
    for (const c of candidates) {
      if (h === c) return i
    }
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().replace(/[^a-z]/g, '')
    for (const c of candidates) {
      if (h.includes(c)) return i
    }
  }
  return -1
}

// ============================================================
// Typo normalization
// ============================================================
function normalizeTypos(desc: string): string {
  return desc
    .replace(/\bPANLE\b/gi, 'PANEL')
    .replace(/\bPANAL\b/gi, 'PANEL')
    .replace(/\bPANNEL\b/gi, 'PANEL')
    .replace(/\bBORD\b/gi, 'BOARD')
    .replace(/\bOUT\s+SIM\s+TRY\b/gi, 'OUT SIM TRAY')
    .replace(/\bSIM\s+TRY\b/gi, 'SIM TRAY')
    .replace(/\bHOUSIG\b/gi, 'HOUSING')
}

// ============================================================
// Step 1 — extract markers
// Returns variants, year, network, quality markers, and flags
// ============================================================
function extractMarkers(desc: string): {
  markers: string[]         // everything found in {} or []
  cleanedDesc: string
} {
  const markers: string[] = []
  const re = /[\[{]([^\]}]+)[\]}]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(desc)) !== null) {
    markers.push(m[1].trim())
  }

  const cleanedDesc = desc.replace(/[\[{][^\]}]*[\]}]/g, ' ').replace(/\s+/g, ' ').trim()
  return { markers, cleanedDesc }
}

// ============================================================
// Step 2 — extract color from (COLOR)
// ============================================================
function extractColor(desc: string): {
  color: string | null
  cleanedDesc: string
} {
  const colorPatterns = [
    /\(([^)]+)\)/g,
  ]
  const foundColors: string[] = []
  let cleaned = desc

  // Extract parenthesized content that looks like a color name
  for (const re of colorPatterns) {
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(desc)) !== null) {
      const content = m[1].trim()
      // A color if: contains letters, no digits, not a known non-color
      if (
        content.length > 2 &&
        /[A-Z]/i.test(content) &&
        !/^[0-9]/.test(content) &&
        !/(OG|CARE|100%|MAIN|OCTA|FLEX|SET)$/i.test(content.trim())
      ) {
        foundColors.push(content)
      }
    }
  }

  // Remove all parenthesized blocks after extraction
  cleaned = cleaned.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()

  return { color: foundColors[0] || null, cleanedDesc: cleaned }
}

// ============================================================
// Step 3 — extract quality from markers
// ============================================================
function extractQualityFromMarkers(markers: string[]): {
  quality: Quality
  remainingMarkers: string[]
} {
  let quality: Quality = 'Normal'
  const remaining: string[] = []

  for (const m of markers) {
    const upper = m.toUpperCase()
    if (/\b100\s*%?\s*OG\b/.test(upper)) {
      quality = '100 OG'
    } else if (/\bCARE\s*OG\b/.test(upper) || upper === 'CARE') {
      quality = 'Care OG'
    } else if (upper === 'ORG') {
      quality = 'ORG'
    } else if (upper === 'OG') {
      if (quality === 'Normal') quality = 'OG'
    } else {
      remaining.push(m)
    }
  }

  return { quality, remainingMarkers: remaining }
}

// ============================================================
// Step 4 — classify remaining markers into variant / network / year / flag
// ============================================================
function classifyMarkers(markers: string[]): {
  variant: string | null
  year: string | null
  network: string | null
  flag: string | null
} {
  let variant: string | null = null
  let year: string | null = null
  let network: string | null = null
  let flag: string | null = null

  for (const m of markers) {
    const upper = m.toUpperCase().trim()

    // Network
    if (/^(4G|5G)$/i.test(upper)) {
      network = upper
      continue
    }

    // Year (4-digit)
    if (/^(19|20)\d{2}$/.test(upper)) {
      year = upper
      continue
    }

    // Flags
    if (FLAG_MAP[upper]) {
      flag = FLAG_MAP[upper]
      continue
    }

    // Variant (MAIN, OCTA, NEW, DAMD., etc.)
    if (/^(MAIN|OCTA|NEW|DAMD\.?|SPARK|DISPLAY|FOR|5G|4G)$/i.test(upper)) {
      variant = upper.replace(/\.$/, '')
      continue
    }

    // Fallback: anything else is variant
    if (!variant) {
      variant = upper
    }
  }

  return { variant, year, network, flag }
}

// ============================================================
// Step 5 — extract part type
// ============================================================
function extractPartFromDescription(desc: string): {
  partText: string | null
  cleanedDesc: string
} {
  const upper = desc.toUpperCase()
  for (const phrase of PART_TYPE_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, 'i')
    if (re.test(upper)) {
      const cleaned = desc
        .replace(new RegExp(escaped, 'gi'), ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return { partText: phrase, cleanedDesc: cleaned }
    }
  }
  return { partText: null, cleanedDesc: desc }
}

// ============================================================
// Normalize part code
// ============================================================
function normalizePartCode(raw: string | null): string | null {
  if (!raw) return null
  const upper = raw.toUpperCase().trim().replace(/\.$/, '')
  return PART_CODE_MAP[upper] || upper
}

// ============================================================
// Step 6 — extract brand + model from the remainder
// ============================================================
function extractBrandAndModel(
  desc: string,
  aliases: AliasMaps
): {
  brandCode: string | null
  modelName: string | null
  network: string | null
} {
  let cleaned = desc.toUpperCase().trim()
  const network = (() => {
    const m = cleaned.match(/\b(4G|5G)\b/)
    return m ? m[1] : null
  })()

  // Split 1+6 → 1+ 6
  cleaned = cleaned.replace(/(1\+)([A-Z0-9])/g, '$1 $2')

  let noNet = cleaned.replace(/\((4G|5G)\)/gi, ' ')
  noNet = noNet.replace(/\b(4G|5G)\b/gi, ' ')
  noNet = noNet.replace(/[-_/]/g, ' ')

  const words = noNet.split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return { brandCode: null, modelName: null, network }
  }

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
    const k = c.key.toUpperCase()
    if (aliases.brandAliases[k]) {
      brandCode = aliases.brandAliases[k]
      matchedWords = c.take
      break
    }
  }

  if (!brandCode) {
    return { brandCode: null, modelName: null, network }
  }

  let modelWords = words.slice(matchedWords)

  // If the model starts with ANOTHER brand name, that brand wins.
  // Example: "OPPO REALME 9i" → brand = RM, model = "9i"
  // Example: "OPPO A54" → brand = OP, model = "A54" (A54 not a brand)
  while (modelWords.length > 0) {
    const nextWord = modelWords[0].toUpperCase()
    const nextBrand = aliases.brandAliases[nextWord]
    if (nextBrand && nextBrand !== brandCode) {
      brandCode = nextBrand
      modelWords = modelWords.slice(1)
    } else {
      break
    }
  }

  return {
    brandCode,
    modelName: modelWords.join(' ') || null,
    network,
  }
}
// ============================================================
// Model normalizer — clean whitespace, uppercase, remove null tokens
// ============================================================
function normalizeModelName(model: string | null): string | null {
  if (!model) return null
  const cleaned = model
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9\s]/g, '')
    .trim()
  return cleaned || null
}

// ============================================================
// SKU generator — BRAND-MODEL-[VARIANT]-[YEAR]-PART-[NETWORK]-[QUALITY]-[FLAG]-[COLOR]
// ============================================================
export function generateSku(fields: {
  brandCode: string | null
  modelName: string | null
  variant: string | null
  year: string | null
  partCode: string | null
  network: string | null
  quality: Quality
  flag: string | null
  color: string | null
}): string | null {
  const {
    brandCode,
    modelName,
    variant,
    year,
    partCode,
    network,
    quality,
    flag,
    color,
  } = fields

  if (!brandCode || !modelName || !partCode) return null

  const dash = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

  const seg: string[] = []
  seg.push(brandCode)
  seg.push(dash(modelName))
  if (variant) seg.push(dash(variant))
  if (year) seg.push(year)
  seg.push(partCode)
  if (network) seg.push(network)
  if (quality === 'OG') seg.push('OG')
  else if (quality === '100 OG') seg.push('100OG')
  else if (quality === 'ORG') seg.push('ORG')
  else if (quality === 'Care OG') seg.push('CARE')
  if (flag) seg.push(dash(flag))
  if (color) seg.push(dash(color))

  return seg.filter(Boolean).join('-')
}

// ============================================================
// Main parse
// ============================================================
export function parseCSV(
  text: string,
  aliases: AliasMaps,
  items: ItemLookup[]
): ParsedRow[] {
  const lines = splitCSVLines(text)
  if (lines.length < 2) return []

  // Header detection
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
      'Could not find a header row with Description (or Brand), Quantity, and Rate/Price.'
    )
  }

  const colBrand = findColumnIndex(header, ['brand'])
  const colModel = findColumnIndex(header, ['model'])
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
  ])
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
    let year: string | null = null
    let variant: string | null = null
    let partCode: string | null = null
    let quality: Quality = 'Normal'
    let flag: string | null = null
    let color: string | null = null

    if (isNewFormat) {
      // Separate columns: Brand, Model, Part Type
      const brandRaw = (row[colBrand] || '').toUpperCase().trim()
      const modelRaw = (row[colModel] || '').trim()
      const partRaw = (row[colPart] || '').toUpperCase().trim()

      rawDescription = `${brandRaw} ${modelRaw}`
      rawType = partRaw

      network = (modelRaw.match(/\b(4G|5G)\b/i) || [null])[0]
      if (network) network = network.toUpperCase()

      brandCode = aliases.brandAliases[brandRaw] || brandRaw
      modelName = normalizeModelName(
        modelRaw.replace(/\(4G\)|\(5G\)/gi, '').trim()
      )
      partCode = aliases.partAliases[partRaw] || normalizePartCode(partRaw)
    } else {
      // Single description field — full pipeline
      rawDescription = colDesc >= 0 ? row[colDesc] || '' : ''
      rawType = colPart >= 0 ? (row[colPart] || '').toUpperCase().trim() : ''

      if (!rawDescription) continue

      const normalized = normalizeTypos(rawDescription)

      // Extract color FIRST (before markers are stripped)
      const colorRes = extractColor(normalized)
      color = colorRes.color
      let working = colorRes.cleanedDesc

      // Extract markers
      const markerRes = extractMarkers(working)
      working = markerRes.cleanedDesc

      // Split markers into quality vs. others
      const qRes = extractQualityFromMarkers(markerRes.markers)
      quality = qRes.quality

      // Classify remaining markers
      const cRes = classifyMarkers(qRes.remainingMarkers)
      variant = cRes.variant
      year = cRes.year
      if (cRes.network && !network) network = cRes.network
      flag = cRes.flag

      // Part type — prefer explicit column, else extract from description
      if (rawType) {
        partCode = aliases.partAliases[rawType] || normalizePartCode(rawType)
      }
      if (!partCode) {
        const extracted = extractPartFromDescription(working)
        if (extracted.partText) {
          rawType = extracted.partText
          partCode =
            aliases.partAliases[extracted.partText.toUpperCase()] ||
            normalizePartCode(extracted.partText)
          working = extracted.cleanedDesc
        }
      }

      // Clean any remaining supplier notes
      working = working.replace(/\s+/g, ' ').trim()

      // Brand + model
      const bm = extractBrandAndModel(working, aliases)
      brandCode = bm.brandCode
      modelName = normalizeModelName(bm.modelName)
      if (bm.network && !network) network = bm.network
    }

    // Fallback: no model but brand+part exist
    if (brandCode && !modelName && partCode) {
      modelName = 'UNKNOWN'
    }

    // Build SKU from canonical fields
    const sku = generateSku({
      brandCode,
      modelName,
      variant,
      year,
      partCode,
      network,
      quality,
      flag,
      color,
    })

    // Matching
    let matchedItemId: number | null = null
    let matchedItemSku: string | null = null
    let status: 'matched' | 'new' | 'error' = 'new'
    let errorMessage: string | undefined

    if (!brandCode) {
      status = 'error'
      errorMessage = `Unknown brand in: "${rawDescription}"`
    } else if (!modelName) {
      status = 'error'
      errorMessage = `No model. brand=${brandCode} raw="${rawDescription}"`
    } else if (!partCode) {
      status = 'error'
      errorMessage = `Unknown part. rawType="${rawType}" raw="${rawDescription}"`
    } else if (!sku) {
      status = 'error'
      errorMessage = `Could not build SKU for "${rawDescription}"`
    } else if (itemBySku[sku.toUpperCase()]) {
      const found = itemBySku[sku.toUpperCase()]
      matchedItemId = found.item_id
      matchedItemSku = found.sku
      status = 'matched'
    }

    result.push({
      rowNumber: i,
      rawDescription,
      rawType,
      qty,
      rate,
      brandCode,
      modelName,
      network,
      year,
      variant,
      partCode,
      quality,
      flag,
      color,
      generatedSku: sku,
      matchedItemId,
      matchedItemSku,
      status,
      errorMessage,
    })
  }

  const failed = result.filter((r) => r.status === 'error')
  if (failed.length > 0) {
    console.log(`\n===== PARSE FAILED ROWS (${failed.length}) =====`)
    for (const f of failed.slice(0, 20)) {
      console.log(`Row ${f.rowNumber}: "${f.rawDescription}"`)
      console.log(`   → ${f.errorMessage}`)
    }
    if (failed.length > 20) console.log(`   ... ${failed.length - 20} more`)
    console.log(`===== END =====\n`)
  }

  return result
}

// ============================================================
// Group parsed rows
// ============================================================
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