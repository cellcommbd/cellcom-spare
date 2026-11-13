'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  parseCSV,
  setDBMessages,
  AliasMaps,
  ParsedRow,
  TypoRule,
} from '@/lib/csv-parser'
import {
  detectGeneralItemCSV,
  parseGeneralCSV,
} from '@/lib/general-item-parser'
import {
  detectColumns,
  applyMapping,
  validateMapping,
  buildDefaultMapping,
  DetectedColumn,
  ColumnMapping,
  ColumnRole,
} from '@/lib/csv-mapper'
import {
  newSessionId,
  writeStagingRows,
  classifySession,
} from '@/lib/import-staging'
import {
  Upload,
  X,
  Check,
  AlertCircle,
  FileText,
  Sparkles,
  Settings2,
} from 'lucide-react'

type Props = {
  open: boolean
  onClose: () => void
  /** Staging flow — used by /purchases. Parent navigates to
   *  /imports/staging/<sessionId>. */
  onStaged?: (sessionId: string) => void
  /** Legacy direct-import flow — used by /purchase-returns.
   *  Called with parsed rows; parent decides what to do. */
  onImport?: (
    matched: ParsedRow[],
    newItems: ParsedRow[],
    margin: number
  ) => void
  actionLabel?: string
}

const ROLE_OPTIONS: { value: ColumnRole; label: string }[] = [
  { value: 'ignore', label: '— Ignore —' },
  { value: 'brand', label: 'Brand' },
  { value: 'model', label: 'Model' },
  { value: 'part_type', label: 'Part Type' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'rate', label: 'Rate / Price' },
  { value: 'description', label: 'Description (Brand + Model)' },
]

export function ImportCSVDialog({
  open,
  onClose,
  onStaged,
  onImport,
  actionLabel,
}: Props) {
  const [csvText, setCsvText] = useState('')
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [detected, setDetected] = useState<DetectedColumn[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [aliases, setAliases] = useState<AliasMaps | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && !aliases) loadAliases()
  }, [open, aliases])

  async function loadAliases() {
    setLoading(true)

    const [brandRes, partRes, colorRes, flagRes, qualityRes, variantRes, typoRes] = await Promise.all([
      supabase.from('brand_aliases').select('csv_code, brand_code'),
      supabase.from('part_type_aliases').select('csv_text, part_code'),
      supabase.from('parser_color_aliases').select('csv_text, color_value'),
      supabase.from('flag_aliases').select('source_text, target_flag'),
      supabase.from('quality_aliases').select('source_text, target_quality'),
      supabase.from('variant_aliases').select('source_text, target_variant'),
      supabase.from('typo_rules').select('pattern, replacement, match_type, priority').order('priority').order('id'),
    ])

    const brandAliases: Record<string, string> = {
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
    }
    for (const r of (brandRes.data as any[]) || []) {
      const csvCode = String(r.csv_code || '').trim().toUpperCase()
      if (!csvCode) continue
      if (csvCode in brandAliases) continue
      brandAliases[csvCode] = String(r.brand_code)
    }

    const partAliases: Record<string, string> = {
      WIRE: 'WIRE',
      TOOL: 'TOOL',
      FLEX: 'FLEX',
    }
    for (const r of (partRes.data as any[]) || []) {
      const csvText = String(r.csv_text || '').trim().toUpperCase()
      if (!csvText) continue
      if (csvText in partAliases) continue
      partAliases[csvText] = String(r.part_code)
    }

    const colorAliases: Record<string, string> = {}
    for (const r of (colorRes.data as any[]) || []) {
      colorAliases[String(r.csv_text).toUpperCase()] = String(r.color_value)
    }

    setAliases({ brandAliases, partAliases, colorAliases })

    // Load DB rules into parser cache (uses alias tables for every lookup)
    const toMap = (rows: any[], k: string, v: string) =>
      Object.fromEntries(
        (rows || []).map((r) => [
          String(r[k]).toUpperCase().trim(),
          String(r[v]),
        ])
      )

    const typoRules: TypoRule[] = ((typoRes.data as any[]) || []).map((r) => ({
      pattern: String(r.pattern),
      replacement: String(r.replacement),
      match_type: (r.match_type as 'word' | 'phrase' | 'regex') || 'word',
      priority: r.priority ?? 100,
    }))

    setDBMessages({
      partAliases: toMap(partRes.data || [], 'csv_text', 'part_code'),
      brandAliases: toMap(brandRes.data || [], 'csv_code', 'brand_code'),
      colorAliases: toMap(colorRes.data || [], 'csv_text', 'color_value'),
      flagAliases: toMap(flagRes.data || [], 'source_text', 'target_flag'),
      qualityAliases: toMap(qualityRes.data || [], 'source_text', 'target_quality'),
      variantAliases: toMap(variantRes.data || [], 'source_text', 'target_variant'),
      typoRules,
    })

    // Load items for DB matching (paginated — Supabase defaults to 1000 rows)
    let allItems: any[] = []
    let from = 0
    const pageSize = 1000
    while (true) {
      const { data: page, error: err } = await supabase
        .from('items')
        .select('item_id, sku, brand_id, model_id, part_id, quality')
        .range(from, from + pageSize - 1)
      if (err || !page || page.length === 0) break
      allItems = allItems.concat(page)
      if (page.length < pageSize) break
      from += pageSize
    }
    setItems(allItems)
    console.log('DEBUG items:', allItems.length, 'has GEN-SPKJ-BIG:', allItems.some((i) => i.sku === 'GEN-SPKJ-BIG'))

    setLoading(false)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = String(ev.target?.result || '')
      setCsvText(text)
      setDetected([])
    }
    reader.readAsText(file)
  }

  function handleDetect() {
    setError('')
    if (!csvText.trim()) {
      setError('Please paste CSV or upload a file.')
      return
    }
    const result = detectColumns(csvText)
    if (result.error) {
      setError(result.error)
      return
    }
    setDetected(result.columns)
    setMapping(buildDefaultMapping(result.columns))
  }

  async function stageAndNavigate(
    parse: () => Promise<ParsedRow[]> | ParsedRow[]
  ) {
    setLoading(true)
    setError('')
    try {
      const rows = await parse()
      if (rows.length === 0) {
        setError('No valid rows found. Check the CSV.')
        setLoading(false)
        return
      }
      // Legacy flow — call onImport directly, no staging
      if (onImport && !onStaged) {
        const matched = rows.filter((r) => r.status === 'matched')
        const newItems = rows.filter((r) => r.status === 'new')
        const errorRows = rows.filter((r) => r.status === 'needs_correction')
        if (errorRows.length > 0 && matched.length === 0 && newItems.length === 0) {
          setError(`All ${errorRows.length} rows failed to parse.`)
          setLoading(false)
          return
        }
        setLoading(false)
        onImport(matched, newItems, 1.5)
        resetAndClose()
        return
      }
      // Staging flow
      if (!onStaged) {
        setError('Import handler not configured.')
        setLoading(false)
        return
      }
      const sessionId = newSessionId()
      await writeStagingRows(sessionId, rows)
      await classifySession(sessionId)
      setLoading(false)
      onStaged(sessionId)
      resetAndClose()
    } catch (e: any) {
      setLoading(false)
      setError(e.message || 'Failed to stage CSV')
    }
  }

  async function handleParseAuto() {
    setError('')
    if (!aliases) return
    if (!csvText.trim()) {
      setError('Please paste CSV.')
      return
    }
    await stageAndNavigate(async () => {
      const isGeneral = detectGeneralItemCSV(csvText)
      if (isGeneral) {
        const generalRows = parseGeneralCSV(csvText, [])
        return generalRows as unknown as ParsedRow[]
      }
      return parseCSV(csvText, aliases, items)
    })
  }

  async function handleParseManual() {
    setError('')
    if (!aliases) return
    const validation = validateMapping(mapping)
    if (!validation.valid) {
      setError('Missing required roles: ' + validation.missing.join(', '))
      return
    }
    await stageAndNavigate(() => applyMapping(csvText, mapping, aliases, items))
  }

  function resetAndClose() {
    setCsvText('')
    setDetected([])
    setMapping({})
    setError('')
    setMode('auto')
    onClose()
  }

  if (!open) return null

  const mappingValidation = validateMapping(mapping)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-slate-800">
              Import Items from CSV
            </h2>
          </div>
          <button
            onClick={resetAndClose}
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-6 pt-4">
          <button
            onClick={() => setMode('auto')}
            className={`h-9 px-4 text-sm font-medium rounded-lg flex items-center gap-2 ${
              mode === 'auto'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Auto
          </button>
          <button
            onClick={() => setMode('manual')}
            className={`h-9 px-4 text-sm font-medium rounded-lg flex items-center gap-2 ${
              mode === 'manual'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Settings2 className="w-4 h-4" />
            Manual Mapping
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="text-center py-8 text-slate-500">
              {aliases ? 'Staging rows…' : 'Loading aliases…'}
            </div>
          )}

          {!loading && (
            <>
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <label className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer">
                    <Upload className="w-4 h-4" />
                    Upload CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleFile}
                      className="hidden"
                    />
                  </label>
                  <span className="text-sm text-slate-500">
                    or paste CSV below
                  </span>
                </div>

                <textarea
                  value={csvText}
                  onChange={(e) => {
                    setCsvText(e.target.value)
                    setDetected([])
                    setError('')
                  }}
                  placeholder="Paste CSV text here..."
                  rows={10}
                  className="w-full font-mono text-xs p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                {error && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}
              </div>

              {mode === 'auto' && (
                <div>
                  <button
                    onClick={handleParseAuto}
                    disabled={!csvText.trim()}
                    className="h-10 px-5 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-900 disabled:opacity-50"
                  >
                    {onImport && !onStaged ? 'Parse CSV (Auto)' : 'Stage CSV (Auto)'}
                  </button>
                  <p className="text-xs text-slate-500 mt-2">
                    Parses the CSV and writes rows to staging. Nothing is
                    created until you promote on the review page.
                  </p>
                </div>
              )}

              {mode === 'manual' && (
                <div>
                  <button
                    onClick={handleDetect}
                    disabled={!csvText.trim()}
                    className="h-10 px-5 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-900 disabled:opacity-50"
                  >
                    Detect Columns
                  </button>

                  {detected.length > 0 && (
                    <div className="mt-4">
                      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 text-sm">
                        <div className="font-medium text-blue-900 mb-1">
                          Required roles: Brand, Model, Part Type, Quantity, Rate
                        </div>
                        <div className="text-xs text-blue-700">
                          Or use <strong>Description</strong> to auto-split Brand + Model.
                          All other columns can stay on Ignore.
                        </div>
                      </div>

                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-100">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 w-32">
                                Column
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">
                                Sample
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 w-64">
                                Assign role
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {detected.map((col) => (
                              <tr key={col.index} className="border-t border-slate-100">
                                <td className="px-3 py-2 font-medium text-slate-700">
                                  {col.header}
                                </td>
                                <td className="px-3 py-2 text-xs text-slate-500">
                                  {col.samples.join(', ') || '—'}
                                </td>
                                <td className="px-3 py-2">
                                  <select
                                    value={mapping[col.index] || 'ignore'}
                                    onChange={(e) =>
                                      setMapping((prev) => ({
                                        ...prev,
                                        [col.index]: e.target.value as ColumnRole,
                                      }))
                                    }
                                    className={`w-full h-8 px-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                      mapping[col.index] !== 'ignore'
                                        ? 'border-blue-300 bg-blue-50'
                                        : 'border-slate-300'
                                    }`}
                                  >
                                    {ROLE_OPTIONS.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-4 flex items-center gap-3">
                        <button
                          onClick={handleParseManual}
                          disabled={!mappingValidation.valid}
                          className="h-10 px-5 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-900 disabled:opacity-50"
                        >
                          {onImport && !onStaged ? 'Parse CSV with Mapping' : 'Stage CSV with Mapping'}
                        </button>

                        {!mappingValidation.valid && (
                          <div className="text-xs text-amber-700">
                            <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                            Missing: {mappingValidation.missing.join(', ')}
                          </div>
                        )}
                        {mappingValidation.valid && (
                          <div className="text-xs text-green-700 flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            All required roles mapped
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div className="text-xs text-slate-500">
            {loading
              ? 'Staging rows…'
              : onImport && !onStaged
              ? `Parse CSV to fill ${actionLabel || 'this form'}.`
              : 'Parse CSV to stage rows for review. Nothing is created until you promote.'}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={resetAndClose}
              className="h-9 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}