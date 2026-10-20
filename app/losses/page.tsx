'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { Plus, Trash2, Save, X } from 'lucide-react'
import { searchItems as searchItemsShared } from '../../lib/item-search'

// ---------- Types ----------
type Item = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
}

type LossRow = {
  rowId: number
  item_id: number | null
  sku: string
  quantity: number
  rate: number
  amount: number
  reason: string
  notes: string
}

type Loss = {
  loss_id: number
  item_id: number
  loss_date: string
  quantity: number
  rate: number
  total_amount: number
  reason: string
  notes: string | null
}

const REASONS = ['Damaged', 'Broken', 'Defective', 'Expired', 'Other']
const DEFAULT_REASON = 'Damaged'

export default function LossesPage() {
  // Only items for TODAY's losses need to be cached here (small set).
  // Full item search goes through the search_items RPC via SmartCombobox.
  const [todayItems, setTodayItems] = useState<Item[]>([])
  const [todayLosses, setTodayLosses] = useState<Loss[]>([])
  const [itemOptions, setItemOptions] = useState<
    { value: number; label: string }[]
  >([])

  const [lossDate, setLossDate] = useState(new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<LossRow[]>([
    {
      rowId: 1,
      item_id: null,
      sku: '',
      quantity: 0,
      rate: 0,
      amount: 0,
      reason: DEFAULT_REASON,
      notes: '',
    },
  ])
  const [nextRowId, setNextRowId] = useState(2)

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({})

  // ---------- Load ----------
  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const today = new Date().toISOString().slice(0, 10)

    const { data: lossData } = await supabase
      .from('losses')
      .select('*')
      .eq('loss_date', today)
      .order('loss_id', { ascending: false })

    const lossRows = (lossData || []) as Loss[]
    setTodayLosses(lossRows)

    // Fetch SKUs only for today's loss items — small, never truncated.
    const itemIds = Array.from(new Set(lossRows.map((l) => l.item_id)))
    if (itemIds.length === 0) {
      setTodayItems([])
      return
    }

    const { data: itemData } = await supabase
      .from('items')
      .select('item_id, sku, current_stock, cost_price')
      .in('item_id', itemIds)

    setTodayItems((itemData || []) as Item[])
  }

  // ---------- Item search (server-side RPC) ----------
  async function searchItems(query: string) {
    if (!query || query.trim().length < 2) {
      setItemOptions([])
      return
    }
    const results = await searchItemsShared(query)
    const opts = (results as Item[]).map((it) => ({
      value: it.item_id,
      label: `${it.sku}  ·  stock: ${it.current_stock}  ·  cp: ₹${Number(
        it.cost_price
      ).toFixed(2)}`,
    }))
    setItemOptions(opts)
  }

  // ---------- Row handlers ----------
  function addRow() {
    const newId = nextRowId
    setRows((prev) => [
      ...prev,
      {
        rowId: newId,
        item_id: null,
        sku: '',
        quantity: 0,
        rate: 0,
        amount: 0,
        reason: DEFAULT_REASON,
        notes: '',
      },
    ])
    setNextRowId((n) => n + 1)
  }

  function removeRow(rowId: number) {
    if (rows.length === 1) {
      setRows([
        {
          rowId: 1,
          item_id: null,
          sku: '',
          quantity: 0,
          rate: 0,
          amount: 0,
          reason: DEFAULT_REASON,
          notes: '',
        },
      ])
      return
    }
    setRows((prev) => prev.filter((r) => r.rowId !== rowId))
  }

  function updateRow(rowId: number, patch: Partial<LossRow>) {
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
    // Look up the full item — either already in options or fetch fresh.
    const fromOptions = itemOptions.find((o) => o.value === itemId)
    const cached = todayItems.find((i) => i.item_id === itemId)
    if (cached) {
      updateRow(rowId, {
        item_id: cached.item_id,
        sku: cached.sku,
        rate: cached.cost_price,
      })
      focusQty(rowId)
      return
    }

    // Fetch to get cost_price reliably (options label is display-only)
    supabase
      .from('items')
      .select('item_id, sku, current_stock, cost_price')
      .eq('item_id', itemId)
      .single()
      .then(({ data }) => {
        if (!data) return
        updateRow(rowId, {
          item_id: data.item_id,
          sku: data.sku,
          rate: data.cost_price,
        })
        focusQty(rowId)
      })
  }

  function focusQty(rowId: number) {
    setTimeout(() => {
      const ref = qtyRefs.current[rowId]
      if (ref) {
        ref.focus()
        ref.select()
      }
    }, 0)
  }

  function handleItemTab(row: LossRow, idx: number) {
    const isLastRow = idx === rows.length - 1
    if (!isLastRow) return
    if (row.item_id) {
      const newId = addRow()
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>(
          `input[data-row-item="loss-row-${newId}"]`
        )
        el?.focus()
      }, 80)
    } else {
      document.getElementById('save-loss-btn')?.focus()
    }
  }

  function handleRateTab(rowId: number, idx: number, e: React.KeyboardEvent) {
    const isLastRow = idx === rows.length - 1
    if (!isLastRow) return
    const row = rows[idx]
    if (row.item_id) {
      e.preventDefault()
      const newId = addRow()
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>(
          `input[data-row-item="loss-row-${newId}"]`
        )
        el?.focus()
      }, 80)
    } else {
      e.preventDefault()
      document.getElementById('save-loss-btn')?.focus()
    }
  }

  // ---------- Totals ----------
  const grandTotal = rows.reduce((s, r) => s + (r.amount || 0), 0)

  // ---------- Save ----------
  async function saveLosses() {
    setMessage('')
    const validRows = rows.filter(
      (r) => r.item_id && r.quantity > 0 && r.rate > 0
    )
    if (validRows.length === 0) {
      setMessage('Add at least one item with quantity.')
      return
    }

    setSaving(true)

    const insertRows = validRows.map((r) => ({
      item_id: r.item_id,
      loss_date: lossDate,
      quantity: r.quantity,
      rate: r.rate,
      total_amount: Number((r.quantity * r.rate).toFixed(2)),
      reason: r.reason,
      notes: r.notes || null,
    }))

    const { error } = await supabase.from('losses').insert(insertRows)

    if (error) {
      setMessage('Save error: ' + error.message)
      setSaving(false)
      return
    }

    setMessage(
      `Saved ${validRows.length} loss entr${
        validRows.length > 1 ? 'ies' : 'y'
      }. Stock decreased.`
    )

    setRows([
      {
        rowId: 1,
        item_id: null,
        sku: '',
        quantity: 0,
        rate: 0,
        amount: 0,
        reason: DEFAULT_REASON,
        notes: '',
      },
    ])
    setNextRowId(2)
    setItemOptions([])
    await loadData()
    setSaving(false)
  }

  function resetForm() {
    setRows([
      {
        rowId: 1,
        item_id: null,
        sku: '',
        quantity: 0,
        rate: 0,
        amount: 0,
        reason: DEFAULT_REASON,
        notes: '',
      },
    ])
    setNextRowId(2)
    setLossDate(new Date().toISOString().slice(0, 10))
    setItemOptions([])
    setMessage('')
  }

  async function deleteLoss(id: number) {
    if (!confirm(`Delete loss #${id}? Stock will go back up.`)) return
    const { error } = await supabase.from('losses').delete().eq('loss_id', id)
    if (error) setMessage('Delete error: ' + error.message)
    else {
      setMessage('Deleted loss #' + id)
      await loadData()
    }
  }

  const itemSku = (id: number) =>
    todayItems.find((i) => i.item_id === id)?.sku || '—'

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">

        <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              Faulty / Loss Entry
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Record damaged, broken, or defective items. Stock decreases.
              This loss is subtracted from profit in reports.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Loss Date
            </label>
            <input
              type="date"
              value={lossDate}
              onChange={(e) => setLossDate(e.target.value)}
              className="h-11 sm:h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 mb-6 shadow-sm">

          <div className="border border-slate-300 rounded-lg">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="w-10 border-b border-slate-300 px-2 py-2 text-left text-xs font-semibold text-slate-600">
                    #
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left text-xs font-semibold text-slate-600">
                    Item (SKU)
                  </th>
                  <th className="w-20 border-b border-slate-300 px-2 py-2 text-right text-xs font-semibold text-slate-600">
                    Qty
                  </th>
                  <th className="w-24 border-b border-slate-300 px-2 py-2 text-right text-xs font-semibold text-slate-600">
                    Cost
                  </th>
                  <th className="w-32 border-b border-slate-300 px-2 py-2 text-left text-xs font-semibold text-slate-600">
                    Reason
                  </th>
                  <th className="border-b border-slate-300 px-2 py-2 text-left text-xs font-semibold text-slate-600">
                    Notes
                  </th>
                  <th className="w-28 border-b border-slate-300 px-2 py-2 text-right text-xs font-semibold text-slate-600">
                    Amount
                  </th>
                  <th className="w-12 border-b border-slate-300 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.rowId} className="border-b border-slate-200">
                    <td className="px-2 py-1 text-center text-slate-500 text-xs">
                      {idx + 1}
                    </td>
                    <td className="px-2 py-1">
                      <SmartCombobox
                        options={itemOptions}
                        value={row.item_id ? String(row.item_id) : null}
                        fallbackLabel={row.item_id && row.sku ? row.sku : null}
                        onValueChange={(v, label, isNew) => {
                          if (isNew) return
                          handleItemSelect(row.rowId, Number(v))
                        }}
                        onTabKey={() => handleItemTab(row, idx)}
                        onSearch={searchItems}
                        placeholder="Type 2+ letters to search SKU…"
                        allowCreate={false}
                        inputDataAttr={`loss-row-${row.rowId}`}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        ref={(el) => {
                          qtyRefs.current[row.rowId] = el
                        }}
                        type="number"
                        inputMode="numeric"
                        value={row.quantity || ''}
                        onChange={(e) =>
                          updateRow(row.rowId, {
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        onFocus={(e) => e.target.select()}
                        className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        inputMode="numeric"
                        value={row.rate || ''}
                        onChange={(e) =>
                          updateRow(row.rowId, {
                            rate: parseFloat(e.target.value) || 0,
                          })
                        }
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === 'Tab') handleRateTab(row.rowId, idx, e)
                        }}
                        className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={row.reason}
                        onChange={(e) =>
                          updateRow(row.rowId, { reason: e.target.value })
                        }
                        className="w-full h-8 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        {REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) =>
                          updateRow(row.rowId, { notes: e.target.value })
                        }
                        placeholder="optional"
                        className="w-full h-8 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-medium text-slate-800">
                      ₹ {row.amount.toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button
                        onClick={() => removeRow(row.rowId)}
                        className="text-red-500 hover:text-red-700"
                        title="Remove row"
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

          <div className="mt-6 grid grid-cols-2 gap-6">
            <div></div>
            <div>
              <div className="flex justify-between text-base border-t border-slate-300 pt-2">
                <span className="font-semibold text-slate-800">
                  Total Loss Value:
                </span>
                <span className="font-bold text-red-700">
                  ₹ {grandTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-6 pt-4 border-t border-slate-200">
            <button
              id="save-loss-btn"
              onClick={saveLosses}
              disabled={saving}
              className="h-11 px-6 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save className="size-4" />
              {saving ? 'Saving...' : 'Save Losses'}
            </button>
            <button
              onClick={resetForm}
              className="h-11 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center justify-center gap-2"
            >
              <X className="size-4" />
              Clear
            </button>
            {message && <div className="text-sm text-slate-700">{message}</div>}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <span className="text-sm font-semibold text-slate-700">
              Today's Losses ({todayLosses.length})
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="w-16 border-b border-slate-300 px-3 py-2 text-left text-xs font-semibold text-slate-600">
                    ID
                  </th>
                  <th className="border-b border-slate-300 px-3 py-2 text-left text-xs font-semibold text-slate-600">
                    Item
                  </th>
                  <th className="w-20 border-b border-slate-300 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    Qty
                  </th>
                  <th className="w-28 border-b border-slate-300 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    Cost
                  </th>
                  <th className="w-32 border-b border-slate-300 px-3 py-2 text-left text-xs font-semibold text-slate-600">
                    Reason
                  </th>
                  <th className="w-28 border-b border-slate-300 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    Amount
                  </th>
                  <th className="w-20 border-b border-slate-300 px-3 py-2 text-left text-xs font-semibold text-slate-600">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {todayLosses.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-4 text-center text-sm text-slate-400"
                    >
                      No losses today yet.
                    </td>
                  </tr>
                ) : (
                  todayLosses.map((l) => (
                    <tr key={l.loss_id} className="hover:bg-slate-50">
                      <td className="border-b border-slate-200 px-3 py-2 text-slate-600">
                        {l.loss_id}
                      </td>
                      <td className="border-b border-slate-200 px-3 py-2 text-slate-800 font-mono text-xs">
                        {itemSku(l.item_id)}
                      </td>
                      <td className="border-b border-slate-200 px-3 py-2 text-right text-slate-800">
                        {l.quantity}
                      </td>
                      <td className="border-b border-slate-200 px-3 py-2 text-right text-slate-800">
                        ₹ {Number(l.rate).toFixed(2)}
                      </td>
                      <td className="border-b border-slate-200 px-3 py-2 text-slate-800">
                        {l.reason}
                      </td>
                      <td className="border-b border-slate-200 px-3 py-2 text-right font-medium text-red-700">
                        ₹ {Number(l.total_amount).toFixed(2)}
                      </td>
                      <td className="border-b border-slate-200 px-3 py-2">
                        <button
                          onClick={() => deleteLoss(l.loss_id)}
                          className="text-xs font-medium text-red-600 hover:text-red-800 flex items-center gap-1"
                        >
                          <Trash2 className="size-3" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}