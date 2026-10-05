'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SmartCombobox } from '@/components/ui/smart-combobox'
import { ImportCSVDialog } from '@/components/ui/ImportCSVDialog'
import { ParsedRow } from '@/lib/csv-parser'
import { searchItems as searchItemsShared } from '@/lib/item-search'
import { Save, X, Upload, Trash2 } from 'lucide-react'

// ---------- Types ----------
type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
}

type ReturnRow = {
  rowId: number
  item_id: number
  sku: string
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

type SearchItem = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
  quality?: string | null
  variant?: string | null
}

type SupplierPurchase = {
  purchase_id: number
  invoice_no: string | null
  purchase_date: string
  total_amount: number
}

type InvoiceItem = {
  item_id: number
  sku: string
  quantity: number
  rate: number
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
  const [todayReturns, setTodayReturns] = useState<any[]>([])

  const [pickedSupplier, setPickedSupplier] = useState<PickedSupplier>({
    id: null,
    label: '',
    isNew: false,
  })
  const [returnDate, setReturnDate] = useState(
    new Date().toISOString().slice(0, 10)
  )

  // Purchases of the selected supplier
  const [supplierPurchases, setSupplierPurchases] = useState<SupplierPurchase[]>([])
  const [pickedPurchaseId, setPickedPurchaseId] = useState<number | null>(null)
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([])

  const [rows, setRows] = useState<ReturnRow[]>([])
  const [nextRowId, setNextRowId] = useState(1)

  // Manual item search (used when no invoice is selected)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOptions, setSearchOptions] = useState<SearchItem[]>([])
  const [searching, setSearching] = useState(false)

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showImport, setShowImport] = useState(false)

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---------- Initial load ----------
  useEffect(() => {
    loadBase()
  }, [])

  async function loadBase() {
    const today = new Date().toISOString().slice(0, 10)
    const [s, r] = await Promise.all([
      supabase
        .from('parties')
        .select('*')
        .eq('party_type', 'Supplier')
        .order('party_name'),
      supabase
        .from('returns')
        .select('*')
        .eq('return_date', today)
        .eq('return_type', 'Supplier')
        .order('return_id', { ascending: false }),
    ])
    setSuppliers(s.data || [])
    setTodayReturns(r.data || [])
  }

  // ---------- Load supplier purchases when supplier changes ----------
  useEffect(() => {
    if (!pickedSupplier.id) {
      setSupplierPurchases([])
      setPickedPurchaseId(null)
      setInvoiceItems([])
      return
    }
    loadSupplierPurchases(pickedSupplier.id)
    setPickedPurchaseId(null)
    setInvoiceItems([])
  }, [pickedSupplier.id])

  async function loadSupplierPurchases(supplierId: number) {
    const { data } = await supabase
      .from('purchases')
      .select('purchase_id, invoice_no, purchase_date, total_amount')
      .eq('party_id', supplierId)
      .order('purchase_date', { ascending: false })
      .order('purchase_id', { ascending: false })
      .limit(50)
    setSupplierPurchases(data || [])
  }

  // ---------- Load invoice items when a purchase is picked ----------
  useEffect(() => {
    if (!pickedPurchaseId) {
      setInvoiceItems([])
      return
    }
    loadInvoiceItems(pickedPurchaseId)
  }, [pickedPurchaseId])

  async function loadInvoiceItems(purchaseId: number) {
    const { data } = await supabase
      .from('purchase_items')
      .select('item_id, quantity, rate, items(item_id, sku)')
      .eq('purchase_id', purchaseId)

    const rows = (data || []).map((r: any) => ({
      item_id: r.item_id,
      sku: r.items?.sku || '—',
      quantity: Number(r.quantity),
      rate: Number(r.rate),
    }))
    // Dedupe by item_id (same item can appear on multiple lines)
    const seen = new Set<number>()
    const deduped: InvoiceItem[] = []
    for (const it of rows) {
      if (seen.has(it.item_id)) continue
      seen.add(it.item_id)
      deduped.push(it)
    }
    setInvoiceItems(deduped)
  }

  // ---------- Manual search ----------
  function onSearchChange(q: string) {
    setSearchQuery(q)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!q || q.trim().length < 2) {
      setSearchOptions([])
      return
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchItemsShared(q)
        setSearchOptions(results as SearchItem[])
      } catch (e) {
        console.error('search error', e)
        setSearchOptions([])
      } finally {
        setSearching(false)
      }
    }, 250)
  }

  // ---------- Add a row from either the invoice list or the search list ----------
  function addManualRow(itemId: number) {
    const fromInvoice = invoiceItems.find((i) => i.item_id === itemId)
    const fromSearch = searchOptions.find((i) => i.item_id === itemId)
    const item = fromInvoice || fromSearch
    if (!item) return

    if (rows.some((r) => r.item_id === itemId)) {
      setMessage('Item already in the return list. Edit its quantity below.')
      return
    }

    const rate = 'rate' in item
      ? Number(item.rate)
      : Number((item as any).cost_price) || 0

    setRows((prev) => [
      ...prev,
      {
        rowId: nextRowId,
        item_id: itemId,
        sku: item.sku,
        rate,
        return_qty: 1,
        reason: DEFAULT_REASON,
        source: 'manual',
      },
    ])
    setNextRowId((n) => n + 1)
    setSearchQuery('')
    setSearchOptions([])
  }

  // ---------- CSV import (CN) ----------
  function handleCNImport(
    matched: ParsedRow[],
    newItems: ParsedRow[],
    _margin: number
  ) {
    setMessage('')

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

    for (const r of usableMatched) {
      if (rows.some((row) => row.item_id === r.matchedItemId)) continue
      newRows.push({
        rowId: nextId++,
        item_id: r.matchedItemId!,
        sku: r.matchedItemSku!,
        rate: r.rate,
        return_qty: r.qty,
        reason: DEFAULT_REASON,
        source: 'csv',
      })
    }

    setRows((prev) => [...prev, ...newRows])
    setNextRowId(nextId)

    const skipped = newItems.length
    const parts: string[] = [`Imported ${newRows.length} rows.`]
    if (skipped > 0) parts.push(`${skipped} row(s) skipped (items not in DB).`)
    setMessage(parts.join(' '))
  }

  function updateRow(rowId: number, patch: Partial<ReturnRow>) {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r))
    )
  }

  function removeRow(rowId: number) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId))
  }

  const totalReturnValue = rows.reduce(
    (s, r) => s + r.return_qty * r.rate,
    0
  )

  // ---------- Save ----------
  async function saveReturn() {
    setMessage('')
    if (!pickedSupplier.id) return setMessage('Please select a supplier.')

    const validRows = rows.filter((r) => r.return_qty > 0 && r.item_id)
    if (validRows.length === 0) return setMessage('Add at least one item.')

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

    // Decrease stock for each returned item
    for (const r of validRows) {
      const { data: item } = await supabase
        .from('items')
        .select('current_stock')
        .eq('item_id', r.item_id)
        .single()
      if (item) {
        await supabase
          .from('items')
          .update({
            current_stock: Number(item.current_stock) - r.return_qty,
          })
          .eq('item_id', r.item_id)
      }
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

    setRows([])
    setSearchQuery('')
    setSearchOptions([])
    setPickedPurchaseId(null)
    setInvoiceItems([])
    await loadBase()

    setSaving(false)
  }

  function resetForm() {
    setPickedSupplier({ id: null, label: '', isNew: false })
    setPickedPurchaseId(null)
    setInvoiceItems([])
    setSupplierPurchases([])
    setRows([])
    setReturnDate(new Date().toISOString().slice(0, 10))
    setSearchQuery('')
    setSearchOptions([])
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
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Return Date
              </label>
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
              title={
                !pickedSupplier.id
                  ? 'Select a supplier first'
                  : 'Import CN CSV'
              }
              className="h-10 px-4 text-sm font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Upload className="size-4" />
              Import CN
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-300 rounded p-4 sm:p-6 mb-6 shadow-sm">

          {/* Supplier + Invoice picker */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Supplier
              </label>
              <SmartCombobox
                options={suppliers.map((s) => ({
                  value: s.party_id,
                  label: s.party_name,
                }))}
                value={
                  pickedSupplier.id
                    ? String(pickedSupplier.id)
                    : pickedSupplier.isNew
                    ? `__new__${pickedSupplier.label}`
                    : null
                }
                onValueChange={(v, label, isNew) =>
                  setPickedSupplier({
                    id: isNew ? null : Number(v),
                    label,
                    isNew,
                  })
                }
                placeholder="Select or type supplier..."
                inputDataAttr="preturn-supplier"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Original Invoice (optional — helps prefill items)
              </label>
              <select
                value={pickedPurchaseId || ''}
                onChange={(e) =>
                  setPickedPurchaseId(
                    e.target.value ? Number(e.target.value) : null
                  )
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
                    #{p.purchase_id} · {p.purchase_date} · Inv:{' '}
                    {p.invoice_no || '—'} · ₹
                    {Number(p.total_amount).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Manual search / invoice item picker */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {invoiceItems.length > 0
                ? `Items in invoice (${invoiceItems.length}) — select to add`
                : 'Add item manually'}
            </label>
            <SmartCombobox
              options={
                invoiceItems.length > 0
                  ? invoiceItems.map((it) => ({
                      value: it.item_id,
                      label: `${it.sku} · qty ${it.quantity} · ₹${it.rate.toFixed(2)}`,
                    }))
                  : searchOptions.map((it) => ({
                      value: it.item_id,
                      label: `${it.sku} · stock ${it.current_stock} · cp ₹${Number(
                        it.cost_price
                      ).toFixed(0)}`,
                    }))
              }
              value={null}
              onValueChange={(v, _l, isNew) => {
                if (isNew) return
                addManualRow(Number(v))
              }}
              onSearch={(q) => onSearchChange(q)}
              placeholder={
                invoiceItems.length > 0
                  ? 'Pick from invoice items above…'
                  : searching
                  ? 'Searching…'
                  : 'Type 2+ letters to search SKU…'
              }
              allowCreate={false}
              focusNextOnSelect={false}
            />
          </div>

          {rows.length > 0 && (
            <div className="mb-6">
              <div className="text-xs font-medium text-gray-600 mb-2">
                Items to return ({rows.length}):
              </div>
              <div className="border border-gray-300 rounded overflow-x-auto">
                <table className="w-full border-collapse text-sm min-w-[720px]">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="w-10 border-b border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-600">
                        #
                      </th>
                      <th className="border-b border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-600">
                        Item
                      </th>
                      <th className="w-24 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">
                        Rate
                      </th>
                      <th className="w-24 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">
                        Return Qty
                      </th>
                      <th className="w-44 border-b border-gray-300 px-2 py-2 text-left text-xs font-semibold text-gray-600">
                        Reason
                      </th>
                      <th className="w-28 border-b border-gray-300 px-2 py-2 text-right text-xs font-semibold text-gray-600">
                        Amount
                      </th>
                      <th className="w-10 border-b border-gray-300 px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const amount = row.return_qty * row.rate
                      const isCsv = row.source === 'csv'
                      return (
                        <tr
                          key={row.rowId}
                          className={`border-b border-gray-200 ${
                            isCsv ? 'bg-emerald-50/40' : ''
                          }`}
                        >
                          <td className="px-2 py-1 text-center text-gray-500 text-xs">
                            {idx + 1}
                          </td>
                          <td className="px-2 py-1 text-gray-800 font-mono text-xs">
                            {row.sku}
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
                              className="w-full h-8 px-2 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              type="number"
                              value={row.return_qty || ''}
                              min={1}
                              onChange={(e) =>
                                updateRow(row.rowId, {
                                  return_qty: Math.max(
                                    0,
                                    parseFloat(e.target.value) || 0
                                  ),
                                })
                              }
                              className="w-full h-8 px-2 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <select
                              value={row.reason}
                              onChange={(e) =>
                                updateRow(row.rowId, {
                                  reason: e.target.value,
                                })
                              }
                              className="w-full h-8 px-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              {REASONS.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
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
                              <Trash2 className="size-3.5" />
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
              disabled={
                saving || rows.length === 0 || totalReturnValue === 0
              }
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
            {message && (
              <div className="text-sm text-gray-700">{message}</div>
            )}
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
                <th className="w-16 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                  ID
                </th>
                <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                  Supplier
                </th>
                <th className="w-48 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                  Reason
                </th>
                <th className="w-28 border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {todayReturns.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-4 text-center text-sm text-gray-400"
                  >
                    No supplier returns today yet.
                  </td>
                </tr>
              ) : (
                todayReturns.map((r: any) => (
                  <tr key={r.return_id} className="hover:bg-gray-50">
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-600">
                      {r.return_id}
                    </td>
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-800">
                      {supplierName(r.party_id)}
                    </td>
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-800">
                      {r.reason || '—'}
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

      <ImportCSVDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleCNImport}
        actionLabel="Fill Return"
      />
    </div>
  )
}