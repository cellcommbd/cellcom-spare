'use client'

import { useEffect, useMemo, useState, createRef, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { SmartCombobox } from '../../../../components/ui/smart-combobox'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  X,
  Loader2,
  AlertTriangle,
} from 'lucide-react'

type Supplier = {
  party_id: number
  party_name: string
}

type Item = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
}

type EditRow = {
  rowId: number
  detail_id: number | null   // null = newly added row
  item_id: number | null
  sku: string
  quantity: number
  rate: number
  amount: number
}

export default function EditPurchasePage() {
  const params = useParams()
  const router = useRouter()
  const purchaseId = Number(params?.id)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<Item[]>([])

  const [partyId, setPartyId] = useState<number | null>(null)
  const [invoiceNo, setInvoiceNo] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [freight, setFreight] = useState('0')
  const [cashPaid, setCashPaid] = useState('0')

  const [rows, setRows] = useState<EditRow[]>([])
  const [nextRowId, setNextRowId] = useState(1)

  const [pendingFocusRowId, setPendingFocusRowId] = useState<number | null>(null)
  const itemRefs = useRef<
    Record<number, React.RefObject<HTMLInputElement | null>>
  >({})

  function getItemRef(
    rowId: number
  ): React.RefObject<HTMLInputElement | null> {
    if (!itemRefs.current[rowId]) {
      itemRefs.current[rowId] = createRef<HTMLInputElement>()
    }
    return itemRefs.current[rowId]
  }

  // Load purchase + lines + master data
  useEffect(() => {
    if (!purchaseId) return
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseId])

  useEffect(() => {
    if (pendingFocusRowId == null) return
    const el = itemRefs.current[pendingFocusRowId]?.current
    if (el) {
      el.focus()
      setPendingFocusRowId(null)
    }
  }, [pendingFocusRowId, rows])

  async function loadAll() {
    setLoading(true)
    setError('')

    const [purRes, linesRes, supRes, itemsRes] = await Promise.all([
      supabase
        .from('purchases')
        .select('*')
        .eq('purchase_id', purchaseId)
        .single(),
      supabase
        .from('purchase_items')
        .select('*')
        .eq('purchase_id', purchaseId)
        .order('detail_id'),
      supabase
        .from('parties')
        .select('party_id, party_name')
        .eq('party_type', 'Supplier')
        .order('party_name'),
      supabase.from('items').select('item_id, sku, current_stock, cost_price').order('sku'),
    ])

    if (purRes.error || !purRes.data) {
      setError('Purchase not found.')
      setLoading(false)
      return
    }

    const header = purRes.data
    setPartyId(header.party_id)
    setInvoiceNo(header.invoice_no || '')
    setPurchaseDate(header.purchase_date)
    setFreight(String(header.freight_charges ?? 0))
    setCashPaid(String(header.cash_paid ?? 0))

    setSuppliers(supRes.data || [])
    const itemList = itemsRes.data || []
    setItems(itemList)

    const itemMap: Record<number, Item> = {}
    for (const it of itemList) itemMap[it.item_id] = it

    let nid = 1
    const editRows: EditRow[] = (linesRes.data || []).map((l: any) => {
      const it = itemMap[l.item_id]
      return {
        rowId: nid++,
        detail_id: l.detail_id,
        item_id: l.item_id,
        sku: it?.sku || '(unknown)',
        quantity: Number(l.quantity),
        rate: Number(l.rate),
        amount: Number(l.amount),
      }
    })

    if (editRows.length === 0) {
      editRows.push({
        rowId: nid++,
        detail_id: null,
        item_id: null,
        sku: '',
        quantity: 0,
        rate: 0,
        amount: 0,
      })
    }

    setRows(editRows)
    setNextRowId(nid)
    setLoading(false)
  }

  const supplierOptions = suppliers.map((s) => ({
    value: s.party_id,
    label: s.party_name,
  }))

  const itemOptions = useMemo(
    () =>
      items.map((it) => ({
        value: it.item_id,
        label: `${it.sku}  ·  stock: ${it.current_stock}  ·  cp: ₹${Number(it.cost_price).toFixed(2)}`,
      })),
    [items]
  )

  function addRow(): number {
    const newId = nextRowId
    setRows((prev) => [
      ...prev,
      { rowId: newId, detail_id: null, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
    ])
    setNextRowId((n) => n + 1)
    setPendingFocusRowId(newId)
    return newId
  }

  function removeRow(rowId: number) {
    setRows((prev) => {
      const next = prev.filter((r) => r.rowId !== rowId)
      if (next.length === 0) {
        return [
          {
            rowId: 1,
            detail_id: null,
            item_id: null,
            sku: '',
            quantity: 0,
            rate: 0,
            amount: 0,
          },
        ]
      }
      return next
    })
  }

  function updateRow(rowId: number, patch: Partial<EditRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r
        const merged = { ...r, ...patch }
        merged.amount = Number(merged.quantity) * Number(merged.rate)
        return merged
      })
    )
  }

  function handleItemSelect(rowId: number, itemId: number) {
    const it = items.find((x) => x.item_id === itemId)
    if (!it) return
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r
        const rate = it.cost_price > 0 ? it.cost_price : 0
        return {
          ...r,
          item_id: it.item_id,
          sku: it.sku,
          rate,
          amount: Number(r.quantity) * Number(rate),
        }
      })
    )
  }

  const subtotal = rows.reduce((s, r) => s + (r.amount || 0), 0)
  const freightNum = parseFloat(freight) || 0
  const total = subtotal + freightNum

  async function handleSave() {
    setError('')
    setMessage('')

    if (!partyId) {
      setError('Please select a supplier.')
      return
    }

    const validRows = rows.filter(
      (r) => r.item_id && r.quantity > 0 && r.rate > 0
    )
    if (validRows.length === 0) {
      setError('Add at least one item with quantity and rate.')
      return
    }

    setSaving(true)

    // Compute effectiveRate the same way the create flow does:
    // freight is distributed by value, then added to rate
    const validSubtotal = validRows.reduce((s, r) => s + r.amount, 0)
    const linesForRPC = validRows.map((r) => {
      const share =
        validSubtotal > 0 ? (r.amount / validSubtotal) * freightNum : 0
      const effectiveRate = r.rate + share / r.quantity
      return {
        item_id: r.item_id,
        quantity: r.quantity,
        rate: Number(effectiveRate.toFixed(4)),
        amount: Number((effectiveRate * r.quantity).toFixed(2)),
      }
    })

    const { error: rpcError } = await supabase.rpc('update_purchase', {
      p_id: purchaseId,
      p_party_id: partyId,
      p_invoice_no: invoiceNo.trim() || null,
      p_purchase_date: purchaseDate,
      p_total_amount: total,
      p_freight_charges: freightNum,
      p_cash_paid: parseFloat(cashPaid) || 0,
      p_lines: linesForRPC,
    })

    setSaving(false)

    if (rpcError) {
      setError('Save failed: ' + rpcError.message)
      return
    }

    setMessage('Saved. Stock and cost updated.')
    // Navigate back to purchases after a short pause
    setTimeout(() => router.push('/purchases'), 800)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <Link
            href="/purchases"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            aria-label="Back to purchases"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Edit Purchase #{purchaseId}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Changing lines will reverse old stock and reapply new stock.
            </p>
          </div>
        </div>

        {/* Header fields */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 mb-5 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Supplier
              </label>
              <SmartCombobox
                options={supplierOptions}
                value={partyId ? String(partyId) : null}
                onValueChange={(v: string, _l: string, isNew: boolean) => {
                  if (isNew) return
                  setPartyId(Number(v))
                }}
                placeholder="Select supplier..."
                allowCreate={false}
                focusNextOnSelect={true}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Invoice No
              </label>
              <input
                type="text"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Purchase Date
              </label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Lines */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-5 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <span className="text-sm font-semibold text-slate-700">
              Lines ({rows.length})
            </span>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="w-10 border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold text-slate-600">#</th>
                  <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold text-slate-600">Item (SKU)</th>
                  <th className="w-20 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">Qty</th>
                  <th className="w-24 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">Rate</th>
                  <th className="w-28 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">Amount</th>
                  <th className="w-12 border-b border-slate-200 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.rowId} className="border-b border-slate-100">
                    <td className="px-2 py-1 text-center text-slate-500 text-xs">
                      {idx + 1}
                    </td>
                    <td className="px-2 py-1">
                      <SmartCombobox
                        options={itemOptions}
                        value={row.item_id ? String(row.item_id) : null}
                        onValueChange={(v: string, _l: string, isNew: boolean) => {
                          if (isNew) return
                          handleItemSelect(row.rowId, Number(v))
                        }}
                        placeholder="Search SKU..."
                        allowCreate={false}
                        focusNextOnSelect={true}
                        inputRef={getItemRef(row.rowId)}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        value={row.quantity || ''}
                        onChange={(e) =>
                          updateRow(row.rowId, {
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        value={row.rate || ''}
                        onChange={(e) =>
                          updateRow(row.rowId, {
                            rate: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-medium text-slate-800">
                      ₹ {row.amount.toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button
                        onClick={() => removeRow(row.rowId)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={addRow}
              className="w-full px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-1 border-t border-slate-200"
            >
              <Plus className="size-4" />
              Add Row
            </button>
          </div>

          {/* Mobile list */}
          <div className="md:hidden p-3 space-y-3">
            {rows.map((row, idx) => (
              <div key={row.rowId} className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-500">
                    Item #{idx + 1}
                  </div>
                  <button
                    onClick={() => removeRow(row.rowId)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <SmartCombobox
                  options={itemOptions}
                  value={row.item_id ? String(row.item_id) : null}
                  onValueChange={(v: string, _l: string, isNew: boolean) => {
                    if (isNew) return
                    handleItemSelect(row.rowId, Number(v))
                  }}
                  placeholder="Search SKU..."
                  allowCreate={false}
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">
                      Qty
                    </label>
                    <input
                      type="number"
                      value={row.quantity || ''}
                      onChange={(e) =>
                        updateRow(row.rowId, {
                          quantity: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full h-9 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">
                      Rate
                    </label>
                    <input
                      type="number"
                      value={row.rate || ''}
                      onChange={(e) =>
                        updateRow(row.rowId, {
                          rate: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full h-9 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="text-right text-sm font-bold text-slate-800">
                  ₹ {row.amount.toFixed(2)}
                </div>
              </div>
            ))}
            <button
              onClick={addRow}
              className="w-full h-10 text-sm font-medium text-blue-600 border-2 border-dashed border-blue-200 rounded-lg hover:bg-blue-50 flex items-center justify-center gap-1"
            >
              <Plus className="size-4" />
              Add Row
            </button>
          </div>
        </div>

        {/* Totals */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 mb-5 shadow-sm">
          <div className="max-w-md ml-auto space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Subtotal</span>
              <span className="font-medium text-slate-800">
                ₹ {subtotal.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm gap-3">
              <span className="text-slate-600">Freight Charges</span>
              <input
                type="number"
                value={freight}
                onChange={(e) => setFreight(e.target.value)}
                className="w-32 h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-between text-base border-t border-slate-300 pt-2">
              <span className="font-semibold text-slate-800">Total</span>
              <span className="font-bold text-slate-900">
                ₹ {total.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm gap-3">
              <span className="text-slate-600">Cash Paid</span>
              <input
                type="number"
                value={cashPaid}
                onChange={(e) => setCashPaid(e.target.value)}
                className="w-32 h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Info banner */}
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            Saving will <strong>delete all existing lines</strong> (stock decreases),
            then <strong>insert the edited lines</strong> (stock increases,
            cost recomputes). Stock values will be correct, but cost price will
            be recalculated as if this is the latest purchase for each item.
          </div>
        </div>

        {/* Error / message */}
        {error && (
          <div className="mb-5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-5 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {message}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/purchases"
            className="h-10 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-white flex items-center gap-2"
          >
            <X className="size-4" />
            Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-10 px-6 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Save className="size-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

      </div>
    </div>
  )
}