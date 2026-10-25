// lib/csv-parser.ts
// v34 — 1+NORD fix, brand-consume fix, curly-brace quality extraction

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
  is_general_item?: boolean
  category_code?: string | null
}

export type AliasMaps = {
  brandAliases: Record<string, string>
  partAliases: Record<string, string>
  colorAliases?: Record<string, string>
  validBrandCodes?: string[]
}

const BUILT_IN_BRAND_ALIASES: Record<string, string> = {
  OP: 'OP',
  RE: 'RE',
  OPPO: 'OP',
  REALME: 'RE',
  SAM: 'SAM',
  SM: 'SAM',
  VV: 'VV',
  VIVO: 'VV',
  IP: 'IP',
  IPHONE: 'IP',
  NK: 'NK',
  RM: 'RE',
  MI: 'MI',
  ONE: 'ONE',
  REDMI: 'RE',
  NOKIA: 'NK',
  GENERIC: 'GEN',
  '1+': 'ONE',
  '1PLUS': 'ONE',
}

export function mergeBrandAliases(input?: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = { ...BUILT_IN_BRAND_ALIASES }
  if (!input) return merged

  for (const [key, value] of Object.entries(input)) {
    if (!key || !value) continue
    const upperKey = String(key).trim().toUpperCase()
    if (!upperKey) continue
    if (upperKey in merged) continue
    merged[upperKey] = String(value)
  }

  return merged
}

function withFallbackBrandAliases(input?: Record<string, string>): Record<string, string> {
  return mergeBrandAliases(input)
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

// ============================================================
// Dictionaries
// ============================================================

const SIZE_MARKERS: Record<string, string> = {
  '20MM': '20MM', '20 MM': '20MM',
  '18MM': '18MM', '18 MM': '18MM',
  '16MM': '16MM', '16 MM': '16MM',
  '15MM': '15MM', '15 MM': '15MM',
  '10MM': '10MM', '10 MM': '10MM',
  BIG: 'BIG', 'BIG SIZE': 'BIGSIZE', BIGSIZE: 'BIGSIZE',
  SMALL: 'SMALL', 'SMALL SIZE': 'SMALLSIZE', SMALLSIZE: 'SMALLSIZE',
  MEDIUM: 'MEDIUM', 'MEDIUM SIZE': 'MEDIUMSIZE', MEDIUMSIZE: 'MEDIUMSIZE',
  '4 PIN': '4PIN', '4PIN': '4PIN',
  '3 PIN': '3PIN', '3PIN': '3PIN',
  '2 PIN': '2PIN', '2PIN': '2PIN',
}

const VARIANT_KEYWORDS = /^(MAIN|OCTA|NEW|DAMD\.?|DISPLAY|FOR|MAINBOARD|MAIN BOARD)$/i
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

const PART_CODE_MAP: Record<string, string> = {
  BP: 'BP', 'BACK PANEL': 'BP', 'BACK COVER': 'BP', BK: 'BP',
  'BACK PANEL WITH LENS': 'BP', 'BACK PANEL WL': 'BP',
  'BACK PANAL': 'BP', 'BACK PANLE': 'BP', 'BACK PANNEL': 'BP',
  'BACK PAANEL': 'BP', BACKPANEL: 'BP',
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
  ONOFF: 'ONOFF', 'ON OFF': 'ONOFF', 'ON/OFF': 'ONOFF', 'ON OFF FLEX': 'ONOFF', 'ON/OFF FLEX': 'ONOFF',
  ONOFFSWITCH: 'ONOFFSWITCH', 'ON OFF SWITCH': 'ONOFFSWITCH', 'ONOFF SWITCH': 'ONOFFSWITCH',
  SWITCH: 'ONOFFSWITCH', TIKLI: 'ONOFFSWITCH',
  VOL: 'VOL', 'VOL FLEX': 'VOL', 'VOLUME FLEX': 'VOL', 'VOLLUME FLEX': 'VOL',
  CCFLEX: 'CCFLEX', 'CC FLEX': 'CCFLEX', 'CHARGING FLEX': 'CCFLEX', 'CHARGING PORT FLEX': 'CCFLEX',
  CHG: 'CHG',
  RB: 'RB', 'RINGER BOX': 'RB', RINGER: 'RB',
  SPK: 'SPK', SPEAKER: 'SPK',
  SPKF: 'SPKF', 'SPEAKER FLEX': 'SPKF', 'SPK FLEX': 'SPKF',
  'ONLY SPEAKER FLEX': 'SPKF', 'SPK FLEX ONLY': 'SPKF', 'SPK FLEX COPY': 'SPKF',
  SPKFL: 'SPKFL', 'ONLY FLEX': 'SPKFL', 'SPEAKER FLEX ONLY': 'SPKFL', 'FLEX ONLY': 'SPKFL',
  SPKJ: 'SPKJ', 'SPEAKER JALI': 'SPKJ', 'SPEAKER/RINGER JALI': 'SPKJ', 'RINGER JALI': 'SPKJ',
  ESPK: 'ESPK', 'EXX-BEE': 'ESPK', 'EXX BEE': 'ESPK', EXXBEE: 'ESPK',
  EARPIECE: 'ESPK', 'EAR SPEAKER': 'ESPK', 'EAR SPK': 'ESPK',
  ESPKF: 'ESPKF', 'EXX-BEE FLEX': 'ESPKF', 'EARPIECE FLEX': 'ESPKF',
  ESPKFL: 'ESPKFL', 'EXX-BEE ONLY FLEX': 'ESPKFL', 'EARPIECE FLEX ONLY': 'ESPKFL',
  'SPEAKER FLEX EXX-BEE': 'ESPKF',
  'SPEAKER FLEX EXX BEE': 'ESPKF',
  'EXX-BEE SPEAKER FLEX': 'ESPKF',
  'EXX BEE SPEAKER FLEX': 'ESPKF',
  'SPEAKER EXX-BEE': 'ESPK',
  'SPEAKER EXX BEE': 'ESPK',
  'EXX-BEE SPEAKER': 'ESPK',
  'EXX BEE SPEAKER': 'ESPK',
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
  NETWORKWIRE: 'NETWORKWIRE', 'NETWORK WIRE': 'NETWORKWIRE',
  WIRE: 'WIRE', TOOL: 'TOOL', FLEX: 'FLEX',
}

const FLAG_MAP: Record<string, string> = {
  WL: 'WL', 'W/L': 'WL', 'WITH LENS': 'WL', 'WITH LOGO': 'WL',
  FLEX: 'FLEX', SET: 'SET', FRONT: 'FRONT', BACK: 'BACK',
  'W/C': 'WC', WC: 'WC', 'W/C/L': 'WCL', 'W/CL': 'WCL', WCL: 'WCL',
  COPY: 'COPY',
  METAL: 'METAL',
}

const PART_CODE_TOKENS = new Set<string>([
  'BP', 'BK', 'FH', 'MF', 'MD', 'MFF', 'LCD', 'LCDCON', 'LCDRING',
  'BATCON', 'BOARDCONN', 'SENSORCONN', 'SENSORSIDE', 'SENSOR',
  'ONOFF', 'ONOFFSWITCH', 'VOL',
  'CCFLEX', 'CHG', 'RB', 'SPK', 'SPKF', 'SPKFL', 'SPKJ', 'ESPK',
  'ESPKF', 'ESPKFL', 'CG', 'CL', 'CAM', 'ST', 'GASKIT', 'GASKITF',
  'GASKITB', 'OUTKEY', 'MIC', 'VIB', 'ANT', 'INRUBBER', 'BACKGLASS',
  'FF', 'BCAM', 'FCAM', 'CONVHOUSING', 'NETWORKWIRE', 'WIRE', 'TOOL', 'FLEX',
])

const QUALITY_TOKEN_REGEX = /^(100\s*%?\s*(?:OG|ORIG|ORIGINAL)|100OG|OG|ORI|ORIG|ORIGINAL|ORG|CARE(?:\s*(?:OG|ORIG|ORIGINAL))?|CHINA\s*(?:OG|ORIG|ORIGINAL)|C\+|MIX\s+OG)$/i

const TRAILING_QUALITY_REGEX = /\s+(100\s*%?(?:\s*(?:OG|ORIG|ORIGINAL))?|100OG|OG|ORI|ORIG|ORIGINAL|ORG|CHINA\s*(?:OG|ORIG|ORIGINAL))\s*$/i

const TRAILING_FLAG_REGEX = /\s+(W\s*\/\s*C(?:\s*\/\s*L)?|WC|WCL|W\s*\/\s*CL|WL)\b/i

const PART_TYPE_PHRASES: string[] = [
  'SPEAKER FLEX EXX-BEE', 'SPEAKER FLEX EXX BEE',
  'EXX-BEE SPEAKER FLEX', 'EXX BEE SPEAKER FLEX',
  'SPEAKER EXX-BEE', 'SPEAKER EXX BEE',
  'EXX-BEE SPEAKER', 'EXX BEE SPEAKER',
  'EAR SPEAKER', 'EAR SPK', 'BACK CAMERA', 'FRONT CAMERA', 'BACK CAM', 'FRONT CAM',
  'FLASH FLEX', 'TYPE FLASH FLEX', 'TYPE FLASH', 'SENSOR [SIDE]', 'SENSOR SIDE',
  'SENSOR CONNECTOR', 'SENSOR CONN.', 'SENSOR CONN', 'SENSOR',
  'IN RUBBER', 'INRUBBER', 'NETWORK WIRE', 'NETWORKWIRE', 'WIRE', 'TOOL', 'FLEX',
  'MIDDLE FRAME WITH FLEX', 'ON OFF SENSOR CONN',
  'ONLY EARPIECE FLEX', 'EARPIECE FLEX ONLY',
  'ONLY SPEAKER FLEX', 'SPEAKER FLEX ONLY', 'SPK FLEX COPY', 'SPK FLEX ONLY',
  'SPEAKER/RINGER JALI', 'SPEAKER / RINGER JALI', 'SPEAKER/ RINGER JALI', 'SPEAKER /RINGER JALI', 'RINGER JALI',
  'CONVERTER HOUSING', 'CONVETOR HOUSING', 'CONVERT HOUSING', 'CONVERT HOUSIG',
  'CONVERTER', 'CONVETOR', 'CONVERT',
  'BATTERY CONNECTOR', 'BATTERY CONN.', 'BATTERY CONN',
  'B/C CONN.', 'B/C CONN', 'BOARD CONN.', 'BOARD CONN', 'BORD CONN.', 'BORD CONN',
  'LCD CONNECTOR', 'LCD CONN.', 'LCD CONN', 'LCD RING',
  'GAS KIT FRONT', 'GAS KIT BACK', 'GAS KIT',
  'ON OFF', 'ON/OFF', 'ON OFF SWITCH', 'ONOFF SWITCH', 'TIKLI', 'ON OFF FLEX', 'ON/OFF FLEX',
  'ONLY FLEX', 'FLEX ONLY',
  'OUT SIM TRAY', 'OUT SIM TRY', 'SIM TRAY', 'SIM TRY',
  'SPEAKER JALI', 'SPEAKER FLEX', 'SPK FLEX', 'SPEAKER',
  'CAMERA GLASS', 'CAMERA LENS', 'CAMERA FLEX', 'CHARGING FLEX', 'CC FLEX',
  'MIDDLE FRAME', 'BACK GLASS',
  'BACK PANEL', 'BACK PANLE', 'BACK PANAL', 'BACK PANNEL', 'BACK PAANEL', 'BACKPANEL', 'BACK COVER',
  'FULL HOUSING', 'LCD FLEX', 'RINGER BOX', 'RINGER',
  'VOLUME FLEX', 'VOLLUME FLEX', 'VOL FLEX',
  'OUT KEY', 'VIBRATOR', 'ANTENNA',
  'B/C', 'MIC', 'BP', 'FH', 'MF', 'MD', 'BK', 'LCD', 'RB', 'SPK',
]

// ============================================================
// CSV utilities
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

export function findColumnIndex(headers: string[], candidates: string[]): number {
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
    .replace(/\b(SAM|MI|IP|VV|OP|RM|NK|TEC|INF|HUA|ITL|JIO|MT|NOTH|ONE)([A-Z])(\d)/g, '$1 $2$3')
    .replace(/\b1\s*\+\s*(\d)/g, '1+ $1')
    .replace(/\b1\s*\+\s*(?=[A-Z])/gi, '1+ ')
    .replace(/(\d)\+/g, (m, d) => (d === '1' ? m : d + ' PLUS'))
    .replace(/\bOPPO\s*-?\s*REALME\b/gi, 'REALME')
    .replace(/\bPANLE\b/gi, 'PANEL')
    .replace(/\bPANAL\b/gi, 'PANEL')
    .replace(/\bPANNEL\b/gi, 'PANEL')
    .replace(/\bPAANEL\b/gi, 'PANEL')
    .replace(/\bBORD\b/gi, 'BOARD')
    .replace(/\bC\s*\/\s*C\b/gi, 'CC')
    .replace(/\bOUT\s+SIM\s+TRY\b/gi, 'OUT SIM TRAY')
    .replace(/\bSIM\s+TRY\b/gi, 'SIM TRAY')
    .replace(/\bHOUSIG\b/gi, 'HOUSING')
    .replace(/\bSAMRT\b/gi, 'SMART')
    .replace(/\bCONVETOR\b/gi, 'CONVERTER')
    .replace(/\bCONNVETOR\b/gi, 'CONVERTER')
    .replace(/\bCOVERT\b/gi, 'CONVERT')
    .replace(/\bSILVAR\b/gi, 'SILVER')
    .replace(/\bVOLLUME\b/gi, 'VOLUME')
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

function containsColorWord(text: string): boolean {
  const upper = text.toUpperCase()
  return COLOR_WORDS.some((word) => {
    const re = new RegExp(`\\b${word}\\b`, 'i')
    return re.test(upper)
  })
}

function resolveColorAlias(text: string, colorAliases?: Record<string, string>): string | null {
  if (!colorAliases) return null
  const upper = text.toUpperCase().trim()
  return colorAliases[upper] || null
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
  colors: string[]
  network: string | null
  quality: Quality | null
  flag: string | null
  size: string | null
  variant: string | null
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

    const hundredMatch = upper.match(/\b100\s*%?(?:\s*(?:OG|ORIG|ORIGINAL))?\b/)
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

    const residual = upper
      .replace(/\b100\s*%?(?:\s*(?:OG|ORIG|ORIGINAL))?\b/g, ' ')
      .replace(/\bCHINA\s*(?:OG|ORIG|ORIGINAL)\b/g, ' ')
      .replace(/\bC\+\b/g, ' ')
      .replace(/\bCARE\b/g, ' ')
      .replace(/\b(ORI|ORIG|ORIGINAL|ORG)\b/g, ' ')
      .replace(/\bMIX\s+OG\b/g, ' ')
      .replace(/\bOG\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (residual.length > 0) remaining.push(residual)
  }

  return { quality, remainingMarkers: remaining }
}

function classifyMarkers(
  markers: string[],
  colorAliases?: Record<string, string>
): {
  variant: string | null
  year: string | null
  network: string | null
  flag: string | null
  size: string | null
  color: string | null
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

    const aliasColor = resolveColorAlias(upper, colorAliases)
    if (aliasColor) {
      if (!color) color = aliasColor
      continue
    }

    if (containsColorWord(upper)) {
      if (!color) color = upper.replace(/\s*\/\s*/g, '-').replace(/\s+/g, '-')
      continue
    }
  }

  return { variant, year, network, flag, size, color, modelAlias }
}

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
  const candidates: Array<{
    brandCode: string
    matchIndex: number
    matchLength: number
    matchedKey: string
  }> = []

  const keys = Object.keys(aliases.brandAliases).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (key.length < 2) continue
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^A-Z0-9])(${escaped})(?=[^A-Z0-9]|$)`, 'i')
    const m = re.exec(upper)
    if (!m) continue

    const brandCode = aliases.brandAliases[key]
    if (!brandCode) continue

    candidates.push({
      brandCode,
      matchIndex: m.index + m[1].length,
      matchLength: key.length,
      matchedKey: key,
    })
  }

  if (candidates.length === 0) {
    return { brandCode: null, matchIndex: -1, matchLength: 0, matchedKey: '' }
  }

  candidates.sort((a, b) => {
    if (b.matchLength !== a.matchLength) return b.matchLength - a.matchLength
    if (b.matchIndex !== a.matchIndex) return b.matchIndex - a.matchIndex
    return b.matchedKey.length - a.matchedKey.length
  })

  const winner = candidates[0]
  return {
    brandCode: winner.brandCode,
    matchIndex: winner.matchIndex,
    matchLength: winner.matchLength,
    matchedKey: winner.matchedKey,
  }
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

  const bare = upper.replace(/[^A-Z0-9]/g, '')
  if (bare.length === 0 || bare.length > 10) return null
  if (!/^[A-Z0-9]+$/.test(bare)) return null
  return bare
}

function normalizeModelName(model: string | null): {
  model: string | null
  strippedPart: string | null
} {
  if (!model) return { model: null, strippedPart: null }

  let cleaned = model
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[*'`"]/g, '')
    .replace(/[^A-Z0-9+\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return { model: null, strippedPart: null }

  let strippedPart: string | null = null
  const wordsBeforeRules = cleaned.split(/\s+/)
  if (wordsBeforeRules.length > 1) {
    const lastWord = wordsBeforeRules[wordsBeforeRules.length - 1]
    if (PART_CODE_TOKENS.has(lastWord)) {
      strippedPart = lastWord
      wordsBeforeRules.pop()
      cleaned = wordsBeforeRules.join(' ')
    }
  }

  if (!cleaned) return { model: null, strippedPart }

  const MARKER_BEFORE_DIGIT = /\b(FLEX|SET|WITH|OG|ORI|ORIG|ORIGINAL|ORG|CARE|CHINA|100|%|BP|BK|FH|MF|MFF|LCD|SPK|SPKF|SPKJ|RB|CAM|CG|CL|ST|MIC|VIB|ANT)\s+\d$/i
  if (MARKER_BEFORE_DIGIT.test(cleaned)) {
    cleaned = cleaned.replace(/\s+\d$/, '').trim()
  }

  if (!cleaned) return { model: null, strippedPart }

  cleaned = cleaned.replace(/\b([A-Z]{1,2})\s+(\d)/g, (match, letters, digits) => {
    if (letters.toUpperCase() === 'TO') return match
    if (letters.toUpperCase() === 'RE') return match
    return letters + digits
  })
  cleaned = cleaned.replace(/\b(\d+)\s+([A-Z]{1,2})\b/g, '$1$2')
  cleaned = cleaned.replace(/\b(\d+)\s+([A-Z])\b/g, '$1$2')

  if (!cleaned) return { model: null, strippedPart }

  cleaned = cleaned.replace(TRAILING_QUALITY_REGEX, '').trim()
  if (!cleaned) return { model: null, strippedPart }

  cleaned = cleaned.replace(/\s+(SMALL|BIG|MEDIUM|BIGSIZE|SMALLSIZE|MEDIUMSIZE|\d{1,3}\s*MM|\d{1,2}\s*PIN)\s*$/i, '').trim()
  if (!cleaned) return { model: null, strippedPart }

  if (!cleaned) return { model: null, strippedPart }
  const finalWords = cleaned.split(/\s+/)
  if (finalWords.length === 1) {
    const w = finalWords[0]
    if (PART_CODE_TOKENS.has(w)) return { model: null, strippedPart }
    if (QUALITY_TOKEN_REGEX.test(w)) return { model: null, strippedPart }
  }

  return { model: cleaned, strippedPart }
}

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
  if (year) seg.push(year)
  seg.push(partCode)
  if (network) seg.push(network)
  if (flag) seg.push(dash(flag))
  if (variant) seg.push(dash(variant))
  if (color) seg.push(dash(color))
  if (quality === 'OG') seg.push('OG')
  else if (quality === '100 OG') seg.push('100OG')
  else if (quality === 'Care OG') seg.push('CARE')
  else if (quality === 'China OG') seg.push('CHINAOG')

  return seg.filter(Boolean).join('-')
}

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

  for (const [, idxs] of skuMap.entries()) {
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

// ============================================================
// extractPartFromDescription — fallback only
// ============================================================

function extractPartFromDescription(
  desc: string,
  aliases?: AliasMaps
): { partText: string | null; cleanedDesc: string } {
  const upper = desc.toUpperCase()

  const dbPhrases = aliases ? Object.keys(aliases.partAliases) : []
  const allPhrases = Array.from(new Set([...dbPhrases, ...PART_TYPE_PHRASES]))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  for (const phrase of allPhrases) {
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
// scanDescription — single-pass dictionary-driven scanner
// ============================================================

type ScanResult = {
  brandCode: string | null
  partCode: string | null
  quality: Quality
  network: string | null
  year: string | null
  size: string | null
  flag: string | null
  color: string | null
  variant: string | null
  modelText: string
  matchedPartPhrase: string | null
}

function scanDescription(text: string, aliases: AliasMaps): ScanResult {
  const work = normalizeTypos(text).toUpperCase()
  const strongestBrand = findBrandAnywhere(work, aliases)

  const partPhraseMap: Record<string, string> = {}
  for (const p of Object.keys(aliases.partAliases)) {
    partPhraseMap[p.toUpperCase()] = aliases.partAliases[p]
  }
  for (const phrase of PART_TYPE_PHRASES) {
    const key = phrase.toUpperCase()
    if (!partPhraseMap[key]) {
      const code = PART_CODE_MAP[key]
      if (code) partPhraseMap[key] = code
    }
  }
  const partPhrases = Object.keys(partPhraseMap).sort((a, b) => b.length - a.length)

  const brandPhraseMap: Record<string, string> = {}
  for (const b of Object.keys(aliases.brandAliases)) {
    brandPhraseMap[b.toUpperCase()] = aliases.brandAliases[b]
  }
  const brandPhrases = Object.keys(brandPhraseMap).sort((a, b) => b.length - a.length)

  const colorPhraseMap: Record<string, string> = {}
  for (const c of Object.keys(aliases.colorAliases || {})) {
    colorPhraseMap[c.toUpperCase()] = (aliases.colorAliases || {})[c]
  }
  for (const c of COLOR_WORDS) {
    if (!colorPhraseMap[c]) colorPhraseMap[c] = c
  }
  const colorPhrases = Object.keys(colorPhraseMap).sort((a, b) => b.length - a.length)

  let brandCode: string | null = strongestBrand.brandCode
  let partCode: string | null = null
  let quality: Quality = 'Normal'
  let network: string | null = null
  let year: string | null = null
  let size: string | null = null
  let flag: string | null = null
  let color: string | null = null
  let variant: string | null = null
  let matchedPartPhrase: string | null = null

  const consumed: boolean[] = Array(work.length).fill(false)

  function tryMatchAt(pos: number, phrase: string): boolean {
    const upperPhrase = phrase.toUpperCase()
    if (pos > 0 && /[A-Z0-9]/.test(work[pos - 1])) return false
    const end = pos + upperPhrase.length
    if (end > work.length) return false
    const slice = work.slice(pos, end)
    if (slice !== upperPhrase) return false
    if (end < work.length && /[A-Z0-9]/.test(work[end])) return false
    for (let i = pos; i < end; i++) if (consumed[i]) return false
    return true
  }

  function consume(pos: number, len: number) {
    for (let i = pos; i < pos + len; i++) consumed[i] = true
  }

  function extendColor(
    colorPos: number,
    colorLen: number
  ): { start: number; end: number; text: string } {
    let start = colorPos
    let end = colorPos + colorLen

    function isModifierCandidate(ws: number, we: number): boolean {
      if (ws < 0 || we > work.length) return false
      const w = work.slice(ws, we)
      if (w.length < 4) return false
      if (!/^[A-Z]+$/.test(w)) return false
      if (VARIANT_KEYWORDS.test(w)) return false
      if (SIZE_MARKERS[w]) return false
      if (FLAG_MAP[w]) return false
      if (COLOR_WORDS.includes(w)) return false
      for (let i = ws; i < we; i++) if (consumed[i]) return false
      return true
    }

    let p = start - 1
    while (p >= 0 && (work[p] === ' ' || work[p] === '(' || work[p] === ')')) p--
    if (p >= 0) {
      const we = p + 1
      let ws = p
      while (ws >= 0 && /[A-Z]/.test(work[ws])) ws--
      ws++
      if (isModifierCandidate(ws, we)) {
        start = ws
        return {
          start,
          end,
          text: work.slice(start, end).replace(/\s+/g, ' ').trim(),
        }
      }
    }

    let q = end
    while (
      q < work.length &&
      (work[q] === ' ' || work[q] === '(' || work[q] === ')')
    )
      q++
    if (q < work.length) {
      const ws = q
      let we = q
      while (we < work.length && /[A-Z]/.test(work[we])) we++
      if (isModifierCandidate(ws, we)) {
        end = we
        return {
          start,
          end,
          text: work.slice(start, end).replace(/\s+/g, ' ').trim(),
        }
      }
    }

    return {
      start,
      end,
      text: work.slice(start, end).replace(/\s+/g, ' ').trim(),
    }
  }

  let pos = 0
  while (pos < work.length) {
    if (
      consumed[pos] ||
      work[pos] === ' ' ||
      work[pos] === '(' ||
      work[pos] === ')'
    ) {
      pos++
      continue
    }

    let matched = false
    for (const phrase of partPhrases) {
      if (tryMatchAt(pos, phrase)) {
        const code = partPhraseMap[phrase]
        if (!partCode) {
          partCode = code
          matchedPartPhrase = phrase
        }
        consume(pos, phrase.length)
        pos += phrase.length
        matched = true
        break
      }
    }
    if (matched) continue

    const qualityPatterns: { re: RegExp; q: Quality }[] = [
      { re: /^100\s*%?\s*(?:OG|ORIG|ORIGINAL)/i, q: '100 OG' },
      { re: /^100\s*%?/i, q: '100 OG' },
      { re: /^CHINA\s*(?:OG|ORIG|ORIGINAL)/i, q: 'China OG' },
      { re: /^CARE\s*(?:OG|ORIG|ORIGINAL)?/i, q: 'Care OG' },
      { re: /^(?:OG|ORI|ORIG|ORIGINAL|ORG)(?![A-Z0-9])/i, q: 'OG' },
      { re: /^C\+/i, q: 'China OG' },
    ]
    for (const { re, q } of qualityPatterns) {
      const m = work.slice(pos).match(re)
      if (m && tryMatchAt(pos, m[0])) {
        if (quality === 'Normal') quality = q
        consume(pos, m[0].length)
        pos += m[0].length
        matched = true
        break
      }
    }
    if (matched) continue

    const netMatch = work.slice(pos).match(/^(?:4G|5G)(?![A-Z0-9])/i)
    if (netMatch && tryMatchAt(pos, netMatch[0])) {
      if (!network) network = netMatch[0].toUpperCase()
      consume(pos, netMatch[0].length)
      pos += netMatch[0].length
      continue
    }

    const yearMatch = work.slice(pos).match(/^(?:19|20)\d{2}(?![A-Z0-9])/)
    if (yearMatch && tryMatchAt(pos, yearMatch[0])) {
      if (!year) year = yearMatch[0]
      consume(pos, yearMatch[0].length)
      pos += yearMatch[0].length
      continue
    }

    let sizeMatched = false
    for (const [k, v] of Object.entries(SIZE_MARKERS)) {
      if (tryMatchAt(pos, k)) {
        if (!size) size = v
        consume(pos, k.length)
        pos += k.length
        sizeMatched = true
        break
      }
    }
    if (sizeMatched) continue

    let flagMatched = false
    const flagKeys = Object.keys(FLAG_MAP).sort((a, b) => b.length - a.length)
    for (const k of flagKeys) {
      if (tryMatchAt(pos, k)) {
        if (!flag) flag = FLAG_MAP[k]
        consume(pos, k.length)
        pos += k.length
        flagMatched = true
        break
      }
    }
    if (flagMatched) continue

    let colorMatched = false
    for (const phrase of colorPhrases) {
      if (tryMatchAt(pos, phrase)) {
        if (!color) {
          const ext = extendColor(pos, phrase.length)
          if (ext.start < pos || ext.end > pos + phrase.length) {
            for (let i = ext.start; i < ext.end; i++) {
              if (
                work[i] !== ' ' &&
                work[i] !== '(' &&
                work[i] !== ')'
              ) {
                consumed[i] = true
              }
            }
            color = ext.text
            pos = ext.end
          } else {
            color = colorPhraseMap[phrase]
            consume(pos, phrase.length)
            pos += phrase.length
          }
        } else {
          consume(pos, phrase.length)
          pos += phrase.length
        }
        colorMatched = true
        break
      }
    }
    if (colorMatched) continue

    const variantMatch = work
      .slice(pos)
      .match(
        /^(?:BOX\s*PACKING|BOXPACKING|MAIN|OCTA|NEW|DAMD\.?|DISPLAY|FOR|MAINBOARD|MAIN BOARD)(?![A-Z0-9])/i
      )
    if (variantMatch && tryMatchAt(pos, variantMatch[0])) {
      const v = variantMatch[0].toUpperCase().replace(/\.$/, '')
      if (!variant)
        variant =
          v === 'BOX PACKING' || v === 'BOXPACKING' ? 'BOX-PACKING' : v
      consume(pos, variantMatch[0].length)
      pos += variantMatch[0].length
      continue
    }

    // Brand block — do NOT consume if brandCode already set.
    // The token falls through to model text.
    let brandMatched = false
    for (const phrase of brandPhrases) {
      if (phrase.length < 2) continue
      if (tryMatchAt(pos, phrase)) {
        if (!brandCode) {
          brandCode = brandPhraseMap[phrase]
          consume(pos, phrase.length)
          pos += phrase.length
          brandMatched = true
          break
        }
        // brand already set — skip this match, let the char fall through
      }
    }
    if (brandMatched) continue

    pos++
  }

  let modelText = ''
  let i = 0
  while (i < work.length) {
    if (!consumed[i]) {
      modelText += work[i]
    } else {
      modelText += ' '
    }
    i++
  }
  modelText = modelText.replace(/\s+/g, ' ').trim()

  const finalBrandCode = strongestBrand.brandCode || brandCode
  if (finalBrandCode) {
    const brandAliases = Object.keys(aliases.brandAliases)
      .filter((key) => key.length >= 2)
      .sort((a, b) => b.length - a.length)

    for (const alias of brandAliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, 'gi')
      modelText = modelText.replace(re, (_m, prefix, suffix) => `${prefix}${suffix}`.trim())
    }

    modelText = modelText.replace(/\s+/g, ' ').trim()
  }

  return {
    brandCode: finalBrandCode,
    partCode,
    quality,
    network,
    year,
    size,
    flag,
    color,
    variant,
    modelText,
    matchedPartPhrase,
  }
}

// ============================================================
// parseCSV — v34
// ============================================================

export function parseCSV(
  text: string,
  aliases: AliasMaps,
  items: ItemLookup[] = []
): ParsedRow[] {
  const safeAliases: AliasMaps = {
    ...aliases,
    brandAliases: withFallbackBrandAliases(aliases.brandAliases),
  }

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
    'itemname',
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

    const rawDescFromRow = colDesc >= 0 ? row[colDesc] || '' : ''
    const rawTypeFromRow =
      colPart >= 0 ? (row[colPart] || '').toUpperCase().trim() : ''
    const rawQtyCell = colQty >= 0 ? row[colQty] || '' : ''
    const rawRateCell = colRate >= 0 ? row[colRate] || '' : ''

    const qty = parseFloat(String(rawQtyCell).replace(/[^\d.-]/g, '')) || 0
    const rate = parseFloat(String(rawRateCell).replace(/[^\d.-]/g, '')) || 0

    let pendingError: string | null = null

    if (!isNewFormat && colDesc >= 0 && row.length < header.length) {
      pendingError = `Wrong column count`
    } else if (!isNewFormat && !rawDescFromRow && !rawTypeFromRow) {
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
      const brandRaw = normalizeTypos(
        (row[colBrand] || '').toUpperCase().trim()
      )
      const modelRaw = normalizeTypos((row[colModel] || '').trim())
      const partRaw = normalizeTypos(
        (row[colPart] || '').toUpperCase().trim()
      )

      rawDescription = `${brandRaw} ${modelRaw}`
      rawType = partRaw

      network = (modelRaw.match(/\b(4G|5G)\b/i) || [null])[0]
      if (network) network = network.toUpperCase()

      brandCode = safeAliases.brandAliases[brandRaw] || brandRaw
      const nm = normalizeModelName(
        modelRaw.replace(/\(4G\)|\(5G\)/gi, '').trim()
      )
      modelName = nm.model

      const directAlias = aliases.partAliases[partRaw]
      if (directAlias) {
        partCode = directAlias
      } else {
        const typeExtracted = extractPartFromDescription(partRaw, aliases)
        if (typeExtracted.partText) {
          partCode =
            aliases.partAliases[typeExtracted.partText.toUpperCase()] ||
            normalizePartCode(typeExtracted.partText)
        } else if (/^[A-Z0-9]{1,10}$/i.test(partRaw.trim())) {
          partCode = normalizePartCode(partRaw)
        }
      }
      if (nm.strippedPart && !partCode) {
        partCode =
          aliases.partAliases[nm.strippedPart] ||
          normalizePartCode(nm.strippedPart)
      }
    } else {
      rawDescription = rawDescFromRow
      rawType = rawTypeFromRow

      let combined = `${rawDescFromRow} ${rawTypeFromRow}`.trim()

      // Curly-brace quality extraction — before any strip
      const curlyMatches = combined.match(/\{[^}]*\}/g)
      if (curlyMatches) {
        for (const block of curlyMatches) {
          const inner = block.slice(1, -1).trim().toUpperCase()
          if (/100\s*%/.test(inner) || inner === '100') {
            quality = '100 OG'
            break
          }
          if (/CHINA/.test(inner)) {
            quality = 'China OG'
            break
          }
          if (/CARE/.test(inner)) {
            quality = 'Care OG'
            break
          }
          if (/\b(OG|ORIG|ORIGINAL|ORI|ORG)\b/.test(inner)) {
            quality = 'OG'
            break
          }
        }
      }

      // v33: bracket strip preserves content, drops brackets
      combined = combined.replace(/\[([^\]]*)\]/g, (match, inner) => {
        const upper = inner.trim().toUpperCase()
        if (FLAG_MAP[upper]) return ' ' + inner + ' '
        if (SIZE_MARKERS[upper]) return ' ' + inner + ' '
        if (/EXX\s*-?\s*BEE/i.test(inner)) return ' ' + inner + ' '
        if (
          /^(ORI|ORIG|ORIGINAL|OG|C\+|CARE(?:\s*(?:OG|ORIG|ORIGINAL))?|100\s*%?\s*(?:OG|ORIG|ORIGINAL)?|CHINA\s*(?:OG|ORIG|ORIGINAL))$/i.test(upper)
        )
          return ' ' + inner + ' '
        return ' '
      })

      const paren = extractParentheticals(combined)
      const working = paren.cleanedDesc

      const scan = scanDescription(working, safeAliases)

      brandCode = scan.brandCode
      partCode = scan.partCode
      // Quality precedence: scan quality (from text) OR paren OR curly.
      // Curly extraction ran before strips, so it's the most explicit.
      if (quality === 'Normal') {
        quality = paren.quality || scan.quality
      }
      network = paren.network || scan.network || null
      year = paren.year || scan.year || null
      variant = paren.variant || scan.variant || scan.size || null
      flag = paren.flag || scan.flag || null

      if (paren.colors.length > 0) {
        color = paren.colors[0]
      } else if (scan.color) {
        color = scan.color
      }

      const nm = normalizeModelName(scan.modelText)
      modelName = nm.model
      if (nm.strippedPart && !partCode) {
        partCode =
          aliases.partAliases[nm.strippedPart] ||
          normalizePartCode(nm.strippedPart)
      }

      if (!partCode) {
        const fallback = extractPartFromDescription(working, aliases)
        if (fallback.partText) {
          partCode =
            aliases.partAliases[fallback.partText.toUpperCase()] ||
            normalizePartCode(fallback.partText)
        }
      }

      if (!brandCode && modelName) {
        const bm = findBrandAnywhere(modelName, safeAliases)
        if (bm.brandCode) {
          brandCode = bm.brandCode
          const after =
            modelName.slice(0, bm.matchIndex) +
            ' ' +
            modelName.slice(bm.matchIndex + bm.matchLength)
          const nm2 = normalizeModelName(after.trim())
          modelName = nm2.model
        }
      }
    }

    if (!brandCode && partCode) {
      brandCode = 'GEN'
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
      console.log(
        `Row ${f.rowNumber}: "${f.rawDescription}" [type: "${f.rawType}"]`
      )
      console.log(`   → ${f.errorMessage}`)
    }
    if (failed.length > 20) console.log(`   ... ${failed.length - 20} more`)
    console.log(`===== END =====\n`)
  }

  return flagged
}