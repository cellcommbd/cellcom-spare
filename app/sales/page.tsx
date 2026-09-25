'use client'

import { useEffect, useRef, useState, createRef } from 'react'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { Plus, Trash2, Save, X } from 'lucide-react'
import { getRole } from '../../lib/auth'

type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
}

type Item = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
  selling_price: number
}

type SaleRow = {
  rowId: number
  item_id: number | null
  sku: string
  quantity: number
  rate: number
  amount: number
}

type SaleHeader = {
  sale_id: number
  party_id: number
  bill_date: string
  total_amount: number
  status: string
  entry_date?: string
}

type PickedShop = {
  id: number | null
  label: string
  isNew: boolean
}

export default function SalesEntryPage() {
  const [shops, setShops] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [todaySales, setTodaySales] = useState<SaleHeader[]>([])
  const [isOwner, setIsOwner] = useState(false)

  const [pickedShop, setPickedShop] = useState<PickedShop>({
    id: null,
    label: '',
    isNew: false,
  })
  const [billDate, setBillDate] = useState(
    new Date().toISOString().slice(0, 10)
  )

  const [rows, setRows] = useState<SaleRow[]>([
    { rowId: 1, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
  ])
  const [nextRowId, setNextRowId] = useState(2)

  // Focus the newly-added row after render
  const [pendingFocusRowId, setPendingFocusRowId] = useState<number | null>(
    null
  )
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

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
    setIsOwner(getRole() === 'owner')
    loadData()
  }, [])

  useEffect(() => {
    if (pendingFocusRowId == null) return
    const el = itemRefs.current[pendingFocusRowId]?.current
    if (el) {
      el.focus()
      setPendingFocusRowId(null)
    }
  }, [pendingFocusRowId, rows])

  async function loadData() {
    const today = new Date().toISOString().slice(0, 10)
    const [s, i, t] = await Promise.all([
      supabase
        .from('parties')
        .select('*')
        .eq('party_type', 'Customer')
        .order('party_name'),
      supabase.from('items').select('*').order('sku'),
      supabase
        .from('sales')
        .select('*')
        .eq('bill_date', today)
        .order('sale_id', { ascending: false }),
    ])
    setShops(s.data || [])
    setItems(i.data || [])
    setTodaySales(t.data || [])
  }

  const shopOptions = shops.map((s) => ({
    value: s.party_id,
    label: s.party_name,
  }))

  const itemOptions = items.map((it) => ({
    value: it.item_id,
    label: `${it.sku}  ·  stock: ${it.current_stock}  ·  sp: ₹${Number(it.selling_price).toFixed(2)}`,
  }))

  const prevBalance =
    shops.find((s) => s.party_id === pickedShop.id)?.current_balance || 0

  function addRow(): number {
    const newId = nextRowId
    setRows((prev) => [
      ...prev,
      { rowId: newId, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
    ])
    setNextRowId((n) => n + 1)
    setPendingFocusRowId(newId)
    return newId
  }

  function removeRow(rowId: number) {
    if (rows.length === 1) {
      setRows([
        { rowId: 1, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
      ])
      return
    }
    setRows(rows.filter((r) => r.rowId !== rowId))
  }

  function updateRow(rowId: number, patch: Partial<SaleRow>) {
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
    const item = items.find((i) => i.item_id === itemId)
    if (!item) return

    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r
        return {
          ...r,
          item_id: item.item_id,
          sku: item.sku,
          rate: item.selling_price,
          amount: Number(r.quantity) * Number(item.selling_price),
        }
      })
    )
  }

  function handleItemTab(row: SaleRow, idx: number) {
    const isLastRow = idx === rows.length - 1
    if (!isLastRow) return

    if (row.item_id) {
      addRow()
    } else {
      const saveBtn = document.getElementById('save-sale-btn')
      saveBtn?.focus()
    }
  }

  function handleRateTab(
    rowId: number,
    idx: number,
    e: React.KeyboardEvent
  ) {
    const isLastRow = idx === rows.length - 1
    if (!isLastRow) return
    const row = rows[idx]
    if (row.item_id) {
      e.preventDefault()
      addRow()
    } else {
      e.preventDefault()
      const saveBtn = document.getElementById('save-sale-btn')
      saveBtn?.focus()
    }
  }

  const subtotal = rows.reduce((s, r) => s + (r.amount || 0), 0)

  async function ensureShop(): Promise<number | null> {
    if (pickedShop.isNew && pickedShop.label) {
      const { data, error } = await supabase
        .from('parties')
        .insert({
          party_name: pickedShop.label,
          party_type: 'Customer',
          current_balance: 0,
        })
        .select()
        .single()
      if (error) {
        setMessage('Shop error: ' + error.message)
        return null
      }
      return data.party_id
    }
    return pickedShop.id
  }

  async function saveSale() {
    setMessage('')

    if (!pickedShop.label) {
      setMessage('Please select or enter a Shop.')
      return
    }

    const validRows = rows.filter(
      (r) => r.item_id && r.quantity > 0 && r.rate > 0
    )
    if (validRows.length === 0) {
      setMessage('Add at least one item with quantity and rate.')
      return
    }

    setSaving(true)

    const shopId = await ensureShop()
    if (!shopId) {
      setSaving(false)
      return
    }

    const { data: saleData, error: saleError } = await supabase
      .from('sales')
      .insert({
        party_id: shopId,
        bill_date: billDate,
        total_amount: subtotal,
        status: 'Pending',
      })
      .select()
      .single()

    if (saleError || !saleData) {
      setMessage('Save error: ' + (saleError?.message || 'unknown'))
      setSaving(false)
      return
    }

    const saleId = saleData.sale_id

    const lineInserts = validRows.map((r) => {
      const item = items.find((i) => i.item_id === r.item_id)
      return {
        sale_id: saleId,
        item_id: r.item_id,
        quantity: r.quantity,
        rate: r.rate,
        amount: Number((r.rate * r.quantity).toFixed(2)),
        cost_at_sale: item ? item.cost_price : 0,
      }
    })

    const { error: linesError } = await supabase
      .from('sale_items')
      .insert(lineInserts)

    if (linesError) {
      await supabase.from('sales').delete().eq('sale_id', saleId)
      setMessage('Save error: ' + linesError.message)
      setSaving(false)
      return
    }

    await supabase
      .from('parties')
      .update({ current_balance: prevBalance + subtotal })
      .eq('party_id', shopId)

    setMessage(`Saved sale #${saleId}. Stock decreased.`)

    setPickedShop({ id: null, label: '', isNew: false })
    setRows([
      { rowId: 1, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
    ])
    setNextRowId(2)
    await loadData()

    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[data-row-item="shop-input"]'
      )
      el?.focus()
    }, 100)

    setSaving(false)
  }

  function resetForm() {
    setPickedShop({ id: null, label: '', isNew: false })
    setRows([
      { rowId: 1, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
    ])
    setNextRowId(2)
    setMessage('')
  }

  async function deleteSale(id: number) {
    if (!confirm(`Delete sale #${id}? Stock will go back up.`)) return

    const sale = todaySales.find((s) => s.sale_id === id)
    if (sale) {
      const shop = shops.find((s) => s.party_id === sale.party_id)
      if (shop) {
        await supabase
          .from('parties')
          .update({ current_balance: shop.current_balance - sale.total_amount })
          .eq('party_id', shop.party_id)
      }
    }

    await supabase.from('sale_items').delete().eq('sale_id', id)
    const { error } = await supabase.from('sales').delete().eq('sale_id', id)

    if (error) setMessage('Delete error: ' + error.message)
    else {
      setMessage('Deleted sale #' + id)
      await loadData()
    }
  }

  const shopName = (id: number) =>
    shops.find((s) => s.party_id === id)?.party_name || '—'

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">
            Sales Entry
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            One bill at a time. Save → form clears → next shop.
          </p>
        </div>

        {/* ============ MOBILE VIEW ============ */}
        <div className="md:hidden space-y-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Shop
              </label>
              <SmartCombobox
                options={shopOptions}
                value={
                  pickedShop.id
                    ? String(pickedShop.id)
                    : pickedShop.isNew
                    ? `__new__${pickedShop.label}`
                    : null
                }
                onValueChange={(v: string, label: string, isNew: boolean) =>
                  setPickedShop({
                    id: isNew ? null : Number(v),
                    label,
                    isNew,
                  })
                }
                placeholder="Select or type shop..."
                inputDataAttr="shop-input"
                focusNextOnSelect={true}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prev Balance
                </label>
                <div className="w-full h-11 px-3 flex items-center text-sm font-medium bg-red-50 border border-red-200 rounded-lg text-red-700">
                  ₹ {Number(prevBalance).toFixed(2)}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Subtotal
                </label>
                <div className="w-full h-11 px-3 flex items-center text-sm font-bold bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
                  ₹ {subtotal.toFixed(2)}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Bill Date
              </label>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="w-full h-11 px-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>

          <div className="space-y-3">
            {rows.map((row, idx) => (
              <div
                key={row.rowId}
                className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-slate-500">
                    Item #{idx + 1}
                  </div>
                  <button
                    onClick={() => removeRow(row.rowId)}
                    className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <SmartCombobox
                  options={itemOptions}
                  value={row.item_id ? String(row.item_id) : null}
                  onValueChange={(
                    v: string,
                    label: string,
                    isNew: boolean
                  ) => {
                    if (isNew) return
                    handleItemSelect(row.rowId, Number(v))
                  }}
                  onTabKey={() => handleItemTab(row, idx)}
                  placeholder="Search SKU..."
                  allowCreate={false}
                  inputDataAttr={`row-${row.rowId}`}
                  focusNextOnSelect={true}
                />
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">
                      Qty
                    </label>
                    <input
                      data-qty-row={`qty-${row.rowId}`}
                      data-focus-next={`row-${row.rowId}`}
                      ref={(el) => {
                        qtyRefs.current[row.rowId] = el
                      }}
                      type="number"
                      value={row.quantity || ''}
                      onChange={(e) =>
                        updateRow(row.rowId, {
                          quantity: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">
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
                      className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <span className="text-xs text-slate-500">Amount</span>
                  <span className="text-base font-bold text-slate-800">
                    ₹ {row.amount.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}

            <button
              onClick={addRow}
              className="w-full h-12 text-sm font-medium text-blue-600 border-2 border-dashed border-blue-200 rounded-xl hover:bg-blue-50 flex items-center justify-center gap-1"
            >
              <Plus className="size-4" />
              Add Item
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Items Subtotal</span>
              <span className="font-medium text-slate-800">
                ₹ {subtotal.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Previous Balance</span>
              <span className="font-medium text-red-600">
                ₹ {Number(prevBalance).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-base border-t border-slate-200 pt-2">
              <span className="font-semibold text-slate-800">Total Due</span>
              <span className="font-bold text-slate-900">
                ₹ {(prevBalance + subtotal).toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              id="save-sale-btn"
              onClick={saveSale}
              disabled={saving}
              className="flex-1 h-12 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              <Save className="size-4" />
              {saving ? 'Saving...' : 'Save Sale'}
            </button>
            <button
              onClick={resetForm}
              className="h-12 px-4 text-sm text-slate-700 border border-slate-300 rounded-xl hover:bg-slate-50 flex items-center justify-center"
            >
              <X className="size-4" />
            </button>
          </div>

          {message && (
            <div className="text-sm text-slate-700 bg-white border border-slate-200 rounded-lg p-3">
              {message}
            </div>
          )}
        </div>

        {/* ============ DESKTOP VIEW ============ */}
        <div className="hidden md:block">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-xl font-semibold text-slate-700">
              Bill Details
            </h2>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Bill Date
              </label>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Shop
                </label>
                <SmartCombobox
                  options={shopOptions}
                  value={
                    pickedShop.id
                      ? String(pickedShop.id)
                      : pickedShop.isNew
                      ? `__new__${pickedShop.label}`
                      : null
                  }
                  onValueChange={(
                    v: string,
                    label: string,
                    isNew: boolean
                  ) =>
                    setPickedShop({
                      id: isNew ? null : Number(v),
                      label,
                      isNew,
                    })
                  }
                  placeholder="Select or type shop..."
                  inputDataAttr="shop-input"
                  focusNextOnSelect={true}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Previous Balance
                </label>
                <div className="w-full h-9 px-3 flex items-center text-sm font-medium bg-red-50 border border-red-200 rounded-lg text-red-700">
                  ₹ {Number(prevBalance).toFixed(2)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Bill Subtotal
                </label>
                <div className="w-full h-9 px-3 flex items-center text-sm font-bold bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
                  ₹ {subtotal.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg">
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
                          onValueChange={(
                            v: string,
                            label: string,
                            isNew: boolean
                          ) => {
                            if (isNew) return
                            handleItemSelect(row.rowId, Number(v))
                          }}
                          onTabKey={() => handleItemTab(row, idx)}
                          placeholder="Search SKU..."
                          allowCreate={false}
                          inputDataAttr={`row-${row.rowId}`}
                          focusNextOnSelect={true}
                          inputRef={getItemRef(row.rowId)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          data-qty-row={`qty-${row.rowId}`}
                          data-focus-next={`row-${row.rowId}`}
                          ref={(el) => {
                            qtyRefs.current[row.rowId] = el
                          }}
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
                          onKeyDown={(e) => {
                            if (e.key === 'Tab')
                              handleRateTab(row.rowId, idx, e)
                          }}
                          className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-2 py-1 text-right font-medium text-slate-800">
                        ₹ {row.amount.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          onClick={() => removeRow(row.rowId)}
                          className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
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

            <div className="mt-6">
              <div className="ml-auto max-w-md space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Items Subtotal:</span>
                  <span className="font-medium text-slate-800">
                    ₹ {subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Previous Balance:</span>
                  <span className="font-medium text-red-600">
                    ₹ {Number(prevBalance).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-base border-t border-slate-300 pt-2">
                  <span className="font-semibold text-slate-800">Total Due:</span>
                  <span className="font-bold text-slate-900">
                    ₹ {(prevBalance + subtotal).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-200">
              <button
                id="save-sale-btn"
                onClick={saveSale}
                disabled={saving}
                className="h-10 px-6 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="size-4" />
                {saving ? 'Saving...' : 'Save Sale'}
              </button>
              <button
                onClick={resetForm}
                className="h-10 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2"
              >
                <X className="size-4" />
                Clear
              </button>
              {message && (
                <div className="text-sm text-slate-700 ml-2">{message}</div>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-700">
                Today's Sales ({todaySales.length})
              </span>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="w-16 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">Bill #</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">Shop</th>
                  <th className="w-28 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">Amount</th>
                  <th className="w-24 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">Action</th>
                </tr>
              </thead>
              <tbody>
                {todaySales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-400">
                      No sales today yet.
                    </td>
                  </tr>
                ) : (
                  todaySales.map((s) => (
                    <tr key={s.sale_id} className="hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-600">{s.sale_id}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-800">{shopName(s.party_id)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-medium text-slate-800">
                        ₹ {Number(s.total_amount).toFixed(2)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        {(isOwner ||
                          s.entry_date?.slice(0, 10) ===
                            new Date().toISOString().slice(0, 10)) && (
                          <button
                            onClick={() => deleteSale(s.sale_id)}
                            className="text-xs font-medium text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                        )}
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