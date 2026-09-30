// lib/csv-parser.ts
// v12 — Canonical identity parser with new SKU template
//
// SKU = BRAND - MODEL - PART - [YEAR] - [VARIANT] - [NETWORK] - [FLAG] - [COLOR] - [QUALITY]
//
// ─────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────
// 2026-09-29  DB: IPHONE- → IP- (70 items)
// 2026-09-29  DB: SENSOR [SIDE] → SENSORSIDE / LCD FLEX {MAIN} → LCDFLEXMAIN
//                 IN RUBBER → INRUBBER (41 items)
// 2026-09-29  Aliases: SPK family split; EXX-BEE → ESPK; ORI/ORIG → OG;
//                      CARE → Care OG; CHINA OG / C+ → China OG
// 2026-09-30  v12: SKU template reordered to
//                  BRAND-MODEL-PART-YEAR-VARIANT-NETWORK-FLAG-COLOR-QUALITY
//                  Box Pecking → BOX-PACKING (variant, not stripped)
//                  Colors captured from (...) and [...] markers
// ─────────────────────────────────────────────────────────────

export type Quality =
  | 'Normal'
  | 'OG'
  | '100 OG'
  | 'ORG'
  | 'Care OG'
  | 'China OG'

export type ParsedRow = {
  rowNumber: number
  rawDescription: string
  rawType: string
  qty: number
  rate: number
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
  validBrandCodes?: string[]
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
// Brand-code drift guard
// ============================================================
let warnedBrandCodes = new Set<string>()

function guardBrandCode(
  brandCode: string | null,
  validBrandCodes: string[] | undefined
): void {
  if (!brandCode) return
  if (!validBrandCodes || validBrandCodes.length === 0) return
  const upper = brandCode.toUpperCase()
  const valid = validBrandCodes.map((b) => b.toUpperCase())
  if (valid.includes(upper)) return
  if (warnedBrandCodes.has(upper)) return
  warnedBrandCodes.add(upper)
  console.warn(
    `[csv-parser] Brand code "${brandCode}" not in brands.brand_code. ` +
      `SKUs with this prefix will show as NEW on import.`
  )
}

export function resetBrandCodeWarnings(): void {
  warnedBrandCodes = new Set<string>()
}

// ============================================================
// Size markers — go into variant
// ============================================================
const SIZE_MARKERS: Record<string, string> = {
  '20MM': '20MM',
  '20 MM': '20MM',
  '15MM': '15MM',
  '15 MM': '15MM',
  '10MM': '10MM',
  '10 MM': '10MM',
  BIG: 'BIG',
  'BIG SIZE': 'BIGSIZE',
  BIGSIZE: 'BIGSIZE',
  SMALL: 'SMALL',
  'SMALL SIZE': 'SMALLSIZE',
  SMALLSIZE: 'SMALLSIZE',
  MEDIUM: 'MEDIUM',
  'MEDIUM SIZE': 'MEDIUMSIZE',
  MEDIUMSIZE: 'MEDIUMSIZE',
}

// ============================================================
// Variant keywords — go into variant
// ============================================================
const VARIANT_KEYWORDS = /^(MAIN|OCTA|NEW|DAMD\.?|SPARK|DISPLAY|FOR|MAINBOARD|MAIN BOARD)$/i

// ============================================================
// Packaging noise — normalized to BOX-PACKING (kept as variant)
// ============================================================
const PACKAGING_VARIANT = /^(BOX\s*PECK?ING|BOX\s*PACKING|BOXPACKING|BOXPECKING)$/i

// ============================================================
// Common color words — used for bracket color detection
// ============================================================
const COLOR_WORDS = [
  'BLACK', 'WHITE', 'BLUE', 'RED', 'GOLD', 'GREEN', 'PURPLE', 'SILVER',
  'GREY', 'GRAY', 'YELLOW', 'PINK', 'ORANGE', 'BROWN', 'BRONZE', 'BEIGE',
  'LAVENDER', 'LILAC', 'MINT', 'CORAL', 'RUBY', 'JADE', 'AQUA', 'CYAN',
  'TEAL', 'NAVY', 'PEACH', 'LATTE', 'SAPPHIRE', 'EMERALD', 'CRYSTAL',
  'ONYX', 'COPPER', 'CHAMPAGNE', 'IVORY', 'CREAM', 'SAND', 'GOLDEN',
  'ROSE', 'VIOLET', 'MAGENTA', 'TURQUOISE', 'INDIGO', 'MAROON',
  'BURGUNDY', 'BLUSH', 'NEON', 'CHROME', 'GRAPHITE', 'MATTE',
]

function containsColorWord(text: string): boolean {
  const upper = text.toUpperCase()
  return COLOR_WORDS.some((word) => {
    const re = new RegExp(`\\b${word}\\b`, 'i')
    return re.test(upper)
  })
}

// ============================================================
// Part code normalizer
// ============================================================
const PART_CODE_MAP: Record<string, string> = {
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
  LCDFLEXMAIN: 'LCDFLEXMAIN',
  'LCD FLEX MAIN': 'LCDFLEXMAIN',
  'LCD FLEX {MAIN}': 'LCDFLEXMAIN',
  LCDRING: 'LCDRING',
  'LCD RING': 'LCDRING',

  BATCON: 'BATCON',
  'BATTERY CONNECTOR': 'BATCON',
  'BATTERY CONN': 'BATCON',
  'BATTERY CONN.': 'BATCON',
  'B/C': 'BATCON',
  'B/C CONN': 'BATCON',
  'B/C CONN.': 'BATCON',
  BOARDCONN: 'BOARDCONN',
  'BOARD CONN': 'BOARDCONN',
  'BOARD CONN.': 'BOARDCONN',
  SENSORCONN: 'SENSORCONN',
  'SENSOR CONN': 'SENSORCONN',
  'SENSOR CONN.': 'SENSORCONN',
  'SENSOR CONNECTOR': 'SENSORCONN',
  'ON OFF SENSOR CONN': 'SENSORCONN',
  SENSORSIDE: 'SENSORSIDE',
  'SENSOR SIDE': 'SENSORSIDE',
  'SENSOR [SIDE]': 'SENSORSIDE',

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
  SPKF: 'SPKF',
  'SPEAKER FLEX': 'SPKF',
  'SPK FLEX': 'SPKF',
  'ONLY SPEAKER FLEX': 'SPKF',
  'SPK FLEX ONLY': 'SPKF',
  'SPK FLEX COPY': 'SPKF',
  SPKFL: 'SPKFL',
  'ONLY FLEX': 'SPKFL',
  'SPEAKER FLEX ONLY': 'SPKFL',
  'FLEX ONLY': 'SPKFL',
  SPKJ: 'SPKJ',
  'SPEAKER JALI': 'SPKJ',
  'SPEAKER/RINGER JALI': 'SPKJ',
  'RINGER JALI': 'SPKJ',

  ESPK: 'ESPK',
  'EXX-BEE': 'ESPK',
  'EXX BEE': 'ESPK',
  EXXBEE: 'ESPK',
  EARPIECE: 'ESPK',
  'EAR SPEAKER': 'ESPK',
  ESPKF: 'ESPKF',
  'EXX-BEE FLEX': 'ESPKF',
  'EARPIECE FLEX': 'ESPKF',
  ESPKFL: 'ESPKFL',
  'EXX-BEE ONLY FLEX': 'ESPKFL',
  'EARPIECE FLEX ONLY': 'ESPKFL',

  CG: 'CG',
  'CAMERA GLASS': 'CG',
  CL: 'CL',
  'CAMERA LENS': 'CL',
  CAM: 'CAM',
  CAMERA: 'CAM',

  ST: 'ST',
  SIMTRAY: 'ST',
  'SIM TRAY': 'ST',
  'SIM TRY': 'ST',
  'OUT SIM TRAY': 'ST',
  'OUT SIM TRY': 'ST',

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
  INRUBBER: 'INRUBBER',
  'IN RUBBER': 'INRUBBER',
  BACKGLASS: 'BACKGLASS',
  'BACK GLASS': 'BACKGLASS',
}

// ============================================================
// Flag map
// ============================================================
const FLAG_MAP: Record<string, string> = {
  WL: 'WL',
  'W/L': 'WL',
  'WITH LENS': 'WL',
  'WITH LOGO': 'WL',
  FLEX: 'FLEX',
  SET: 'SET',
  FRONT: 'FRONT',
  BACK: 'BACK',
  'W/C': 'WC',
  WC: 'WC',
  'W/CL': 'WCL',
  WCL: 'WCL',
  ONLY: 'ONLY',
  COPY: 'COPY',
  'EXX-BEE': 'EXXBEE',
}

// ============================================================
// Part type phrases — longest-first
// ============================================================
const PART_TYPE_PHRASES: string[] = [
  'MIDDLE FRAME WITH FLEX',
  'ON OFF SENSOR CONN',
  'ONLY EARPIECE FLEX',
  'EARPIECE FLEX ONLY',
  'ONLY SPEAKER FLEX',
  'SPEAKER FLEX ONLY',
  'SPK FLEX COPY',
  'SPK FLEX ONLY',
  'SPEAKER/RINGER JALI',
  'RINGER JALI',
  'BATTERY CONNECTOR',
  'BATTERY CONN.',
  'BATTERY CONN',
  'B/C CONN.',
  'B/C CONN',
  'BOARD CONN.',
  'BOARD CONN',
  'LCD CONNECTOR',
  'LCD CONN.',
  'LCD CONN',
  'LCD RING',
  'ON OFF SWITCH',
  'ON OFF FLEX',
  'ONLY FLEX',
  'FLEX ONLY',
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
    for (const c of candidates) if (h === c) return i
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().replace(/[^a-z]/g, '')
    for (const c of candidates) if (h.includes(c)) return i
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
    .replace(/\bSAMRT\b/gi, 'SMART')
    .replace(/\bEXX\s*-\s*BEE\b/gi, 'EXX-BEE')
    .replace(/\bEXX\s+BEE\b/gi, 'EXX-BEE')
    .replace(/\bEXXBEE\b/gi, 'EXX-BEE')
    .replace(/\bB\s*\/\s*C\b/gi, 'B/C')
    .replace(/\bB\s*\/\s*C\s+CONN\.?/gi, 'B/C CONN')
    .replace(/([A-Z])B\/C\b/gi, '$1 B/C')
    .replace(/BOX\s*PECKING/gi, 'BOX PACKING')
    .replace(/\s+/g, ' ')
    .trim()
}

// ============================================================
// Markers
// ============================================================
function extractMarkers(desc: string): { markers: string[]; cleanedDesc: string } {
  const markers: string[] = []
  const re = /[\[{]([^\]}]+)[\]}]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(desc)) !== null) markers.push(m[1].trim())
  const cleanedDesc = desc
    .replace(/[\[{][^\]}]*[\]}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { markers, cleanedDesc }
}

// ============================================================
// Parenthetical extraction
// ============================================================
type ParentheticalResult = {
  colors: string[]
  network: string | null
  quality: Quality | null
  flag: string | null
  size: string | null
  variant: string | null
  cleanedDesc: string
}

function extractParentheticals(desc: string): ParentheticalResult {
  const colors: string[] = []
  let network: string | null = null
  let quality: Quality | null = null
  let flag: string | null = null
  let size: string | null = null
  let variant: string | null = null

  const re = /\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(desc)) !== null) {
    const raw = m[1].trim()
    const upper = raw.toUpperCase().replace(/\s+/g, ' ')

    if (/^(4G|5G)$/.test(upper)) { network = upper; continue }
    if (/^(4G\/5G|5G\/4G)$/.test(upper)) { network = '5G'; continue }

    const hundredMatch = upper.match(
      /\b100\s*%?\s*(?:OG|ORIG|ORIGINAL)\b(?:\s+(\S+))?/
    )
    if (hundredMatch) { quality = '100 OG'; continue }

    if (/\bCHINA\s*(OG|ORIG|ORIGINAL)\b/.test(upper) || upper === 'C+') {
      quality = 'China OG'
      continue
    }

    if (/\bCARE\s*(OG|ORIG|ORIGINAL)?\b/.test(upper)) {
      quality = 'Care OG'
      continue
    }

    if (/^(OG|ORI|ORIG|ORIGINAL|ORG)$/.test(upper)) {
      if (!quality) quality = 'OG'
      continue
    }

    if (FLAG_MAP[upper]) { flag = FLAG_MAP[upper]; continue }
    if (SIZE_MARKERS[upper]) { size = SIZE_MARKERS[upper]; continue }
    if (VARIANT_KEYWORDS.test(upper)) {
      if (!variant) variant = upper.replace(/\.$/, '')
      continue
    }
    if (PACKAGING_VARIANT.test(upper)) {
      if (!variant) variant = 'BOX-PACKING'
      continue
    }

    colors.push(upper)
  }

  const cleanedDesc = desc.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()

  return { colors, network, quality, flag, size, variant, cleanedDesc }
}

// ============================================================
// Quality extraction from markers
// ============================================================
function extractQualityFromMarkers(markers: string[]): {
  quality: Quality
  remainingMarkers: string[]
} {
  let quality: Quality = 'Normal'
  const remaining: string[] = []

  for (const m of markers) {
    const upper = m.toUpperCase().replace(/\s+/g, ' ').trim()

    const hundredMatch = upper.match(
      /\b100\s*%?\s*(?:OG|ORIG|ORIGINAL)\b(?:\s+(\S+))?/
    )
    if (hundredMatch) {
      quality = '100 OG'
      if (hundredMatch[1]) remaining.push(hundredMatch[1])
      continue
    }

    if (/\bCHINA\s*(OG|ORIG|ORIGINAL)\b/.test(upper) || upper === 'C+') {
      quality = 'China OG'
      continue
    }

    if (/\bCARE\s*(OG|ORIG|ORIGINAL)?\b/.test(upper)) {
      quality = 'Care OG'
      continue
    }

    if (/^(OG|ORI|ORIG|ORIGINAL|ORG)$/.test(upper)) {
      if (quality === 'Normal') quality = 'OG'
      continue
    }

    remaining.push(m)
  }

  return { quality, remainingMarkers: remaining }
}

// ============================================================
// Marker classification
// ============================================================
function classifyMarkers(markers: string[]): {
  variant: string | null
  year: string | null
  network: string | null
  flag: string | null
  size: string | null
  color: string | null
} {
  let variant: string | null = null
  let year: string | null = null
  let network: string | null = null
  let flag: string | null = null
  let size: string | null = null
  let color: string | null = null

  for (const m of markers) {
    const upper = m.toUpperCase().trim()
    if (/^(4G|5G)$/i.test(upper)) { network = upper; continue }
    if (/^(19|20)\d{2}$/.test(upper)) { year = upper; continue }
    if (SIZE_MARKERS[upper]) { size = SIZE_MARKERS[upper]; continue }
    if (FLAG_MAP[upper]) { flag = FLAG_MAP[upper]; continue }
    if (PACKAGING_VARIANT.test(upper)) {
      if (!variant) variant = 'BOX-PACKING'
      continue
    }
    if (VARIANT_KEYWORDS.test(upper)) {
      if (!variant) variant = upper.replace(/\.$/, '')
      continue
    }
    if (containsColorWord(upper)) {
      if (!color) color = upper
      continue
    }
    if (!variant) variant = upper
  }

  return { variant, year, network, flag, size, color }
}

// ============================================================
// Part extraction
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

function normalizePartCode(raw: string | null): string | null {
  if (!raw) return null
  const upper = raw
    .toUpperCase()
    .trim()
    .replace(/\.$/, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
  return PART_CODE_MAP[upper] || upper
}

// ============================================================
// Scan-anywhere brand detection
// ============================================================
function findBrandAnywhere(
  text: string,
  aliases: AliasMaps
): {
  brandCode: string | null
  matchIndex: number
  matchLength: number
  matchedKey: string
} {
  if (typeof text !== 'string') {
    return { brandCode: null, matchIndex: -1, matchLength: 0, matchedKey: '' }
  }
  const upper = text.toUpperCase()
  const keys = Object.keys(aliases.brandAliases).sort(
    (a, b) => b.length - a.length
  )
  for (const key of keys) {
    if (key.length < 2) continue
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^A-Z0-9])(${escaped})(?=[^A-Z0-9]|$)`, 'i')
    const m = re.exec(upper)
    if (m) {
      const idx = m.index + m[1].length
      return {
        brandCode: aliases.brandAliases[key],
        matchIndex: idx,
        matchLength: key.length,
        matchedKey: key,
      }
    }
  }
  return { brandCode: null, matchIndex: -1, matchLength: 0, matchedKey: '' }
}

// ============================================================
// Brand + model resolution
// ============================================================
function extractBrandAndModel(
  desc: string,
  aliases: AliasMaps,
  bracketModelHint?: string | null
): {
  brandCode: string | null
  modelName: string | null
  network: string | null
} {
  if (typeof desc !== 'string') desc = ''
  let cleaned = desc.toUpperCase().trim()

  cleaned = cleaned.replace(/\b1\s*\+\s*/g, '1+ ')

  const network = (() => {
    const m = cleaned.match(/\b(4G|5G)\b/)
    return m ? m[1] : null
  })()

  cleaned = cleaned.replace(/(\d\+)(\d)/g, '$1 $2')

  let noNet = cleaned.replace(/\((4G|5G)\)/gi, ' ')
  noNet = noNet.replace(/\b(4G|5G)\b/gi, ' ')
  noNet = noNet.replace(/[-_/]/g, ' ')

  noNet = noNet.replace(/\b1\+\s+/g, '\u0001PLUS1\u0001 ')
  noNet = noNet.replace(/(\d)\+/g, '$1 PLUS ')
  noNet = noNet.replace(/\u0001PLUS1\u0001/g, '1+')
  noNet = noNet.replace(/\s+/g, ' ').trim()

  let words = noNet.split(/\s+/).filter(Boolean)
  if (words.length === 0 && !bracketModelHint) {
    return { brandCode: null, modelName: null, network }
  }

  const firstWord = words[0] || ''
  const brandKeys = Object.keys(aliases.brandAliases).sort(
    (a, b) => b.length - a.length
  )
  for (const key of brandKeys) {
    if (key.length < 2) continue
    if (key === '1+') continue
    if (
      firstWord.length > key.length &&
      firstWord.startsWith(key) &&
      /^[A-Z0-9]/.test(firstWord[key.length])
    ) {
      words[0] = firstWord.slice(0, key.length)
      words.splice(1, 0, firstWord.slice(key.length))
      break
    }
  }

  let brandCode: string | null = null
  let matchedWords = 0

  if (words[0] === '1+') {
    brandCode =
      aliases.brandAliases['1+'] || aliases.brandAliases['1 +'] || 'ONE'
    matchedWords = 1
  }

  if (!brandCode && words.length > 0) {
    const candidates: { key: string; take: number }[] = []
    if (words.length >= 3) {
      candidates.push({ key: words.slice(0, 3).join(' '), take: 3 })
      candidates.push({ key: words.slice(0, 3).join(''), take: 3 })
    }
    if (words.length >= 2) {
      candidates.push({ key: words.slice(0, 2).join(' '), take: 2 })
      candidates.push({ key: words.slice(0, 2).join(''), take: 2 })
    }
    if (words[0]) {
      candidates.push({ key: words[0], take: 1 })
    }

    for (const c of candidates) {
      if (!c.key) continue
      const k = c.key.toUpperCase()
      if (aliases.brandAliases[k]) {
        brandCode = aliases.brandAliases[k]
        matchedWords = c.take
        break
      }
    }
  }

  if (!brandCode && words.length > 0) {
    const scan = findBrandAnywhere(noNet, aliases)
    if (scan.brandCode) {
      brandCode = scan.brandCode
      const before = noNet.slice(0, scan.matchIndex).trim()
      const after = noNet.slice(scan.matchIndex + scan.matchLength).trim()
      words = `${before} ${after}`.split(/\s+/).filter(Boolean)
      matchedWords = 0
    }
  }

  if (bracketModelHint) {
    const bracketUpper = bracketModelHint.toUpperCase().trim()
    const bscan = findBrandAnywhere(bracketUpper, aliases)
    if (bscan.brandCode) {
      brandCode = bscan.brandCode
      const modelFromBracket = (
        bracketUpper.slice(0, bscan.matchIndex) +
        ' ' +
        bracketUpper.slice(bscan.matchIndex + bscan.matchLength)
      )
        .replace(/\s+/g, ' ')
        .trim()
      const outside = words.filter((w) => w && w !== bracketUpper)
      const combined = `${outside.join(' ')} ${modelFromBracket}`
        .replace(/\s+/g, ' ')
        .trim()
      words = combined.split(/\s+/).filter(Boolean)
      matchedWords = 0
    }
  }

  if (!brandCode) return { brandCode: null, modelName: null, network }

  let modelWords = words.slice(matchedWords)

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
// SKU generation
//   Template: BRAND - MODEL - PART - [YEAR] - [VARIANT] - [NETWORK]
//             - [FLAG] - [COLOR] - [QUALITY]
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
  validBrandCodes?: string[]
}): string | null {
  const {
    brandCode, modelName, variant, year, partCode,
    network, quality, flag, color, validBrandCodes,
  } = fields

  if (!brandCode || !modelName || !partCode) return null

  guardBrandCode(brandCode, validBrandCodes)

  const dash = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

  const seg: string[] = []
  seg.push(brandCode)
  seg.push(dash(modelName))
  seg.push(partCode)
  if (year) seg.push(year)
  if (variant) seg.push(dash(variant))
  if (network) seg.push(network)
  if (flag) seg.push(dash(flag))
  if (color) seg.push(dash(color))
  if (quality === 'OG') seg.push('OG')
  else if (quality === '100 OG') seg.push('100OG')
  else if (quality === 'ORG') seg.push('ORG')
  else if (quality === 'Care OG') seg.push('CARE')
  else if (quality === 'China OG') seg.push('CHINAOG')

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
  for (const it of items) itemBySku[it.sku.toUpperCase()] = it

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

    if (qty === 0) continue

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
      // Separate Brand / Model / Part Type columns
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
      // Single Description column
      rawDescription = colDesc >= 0 ? row[colDesc] || '' : ''
      rawType = colPart >= 0 ? (row[colPart] || '').toUpperCase().trim() : ''

      if (!rawDescription) continue

      const normalized = normalizeTypos(rawDescription)

      // 1. Extract parentheticals (color / quality / network / flag / size / variant)
      const par = extractParentheticals(normalized)
      let working = par.cleanedDesc

      // 2. Extract bracket markers
      const markerRes = extractMarkers(working)
      working = markerRes.cleanedDesc

      // 3. Quality from bracket markers
      const qRes = extractQualityFromMarkers(markerRes.markers)
      quality = par.quality || qRes.quality

      // 4. Classify remaining bracket markers
      const cRes = classifyMarkers(qRes.remainingMarkers)
      year = cRes.year
      if (cRes.network && !network) network = cRes.network
      if (par.network && !network) network = par.network
      flag = par.flag || cRes.flag
      if (!color && par.colors.length > 0) color = par.colors[0]
      if (!color && cRes.color) color = cRes.color

      // 5. Variant
      variant = par.variant || cRes.variant
      if (par.size) variant = par.size

      // 5b. Bracket-model hint
      let bracketModelHint: string | null = null
      if (cRes.variant) {
        const vUpper = cRes.variant.toUpperCase()
        const hasSpace = /\s/.test(vUpper)
        const endsInNetwork = /\b(4G|5G)\s*$/.test(vUpper)
        const hasYear = /\b(19|20)\d{2}\b/.test(vUpper)
        const brandInBracket = findBrandAnywhere(vUpper, aliases).brandCode
        if (
          (hasSpace && !containsColorWord(vUpper)) ||
          endsInNetwork ||
          hasYear ||
          brandInBracket
        ) {
          bracketModelHint = cRes.variant
        }
      }

      // 6. Part
      if (rawType) {
        partCode =
          aliases.partAliases[rawType] || normalizePartCode(rawType)
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

      working = working.replace(/\s+/g, ' ').trim()

      // 7. Brand + model
      const bm = extractBrandAndModel(working, aliases, bracketModelHint)
      brandCode = bm.brandCode
      modelName = normalizeModelName(bm.modelName)
      if (bm.network && !network) network = bm.network
    }

    // Fallbacks
    if (!brandCode && partCode) {
      brandCode = 'GEN'
    }
    if (brandCode && !modelName && partCode) {
      modelName = 'UNKNOWN'
    }

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
      validBrandCodes: aliases.validBrandCodes,
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