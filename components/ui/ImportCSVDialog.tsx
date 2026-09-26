
'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  parseCSV,
  groupParsedRows,
  AliasMaps,
  ItemLookup,
  ParsedRow,
  Quality,
} from '@/lib/csv-parser'
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
  Upload,
  X,
  Check,
  AlertCircle,
  FileText,
  Sparkles,
  Settings2,
  Pencil,
} from 'lucide-react'

type Props = {
  open: boolean
  onClose: () => void
  onImport: (matched: ParsedRow[], newItems: ParsedRow[], margin: number) => void
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

export function ImportCSVDialog({ open, onClose, onImport }: Props) {
  const [csvText, setCsvText] = useState('')
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [detected, setDetected] = useState<DetectedColumn[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [aliases, setAliases] = useState<AliasMaps | null>(null)
  const [items, setItems] = useState<ItemLookup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [margin, setMargin] = useState('1.5')
  const [editingRow, setEditingRow] = useState<number | null>(null)

  useEffect(() => {
    if (open && !aliases) loadAliases()
  }, [open, aliases])

  async function loadAliases() {
    setLoading(true)
    const [brandRes, partRes, itemRes] = await Promise.all([
      supabase.from('brand_aliases').select('csv_code, brand_code'),
      supabase.from('part_type_aliases').select('csv_text, part_code'),
      supabase
        .from('items')
        .select('item_id, sku, brand_id, model_id, part_id, quality'),
    ])

    const brandAliases: Record<string, string> = {}
    for (const r of (brandRes.data as any[]) || []) {
      brandAliases[String(r.csv_code).toUpperCase()] = String(r.brand_code)
    }

    const partAliases: Record<string, string> = {}
    for (const r of (partRes.data as any[]) || []) {
      partAliases[String(r.csv_text).toUpperCase()] = String(r.part_code)
    }

    setAliases({ brandAliases, partAliases })
    setItems((itemRes.data as ItemLookup[]) || [])
    setLoading(false)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = String(ev.target?.result || '')
      setCsvText(text)
      setParsedRows([])
      setDetected([])
      setEditingRow(null)
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

  function handleParseAuto() {
    setError('')
    if (!aliases) return
    if (!csvText.trim()) {
      setError('Please paste CSV.')
      return
    }
    try {
      const rows = parseCSV(csvText, aliases, items)
      if (rows.length === 0) {
        setError('No valid rows found in auto mode. Try Manual mapping.')
        return
      }
      setParsedRows(rows)
      setEditingRow(null)
    } catch (e: any) {
      setError(e.message || 'Failed to parse CSV')
    }
  }

  function handleParseManual() {
    setError('')
    if (!aliases) return
    const validation = validateMapping(mapping)
    if (!validation.valid) {
      setError('Missing required roles: ' + validation.missing.join(', '))
      return
    }
    try {
      const rows = applyMapping(csvText, mapping, aliases, items)
      if (rows.length === 0) {
        setError('No valid rows found. Check your mapping.')
        return
      }
      setParsedRows(rows)
      setEditingRow(null)
    } catch (e: any) {
      setError(e.message || 'Failed to parse CSV')
    }
  }

  function updateRow(index: number, patch: Partial<ParsedRow>) {
    setParsedRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r
        const merged = { ...r, ...patch }

        if (
          patch.brandCode !== undefined ||
          patch.modelName !== undefined ||
          patch.partCode !== undefined ||
          patch.quality !== undefined ||
          patch.network !== undefined ||
          patch.yearForSku !== undefined
        ) {
          const sku = buildSkuFromParts(merged)
          merged.generatedSku = sku
        }

        if (!merged.brandCode || !merged.modelName || !merged.partCode) {
          merged.status = 'error'
          merged.errorMessage = 'Missing brand, model, or part'
        } else if (!merged.generatedSku) {
          merged.status = 'error'
          merged.errorMessage = 'Could not build SKU'
        } else {
          const found = items.find(
            (it) => it.sku.toUpperCase() === merged.generatedSku!.toUpperCase()
          )
          if (found) {
            merged.matchedItemId = found.item_id
            merged.matchedItemSku = found.sku
            merged.status = 'matched'
          } else {
            merged.matchedItemId = null
            merged.matchedItemSku = null
            merged.status = 'new'
          }
          merged.errorMessage = undefined
        }

        return merged
      })
    )
  }

  function handleFill() {
    const { matched, newItems } = groupParsedRows(parsedRows)

    const usableMatched = matched.filter(
      (r) => r.status !== 'error' && r.generatedSku
    )
    const usableNew = newItems.filter(
      (r) => r.status !== 'error' && r.generatedSku
    )

    if (usableMatched.length === 0 && usableNew.length === 0) {
      setError('No valid rows to import.')
      return
    }
    onImport(usableMatched, usableNew, Number(margin) || 1.5)
    resetAndClose()
  }

  function resetAndClose() {
    setCsvText('')
    setParsedRows([])
    setDetected([])
    setMapping({})
    setError('')
    setMode('auto')
    setEditingRow(null)
    onClose()
  }

  if (!open) return null

  const grouped = groupParsedRows(parsedRows)
  const totalUsable = grouped.matched.length + grouped.newItems.length
  const mappingValidation = validateMapping(mapping)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
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

        {/* Mode toggle */}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="text-center py-8 text-slate-500">Loading...</div>
          )}

          {!loading && (
            <>
              {/* Step 1: Upload / Paste */}
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
                    setParsedRows([])
                    setDetected([])
                    setError('')
                    setEditingRow(null)
                  }}
                  placeholder="Paste CSV text here..."
                  rows={6}
                  className="w-full font-mono text-xs p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                {error && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}
              </div>

              {/* Auto mode */}
              {mode === 'auto' && (
                <div>
                  <button
                    onClick={handleParseAuto}
                    disabled={!csvText.trim()}
                    className="h-10 px-5 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-900 disabled:opacity-50"
                  >
                    Parse CSV (Auto)
                  </button>
                </div>
              )}

              {/* Manual mode */}
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
                          Apply Mapping & Preview
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

              {/* Preview */}
              {parsedRows.length > 0 && (
                <>
                  <div className="flex items-center gap-4 mt-6 mb-3 text-sm">
                    <span className="flex items-center gap-1 text-green-700 font-medium">
                      <Check className="w-4 h-4" />
                      {grouped.matched.length} matched
                    </span>
                    <span className="flex items-center gap-1 text-amber-700 font-medium">
                      <Sparkles className="w-4 h-4" />
                      {grouped.newItems.length} new
                    </span>
                    {grouped.errors.length > 0 && (
                      <span className="flex items-center gap-1 text-red-700 font-medium">
                        <AlertCircle className="w-4 h-4" />
                        {grouped.errors.length} errors
                      </span>
                    )}
                    <span className="text-xs text-slate-500 ml-auto">
                      Tip: click the pencil on an error row to fix it
                    </span>
                  </div>

                  <div className="border border-slate-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 sticky top-0 z-10">
                        <tr>
                          <th className="px-3 py-2 text-left">#</th>
                          <th className="px-3 py-2 text-left">Description</th>
                          <th className="px-3 py-2 text-left">Type</th>
                          <th className="px-3 py-2 text-left">Generated SKU</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2 text-right">Rate</th>
                          <th className="px-3 py-2 text-center">Status</th>
                          <th className="px-3 py-2 text-center w-10"></th>
                        </tr>
                      </thead>
 <tbody>
  {parsedRows.map((r, i) => {
    // Show parsed values if the row has been resolved (matched or new),
    // otherwise fall back to the raw input.
    const showParsed =
      (r.status === 'matched' || r.status === 'new') &&
      r.brandCode &&
      r.modelName &&
      r.partCode

    const displayDesc = showParsed
      ? `${r.brandCode} ${r.modelName}${r.quality !== 'Normal' ? ` · ${r.quality}` : ''}`
      : r.rawDescription

    const displayType = showParsed ? (r.partCode as string) : r.rawType

    const wasEdited =
      r.status !== 'error' &&
      (r.rawDescription !== displayDesc || r.rawType !== displayType)

    return (
      <tr
        key={i}
        className={
          r.status === 'matched'
            ? 'bg-green-50/50'
            : r.status === 'new'
            ? 'bg-amber-50/50'
            : 'bg-red-50/50'
        }
      >
        <td className="px-3 py-1.5 text-slate-500">{i + 1}</td>

        <td className="px-3 py-1.5 text-slate-700">
          {displayDesc}
          {wasEdited && (
            <span className="ml-2 text-[10px] text-blue-600 font-semibold">
              (edited)
            </span>
          )}
        </td>

        <td className="px-3 py-1.5 text-slate-600">{displayType || '—'}</td>

        <td className="px-3 py-1.5 font-mono text-slate-800">
          {r.generatedSku || '—'}
        </td>

        <td className="px-3 py-1.5 text-right">{r.qty}</td>

        <td className="px-3 py-1.5 text-right">
          ₹ {r.rate.toFixed(2)}
        </td>

        <td className="px-3 py-1.5 text-center">
          {r.status === 'matched' && (
            <span className="text-green-700 text-[10px] font-semibold">
              MATCHED
            </span>
          )}
          {r.status === 'new' && (
            <span className="text-amber-700 text-[10px] font-semibold">
              NEW
            </span>
          )}
          {r.status === 'error' && (
            <span
              className="text-red-700 text-[10px] font-semibold"
              title={r.errorMessage}
            >
              ERROR
            </span>
          )}
        </td>

        <td className="px-3 py-1.5 text-center">
          <button
            onClick={() => setEditingRow(editingRow === i ? null : i)}
            className={`p-1 rounded hover:bg-slate-200 ${
              r.status === 'error' ? 'text-red-600' : 'text-slate-400'
            }`}
            title="Edit row"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
    )
  })}
</tbody>
                    </table>
                  </div>

                  {editingRow !== null && parsedRows[editingRow] && (
                    <EditRowPanel
                      row={parsedRows[editingRow]}
                      index={editingRow}
                      onChange={(patch) => updateRow(editingRow, patch)}
                      onClose={() => setEditingRow(null)}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center gap-4">
            <div className="text-xs text-slate-500">
              {parsedRows.length > 0
                ? `${totalUsable} rows ready (${grouped.matched.length} matched + ${grouped.newItems.length} new)`
                : 'Waiting for CSV input...'}
            </div>
            {parsedRows.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <label className="text-slate-600">Margin:</label>
                <input
                  type="number"
                  step="0.1"
                  value={margin}
                  onChange={(e) => setMargin(e.target.value)}
                  className="w-16 h-7 px-2 text-xs text-center border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={resetAndClose}
              className="h-9 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-white"
            >
              Cancel
            </button>
            {parsedRows.length > 0 && totalUsable > 0 && (
              <button
                onClick={handleFill}
                className="h-9 px-5 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Create All & Fill ({totalUsable})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   Edit row panel — inline editor for a single preview row
   ============================================================ */
function EditRowPanel({
  row,
  index,
  onChange,
  onClose,
}: {
  row: ParsedRow
  index: number
  onChange: (patch: Partial<ParsedRow>) => void
  onClose: () => void
}) {
  const [brand, setBrand] = useState(row.brandCode || '')
  const [model, setModel] = useState(row.modelName || '')
  const [part, setPart] = useState(row.partCode || '')
  const [network, setNetwork] = useState(row.network || '')
  const [quality, setQuality] = useState<Quality>(row.quality || 'Normal')
  const [qty, setQty] = useState(String(row.qty))
  const [rate, setRate] = useState(String(row.rate))

  useEffect(() => {
    setBrand(row.brandCode || '')
    setModel(row.modelName || '')
    setPart(row.partCode || '')
    setNetwork(row.network || '')
    setQuality(row.quality || 'Normal')
    setQty(String(row.qty))
    setRate(String(row.rate))
  }, [row])

  function handleApply() {
    onChange({
      brandCode: brand.trim() || null,
      modelName: model.trim() || null,
      partCode: part.trim() || null,
      network: network.trim() || null,
      quality: quality,
      qty: parseFloat(qty) || 0,
      rate: parseFloat(rate) || 0,
    })
    onClose()
  }

  return (
    <div className="mt-3 border-2 border-blue-400 rounded-lg bg-blue-50/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-blue-900">
          Editing row #{index + 1}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="text-xs text-slate-600 mb-3 italic">
        Original: {row.rawDescription}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-700 mb-1">
            Brand code
          </label>
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value.toUpperCase())}
            placeholder="OP"
            className="w-full h-8 px-2 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-700 mb-1">
            Model
          </label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="F21S PRO 4G"
            className="w-full h-8 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-700 mb-1">
            Part code
          </label>
          <input
            value={part}
            onChange={(e) => setPart(e.target.value.toUpperCase())}
            placeholder="BP"
            className="w-full h-8 px-2 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-700 mb-1">
            Network
          </label>
          <input
            value={network}
            onChange={(e) => setNetwork(e.target.value.toUpperCase())}
            placeholder="4G / 5G"
            className="w-full h-8 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-700 mb-1">
            Quality
          </label>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as Quality)}
            className="w-full h-8 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="Normal">Normal</option>
            <option value="OG">OG</option>
            <option value="100 OG">100 OG</option>
            <option value="ORG">ORG</option>
            <option value="Care OG">Care OG</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-700 mb-1">
            Qty
          </label>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            type="number"
            className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-700 mb-1">
            Rate
          </label>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            type="number"
            step="0.01"
            className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={handleApply}
            className="w-full h-8 text-sm font-semibold text-white bg-blue-600 rounded hover:bg-blue-700"
          >
            Apply
          </button>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-slate-600">
        Preview SKU:{' '}
        <span className="font-mono text-slate-800">
          {buildSkuFromParts({
            brandCode: brand.trim() || null,
            modelName: model.trim() || null,
            partCode: part.trim() || null,
            network: network.trim() || null,
            quality: quality,
            yearForSku: row.yearForSku,
          }) || '—'}
        </span>
      </div>
    </div>
  )
}

function buildSkuFromParts(row: {
  brandCode: string | null
  modelName: string | null
  partCode: string | null
  network: string | null
  quality: string
  yearForSku: string | null
}): string | null {
  if (!row.brandCode || !row.modelName || !row.partCode) return null

  const modelPart = row.modelName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  const seg: string[] = [row.brandCode, modelPart]
  if (row.yearForSku) seg.push(row.yearForSku)
  seg.push(row.partCode)
  if (row.network) seg.push(row.network)
  if (row.quality === 'OG') seg.push('OG')
  if (row.quality === '100 OG') seg.push('100OG')
  if (row.quality === 'ORG') seg.push('ORG')
  if (row.quality === 'Care OG') seg.push('CARE')

  return seg.join('-')
}