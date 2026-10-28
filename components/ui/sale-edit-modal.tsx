'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SmartCombobox } from './smart-combobox'
import { searchItems } from '@/lib/item-search'
import { X, Plus, Trash2, Save } from 'lucide-react'
import { getRole } from '@/lib/auth'

type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
  phone: string | null
}

type Item = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
  selling_price: number
  quality?: string | null
  variant?: string | null
  network?: string | null
}

type EditRow = {
  rowId: number
  detail_id: number | null
  item_id: number | null
  sku: string
  quantity: number
  rate: number
  amount: number
  cost_at_sale: number
}

type Props = {
  saleId: number
  onClose: () => void
  onSaved?: () => void
}

export function SaleEditModal({ saleId, onClose, onSaved }: Props) {
  const [parties, setParties] = useState<Party[]>([])
  const [rows, setRows] = useState<EditRow[]>([])
  const [nextRowId, setNextRowId] = useState(1)
  const [itemCache, setItemCache] = useState<Record<number, Item>>({})
  const [rowOptions, setRowOptions] = useState<Record<number, Item[]>>({})

  const [partyId, setPartyId] = useState<number | null>(null)
  const [billDate, setBillDate] = useState('')
  const [originalTotal, setOriginalTotal] = useState(0)
  const [originalPartyId, setOriginalPartyId] = useState<number | null>(null)
  const [paidAmount, setPaidAmount] = useState(0)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [isOwner, setIsOwner] = useState(false)

  useEffect(() => {
    setIsOwner(getRole() === 'owner')
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId])

  async function load() {
    setLoading(true)
    setMessage('')

    // Fetch sale header
    const { data: sale, error: saleErr } = await supabase
      .from('sales')
      .select(
        'sale_id, party_id, bill_date, total_amount, paid_amount, status'
      )
      .eq('sale_id', saleId)
      .single()

    if (saleErr || !sale) {
      setMessage('Could not load sale: ' + (saleErr?.message || 'unknown'))
      setLoading(false)
      return
    }

    setPartyId(Number(sale.party_id))
    setOriginalPartyId(Number(sale.party_id))
    setBillDate(sale.bill_date)
    setOriginalTotal(Number(sale.total_amount))
    setPaidAmount(Number(sale.paid_amount || 0))

    // Fetch parties
    const { data: partyData } = await supabase
      .from('parties')
      .select('party_id, party_name, party_type, current_balance, phone')
      .eq('party_type', 'Customer')
      .order('party_name')
    setParties((partyData as Party[]) || [])

    // Fetch sale_items
    const { data: lineData, error: lineErr } = await supabase
      .from('sale_items')
      .select('detail_id, item_id, quantity, rate, amount, cost_at_sale')
      .eq('sale_id', saleId)
      .order('detail_id')

    if (lineErr) {
      setMessage('Could not load lines: ' + lineErr.message)
      setLoading(false)
      return
    }

    const lines = (lineData || []) as any[]
    const itemIds = Array.from(
      new Set(lines.map((l) => l.item_id).filter(Boolean))
    ) as number[]

    let cache: Record<number, Item> = {}
    if (itemIds.length > 0) {
      const { data: itemRows } = await supabase
        .from('items')
        .select(
          'item_id, sku, current_stock, cost_price, selling_price, quality, variant'
        )
        .in('item_id', itemIds)
      for (const it of itemRows || []) {
        cache[it.item_id] = it as Item
      }
    }
    setItemCache(cache)

    let nid = 1
    const editRows: EditRow[] = lines.map((l) => {
      const it = cache[l.item_id]
      return {
        rowId: nid++,
        detail_id: l.detail_id,
        item_id: l.item_id,
        sku: it?.sku || '(unknown)',
        quantity: Number(l.quantity),
        rate: Number(l.rate),
        amount: Number(l.amount),
        cost_at_sale: Number(l.cost_at_sale || 0),
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
        cost_at_sale: 0,
      })
    }

    setRows(editRows)
    setNextRowId(nid)
    setLoading(false)
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

  function addRow() {
    const newId = nextRowId
    setRows((prev) => [
      ...prev,
      {
        rowId: newId,
        detail_id: null,
        item_id: null,
        sku: '',
        quantity: 0,
        rate: 0,
        amount: 0,
        cost_at_sale: 0,
      },
    ])
    setNextRowId((n) => n + 1)
  }

  function removeRow(rowId: number) {
    setRows((prev) => {
      const filtered = prev.filter((r) => r.rowId !== rowId)
      if (filtered.length === 0) {
        return [
          {
            rowId: nextRowId,
            detail_id: null,
            item_id: null,
            sku: '',
            quantity: 0,
            rate: 0,
            amount: 0,
            cost_at_sale: 0,
          },
        ]
      }
      return filtered
    })
    setRowOptions((prev) => {
      const next = { ...prev }
      delete next[rowId]
      return next
    })
  }

  async function searchRow(rowId: number, query: string) {
    if (!query || query.trim().length < 2) {
      setRowOptions((prev) => ({ ...prev, [rowId]: [] }))
      return
    }
    const results = await searchItems(query)
    const items = results as Item[]
    setRowOptions((prev) => ({ ...prev, [rowId]: items }))
    setItemCache((prev) => {
      const next = { ...prev }
      for (const it of items) next[it.item_id] = it
      return next
    })
  }

  function selectItem(rowId: number, itemId: number) {
    const it = itemCache[itemId]
    if (!it) return
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r
        const qty = r.quantity > 0 ? r.quantity : 1
        return {
          ...r,
          item_id: it.item_id,
          sku: it.sku,
          quantity: qty,
          rate: it.selling_price,
          amount: Number(qty) * Number(it.selling_price),
          cost_at_sale: it.cost_price,
        }
      })
    )
  }

  function optionsFor(rowId: number) {
    const seen = new Set<number>()
    const out: { value: number; label: string }[] = []
    const row = rows.find((r) => r.rowId === rowId)
    if (row?.item_id) {
      const cached = itemCache[row.item_id]
      if (cached) {
        seen.add(cached.item_id)
        out.push({ value: cached.item_id, label: itemLabel(cached) })
      }
    }
    for (const it of rowOptions[rowId] || []) {
      if (seen.has(it.item_id)) continue
      seen.add(it.item_id)
      out.push({ value: it.item_id, label: itemLabel(it) })
    }
    return out
  }

  function itemLabel(it: Item): string {
    const parts = [
      it.sku,
      `stock ${it.current_stock}`,
      `sp ₹${Number(it.selling_price).toFixed(0)}`,
      `cp ₹${Number(it.cost_price).toFixed(0)}`,
      it.quality && it.quality !== 'Normal' ? it.quality : null,
      it.variant || null,
    ].filter(Boolean)
    return parts.join(' · ')
  }

  async function save() {
    if (!partyId || !billDate) {
      setMessage('Party and date are required.')
      return
    }

    const validRows = rows.filter(
      (r) => r.item_id && r.quantity > 0 && r.rate > 0
    )
    if (validRows.length === 0) {
      setMessage('Add at least one item with quantity and rate.')
      return
    }

    const newTotal = validRows.reduce((s, r) => s + r.amount, 0)

    if (paidAmount > 0 && newTotal < paidAmount) {
      setMessage(
        `Cannot reduce total below what's already paid (₹${paidAmount.toFixed(
          2
        )}).`
      )
      return
    }

    setSaving(true)
    setMessage('')

    const newStatus =
      newTotal <= paidAmount
        ? 'Paid'
        : paidAmount > 0
        ? 'Partially Paid'
        : 'Pending'

    // 1. Update sale header
    const { error: headerErr } = await supabase
      .from('sales')
      .update({
        party_id: partyId,
        bill_date: billDate,
        total_amount: newTotal,
        status: newStatus,
      })
      .eq('sale_id', saleId)

    if (headerErr) {
      setMessage('Save failed: ' + headerErr.message)
      setSaving(false)
      return
    }

    // 2. Delete old lines (triggers restore stock)
    const { error: delErr } = await supabase
      .from('sale_items')
      .delete()
      .eq('sale_id', saleId)

    if (delErr) {
      setMessage('Save failed: ' + delErr.message)
      setSaving(false)
      return
    }

    // 3. Insert new lines (triggers decrement stock)
    const lineInserts = validRows.map((r) => ({
      sale_id: saleId,
      item_id: r.item_id,
      quantity: r.quantity,
      rate: r.rate,
      amount: Number((r.rate * r.quantity).toFixed(2)),
      cost_at_sale: r.cost_at_sale || 0,
    }))

    const { error: insErr } = await supabase
      .from('sale_items')
      .insert(lineInserts)

    if (insErr) {
      setMessage('Save failed: ' + insErr.message)
      setSaving(false)
      return
    }

    // 4. Balance adjustments
    if (originalPartyId === partyId) {
      const delta = newTotal - originalTotal
      if (Math.abs(delta) > 0.001) {
        const { data: p } = await supabase
          .from('parties')
          .select('current_balance')
          .eq('party_id', partyId)
          .single()
        if (p) {
          await supabase
            .from('parties')
            .update({
              current_balance: Number(p.current_balance) + delta,
            })
            .eq('party_id', partyId)
        }
      }
    } else {
      if (originalPartyId) {
        const { data: oldP } = await supabase
          .from('parties')
          .select('current_balance')
          .eq('party_id', originalPartyId)
          .single()
        if (oldP) {
          await supabase
            .from('parties')
            .update({
              current_balance:
                Number(oldP.current_balance) - originalTotal,
            })
            .eq('party_id', originalPartyId)
        }
      }
      const { data: newP } = await supabase
        .from('parties')
        .select('current_balance')
        .eq('party_id', partyId)
        .single()
      if (newP) {
        await supabase
          .from('parties')
          .update({
            current_balance: Number(newP.current_balance) + newTotal,
          })
          .eq('party_id', partyId)
      }
    }

    setSaving(false)
    if (onSaved) onSaved()
    onClose()
  }

  async function deleteSale() {
    if (!isOwner) return
    if (
      !confirm(
        `Delete sale #${saleId}? Stock will be restored. Customer balance will be adjusted.`
      )
    )
      return

    setSaving(true)

    // Adjust customer balance
    if (originalPartyId) {
      const { data: p } = await supabase
        .from('parties')
        .select('current_balance')
        .eq('party_id', originalPartyId)
        .single()
      if (p) {
        await supabase
          .from('parties')
          .update({
            current_balance: Number(p.current_balance) - originalTotal,
          })
          .eq('party_id', originalPartyId)
      }
    }

    // Delete lines (trigger restores stock)
    await supabase.from('sale_items').delete().eq('sale_id', saleId)

    // Delete header
    const { error } = await supabase
      .from('sales')
      .delete()
      .eq('sale_id', saleId)

    setSaving(false)
    if (error) {
      setMessage('Delete failed: ' + error.message)
      return
    }

    if (onSaved) onSaved()
    onClose()
  }

  const runningTotal = rows.reduce((s, r) => s + (r.amount || 0), 0)

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 text-sm text-slate-500">
          Loading sale…
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <div className="text-base font-bold text-slate-900">
              Edit Sale #{saleId}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Original ₹{originalTotal.toFixed(2)}
              {paidAmount > 0 && <> · Paid ₹{paidAmount.toFixed(2)}</>}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Customer
              </label>
              <SmartCombobox
                options={parties.map((p) => ({
                  value: p.party_id,
                  label: p.party_name,
                }))}
                value={partyId ? String(partyId) : null}
                onValueChange={(v, _l, isNew) => {
                  if (isNew) return
                  setPartyId(Number(v))
                }}
                placeholder="Select customer..."
                allowCreate={false}
                focusNextOnSelect={false}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Bill Date
              </label>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="w-full h-11 px-2 text-base sm:text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
              Items ({rows.length})
            </div>
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div
                  key={row.rowId}
                  className="border border-slate-200 rounded-lg p-2 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-500">
                      Item #{idx + 1}
                    </div>
                    <button
                      onClick={() => removeRow(row.rowId)}
                      className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <SmartCombobox
                    options={optionsFor(row.rowId)}
                    value={row.item_id ? String(row.item_id) : null}
                    fallbackLabel={
                      row.item_id && row.sku ? row.sku : null
                    }
                    onValueChange={(v, _l, isNew) => {
                      if (isNew) return
                      selectItem(row.rowId, Number(v))
                    }}
                    onSearch={(q) => searchRow(row.rowId, q)}
                    placeholder="Search SKU..."
                    allowCreate={false}
                    focusNextOnSelect={false}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">
                        Qty
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={row.quantity || ''}
                        onChange={(e) =>
                          updateRow(row.rowId, {
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full h-11 px-2 text-base text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">
                        Rate
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={row.rate || ''}
                        onChange={(e) =>
                          updateRow(row.rowId, {
                            rate: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full h-11 px-2 text-base text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">
                        Amount
                      </label>
                      <div className="h-11 px-2 flex items-center justify-end text-sm font-bold text-slate-800">
                        ₹ {row.amount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <button
                onClick={addRow}
                className="w-full h-11 text-sm font-medium text-blue-600 border-2 border-dashed border-blue-200 rounded-lg hover:bg-blue-50 flex items-center justify-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Add Item
              </button>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">New Total</span>
              <span className="font-bold text-slate-900">
                ₹ {runningTotal.toFixed(2)}
              </span>
            </div>
            {paidAmount > 0 && (
              <div className="text-[11px] text-amber-800 mt-1">
                Already paid ₹{paidAmount.toFixed(2)}. Cannot reduce total
                below that.
              </div>
            )}
          </div>

          {message && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 border-t border-slate-200 flex items-center gap-2 bg-slate-50 rounded-b-2xl shrink-0">
          {isOwner && (
            <button
              onClick={deleteSale}
              disabled={saving}
              className="h-11 px-3 text-sm font-medium text-rose-700 border border-rose-300 rounded-lg hover:bg-rose-50 disabled:opacity-50 flex items-center gap-1"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 h-11 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 h-11 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}