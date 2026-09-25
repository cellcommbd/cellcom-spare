'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { Save, X } from 'lucide-react'

// ---------- Types ----------
type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
}

type SaleHeader = {
  sale_id: number
  party_id: number
  bill_date: string
  total_amount: number
  status: string
}

type SaleItem = {
  detail_id: number
  sale_id: number
  item_id: number
  quantity: number
  rate: number
  amount: number
  returned_qty: number
}

type Item = {
  item_id: number
  sku: string
  current_stock: number
}

type ReturnRow = {
  rowId: number
  detail_id: number
  item_id: number
  sku: string
  original_qty: number
  already_returned: number
  rate: number
  return_qty: number
  reason: string
  is_sellable: boolean
}

type PickedShop = {
  id: number | null
  label: string
  isNew: boolean
}

const REASONS: { label: string; sellable: boolean }[] = [
  { label: 'Wrong Item', sellable: true },
  { label: 'Version Mismatch', sellable: true },
  { label: 'Costly', sellable: true },
  { label: 'Faulty', sellable: false },
  { label: 'Other', sellable: false },
]

const DEFAULT_REASON = 'Wrong Item'

// ---------- Component ----------
export default function SalesReturnPage() {
  const [shops, setShops] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [shopSales, setShopSales] = useState<SaleHeader[]>([])
  const [selectedSaleItems, setSelectedSaleItems] = useState<SaleItem[]>([])
  const [todayReturns, setTodayReturns] = useState<any[]>([])

  const [pickedShop, setPickedShop] = useState<PickedShop>({
    id: null,
    label: '',
    isNew: false,
  })
  const [pickedSaleId, setPickedSaleId] = useState<number | null>(null)
  const [returnDate, setReturnDate] = useState(
    new Date().toISOString().slice(0, 10)
  )

  const [checkedItemIds, setCheckedItemIds] = useState<number[]>([])
  const [rows, setRows] = useState<ReturnRow[]>([])
  const [nextRowId, setNextRowId] = useState(1)

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // ---------- Initial load ----------
  useEffect(() => {
    loadBase()
  }, [])

  async function loadBase() {
    const today = new Date().toISOString().slice(0, 10)
    const [s, i, r] = await Promise.all([
      supabase
        .from('parties')
        .select('*')
        .eq('party_type', 'Customer')
        .order('party_name'),
      supabase.from('items').select('item_id, sku, current_stock'),
      supabase
        .from('returns')
        .select('*')
        .eq('return_date', today)
        .eq('return_type', 'Customer')
        .order('return_id', { ascending: false }),
    ])
    setShops(s.data || [])
    setItems(i.data || [])
    setTodayReturns(r.data || [])
  }

  // ---------- Load shop sales, auto-select latest ----------
  useEffect(() => {
    if (pickedShop.id) loadShopSales(pickedShop.id)
    else {
      setShopSales([])
      setPickedSaleId(null)
      setSelectedSaleItems([])
      setCheckedItemIds([])
      setRows([])
    }
  }, [pickedShop.id])

  async function loadShopSales(shopId: number) {
    const { data } = await supabase
      .from('sales')
      .select('*')
      .eq('party_id', shopId)
      .order('bill_date', { ascending: false })
      .order('sale_id', { ascending: false })
      .limit(30)
    setShopSales(data || [])
    if (data && data.length > 0) {
      setPickedSaleId(data[0].sale_id)
    } else {
      setPickedSaleId(null)
    }
  }

  // ---------- Load sale items when bill changes ----------
  useEffect(() => {
    if (pickedSaleId) loadSaleItems(pickedSaleId)
    else {
      setSelectedSaleItems([])
      setCheckedItemIds([])
      setRows([])
    }
  }, [pickedSaleId])

  async function loadSaleItems(saleId: number) {
    const { data } = await supabase
      .from('sale_items')
      .select('*')
      .eq('sale_id', saleId)
    setSelectedSaleItems(data || [])
    setCheckedItemIds([])
    setRows([])
  }

  // ---------- Checkbox toggle ----------
  function toggleChecked(si: SaleItem) {
    const alreadyReturned = si.returned_qty || 0
    const remaining = si.quantity - alreadyReturned
    if (remaining <= 0) return

    const isChecked = checkedItemIds.includes(si.item_id)
    const item = items.find((i) => i.item_id === si.item_id)

    if (isChecked) {
      setCheckedItemIds((prev) => prev.filter((id) => id !== si.item_id))
      setRows((prev) => prev.filter((r) => r.item_id !== si.item_id))
    } else {
      setCheckedItemIds((prev) => [...prev, si.item_id])
      setRows((prev) => [
        ...prev,
        {
          rowId: nextRowId,
          detail_id: si.detail_id,
          item_id: si.item_id,
          sku: item?.sku || '—',
          original_qty: si.quantity,
          already_returned: alreadyReturned,
          rate: Number(si.rate),
          return_qty: 1,
          reason: DEFAULT_REASON,
          is_sellable: true,
        },
      ])
      setNextRowId((n) => n + 1)
    }
  }

  // ---------- Row update ----------
  function updateRow(rowId: number, patch: Partial<ReturnRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r
        const merged = { ...r, ...patch }
        if (patch.reason) {
          const reasonObj = REASONS.find((x) => x.label === patch.reason)
          if (reasonObj) merged.is_sellable = reasonObj.sellable
        }
        return merged
      })
    )
  }

  // ---------- Calculations ----------
  const totalReturnValue = rows.reduce((s, r) => s + r.return_qty * r.rate, 0)

  // ---------- Save ----------
  async function saveReturn() {
    setMessage('')

    if (!pickedShop.id) {
      setMessage('Please select a shop.')
      return
    }

    const validRows = rows.filter((r) => r.return_qty > 0 && r.item_id)
    if (validRows.length === 0) {
      setMessage('Select at least one item to return.')
      return
    }

    setSaving(true)

    // 1. Insert into returns table
    const insertRows = validRows.map((r) => ({
      party_id: pickedShop.id,
      item_id: r.item_id,
      return_date: returnDate,
      quantity: r.return_qty,
      rate: r.rate,
      total_amount: Number((r.return_qty * r.rate).toFixed(2)),
      is_sellable: r.is_sellable,
      reason: r.reason,
      return_type: 'Customer',
    }))

    const { error: returnError } = await supabase
      .from('returns')
      .insert(insertRows)

    if (returnError) {
      setMessage('Save error: ' + returnError.message)
      setSaving(false)
      return
    }

    // 2. Update sale_items.returned_qty
    for (const r of validRows) {
      const matchingSaleItem = selectedSaleItems.find(
        (si) => si.detail_id === r.detail_id
      )
      if (matchingSaleItem) {
        const newReturnedQty =
          (matchingSaleItem.returned_qty || 0) + r.return_qty
        const { error: updErr } = await supabase
          .from('sale_items')
          .update({ returned_qty: newReturnedQty })
          .eq('detail_id', matchingSaleItem.detail_id)

        if (updErr) {
          setMessage('Warning: returned_qty update failed: ' + updErr.message)
        }
      }
    }

    // 3. Reduce shop khata balance
    const shop = shops.find((s) => s.party_id === pickedShop.id)
    if (shop) {
      const newBalance = Number(shop.current_balance) - totalReturnValue
      await supabase
        .from('parties')
        .update({ current_balance: newBalance })
        .eq('party_id', pickedShop.id)
    }

    setMessage(
      `Saved return of ₹${totalReturnValue.toFixed(2)}. Shop balance reduced.`
    )

    // Reset return rows but keep shop + bill selected
    setCheckedItemIds([])
    setRows([])

    // Reload base data
    await loadBase()

    // Reload bills AND the currently selected bill's items
    // (this is the fix — so returned_qty shows updated value)
    if (pickedShop.id) {
      await loadShopSales(pickedShop.id)
    }
    if (pickedSaleId) {
      await loadSaleItems(pickedSaleId)
    }

    setSaving(false)
  }

  function resetForm() {
    setPickedShop({ id: null, label: '', isNew: false })
    setPickedSaleId(null)
    setSelectedSaleItems([])
    setShopSales([])
    setCheckedItemIds([])
    setRows([])
    setReturnDate(new Date().toISOString().slice(0, 10))
    setMessage('')
  }

  const shopName = (id: number) =>
    shops.find((s) => s.party_id === id)?.party_name || '—'

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">

        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Sales Return</h1>
            <p className="text-sm text-gray-500">
              Pick a shop, check items to return, set reason and qty. Sellable → back to stock. Faulty → faulty list.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Return Date
            </label>
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="bg-white border border-gray-300 rounded p-6 mb-6 shadow-sm">

          {/* HEADER */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Shop
              </label>
              <SmartCombobox
                options={shops.map((s) => ({
                  value: s.party_id,
                  label: s.party_name,
                }))}
                value={
                  pickedShop.id
                    ? String(pickedShop.id)
                    : pickedShop.isNew
                    ? `__new__${pickedShop.label}`
                    : null
                }
                onValueChange={(v, label, isNew) =>
                  setPickedShop({
                    id: isNew ? null : Number(v),
                    label,
                    isNew,
                  })
                }
                placeholder="Select or type shop..."
                inputDataAttr="return-shop"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Original Bill (defaults to latest)
              </label>
              <select
                value={pickedSaleId || ''}
                onChange={(e) =>
                  setPickedSaleId(e.target.value ? Number(e.target.value) : null)
                }
                disabled={!pickedShop.id || shopSales.length === 0}
                className="w-full h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">
                  {!pickedShop.id
                    ? '— Select a shop first —'
                    : shopSales.length === 0
                    ? '— No recent sales —'
                    : '— Select a bill —'}
                </option>
                {shopSales.map((s) => (
                  <option key={s.sale_id} value={s.sale_id}>
                    #{s.sale_id} · {s.bill_date} · ₹{Number(s.total_amount).toFixed(2)} · {s.status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ITEMS IN BILL — CHECKBOX LIST */}
          {pickedSaleId && (
            <>
              {selectedSaleItems.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-gray-400 border border-gray-200 rounded mb-6">
                  No items in this bill.
                </div>
              ) : (
                <div className="mb-6">
                  <div className="text-xs font-medium text-gray-600 mb-2">
                    Items in this bill — check the ones you want to return:
                  </div>
                  <div className="border border-gray-300 rounded divide-y divide-gray-200">
                    {selectedSaleItems.map((si) => {
                      const item = items.find((i) => i.item_id === si.item_id)
                      const returned = si.returned_qty || 0
                      const remaining = si.quantity - returned
                      const fullyReturned = remaining <= 0
                      const checked = checkedItemIds.includes(si.item_id)
                      return (
                        <label
                          key={si.detail_id}
                          className={`flex items-center gap-3 px-3 py-2 ${
                            fullyReturned
                              ? 'bg-gray-100 opacity-70 cursor-not-allowed'
                              : checked
                              ? 'bg-blue-50 cursor-pointer'
                              : 'hover:bg-gray-50 cursor-pointer'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={fullyReturned}
                            onChange={() => toggleChecked(si)}
                            className="size-4 accent-blue-600"
                          />
                          <span className="flex-1 font-mono text-sm text-gray-800">
                            {item?.sku || '—'}
                          </span>
                          <span className="text-xs text-gray-500">
                            Qty: {si.quantity}
                            {returned > 0 && (
                              <span className="ml-2 text-orange-700">
                                · returned: {returned} · left: {remaining}
                              </span>
                            )}
                          </span>
                          <span className="text-sm text-gray-600 w-24 text-right">
                            ₹ {Number(si.rate).toFixed(2)}
                          </span>
                          {fullyReturned && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-800">
                              Fully Returned
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* SELECTED ITEMS — DETAIL GRID */}
          {rows.length > 0 && (
            <div className="mb-6">
              <div className="text-xs font-medium text-gray-600 mb-2">
                Items to return ({rows.length}):
              </div>
              <div className="border border-gray-300 rounded overflow-visible">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="w-10 border-b border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-600">#</th>
                      <th className="border-b border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-600">Item</th>
                      <th className="w-20 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">Bill Qty</th>
                      <th className="w-20 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">Already Ret.</th>
                      <th className="w-24 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">Rate</th>
                      <th className="w-24 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">Return Qty</th>
                      <th className="w-40 border-b border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-600">Reason</th>
                      <th className="w-20 border-b border-gray-300 px-2 py-2 text-center text-xs font-semibold text-gray-600">Sellable?</th>
                      <th className="w-28 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const amount = row.return_qty * row.rate
                      const maxQty = row.original_qty - row.already_returned
                      return (
                        <tr key={row.rowId} className="border-b border-gray-200">
                          <td className="px-2 py-1 text-center text-gray-500 text-xs">{idx + 1}</td>
                          <td className="px-2 py-1 text-gray-800 font-mono text-xs">{row.sku}</td>
                          <td className="px-2 py-1 text-right text-gray-600">{row.original_qty}</td>
                          <td className="px-2 py-1 text-right text-orange-700">
                            {row.already_returned > 0 ? row.already_returned : '—'}
                          </td>
                          <td className="px-2 py-1 text-right text-gray-800">₹ {row.rate.toFixed(2)}</td>
                          <td className="px-2 py-1">
                            <input
                              type="number"
                              value={row.return_qty || ''}
                              onChange={(e) =>
                                updateRow(row.rowId, {
                                  return_qty: Math.min(
                                    parseFloat(e.target.value) || 0,
                                    maxQty
                                  ),
                                })
                              }
                              max={maxQty}
                              min={1}
                              className="w-full h-8 px-2 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <select
                              value={row.reason}
                              onChange={(e) =>
                                updateRow(row.rowId, { reason: e.target.value })
                              }
                              className="w-full h-8 px-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              {REASONS.map((r) => (
                                <option key={r.label} value={r.label}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1 text-center">
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded ${
                                row.is_sellable
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {row.is_sellable ? 'Yes' : 'No'}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-right font-medium text-gray-800">
                            ₹ {amount.toFixed(2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex justify-end">
                <div className="bg-blue-50 border border-blue-200 rounded px-4 py-2 text-sm">
                  <span className="text-gray-700">Total Return Value: </span>
                  <span className="font-bold text-blue-800">
                    ₹ {totalReturnValue.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ACTIONS */}
          <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={saveReturn}
              disabled={saving || rows.length === 0 || totalReturnValue === 0}
              className="h-10 px-6 text-sm font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Save className="size-4" />
              {saving ? 'Saving...' : 'Save Return'}
            </button>
            <button
              onClick={resetForm}
              className="h-10 px-4 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-2"
            >
              <X className="size-4" />
              Clear
            </button>
            {message && <div className="text-sm text-gray-700">{message}</div>}
          </div>
        </div>

        {/* TODAY'S RETURNS */}
        <div className="bg-white border border-gray-300 rounded shadow-sm">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-300">
            <span className="text-sm font-semibold text-gray-700">
              Today's Returns ({todayReturns.length})
            </span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="w-16 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">ID</th>
                <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Shop</th>
                <th className="w-40 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Reason</th>
                <th className="w-20 border-b border-gray-300 px-3 py-2 text-center text-xs font-semibold text-gray-600">Sellable</th>
                <th className="w-28 border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Amount</th>
              </tr>
            </thead>
            <tbody>
              {todayReturns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-gray-400">
                    No returns today yet.
                  </td>
                </tr>
              ) : (
                todayReturns.map((r: any) => (
                  <tr key={r.return_id} className="hover:bg-gray-50">
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-600">{r.return_id}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{shopName(r.party_id)}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{r.reason || '—'}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-center">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded ${
                          r.is_sellable
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {r.is_sellable ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="border-b border-gray-200 px-3 py-2 text-right font-medium text-gray-800">
                      ₹ {Number(r.total_amount).toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}