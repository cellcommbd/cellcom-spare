'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { ArrowLeft, Check, Trash2, RefreshCw, Wrench } from 'lucide-react'

type SkippedRow = {
  id: number
  skipped_at: string
  import_context: string
  party_id: number | null
  invoice_no: string | null
  raw_description: string | null
  raw_type: string | null
  quality: string | null
  qty: number | null
  rate: number | null
  error_message: string | null
  resolved: boolean
  resolved_at: string | null
  resolved_item_id: number | null
  resolution_note: string | null
}

type Party = { party_id: number; party_name: string }
type PartType = { part_id: number; part_code: string; part_name: string }

export default function SkippedImportsPage() {
  const [rows, setRows] = useState<SkippedRow[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [parts, setParts] = useState<PartType[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [resolving, setResolving] = useState<number | null>(null)
  const [resolveItemSku, setResolveItemSku] = useState('')
  const [resolveNote, setResolveNote] = useState('')

  // Fix Part state
  const [fixingPart, setFixingPart] = useState<SkippedRow | null>(null)
  const [fixRawText, setFixRawText] = useState('')
  const [fixSearch, setFixSearch] = useState('')
  const [fixSaving, setFixSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [showResolved])

  async function loadData() {
    setLoading(true)
    const [r, p, pt] = await Promise.all([
      supabase
        .from('skipped_import_rows')
        .select('*')
        .eq('resolved', showResolved)
        .order('skipped_at', { ascending: false })
        .limit(500),
      supabase.from('parties').select('party_id, party_name').order('party_name'),
      supabase
        .from('part_types')
        .select('part_id, part_code, part_name')
        .order('part_code'),
    ])
    setRows((r.data as SkippedRow[]) || [])
    setParties(p.data || [])
    setParts((pt.data as PartType[]) || [])
    setLoading(false)
  }

  async function markResolved(id: number) {
    let itemId: number | null = null
    const sku = resolveItemSku.trim().toUpperCase()

    if (sku) {
      const { data: item } = await supabase
        .from('items')
        .select('item_id')
        .eq('sku', sku)
        .maybeSingle()
      if (!item) {
        setMessage(`No item found with SKU "${sku}". Leave blank to resolve without linking.`)
        return
      }
      itemId = item.item_id
    }

    const { error } = await supabase
      .from('skipped_import_rows')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_item_id: itemId,
        resolution_note: resolveNote.trim() || null,
      })
      .eq('id', id)

    if (error) {
      setMessage('Resolve failed: ' + error.message)
      return
    }
    setResolving(null)
    setResolveItemSku('')
    setResolveNote('')
    setMessage('Marked as resolved.')
    await loadData()
  }

  async function unresolve(id: number) {
    const { error } = await supabase
      .from('skipped_import_rows')
      .update({
        resolved: false,
        resolved_at: null,
        resolved_item_id: null,
        resolution_note: null,
      })
      .eq('id', id)
    if (error) {
      setMessage('Unresolve failed: ' + error.message)
      return
    }
    await loadData()
  }

  async function deleteRow(id: number) {
    if (!confirm('Delete this skipped row? This cannot be undone.')) return
    const { error } = await supabase
      .from('skipped_import_rows')
      .delete()
      .eq('id', id)
    if (error) {
      setMessage('Delete failed: ' + error.message)
      return
    }
    await loadData()
  }

  function openFixPart(row: SkippedRow) {
    setFixingPart(row)
    setFixRawText(row.raw_type?.trim() || '')
    setFixSearch('')
    setMessage('')
  }

  function closeFixPart() {
    setFixingPart(null)
    setFixRawText('')
    setFixSearch('')
    setFixSaving(false)
  }

  async function savePartFix() {
    const rawText = fixRawText.trim().toUpperCase()
    if (!rawText) {
      setMessage('Enter the raw text to alias first.')
      return
    }
    if (!fixingPart) return

    setFixSaving(true)
    const { error } = await supabase
      .from('part_type_aliases')
      .upsert(
        { csv_text: rawText, part_code: fixTargetToSave(fixingPart, rawText) },
        { onConflict: 'csv_text' }
      )
    setFixSaving(false)

    if (error) {
      setMessage('Save failed: ' + error.message)
      return
    }
    setMessage(`Alias saved: "${rawText}" → target part. Reimport the CSV to bring the row in.`)
    closeFixPart()
  }

  // Placeholder — the part code is chosen in savePartFixChosen
  function fixTargetToSave(_row: SkippedRow, _rawText: string): string {
    return ''
  }

  async function savePartFixChosen(partCode: string) {
    const rawText = fixRawText.trim().toUpperCase()
    if (!rawText) {
      setMessage('Enter the raw text to alias first.')
      return
    }
    setFixSaving(true)
    const { error } = await supabase
      .from('part_type_aliases')
      .upsert(
        { csv_text: rawText, part_code: partCode },
        { onConflict: 'csv_text' }
      )
    setFixSaving(false)
    if (error) {
      setMessage('Save failed: ' + error.message)
      return
    }
    setMessage(`Alias saved: "${rawText}" → ${partCode}. Reimport the CSV to bring the row in.`)
    closeFixPart()
  }

  const partyName = (id: number | null) =>
    id ? parties.find((p) => p.party_id === id)?.party_name || '—' : '—'

  const filteredParts = useMemo(() => {
    const q = fixSearch.trim().toLowerCase()
    if (!q) return parts.slice(0, 100)
    return parts
      .filter(
        (p) =>
          p.part_code.toLowerCase().includes(q) ||
          p.part_name.toLowerCase().includes(q)
      )
      .slice(0, 100)
  }, [parts, fixSearch])

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">

        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/purchases"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Skipped Import Rows</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Rows you skipped during CSV import. Fix parts, or mark resolved when handled.
            </p>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowResolved(false)}
            className={`h-9 px-4 text-sm font-medium rounded-lg ${
              !showResolved
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Unresolved
          </button>
          <button
            onClick={() => setShowResolved(true)}
            className={`h-9 px-4 text-sm font-medium rounded-lg ${
              showResolved
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Resolved
          </button>
          <button
            onClick={loadData}
            className="h-9 px-3 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-white flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          {message && <div className="text-sm text-slate-700 ml-2">{message}</div>}
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
            {showResolved ? 'No resolved rows yet.' : 'Nothing skipped. Clean slate.'}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">When</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Party / Inv</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Description</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Type</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Rate</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Error</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                      {new Date(r.skipped_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      <div>{partyName(r.party_id)}</div>
                      <div className="text-slate-500">{r.invoice_no || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {r.raw_description || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.raw_type || '—'}</td>
                    <td className="px-3 py-2 text-xs text-right text-slate-700">{r.qty ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-right text-slate-700">
                      {r.rate != null ? `₹ ${Number(r.rate).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-red-700">{r.error_message || '—'}</td>
                    <td className="px-3 py-2">
                      {!showResolved ? (
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          <button
                            onClick={() => openFixPart(r)}
                            className="text-[11px] px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100"
                            title="Fix part alias"
                          >
                            <Wrench className="w-3 h-3 inline mr-1" />
                            Fix Part
                          </button>
                          <button
                            onClick={() => setResolving(resolving === r.id ? null : r.id)}
                            className="p-1.5 rounded text-green-600 hover:bg-green-50"
                            title="Mark resolved"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteRow(r.id)}
                            className="p-1.5 rounded text-red-500 hover:bg-red-50"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => unresolve(r.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* FIX PART MODAL */}
        {fixingPart && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <Wrench className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-slate-800">Fix Part</h2>
              </div>

              <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2 mb-3">
                <div>
                  <span className="text-slate-500">Description:</span>{' '}
                  {fixingPart.raw_description || '—'}
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Raw text to alias
                </label>
                <input
                  type="text"
                  value={fixRawText}
                  onChange={(e) => setFixRawText(e.target.value.toUpperCase())}
                  placeholder="e.g. SUPER GADGET CONNECTOR"
                  className="w-full h-9 px-3 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="text-[11px] text-slate-500 mt-1">
                  This exact text (uppercase) will be saved as an alias in <code>part_type_aliases</code>.
                </div>
              </div>

              <input
                type="text"
                value={fixSearch}
                onChange={(e) => setFixSearch(e.target.value)}
                placeholder="Search part code or name..."
                className="w-full h-9 px-3 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              />

              <div className="flex-1 overflow-y-auto border border-slate-200 rounded">
                {filteredParts.map((p) => (
                  <button
                    key={p.part_id}
                    disabled={fixSaving || !fixRawText.trim()}
                    onClick={() => savePartFixChosen(p.part_code)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed border-b border-slate-100 last:border-0"
                  >
                    <span className="font-mono font-semibold text-slate-800">{p.part_code}</span>
                    <span className="text-slate-500 ml-2">{p.part_name}</span>
                  </button>
                ))}
              </div>

              <div className="mt-4 text-xs text-slate-500">
                Saving writes a permanent alias so the same pattern never fails again.
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={closeFixPart}
                  disabled={fixSaving}
                  className="flex-1 h-9 text-sm text-slate-700 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* RESOLVE MODAL */}
        {resolving !== null && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-2">Mark as resolved</h2>
              <p className="text-xs text-slate-500 mb-4">
                Optionally link to an existing item by SKU, and add a note.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Linked item SKU (optional)
                  </label>
                  <input
                    value={resolveItemSku}
                    onChange={(e) => setResolveItemSku(e.target.value.toUpperCase())}
                    placeholder="e.g. SAM-A05-BP"
                    className="w-full h-9 px-3 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Note (optional)
                  </label>
                  <input
                    value={resolveNote}
                    onChange={(e) => setResolveNote(e.target.value)}
                    placeholder="e.g. added manually on purchase #52"
                    className="w-full h-9 px-3 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => {
                    setResolving(null)
                    setResolveItemSku('')
                    setResolveNote('')
                  }}
                  className="flex-1 h-9 text-sm text-slate-700 border border-slate-300 rounded hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => markResolved(resolving)}
                  className="flex-1 h-9 text-sm font-semibold text-white bg-green-600 rounded hover:bg-green-700"
                >
                  Mark resolved
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}