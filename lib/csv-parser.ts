// lib/csv-parser.ts — v36.0 — two-pass resolver, entry-first contract
//
// CONTRACT
//   Entry: every line produces a correct, non-leaking SKU, or a visible
//   `needs_correction` row. Nothing is silently dropped. Ambiguity is a
//   warning, not a blocker. Audit (drift reconciliation) is downstream and
//   does not shape entry behaviour.
//
//   Resolver: pass 1 collects every candidate match; pass 2 resolves by
//   (longer span) > (type priority) > (leftmost). Deterministic, no
//   first-match leaks.
//
//   Three row states:
//     'matched' | 'new'  -> import-ready (may carry warnings[])
//     'needs_correction' -> no SKU / hard failure; operator fixes in staging
//   parseCSV throws only if called without setDBMessages() (programmer bug).
//
//   Model segment: all model-like tokens, sorted lexicographically, so the
//   same shared part converges to one SKU regardless of invoice word order.
//   Fitment is therefore preserved in the SKU, not dropped and not privileged.
//
//   Two entry categories, one pipeline:
//     phone part   -> brand-<sorted models>-part-...
//     general item -> GEN|TOOL-<sorted specs>-<type>-...  (is_general_item)

export type Quality =
  | 'Normal'
  | 'OG'
  | '100 OG'
  | 'Care OG'
  | 'China OG'
  | 'GL'
  | 'PGL'

export type RowStatus = 'matched' | 'new' | 'needs_correction'

export type ParsedRow = {
  rowNumber: number
  rawDescription: string
  rawType: string
  qty: number
  rate: number
  brandCode: string | null
  modelName: string | null        // sorted, dashed model/spec segment
  network: string | null
  year: string | null
  size: string | null
  variant: string | null
  partCode: string | null
  quality: Quality
  flag: string | null
  color: string | null
  generatedSku: string | null
  matchedItemId: number | null
  matchedItemSku: string | null
  status: RowStatus
  errorMessage?: string
  warnings: string[]
  is_general_item: boolean
  isReturnLine: boolean
  category_code?: string | null
}

export type AliasMaps = {
  brandAliases: Record<string, string>
  partAliases: Record<string, string>
  colorAliases?: Record<string, string>
  validBrandCodes?: string[]
}

export type TypoRule = {
  pattern: string
  replacement: string
  match_type: 'word' | 'phrase' | 'regex'
  priority?: number
}

export type DBMessages = {
  partAliases: Record<string, string>
  brandAliases: Record<string, string>
  colorAliases: Record<string, string>
  flagAliases: Record<string, string>
  qualityAliases: Record<string, string>
  variantAliases: Record<string, string>
  typoRules: TypoRule[]
}

let dbCache: DBMessages | null = null

export function setDBMessages(messages: DBMessages | null): void {
  dbCache = messages
}

export function clearDBMessages(): void {
  dbCache = null
}

export function hasDBMessages(): boolean {
  return dbCache !== null
}

export function previewNormalizedText(text: string): string {
  return normalizeTypos(text).toUpperCase()
}

// ---------------------------------------------------------------------------
// Typo normalization (data normalization only — NO reorder rules)
// ---------------------------------------------------------------------------

export function applyTypoRules(text: string, rules: TypoRule[]): string {
  if (!rules || rules.length === 0) return text
  let t = text
  const sorted = [...rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
  for (const rule of sorted) {
    try {
      if (rule.match_type === 'word') {
        const re = new RegExp(`\\b${rule.pattern}\\b`, 'gi')
        t = t.replace(re, rule.replacement)
      } else if (rule.match_type === 'phrase') {
        const pattern = rule.pattern.replace(/\s+/g, '\\s+')
        const re = new RegExp(`\\b${pattern}\\b`, 'gi')
        t = t.replace(re, rule.replacement)
      } else if (rule.match_type === 'regex') {
        const re = new RegExp(rule.pattern, 'gi')
        t = t.replace(re, rule.replacement)
      }
    } catch {
      // bad regex in DB — skip
    }
  }
  return t
}

// Hardcoded typo fixes that are NOT data-dependent (grammar of the domain).
// Reorder rules are deliberately absent — the resolver handles order.
function normalizeTypos(desc: string): string {
  if (dbCache && dbCache.typoRules.length > 0) {
    desc = applyTypoRules(desc, dbCache.typoRules)
  }
  return desc
    .replace(/\b(SAM|MI|IP|VV|OP|RM|NK|TEC|INF|HUA|ITL|JIO|MT|NOTH|ONE)([A-Z])(\d)/g, '$1 $2$3')
    .replace(/\b1\s*\+\s*(\d)/g, '1+ $1')
    .replace(/\b1\s*\+\s*(?=[A-Z])/gi, '1+ ')
    .replace(/(\d)\+/g, (m, d) => (d === '1' ? m : d + ' PLUS'))
    .replace(/\bOPPO\s*-?\s*REALME\b/gi, 'REALME')
    .replace(/\bREALME\s*-?\s*POCO\b/gi, 'POCO')
    .replace(/\bRE\s*-?\s*POCO\b/gi, 'POCO')
    .replace(/\bNOTHING\s+CMF\b/gi, 'CMF')
    .replace(/\b(MIDDLE\s+FRAME|MF)\s+WITH\s+FLEX\b/gi, 'MIDDLE FRAME WITH FLEX')
    .replace(/\bSMA\s*(\d)/gi, 'SAM A$1')
    .replace(/\bMATEL\b/gi, 'METAL')
    .replace(/\bLENCE\b/gi, 'LENS')
    .replace(/\bREMOVE\b/gi, ' ')
    .replace(/\bOPPO([A-Z0-9])/gi, 'OPPO $1')
    .replace(/\bON\s*OFFFLEX\b/gi, 'ON OFF FLEX')
    .replace(/\bONOFFFLEX\b/gi, 'ON OFF FLEX')
    .replace(/\bOFFFLEX\b/gi, 'OFF FLEX')
    .replace(/\bVOLFLEX\b/gi, 'VOL FLEX')
    .replace(/\bLCDFLEX\b/gi, 'LCD FLEX')
    .replace(/\bFRONTCAMERA\b/gi, 'FRONT CAMERA')
    .replace(/\bBACKCAMERA\b/gi, 'BACK CAMERA')
    .replace(/\bRINGERBOX\b/gi, 'RINGER BOX')
    .replace(/\bBOARDCON\b/gi, 'BOARD CONN')
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
    .replace(/\bBEE\s*EXX\b/gi, 'EXX-BEE')
    .replace(/\bB\s*\/\s*C\b/gi, 'B/C')
    .replace(/\bB\s*\/\s*C\s+CONN\.?/gi, 'B/C CONN')
    .replace(/([A-Z])B\/C\b/gi, '$1 B/C')
    .replace(/BOX\s*PECKING/gi, 'BOX PACKING')
    .replace(/###/g, ' ')
    .replace(/[*'`"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Built-in fallback data (used only when dbCache is absent — tests/harness)
// ---------------------------------------------------------------------------

const BUILT_IN_BRAND_ALIASES: Record<string, string> = {
  OP: 'OP', RE: 'RE', OPPO: 'OP', REALME: 'RE',
  SAM: 'SAM', SM: 'SAM',
  VV: 'VV', VIVO: 'VV',
  IP: 'IP', IPHONE: 'IP',
  NK: 'NK', NOKIA: 'NK',
  RM: 'MI', MI: 'MI', REDMI: 'MI',
  IQOO: 'IQOO', CMF: 'CMF',
  GGL: 'GGL', GOOGLE: 'GGL',
  ONE: 'ONE', GENERIC: 'GEN', TOOL: 'TOOL',
  '1+': 'ONE', '1PLUS': 'ONE',
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
  '41 PIN': '41PIN', '41PIN': '41PIN',
}

const VARIANT_KEYWORDS = /^(MAIN(?:[-\s]?\d+)?|OCTA(?:[-\s]?\d+)?|NEW|DAMD\.?|DISPLAY|MAINBOARD|MAIN BOARD|REFRESH|MIX|SMB)$/i
const PACKAGING_VARIANT = /^(BOX\s*PECK?ING|BOX\s*PACKING|BOXPACKING|BOXPECKING)$/i

// Model-suffix words that are never a model token on their own
const MODEL_SUFFIX_WORDS = new Set([
  'PRO', 'PLUS', 'MAX', 'LITE', 'MINI', 'NEO', 'SE', 'ULTRA', 'FUSION',
  'STYLUS', 'CURVE', 'POWER', 'PLAY', 'CORE', 'PRIME', 'NARZO', 'TURBO',
])

// Part-code tokens that must never be captured as a model/spec token
const PART_CODE_TOKENS = new Set<string>([
  'BP', 'BK', 'FH', 'MF', 'MD', 'MFF', 'LCD', 'LCDCON', 'LCDRING',
  'BATCON', 'BOARDCONN', 'SENSORCONN', 'SENSORSIDE', 'SENSOR',
  'ONOFF', 'ONOFFSWITCH', 'VOL', 'CCFLEX', 'CHG', 'RB', 'SPK', 'SPKF',
  'SPKFL', 'SPKJ', 'RSPKJ', 'ESPK', 'ESPKF', 'ESPKFL', 'CG', 'CL', 'CAM',
  'ST', 'GASKIT', 'GASKITF', 'GASKITB', 'OUTKEY', 'MIC', 'VIB', 'ANT',
  'INRUBBER', 'BACKGLASS', 'FF', 'BCAM', 'FCAM', 'CONVHOUSING',
  'NETWORKWIRE', 'WIRE', 'TOOL', 'FLEX', 'MICFLEX', 'MICFLEXSIM',
  'LCDFLEXSIM', 'SIMFLEX', 'WIRELESSFLEX',
])

const GENERAL_ITEM_PART_CODES = new Set<string>([
  'TOOL', 'WIRE', 'NETWORKWIRE', 'WIRELESSFLEX',
])

const FLAG_MAP: Record<string, string> = {
  WL: 'WL', 'W/L': 'WL', 'WITH LENS': 'WL', 'WITH LOGO': 'WL',
  LENS: 'WL', 'WITH LENCE': 'WL',
  FLEX: 'FLEX', SET: 'SET', FRONT: 'FRONT', BACK: 'BACK',
  'W/C': 'WC', WC: 'WC', 'W/C/L': 'WCL', 'W/CL': 'WCL', WCL: 'WCL',
  COPY: 'COPY', METAL: 'METAL', GLASS: 'GLASS', NFC: 'NFC', SVC: 'SVC',
}

// Fallback part map (DB overrides this). Space form SPEAKER RINGER JALI -> SPKJ,
// RINGER JALI / RINGER NET -> RSPKJ, matching part_type_aliases rows 103-106, 338-341.
const PART_CODE_MAP: Record<string, string> = {
  BP: 'BP', 'BACK PANEL': 'BP', 'BACK COVER': 'BP', BK: 'BP',
  'BACK PANAL': 'BP', 'BACK PANLE': 'BP', 'BACK PANNEL': 'BP',
  'BACK PAANEL': 'BP', BACKPANEL: 'BP',
  FH: 'FH', 'FULL HOUSING': 'FH',
  MF: 'MF', 'MIDDLE FRAME': 'MF', MD: 'MF', MIDDLE: 'MF',
  MFF: 'MFF', 'MIDDLE FRAME WITH FLEX': 'MFF',
  LCD: 'LCD', 'LCD FLEX': 'LCD',
  LCDCON: 'LCDCON', 'LCD CONNECTOR': 'LCDCON', 'LCD CONN': 'LCDCON', 'LCD CON': 'LCDCON',
  LCDRING: 'LCDRING', 'LCD RING': 'LCDRING',
  BATCON: 'BATCON', 'BATTERY CONNECTOR': 'BATCON', 'BATTERY CONN': 'BATCON', BC: 'BATCON', 'B/C': 'BATCON', 'B/C CONN': 'BATCON',
  BOARDCONN: 'BOARDCONN', 'BOARD CONN': 'BOARDCONN', 'BORD CONN': 'BOARDCONN', 'BOARD CON': 'BOARDCONN',
  SENSORCONN: 'SENSORCONN', 'SENSOR CONN': 'SENSORCONN',
  SENSORSIDE: 'SENSORSIDE', 'SENSOR SIDE': 'SENSORSIDE', 'SENSOR [SIDE]': 'SENSORSIDE',
  SENSOR: 'SENSOR',
  ONOFF: 'ONOFF', 'ON OFF': 'ONOFF', 'ON/OFF': 'ONOFF', 'ON OFF FLEX': 'ONOFF', 'ON/OFF FLEX': 'ONOFF',
  ONOFFSWITCH: 'ONOFFSWITCH', 'ON OFF SWITCH': 'ONOFFSWITCH', 'ONOFF SWITCH': 'ONOFFSWITCH', TIKLI: 'ONOFFSWITCH',
  VOL: 'VOL', 'VOL FLEX': 'VOL', 'VOLUME FLEX': 'VOL', 'VOLLUME FLEX': 'VOL',
  CCFLEX: 'CCFLEX', 'CC FLEX': 'CCFLEX', 'CHARGING FLEX': 'CCFLEX', 'CHARGING PORT FLEX': 'CCFLEX',
  CHG: 'CHG',
  RB: 'RB', 'RINGER BOX': 'RB', RINGER: 'RB',
  SPK: 'SPK', SPEAKER: 'SPK',
  SPKF: 'SPKF', 'SPEAKER FLEX': 'SPKF', 'SPK FLEX': 'SPKF', 'SPK FLEX ONLY': 'SPKF',
  SPKFL: 'SPKFL', 'ONLY FLEX': 'SPKFL', 'SPEAKER FLEX ONLY': 'SPKFL', 'FLEX ONLY': 'SPKFL',
  SPKJ: 'SPKJ', 'SPEAKER JALI': 'SPKJ', 'SPEAKER/RINGER JALI': 'SPKJ', 'SPEAKER RINGER JALI': 'SPKJ',
  RSPKJ: 'RSPKJ', 'RINGER JALI': 'RSPKJ', 'RINGER NET': 'RSPKJ', 'RINGER JALI NET': 'RSPKJ', 'R NET': 'RSPKJ',
  ESPK: 'ESPK', 'EXX-BEE': 'ESPK', 'EXX BEE': 'ESPK', EXXBEE: 'ESPK',
  EARPIECE: 'ESPK', 'EAR SPEAKER': 'ESPK', 'EAR SPK': 'ESPK',
  ESPKF: 'ESPKF', 'EXX-BEE FLEX': 'ESPKF', 'EARPIECE FLEX': 'ESPKF',
  ESPKFL: 'ESPKFL', 'EXX-BEE ONLY FLEX': 'ESPKFL', 'EARPIECE FLEX ONLY': 'ESPKFL',
  'SPEAKER FLEX EXX-BEE': 'ESPKF', 'SPEAKER FLEX EXX BEE': 'ESPKF',
  'EXX-BEE SPEAKER FLEX': 'ESPKF', 'EXX BEE SPEAKER FLEX': 'ESPKF',
  'SPEAKER EXX-BEE': 'ESPK', 'SPEAKER EXX BEE': 'ESPK',
  'EXX-BEE SPEAKER': 'ESPK', 'EXX BEE SPEAKER': 'ESPK',
  CG: 'CG', 'CAMERA GLASS': 'CG', CL: 'CL', 'CAMERA LENS': 'CL',
  CAM: 'CAM', CAMERA: 'CAM',
  BCAM: 'BCAM', 'BACK CAMERA': 'BCAM', 'BACK CAM': 'BCAM',
  FCAM: 'FCAM', 'FRONT CAMERA': 'FCAM', 'FRONT CAM': 'FCAM',
  FF: 'FF', 'FLASH FLEX': 'FF', 'TYPE FLASH': 'FF', 'TYPE FLASH FLEX': 'FF',
  ST: 'ST', SIMTRAY: 'ST', 'SIM TRAY': 'ST', 'SIM TRY': 'ST', 'OUT SIM TRAY': 'ST', 'OUT SIM TRY': 'ST',
  'GAS KIT FRONT': 'GASKITF', 'GAS KIT BACK': 'GASKITB', GASKIT: 'GASKIT', 'GAS KIT': 'GASKIT',
  OUTKEY: 'OUTKEY', 'OUT KEY': 'OUTKEY',
  MIC: 'MIC', 'CHINA MIC': 'MIC',
  VIB: 'VIB', VIBRATOR: 'VIB',
  ANT: 'ANT', ANTENNA: 'ANT',
  INRUBBER: 'INRUBBER', 'IN RUBBER': 'INRUBBER',
  BACKGLASS: 'BACKGLASS', 'BACK GLASS': 'BACKGLASS',
  CONVHOUSING: 'CONVHOUSING', 'CONVERTER HOUSING': 'CONVHOUSING', 'CONVETOR HOUSING': 'CONVHOUSING',
  'CONVERT HOUSING': 'CONVHOUSING', 'CONVERT HOUSIG': 'CONVHOUSING',
  CONVERTER: 'CONVHOUSING', CONVETOR: 'CONVHOUSING', CONVERT: 'CONVHOUSING',
  NETWORKWIRE: 'NETWORKWIRE', 'NETWORK WIRE': 'NETWORKWIRE',
  WIRELESSFLEX: 'WIRELESSFLEX', 'WIRELESS FLEX': 'WIRELESSFLEX', WIRELESS: 'WIRELESSFLEX',
  MICFLEX: 'MICFLEX', 'MIC FLEX': 'MICFLEX',
  MICFLEXSIM: 'MICFLEXSIM', 'MIC FLEX SIM': 'MICFLEXSIM', 'MIC FLEX + SIM': 'MICFLEXSIM',
  LCDFLEXSIM: 'LCDFLEXSIM', 'LCD FLEX SIM': 'LCDFLEXSIM', 'LCD FLEX + SIM': 'LCDFLEXSIM',
  SIMFLEX: 'SIMFLEX', 'SIM FLEX': 'SIMFLEX',
  WIRE: 'WIRE', TOOL: 'TOOL', FLEX: 'FLEX',
}
// ---------------------------------------------------------------------------
// CSV splitting / header detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Effective rule source — DB when loaded, fallback constants otherwise
// ---------------------------------------------------------------------------

type EffectiveRules = {
  brandAliases: Record<string, string>
  partAliases: Record<string, string>
  colorAliases: Record<string, string>
  flagAliases: Record<string, string>
  variantAliases: Record<string, string>
  generalItemPartCodes: Set<string>
}

function effectiveRules(aliases: AliasMaps): EffectiveRules {
  if (dbCache) {
    const partAliases = { ...dbCache.partAliases }
    // General-item classification is data; a part_types.is_general feed can
    // populate a `generalPartCodes` array on DBMessages later. Until then the
    // constant is the fallback.
    const generalItemPartCodes = new Set<string>(GENERAL_ITEM_PART_CODES)
    return {
      brandAliases: { ...BUILT_IN_BRAND_ALIASES, ...dbCache.brandAliases },
      partAliases,
      colorAliases: dbCache.colorAliases,
      flagAliases: dbCache.flagAliases,
      variantAliases: dbCache.variantAliases,
      generalItemPartCodes,
    }
  }
  return {
    brandAliases: mergeBrandAliases(aliases.brandAliases),
    partAliases: { ...PART_CODE_MAP, ...aliases.partAliases },
    colorAliases: aliases.colorAliases ?? {},
    flagAliases: { ...FLAG_MAP },
    variantAliases: {},
    generalItemPartCodes: new Set<string>(GENERAL_ITEM_PART_CODES),
  }
}

// ---------------------------------------------------------------------------
// Candidate collection (pass 1)
// ---------------------------------------------------------------------------

type TokenType =
  | 'brand'
  | 'part'
  | 'quality'
  | 'network'
  | 'year'
  | 'size'
  | 'flag'
  | 'color'
  | 'variant'
  | 'model'

type Candidate = {
  start: number
  end: number
  type: TokenType
  value: string
  raw: string
}

// Resolver priority on equal span. Lower number = higher priority.
// This is an invariant of resolution, deliberately in code (data grows; logic
// does not churn). Position is the final tiebreak.
const TYPE_PRIORITY: Record<TokenType, number> = {
  flag: 1,
  quality: 2,
  part: 3,
  variant: 4,
  size: 5,
  color: 6,
  network: 7,
  year: 8,
  brand: 9,
  model: 10,
}

// Word-boundary check: a match at [start,end) is valid if the chars immediately
// before/after are not alphanumeric (or are string ends).
function boundaryOk(work: string, start: number, end: number): boolean {
  if (start > 0 && /[A-Z0-9]/.test(work[start - 1])) return false
  if (end < work.length && /[A-Z0-9]/.test(work[end])) return false
  return true
}

function collectAt(
  work: string,
  pos: number,
  phrase: string,
  type: TokenType,
  value: string,
  out: Candidate[]
): void {
  const upper = phrase.toUpperCase()
  const end = pos + upper.length
  if (end > work.length) return
  if (work.slice(pos, end) !== upper) return
  if (!boundaryOk(work, pos, end)) return
  out.push({ start: pos, end, type, value, raw: phrase })
}

function collectCandidates(work: string, rules: EffectiveRules): Candidate[] {
  const out: Candidate[] = []

  // Sort phrase sets longest-first so that longer phrases win the span tiebreak
  // naturally; the resolver re-sorts anyway, but this keeps the raw list small.
  const partPhrases = Object.keys(rules.partAliases).sort((a, b) => b.length - a.length)
  const flagPhrases = Object.keys(rules.flagAliases).sort((a, b) => b.length - a.length)
  const colorPhrases = Object.keys(rules.colorAliases).sort((a, b) => b.length - a.length)
  const variantPhrases = Object.keys(rules.variantAliases).sort((a, b) => b.length - a.length)
  const brandPhrases = Object.keys(rules.brandAliases).filter((k) => k.length >= 2).sort((a, b) => b.length - a.length)
  const sizePhrases = Object.keys(SIZE_MARKERS).sort((a, b) => b.length - a.length)

  const qualityPatterns: { re: RegExp; q: Quality }[] = [
    { re: /^1\s*#\s*GLASS(?![A-Z0-9])/i, q: 'PGL' },
    { re: /^1\s+GLASS(?![A-Z0-9])/i, q: 'PGL' },
    { re: /^PGL(?![A-Z0-9])/i, q: 'PGL' },
    { re: /^100\s*%?\s*CARE(?:\s+(?:OG|ORIG|ORIGINAL))?(?![A-Z0-9])/i, q: 'Care OG' },
    { re: /^CARE(?:\s+(?:OG|ORIG|ORIGINAL))?(?![A-Z0-9])/i, q: 'Care OG' },
    { re: /^100\s*%?\s*(?:OG|ORIG|ORIGINAL)/i, q: '100 OG' },
    { re: /^100\s*%?/i, q: '100 OG' },
    { re: /^CHINA\s*(?:OG|ORIG|ORIGINAL)/i, q: 'China OG' },
    { re: /^(?:OG|ORI|ORIG|ORIGINAL|ORG)(?![A-Z0-9])/i, q: 'OG' },
    { re: /^C\+/i, q: 'China OG' },
    { re: /^GLASS(?![A-Z0-9])/i, q: 'GL' },
    { re: /^GL(?![A-Z0-9])/i, q: 'GL' },
  ]

  for (let pos = 0; pos < work.length; pos++) {
    if (work[pos] === ' ' || work[pos] === '(' || work[pos] === ')') continue

    // Part phrases
    for (const p of partPhrases) collectAt(work, pos, p, 'part', rules.partAliases[p], out)

    // Quality (regex family)
    for (const { re, q } of qualityPatterns) {
      const m = work.slice(pos).match(re)
      if (m && m[0]) collectAt(work, pos, m[0], 'quality', q, out)
    }

    // Network
    const net = work.slice(pos).match(/^(?:4G|5G)(?![A-Z0-9])/i)
    if (net && net[0]) collectAt(work, pos, net[0], 'network', net[0].toUpperCase(), out)

    // Year (first of a consecutive pair is handled during resolution)
    const yr = work.slice(pos).match(/^(?:19|20)\d{2}(?![A-Z0-9])/)
    if (yr && yr[0]) collectAt(work, pos, yr[0], 'year', yr[0], out)

    // Size
    for (const s of sizePhrases) collectAt(work, pos, s, 'size', SIZE_MARKERS[s], out)

    // Flags
    for (const f of flagPhrases) collectAt(work, pos, f, 'flag', rules.flagAliases[f], out)

    // Colors
    for (const c of colorPhrases) collectAt(work, pos, c, 'color', rules.colorAliases[c], out)

    // Variants (DB + keyword regex)
    for (const v of variantPhrases) collectAt(work, pos, v, 'variant', rules.variantAliases[v], out)
    const vk = work.slice(pos).match(
      /^(?:BOX\s*PACKING|BOXPACKING|MAIN\s*\d+|MAIN|OCTA|NEW|DAMD\.?|DISPLAY|FOR|MAINBOARD|MAIN BOARD|REFRESH|MIX)(?![A-Z0-9])/i
    )
    if (vk && vk[0]) {
      const raw = vk[0].toUpperCase().replace(/\.$/, '')
      const value = raw === 'BOX PACKING' || raw === 'BOXPACKING' ? 'BOX-PACKING' : raw
      collectAt(work, pos, vk[0], 'variant', value, out)
    }

    // Brands
    for (const b of brandPhrases) collectAt(work, pos, b, 'brand', rules.brandAliases[b], out)
  }

  return out
}

// ---------------------------------------------------------------------------
// Resolution (pass 2)
// ---------------------------------------------------------------------------

type Resolution = {
  accepted: Candidate[]
  consumed: boolean[]
  modelTokens: { start: number; end: number; text: string }[]
}

function resolve(work: string, candidates: Candidate[]): Resolution {
  // Sort by: longer span first, then type priority, then leftmost.
  const ranked = [...candidates].sort((a, b) => {
    const spanA = a.end - a.start
    const spanB = b.end - b.start
    if (spanA !== spanB) return spanB - spanA
    const priA = TYPE_PRIORITY[a.type] ?? 99
    const priB = TYPE_PRIORITY[b.type] ?? 99
    if (priA !== priB) return priA - priB
    return a.start - b.start
  })

  const consumed = new Array<boolean>(work.length).fill(false)
  const accepted: Candidate[] = []

  for (const cand of ranked) {
    let overlap = false
    for (let i = cand.start; i < cand.end; i++) {
      if (consumed[i]) { overlap = true; break }
    }
    if (overlap) continue
    // A brand candidate that overlaps a model token would be wrong; since model
    // tokens aren't candidates yet, this is safe.
    for (let i = cand.start; i < cand.end; i++) consumed[i] = true
    accepted.push(cand)
  }

  // Collect model tokens: maximal runs of unconsumed, non-space, non-paren chars.
  const modelTokens: { start: number; end: number; text: string }[] = []
  let i = 0
  while (i < work.length) {
    if (consumed[i] || work[i] === ' ' || work[i] === '(' || work[i] === ')') { i++; continue }
    const start = i
    while (i < work.length && !consumed[i] && work[i] !== ' ' && work[i] !== '(' && work[i] !== ')') i++
    const text = work.slice(start, i)
    if (text.length > 0) modelTokens.push({ start, end: i, text })
  }

  return { accepted, consumed, modelTokens }
}

// ---------------------------------------------------------------------------
// Token classification helpers
// ---------------------------------------------------------------------------

// Single-letter / short tokens that are themselves model names.
// IP X (iPhone X), ONE 10 R, S21 FE, SE variants.
const SINGLE_LETTER_MODELS = new Set<string>(['X', 'R', 'S', 'FE', 'SE'])

function isModelLikeToken(tok: string, rules: EffectiveRules): boolean {
  const t = tok.toUpperCase()
  if (t.length === 0) return false
  if (PART_CODE_TOKENS.has(t)) return false
  if (Object.prototype.hasOwnProperty.call(rules.partAliases, t)) return false
  if (Object.prototype.hasOwnProperty.call(rules.flagAliases, t)) return false
  if (Object.prototype.hasOwnProperty.call(rules.brandAliases, t)) return false
  if (Object.prototype.hasOwnProperty.call(rules.colorAliases, t)) return false
  if (Object.prototype.hasOwnProperty.call(SIZE_MARKERS, t)) return false
  // Explicit short model names (checked after exclusion sets so that, e.g., a
  // part alias named 'X' would still win over the model interpretation).
  if (SINGLE_LETTER_MODELS.has(t)) return true
  // Pure alphabetic tokens ≥ 2 chars without digits are generally model names
  // ("RENO", "NORD", "NARZO", "SMART"). Suffix words (PRO, PLUS, MAX, LITE,
  // NEO, PRIME, FUSION, REFRESH, MIX) are model-name parts, not noise, so
  // they are NOT excluded — they flow into the model run.
  if (/^[A-Z]+$/.test(t) && t.length >= 2) return true
  // Alphanumeric with digit ("A14", "Y33S", "14C", "X6525", "8T", "10")
  if (/[0-9]/.test(t) && /^[A-Z0-9]+$/.test(t)) return true
  return false
}

function sortDashed(tokens: string[]): string {
  return [...tokens]
    .map((x) => x.toUpperCase().replace(/\s+/g, ''))
    .filter((x) => x.length > 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join('-')
}

// ---------------------------------------------------------------------------
// scanDescription — the entry point used by parseCSV for the legacy format
// ---------------------------------------------------------------------------

export type ScanResult = {
  brandCode: string | null
  partCode: string | null
  quality: Quality
  network: string | null
  year: string | null
  size: string | null
  flag: string | null
  color: string | null
  variant: string | null
  modelText: string      // sorted, dashed
  isGeneralItem: boolean
  warnings: string[]
}

export function scanDescription(text: string, aliases: AliasMaps): ScanResult {
  const rules = effectiveRules(aliases)
  const work = normalizeTypos(text).toUpperCase()

  // Parenthetical extraction runs before token scan; results merge with scan
  // output (paren wins when both fire for the same field).
  const paren = extractParentheticals(work)

  const candidates = collectCandidates(work, rules)
  const { accepted, modelTokens } = resolve(work, candidates)

  // Pick single-valued fields: highest-priority accepted candidate of each type.
  // Longer spans / earlier priority wins; multiple colors concatenate.
  const byType = new Map<TokenType, Candidate[]>()
  for (const c of accepted) {
    if (!byType.has(c.type)) byType.set(c.type, [])
    byType.get(c.type)!.push(c)
  }

  // Brand: rightmost wins (your rule), with model-guard.
  let brandCode: string | null = null
  const brands = byType.get('brand') ?? []
  if (brands.length > 0) {
    const rightmost = brands.reduce((a, b) => (a.start > b.start ? a : b))
    let chosen = rightmost
    // Model-guard: if rightmost's next non-space char isn't model-like and an
    // earlier candidate's next char is, prefer the earlier one.
    const rightNeighborModelLike = (c: Candidate): boolean => {
      let p = c.end
      while (p < work.length && work[p] === ' ') p++
      if (p >= work.length) return false
      let q = p
      while (q < work.length && /[A-Z0-9]/.test(work[q])) q++
      return isModelLikeToken(work.slice(p, q), rules)
    }
    if (!rightNeighborModelLike(rightmost)) {
      const earlier = brands.filter((b) => b.start < rightmost.start && rightNeighborModelLike(b))
      if (earlier.length > 0) chosen = earlier.reduce((a, b) => (a.start > b.start ? a : b))
    }
    brandCode = chosen.value
  }

  // Part: first accepted part candidate (longest already favored by rank).
  const partCand = (byType.get('part') ?? [])[0] ?? null
  let partCode: string | null = partCand ? partCand.value : null

  // Quality: paren overrides; otherwise first accepted.
  let quality: Quality = 'Normal'
  if (paren.quality) quality = paren.quality
  else {
    const qCand = (byType.get('quality') ?? [])[0]
    if (qCand) quality = qCand.value as Quality
  }

  const network = paren.network || (byType.get('network') ?? [])[0]?.value || null

  // Year: combine consecutive years (e.g. "2020 2021") only when nothing
  // intervenes between the two year candidates.
  let year: string | null = paren.year || null
  if (!year) {
    const years = (byType.get('year') ?? []).sort((a, b) => a.start - b.start)
    if (years.length === 1) year = years[0].value
    else if (years.length >= 2) {
      // Accept the first, plus the second only if strictly consecutive in text
      const a = years[0]
      const b = years[1]
      const between = work.slice(a.end, b.start).trim()
      if (between === '' && Number(b.value) === Number(a.value) + 1) {
        year = `${a.value}-${b.value}`
      } else {
        year = a.value
      }
    }
  }

  const size = paren.size || (byType.get('size') ?? [])[0]?.value || null
  const flag = paren.flag || (byType.get('flag') ?? [])[0]?.value || null
  const variant = paren.variant || (byType.get('variant') ?? [])[0]?.value || null

  // Colors: paren colors first, else concatenate every accepted color candidate.
  let color: string | null = null
  const colors = (byType.get('color') ?? []).sort((a, b) => a.start - b.start)
  if (paren.colors.length > 0) color = paren.colors[0]
  else if (colors.length > 0) {
    const seen = new Set<string>()
    const parts: string[] = []
    for (const c of colors) {
      const v = c.value.toUpperCase()
      if (!seen.has(v)) { seen.add(v); parts.push(v) }
    }
    color = parts.join('-')
  }

  // Model tokens: everything unconsumed that is model-like, sorted.
  // Build model text by grouping un-consumed model-like tokens into runs
  // (adjacent in original text), preserving each run's word order, then
  // sorting runs against each other. Keeps "NOTE 11T" as NOTE-11T (not
  // 11T-NOTE) and "NORD CE4" as NORD-CE4, while making "T1X ... Y33S" and
  // "Y33S ... T1X" converge to the same SKU for a shared part.
  //
  // "TO" between model tokens expresses a range (iPhone X TO 16 PRO) and is
  // kept inside the run so the range reads as one fitment phrase.
  const isAdjacentToPrev = (a: { end: number }, b: { start: number }) =>
    /^\s*$/.test(work.slice(a.end, b.start))

  const modelRuns: string[] = []
  const dropped: string[] = []
  let currentRun: string[] = []
  let prev: { end: number } | null = null

  for (const mt of modelTokens) {
    const upperTok = mt.text.toUpperCase()
    if (upperTok === 'TO') {
      if (currentRun.length > 0) {
        currentRun.push('TO')
        prev = { end: mt.end }
      } else {
        dropped.push(mt.text)
      }
      continue
    }
    if (isModelLikeToken(mt.text, rules)) {
      if (prev && isAdjacentToPrev(prev, mt)) {
        currentRun.push(mt.text)
      } else {
        if (currentRun.length > 0) modelRuns.push(currentRun.join('-'))
        currentRun = [mt.text]
      }
      prev = { end: mt.end }
    } else {
      dropped.push(mt.text)
      if (currentRun.length > 0) {
        modelRuns.push(currentRun.join('-'))
        currentRun = []
      }
      prev = null
    }
  }
  if (currentRun.length > 0) modelRuns.push(currentRun.join('-'))

  const warnings: string[] = []
  if (dropped.length > 0) {
    warnings.push(`unclassified tokens: ${dropped.join(' ')}`)
  }

  const modelText =
    modelRuns.length === 0
      ? ''
      : modelRuns
          .map((r) => r.toUpperCase().replace(/\s+/g, ''))
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .join('-')

  const isGeneralItem =
    partCode !== null &&
    rules.generalItemPartCodes.has(partCode)

  return {
    brandCode,
    partCode,
    quality,
    network,
    year,
    size,
    flag,
    color,
    variant,
    modelText,
    isGeneralItem,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Parenthetical extraction — runs before scan, returns both cleaned text and
// typed values. Result fields override scan results in scanDescription above.
// ---------------------------------------------------------------------------

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

  const flagMap = dbCache ? dbCache.flagAliases : FLAG_MAP
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
      if (!quality) quality = 'OG'
      continue
    }
    if (flagMap[upper]) { flag = flagMap[upper]; continue }
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
// ---------------------------------------------------------------------------
// Part code / model normalization
// ---------------------------------------------------------------------------

export function normalizePartCode(raw: string | null): string | null {
  if (!raw) return null
  const upper = raw
    .toUpperCase()
    .trim()
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')

  const rules = dbCache ? dbCache.partAliases : PART_CODE_MAP
  if (rules[upper]) return rules[upper]
  const spaceForm = upper.replace(/\s*\/\s*/g, ' ')
  if (rules[spaceForm]) return rules[spaceForm]
  const noSpace = upper.replace(/\s+/g, '')
  if (rules[noSpace]) return rules[noSpace]

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
  const words = cleaned.split(/\s+/)
  if (words.length > 1) {
    const last = words[words.length - 1]
    if (PART_CODE_TOKENS.has(last)) {
      strippedPart = last
      words.pop()
      cleaned = words.join(' ')
    }
  }

  if (!cleaned) return { model: null, strippedPart }

  cleaned = cleaned.replace(/\b([A-Z]{1,2})\s+(\d)/g, (m, l, d) => {
    if (l === 'TO' || l === 'RE') return m
    return l + d
  })
  cleaned = cleaned.replace(/\b(\d+)\s+([A-Z]{1,2})\b/g, (m, d, l) => {
    if (l === 'TO') return m
    return d + l
  })
  cleaned = cleaned.replace(/\b(\d+)\s+([A-Z])\b/g, '$1$2')

  if (!cleaned) return { model: null, strippedPart }
  return { model: cleaned, strippedPart }
}

function extractPartFromDescription(
  desc: string,
  aliases: AliasMaps
): { partText: string | null; cleanedDesc: string } {
  const upper = desc.toUpperCase()
  const source = dbCache ? dbCache.partAliases : { ...PART_CODE_MAP, ...aliases.partAliases }
  const allPhrases = Object.keys(source).filter(Boolean).sort((a, b) => b.length - a.length)
  for (const phrase of allPhrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, 'i')
    if (re.test(upper)) {
      const cleaned = desc.replace(new RegExp(escaped, 'gi'), ' ').replace(/\s+/g, ' ').trim()
      return { partText: phrase, cleanedDesc: cleaned }
    }
  }
  return { partText: null, cleanedDesc: desc }
}

// ---------------------------------------------------------------------------
// SKU assembly
// ---------------------------------------------------------------------------

export type SkuFields = {
  brandCode: string | null
  modelName: string | null
  variant: string | null
  year: string | null
  partCode: string | null
  network: string | null
  quality: Quality
  flag: string | null
  color: string | null
  size?: string | null
  validBrandCodes?: string[]
  isGeneralItem?: boolean
}

const warnedBrandCodes = new Set<string>()

export function resetBrandCodeWarnings(): void {
  warnedBrandCodes.clear()
}

function guardBrandCode(brandCode: string | null, validBrandCodes: string[] | undefined): void {
  if (!brandCode) return
  if (!validBrandCodes || validBrandCodes.length === 0) return
  const upper = brandCode.toUpperCase()
  const valid = validBrandCodes.map((b) => b.toUpperCase())
  if (valid.includes(upper)) return
  if (warnedBrandCodes.has(upper)) return
  warnedBrandCodes.add(upper)
  console.warn(`[csv-parser] Brand code "${brandCode}" not in brands.brand_code.`)
}

const QUALITY_SUFFIX: Record<Quality, string | null> = {
  Normal: null,
  OG: 'OG',
  '100 OG': '100OG',
  'Care OG': 'CARE',
  'China OG': 'CHINAOG',
  GL: 'GL',
  PGL: 'PGL',
}

export function generateSku(fields: SkuFields): string | null {
  const {
    brandCode, modelName, variant, year, partCode,
    network, quality, flag, color, size, validBrandCodes, isGeneralItem,
  } = fields

  if (!brandCode || !partCode) return null
  guardBrandCode(brandCode, validBrandCodes)

  const dash = (s: string) =>
    s.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

  const seg: string[] = [brandCode]

  // General items: model slot holds spec tokens (sorted); part follows.
  // Phone parts: model first, then part.
  if (isGeneralItem) {
    if (modelName) seg.push(dash(modelName))
    seg.push(partCode)
    if (size) seg.push(dash(size))
    if (variant) seg.push(dash(variant))
    if (quality !== 'Normal') {
      const q = QUALITY_SUFFIX[quality]
      if (q) seg.push(q)
    }
    return seg.filter(Boolean).join('-')
  }

  if (modelName) seg.push(dash(modelName))
  if (year) seg.push(year)
  seg.push(partCode)
  if (network) seg.push(network)
  if (flag) seg.push(dash(flag))
  if (size) seg.push(dash(size))
  if (variant) seg.push(dash(variant))
  if (color) seg.push(dash(color))
  if (quality !== 'Normal') {
    const q = QUALITY_SUFFIX[quality]
    if (q) seg.push(q)
  }
  return seg.filter(Boolean).join('-')
}

// ---------------------------------------------------------------------------
// Duplicate detection and grouping
// ---------------------------------------------------------------------------

export function flagDuplicates(rows: ParsedRow[]): ParsedRow[] {
  const map = new Map<string, number[]>()
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.generatedSku) continue
    const key = r.generatedSku.toUpperCase()
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(i)
  }
  return rows.map((r, i) => {
    if (r.status !== 'needs_correction' && r.generatedSku) {
      const key = r.generatedSku.toUpperCase()
      const idxs = map.get(key) ?? []
      if (idxs.length > 1) {
        const dupes = idxs.filter((x) => x !== i).map((x) => rows[x].rowNumber)
        return {
          ...r,
          warnings: [...r.warnings, `duplicate SKU of row ${dupes.join(', ')}`],
        }
      }
    }
    return r
  })
}

export function groupParsedRows(rows: ParsedRow[]): {
  matched: ParsedRow[]
  newItems: ParsedRow[]
  needsCorrection: ParsedRow[]
} {
  const matched: ParsedRow[] = []
  const newItems: ParsedRow[] = []
  const needsCorrection: ParsedRow[] = []
  for (const r of rows) {
    if (r.status === 'matched') matched.push(r)
    else if (r.status === 'new') newItems.push(r)
    else needsCorrection.push(r)
  }
  return { matched, newItems, needsCorrection }
}

// ---------------------------------------------------------------------------
// Fingerprint (used by audit for stable per-row identity)
// ---------------------------------------------------------------------------

export function buildFingerprint(row: {
  brandCode: string | null
  modelName: string | null
  partCode: string | null
  quality: Quality | null | undefined
  color: string | null
  variant: string | null
  size?: string | null
  flag: string | null
  network: string | null
  year: string | null
}): string {
  const upper = (s: string | null | undefined) =>
    (s ?? '').toString().toUpperCase().replace(/\s+/g, ' ').trim()
  const trimmed = (s: string | null | undefined) =>
    (s ?? '').toString().replace(/\s+/g, ' ').trim()
  const parts = [
    upper(row.brandCode),
    upper(row.modelName),
    upper(row.partCode),
    trimmed(row.quality),
    upper(row.color),
    upper(row.variant),
    upper(row.flag),
    upper(row.network),
    upper(row.year),
  ]
  if (row.size) parts.push(upper(row.size))
  return parts.join('|')
}

// ---------------------------------------------------------------------------
// Item lookup
// ---------------------------------------------------------------------------

export type ItemLookup = {
  item_id: number
  sku: string
  brand_id: number | null
  model_id: number | null
  part_id: number | null
  quality: string
  variant?: string | null
}

// ---------------------------------------------------------------------------
// parseCSV — the only public entry point that matters to callers
// ---------------------------------------------------------------------------

export function parseCSV(
  text: string,
  aliases: AliasMaps,
  items: ItemLookup[] = []
): ParsedRow[] {
  if (!hasDBMessages()) {
    throw new Error(
      'parseCSV called before setDBMessages — alias cache must be loaded first'
    )
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
      'descriptionofgoods', 'description', 'item', 'product', 'itemname',
    ])
    const brand = findColumnIndex(line, ['brand'])
    if (qty !== -1 && rate !== -1 && (desc !== -1 || brand !== -1)) {
      headerRowIndex = i
      header = line
      break
    }
  }
  if (headerRowIndex === -1) {
    throw new Error('Could not find a header row with Description (or Brand), Quantity, and Rate/Price.')
  }

  const colBrand = findColumnIndex(header, ['brand'])
  const colModel = findColumnIndex(header, ['model'])
  const colPart = findColumnIndex(header, ['parttype', 'typeofgoods', 'type', 'part'])
  const colDesc = findColumnIndex(header, ['descriptionofgoods', 'description', 'item', 'product', 'itemname'])
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

    const rawDescFromRow = colDesc >= 0 ? row[colDesc] || '' : ''
    const rawTypeFromRow = colPart >= 0 ? (row[colPart] || '').toUpperCase().trim() : ''
    const rawQtyCell = colQty >= 0 ? row[colQty] || '' : ''
    const rawRateCell = colRate >= 0 ? row[colRate] || '' : ''
    const qty = parseFloat(String(rawQtyCell).replace(/[^\d.-]/g, '')) || 0
    const rate = parseFloat(String(rawRateCell).replace(/[^\d.-]/g, '')) || 0
    const isReturnLine = qty < 0 || rate < 0

    let hardFail: string | null = null
    if (!isNewFormat && colDesc >= 0 && row.length < header.length) hardFail = 'wrong column count'
    else if (!isNewFormat && !rawDescFromRow && !rawTypeFromRow) hardFail = 'missing description'
    else if (qty === 0) hardFail = 'missing qty'

    let rawDescription = ''
    let brandCode: string | null = null
    let modelName: string | null = null
    let network: string | null = null
    let year: string | null = null
    let variant: string | null = null
    let size: string | null = null
    let partCode: string | null = null
    let quality: Quality = 'Normal'
    let flag: string | null = null
    let color: string | null = null
    let isGeneralItem = false
    const warnings: string[] = []
    if (isReturnLine) warnings.push('return line (negative qty/price) — will be skipped on import')

    if (isNewFormat) {
      // New-format: explicit brand/model/part columns
      const brandRaw = normalizeTypos((row[colBrand] || '').toUpperCase().trim())
      const modelRaw = normalizeTypos((row[colModel] || '').trim())
      const partRaw = normalizeTypos((row[colPart] || '').toUpperCase().trim())
      rawDescription = `${brandRaw} ${modelRaw}`

      network = (modelRaw.match(/\b(4G|5G)\b/i) || [null])[0] || null
      if (network) network = network.toUpperCase()

      const rules = effectiveRules(aliases)
      brandCode = rules.brandAliases[brandRaw] ?? brandRaw
      const nm = normalizeModelName(modelRaw.replace(/\(4G\)|\(5G\)/gi, '').trim())
      modelName = nm.model ? nm.model.toUpperCase().replace(/\s+/g, '-') : null

      const sizeMatch = modelRaw.toUpperCase().match(/\b(\d\s*PIN|BIG|SMALL|MEDIUM|\d{1,3}\s*MM)\b/)
      size = sizeMatch ? SIZE_MARKERS[sizeMatch[1].replace(/\s+/g, ' ')] ?? null : null

      const directAlias = rules.partAliases[partRaw]
      if (directAlias) partCode = directAlias
      else {
        const ex = extractPartFromDescription(partRaw, aliases)
        if (ex.partText) partCode = rules.partAliases[ex.partText.toUpperCase()] ?? normalizePartCode(ex.partText)
        else if (/^[A-Z0-9]{1,10}$/i.test(partRaw.trim())) partCode = normalizePartCode(partRaw)
      }
      if (!partCode && nm.strippedPart) {
        partCode = rules.partAliases[nm.strippedPart] ?? normalizePartCode(nm.strippedPart)
      }
      isGeneralItem = partCode !== null && rules.generalItemPartCodes.has(partCode)
    } else {
      // Legacy format: description, quantity, price
      rawDescription = rawDescFromRow
      const scan = scanDescription(rawDescription, aliases)
      brandCode = scan.brandCode
      partCode = scan.partCode
      quality = scan.quality
      network = scan.network
      year = scan.year
      size = scan.size
      flag = scan.flag
      color = scan.color
      variant = scan.variant
      modelName = scan.modelText || null
      isGeneralItem = scan.isGeneralItem
      for (const w of scan.warnings) warnings.push(w)

      if (!brandCode && partCode) {
        brandCode = isGeneralItem ? 'GEN' : 'GEN'
      }

      if (partCode === 'MF' && /\bFLEX\b/.test(rawDescription.toUpperCase())) {
        partCode = 'MFF'
      }
    }

    // Build SKU
    const sku = hardFail
      ? null
      : generateSku({
          brandCode,
          modelName,
          variant,
          year,
          partCode,
          network,
          quality,
          flag,
          color,
          size,
          validBrandCodes: aliases.validBrandCodes,
          isGeneralItem,
        })

    // Determine status
    let status: RowStatus = 'new'
    let errorMessage: string | undefined
    let matchedItemId: number | null = null
    let matchedItemSku: string | null = null

    if (hardFail) {
      status = 'needs_correction'
      errorMessage = hardFail
    } else if (!brandCode) {
      status = 'needs_correction'
      errorMessage = 'unknown brand'
    } else if (!partCode) {
      status = 'needs_correction'
      errorMessage = 'unknown part'
    } else if (!sku) {
      status = 'needs_correction'
      errorMessage = 'could not build SKU'
    } else if (itemBySku[sku.toUpperCase()]) {
      const found = itemBySku[sku.toUpperCase()]
      matchedItemId = found.item_id
      matchedItemSku = found.sku
      status = 'matched'
    }

    result.push({
      rowNumber: i,
      rawDescription: rawDescription || row.join(' | '),
      rawType: rawTypeFromRow,
      qty,
      rate,
      brandCode,
      modelName,
      network,
      year,
      size,
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
      warnings,
      is_general_item: isGeneralItem,
      isReturnLine,
    })
  }

  return flagDuplicates(result)
}