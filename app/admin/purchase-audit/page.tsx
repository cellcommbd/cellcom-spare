'use client'

// Purchase audit — Stage 1.5: raw_description capture + dashboard summary.
// Read-only against product tables. Writes to purchase_import_audit (log) and
// csv_purchase_map (mapping memory).
//
// Matching: SKU-first, then components, then near-model drift.
// Rate tolerance: 20% (freight markup ignored).
// Negative-qty rows skipped (returns/replacements).

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getRole } from '@/lib/auth'
import { parseCSV, AliasMaps, ParsedRow, setDBMessages, normalizePartCode } from '@/lib/csv-parser'
import {
  ArrowLeft, FolderOpen, Loader2, CheckCircle2, AlertTriangle, Copy,
  ChevronRight, ChevronDown, SkipForward, RefreshCw, Zap,
} from 'lucide-react'

type DBLine = {
  detail_id: number
  item_id: number
  sku: string
  brand: string
  model: string
  part: string
  quality: string
  qty: number
  rate: number
  part_id_null: boolean
}

type PurchaseRow = {
  purchase_id: number
  invoice_no: string | null
  purchase_date: string
  party_name: string
  lines: DBLine[]
}

type CsvFile = {
  filename: string
  parsedRows: ParsedRow[]
  mappedPurchaseId: number | null
  mappedVendor: string | null
}

type RowDiff = {
  csvRowNumber: number | null
  csvSku: string | null
  dbSku: string | null
  csvQty: number | null
  csvRate: number | null
  dbQty: number | null
  dbRate: number | null
  status:
    | 'ok'
    | 'ok_with_drift'
    | 'sku_drift_near'
    | 'sku_identical_unlinked'
    | 'qty_diff'
    | 'price_diff'
    | 'missing_item'
    | 'db_only'
    | 'parse_err'
  returned: boolean
  note: string
  mismatch_reason: string | null
  rawDescription: string | null
}

type FileReport = {
  filename: string
  purchase_id: number
  invoice_no: string | null
  party_name: string
  purchase_date: string
  rows: RowDiff[]
  counts: Record<string, number>
  skipped_negative: number
}

const RATE_TOLERANCE = 0.20
const PAGE_SIZE = 1000

export default function PurchaseAuditPage() {
  const router = useRouter()
  const [isOwner, setIsOwner] = useState(false)
  const [aliasReady, setAliasReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [expectedVendor, setExpectedVendor] = useState('')
  const [vendors, setVendors] = useState<string[]>([])

  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [purchasesLoaded, setPurchasesLoaded] = useState(false)
  const [loadingPurchases, setLoadingPurchases] = useState(false)

  const [files, setFiles] = useState<CsvFile[]>([])
  const [folderName, setFolderName] = useState<string | null>(null)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [expandedPurchase, setExpandedPurchase] = useState<number | null>(null)
  const [activeCompare, setActiveCompare] = useState<{ purchase: PurchaseRow; report: FileReport } | null>(null)
  const [reports, setReports] = useState<FileReport[]>([])
  const [rowFilter, setRowFilter] = useState<number>(5)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, filename: '' })

  useEffect(() => {
    const role = getRole()
    if (role !== 'owner') { router.replace('/'); return }
    setIsOwner(true)
    loadAliases()
    loadVendors()
  }, [router])

  async function loadVendors() {
    const { data } = await supabase
      .from('parties')
      .select('party_name')
      .eq('party_type', 'Supplier')
      .order('party_name')
    setVendors(((data as any[]) || []).map((p) => p.party_name))
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
    const toMap = (rows: any[], k: string, val: string) =>
      Object.fromEntries((rows || []).map((r) => [String(r[k]).toUpperCase().trim(), String(r[val])]))
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
    setAliasReady(true)
  }

  async function loadAllPurchases() {
    setLoadingPurchases(true)
    setError('')
    setMessage('Loading purchases…')
    try {
      const purchRows: any[] = []
      let offset = 0
      while (true) {
        const { data, error: pe } = await supabase
          .from('purchases')
          .select('purchase_id, invoice_no, purchase_date, parties!inner(party_name)')
          .order('purchase_date', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)
        if (pe) throw new Error(pe.message)
        if (!data || data.length === 0) break
        purchRows.push(...data)
        if (data.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      const ids = purchRows.map((p) => p.purchase_id)
      if (ids.length === 0) { setPurchases([]); setPurchasesLoaded(true); setMessage('No purchases.'); return }

      const piRows: any[] = []
      offset = 0
      while (true) {
        const { data, error: pie } = await supabase
          .from('purchase_items')
          .select('purchase_id, detail_id, item_id, quantity, rate')
          .in('purchase_id', ids)
          .order('detail_id')
          .range(offset, offset + PAGE_SIZE - 1)
        if (pie) throw new Error(pie.message)
        if (!data || data.length === 0) break
        piRows.push(...data)
        if (data.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      const piByPurchase: Record<number, any[]> = {}
      for (const r of piRows) {
        if (!piByPurchase[r.purchase_id]) piByPurchase[r.purchase_id] = []
        piByPurchase[r.purchase_id].push(r)
      }

      const itemIds = Array.from(new Set(piRows.map((r) => r.item_id)))
      const itemMap: Record<number, {
        sku: string; brand: string; model: string; part: string; quality: string; part_id_null: boolean
      }> = {}
      for (let i = 0; i < itemIds.length; i += PAGE_SIZE) {
        const slice = itemIds.slice(i, i + PAGE_SIZE)
        const { data: its, error: ie } = await supabase
          .from('items')
          .select(`
            item_id, sku, quality, part_id,
            brands ( brand_code ),
            models ( model_name ),
            part_types ( part_code )
          `)
          .in('item_id', slice)
        if (ie) throw new Error(ie.message)
        for (const it of (its as any[]) || []) {
          itemMap[it.item_id] = {
            sku: it.sku || '',
            brand: it.brands?.brand_code || '',
            model: it.models?.model_name || '',
            part: normalizePartCode(it.part_types?.part_code || '') || '',
            quality: it.quality || '',
            part_id_null: it.part_id == null,
          }
        }
      }

      const out: PurchaseRow[] = purchRows.map((p) => {
        const pis = (piByPurchase[p.purchase_id] || []).slice().sort((a, b) => a.detail_id - b.detail_id)
        const lines: DBLine[] = pis.map((pi: any) => {
          const meta = itemMap[pi.item_id] || { sku: '', brand: '', model: '', part: '', quality: '', part_id_null: false }
          return {
            detail_id: pi.detail_id,
            item_id: pi.item_id,
            sku: meta.sku,
            brand: meta.brand,
            model: meta.model,
            part: meta.part,
            quality: meta.quality,
            qty: Number(pi.quantity || 0),
            rate: Number(pi.rate || 0),
            part_id_null: meta.part_id_null,
          }
        })
        return {
          purchase_id: p.purchase_id,
          invoice_no: p.invoice_no,
          purchase_date: p.purchase_date,
          party_name: p.parties?.party_name || '',
          lines,
        }
      })

      setPurchases(out)
      setPurchasesLoaded(true)
      setMessage(`${out.length} purchases loaded`)
    } catch (e: any) {
      setError(e.message || 'Load failed')
    } finally {
      setLoadingPurchases(false)
    }
  }

  async function loadMappingFor(filenames: string[]): Promise<Map<string, { purchase_id: number; vendor_name: string | null }>> {
    const map = new Map<string, { purchase_id: number; vendor_name: string | null }>()
    if (filenames.length === 0) return map
    const { data } = await supabase
      .from('csv_purchase_map')
      .select('csv_filename, purchase_id, vendor_name')
      .in('csv_filename', filenames)
    for (const r of (data as any[]) || []) {
      map.set(r.csv_filename, { purchase_id: r.purchase_id, vendor_name: r.vendor_name })
    }
    return map
  }

  async function saveMapping(filename: string, purchase_id: number, vendor_name: string) {
    const { error: err } = await supabase
      .from('csv_purchase_map')
      .upsert(
        {
          csv_filename: filename,
          purchase_id,
          vendor_name,
          confirmed_at: new Date().toISOString(),
        },
        { onConflict: 'csv_filename,vendor_name' }
      )
    if (err) throw new Error(`Mapping save failed for ${filename}: ${err.message}`)
  }

    async function unmapFile(filename: string) {
    if (!confirm(`Remove mapping for ${filename}?\n\nThe file will show as "not yet mapped". You can then re-map it to a different purchase.`)) {
      return
    }
    setError('')
    try {
      const { error: err } = await supabase
        .from('csv_purchase_map')
        .delete()
        .eq('csv_filename', filename)
      if (err) throw new Error(err.message)
      setFiles((prev) =>
        prev.map((f) =>
          f.filename === filename
            ? { ...f, mappedPurchaseId: null, mappedVendor: null }
            : f
        )
      )
      setMessage(`Unmapped ${filename}`)
    } catch (e: any) {
      setError(e.message || 'Unmap failed')
    }
  }
  async function pickFolder() {
    setError('')
    const w = window as any
    if (typeof w.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await w.showDirectoryPicker()
        const entries: File[] = []
        for await (const [name, handle] of (dirHandle as any).entries()) {
          if (handle.kind === 'file' && name.toLowerCase().endsWith('.csv')) {
            entries.push(await handle.getFile())
          }
        }
        entries.sort((a, b) => a.name.localeCompare(b.name))
        await loadFiles(entries, dirHandle.name)
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(e.message || 'Folder pick failed')
      }
    } else {
      const input = document.createElement('input')
      input.type = 'file'
      input.setAttribute('webkitdirectory', '')
      input.multiple = true
      input.accept = '.csv'
      input.onchange = async () => {
        const fl = input.files
        if (!fl) return
        const arr = Array.from(fl).filter((f) => f.name.toLowerCase().endsWith('.csv'))
        arr.sort((a, b) => a.name.localeCompare(b.name))
        const rel = (arr[0] as any)?.webkitRelativePath || ''
        await loadFiles(arr, rel.split('/')[0] || null)
      }
      input.click()
    }
  }

  async function loadFiles(fileArr: File[], folder: string | null) {
    setFolderName(folder)
    const parsed: CsvFile[] = []
    for (const f of fileArr) {
      const text = await f.text()
      const aliases: AliasMaps = { brandAliases: {}, partAliases: {}, colorAliases: {} }
      let rows: ParsedRow[] = []
      try { rows = parseCSV(text, aliases, []) } catch { rows = [] }
      parsed.push({
        filename: f.name,
        parsedRows: rows,
        mappedPurchaseId: null,
        mappedVendor: null,
      })
    }
    const mapping = await loadMappingFor(parsed.map((p) => p.filename))
    for (const p of parsed) {
      const hit = mapping.get(p.filename)
      if (hit) {
        p.mappedPurchaseId = hit.purchase_id
        p.mappedVendor = hit.vendor_name
      }
    }
    setFiles(parsed)
    setCurrentIdx(0)
    setActiveCompare(null)
    setExpandedPurchase(null)
    setReports([])
  }

  function rateDiffPct(a: number, b: number): number {
    if (!a || !b) return 1
    return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b))
  }

  function computeOverlap(file: CsvFile, purchase: PurchaseRow): number {
    const dbKeys = new Set<string>()
    const dbSkus = new Set<string>()
    for (const l of purchase.lines) {
      if (l.brand && l.model && l.part) {
        dbKeys.add(`${l.brand.toUpperCase()}|${l.model.toUpperCase()}|${l.part.toUpperCase()}`)
      }
      if (l.sku) dbSkus.add(l.sku.toUpperCase())
    }
    let count = 0
    for (const r of file.parsedRows) {
      if (r.status === 'needs_correction' || r.qty < 0) continue
      if (r.generatedSku && dbSkus.has(r.generatedSku.toUpperCase())) { count++; continue }
      if (r.brandCode && r.modelName && r.partCode) {
        const csvPart = normalizePartCode(r.partCode) || r.partCode
        const key = `${r.brandCode.toUpperCase()}|${r.modelName.toUpperCase()}|${csvPart.toUpperCase()}`
        if (dbKeys.has(key)) count++
      }
    }
    return count
  }

  function isNearModelDrift(csvModel: string, dbModel: string): boolean {
    const a = csvModel.toUpperCase().replace(/\s+/g, ' ').trim()
    const b = dbModel.toUpperCase().replace(/\s+/g, ' ').trim()
    if (a === b) return false
    if (a.startsWith(b) || b.startsWith(a)) return true
    const aT = a.split(' ')
    const bT = b.split(' ')
    const [short, long] = aT.length <= bT.length ? [aT, bT] : [bT, aT]
    return short.every((t) => long.includes(t))
  }

  function diffFile(file: CsvFile, purchase: PurchaseRow): FileReport {
    const dbByKey = new Map<string, DBLine[]>()
    const dbBySku = new Map<string, DBLine[]>()
    for (const l of purchase.lines) {
      if (l.brand && l.model && l.part) {
        const key = `${l.brand.toUpperCase()}|${l.model.toUpperCase()}|${l.part.toUpperCase()}`
        if (!dbByKey.has(key)) dbByKey.set(key, [])
        dbByKey.get(key)!.push(l)
      }
      if (l.sku) {
        const s = l.sku.toUpperCase()
        if (!dbBySku.has(s)) dbBySku.set(s, [])
        dbBySku.get(s)!.push(l)
      }
    }

    const rows: RowDiff[] = []
    const usedDb = new Set<number>()
    let skippedNegative = 0

    for (const r of file.parsedRows) {
      if (r.qty < 0) { skippedNegative++; continue }

      if (!r.generatedSku) {
        rows.push({
          csvRowNumber: r.rowNumber, csvSku: r.generatedSku, dbSku: null,
          csvQty: r.qty, csvRate: r.rate, dbQty: null, dbRate: null,
          status: 'parse_err', returned: false,
          note: r.errorMessage || 'Parser could not build components',
          mismatch_reason: 'parser incomplete',
          rawDescription: r.rawDescription || null,
        })
        continue
      }

      const safeBrand = (r.brandCode || '').toUpperCase()
      const safeModel = (r.modelName || '').toUpperCase()
      const csvPart = normalizePartCode(r.partCode || '') || (r.partCode || '')
      const csvKey = `${safeBrand}|${safeModel}|${csvPart.toUpperCase()}`

      let candidates: DBLine[] = (dbBySku.get(r.generatedSku.toUpperCase()) || []).filter((d) => !usedDb.has(d.detail_id))
      let matchedVia: 'sku' | 'component' | 'near' | null = null

      if (candidates.length > 0) {
        matchedVia = 'sku'
      } else {
        candidates = (dbByKey.get(csvKey) || []).filter((d) => !usedDb.has(d.detail_id))
        if (candidates.length > 0) matchedVia = 'component'
      }

      let nearDriftCandidates: DBLine[] = []
      if (candidates.length === 0) {
        for (const l of purchase.lines) {
          if (usedDb.has(l.detail_id)) continue
          if (l.brand.toUpperCase() !== safeBrand) continue
          if (l.part.toUpperCase() !== csvPart.toUpperCase()) continue
          if (isNearModelDrift(r.modelName || '', l.model)) nearDriftCandidates.push(l)
        }
        if (nearDriftCandidates.length > 0) matchedVia = 'near'
      }

      if (candidates.length === 0 && nearDriftCandidates.length === 0) {
        rows.push({
          csvRowNumber: r.rowNumber, csvSku: r.generatedSku, dbSku: null,
          csvQty: r.qty, csvRate: r.rate, dbQty: null, dbRate: null,
          status: 'missing_item', returned: false,
          note: 'No SKU or brand+model+part match in DB',
          mismatch_reason: 'no match',
          rawDescription: r.rawDescription || null,
        })
        continue
      }

      let best: DBLine
      if (candidates.length > 0) {
        let bestScore = -1
        best = candidates[0]
        for (const c of candidates) {
          let s = 0
          if (c.qty === r.qty) s += 100
          s += (1 - rateDiffPct(r.rate || 0, c.rate)) * 10
          if (s > bestScore) { bestScore = s; best = c }
        }
      } else {
        best = nearDriftCandidates[0]
      }
      usedDb.add(best.detail_id)

      const qtyMatch = best.qty === r.qty
      const rateOk = rateDiffPct(r.rate || 0, best.rate) <= RATE_TOLERANCE
      const skuMatch = best.sku === r.generatedSku
      const returned = best.qty < 0

      let status: RowDiff['status'] = 'ok'
      let mismatch_reason: string | null = null
      let note = ''

      if (!qtyMatch && rateOk) {
        status = 'qty_diff'
        mismatch_reason = `qty: CSV ${r.qty} vs DB ${best.qty}`
        note = mismatch_reason
      } else if (qtyMatch && !rateOk) {
        status = 'price_diff'
        const pct = (rateDiffPct(r.rate || 0, best.rate) * 100).toFixed(1)
        mismatch_reason = `rate: CSV ${r.rate} vs DB ${best.rate} (${pct}%)`
        note = mismatch_reason
      } else if (!qtyMatch && !rateOk) {
        status = 'missing_item'
        mismatch_reason = 'qty and rate differ'
        note = `qty ${r.qty}→${best.qty}, rate ${r.rate}→${best.rate}`
      } else if (matchedVia === 'near') {
        status = 'sku_drift_near'
        mismatch_reason = `model drift: "${best.model}" vs "${r.modelName}"`
        note = 'near-match by brand+part, model differs'
      } else if (!skuMatch && matchedVia === 'sku') {
        status = 'sku_identical_unlinked'
        mismatch_reason = 'SKU identical but components differ in DB'
        note = 'DB component data inconsistent for this item'
      } else if (!skuMatch) {
        status = 'ok_with_drift'
        mismatch_reason = 'SKU string differs'
        note = `DB SKU: ${best.sku}`
      }

      rows.push({
        csvRowNumber: r.rowNumber, csvSku: r.generatedSku, dbSku: best.sku,
        csvQty: r.qty, csvRate: r.rate, dbQty: best.qty, dbRate: best.rate,
        status, returned, note, mismatch_reason,
        rawDescription: r.rawDescription || null,
      })
    }

    for (const l of purchase.lines) {
      if (usedDb.has(l.detail_id)) continue
      const returned = l.qty < 0
      rows.push({
        csvRowNumber: null, csvSku: null, dbSku: l.sku,
        csvQty: null, csvRate: null, dbQty: l.qty, dbRate: l.rate,
        status: 'db_only', returned,
        note: returned ? 'Returned to vendor (negative qty)' : 'In DB, not in CSV',
        mismatch_reason: returned ? 'returned' : 'missing in CSV',
        rawDescription: null,
      })
    }

    const counts: Record<string, number> = {}
    for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1

    return {
      filename: file.filename,
      purchase_id: purchase.purchase_id,
      invoice_no: purchase.invoice_no,
      party_name: purchase.party_name,
      purchase_date: purchase.purchase_date,
      rows, counts, skipped_negative: skippedNegative,
    }
  }

  function openCompare(purchase: PurchaseRow) {
    const activeFile = files[currentIdx]
    if (!activeFile) return
    const report = diffFile(activeFile, purchase)
    setActiveCompare({ purchase, report })
    setExpandedPurchase(null)
  }

  async function writeAuditRows(purchase: PurchaseRow, report: FileReport) {
    const vendorMismatch = expectedVendor ? purchase.party_name !== expectedVendor : false
    const auditRows = report.rows.map((r) => ({
      purchase_id: purchase.purchase_id,
      matched_purchase_id: purchase.purchase_id,
      matched_vendor: purchase.party_name,
      vendor_mismatch: vendorMismatch,
      source_csv_filename: report.filename,
      source_row_number: r.csvRowNumber,
      raw_description: r.rawDescription,
      qty: r.csvQty,
      qty_csv: r.csvQty,
      qty_db: r.dbQty,
      rate_csv: r.csvRate,
      rate_db: r.dbRate,
      generated_sku: r.csvSku,
      old_sku: r.status === 'ok_with_drift' || r.status === 'sku_drift_near' ? r.dbSku : null,
      new_sku: r.status === 'ok_with_drift' || r.status === 'sku_drift_near' ? r.csvSku : null,
      status: r.status,
      file_status: vendorMismatch ? 'matched_different_vendor' : 'matched',
      notes: r.note,
      mismatch_reason: r.mismatch_reason,
    }))
    const { error: ie } = await supabase.from('purchase_import_audit').insert(auditRows)
    if (ie) throw new Error(ie.message)
    await saveMapping(report.filename, purchase.purchase_id, purchase.party_name)
  }

  async function writeAudit() {
    if (!activeCompare) return
    setRunning(true)
    setError('')
    try {
      const { purchase, report } = activeCompare
      await writeAuditRows(purchase, report)

      setFiles((prev) =>
        prev.map((f, i) =>
          i === currentIdx
            ? { ...f, mappedPurchaseId: purchase.purchase_id, mappedVendor: purchase.party_name }
            : f
        )
      )

      setReports((prev) => [...prev, report])
      setActiveCompare(null)

      const nextIdx = currentIdx + 1
      if (nextIdx < files.length) {
        setCurrentIdx(nextIdx)
        setMessage(`Mapped ${report.filename} → #${purchase.purchase_id}. Advanced to file ${nextIdx + 1}/${files.length}.`)
      } else {
        setMessage(`Done — ${files.length} files audited.`)
      }
    } catch (e: any) {
      setError(e.message || 'Write failed')
    } finally {
      setRunning(false)
    }
  }

  async function confirmAllMapped() {
    if (!purchasesLoaded) { setError('Load purchases first'); return }
    const mappedFiles = files.filter((f) => f.mappedPurchaseId !== null)
    if (mappedFiles.length === 0) { setError('No files have mappings to confirm'); return }

    setBulkRunning(true)
    setError('')
    setMessage('')
    const newReports: FileReport[] = []

    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        if (!f.mappedPurchaseId) continue
        const purchase = purchases.find((p) => p.purchase_id === f.mappedPurchaseId)
        if (!purchase) {
          console.warn(`Purchase #${f.mappedPurchaseId} not found for ${f.filename}`)
          continue
        }
        setBulkProgress({ current: i + 1, total: files.length, filename: f.filename })
        const report = diffFile(f, purchase)
        await writeAuditRows(purchase, report)
        newReports.push(report)
      }
      setReports(newReports)
      setMessage(`Confirmed ${newReports.length} mapped files.`)
    } catch (e: any) {
      setError(e.message || 'Bulk confirm failed')
    } finally {
      setBulkRunning(false)
      setBulkProgress({ current: 0, total: 0, filename: '' })
    }
  }

  function skipFile() {
    const nextIdx = currentIdx + 1
    if (nextIdx < files.length) {
      setCurrentIdx(nextIdx)
      setActiveCompare(null)
      setExpandedPurchase(null)
    } else {
      setMessage(`Done — ${files.length} files processed.`)
    }
  }

  // --- Summary computations ---
  const summary = useMemo(() => {
    const totals = {
      files: files.length,
      mapped: files.filter((f) => f.mappedPurchaseId).length,
      rows: 0,
      ok: 0, drift: 0, near: 0, unlinked: 0,
      qty: 0, price: 0, missing: 0, db_only: 0, parse_err: 0,
    }
    const perFile: Array<{
      filename: string
      purchase_id: number | null
      purchase_label: string
      rows: number
      ok: number; drift: number; near: number; unlinked: number
      qty: number; price: number; missing: number; db_only: number; parse_err: number
    }> = []

    for (const f of files) {
      const r = reports.find((x) => x.filename === f.filename)
      const p = f.mappedPurchaseId ? purchases.find((x) => x.purchase_id === f.mappedPurchaseId) : null
      if (r) {
        totals.rows += r.rows.length
        totals.ok += r.counts.ok || 0
        totals.drift += r.counts.ok_with_drift || 0
        totals.near += r.counts.sku_drift_near || 0
        totals.unlinked += r.counts.sku_identical_unlinked || 0
        totals.qty += r.counts.qty_diff || 0
        totals.price += r.counts.price_diff || 0
        totals.missing += r.counts.missing_item || 0
        totals.db_only += r.counts.db_only || 0
        totals.parse_err += r.counts.parse_err || 0
        perFile.push({
          filename: f.filename,
          purchase_id: f.mappedPurchaseId,
          purchase_label: p ? `#${p.purchase_id} ${p.invoice_no || ''}` : '—',
          rows: r.rows.length,
          ok: r.counts.ok || 0,
          drift: r.counts.ok_with_drift || 0,
          near: r.counts.sku_drift_near || 0,
          unlinked: r.counts.sku_identical_unlinked || 0,
          qty: r.counts.qty_diff || 0,
          price: r.counts.price_diff || 0,
          missing: r.counts.missing_item || 0,
          db_only: r.counts.db_only || 0,
          parse_err: r.counts.parse_err || 0,
        })
      } else {
        perFile.push({
          filename: f.filename,
          purchase_id: f.mappedPurchaseId,
          purchase_label: p ? `#${p.purchase_id} ${p.invoice_no || ''}` : '—',
          rows: 0, ok: 0, drift: 0, near: 0, unlinked: 0, qty: 0, price: 0, missing: 0, db_only: 0, parse_err: 0,
        })
      }
    }

    // Group parse_err raw descriptions by prefix pattern
    const parseErrGroups = new Map<string, number>()
    for (const r of reports) {
      for (const row of r.rows) {
        if (row.status !== 'parse_err') continue
        const raw = (row.rawDescription || '(no description)').toUpperCase()
        const tokens = raw.split(/\s+/).slice(0, 4).join(' ')
        parseErrGroups.set(tokens, (parseErrGroups.get(tokens) || 0) + 1)
      }
    }
    const parseErrPatterns = Array.from(parseErrGroups.entries()).sort((a, b) => b[1] - a[1])

    // Group missing_item by generated_sku
    const missingGroups = new Map<string, number>()
    for (const r of reports) {
      for (const row of r.rows) {
        if (row.status !== 'missing_item') continue
        const sku = row.csvSku || '(no SKU)'
        missingGroups.set(sku, (missingGroups.get(sku) || 0) + 1)
      }
    }
    const missingPatterns = Array.from(missingGroups.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15)

    // Purchases with multiple CSVs
    const purchaseToFiles = new Map<number, string[]>()
    for (const f of files) {
      if (!f.mappedPurchaseId) continue
      if (!purchaseToFiles.has(f.mappedPurchaseId)) purchaseToFiles.set(f.mappedPurchaseId, [])
      purchaseToFiles.get(f.mappedPurchaseId)!.push(f.filename)
    }
    const multiCsvPurchases = Array.from(purchaseToFiles.entries())
      .filter(([, fs]) => fs.length > 1)
      .map(([pid, fs]) => {
        const p = purchases.find((x) => x.purchase_id === pid)
        return { purchase_id: pid, label: p ? `#${pid} ${p.invoice_no || ''} (${p.lines.length} items)` : `#${pid}`, files: fs }
      })

    return { totals, perFile, parseErrPatterns, missingPatterns, multiCsvPurchases }
  }, [files, reports, purchases])

  const activeFile = files[currentIdx] || null
  const csvRowCount = activeFile?.parsedRows.filter((r) => r.qty >= 0).length || 0

  const overlapMap = new Map<number, number>()
  if (purchasesLoaded && activeFile) {
    for (const p of purchases) overlapMap.set(p.purchase_id, computeOverlap(activeFile, p))
  }

  const filteredPurchases = purchasesLoaded && activeFile
    ? purchases
        .sort((a, b) => {
          if (activeFile.mappedPurchaseId) {
            const aM = a.purchase_id === activeFile.mappedPurchaseId ? 1 : 0
            const bM = b.purchase_id === activeFile.mappedPurchaseId ? 1 : 0
            if (aM !== bM) return bM - aM
          }
          const aOv = overlapMap.get(a.purchase_id) || 0
          const bOv = overlapMap.get(b.purchase_id) || 0
          if (aOv !== bOv) return bOv - aOv
          const aExp = expectedVendor && a.party_name === expectedVendor ? 1 : 0
          const bExp = expectedVendor && b.party_name === expectedVendor ? 1 : 0
          if (aExp !== bExp) return bExp - aExp
          const aDiff = Math.abs(a.lines.length - csvRowCount)
          const bDiff = Math.abs(b.lines.length - csvRowCount)
          if (aDiff !== bDiff) return aDiff - bDiff
          return b.purchase_date.localeCompare(a.purchase_date)
        })
        .filter((p) => {
          if (activeFile.mappedPurchaseId === p.purchase_id) return true
          const ov = overlapMap.get(p.purchase_id) || 0
          if (ov > 0) return true
          return Math.abs(p.lines.length - csvRowCount) <= rowFilter
        })
    : []

  if (!isOwner) return null

  return (
    <div className="p-4 max-w-[1600px] mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/admin" className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Purchase Audit</h1>
      </div>

      {/* Summary bar */}
      {(files.length > 0 || reports.length > 0) && (
        <div className="mb-3 border border-slate-300 rounded-lg overflow-hidden bg-white">
          <button
            onClick={() => setSummaryExpanded((v) => !v)}
            className="w-full px-3 py-2 bg-slate-100 hover:bg-slate-200 flex items-center gap-3 text-xs text-left"
          >
            {summaryExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
            <span className="font-semibold text-slate-800">Summary</span>
            <span className="text-slate-500">
              {summary.totals.files} files · {summary.totals.mapped} mapped
              {summary.totals.rows > 0 && (
                <>
                  {' · '}<span className="text-green-700">{summary.totals.ok} ok</span>
                  {' · '}<span className="text-emerald-700">{summary.totals.drift + summary.totals.near} drift</span>
                  {' · '}<span className="text-red-700">{summary.totals.missing} missing</span>
                  {' · '}<span className="text-blue-700">{summary.totals.db_only} db_only</span>
                  {summary.totals.parse_err > 0 && (
                    <> {' · '}<span className="text-purple-700">{summary.totals.parse_err} errors</span></>
                  )}
                </>
              )}
            </span>
          </button>

          {summaryExpanded && (
            <div className="p-3 text-xs space-y-3">
              {/* Per-file breakdown */}
              {summary.perFile.some((f) => f.rows > 0) && (
                <div>
                  <div className="font-semibold text-slate-700 mb-1">Per-file breakdown</div>
                  <div className="border border-slate-200 rounded overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-[10px]">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="px-1.5 py-1 text-left">File</th>
                          <th className="px-1.5 py-1 text-left">Purchase</th>
                          <th className="px-1.5 py-1 text-right">Rows</th>
                          <th className="px-1.5 py-1 text-right">Ok</th>
                          <th className="px-1.5 py-1 text-right">Drift</th>
                          <th className="px-1.5 py-1 text-right">Missing</th>
                          <th className="px-1.5 py-1 text-right">DB only</th>
                          <th className="px-1.5 py-1 text-right">Err</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.perFile.map((f) => (
                          <tr key={f.filename} className="border-t border-slate-100">
                            <td className="px-1.5 py-0.5 font-mono">{f.filename}</td>
                            <td className="px-1.5 py-0.5">{f.purchase_label}</td>
                            <td className="px-1.5 py-0.5 text-right tabular-nums">{f.rows || '—'}</td>
                            <td className="px-1.5 py-0.5 text-right tabular-nums text-green-700">{f.ok || '—'}</td>
                            <td className="px-1.5 py-0.5 text-right tabular-nums text-emerald-700">{(f.drift + f.near) || '—'}</td>
                            <td className="px-1.5 py-0.5 text-right tabular-nums text-red-700">{f.missing || '—'}</td>
                            <td className="px-1.5 py-0.5 text-right tabular-nums text-blue-700">{f.db_only || '—'}</td>
                            <td className="px-1.5 py-0.5 text-right tabular-nums text-purple-700">{f.parse_err || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Parse error patterns */}
              {summary.parseErrPatterns.length > 0 && (
                <div>
                  <div className="font-semibold text-slate-700 mb-1">
                    Parse errors — grouped by pattern ({summary.totals.parse_err} total)
                  </div>
                  <div className="border border-slate-200 rounded overflow-hidden max-h-48 overflow-y-auto">
                    <table className="w-full text-[10px]">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="px-1.5 py-1 text-left">Raw description prefix</th>
                          <th className="px-1.5 py-1 text-right">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.parseErrPatterns.map(([pattern, count]) => (
                          <tr key={pattern} className="border-t border-slate-100">
                            <td className="px-1.5 py-0.5 font-mono truncate max-w-[400px]" title={pattern}>{pattern}</td>
                            <td className="px-1.5 py-0.5 text-right tabular-nums">{count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-[10px] text-slate-500 italic mt-1">
                    Re-audit to populate raw descriptions if many patterns show "(no description)".
                  </div>
                </div>
              )}

              {/* Missing patterns */}
              {summary.missingPatterns.length > 0 && (
                <div>
                  <div className="font-semibold text-slate-700 mb-1">
                    Missing items — top SKUs ({summary.totals.missing} total)
                  </div>
                  <div className="border border-slate-200 rounded overflow-hidden max-h-48 overflow-y-auto">
                    <table className="w-full text-[10px]">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="px-1.5 py-1 text-left">SKU</th>
                          <th className="px-1.5 py-1 text-right">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.missingPatterns.map(([sku, count]) => (
                          <tr key={sku} className="border-t border-slate-100">
                            <td className="px-1.5 py-0.5 font-mono truncate max-w-[400px]" title={sku}>{sku}</td>
                            <td className="px-1.5 py-0.5 text-right tabular-nums">{count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Multi-CSV purchases */}
              {summary.multiCsvPurchases.length > 0 && (
                <div>
                  <div className="font-semibold text-slate-700 mb-1">Merged purchases (multiple CSVs mapped)</div>
                  <div className="space-y-1">
                    {summary.multiCsvPurchases.map((m) => (
                      <div key={m.purchase_id} className="text-[10px] text-slate-700">
                        <span className="font-mono">{m.label}</span> ← {m.files.join(', ')}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="mb-3 grid grid-cols-2 md:grid-cols-6 gap-2">
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Expected vendor</label>
          <select value={expectedVendor} onChange={(e) => setExpectedVendor(e.target.value)}
            className="w-full h-9 px-2 text-xs border border-slate-300 rounded">
            <option value="">— none —</option>
            {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <button onClick={pickFolder} disabled={running || bulkRunning}
          className="h-9 mt-4 px-3 text-xs font-semibold bg-slate-800 text-white rounded hover:bg-slate-900 disabled:opacity-50 flex items-center gap-1 justify-center">
          <FolderOpen className="w-3.5 h-3.5" /> Pick Folder
        </button>
        <button onClick={loadAllPurchases} disabled={loadingPurchases || !aliasReady || bulkRunning}
          className="h-9 mt-4 px-3 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1 justify-center">
          {loadingPurchases ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {purchasesLoaded ? 'Reload' : 'Load Purchases'}
        </button>
        <button onClick={confirmAllMapped} disabled={bulkRunning || !purchasesLoaded || files.filter((f) => f.mappedPurchaseId).length === 0}
          className="h-9 mt-4 px-3 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 justify-center">
          {bulkRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          Confirm All Mapped
        </button>
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Row filter ±</label>
          <select value={rowFilter} onChange={(e) => setRowFilter(Number(e.target.value))}
            className="w-full h-9 px-2 text-xs border border-slate-300 rounded">
            <option value="3">±3</option>
            <option value="5">±5</option>
            <option value="10">±10</option>
            <option value="25">±25</option>
            <option value="99999">All</option>
          </select>
        </div>
        <button onClick={() => {
          const lines = ['file\tpurchase\tvendor\trows\tok\tdrift\tnear\tunlinked\tqty\tprice\tmiss\tdb_only\terr']
          for (const f of summary.perFile) {
            lines.push([
              f.filename, f.purchase_label, '', f.rows, f.ok, f.drift, f.near, f.unlinked,
              f.qty, f.price, f.missing, f.db_only, f.parse_err,
            ].join('\t'))
          }
          navigator.clipboard.writeText(lines.join('\n'))
          setMessage('Summary copied')
        }} disabled={summary.perFile.length === 0}
          className="h-9 mt-4 px-3 text-xs font-medium bg-slate-100 text-slate-700 rounded hover:bg-slate-200 disabled:opacity-50 flex items-center gap-1 justify-center">
          <Copy className="w-3.5 h-3.5" /> Copy Summary
        </button>
      </div>

      {bulkRunning && bulkProgress.total > 0 && (
        <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Confirming {bulkProgress.current}/{bulkProgress.total}: {bulkProgress.filename}
        </div>
      )}

      {message && <div className="mb-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />{message}</div>}
      {error && <div className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{error}</div>}

      {/* File strip */}
      {files.length > 0 && (
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          {files.map((f, i) => {
            const isCurrent = i === currentIdx
            const isMapped = !!f.mappedPurchaseId
            const hasReport = !!reports.find((r) => r.filename === f.filename)
            return (
              <button
                key={f.filename}
                onClick={() => { setCurrentIdx(i); setActiveCompare(null); setExpandedPurchase(null) }}
                className={`shrink-0 h-7 px-2 text-[10px] rounded border ${
                  isCurrent ? 'bg-slate-800 text-white border-slate-800' :
                  hasReport ? 'bg-green-100 text-green-800 border-green-300' :
                  isMapped ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {f.filename} {hasReport ? '✓' : isMapped ? '·' : ''}
              </button>
            )
          })}
        </div>
      )}

      {!activeFile && (
        <div className="text-sm text-slate-500 text-center py-8">
          Pick a folder of CSVs to begin.
        </div>
      )}

      {activeFile && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* LEFT — CSV preview */}
          <div className="border border-slate-300 rounded-lg bg-white">
            <div className="bg-slate-100 px-3 py-2 border-b border-slate-300 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
                {activeFile.filename} — {activeFile.parsedRows.length} rows
                <span className="text-[10px] text-slate-500">file {currentIdx + 1}/{files.length}</span>
                {activeFile.mappedPurchaseId ? (
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                    ✓ mapped to #{activeFile.mappedPurchaseId}
                    <button
                      onClick={() => unmapFile(activeFile.filename)}
                      className="text-emerald-700 hover:text-red-700 underline ml-1"
                      title="Remove this mapping"
                    >
                      × unmap
                    </button>
                  </span>
                ) : (
                  <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                    not yet mapped
                  </span>
                )}
              </div>
              <button onClick={skipFile} className="text-[10px] text-red-700 underline flex items-center gap-1 shrink-0">
                <SkipForward className="w-3 h-3" /> Skip
              </button>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-1.5 py-1 text-left">#</th>
                    <th className="px-1.5 py-1 text-left">brand</th>
                    <th className="px-1.5 py-1 text-left">model</th>
                    <th className="px-1.5 py-1 text-left">part</th>
                    <th className="px-1.5 py-1 text-right">qty</th>
                    <th className="px-1.5 py-1 text-right">rate</th>
                    <th className="px-1.5 py-1 text-left">SKU</th>
                    <th className="px-1.5 py-1 text-center">st</th>
                  </tr>
                </thead>
                <tbody>
                  {activeFile.parsedRows.map((r, i) => (
                    <tr key={i} className={`border-t border-slate-100 ${r.status === 'needs_correction' ? 'bg-red-50/60' : r.qty < 0 ? 'bg-blue-50/40' : ''}`}>
                      <td className="px-1.5 py-0.5 text-slate-500">{r.rowNumber}</td>
                      <td className="px-1.5 py-0.5 font-mono">{r.brandCode || <span className="text-red-500">—</span>}</td>
                      <td className="px-1.5 py-0.5">{r.modelName || <span className="text-red-500">—</span>}</td>
                      <td className="px-1.5 py-0.5 font-mono">{r.partCode || <span className="text-red-500">—</span>}</td>
                      <td className="px-1.5 py-0.5 text-right tabular-nums">{r.qty}</td>
                      <td className="px-1.5 py-0.5 text-right tabular-nums">{r.rate}</td>
                      <td className="px-1.5 py-0.5 font-mono text-slate-700 truncate max-w-[200px]" title={r.generatedSku || ''}>{r.generatedSku || <span className="text-red-500">—</span>}</td>
                      <td className="px-1.5 py-0.5 text-center">
                        {r.status === 'needs_correction' ? <span className="text-red-600 font-bold">✗</span> : r.qty < 0 ? <span className="text-blue-600">↩</span> : <span className="text-green-600">✓</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT — purchases */}
          <div className="border border-slate-300 rounded-lg bg-white">
            <div className="bg-slate-100 px-3 py-2 border-b border-slate-300">
              <div className="text-sm font-semibold text-slate-800">
                Purchases ({filteredPurchases.length} shown of {purchases.length})
              </div>
              {!purchasesLoaded && <div className="text-[10px] text-slate-500">Click Load Purchases above.</div>}
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {filteredPurchases.length === 0 && purchasesLoaded && (
                <div className="text-xs text-slate-500 px-3 py-4">No purchases within ±{rowFilter} rows. Widen the filter.</div>
              )}
              {filteredPurchases.map((p) => {
                const isExpanded = expandedPurchase === p.purchase_id
                const isExpected = expectedVendor && p.party_name === expectedVendor
                const isMapped = activeFile.mappedPurchaseId === p.purchase_id
                return (
                  <div key={p.purchase_id} className={`border-b border-slate-200 ${isMapped ? 'bg-emerald-100/40' : isExpected ? 'bg-emerald-50/30' : ''}`}>
                    <div
                      className="px-2 py-1.5 cursor-pointer hover:bg-slate-50 flex items-center gap-2 text-xs"
                      onClick={() => setExpandedPurchase(isExpanded ? null : p.purchase_id)}
                    >
                      {isExpanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                      <span className="font-mono text-slate-600">#{p.purchase_id}</span>
                      <span className="font-medium text-slate-800 truncate max-w-[120px]">{p.invoice_no || '—'}</span>
                      <span className={`truncate max-w-[120px] ${isExpected ? 'text-emerald-700 font-medium' : 'text-slate-600'}`}>{p.party_name}</span>
                      <span className="text-slate-500">{p.purchase_date}</span>
                      <span className="ml-auto font-mono tabular-nums text-[10px]">
                        <span className={
                          (overlapMap.get(p.purchase_id) || 0) === 0 ? 'text-red-600' :
                          (overlapMap.get(p.purchase_id) || 0) >= csvRowCount * 0.7 ? 'text-emerald-700 font-bold' :
                          'text-amber-700'
                        }>
                          {overlapMap.get(p.purchase_id) || 0}/{csvRowCount}
                        </span>
                        <span className="text-slate-500 ml-1">· {p.lines.length} items</span>
                        {isMapped && <span className="ml-1 text-emerald-700">✓</span>}
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="px-2 pb-2 bg-slate-50 border-t border-slate-200">
                        <div className="flex justify-end mb-1">
                          <button onClick={() => openCompare(p)}
                            className="h-7 px-2 text-[10px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700">
                            Compare with CSV
                          </button>
                        </div>
                        <div className="max-h-56 overflow-y-auto border border-slate-300 rounded bg-white">
                          <table className="w-full text-[10px]">
                            <thead className="bg-slate-100 sticky top-0">
                              <tr>
                                <th className="px-1 py-0.5 text-left">#</th>
                                <th className="px-1 py-0.5 text-left">brand</th>
                                <th className="px-1 py-0.5 text-left">model</th>
                                <th className="px-1 py-0.5 text-left">part</th>
                                <th className="px-1 py-0.5 text-right">qty</th>
                                <th className="px-1 py-0.5 text-right">rate</th>
                                <th className="px-1 py-0.5 text-left">SKU</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.lines.map((l, i) => (
                                <tr key={l.detail_id} className={`border-t border-slate-100 ${l.qty < 0 ? 'bg-blue-50/40' : ''}`}>
                                  <td className="px-1 py-0.5 text-slate-500">{i + 1}</td>
                                  <td className="px-1 py-0.5 font-mono">{l.brand || <span className="text-red-500">—</span>}</td>
                                  <td className="px-1 py-0.5">{l.model || <span className="text-red-500">—</span>}</td>
                                  <td className="px-1 py-0.5 font-mono">{l.part || <span className="text-red-500">—</span>}</td>
                                  <td className="px-1 py-0.5 text-right tabular-nums">{l.qty}</td>
                                  <td className="px-1 py-0.5 text-right tabular-nums">{l.rate}</td>
                                  <td className="px-1 py-0.5 font-mono truncate max-w-[160px]" title={l.sku}>{l.sku}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Diff modal */}
      {activeCompare && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3" onClick={() => setActiveCompare(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="text-sm font-semibold">
                {activeCompare.report.filename} ↔ #{activeCompare.purchase.purchase_id} · {activeCompare.purchase.invoice_no} · {activeCompare.purchase.party_name} · {activeCompare.purchase.purchase_date}
              </div>
              <button onClick={() => setActiveCompare(null)} className="text-slate-500 hover:text-slate-800 text-lg">×</button>
            </div>

            {(() => {
              const matched = (activeCompare.report.counts.ok || 0)
                + (activeCompare.report.counts.ok_with_drift || 0)
                + (activeCompare.report.counts.sku_drift_near || 0)
                + (activeCompare.report.counts.qty_diff || 0)
                + (activeCompare.report.counts.price_diff || 0)
              const totalCsv = activeCompare.report.rows.filter((r) => r.csvSku).length
              if (matched === 0 && totalCsv > 0) {
                return (
                  <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-red-800 text-xs">
                    ⚠ <strong>No item-level overlap.</strong> 0 of {totalCsv} CSV rows matched. This invoice was likely never imported into this purchase.
                  </div>
                )
              }
              if (totalCsv > 0 && matched < totalCsv * 0.4) {
                return (
                  <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
                    ⚠ <strong>Low overlap.</strong> Only {matched} of {totalCsv} CSV rows matched. Verify before confirming.
                  </div>
                )
              }
              return null
            })()}

            <div className="px-3 py-2 flex gap-3 flex-wrap text-[11px] border-b border-slate-200">
              <span className="text-green-700">✓ ok {activeCompare.report.counts.ok || 0}</span>
              <span className="text-emerald-700">✓ drift {activeCompare.report.counts.ok_with_drift || 0}</span>
              <span className="text-orange-700">~ near-drift {activeCompare.report.counts.sku_drift_near || 0}</span>
              <span className="text-pink-700">? unlinked {activeCompare.report.counts.sku_identical_unlinked || 0}</span>
              <span className="text-amber-700">⚠ qty {activeCompare.report.counts.qty_diff || 0}</span>
              <span className="text-orange-700">⚠ ₹ {activeCompare.report.counts.price_diff || 0}</span>
              <span className="text-red-700">✗ miss {activeCompare.report.counts.missing_item || 0}</span>
              <span className="text-blue-700">◐ db_only {activeCompare.report.counts.db_only || 0}</span>
              <span className="text-purple-700">⊘ err {activeCompare.report.counts.parse_err || 0}</span>
              {activeCompare.report.skipped_negative > 0 && (
                <span className="text-blue-600">↩ skipped {activeCompare.report.skipped_negative} (neg qty)</span>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-100 sticky top-0">
                  <tr>
                    <th className="px-1.5 py-1 text-left">CSV #</th>
                    <th className="px-1.5 py-1 text-left">Raw desc</th>
                    <th className="px-1.5 py-1 text-left">CSV SKU</th>
                    <th className="px-1.5 py-1 text-left">DB SKU</th>
                    <th className="px-1.5 py-1 text-right">Qty C/D</th>
                    <th className="px-1.5 py-1 text-right">₹ C/D</th>
                    <th className="px-1.5 py-1 text-center">st</th>
                    <th className="px-1.5 py-1 text-left">reason</th>
                  </tr>
                </thead>
                <tbody>
                  {activeCompare.report.rows.map((r, i) => (
                    <tr key={i} className={`border-t border-slate-100 ${
                      r.status === 'ok' ? 'bg-green-50/40' :
                      r.status === 'ok_with_drift' ? 'bg-emerald-50/40' :
                      r.status === 'sku_drift_near' ? 'bg-orange-50/40' :
                      r.status === 'sku_identical_unlinked' ? 'bg-pink-50/40' :
                      r.status === 'qty_diff' ? 'bg-amber-50/40' :
                      r.status === 'price_diff' ? 'bg-orange-50/40' :
                      r.status === 'missing_item' ? 'bg-red-50/40' :
                      r.status === 'db_only' ? (r.returned ? 'bg-blue-50/40' : 'bg-indigo-50/40') :
                      'bg-purple-50/40'
                    }`}>
                      <td className="px-1.5 py-0.5 text-slate-500">{r.csvRowNumber ?? '—'}</td>
                      <td className="px-1.5 py-0.5 text-slate-700 truncate max-w-[160px]" title={r.rawDescription || ''}>{r.rawDescription || '—'}</td>
                      <td className="px-1.5 py-0.5 font-mono truncate max-w-[140px]" title={r.csvSku || ''}>{r.csvSku || '—'}</td>
                      <td className="px-1.5 py-0.5 font-mono truncate max-w-[140px] text-slate-600" title={r.dbSku || ''}>{r.dbSku || '—'}</td>
                      <td className="px-1.5 py-0.5 text-right tabular-nums">{r.csvQty ?? '—'}/{r.dbQty ?? '—'}</td>
                      <td className="px-1.5 py-0.5 text-right tabular-nums">{r.csvRate ?? '—'}/{r.dbRate ?? '—'}</td>
                      <td className="px-1.5 py-0.5 text-center text-[10px] font-semibold">
                        {r.status === 'ok' ? '✓' :
                         r.status === 'ok_with_drift' ? '✓drift' :
                         r.status === 'sku_drift_near' ? '~near' :
                         r.status === 'sku_identical_unlinked' ? '?unl' :
                         r.status === 'qty_diff' ? '⚠qty' :
                         r.status === 'price_diff' ? '⚠₹' :
                         r.status === 'missing_item' ? '✗' :
                         r.status === 'db_only' ? (r.returned ? '◐ret' : '◐db') :
                         '⊘'}
                      </td>
                      <td className="px-1.5 py-0.5 text-slate-600 text-[10px] truncate max-w-[200px]" title={r.mismatch_reason || ''}>{r.mismatch_reason || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button onClick={() => setActiveCompare(null)}
                className="h-8 px-3 text-xs text-slate-700 border border-slate-300 rounded hover:bg-white">
                Back
              </button>
              <button onClick={writeAudit} disabled={running}
                className="h-8 px-3 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1">
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Confirm, save mapping, and write
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}