'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getRole } from '@/lib/auth'
import { parseCSV, AliasMaps, ParsedRow, setDBMessages } from '@/lib/csv-parser'
import {
  ArrowLeft,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

type PurchaseRow = {
  purchase_id: number
  invoice_no: string | null
  purchase_date: string
  total_amount: number
  party_name: string
  fingerprints: string[]  // ordered by detail_id
  skus: string[]          // ordered by detail_id
}

type Candidate = {
  purchase_id: number
  invoice_no: string | null
  party_name: string
  score: number
  details: {
    firstAnchored: boolean
    lastAnchored: boolean
    subsequence: number
    matchedRows: number
    missingPurchaseRows: number[]
    csvRowsNotInDb: number[]
  }
}

type CsvFile = {
  filename: string
  csvText: string
  parsedRows: ParsedRow[]
  csvFps: string[]
  candidates: Candidate[]
  selectedPurchaseId: number | null
  expanded: boolean
}

export default function BatchAuditPage() {
  const router = useRouter()
  const [isOwner, setIsOwner] = useState(false)
  const [vendor, setVendor] = useState('SelfSide')
  const [vendors, setVendors] = useState<string[]>([])
  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [files, setFiles] = useState<CsvFile[]>([])
  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const role = getRole()
    if (role !== 'owner') {
      router.replace('/')
      return
    }
    setIsOwner(true)
    loadVendors()
    loadAliases()
  }, [router])

  useEffect(() => {
    if (isOwner && vendor) {
      loadVendorPurchases(vendor)
    }
  }, [vendor, isOwner])

  async function loadVendors() {
    const { data } = await supabase
      .from('parties')
      .select('party_name')
      .eq('party_type', 'Supplier')
      .order('party_name')
    const names = ((data as any[]) || []).map((p) => p.party_name)
    setVendors(names)
    if (names.length > 0 && !names.includes(vendor)) setVendor(names[0])
  }

  async function loadAliases() {
    const [b, p, c, f, q, v, t] = await Promise.all([
      supabase.from('brand_aliases').select('csv_code, brand_code'),
      supabase.from('part_type_aliases').select('csv_text, part_code'),
      supabase.from('parser_color_aliases').select('csv_text, color_value'),
      supabase.from('flag_aliases').select('source_text, target_flag'),
      supabase.from('quality_aliases').select('source_text, target_quality'),
      supabase.from('variant_aliases').select('source_text, target_variant'),
      supabase.from('typo_rules').select('pattern, replacement, match_type, priority').order('priority').order('id'),
    ])
    const toMap = (rows: any[], k: string, v: string) =>
      Object.fromEntries((rows || []).map((r) => [String(r[k]).toUpperCase().trim(), String(r[v])]))
    setDBMessages({
      partAliases: toMap(p.data || [], 'csv_text', 'part_code'),
      brandAliases: toMap(b.data || [], 'csv_code', 'brand_code'),
      colorAliases: toMap(c.data || [], 'csv_text', 'color_value'),
      flagAliases: toMap(f.data || [], 'source_text', 'target_flag'),
      qualityAliases: toMap(q.data || [], 'source_text', 'target_quality'),
      variantAliases: toMap(v.data || [], 'source_text', 'target_variant'),
      typoRules: ((t.data as any[]) || []).map((r) => ({
        pattern: String(r.pattern),
        replacement: String(r.replacement),
        match_type: (r.match_type as 'word' | 'phrase' | 'regex') || 'word',
        priority: r.priority ?? 100,
      })),
    })
  }

  async function loadVendorPurchases(v: string) {
    setLoading(true)
    try {
      // Load purchases for vendor
      const { data: purch } = await supabase
        .from('purchases')
        .select('purchase_id, invoice_no, purchase_date, total_amount, parties!inner(party_name)')
        .eq('parties.party_name', v)
        .order('purchase_date', { ascending: false })

      const purchaseIds = ((purch as any[]) || []).map((p) => p.purchase_id)

      // Load all purchase_items for those purchases + item fingerprints
      type PIRow = { purchase_id: number; detail_id: number; item_id: number }
      const piMap: Record<number, PIRow[]> = {}
      const itemIds = new Set<number>()

      if (purchaseIds.length > 0) {
        const CHUNK = 100
        for (let i = 0; i < purchaseIds.length; i += CHUNK) {
          const slice = purchaseIds.slice(i, i + CHUNK)
          const { data: pi } = await supabase
            .from('purchase_items')
            .select('purchase_id, detail_id, item_id')
            .in('purchase_id', slice)
            .order('detail_id')
          for (const r of (pi as any[]) || []) {
            if (!piMap[r.purchase_id]) piMap[r.purchase_id] = []
            piMap[r.purchase_id].push(r)
            itemIds.add(r.item_id)
          }
        }
      }

      // Load items (fingerprint + sku) for those item_ids
      const itemData: Record<number, { sku: string; fingerprint: string | null }> = {}
      const itemIdList = Array.from(itemIds)
      if (itemIdList.length > 0) {
        const CHUNK = 200
        for (let i = 0; i < itemIdList.length; i += CHUNK) {
          const slice = itemIdList.slice(i, i + CHUNK)
          const { data: its } = await supabase
            .from('items')
            .select('item_id, sku, fingerprint')
            .in('item_id', slice)
          for (const it of (its as any[]) || []) {
            itemData[it.item_id] = { sku: it.sku, fingerprint: it.fingerprint }
          }
        }
      }

      // Build PurchaseRow[] with fingerprints + skus in order
      const rows: PurchaseRow[] = ((purch as any[]) || []).map((p) => {
        const items = (piMap[p.purchase_id] || [])
          .sort((a, b) => a.detail_id - b.detail_id)
        const fingerprints = items.map((pi) => itemData[pi.item_id]?.fingerprint || '').filter(Boolean)
        const skus = items.map((pi) => itemData[pi.item_id]?.sku || '')
        return {
          purchase_id: p.purchase_id,
          invoice_no: p.invoice_no,
          purchase_date: p.purchase_date,
          total_amount: p.total_amount,
          party_name: p.parties?.party_name || v,
          fingerprints,
          skus,
        }
      })
      setPurchases(rows)
    } catch (e: any) {
      setError('Failed to load purchases: ' + (e.message || 'unknown'))
    } finally {
      setLoading(false)
    }
  }

  function computeFingerprint(r: ParsedRow): string | null {
    if (!r.brandCode || !r.partCode) return null
    const parts = [
      (r.brandCode || '').toUpperCase().trim(),
      (r.modelName || '').toUpperCase().trim(),
      (r.partCode || '').toUpperCase().trim(),
      (r.quality || '').trim(),
      (r.color || '').toUpperCase().trim(),
      (r.variant || '').toUpperCase().trim(),
      (r.flag || '').toUpperCase().trim(),
      (r.network || '').toUpperCase().trim(),
      (r.year || '').toUpperCase().trim(),
    ]
    return parts.join('|')
  }

  function isSubsequence(csvFps: string[], dbFps: string[]) {
    let j = 0
    let matched = 0
    for (const fp of csvFps) {
      while (j < dbFps.length && dbFps[j] !== fp) j++
      if (j < dbFps.length) {
        matched++
        j++
      } else {
        break
      }
    }
    return { matched, length: csvFps.length, ratio: csvFps.length > 0 ? matched / csvFps.length : 0 }
  }

  function scorePurchase(csvFps: string[], dbFps: string[]): Candidate['details'] & { score: number } {
    if (!csvFps.length || !dbFps.length) {
      return {
        score: 0,
        firstAnchored: false,
        lastAnchored: false,
        subsequence: 0,
        matchedRows: 0,
        missingPurchaseRows: [],
        csvRowsNotInDb: [],
      }
    }

    let score = 0

    // First anchor: db first fingerprint appears in csv's first 3
    const firstAnchored = csvFps.slice(0, 3).includes(dbFps[0])
    if (firstAnchored) score += 4

    // Last anchor: db last fingerprint appears in csv's last 3
    const lastAnchored = csvFps.slice(-3).includes(dbFps[dbFps.length - 1])
    if (lastAnchored) score += 4

    // Subsequence
    const sub = isSubsequence(csvFps, dbFps)
    score += sub.ratio

    // Missing rows
    const csvSet = new Set(csvFps)
    const missingPurchaseRows = dbFps
      .map((fp, idx) => ({ idx: idx + 1, fp, found: csvSet.has(fp) }))
      .filter((x) => !x.found)
      .map((x) => x.idx)

    const dbSet = new Set(dbFps)
    const csvRowsNotInDb = csvFps
      .map((fp, idx) => ({ idx: idx + 1, fp, found: dbSet.has(fp) }))
      .filter((x) => !x.found)
      .map((x) => x.idx)

    return {
      score,
      firstAnchored,
      lastAnchored,
      subsequence: sub.ratio,
      matchedRows: sub.matched,
      missingPurchaseRows,
      csvRowsNotInDb,
    }
  }

  function processFiles(fileList: FileList) {
    const arr = Array.from(fileList)
    const newFiles: CsvFile[] = []

    const reader = new FileReader()
    let idx = 0

    function readNext() {
      if (idx >= arr.length) {
        setFiles((prev) => [...prev, ...newFiles])
        return
      }
      const file = arr[idx]
      reader.onload = (ev) => {
        const text = String(ev.target?.result || '')
        try {
          const aliases: AliasMaps = { brandAliases: {}, partAliases: {}, colorAliases: {} }
          const parsed = parseCSV(text, aliases, [])
          const csvFps = parsed.map((r) => computeFingerprint(r)).filter(Boolean) as string[]

          // Score against every purchase for vendor
          const candidates: Candidate[] = purchases.map((p) => {
            const details = scorePurchase(csvFps, p.fingerprints)
            return {
              purchase_id: p.purchase_id,
              invoice_no: p.invoice_no,
              party_name: p.party_name,
              score: details.score,
              details,
            }
          })
          candidates.sort((a, b) => b.score - a.score)

          const best = candidates[0]
          const selectedPurchaseId = best && best.score >= 8.5 ? best.purchase_id : null

          newFiles.push({
            filename: file.name,
            csvText: text,
            parsedRows: parsed,
            csvFps,
            candidates: candidates.slice(0, 3),
            selectedPurchaseId,
            expanded: false,
          })
        } catch (e: any) {
          newFiles.push({
            filename: file.name,
            csvText: text,
            parsedRows: [],
            csvFps: [],
            candidates: [],
            selectedPurchaseId: null,
            expanded: false,
          })
        }
        idx++
        readNext()
      }
      reader.readAsText(file)
    }
    readNext()
  }

  async function handleConfirmAll() {
    setError('')
    setMessage('')

    const readyFiles = files.filter((f) => f.selectedPurchaseId)
    if (readyFiles.length === 0) {
      setError('No files have a purchase selected')
      return
    }

    setProcessing(true)
    try {
      let inserted = 0
      for (const file of readyFiles) {
        if (!file.selectedPurchaseId) continue
        const rows = file.parsedRows.map((r) => ({
          purchase_id: file.selectedPurchaseId,
          source_csv_filename: file.filename,
          source_row_number: r.rowNumber,
          raw_description: r.rawDescription,
          raw_type: r.rawType,
          qty: r.qty,
          rate: r.rate,
          brand_code: r.brandCode,
          model_name: r.modelName,
          part_code: r.partCode,
          quality: r.quality,
          color: r.color,
          variant: r.variant,
          flag: r.flag,
          network: r.network,
          year: r.year,
          generated_sku: r.generatedSku,
          fingerprint: computeFingerprint(r),
          status: r.status === 'needs_correction' ? 'parse_error' : (r.status === 'matched' ? 'ok' : 'missing_item'),
          notes: r.errorMessage || null,
        }))
        const { error: ie } = await supabase.from('purchase_import_audit').insert(rows)
        if (ie) throw new Error(`${file.filename}: ${ie.message}`)
        inserted += rows.length
      }
      setMessage(`${inserted} rows inserted across ${readyFiles.length} files. Refresh to start new batch.`)
      setFiles([])
    } catch (e: any) {
      setError(e.message || 'Insert failed')
    } finally {
      setProcessing(false)
    }
  }

  function updateSelectedPurchase(filename: string, purchaseId: number) {
    setFiles((prev) =>
      prev.map((f) => (f.filename === filename ? { ...f, selectedPurchaseId: purchaseId } : f))
    )
  }

  function toggleExpand(filename: string) {
    setFiles((prev) =>
      prev.map((f) => (f.filename === filename ? { ...f, expanded: !f.expanded } : f))
    )
  }

  if (!isOwner) return null

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/admin" className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Batch Purchase Audit</h1>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Vendor</label>
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg"
          >
            {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Upload CSVs</label>
          <label className="w-full h-10 flex items-center justify-center gap-2 px-3 text-sm border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
            <Upload className="w-4 h-4" />
            <span>Choose multiple CSV files</span>
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={(e) => e.target.files && processFiles(e.target.files)}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {loading && (
        <div className="text-center py-8 text-sm text-slate-500 flex items-center gap-2 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading {vendor} purchases…
        </div>
      )}

      {message && (
        <div className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {message}
        </div>
      )}

      {error && (
        <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {files.length > 0 && (
        <>
          <div className="border border-slate-200 rounded-lg overflow-hidden mb-3">
            {files.map((f) => {
              const best = f.candidates[0]
              const isHigh = best && best.score >= 8.5
              const isMid = best && best.score >= 6.0 && best.score < 8.5
              const isLow = !best || best.score < 6.0

              return (
                <div key={f.filename} className="border-b border-slate-100 last:border-b-0">
                  <div
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 ${
                      isHigh ? 'bg-green-50/40' : isMid ? 'bg-amber-50/40' : 'bg-red-50/40'
                    }`}
                    onClick={() => toggleExpand(f.filename)}
                  >
                    {f.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-800">{f.filename}</div>
                      <div className="text-xs text-slate-500">
                        {f.parsedRows.length} parsed rows
                        {best && (
                          <> · Best: {best.invoice_no || `#${best.purchase_id}`} · score {best.score.toFixed(1)}/9.0
                          {best.details.firstAnchored && ' · ✓first'}
                          {best.details.lastAnchored && ' · ✓last'}
                          {' · '}{(best.details.subsequence * 100).toFixed(0)}% subseq</>
                        )}
                      </div>
                    </div>
                    <div>
                      {isHigh && <span className="text-green-700 text-xs font-semibold">✓ ready</span>}
                      {isMid && <span className="text-amber-700 text-xs font-semibold">⚠ review</span>}
                      {isLow && <span className="text-red-700 text-xs font-semibold">✗ manual</span>}
                    </div>
                  </div>

                  {f.expanded && (
                    <div className="px-6 py-3 bg-white border-t border-slate-100">
                      <div className="text-xs text-slate-600 mb-2 font-medium">Pick purchase:</div>
                      <select
                        value={f.selectedPurchaseId ?? ''}
                        onChange={(e) => updateSelectedPurchase(f.filename, Number(e.target.value))}
                        className="w-full h-9 px-3 text-sm border border-slate-300 rounded mb-2"
                      >
                        <option value="">— Select purchase —</option>
                        {f.candidates.map((c) => (
                          <option key={c.purchase_id} value={c.purchase_id}>
                            {c.invoice_no || `#${c.purchase_id}`} — {c.party_name} — score {c.score.toFixed(1)}
                            {' '}({c.details.firstAnchored ? '✓F' : '✗F'} {c.details.lastAnchored ? '✓L' : '✗L'} {(c.details.subsequence * 100).toFixed(0)}%)
                          </option>
                        ))}
                        <optgroup label="All vendor purchases">
                          {purchases.map((p) => (
                            <option key={p.purchase_id} value={p.purchase_id}>
                              {p.invoice_no || `#${p.purchase_id}`} — ₹{p.total_amount} — {p.purchase_date} — {p.fingerprints.length} items
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      {best && (
                        <div className="text-xs text-slate-600 space-y-1">
                          <div>First anchored: {best.details.firstAnchored ? '✓' : '✗'}</div>
                          <div>Last anchored: {best.details.lastAnchored ? '✓' : '✗'}</div>
                          <div>Subsequence: {(best.details.subsequence * 100).toFixed(0)}% ({best.details.matchedRows}/{f.csvFps.length})</div>
                          {best.details.missingPurchaseRows.length > 0 && (
                            <div className="text-amber-700">Missing purchase rows: {best.details.missingPurchaseRows.join(', ')}</div>
                          )}
                          {best.details.csvRowsNotInDb.length > 0 && (
                            <div className="text-red-700">CSV rows not in DB: {best.details.csvRowsNotInDb.join(', ')}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-600">
              {files.filter((f) => f.selectedPurchaseId).length}/{files.length} files ready
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFiles([])}
                className="h-9 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-white"
              >
                Clear All
              </button>
              <button
                onClick={handleConfirmAll}
                disabled={processing || files.filter((f) => f.selectedPurchaseId).length === 0}
                className="h-9 px-5 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {processing ? 'Inserting…' : 'Confirm All'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}