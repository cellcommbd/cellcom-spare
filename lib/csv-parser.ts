// lib/csv-parser.ts
// v23 — Adds BACK CAMERA / FRONT CAMERA / FLASH FLEX phrases to PART_TYPE_PHRASES
//       so BCAM / FCAM / FF parts resolve correctly.
//
// Inherited from v22/v21/v20:
//   - Quality enum: Normal | OG | 100 OG | Care OG | China OG
//   - ORI / ORG / ORIG / ORIGINAL → Care OG
//   - MIX OG → OG
//   - Mixed bracket quality: [OG W/C], [W/C OG]
//   - Trailing unbracketed quality + flag markers caught
//   - Unknown bracket contents dropped (except year-containing model aliases)
//   - EXX-BEE dropped; SPEAKER + EXX-BEE → part ESPK
//   - Size markers → variant slot
//   - Generic parts (no model) skip model segment
//   - Single-digit models allowed
//   - CONVHOUSING, ONOFFSWITCH added
//
// SKU = BRAND - MODEL - PART - [YEAR] - [VARIANT] - [NETWORK] - [FLAG] - [COLOR] - [QUALITY]

export type Quality =
  | 'Normal'
  | 'OG'
  | '100 OG'
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
  console.warn(`[csv-parser] Brand code "${brandCode}" not in brands.brand_code.`)
}

export function resetBrandCodeWarnings(): void {
  warnedBrandCodes = new Set<string>()
}

const SIZE_MARKERS: Record<string, string> = {
  '20MM': '20MM', '20 MM': '20MM',
  '15MM': '15MM', '15 MM': '15MM',
  '10MM': '10MM', '10 MM': '10MM',
  BIG: 'BIG', 'BIG SIZE': 'BIGSIZE', BIGSIZE: 'BIGSIZE',
  SMALL: 'SMALL', 'SMALL SIZE': 'SMALLSIZE', SMALLSIZE: 'SMALLSIZE',
  MEDIUM: 'MEDIUM', 'MEDIUM SIZE': 'MEDIUMSIZE', MEDIUMSIZE: 'MEDIUMSIZE',
}

const VARIANT_KEYWORDS = /^(MAIN|OCTA|NEW|DAMD\.?|SPARK|DISPLAY|FOR|MAINBOARD|MAIN BOARD)$/i
const PACKAGING_VARIANT = /^(BOX\s*PECK?ING|BOX\s*PACKING|BOXPACKING|BOXPECKING)$/i

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

const PART_CODE_MAP: Record<string, string> = {
  BP: 'BP', 'BACK PANEL': 'BP', 'BACK COVER': 'BP', BK: 'BP',
  'BACK PANEL WITH LENS': 'BP', 'BACK PANEL WL': 'BP',
  'BACK PANAL': 'BP', 'BACK PANLE': 'BP', 'BACK PANNEL': 'BP', BACKPANEL: 'BP',
  FH: 'FH', 'FULL HOUSING': 'FH',
  MF: 'MF', 'MIDDLE FRAME': 'MF', MD: 'MF', MIDDLE: 'MF',
  MFF: 'MFF', 'MIDDLE FRAME WITH FLEX': 'MFF',
  LCD: 'LCD', 'LCD FLEX': 'LCD',
  'LCD FLEX MAIN': 'LCD', 'LCD FLEX {MAIN}': 'LCD',
  LCDCON: 'LCDCON', 'LCD CONNECTOR': 'LCDCON', 'LCD CONN': 'LCDCON', 'LCD CONN.': 'LCDCON',
  LCDRING: 'LCDRING', 'LCD RING': 'LCDRING',
  BATCON: 'BATCON', 'BATTERY CONNECTOR': 'BATCON', 'BATTERY CONN': 'BATCON',
  'BATTERY CONN.': 'BATCON', 'B/C': 'BATCON', 'B/C CONN': 'BATCON', 'B/C CONN.': 'BATCON',
  BOARDCONN: 'BOARDCONN', 'BOARD CONN': 'BOARDCONN', 'BOARD CONN.': 'BOARDCONN',
  'BORD CONN': 'BOARDCONN', 'BORD CONN.': 'BOARDCONN',
  SENSORCONN: 'SENSORCONN', 'SENSOR CONN': 'SENSORCONN', 'SENSOR CONN.': 'SENSORCONN',
  'SENSOR CONNECTOR': 'SENSORCONN', 'ON OFF SENSOR CONN': 'SENSORCONN',
  SENSORSIDE: 'SENSORSIDE', 'SENSOR SIDE': 'SENSORSIDE', 'SENSOR [SIDE]': 'SENSORSIDE',
  SENSOR: 'SENSOR',
  ONOFF: 'ONOFF', 'ON OFF FLEX': 'ONOFF',
  ONOFFSWITCH: 'ONOFFSWITCH', 'ON OFF SWITCH': 'ONOFFSWITCH', 'ONOFF SWITCH': 'ONOFFSWITCH', SWITCH: 'ONOFFSWITCH',
  VOL: 'VOL', 'VOL FLEX': 'VOL', 'VOLUME FLEX': 'VOL',
  CCFLEX: 'CCFLEX', 'CC FLEX': 'CCFLEX', 'CHARGING FLEX': 'CCFLEX',
  CHG: 'CHG',
  RB: 'RB', 'RINGER BOX': 'RB', RINGER: 'RB',
  SPK: 'SPK', SPEAKER: 'SPK',
  SPKF: 'SPKF', 'SPEAKER FLEX': 'SPKF', 'SPK FLEX': 'SPKF',
  'ONLY SPEAKER FLEX': 'SPKF', 'SPK FLEX ONLY': 'SPKF', 'SPK FLEX COPY': 'SPKF',
  SPKFL: 'SPKFL', 'ONLY FLEX': 'SPKFL', 'SPEAKER FLEX ONLY': 'SPKFL', 'FLEX ONLY': 'SPKFL',
  SPKJ: 'SPKJ', 'SPEAKER JALI': 'SPKJ', 'SPEAKER/RINGER JALI': 'SPKJ', 'RINGER JALI': 'SPKJ',
  ESPK: 'ESPK', 'EXX-BEE': 'ESPK', 'EXX BEE': 'ESPK', EXXBEE: 'ESPK',
  EARPIECE: 'ESPK', 'EAR SPEAKER': 'ESPK',
  ESPKF: 'ESPKF', 'EXX-BEE FLEX': 'ESPKF', 'EARPIECE FLEX': 'ESPKF',
  ESPKFL: 'ESPKFL', 'EXX-BEE ONLY FLEX': 'ESPKFL', 'EARPIECE FLEX ONLY': 'ESPKFL',
  CG: 'CG', 'CAMERA GLASS': 'CG', CL: 'CL', 'CAMERA LENS': 'CL',
  CAM: 'CAM', CAMERA: 'CAM',
  BCAM: 'BCAM', 'BACK CAMERA': 'BCAM', 'BACK CAM': 'BCAM',
  FCAM: 'FCAM', 'FRONT CAMERA': 'FCAM', 'FRONT CAM': 'FCAM',
  FF: 'FF', 'FLASH FLEX': 'FF', 'TYPE FLASH': 'FF', 'TYPE FLASH FLEX': 'FF',
  ST: 'ST', SIMTRAY: 'ST', 'SIM TRAY': 'ST', 'SIM TRY': 'ST',
  'OUT SIM TRAY': 'ST', 'OUT SIM TRY': 'ST',
  'GAS KIT FRONT': 'GASKITF',
  'GAS KIT BACK': 'GASKITB',
  GASKIT: 'GASKIT',
  'GAS KIT': 'GASKIT',
  OUTKEY: 'OUTKEY', 'OUT KEY': 'OUTKEY',
  MIC: 'MIC', 'CHINA MIC': 'MIC',
  VIB: 'VIB', VIBRATOR: 'VIB',
  ANT: 'ANT', ANTENNA: 'ANT',
INRUBBER: 'INRUBBER', 'IN RUBBER': 'INRUBBER',
  BACKGLASS: 'BACKGLASS', 'BACK GLASS': 'BACKGLASS',
  CONVHOUSING: 'CONVHOUSING', 'CONVERTER HOUSING': 'CONVHOUSING',
  'CONVETOR HOUSING': 'CONVHOUSING', 'CONVERT HOUSING': 'CONVHOUSING',
  'CONVERT HOUSIG': 'CONVHOUSING',
  CONVERTER: 'CONVHOUSING', CONVETOR: 'CONVHOUSING', CONVERT: 'CONVHOUSING',
}

const FLAG_MAP: Record<string, string> = {
  WL: 'WL', 'W/L': 'WL', 'WITH LENS': 'WL', 'WITH LOGO': 'WL',
  FLEX: 'FLEX', SET: 'SET', FRONT: 'FRONT', BACK: 'BACK',
  'W/C': 'WC', WC: 'WC', 'W/C/L': 'WCL', 'W/CL': 'WCL', WCL: 'WCL',
  ONLY: 'ONLY', COPY: 'COPY',
}

const PART_CODE_TOKENS = new Set<string>([
  'BP', 'BK', 'FH', 'MF', 'MD', 'MFF', 'LCD', 'LCDCON', 'LCDRING',
  'BATCON', 'BOARDCONN', 'SENSORCONN', 'SENSORSIDE', 'ONOFF', 'ONOFFSWITCH', 'VOL',
  'CCFLEX', 'CHG', 'RB', 'SPK', 'SPKF', 'SPKFL', 'SPKJ', 'ESPK',
  'ESPKF', 'ESPKFL', 'CG', 'CL', 'CAM', 'ST', 'GASKIT', 'GASKITF',
  'GASKITB', 'OUTKEY', 'MIC', 'VIB', 'ANT', 'INRUBBER', 'BACKGLASS',
  'FF', 'BCAM', 'FCAM', 'CONVHOUSING',
])

const QUALITY_TOKEN_REGEX = /^(100\s*%?\s*(?:OG|ORIG|ORIGINAL)|100OG|OG|ORI|ORIG|ORIGINAL|ORG|CARE(?:\s*(?:OG|ORIG|ORIGINAL))?|CHINA\s*(?:OG|ORIG|ORIGINAL)|C\+|MIX\s+OG)$/i

const TRAILING_QUALITY_REGEX = /\s+(100\s*%?(?:\s*(?:OG|ORIG|ORIGINAL))?|100OG|OG|ORI|ORIG|ORIGINAL|ORG|CHINA\s*(?:OG|ORIG|ORIGINAL))\s*$/i

const TRAILING_FLAG_REGEX = /\s+(W\s*\/\s*C(?:\s*\/\s*L)?|WC|WCL|W\s*\/\s*CL|WL)\b/i

const PART_TYPE_PHRASES: string[] = [
  // Camera + flash phrases (v23 additions)
  'BACK CAMERA',
  'FRONT CAMERA',
  'BACK CAM',
  'FRONT CAM',
  'FLASH FLEX',
  'TYPE FLASH FLEX',
  'TYPE FLASH',
  'SENSOR [SIDE]',
  'SENSOR SIDE',
  'SENSOR CONNECTOR',
  'SENSOR CONN.',
  'SENSOR CONN',
  'SENSOR',
  'IN RUBBER',
  'INRUBBER',
  'IN RUBBER',
  'INRUBBER',
  // Existing phrases (longest-first ordering preserved)
  'MIDDLE FRAME WITH FLEX',
  'ON OFF SENSOR CONN',
  'ONLY EARPIECE FLEX',
  'EARPIECE FLEX ONLY',
  'ONLY SPEAKER FLEX',
  'SPEAKER FLEX ONLY',
  'SPK FLEX COPY',
  'SPK FLEX ONLY',
  'SPEAKER/RINGER JALI',
  'SPEAKER / RINGER JALI',
  'SPEAKER/ RINGER JALI',
  'SPEAKER /RINGER JALI',
  'RINGER JALI',
  'CONVERTER HOUSING',
  'CONVETOR HOUSING',
  'CONVERT HOUSING',
  'CONVERT HOUSIG',
  'CONVERTER',
  'CONVETOR',
  'CONVERT',
  'BATTERY CONNECTOR',
  'BATTERY CONN.',
  'BATTERY CONN',
  'B/C CONN.',
  'B/C CONN',
  'BOARD CONN.',
  'BOARD CONN',
  'BORD CONN.',
  'BORD CONN',
  'LCD CONNECTOR',
  'LCD CONN.',
  'LCD CONN',
  'LCD RING',
  'GAS KIT FRONT',
  'GAS KIT BACK',
  'GAS KIT',
  'ON OFF SWITCH',
  'ONOFF SWITCH',
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
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) { fields.push(cur); cur = '' }
      else cur += ch
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
    .replace(/\bCONVETOR\b/gi, 'CONVERTER')
    .replace(/\bCOVERT\b/gi, 'CONVERT')
    .replace(/\bEXX\s*-\s*BEE\b/gi, 'EXX-BEE')
    .replace(/\bEXX\s+BEE\b/gi, 'EXX-BEE')
    .replace(/\bEXXBEE\b/gi, 'EXX-BEE')
    .replace(/\bB\s*\/\s*C\b/gi, 'B/C')
    .replace(/\bB\s*\/\s*C\s+CONN\.?/gi, 'B/C CONN')
    .replace(/([A-Z])B\/C\b/gi, '$1 B/C')
    .replace(/BOX\s*PECKING/gi, 'BOX PACKING')
    .replace(/###/g, ' ')
    .replace(/[*'`"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

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

type ParentheticalResult = {
  colors: string[]; network: string | null; quality: Quality | null
  flag: string | null; size: string | null; variant: string | null
  year: string | null
  cleanedDesc: string
}

function extractParentheticals(desc: string): ParentheticalResult {
  const colors: string[] = []
  let network: string | null = null
  let quality: Quality | null = null
  let flag: string | null = null
  let size: string | null = null
  let variant: string | null = null
  let year: string | null = null

  const re = /\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(desc)) !== null) {
    const raw = m[1].trim()
    const upper = raw.toUpperCase().replace(/\s+/g, ' ')

    if (/^(19|20)\d{2}$/.test(upper)) { year = upper; continue }
    if (/^(4G|5G)$/.test(upper)) { network = upper; continue }
    if (/^(4G\/5G|5G\/4G)$/.test(upper)) { network = '5G'; continue }

    const hundredMatch = upper.match(/\b100\s*%?(?:\s*(?:OG|ORIG|ORIGINAL))?\b(?:\s+(\S+))?/)
    if (hundredMatch) { quality = '100 OG'; continue }

    if (/\bCHINA\s*(OG|ORIG|ORIGINAL)\b/.test(upper) || upper === 'C+') {
      quality = 'China OG'; continue
    }

    if (/\bCARE\s*(OG|ORIG|ORIGINAL)?\b/.test(upper)) {
      quality = 'Care OG'; continue
    }

    if (/^(OG|ORI|ORIG|ORIGINAL|ORG)$/.test(upper)) {
      if (!quality) quality = 'OG'; continue
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
  return { colors, network, quality, flag, size, variant, year, cleanedDesc }
}

function extractQualityFromMarkers(markers: string[]): {
  quality: Quality
  remainingMarkers: string[]
} {
  let quality: Quality = 'Normal'
  const remaining: string[] = []

  for (const m of markers) {
    const upper = m.toUpperCase().replace(/\s+/g, ' ').trim()

    const hasHundred = /100\s*%?/.test(upper)
    const hasChina = /\bCHINA\s*(?:OG|ORIG|ORIGINAL)\b/.test(upper) || /\bC\+\b/.test(upper)
    const hasCare = /\bCARE\b/.test(upper)
    const hasOrig = /\b(ORI|ORIG|ORIGINAL|ORG)\b/.test(upper)
    const hasMixOG = /\bMIX\s+OG\b/.test(upper)
    const hasPlainOG = /\bOG\b/.test(upper) && !hasHundred && !hasChina && !hasMixOG

    if (hasHundred) {
      if (quality === 'Normal' || quality === 'OG') quality = '100 OG'
    } else if (hasChina) {
      if (quality === 'Normal' || quality === 'OG') quality = 'China OG'
    } else if (hasCare) {
      if (quality === 'Normal' || quality === 'OG') quality = 'Care OG'
    } else if (hasOrig) {
      if (quality === 'Normal') quality = 'Care OG'
    } else if (hasMixOG) {
      if (quality === 'Normal') quality = 'OG'
    } else if (hasPlainOG) {
      if (quality === 'Normal') quality = 'OG'
    }

    let residual = upper
      .replace(/\b100\s*%?(?:\s*(?:OG|ORIG|ORIGINAL))?\b/g, ' ')
      .replace(/\bCHINA\s*(?:OG|ORIG|ORIGINAL)\b/g, ' ')
      .replace(/\bC\+\b/g, ' ')
      .replace(/\bCARE\b/g, ' ')
      .replace(/\b(ORI|ORIG|ORIGINAL|ORG)\b/g, ' ')
      .replace(/\bMIX\s+OG\b/g, ' ')
      .replace(/\bOG\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (residual.length > 0) {
      remaining.push(residual)
    }
  }

  return { quality, remainingMarkers: remaining }
}

function classifyMarkers(markers: string[]): {
  variant: string | null; year: string | null; network: string | null
  flag: string | null; size: string | null; color: string | null
  modelAlias: string | null
} {
  let variant: string | null = null
  let year: string | null = null
  let network: string | null = null
  let flag: string | null = null
  let size: string | null = null
  let color: string | null = null
  let modelAlias: string | null = null

  for (const m of markers) {
    const upper = m.toUpperCase().trim()

    if (/^(4G|5G)$/i.test(upper)) { network = upper; continue }
    if (/^(19|20)\d{2}$/.test(upper)) { year = upper; continue }

    if (/\b(19|20)\d{2}\b/.test(upper)) {
      if (!modelAlias) modelAlias = upper.replace(/\s*\/\s*/g, '-').replace(/\s+/g, '-')
      continue
    }

    if (SIZE_MARKERS[upper]) { size = SIZE_MARKERS[upper]; continue }

    const flagKey = upper.replace(/\s+/g, '')
    if (FLAG_MAP[upper]) { flag = FLAG_MAP[upper]; continue }
    if (FLAG_MAP[flagKey]) { flag = FLAG_MAP[flagKey]; continue }

    if (PACKAGING_VARIANT.test(upper)) {
      if (!variant) variant = 'BOX-PACKING'; continue
    }
    if (VARIANT_KEYWORDS.test(upper)) {
      if (!variant) variant = upper.replace(/\.$/, ''); continue
    }
    if (/^METAL$/.test(upper)) {
      if (!variant) variant = 'METAL'; continue
    }
    if (containsColorWord(upper)) {
      if (!color) color = upper.replace(/\s*\/\s*/g, '-').replace(/\s+/g, '-')
      continue
    }

    // v24: any remaining short alphanumeric token becomes a variant
    // (catches {M12}, {M14}, {M16}, {N6}, etc. — model sub-versions)
    if (/^[A-Z]{1,2}\d{1,3}$/i.test(upper) || /^[A-Z]\d[A-Z]$/i.test(upper)) {
      if (!variant) variant = upper
      continue
    }
  }

  return { variant, year, network, flag, size, color, modelAlias }
}

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
    .replace(/\s+/g, ' ')
  if (PART_CODE_MAP[upper]) return PART_CODE_MAP[upper]
  const spaceForm = upper.replace(/\s*\/\s*/g, ' ')
  if (PART_CODE_MAP[spaceForm]) return PART_CODE_MAP[spaceForm]
  const noSpace = upper.replace(/\s+/g, '')
  if (PART_CODE_MAP[noSpace]) return PART_CODE_MAP[noSpace]
  return upper.replace(/[^A-Z0-9]/g, '') || null
}

function findBrandAnywhere(
  text: string,
  aliases: AliasMaps
): {
  brandCode: string | null; matchIndex: number; matchLength: number; matchedKey: string
} {
  if (typeof text !== 'string') {
    return { brandCode: null, matchIndex: -1, matchLength: 0, matchedKey: '' }
  }
  const upper = text.toUpperCase()
  const keys = Object.keys(aliases.brandAliases).sort((a, b) => b.length - a.length)
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

function extractBrandAndModel(
  desc: string,
  aliases: AliasMaps,
  bracketModelHint?: string | null
): {
  brandCode: string | null; modelName: string | null; network: string | null
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
  const brandKeys = Object.keys(aliases.brandAliases).sort((a, b) => b.length - a.length)
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
    brandCode = aliases.brandAliases['1+'] || aliases.brandAliases['1 +'] || 'ONE'
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
        bracketUpper.slice(0, bscan.matchIndex) + ' ' +
        bracketUpper.slice(bscan.matchIndex + bscan.matchLength)
      ).replace(/\s+/g, ' ').trim()
      const outside = words.filter((w) => w && w !== bracketUpper)
      const combined = `${outside.join(' ')} ${modelFromBracket}`.replace(/\s+/g, ' ').trim()
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

  return { brandCode, modelName: modelWords.join(' ') || null, network }
}

function normalizeModelName(model: string | null): { model: string | null; strippedPart: string | null } {
  if (!model) return { model: null, strippedPart: null }

  let cleaned = model
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[*'`"]/g, '')
    .replace(/[^A-Z0-9+\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return { model: null, strippedPart: null }

  const MARKER_BEFORE_DIGIT = /\b(FLEX|SET|WITH|OG|ORI|ORIG|ORIGINAL|ORG|CARE|CHINA|100|%|BP|BK|FH|MF|MFF|LCD|SPK|SPKF|SPKJ|RB|CAM|CG|CL|ST|MIC|VIB|ANT)\s+\d$/i
  if (MARKER_BEFORE_DIGIT.test(cleaned)) {
    cleaned = cleaned.replace(/\s+\d$/, '').trim()
  }

  // v24: strip trailing junk tokens (EXB, GR, KG7, GO 2021)
  cleaned = cleaned.replace(/\s+(EXB|GR|KG\d|GO\s*\d{4})\s*$/i, '').trim()

  // v24: strip trailing short alphanumeric junk tokens (EXB, GR, Kg7, A13 when trailing a model like A12)
  cleaned = cleaned.replace(/\s+(EXB|GR|GO\s*\d{4}|KG\d|A\d{1,2}[A-Z]?)\s*$/i, '').trim()

  cleaned = cleaned.replace(/\s*\+\s*$/, '').replace(/^\+\s*/, '').trim()
  if (!cleaned) return { model: null, strippedPart: null }

  cleaned = cleaned.replace(TRAILING_QUALITY_REGEX, '').trim()
  if (!cleaned) return { model: null, strippedPart: null }

  const words = cleaned.split(/\s+/)
  let strippedPart: string | null = null
  if (words.length > 1) {
    const lastWord = words[words.length - 1]
    if (PART_CODE_TOKENS.has(lastWord)) {
      strippedPart = lastWord
      words.pop()
      cleaned = words.join(' ')
    }
  }

  if (!cleaned) return { model: null, strippedPart }
  const finalWords = cleaned.split(/\s+/)
  if (finalWords.length === 1) {
    const w = finalWords[0]
    if (PART_CODE_TOKENS.has(w)) return { model: null, strippedPart }
    if (QUALITY_TOKEN_REGEX.test(w)) return { model: null, strippedPart }
  }

  return { model: cleaned, strippedPart }
}
// ============================================================
// SKU generation
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

  if (!brandCode || !partCode) return null

  guardBrandCode(brandCode, validBrandCodes)

  const dash = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

  const seg: string[] = []
  seg.push(brandCode)
  if (modelName) seg.push(dash(modelName))
  seg.push(partCode)
  if (year) seg.push(year)
  if (variant) seg.push(dash(variant))
  if (network) seg.push(network)
  if (flag) seg.push(dash(flag))
  if (color) seg.push(dash(color))
  if (quality === 'OG') seg.push('OG')
  else if (quality === '100 OG') seg.push('100OG')
  else if (quality === 'Care OG') seg.push('CARE')
  else if (quality === 'China OG') seg.push('CHINAOG')

  return seg.filter(Boolean).join('-')
}

// ============================================================
// Duplicate SKU detection within a single file.
// ============================================================
export function flagDuplicates(rows: ParsedRow[]): ParsedRow[] {
  const skuMap = new Map<string, number[]>()

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.generatedSku) continue
    if (
      r.status === 'error' &&
      r.errorMessage &&
      !r.errorMessage.startsWith('Duplicate SKU')
    ) {
      continue
    }
    const key = r.generatedSku.toUpperCase()
    if (!skuMap.has(key)) skuMap.set(key, [])
    skuMap.get(key)!.push(i)
  }

  const next = rows.map((r) => {
    if (r.status === 'error' && r.errorMessage?.startsWith('Duplicate SKU')) {
      return { ...r, status: 'new' as const, errorMessage: undefined }
    }
    return r
  })

  for (const [sku, idxs] of skuMap.entries()) {
    if (idxs.length > 1) {
      for (const idx of idxs) {
        next[idx] = {
          ...next[idx],
          status: 'error',
          errorMessage: `Duplicate SKU — edit to fix`,
        }
      }
    }
  }

  return next
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

  let headerRowIndex = -1
  let header: string[] = []
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i]
    const qty = findColumnIndex(line, ['quantity', 'qty'])
    const rate = findColumnIndex(line, ['rate', 'price'])
    const desc = findColumnIndex(line, ['descriptionofgoods', 'description', 'item', 'product'])
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
  const colPart = findColumnIndex(header, ['parttype', 'typeofgoods', 'type', 'part'])
  const colDesc = findColumnIndex(header, ['descriptionofgoods', 'description', 'item', 'product'])
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

    const rawDescFromRow = colDesc >= 0 ? row[colDesc] || '' : ''
    const rawTypeFromRow = colPart >= 0 ? (row[colPart] || '').toUpperCase().trim() : ''
    const rawQtyCell = colQty >= 0 ? row[colQty] || '' : ''
    const rawRateCell = colRate >= 0 ? row[colRate] || '' : ''

    const qty = parseFloat(String(rawQtyCell).replace(/[^\d.-]/g, '')) || 0
    const rate = parseFloat(String(rawRateCell).replace(/[^\d.-]/g, '')) || 0

    let pendingError: string | null = null

    if (!isNewFormat && colDesc >= 0 && row.length < header.length) {
      pendingError = `Wrong column count`
    } else if (!isNewFormat && !rawDescFromRow) {
      pendingError = `Missing description`
    } else if (qty === 0) {
      pendingError = `Missing qty`
    }

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
      const brandRaw = normalizeTypos((row[colBrand] || '').toUpperCase().trim())
      const modelRaw = normalizeTypos((row[colModel] || '').trim())
      const partRaw = normalizeTypos((row[colPart] || '').toUpperCase().trim())

      rawDescription = `${brandRaw} ${modelRaw}`
      rawType = partRaw

      network = (modelRaw.match(/\b(4G|5G)\b/i) || [null])[0]
      if (network) network = network.toUpperCase()

      brandCode = aliases.brandAliases[brandRaw] || brandRaw
      const nm = normalizeModelName(modelRaw.replace(/\(4G\)|\(5G\)/gi, '').trim())
      modelName = nm.model
      partCode = aliases.partAliases[partRaw] || normalizePartCode(partRaw)
      if (nm.strippedPart && !partCode) {
        partCode = aliases.partAliases[nm.strippedPart] || normalizePartCode(nm.strippedPart)
      }
    } else {
      rawDescription = rawDescFromRow
      rawType = rawTypeFromRow

      if (rawDescription) {
        const normalized = normalizeTypos(rawDescription)

        // v24: detect "N PIN" pattern → variant
        const pinMatch = normalized.toUpperCase().match(/\b(\d)\s*PIN\b/)
        if (pinMatch) {
          variant = `${pinMatch[1]}PIN`
        }

        const par = extractParentheticals(normalized)
        let working = par.cleanedDesc

        const markerRes = extractMarkers(working)
        working = markerRes.cleanedDesc

        const qRes = extractQualityFromMarkers(markerRes.markers)
        quality = par.quality || qRes.quality

        const cRes = classifyMarkers(qRes.remainingMarkers)
        year = cRes.year
        if (!year && par.year) year = par.year

        if (cRes.network && !network) network = cRes.network
        if (par.network && !network) network = par.network
        flag = par.flag || cRes.flag
        if (!color && par.colors.length > 0) color = par.colors[0]
        if (!color && cRes.color) color = cRes.color

        if (!variant) {
          variant = par.variant || cRes.variant
          if (cRes.size) variant = cRes.size
          else if (par.size) variant = par.size
        }

        if (cRes.modelAlias) {
          working = working + ' ' + cRes.modelAlias
        }

        if (quality === 'Normal') {
          const tq = working.match(TRAILING_QUALITY_REGEX)
          if (tq) {
            const u = tq[1].toUpperCase()
            if (/100\s*%?\s*(OG|ORIG|ORIGINAL)/.test(u)) quality = '100 OG'
            else if (/CHINA\s*(OG|ORIG|ORIGINAL)/.test(u)) quality = 'China OG'
            else if (/(ORI|ORIG|ORIGINAL|ORG)/.test(u)) quality = 'Care OG'
            else if (/OG/.test(u)) quality = 'OG'
            working = working.replace(TRAILING_QUALITY_REGEX, '').trim()
          }
        }

        if (!flag) {
          const tf = working.match(TRAILING_FLAG_REGEX)
          if (tf) {
            const raw = tf[1].toUpperCase()
            const clean = raw.replace(/\s+/g, '')
            flag = FLAG_MAP[clean] || FLAG_MAP[raw] || null
            working = working.replace(TRAILING_FLAG_REGEX, ' ').trim()
          }
        }

        const markersJoined = markerRes.markers.join(' ').toUpperCase()
        const hasExxBee =
          /\bEXX\s*-?\s*BEE\b/i.test(working) ||
          /\bEXX\s*-?\s*BEE\b/i.test(markersJoined)
        const hasSpeaker =
          /\bSPEAKER\b/i.test(working) ||
          /\bSPEAKER\b/i.test(markersJoined)

        if (hasExxBee && hasSpeaker) {
          partCode = 'ESPK'
          rawType = 'EXX-BEE'
          working = working.replace(/\bEXX\s*-?\s*BEE\b/gi, ' ').trim()
        } else {
          working = working.replace(/\bEXX\s*-?\s*BEE\b/gi, ' ').trim()
        }

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
        for (let pass = 0; pass < 4; pass++) {
          const re = extractPartFromDescription(working)
          if (re.partText && re.cleanedDesc !== working) {
            working = re.cleanedDesc
          } else {
            break
          }
        }

        working = working.replace(/\s+/g, ' ').trim()

        const bm = extractBrandAndModel(working, aliases, bracketModelHint)
        brandCode = bm.brandCode
        const nm2 = normalizeModelName(bm.modelName)
        modelName = nm2.model
        if (nm2.strippedPart && !partCode) {
          partCode = aliases.partAliases[nm2.strippedPart] || normalizePartCode(nm2.strippedPart)
        }
        if (bm.network && !network) network = bm.network
      }
    }

    if (!brandCode && partCode) {
      brandCode = 'GEN'
    }

    const sku = generateSku({
      brandCode, modelName, variant, year, partCode,
      network, quality, flag, color,
      validBrandCodes: aliases.validBrandCodes,
    })

    let matchedItemId: number | null = null
    let matchedItemSku: string | null = null
    let status: 'matched' | 'new' | 'error' = 'new'
    let errorMessage: string | undefined

    if (pendingError) {
      status = 'error'
      errorMessage = pendingError
    } else if (!brandCode) {
      status = 'error'
      errorMessage = 'Unknown brand'
    } else if (!partCode) {
      status = 'error'
      errorMessage = 'Unknown part'
    } else if (!sku) {
      status = 'error'
      errorMessage = 'Could not build SKU'
    } else if (itemBySku[sku.toUpperCase()]) {
      const found = itemBySku[sku.toUpperCase()]
      matchedItemId = found.item_id
      matchedItemSku = found.sku
      status = 'matched'
    }

    result.push({
      rowNumber: i,
      rawDescription: rawDescription || row.join(' | '),
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

  const flagged = flagDuplicates(result)

  const failed = flagged.filter((r) => r.status === 'error')
  if (failed.length > 0) {
    console.log(`\n===== PARSE FAILED ROWS (${failed.length}) =====`)
    for (const f of failed.slice(0, 20)) {
      console.log(`Row ${f.rowNumber}: "${f.rawDescription}"`)
      console.log(`   → ${f.errorMessage}`)
    }
    if (failed.length > 20) console.log(`   ... ${failed.length - 20} more`)
    console.log(`===== END =====\n`)
  }

  return flagged
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