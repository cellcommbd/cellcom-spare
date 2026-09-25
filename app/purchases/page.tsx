'use client'

import { useEffect, useMemo, useRef, useState, createRef } from 'react'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { ImportCSVDialog } from '../../components/ui/ImportCSVDialog'
import { ParsedRow } from '../../lib/csv-parser'
import { Plus, Trash2, Save, X, Upload } from 'lucide-react'

type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
}

type Item = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
}

type PurchaseRow = {
  rowId: number
  item_id: number | null
  sku: string
  quantity: number
  rate: number
  amount: number
}

type PurchaseHeader = {
  purchase_id: number
  party_id: number
  invoice_no: string
  purchase_date: string
  total_amount: number
  freight_charges: number
  cash_paid: number
}

type PickedSupplier = {
  id: number | null
  label: string
  isNew: boolean
}

export default function PurchaseEntryPage() {
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [recentPurchases, setRecentPurchases] = useState<PurchaseHeader[]>([])

  const [pickedSupplier, setPickedSupplier] = useState<PickedSupplier>({
    id: null,
    label: '',
    isNew: false,
  })
  const [invoiceNo, setInvoiceNo] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().slice(0, 10)
  )

  const [rows, setRows] = useState<PurchaseRow[]>([
    { rowId: 1, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
  ])
  const [nextRowId, setNextRowId] = useState(2)

  // Track which new row should be focused after render
  const [pendingFocusRowId, setPendingFocusRowId] = useState<number | null>(
    null
  )

  // One ref per row's combobox input
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

  const [freight, setFreight] = useState('0')
  const [cashPaid, setCashPaid] = useState('0')
  const [cashPaidTouched, setCashPaidTouched] = useState(false)

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)

  const freightInputRef = useRef<HTMLInputElement>(null)
  const invoiceInputRef = useRef<HTMLInputElement>(null)
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
    loadData()
  }, [])

  // Focus the newly-added row after React commits it to the DOM
  useEffect(() => {
    if (pendingFocusRowId == null) return
    const el = itemRefs.current[pendingFocusRowId]?.current
    if (el) {
      el.focus()
      setPendingFocusRowId(null)
    }
  }, [pendingFocusRowId, rows])

  async function loadData() {
    const [p, i, r] = await Promise.all([
      supabase
        .from('parties')
        .select('*')
        .eq('party_type', 'Supplier')
        .order('party_name'),
      supabase.from('items').select('*').order('sku'),
      supabase
        .from('purchases')
        .select('*')
        .order('purchase_id', { ascending: false })
        .limit(10),
    ])
    setSuppliers(p.data || [])
    setItems(i.data || [])
    setRecentPurchases(r.data || [])
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

  function updateRow(rowId: number, patch: Partial<PurchaseRow>) {
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
        const newRate = item.cost_price > 0 ? item.cost_price : 0
        return {
          ...r,
          item_id: item.item_id,
          sku: item.sku,
          rate: newRate,
          amount: Number(r.quantity) * Number(newRate),
        }
      })
    )
  }

  function handleItemTab(row: PurchaseRow, idx: number) {
    const isLastRow = idx === rows.length - 1
    if (!isLastRow) return
    if (row.item_id) {
      addRow()
    } else {
      setTimeout(() => freightInputRef.current?.focus(), 0)
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
      const saveBtn = document.getElementById('save-purchase-btn')
      saveBtn?.focus()
    }
  }
  async function handleCSVImport(
    matched: ParsedRow[],
    newItems: ParsedRow[],
    margin: number
  ) {
    console.log('=== IMPORT STARTED ===', {
      matchedCount: matched.length,
      newCount: newItems.length,
      margin,
    })

    setMessage('')
    setImporting(true)

    try {
      const [brandsRes, modelsRes, partsRes, itemsRes] = await Promise.all([
        supabase.from('brands').select('brand_id, brand_name, brand_code'),
        supabase
          .from('models')
          .select('model_id, brand_id, model_name, network'),
        supabase.from('part_types').select('part_id, part_name, part_code'),
        supabase.from('items').select('item_id, sku'),
      ])

      const brands = (brandsRes.data as any[]) || []
      const models = (modelsRes.data as any[]) || []
      const parts = (partsRes.data as any[]) || []
      const existingItems = (itemsRes.data as any[]) || []

      const skuToItemId: Record<string, number> = {}
      for (const it of existingItems) {
        skuToItemId[it.sku.toUpperCase()] = it.item_id
      }

      const brandByCode: Record<string, number> = {}
      for (const b of brands) {
        brandByCode[String(b.brand_code).toUpperCase()] = b.brand_id
      }

      const uniqueBrandCodes = new Set<string>()
      for (const r of newItems) {
        if (r.brandCode) uniqueBrandCodes.add(r.brandCode.toUpperCase())
      }

      let createdBrands = 0
      for (const code of uniqueBrandCodes) {
        if (!brandByCode[code]) {
          const { data, error } = await supabase
            .from('brands')
            .insert({ brand_name: code, brand_code: code })
            .select()
            .single()
          if (error) {
            console.error('Brand create error:', error)
          } else if (data) {
            brandByCode[code] = data.brand_id
            createdBrands++
          }
        }
      }

      const modelKey = (brandId: number, name: string, net: string | null) =>
        `${brandId}::${name.toUpperCase()}::${(net || '').toUpperCase()}`

      const modelByKey: Record<string, number> = {}
      for (const m of models) {
        modelByKey[modelKey(m.brand_id, m.model_name, m.network)] = m.model_id
      }

      let createdModels = 0
      for (const r of newItems) {
        if (!r.brandCode || !r.modelName) continue
        const brandCode = r.brandCode.toUpperCase()
        const brandId = brandByCode[brandCode]
        if (!brandId) continue

        const key = modelKey(brandId, r.modelName, r.network)
        if (!modelByKey[key]) {
          const { data, error } = await supabase
            .from('models')
            .insert({
              brand_id: brandId,
              model_name: r.modelName,
              network: r.network,
            })
            .select()
            .single()
          if (error) {
            console.error('Model create error:', error)
          } else if (data) {
            modelByKey[key] = data.model_id
            createdModels++
          }
        }
      }

      const partByCode: Record<string, number> = {}
      for (const p of parts) {
        partByCode[String(p.part_code).toUpperCase()] = p.part_id
      }

      const finalRows: PurchaseRow[] = []
      let nextId = nextRowId
      let createdItems = 0

      for (const r of matched) {
        if (!r.matchedItemId || !r.matchedItemSku) continue
        finalRows.push({
          rowId: nextId++,
          item_id: r.matchedItemId,
          sku: r.matchedItemSku,
          quantity: r.qty,
          rate: r.rate,
          amount: Number((r.qty * r.rate).toFixed(2)),
        })
      }

      for (const r of newItems) {
        if (!r.generatedSku || !r.brandCode || !r.modelName || !r.partCode)
          continue

        if (skuToItemId[r.generatedSku.toUpperCase()]) {
          finalRows.push({
            rowId: nextId++,
            item_id: skuToItemId[r.generatedSku.toUpperCase()],
            sku: r.generatedSku,
            quantity: r.qty,
            rate: r.rate,
            amount: Number((r.qty * r.rate).toFixed(2)),
          })
          continue
        }

        const brandId = brandByCode[r.brandCode.toUpperCase()]
        const key = modelKey(brandId, r.modelName, r.network)
        const modelId = modelByKey[key]
        const partId = partByCode[r.partCode.toUpperCase()]

        if (!brandId || !modelId || !partId) continue

        const sellingPrice = Number((r.rate * margin).toFixed(2))

        const { data: newItem, error: itemErr } = await supabase
          .from('items')
          .insert({
            sku: r.generatedSku,
            brand_id: brandId,
            model_id: modelId,
            part_id: partId,
            quality: r.quality || 'Normal',
            variant: r.variant || null,
            color: null,
            cost_price: r.rate,
            selling_price: sellingPrice,
            current_stock: 0,
          })
          .select()
          .single()

        if (itemErr || !newItem) continue

        createdItems++
        skuToItemId[r.generatedSku.toUpperCase()] = newItem.item_id

        finalRows.push({
          rowId: nextId++,
          item_id: newItem.item_id,
          sku: r.generatedSku,
          quantity: r.qty,
          rate: r.rate,
          amount: Number((r.qty * r.rate).toFixed(2)),
        })
      }

      setRows((prev) => {
        const cleaned = prev.filter(
          (p) => p.item_id !== null || p.sku !== '' || p.quantity > 0
        )
        return [...cleaned, ...finalRows]
      })
      setNextRowId(nextId)

      setMessage(
        `Imported ${finalRows.length} rows. Created ${createdBrands} brand(s), ${createdModels} model(s), ${createdItems} item(s).`
      )

      await loadData()
    } catch (e: any) {
      console.error('IMPORT CRASH:', e)
      setMessage('Import error: ' + (e.message || 'unknown'))
    } finally {
      setImporting(false)
    }
  }

  const subtotal = rows.reduce((s, r) => s + (r.amount || 0), 0)
  const freightNum = parseFloat(freight) || 0
  const total = subtotal + freightNum

  useEffect(() => {
    if (!cashPaidTouched) {
      setCashPaid(total.toFixed(2))
    }
  }, [total, cashPaidTouched])

  const costPredictions = useMemo(() => {
    const validRows = rows.filter(
      (r) => r.item_id && r.quantity > 0 && r.rate > 0
    )
    const validSubtotal = validRows.reduce((s, r) => s + r.amount, 0)

    const map = new Map<
      number,
      { old_cost: number; new_cost: number; old_stock: number; change: number }
    >()

    for (const r of validRows) {
      const item = items.find((i) => i.item_id === r.item_id)
      if (!item) continue

      const share =
        validSubtotal > 0 ? (r.amount / validSubtotal) * freightNum : 0
      const effectiveRate = r.rate + share / r.quantity

      const old_stock = item.current_stock
      const old_cost = item.cost_price

      let new_cost: number
      if (old_stock <= 0) {
        new_cost = effectiveRate
      } else {
        new_cost =
          (old_stock * old_cost + r.quantity * effectiveRate) /
          (old_stock + r.quantity)
      }

      map.set(r.rowId, {
        old_cost,
        new_cost,
        old_stock,
        change: new_cost - old_cost,
      })
    }

    return map
  }, [rows, items, freightNum])

  async function ensureSupplier(): Promise<number | null> {
    if (pickedSupplier.isNew && pickedSupplier.label) {
      const { data, error } = await supabase
        .from('parties')
        .insert({
          party_name: pickedSupplier.label,
          party_type: 'Supplier',
          current_balance: 0,
        })
        .select()
        .single()
      if (error) {
        setMessage('Supplier error: ' + error.message)
        return null
      }
      return data.party_id
    }
    return pickedSupplier.id
  }

  async function savePurchase() {
    setMessage('')

    if (!pickedSupplier.label) {
      setMessage('Please select or enter a Supplier.')
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

    const supplierId = await ensureSupplier()
    if (!supplierId) {
      setSaving(false)
      return
    }

    const validSubtotal = validRows.reduce((s, r) => s + r.amount, 0)
    const enrichedRows = validRows.map((r) => {
      const share =
        validSubtotal > 0 ? (r.amount / validSubtotal) * freightNum : 0
      const effectiveRate = r.rate + share / r.quantity
      return {
        ...r,
        effectiveRate: Number(effectiveRate.toFixed(4)),
      }
    })

    const { data: purchaseData, error: purchaseError } = await supabase
      .from('purchases')
      .insert({
        party_id: supplierId,
        invoice_no: invoiceNo.trim() || null,
        purchase_date: purchaseDate,
        total_amount: total,
        freight_charges: freightNum,
        cash_paid: parseFloat(cashPaid) || 0,
      })
      .select()
      .single()

    if (purchaseError || !purchaseData) {
      setMessage('Save error (header): ' + (purchaseError?.message || 'unknown'))
      setSaving(false)
      return
    }

    const purchaseId = purchaseData.purchase_id

    const lineInserts = enrichedRows.map((r) => ({
      purchase_id: purchaseId,
      item_id: r.item_id,
      quantity: r.quantity,
      rate: r.effectiveRate,
      amount: Number((r.effectiveRate * r.quantity).toFixed(2)),
    }))

    const { error: linesError } = await supabase
      .from('purchase_items')
      .insert(lineInserts)

    if (linesError) {
      await supabase.from('purchases').delete().eq('purchase_id', purchaseId)
      setMessage('Save error (lines): ' + linesError.message)
      setSaving(false)
      return
    }

    setMessage(
      `Saved purchase #${purchaseId}. Stock and cost updated for ${validRows.length} items.`
    )
    resetForm()
    await loadData()
    setSaving(false)
  }

  function resetForm() {
    setPickedSupplier({ id: null, label: '', isNew: false })
    setInvoiceNo('')
    setPurchaseDate(new Date().toISOString().slice(0, 10))
    setRows([
      { rowId: 1, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
    ])
    setNextRowId(2)
    setFreight('0')
    setCashPaid('0')
    setCashPaidTouched(false)
  }

  async function deletePurchase(id: number) {
    if (!confirm(`Delete purchase #${id}? This will also remove its items.`))
      return
    await supabase.from('purchase_items').delete().eq('purchase_id', id)
    const { error } = await supabase
      .from('purchases')
      .delete()
      .eq('purchase_id', id)
    if (error) setMessage('Delete error: ' + error.message)
    else {
      setMessage('Deleted purchase #' + id)
      await loadData()
    }
  }

  const supplierName = (id: number) =>
    suppliers.find((s) => s.party_id === id)?.party_name || '—'

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">

        <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">
              Purchase Entry
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Enter supplier invoices. Freight auto-distributed. Stock & cost update automatically.
            </p>
          </div>
          <button
            onClick={() => setShowImport(true)}
            disabled={importing}
            className="h-11 sm:h-10 px-4 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm"
          >
            <Upload className="size-4" />
            {importing ? 'Importing...' : 'Import CSV'}
          </button>
        </div>

        {/* MOBILE VIEW */}
        <div className="md:hidden space-y-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Supplier
              </label>
              <SmartCombobox
                options={supplierOptions}
                value={
                  pickedSupplier.id
                    ? String(pickedSupplier.id)
                    : pickedSupplier.isNew
                    ? `__new__${pickedSupplier.label}`
                    : null
                }
                onValueChange={(
                  v: string,
                  label: string,
                  isNew: boolean
                ) => {
                  setPickedSupplier({
                    id: isNew ? null : Number(v),
                    label,
                    isNew,
                  })
                }}
                placeholder="Select or type supplier..."
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
                placeholder="e.g. 12345"
                className="w-full h-11 px-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full h-11 px-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="space-y-3">
            {rows.map((row, idx) => {
              const pred = costPredictions.get(row.rowId)
              return (
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
                    nextFieldSelector={`input[data-qty-row="qty-${row.rowId}"]`}
                  />
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">
                        Qty
                      </label>
                      <input
                        data-qty-row={`qty-${row.rowId}`}
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
                        onKeyDown={(e) => {
                          if (e.key === 'Tab') handleRateTab(row.rowId, idx, e)
                        }}
                        className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    <div className="text-xs text-slate-500">
                      {pred ? (
                        <span
                          className={
                            pred.change > 0.01
                              ? 'text-red-600'
                              : pred.change < -0.01
                              ? 'text-green-600'
                              : 'text-slate-500'
                          }
                        >
                          New cost: ₹{pred.new_cost.toFixed(2)}
                        </span>
                      ) : (
                        'Amount'
                      )}
                    </div>
                    <span className="text-base font-bold text-slate-800">
                      ₹ {row.amount.toFixed(2)}
                    </span>
                  </div>
                </div>
              )
            })}

            <button
              onClick={addRow}
              className="w-full h-12 text-sm font-medium text-blue-600 border-2 border-dashed border-blue-200 rounded-xl hover:bg-blue-50 flex items-center justify-center gap-1"
            >
              <Plus className="size-4" />
              Add Item
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Subtotal</span>
              <span className="font-medium text-slate-800">
                ₹ {subtotal.toFixed(2)}
              </span>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                Freight Charges
              </label>
              <input
                ref={freightInputRef}
                type="number"
                value={freight}
                onChange={(e) => setFreight(e.target.value)}
                className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-between text-base border-t border-slate-200 pt-2">
              <span className="font-semibold text-slate-800">Total</span>
              <span className="font-bold text-slate-900">
                ₹ {total.toFixed(2)}
              </span>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                Cash Paid Today
              </label>
              <input
                type="number"
                value={cashPaid}
                onChange={(e) => {
                  setCashPaid(e.target.value)
                  setCashPaidTouched(true)
                }}
                className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              id="save-purchase-btn"
              onClick={savePurchase}
              disabled={saving}
              className="flex-1 h-12 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              <Save className="size-4" />
              {saving ? 'Saving...' : 'Save Purchase'}
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

        {/* DESKTOP VIEW */}
        <div className="hidden md:block">
          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Supplier
                </label>
                <SmartCombobox
                  options={supplierOptions}
                  value={
                    pickedSupplier.id
                      ? String(pickedSupplier.id)
                      : pickedSupplier.isNew
                      ? `__new__${pickedSupplier.label}`
                      : null
                  }
                  onValueChange={(
                    v: string,
                    label: string,
                    isNew: boolean
                  ) => {
                    setPickedSupplier({
                      id: isNew ? null : Number(v),
                      label,
                      isNew,
                    })
                  }}
                  placeholder="Select or type supplier..."
                  focusNextOnSelect={true}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Invoice No
                </label>
                <input
                  ref={invoiceInputRef}
                  type="text"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="e.g. 12345"
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
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

            <div className="border border-slate-200 rounded-lg">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="w-10 border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold text-slate-600">#</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold text-slate-600">Item (SKU)</th>
                    <th className="w-20 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">Qty</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">Rate</th>
                    <th className="w-28 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">Amount</th>
                    <th className="w-32 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">New Cost</th>
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
                          nextFieldSelector={`input[data-qty-row="qty-${row.rowId}"]`}
                          inputRef={getItemRef(row.rowId)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          data-qty-row={`qty-${row.rowId}`}
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
                      <td className="px-2 py-1 text-right text-xs">
                        {(() => {
                          const pred = costPredictions.get(row.rowId)
                          if (!pred)
                            return <span className="text-slate-300">—</span>
                          const up = pred.change > 0.01
                          const down = pred.change < -0.01
                          return (
                            <div className="flex flex-col items-end leading-tight">
                              <span className="font-medium text-slate-800">
                                ₹ {pred.new_cost.toFixed(2)}
                              </span>
                              <span
                                className={`text-[10px] ${
                                  up
                                    ? 'text-red-600'
                                    : down
                                    ? 'text-green-600'
                                    : 'text-slate-400'
                                }`}
                              >
                                {up ? '▲' : down ? '▼' : '—'}{' '}
                                {Math.abs(pred.change).toFixed(2)}
                              </span>
                            </div>
                          )
                        })()}
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

            <div className="mt-6 grid grid-cols-2 gap-6">
              <div></div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Subtotal:</span>
                  <span className="font-medium text-slate-800">
                    ₹ {subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm gap-4">
                  <span className="text-slate-600">Freight Charges:</span>
                  <input
                    ref={freightInputRef}
                    type="number"
                    value={freight}
                    onChange={(e) => setFreight(e.target.value)}
                    className="w-40 h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex justify-between text-base border-t border-slate-300 pt-2">
                  <span className="font-semibold text-slate-800">Total:</span>
                  <span className="font-bold text-slate-900">
                    ₹ {total.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm gap-4">
                  <span className="text-slate-600">Cash Paid Today:</span>
                  <input
                    type="number"
                    value={cashPaid}
                    onChange={(e) => {
                      setCashPaid(e.target.value)
                      setCashPaidTouched(true)
                    }}
                    className="w-40 h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {(() => {
              const changed = Array.from(costPredictions.values()).filter(
                (p) => Math.abs(p.change) > 0.01
              )
              if (changed.length === 0) return null
              const increases = changed.filter((p) => p.change > 0).length
              const decreases = changed.filter((p) => p.change < 0).length
              return (
                <div className="mt-4 text-xs text-slate-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                  <strong>Cost price preview:</strong>{' '}
                  {increases > 0 && (
                    <span className="text-red-600 font-medium">
                      {increases} item{increases > 1 ? 's' : ''} will increase
                    </span>
                  )}
                  {increases > 0 && decreases > 0 && <span>, </span>}
                  {decreases > 0 && (
                    <span className="text-green-600 font-medium">
                      {decreases} item{decreases > 1 ? 's' : ''} will decrease
                    </span>
                  )}
                </div>
              )
            })()}

            <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-200">
              <button
                id="save-purchase-btn"
                onClick={savePurchase}
                disabled={saving}
                className="h-10 px-6 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="size-4" />
                {saving ? 'Saving...' : 'Save Purchase'}
              </button>
              <button
                onClick={resetForm}
                className="h-10 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2"
              >
                <X className="size-4" />
                Clear
              </button>
              {message && <div className="text-sm text-slate-700">{message}</div>}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-700">
                Recent Purchases ({recentPurchases.length})
              </span>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="w-16 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">ID</th>
                  <th className="w-28 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">Date</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">Supplier</th>
                  <th className="w-28 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">Invoice</th>
                  <th className="w-28 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">Total</th>
                  <th className="w-24 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">Action</th>
                </tr>
              </thead>
              <tbody>
                {recentPurchases.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">
                      No purchases yet.
                    </td>
                  </tr>
                ) : (
                  recentPurchases.map((p) => (
                    <tr key={p.purchase_id} className="hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-600">{p.purchase_id}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-800">{p.purchase_date}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-800">{supplierName(p.party_id)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-800">{p.invoice_no || '—'}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-medium text-slate-800">
                        ₹ {Number(p.total_amount).toFixed(2)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2">
                        <button
                          onClick={() => deletePurchase(p.purchase_id)}
                          className="text-xs font-medium text-red-600 hover:text-red-800"
                        >
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

      <ImportCSVDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleCSVImport}
      />
    </div>
  )
}