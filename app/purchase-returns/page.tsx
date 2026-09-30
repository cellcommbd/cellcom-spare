'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SmartCombobox } from '@/components/ui/smart-combobox'
import { ImportCSVDialog } from '@/components/ui/ImportCSVDialog'
import { ParsedRow } from '@/lib/csv-parser'
import { Save, X, Upload } from 'lucide-react'

// ---------- Types ----------
type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
}

type PurchaseHeader = {
  purchase_id: number
  party_id: number
  invoice_no: string
  purchase_date: string
  total_amount: number
}

type PurchaseItem = {
  detail_id: number
  purchase_id: number
  item_id: number
  quantity: number
  rate: number
  amount: number
  returned_qty?: number
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
  source: 'manual' | 'csv'
}

type PickedSupplier = {
  id: number | null
  label: string
  isNew: boolean
}

const REASONS = [
  'Wrong Item Received',
  'Excess Quantity',
  'Quality Issue',
  'Other',
]

const DEFAULT_REASON = 'Wrong Item Received'

// ---------- Component ----------
export default function PurchaseReturnPage() {
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [supplierPurchases, setSupplierPurchases] = useState<PurchaseHeader[]>([])
  const [selectedPurchaseItems, setSelectedPurchaseItems] = useState<PurchaseItem[]>([])
  const [todayReturns, setTodayReturns] = useState<any[]>([])

  const [pickedSupplier, setPickedSupplier] = useState<PickedSupplier>({
    id: null,
    label: '',
    isNew: false,
  })
  const [pickedPurchaseId, setPickedPurchaseId] = useState<number | null>(null)
  const [returnDate, setReturnDate] = useState(
    new Date().toISOString().slice(0, 10)
  )

  const [checkedItemIds, setCheckedItemIds] = useState<number[]>([])
  const [rows, setRows] = useState<ReturnRow[]>([])
  const [nextRowId, setNextRowId] = useState(1)

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showImport, setShowImport] = useState(false)

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
        .eq('party_type', 'Supplier')
        .order('party_name'),
      supabase.from('items').select('item_id, sku, current_stock'),
      supabase
        .from('returns')
        .select('*')
        .eq('return_date', today)
        .eq('return_type', 'Supplier')
        .order('return_id', { ascending: false }),
    ])
    setSuppliers(s.data || [])
    setItems(i.data || [])
    setTodayReturns(r.data || [])
  }

  // ---------- Load supplier purchases ----------
  useEffect(() => {
    if (pickedSupplier.id) loadSupplierPurchases(pickedSupplier.id)
    else {
      setSupplierPurchases([])
      setPickedPurchaseId(null)
      setSelectedPurchaseItems([])
      setCheckedItemIds([])
      setRows([])
    }
  }, [pickedSupplier.id])

  async function loadSupplierPurchases(supplierId: number) {
    const { data } = await supabase
      .from('purchases')
      .select('*')
      .eq('party_id', supplierId)
      .order('purchase_date', { ascending: false })
      .order('purchase_id', { ascending: false })
      .limit(30)
    setSupplierPurchases(data || [])
    if (data && data.length > 0) setPickedPurchaseId(data[0].purchase_id)
    else setPickedPurchaseId(null)
  }

  // ---------- Load purchase items ----------
  useEffect(() => {
    if (pickedPurchaseId) loadPurchaseItems(pickedPurchaseId)
    else {
      setSelectedPurchaseItems([])
      setCheckedItemIds([])
      setRows([])
    }
  }, [pickedPurchaseId])

  async function loadPurchaseItems(purchaseId: number) {
    const { data: piData } = await supabase
      .from('purchase_items')
      .select('*')
      .eq('purchase_id', purchaseId)

    const lines = piData || []
    if (lines.length === 0) {
      setSelectedPurchaseItems([])
      setCheckedItemIds([])
      setRows([])
      return
    }

    const itemIds = lines.map((pi) => pi.item_id)
    const { data: priorReturns } = await supabase
      .from('returns')
      .select('item_id, quantity')
      .in('item_id', itemIds)
      .eq('return_type', 'Supplier')
      .eq('party_id', pickedSupplier.id)

    const returnedByItem: Record<number, number> = {}
    for (const r of priorReturns || []) {
      returnedByItem[r.item_id] =
        (returnedByItem[r.item_id] || 0) + Number(r.quantity)
    }

    const enriched: PurchaseItem[] = lines.map((pi) => ({
      ...pi,
      returned_qty: returnedByItem[pi.item_id] || 0,
    }))

    setSelectedPurchaseItems(enriched)
    setCheckedItemIds([])
    setRows([])
  }

  // ---------- Checkbox toggle (manual flow) ----------
  function toggleChecked(pi: PurchaseItem) {
    const alreadyReturned = pi.returned_qty || 0
    const remaining = pi.quantity - alreadyReturned
    if (remaining <= 0) return

    const isChecked = checkedItemIds.includes(pi.item_id)
    const item = items.find((i) => i.item_id === pi.item_id)

    if (isChecked) {
      setCheckedItemIds((prev) => prev.filter((id) => id !== pi.item_id))
      setRows((prev) =>
        prev.filter((r) => !(r.item_id === pi.item_id && r.source === 'manual'))
      )
    } else {
      setCheckedItemIds((prev) => [...prev, pi.item_id])
      setRows((prev) => [
        ...prev,
        {
          rowId: nextRowId,
          detail_id: pi.detail_id,
          item_id: pi.item_id,
          sku: item?.sku || '—',
          original_qty: pi.quantity,
          already_returned: alreadyReturned,
          rate: Number(pi.rate),
          return_qty: 1,
          reason: DEFAULT_REASON,
          source: 'manual',
        },
      ])
      setNextRowId((n) => n + 1)
    }
  }

  // ---------- CSV import (CN) ----------
  function handleCNImport(
    matched: ParsedRow[],
    newItems: ParsedRow[],
    _margin: number
  ) {
    setMessage('')

    // Returns can only use existing items — skip "new" rows.
    const usableMatched = matched.filter(
      (r) => r.matchedItemId && r.matchedItemSku
    )

    if (usableMatched.length === 0) {
      setMessage(
        'No matched items in CSV. Returns can only use items that already exist.'
      )
      return
    }

    let nextId = nextRowId
    const newRows: ReturnRow[] = []
    const newChecked: number[] = []

    for (const r of usableMatched) {
      const item_id = r.matchedItemId!
      const sku = r.matchedItemSku!
      // Check local items table for the sku (fallback to parsed)
      const localItem = items.find((i) => i.item_id === item_id)

      newRows.push({
        rowId: nextId++,
        detail_id: 0, // no invoice link from CSV
        item_id,
        sku: localItem?.sku || sku,
        original_qty: 0, // unknown for CSV-imported rows
        already_returned: 0,
        rate: r.rate,
        return_qty: r.qty,
        reason: DEFAULT_REASON,
        source: 'csv',
      })
      if (!newChecked.includes(item_id)) newChecked.push(item_id)
    }

    setRows((prev) => [...prev, ...newRows])
    setNextRowId(nextId)
    setCheckedItemIds((prev) => [...prev, ...newChecked.filter((id) => !prev.includes(id))])

    const skipped = newItems.length
    if (skipped > 0) {
      setMessage(
        `Imported ${newRows.length} rows. ${skipped} row(s) skipped (items not in DB — returns can only use existing items).`
      )
    } else {
      setMessage(`Imported ${newRows.length} rows from CN. Review and click Save Return.`)
    }
  }

  function updateRow(rowId: number, patch: Partial<ReturnRow>) {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r))
    )
  }

  function removeRow(rowId: number) {
    const row = rows.find((r) => r.rowId === rowId)
    setRows((prev) => prev.filter((r) => r.rowId !== rowId))
    if (row) {
      setCheckedItemIds((prev) => prev.filter((id) => id !== row.item_id))
    }
  }

  const totalReturnValue = rows.reduce((s, r) => s + r.return_qty * r.rate, 0)

  // ---------- Save ----------
  async function saveReturn() {
    setMessage('')
    if (!pickedSupplier.id) return setMessage('Please select a supplier.')

    const validRows = rows.filter((r) => r.return_qty > 0 && r.item_id)
    if (validRows.length === 0) return setMessage('Select at least one item.')

    setSaving(true)

    const insertRows = validRows.map((r) => ({
      party_id: pickedSupplier.id,
      item_id: r.item_id,
      return_date: returnDate,
      quantity: r.return_qty,
      rate: r.rate,
      total_amount: Number((r.return_qty * r.rate).toFixed(2)),
      is_sellable: false,
      reason: r.reason,
      return_type: 'Supplier',
    }))

    const { error: returnError } = await supabase
      .from('returns')
      .insert(insertRows)

    if (returnError) {
      setMessage('Save error: ' + returnError.message)
      setSaving(false)
      return
    }

    const supplier = suppliers.find((s) => s.party_id === pickedSupplier.id)
    if (supplier) {
      const newBalance = Number(supplier.current_balance) - totalReturnValue
      await supabase
        .from('parties')
        .update({ current_balance: newBalance })
        .eq('party_id', pickedSupplier.id)
    }

    setMessage(`Saved return of ₹${totalReturnValue.toFixed(2)}.`)

    setCheckedItemIds([])
    setRows([])
    await loadBase()
    if (pickedSupplier.id) await loadSupplierPurchases(pickedSupplier.id)
    if (pickedPurchaseId) await loadPurchaseItems(pickedPurchaseId)

    setSaving(false)
  }

  function resetForm() {
    setPickedSupplier({ id: null, label: '', isNew: false })
    setPickedPurchaseId(null)
    setSelectedPurchaseItems([])
    setSupplierPurchases([])
    setCheckedItemIds([])
    setRows([])
    setReturnDate(new Date().toISOString().slice(0, 10))
    setMessage('')
  }

  const supplierName = (id: number) =>
    suppliers.find((s) => s.party_id === id)?.party_name || '—'

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">

        <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Purchase Return</h1>
            <p className="text-sm text-gray-500">
              Send items back to supplier. Stock decreases and supplier balance reduces.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Return Date</label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="h-10 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={() => setShowImport(true)}
              disabled={!pickedSupplier.id}
              title={!pickedSupplier.id ? 'Select a supplier first' : 'Import CN CSV'}
              className="h-10 px-4 text-sm font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Upload className="size-4" />
              Import CN
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-300 rounded p-4 sm:p-6 mb-6 shadow-sm">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
              <SmartCombobox
                options={suppliers.map((s) => ({ value: s.party_id, label: s.party_name }))}
                value={
                  pickedSupplier.id
                    ? String(pickedSupplier.id)
                    : pickedSupplier.isNew
                    ? `__new__${pickedSupplier.label}`
                    : null
                }
                onValueChange={(v, label, isNew) =>
                  setPickedSupplier({ id: isNew ? null : Number(v), label, isNew })
                }
                placeholder="Select or type supplier..."
                inputDataAttr="preturn-supplier"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Original Invoice (for manual entry — optional)
              </label>
              <select
                value={pickedPurchaseId || ''}
                onChange={(e) =>
                  setPickedPurchaseId(e.target.value ? Number(e.target.value) : null)
                }
                disabled={!pickedSupplier.id || supplierPurchases.length === 0}
                className="w-full h-10 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">
                  {!pickedSupplier.id
                    ? '— Select a supplier first —'
                    : supplierPurchases.length === 0
                    ? '— No recent purchases —'
                    : '— Select an invoice —'}
                </option>
                {supplierPurchases.map((p) => (
                  <option key={p.purchase_id} value={p.purchase_id}>
                    #{p.purchase_id} · {p.purchase_date} · Inv: {p.invoice_no || '—'} · ₹{Number(p.total_amount).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {pickedPurchaseId && (
            <>
              {selectedPurchaseItems.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-gray-400 border border-gray-200 rounded mb-6">
                  No items in this purchase.
                </div>
              ) : (
                <div className="mb-6">
                  <div className="text-xs font-medium text-gray-600 mb-2">
                    Items in this invoice — check the ones you want to return:
                  </div>
                  <div className="border border-gray-300 rounded divide-y divide-gray-200 max-h-72 overflow-y-auto">
                    {selectedPurchaseItems.map((pi) => {
                      const item = items.find((i) => i.item_id === pi.item_id)
                      const returned = pi.returned_qty || 0
                      const remaining = pi.quantity - returned
                      const fullyReturned = remaining <= 0
                      const checked = checkedItemIds.includes(pi.item_id)
                      return (
                        <label
                          key={pi.detail_id}
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
                            onChange={() => toggleChecked(pi)}
                            className="size-4 accent-blue-600"
                          />
                          <span className="flex-1 font-mono text-sm text-gray-800">
                            {item?.sku || '—'}
                          </span>
                          <span className="text-xs text-gray-500">
                            Qty: {pi.quantity}
                            {returned > 0 && (
                              <span className="ml-2 text-orange-700">
                                · returned: {returned} · left: {remaining}
                              </span>
                            )}
                          </span>
                          <span className="text-sm text-gray-600 w-24 text-right">
                            ₹ {Number(pi.rate).toFixed(2)}
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

          {rows.length > 0 && (
            <div className="mb-6">
              <div className="text-xs font-medium text-gray-600 mb-2">
                Items to return ({rows.length}):
              </div>
              <div className="border border-gray-300 rounded overflow-x-auto">
                <table className="w-full border-collapse text-sm min-w-[720px]">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="w-10 border-b border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-600">#</th>
                      <th className="border-b border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-600">Item</th>
                      <th className="w-20 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">Inv Qty</th>
                      <th className="w-20 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">Already Ret.</th>
                      <th className="w-24 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">Rate</th>
                      <th className="w-24 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">Return Qty</th>
                      <th className="w-44 border-b border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-600">Reason</th>
                      <th className="w-24 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">Amount</th>
                      <th className="w-10 border-b border-gray-300 px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const amount = row.return_qty * row.rate
                      const isCsv = row.source === 'csv'
                      const maxQty = row.original_qty - row.already_returned
                      const hasMax = maxQty > 0
                      return (
                        <tr key={row.rowId} className={`border-b border-gray-200 ${isCsv ? 'bg-emerald-50/40' : ''}`}>
                          <td className="px-2 py-1 text-center text-gray-500 text-xs">{idx + 1}</td>
                          <td className="px-2 py-1 text-gray-800 font-mono text-xs">{row.sku}</td>
                          <td className="px-2 py-1 text-right text-gray-600">
                            {isCsv ? '—' : row.original_qty}
                          </td>
                          <td className="px-2 py-1 text-right text-orange-700">
                            {isCsv ? '—' : row.already_returned > 0 ? row.already_returned : '—'}
                          </td>
                          <td className="px-2 py-1 text-right text-gray-800">₹ {row.rate.toFixed(2)}</td>
                          <td className="px-2 py-1">
                            <input
                              type="number"
                              value={row.return_qty || ''}
                              onChange={(e) =>
                                updateRow(row.rowId, {
                                  return_qty: hasMax
                                    ? Math.min(parseFloat(e.target.value) || 0, maxQty)
                                    : parseFloat(e.target.value) || 0,
                                })
                              }
                              max={hasMax ? maxQty : undefined}
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
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1 text-right font-medium text-gray-800">
                            ₹ {amount.toFixed(2)}
                          </td>
                          <td className="px-2 py-1 text-center">
                            <button
                              onClick={() => removeRow(row.rowId)}
                              className="text-red-500 hover:text-red-700"
                              title="Remove row"
                            >
                              <X className="size-3.5" />
                            </button>
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

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-4 border-t border-gray-200">
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

        <div className="bg-white border border-gray-300 rounded shadow-sm overflow-x-auto">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-300">
            <span className="text-sm font-semibold text-gray-700">
              Today's Supplier Returns ({todayReturns.length})
            </span>
          </div>
          <table className="w-full border-collapse text-sm min-w-[600px]">
            <thead>
              <tr className="bg-gray-100">
                <th className="w-16 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">ID</th>
                <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Supplier</th>
                <th className="w-48 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Reason</th>
                <th className="w-28 border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Amount</th>
              </tr>
            </thead>
            <tbody>
              {todayReturns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-sm text-gray-400">
                    No supplier returns today yet.
                  </td>
                </tr>
              ) : (
                todayReturns.map((r: any) => (
                  <tr key={r.return_id} className="hover:bg-gray-50">
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-600">{r.return_id}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{supplierName(r.party_id)}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{r.reason || '—'}</td>
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

      <ImportCSVDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleCNImport}
        actionLabel="Fill Return"
      />
    </div>
  )
}