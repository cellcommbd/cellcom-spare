'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import {
  loadSession,
  discardSession,
  promoteSession,
  classifySession,
  reclassifyRow,
  skipRow,
  useOldPrice,
  acceptNewPrice,
  keepOldSku,
  renameOldItem,
  treatReturnAsPurchase,
  updateStagingRow,
  StagingRow,
  StagingAction,
  StagingPatch,
} from '@/lib/import-staging'
import {
  ArrowLeft,
  AlertCircle,
  RefreshCw,
  Trash2,
  Save,
  FileText,
  Pencil,
  X,
  Copy,
  Check,
} from 'lucide-react'
import { buildSummaryFromStaging, copyTextToClipboard } from '@/lib/copy-summary'

type Filter = 'all' | 'ready' | 'review' | 'unresolved'

const ACTION_LABEL: Record<StagingAction, string> = {
  match: '✓ Matched',
  new: '✓ New',
  match_reformat: '⟳ Reformatted',
  new_partial: '⚠ Partial',
  ambiguous: '⚠ Duplicate',
  unresolved: '✗ Unresolved',
  price_mismatch: '⟳ Price diff',
  return: '↩ Return',
}

const ACTION_COLOR: Record<StagingAction, string> = {
  match: 'bg-green-50 text-green-800',
  new: 'bg-green-50 text-green-800',
  match_reformat: 'bg-amber-50 text-amber-800',
  new_partial: 'bg-amber-50 text-amber-800',
  ambiguous: 'bg-orange-50 text-orange-800',
  unresolved: 'bg-red-50 text-red-800',
  price_mismatch: 'bg-amber-50 text-amber-800',
  return: 'bg-blue-50 text-blue-800',
}

const READY_STATES: StagingAction[] = ['match', 'new', 'new_partial']
const REVIEW_STATES: StagingAction[] = [
  'match_reformat',
  'new_partial',
  'price_mismatch',
]
const UNRESOLVED_STATES: StagingAction[] = ['ambiguous', 'unresolved', 'return']

export default function SessionDetailPage() {
  const params = useParams()
  const search = useSearchParams()
  const router = useRouter()

  const sessionId = params.sessionId as string
  const partyId = search.get('party')
  const invoiceNo = search.get('invoice') || ''
  const purchaseDate = search.get('date') || ''
  const freightFromUrl = search.get('freight') || '0'
  const cash = search.get('cash') || '0'

  const [rows, setRows] = useState<StagingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [classifying, setClassifying] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [freightInput, setFreightInput] = useState(freightFromUrl)
  const [freightMode, setFreightMode] = useState<'amount' | 'percent'>('amount')
  const [editingRow, setEditingRow] = useState<StagingRow | null>(null)
  const [busyRowId, setBusyRowId] = useState<number | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function handleCopySummary() {
    const text = buildSummaryFromStaging(rows)
    const ok = await copyTextToClipboard(text)
    setCopyState(ok ? 'copied' : 'failed')
    setTimeout(() => setCopyState('idle'), 1500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await loadSession(sessionId)
      setRows(r)
    } catch (e: any) {
      setError(e.message || 'Failed to load session')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    load()
  }, [load])

  async function handleReclassify() {
    setClassifying(true)
    setError('')
    try {
      await classifySession(sessionId)
      await load()
    } catch (e: any) {
      setError(e.message || 'Failed to classify')
    } finally {
      setClassifying(false)
    }
  }

  async function handleDiscard() {
    if (!confirm('Discard this entire session? No items will be created.')) return
    try {
      await discardSession(sessionId)
      router.push('/imports/staging')
    } catch (e: any) {
      setError(e.message || 'Failed to discard')
    }
  }

  async function runRowAction(
    stagingId: number,
    action: () => Promise<void>
  ) {
    setBusyRowId(stagingId)
    setError('')
    try {
      await action()
      await load()
    } catch (e: any) {
      setError(e.message || 'Action failed')
    } finally {
      setBusyRowId(null)
    }
  }

  async function handleSkip(stagingId: number) {
    if (!confirm('Remove this row from staging? It will not be promoted.')) return
    await runRowAction(stagingId, () => skipRow(stagingId))
  }

  async function handleUseOldPrice(stagingId: number) {
    await runRowAction(stagingId, () => useOldPrice(stagingId))
  }

  async function handleUseNewPrice(stagingId: number) {
    await runRowAction(stagingId, () => acceptNewPrice(stagingId))
  }

  async function handleKeepOldSku(stagingId: number) {
    await runRowAction(stagingId, () => keepOldSku(stagingId))
  }

  async function handleRenameOld(stagingId: number, oldSku: string, newSku: string) {
    const ok = confirm(
      `RENAME item's SKU in the database?\n\n` +
        `Old SKU: ${oldSku}\n` +
        `New SKU: ${newSku}\n\n` +
        `All past purchases, sales, and returns that reference this item will now show the new SKU. This cannot be undone.`
    )
    if (!ok) return
    await runRowAction(stagingId, () => renameOldItem(stagingId))
  }

  async function handleTreatAsPurchase(stagingId: number) {
    await runRowAction(stagingId, () => treatReturnAsPurchase(stagingId))
  }

  const promotableRows = rows.filter(
    (r) => r.resolved_action === 'match' || r.resolved_action === 'new' || r.resolved_action === 'new_partial'
  )
  const invoiceTotal = rows.reduce(
    (s, r) => s + (r.qty || 0) * (r.rate || 0),
    0
  )
  const computedFreight =
    freightMode === 'percent'
      ? (invoiceTotal * (parseFloat(freightInput) || 0)) / 100
      : parseFloat(freightInput) || 0

  async function handlePromote() {
    if (!partyId) {
      setError('No supplier chosen. Return to purchases and import again.')
      return
    }
    setPromoting(true)
    setError('')
    try {
      await promoteSession(
        sessionId,
        Number(partyId),
        invoiceNo,
        purchaseDate,
        computedFreight,
        Number(cash) || 0
      )
      router.push(`/purchases`)
    } catch (e: any) {
      setError(e.message || 'Promote failed')
    } finally {
      setPromoting(false)
    }
  }

  const counts = {
    ready: rows.filter((r) => r.resolved_action && READY_STATES.includes(r.resolved_action)).length,
    review: rows.filter((r) => r.resolved_action && REVIEW_STATES.includes(r.resolved_action)).length,
    unresolved: rows.filter((r) => r.resolved_action && UNRESOLVED_STATES.includes(r.resolved_action)).length,
  }

  const filteredRows = rows.filter((r) => {
    if (filter === 'all') return true
    if (!r.resolved_action) return false
    if (filter === 'ready') return READY_STATES.includes(r.resolved_action)
    if (filter === 'review') return REVIEW_STATES.includes(r.resolved_action)
    if (filter === 'unresolved') return UNRESOLVED_STATES.includes(r.resolved_action)
    return true
  })

  const canPromote =
    counts.ready > 0 && counts.unresolved === 0 && counts.review === 0 && !promoting

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => router.push('/purchases')}
          className="text-slate-700 hover:text-slate-900 flex items-center gap-1 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Purchases
        </button>
        <span className="text-slate-300">|</span>
        <button
          onClick={() => router.push('/imports/staging')}
          className="text-slate-500 hover:text-slate-800 text-sm"
        >
          All Sessions
        </button>
      </div>

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Session {sessionId.slice(0, 8)}
          </h1>
          <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
            <span>{rows.length} rows</span>
            {invoiceNo && <span>Invoice: {invoiceNo}</span>}
            {purchaseDate && <span>Date: {purchaseDate}</span>}
            {partyId && <span>Supplier: #{partyId}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopySummary}
            disabled={loading || rows.length === 0}
            className="h-8 px-3 text-xs font-medium text-slate-700 border border-slate-300 rounded hover:bg-slate-100 flex items-center gap-1 disabled:opacity-50"
            title="Copy compact tab-separated summary — paste into AI chat"
          >
            {copyState === 'copied' ? (
              <Check className="w-3.5 h-3.5 text-green-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy Summary'}
          </button>
          <button
            onClick={handleReclassify}
            disabled={classifying || loading}
            className="h-8 px-3 text-xs font-medium text-slate-700 border border-slate-300 rounded hover:bg-slate-100 flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${classifying ? 'animate-spin' : ''}`} />
            {classifying ? 'Classifying…' : 'Reclassify'}
          </button>          <button
            onClick={handleDiscard}
            className="h-8 px-3 text-xs font-medium text-red-700 border border-red-300 rounded hover:bg-red-50 flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Discard
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <label className="text-xs font-medium text-slate-700">Freight:</label>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFreightMode('amount')}
                className={`h-7 px-2 text-xs rounded ${freightMode === 'amount' ? 'bg-slate-700 text-white' : 'bg-white border border-slate-300 text-slate-700'}`}
              >
                ₹
              </button>
              <button
                onClick={() => setFreightMode('percent')}
                className={`h-7 px-2 text-xs rounded ${freightMode === 'percent' ? 'bg-slate-700 text-white' : 'bg-white border border-slate-300 text-slate-700'}`}
              >
                %
              </button>
            </div>
            <input
              type="number"
              step="0.01"
              value={freightInput}
              onChange={(e) => setFreightInput(e.target.value)}
              className="w-24 h-7 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0"
            />
            <span className="text-xs text-slate-500">
              Invoice total: ₹{invoiceTotal.toFixed(2)} · Freight: ₹{computedFreight.toFixed(2)}
              {freightMode === 'percent' && invoiceTotal > 0 && freightInput && (
                <> ({((computedFreight / invoiceTotal) * 100).toFixed(2)}% of total)</>
              )}
            </span>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-slate-600 hover:text-slate-800">
              Show landed costs per item ({promotableRows.length} items will be promoted)
            </summary>
            <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200 rounded bg-white">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-100 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left">SKU</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1 text-right">Rate</th>
                    <th className="px-2 py-1 text-right">Freight/unit</th>
                    <th className="px-2 py-1 text-right">Landed</th>
                  </tr>
                </thead>
                <tbody>
                  {promotableRows.map((r) => {
                    const lineAmount = (r.qty || 0) * (r.rate || 0)
                    const freightShare = invoiceTotal > 0 ? (lineAmount / invoiceTotal) * computedFreight : 0
                    const freightPerUnit = (r.qty || 1) > 0 ? freightShare / (r.qty || 1) : 0
                    const landed = (r.rate || 0) + freightPerUnit
                    return (
                      <tr key={r.staging_id} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-mono text-slate-700 truncate max-w-xs">
                          {r.generated_sku || '—'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.qty}</td>
                        <td className="px-2 py-1 text-right tabular-nums">₹{(r.rate || 0).toFixed(2)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">₹{freightPerUnit.toFixed(2)}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-medium">₹{landed.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <FilterTab
          label={`All (${rows.length})`}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterTab
          label={`Ready (${counts.ready})`}
          active={filter === 'ready'}
          color="green"
          onClick={() => setFilter('ready')}
        />
        <FilterTab
          label={`Review (${counts.review})`}
          active={filter === 'review'}
          color="amber"
          onClick={() => setFilter('review')}
        />
        <FilterTab
          label={`Unresolved (${counts.unresolved})`}
          active={filter === 'unresolved'}
          color="red"
          onClick={() => setFilter('unresolved')}
        />
      </div>

      {loading && (
        <div className="text-center py-8 text-sm text-slate-500">Loading rows…</div>
      )}

      {!loading && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Raw</th>
                <th className="px-2 py-2 text-left">SKU</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Rate</th>
                <th className="px-2 py-2 text-center">Status</th>
                <th className="px-2 py-2 text-left">Note</th>
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const busy = busyRowId === r.staging_id
                return (
                  <tr
                    key={r.staging_id}
                    className={`border-t border-slate-100 ${
                      r.resolved_action ? ACTION_COLOR[r.resolved_action] : 'bg-slate-50'
                    }`}
                  >
                    <td className="px-2 py-1.5 text-slate-500 align-top tabular-nums">
                      {r.row_num ?? '—'}
                    </td>
                                      <td className="px-2 py-1.5 text-slate-700 align-top max-w-xs">
                    <div className="truncate" title={r.raw_description || ''}>
                      {r.raw_description || '—'}
                    </div>
                    {r.processed_text && r.processed_text !== (r.raw_description || '').toUpperCase() && (
                      <div className="text-[10px] text-blue-600 font-mono mt-0.5 truncate" title={r.processed_text}>
                        → {r.processed_text}
                      </div>
                    )}
                  </td>
                    <td className="px-2 py-1.5 font-mono text-slate-800 align-top">
                      {r.generated_sku || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums align-top">
                      {r.qty ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums align-top">
                      {r.rate != null ? `₹${r.rate}` : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-center align-top whitespace-nowrap">
                      <span className="text-[10px] font-semibold">
                        {r.resolved_action ? ACTION_LABEL[r.resolved_action] : '…'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-[10px] text-slate-600 align-top max-w-xs truncate" title={r.conflict_reason || ''}>
                      {r.conflict_reason || ''}
                    </td>
                    <td className="px-2 py-1.5 align-top text-right">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        {r.resolved_action === 'price_mismatch' && (
                          <>
                            <ActionBtn
                              onClick={() => handleUseOldPrice(r.staging_id)}
                              disabled={busy}
                              label="Use old price"
                            />
                            <ActionBtn
                              onClick={() => handleUseNewPrice(r.staging_id)}
                              disabled={busy}
                              label="Use new price"
                            />
                          </>
                        )}
                        {r.resolved_action === 'match_reformat' && (
                          <>
                            <ActionBtn
                              onClick={() => handleKeepOldSku(r.staging_id)}
                              disabled={busy}
                              label="Keep old SKU"
                            />
                            <ActionBtn
                              onClick={() => handleRenameOld(r.staging_id, '(old)', r.generated_sku || '')}
                              disabled={busy}
                              label="Rename old"
                              danger
                            />
                          </>
                        )}
                        {r.resolved_action === 'return' && (
                          <ActionBtn
                            onClick={() => handleTreatAsPurchase(r.staging_id)}
                            disabled={busy}
                            label="As purchase"
                          />
                        )}
                        {(r.resolved_action === 'unresolved' ||
                          r.resolved_action === 'ambiguous' ||
                          r.resolved_action === 'match_reformat' ||
                          r.resolved_action === 'price_mismatch' ||
                          r.resolved_action === 'return') && (
                          <button
                            onClick={() => setEditingRow(r)}
                            disabled={busy}
                            className="h-6 px-2 text-[10px] font-medium border border-slate-300 rounded hover:bg-white disabled:opacity-50"
                          >
                            Edit
                          </button>
                        )}
                        {r.resolved_action !== 'match' &&
                          r.resolved_action !== 'new' &&
                          r.resolved_action !== 'new_partial' && (
                            <button
                              onClick={() => handleSkip(r.staging_id)}
                              disabled={busy}
                              className="h-6 px-2 text-[10px] font-medium text-red-700 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50"
                            >
                              Skip
                            </button>
                          )}
                        {busy && <span className="text-[10px] text-slate-500">…</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs flex items-center gap-3 flex-wrap">
          {rows.length === 0 ? (
            <span className="text-slate-500">No rows in session.</span>
          ) : (
            <>
              <span className="text-green-700 font-medium">
                ✓ {rows.filter((r) => r.resolved_action === 'match').length} matched
              </span>
              <span className="text-emerald-700 font-medium">
                + {rows.filter((r) => r.resolved_action === 'new' || r.resolved_action === 'new_partial').length} new
              </span>
              {rows.filter((r) => r.resolved_action === 'match_reformat' || r.resolved_action === 'price_mismatch').length > 0 && (
                <span className="text-amber-700 font-medium">
                  ⟳ {rows.filter((r) => r.resolved_action === 'match_reformat' || r.resolved_action === 'price_mismatch').length} review
                </span>
              )}
              {rows.filter((r) => r.resolved_action === 'unresolved' || r.resolved_action === 'ambiguous').length > 0 && (
                <span className="text-red-700 font-medium">
                  ✗ {rows.filter((r) => r.resolved_action === 'unresolved' || r.resolved_action === 'ambiguous').length} errors
                </span>
              )}
              {rows.filter((r) => r.resolved_action === 'return').length > 0 && (
                <span className="text-blue-700 font-medium">
                  ↩ {rows.filter((r) => r.resolved_action === 'return').length} returns
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/purchases')}
            className="h-9 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-white"
          >
            Back to Purchases
          </button>
          <button
            onClick={handlePromote}
            disabled={!canPromote}
            className="h-9 px-5 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {promoting ? 'Promoting…' : `Promote (${counts.ready})`}
          </button>
        </div>
      </div>

      <div className="mt-4 text-[11px] text-slate-500 italic">
        Promote is enabled only when no rows are in review, error, or return state. Resolve all flagged rows first — either by choosing an action, editing, or skipping.
      </div>

      {editingRow && (
        <EditRowModal
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onSave={async (patch) => {
            await updateStagingRow(editingRow.staging_id, patch)
            setEditingRow(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function ActionBtn({
  onClick,
  disabled,
  label,
  danger,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-6 px-2 text-[10px] font-medium border rounded disabled:opacity-50 ${
        danger
          ? 'text-red-700 border-red-300 hover:bg-red-50'
          : 'text-slate-700 border-slate-300 hover:bg-white'
      }`}
    >
      {label}
    </button>
  )
}

function FilterTab({
  label,
  active,
  onClick,
  color,
}: {
  label: string
  active: boolean
  onClick: () => void
  color?: 'green' | 'amber' | 'red'
}) {
  const base = 'h-8 px-3 text-xs font-medium rounded-lg'
  const activeBg =
    color === 'green'
      ? 'bg-green-600 text-white'
      : color === 'amber'
      ? 'bg-amber-600 text-white'
      : color === 'red'
      ? 'bg-red-600 text-white'
      : 'bg-slate-700 text-white'
  return (
    <button
      onClick={onClick}
      className={`${base} ${active ? activeBg : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
    >
      {label}
    </button>
  )
}

function EditRowModal({
  row,
  onClose,
  onSave,
}: {
  row: StagingRow
  onClose: () => void
  onSave: (patch: StagingPatch) => Promise<void>
}) {
  const [brand, setBrand] = useState(row.brand_code || '')
  const [model, setModel] = useState(row.model_name || '')
  const [part, setPart] = useState(row.part_code || '')
  const [quality, setQuality] = useState(row.quality || 'Normal')
  const [color, setColor] = useState(row.color || '')
  const [variant, setVariant] = useState(row.variant || '')
  const [flag, setFlag] = useState(row.flag || '')
  const [network, setNetwork] = useState(row.network || '')
  const [year, setYear] = useState(row.year || '')
  const [qty, setQty] = useState(String(row.qty ?? 0))
  const [rate, setRate] = useState(String(row.rate ?? 0))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    setSaving(true)
    setErr('')
    try {
      await onSave({
        brand_code: brand.trim().toUpperCase() || null,
        model_name: model.trim() || null,
        part_code: part.trim().toUpperCase() || null,
        quality: quality || 'Normal',
        color: color.trim().toUpperCase() || null,
        variant: variant.trim().toUpperCase() || null,
        flag: flag.trim().toUpperCase() || null,
        network: network.trim().toUpperCase() || null,
        year: year.trim() || null,
        qty: parseFloat(qty) || 0,
        rate: parseFloat(rate) || 0,
      })
    } catch (e: any) {
      setErr(e.message || 'Save failed')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white">
          <div className="text-sm font-semibold text-slate-800">
            Edit row #{row.row_num ?? row.staging_id}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="text-xs text-slate-500 italic">
            Original: {row.raw_description || '—'}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Brand" value={brand} onChange={setBrand} mono />
            <Field label="Model" value={model} onChange={setModel} />
            <Field label="Part" value={part} onChange={setPart} mono />
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">Quality</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="w-full h-8 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Normal</option>
                <option>OG</option>
                <option>100 OG</option>
                <option>Care OG</option>
                <option>China OG</option>
              </select>
            </div>
            <Field label="Color" value={color} onChange={setColor} />
            <Field label="Variant" value={variant} onChange={setVariant} />
            <Field label="Flag" value={flag} onChange={setFlag} mono />
            <Field label="Network" value={network} onChange={setNetwork} mono />
            <Field label="Year" value={year} onChange={setYear} mono />
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">Qty</label>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">Rate</label>
              <input
                type="number"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {err && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-8 px-3 text-sm text-slate-700 border border-slate-300 rounded hover:bg-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-8 px-4 text-sm font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save & Reclassify'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-700 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full h-8 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          mono ? 'font-mono' : ''
        }`}
      />
    </div>
  )
}