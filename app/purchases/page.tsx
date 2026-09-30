'use client'

import { useEffect, useMemo, useRef, useState, createRef } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { ImportCSVDialog } from '../../components/ui/ImportCSVDialog'
import { ParsedRow } from '../../lib/csv-parser'
import { searchItems as searchItemsShared } from '../../lib/item-search'
import {
  Plus,
  Trash2,
  Save,
  X,
  Upload,
  Pencil,
  AlertTriangle,
} from 'lucide-react'

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
  selling_price: number
  quality?: string | null
  variant?: string | null
}

type PurchaseRow = {
  rowId: number
  item_id: number | null
  sku: string
  brand_id: number | null
  model_id: number | null
  part_id: number | null
  brand_code: string | null
  model_name: string | null
  part_code: string | null
  quality: string
  variant: string | null
  color: string | null
  network: string | null
  year: string | null
  flag: string | null
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

function emptyRow(rowId: number): PurchaseRow {
  return {
    rowId,
    item_id: null,
    sku: '',
    brand_id: null,
    model_id: null,
    part_id: null,
    brand_code: null,
    model_name: null,
    part_code: null,
    quality: 'Normal',
    variant: null,
    color: null,
    network: null,
    year: null,
    flag: null,
    quantity: 0,
    rate: 0,
    amount: 0,
  }
}

export default function PurchaseEntryPage() {
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [recentPurchases, setRecentPurchases] = useState<PurchaseHeader[]>([])
  const [recentLineCounts, setRecentLineCounts] = useState<Record<number, number>>({})

  // Per-row search results cache (rowId -> items)
  const [rowItemOptions, setRowItemOptions] = useState<Record<number, Item[]>>(
    {}
  )

  const [pickedSupplier, setPickedSupplier] = useState<PickedSupplier>({
    id: null,
    label: '',
    isNew: false,
  })
  const [invoiceNo, setInvoiceNo] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().slice(0, 10)
  )

  const [rows, setRows] = useState<PurchaseRow[]>([emptyRow(1)])
  const [nextRowId, setNextRowId] = useState(2)

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

  const [freight, setFreight] = useState('0')
  const [cashPaid, setCashPaid] = useState('0')
  const [cashPaidTouched, setCashPaidTouched] = useState(false)

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState<PurchaseHeader | null>(null)
  const [deleting, setDeleting] = useState(false)

  const freightInputRef = useRef<HTMLInputElement>(null)
  const invoiceInputRef = useRef<HTMLInputElement>(null)
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
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
    // No longer fetching all items — search happens on demand per row.
    const [p, r] = await Promise.all([
      supabase
        .from('parties')
        .select('*')
        .eq('party_type', 'Supplier')
        .order('party_name'),
      supabase
        .from('purchases')
        .select('*')
        .order('purchase_id', { ascending: false })
        .limit(10),
    ])
    setSuppliers(p.data || [])
    setRecentPurchases(r.data || [])

    if (r.data && r.data.length > 0) {
      const ids = r.data.map((x: any) => x.purchase_id)
      const { data: lines } = await supabase
        .from('purchase_items')
        .select('purchase_id')
        .in('purchase_id', ids)
      const counts: Record<number, number> = {}
      for (const l of lines || []) {
        counts[l.purchase_id] = (counts[l.purchase_id] || 0) + 1
      }
      setRecentLineCounts(counts)
    } else {
      setRecentLineCounts({})
    }
  }

  const supplierOptions = suppliers.map((s) => ({
    value: s.party_id,
    label: s.party_name,
  }))

  // Server-side item search per row — prefix matches first
    // Server-side multi-word item search — delegates to search_items RPC
  async function searchItems(rowId: number, query: string) {
    if (!query || query.trim().length < 2) {
      setRowItemOptions((prev) => ({ ...prev, [rowId]: [] }))
      return
    }

    const results = await searchItemsShared(query)
    const items = results as Item[]
    setRowItemOptions((prev) => ({ ...prev, [rowId]: items }))
  }
  function addRow(): number {
    const newId = nextRowId
    setRows((prev) => [...prev, emptyRow(newId)])
    setNextRowId((n) => n + 1)
    setPendingFocusRowId(newId)
    return newId
  }

  function removeRow(rowId: number) {
    if (rows.length === 1) {
      setRows([emptyRow(1)])
      return
    }
    setRows(rows.filter((r) => r.rowId !== rowId))
    setRowItemOptions((prev) => {
      const next = { ...prev }
      delete next[rowId]
      return next
    })
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
    const rowOptions = rowItemOptions[rowId] || []
    const item = rowOptions.find((i) => i.item_id === itemId)
    if (!item) return
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r
        const newRate = item.cost_price > 0 ? item.cost_price : 0
        return {
          ...r,
          item_id: item.item_id,
          sku: item.sku,
          brand_id: null,
          model_id: null,
          part_id: null,
          brand_code: null,
          model_name: null,
          part_code: null,
          quality: 'Normal',
          variant: null,
          color: null,
          network: null,
          year: null,
          flag: null,
          rate: newRate,
          amount: Number(r.quantity) * Number(newRate),
        }
      })
    )
  }

  function handleItemTab(row: PurchaseRow, idx: number) {
    const isLastRow = idx === rows.length - 1
    if (!isLastRow) return
    if (row.item_id || row.sku) {
      addRow()
    } else {
      setTimeout(() => freightInputRef.current?.focus(), 0)
    }
  }

  function handleRateTab(rowId: number, idx: number, e: React.KeyboardEvent) {
    const isLastRow = idx === rows.length - 1
    if (!isLastRow) return
    const row = rows[idx]
    if (row.item_id || row.sku) {
      e.preventDefault()
      addRow()
    } else {
      e.preventDefault()
      const saveBtn = document.getElementById('save-purchase-btn')
      saveBtn?.focus()
    }
  }

  // ============================================================
  // IMPORT — fill grid only. Does NOT touch the DB.
  // ============================================================
  async function handleCSVImport(
    matched: ParsedRow[],
    newItems: ParsedRow[],
    margin: number
  ) {
    setMessage('')
    setImporting(true)

    try {
      const [brandsRes, modelsRes, partsRes] = await Promise.all([
        supabase.from('brands').select('brand_id, brand_code'),
        supabase.from('models').select('model_id, brand_id, model_name, network'),
        supabase.from('part_types').select('part_id, part_code'),
      ])

      const brands = (brandsRes.data as any[]) || []
      const models = (modelsRes.data as any[]) || []
      const parts = (partsRes.data as any[]) || []

      const brandByCode: Record<string, number> = {}
      for (const b of brands) {
        brandByCode[String(b.brand_code).toUpperCase()] = b.brand_id
      }

      const modelKey = (brandId: number, name: string, net: string | null) =>
        `${brandId}::${name.toUpperCase()}::${(net || '').toUpperCase()}`

      const modelByKey: Record<string, number> = {}
      for (const m of models) {
        modelByKey[modelKey(m.brand_id, m.model_name, m.network)] = m.model_id
      }

      const partByCode: Record<string, number> = {}
      for (const p of parts) {
        partByCode[String(p.part_code).toUpperCase()] = p.part_id
      }

      const finalRows: PurchaseRow[] = []
      let nextId = nextRowId

      for (const r of matched) {
        if (!r.matchedItemId || !r.matchedItemSku) continue
        finalRows.push({
          ...emptyRow(nextId++),
          item_id: r.matchedItemId,
          sku: r.matchedItemSku,
          quality: r.quality || 'Normal',
          variant: r.variant || null,
          color: r.color || null,
          network: r.network || null,
          year: r.year || null,
          flag: r.flag || null,
          quantity: r.qty,
          rate: r.rate,
          amount: Number((r.qty * r.rate).toFixed(2)),
        })
      }

      for (const r of newItems) {
        if (!r.generatedSku || !r.brandCode || !r.modelName || !r.partCode)
          continue

        const brandCode = r.brandCode.toUpperCase()
        const partCode = r.partCode.toUpperCase()
        const brandId = brandByCode[brandCode] || null
        const mKey = brandId ? modelKey(brandId, r.modelName, r.network) : ''
        const modelId = mKey ? modelByKey[mKey] || null : null
        const partId = partByCode[partCode] || null

        finalRows.push({
          ...emptyRow(nextId++),
          item_id: r.matchedItemId || null,
          sku: r.generatedSku,
          brand_id: brandId,
          model_id: modelId,
          part_id: partId,
          brand_code: brandCode,
          model_name: r.modelName,
          part_code: partCode,
          quality: r.quality || 'Normal',
          variant: r.variant || null,
          color: r.color || null,
          network: r.network || null,
          year: r.year || null,
          flag: r.flag || null,
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
        `Imported ${finalRows.length} rows. Nothing saved yet — review and click Save Purchase.`
      )
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
      if (!r.item_id) continue
      // We don't have the item loaded, so skip prediction when not searched
      // (server-side search means we don't have cost_price for every row)
      const rowOptions = rowItemOptions[r.rowId] || []
      const item = rowOptions.find((i) => i.item_id === r.item_id)
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
  }, [rows, rowItemOptions, freightNum])

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

  // ============================================================
  // SAVE — batched, transactional-ish, SKU-deduped
  // ============================================================
  async function savePurchase() {
    setMessage('')

    if (!pickedSupplier.label) {
      setMessage('Please select or enter a Supplier.')
      return
    }

    const validRows = rows.filter(
      (r) => (r.item_id || r.sku) && r.quantity > 0 && r.rate > 0
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

    const skuToCreatedId: Record<string, number> = {}

    // 1. Load master data
    const [brandsRes, modelsRes, partsRes] = await Promise.all([
      supabase.from('brands').select('brand_id, brand_code'),
      supabase.from('models').select('model_id, brand_id, model_name, network'),
      supabase.from('part_types').select('part_id, part_code'),
    ])

    const brandByCode: Record<string, number> = {}
    for (const b of brandsRes.data || []) {
      brandByCode[String(b.brand_code).toUpperCase()] = b.brand_id
    }
    const partByCode: Record<string, number> = {}
    for (const p of partsRes.data || []) {
      partByCode[String(p.part_code).toUpperCase()] = p.part_id
    }
    const modelKey = (brandId: number, name: string, net: string | null) =>
      `${brandId}::${name.toUpperCase()}::${(net || '').toUpperCase()}`
    const modelByKey: Record<string, number> = {}
    for (const m of modelsRes.data || []) {
      modelByKey[modelKey(m.brand_id, m.model_name, m.network)] = m.model_id
    }

    // 2. Identify missing brands/parts, gather pending rows
    const missingBrandCodes = new Set<string>()
    const missingPartCodes = new Set<string>()
    const pending: PurchaseRow[] = []

    for (const r of validRows) {
      if (r.item_id) continue
      if (!r.sku || !r.brand_code || !r.model_name || !r.part_code) {
        setMessage(
          `Row ${r.rowId}: missing SKU or brand/model/part info. Please pick an existing SKU.`
        )
        setSaving(false)
        return
      }
      const brandCode = r.brand_code.toUpperCase()
      const partCode = r.part_code.toUpperCase()
      const brandId = r.brand_id || brandByCode[brandCode]
      if (!brandId) missingBrandCodes.add(brandCode)
      const partId = r.part_id || partByCode[partCode]
      if (!partId) missingPartCodes.add(partCode)
      pending.push({ ...r, brand_code: brandCode, part_code: partCode })
    }

    // 3. Bulk-create missing brands
    if (missingBrandCodes.size > 0) {
      const inserts = Array.from(missingBrandCodes).map((code) => ({
        brand_name: code,
        brand_code: code,
      }))
      const { data, error } = await supabase
        .from('brands')
        .insert(inserts)
        .select()
      if (error || !data) {
        setMessage('Failed to create brands: ' + (error?.message || 'unknown'))
        setSaving(false)
        return
      }
      for (const b of data) {
        brandByCode[String(b.brand_code).toUpperCase()] = b.brand_id
      }
    }

    // 4. Identify missing models
    const missingModelKeys = new Map<
      string,
      { brandId: number; model_name: string; network: string | null }
    >()
    for (const r of pending) {
      const brandId = r.brand_id || brandByCode[r.brand_code!.toUpperCase()]
      if (!brandId) continue
      const key = modelKey(brandId, r.model_name!, r.network)
      if (!r.model_id && !modelByKey[key]) {
        missingModelKeys.set(key, {
          brandId,
          model_name: r.model_name!,
          network: r.network,
        })
      }
    }

    // 5. Bulk-create missing models
    if (missingModelKeys.size > 0) {
      const inserts = Array.from(missingModelKeys.values()).map((m) => ({
        brand_id: m.brandId,
        model_name: m.model_name,
        network: m.network,
      }))
      const { data, error } = await supabase
        .from('models')
        .insert(inserts)
        .select()
      if (error || !data) {
        setMessage('Failed to create models: ' + (error?.message || 'unknown'))
        setSaving(false)
        return
      }
      for (const m of data) {
        modelByKey[modelKey(m.brand_id, m.model_name, m.network)] = m.model_id
      }
    }

    // 6. Bulk-create missing parts
    if (missingPartCodes.size > 0) {
      const inserts = Array.from(missingPartCodes).map((code) => ({
        part_name: code,
        part_code: code,
      }))
      const { data, error } = await supabase
        .from('part_types')
        .insert(inserts)
        .select()
      if (error || !data) {
        setMessage('Failed to create parts: ' + (error?.message || 'unknown'))
        setSaving(false)
        return
      }
      for (const p of data) {
        partByCode[String(p.part_code).toUpperCase()] = p.part_id
      }
    }

    // 7. Build + dedupe + bulk-insert items
    type ItemInsert = {
      sku: string
      brand_id: number
      model_id: number
      part_id: number
      quality: string
      variant: string | null
      color: string | null
      cost_price: number
      selling_price: number
      current_stock: number
    }
    const itemInserts: ItemInsert[] = []

    for (const r of pending) {
      const brandId = r.brand_id || brandByCode[r.brand_code!.toUpperCase()]
      const partId = r.part_id || partByCode[r.part_code!.toUpperCase()]
      const mKey = brandId ? modelKey(brandId, r.model_name!, r.network) : ''
      const modelId = r.model_id || (mKey ? modelByKey[mKey] : undefined)

      if (!brandId || !modelId || !partId) {
        setMessage(
          `Row ${r.rowId}: could not resolve brand/model/part for ${r.sku}.`
        )
        setSaving(false)
        return
      }

      itemInserts.push({
        sku: r.sku!,
        brand_id: brandId,
        model_id: modelId,
        part_id: partId,
        quality: r.quality || 'Normal',
        variant: r.variant || null,
        color: r.color || null,
        cost_price: r.rate,
        selling_price: Number((r.rate * 1.5).toFixed(2)),
        current_stock: 0,
      })
    }

    // Dedupe within batch
    const seenSkus = new Set<string>()
    const batchUnique = itemInserts.filter((it) => {
      if (seenSkus.has(it.sku)) return false
      seenSkus.add(it.sku)
      return true
    })

    // Check which SKUs already exist in DB and reuse their IDs
    const uniqueItemInserts: typeof itemInserts = []
    if (batchUnique.length > 0) {
      const skusToCheck = batchUnique.map((it) => it.sku)
      const { data: existingRows } = await supabase
        .from('items')
        .select('item_id, sku')
        .in('sku', skusToCheck)

      const existingBySku = new Map<string, number>()
      for (const row of existingRows || []) {
        existingBySku.set(row.sku, row.item_id)
        skuToCreatedId[row.sku] = row.item_id
      }

      for (const it of batchUnique) {
        if (existingBySku.has(it.sku)) continue
        uniqueItemInserts.push(it)
      }
    }

    let createdItemIds: number[] = []

    if (uniqueItemInserts.length > 0) {
      const { data, error } = await supabase
        .from('items')
        .insert(uniqueItemInserts)
        .select('item_id, sku')

      if (error || !data) {
        setMessage('Failed to create items: ' + (error?.message || 'unknown'))
        setSaving(false)
        return
      }

      createdItemIds = data.map((x) => x.item_id)
      for (const row of data) {
        skuToCreatedId[row.sku] = row.item_id
      }
    }

    // 8. Insert purchase header
    const validSubtotal = validRows.reduce((s, r) => s + r.amount, 0)

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
      if (createdItemIds.length > 0) {
        await supabase.from('items').delete().in('item_id', createdItemIds)
      }
      setMessage('Save error (header): ' + (purchaseError?.message || 'unknown'))
      setSaving(false)
      return
    }

    const purchaseId = purchaseData.purchase_id

    // 9. Bulk-insert purchase lines
    const lineInserts: {
      purchase_id: number
      item_id: number
      quantity: number
      rate: number
      amount: number
    }[] = []

    for (const r of validRows) {
      const resolvedId = r.item_id
        ? r.item_id
        : r.sku
        ? skuToCreatedId[r.sku]
        : null

      if (!resolvedId) {
        await supabase
          .from('purchase_items')
          .delete()
          .eq('purchase_id', purchaseId)
        await supabase.from('purchases').delete().eq('purchase_id', purchaseId)
        if (createdItemIds.length > 0) {
          await supabase.from('items').delete().in('item_id', createdItemIds)
        }
        setMessage(`Could not resolve item for row ${r.rowId}.`)
        setSaving(false)
        return
      }

      const share =
        validSubtotal > 0 ? (r.amount / validSubtotal) * freightNum : 0
      const effectiveRate = r.rate + share / r.quantity

      lineInserts.push({
        purchase_id: purchaseId,
        item_id: resolvedId,
        quantity: r.quantity,
        rate: Number(effectiveRate.toFixed(4)),
        amount: Number((effectiveRate * r.quantity).toFixed(2)),
      })
    }

    const { error: linesError } = await supabase
      .from('purchase_items')
      .insert(lineInserts)

    if (linesError) {
      await supabase.from('purchases').delete().eq('purchase_id', purchaseId)
      if (createdItemIds.length > 0) {
        await supabase.from('items').delete().in('item_id', createdItemIds)
      }
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
    setRows([emptyRow(1)])
    setNextRowId(2)
    setFreight('0')
    setCashPaid('0')
    setCashPaidTouched(false)
    setRowItemOptions({})
  }

  async function confirmDeletePurchase() {
    if (!confirmDelete) return
    setDeleting(true)
    const id = confirmDelete.purchase_id

    const { error } = await supabase.rpc('delete_purchase', { p_id: id })

    setDeleting(false)
    setConfirmDelete(null)

    if (error) {
      setMessage('Delete error: ' + error.message)
      return
    }
    setMessage('Deleted purchase #' + id + '. Stock reversed.')
    await loadData()
  }

  const supplierName = (id: number) =>
    suppliers.find((s) => s.party_id === id)?.party_name || '—'

  function itemLabel(it: Item): string {
  const parts = [
    it.sku,
    `stock ${it.current_stock}`,
    `cp ₹${Number(it.cost_price).toFixed(0)}`,
    it.quality && it.quality !== 'Normal' ? it.quality : null,
    it.variant || null,
  ].filter(Boolean)
  return parts.join(' · ')
}

function itemOptionsFor(rowId: number) {
  return (rowItemOptions[rowId] || []).map((it) => ({
    value: it.item_id,
    label: itemLabel(it),
  }))
}

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
              onValueChange={(v: string, label: string, isNew: boolean) => {
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
            const isPending = !row.item_id && row.sku
            return (
              <div
                key={row.rowId}
                className={`bg-white border rounded-xl p-3 shadow-sm ${
                  isPending ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-slate-500">
                    Item #{idx + 1}
                    {isPending && (
                      <span className="ml-2 text-amber-700">
                        (new — will be created on save)
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeRow(row.rowId)}
                    className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <SmartCombobox
                  options={itemOptionsFor(row.rowId)}
                  value={row.item_id ? String(row.item_id) : null}
                  onValueChange={(v: string, label: string, isNew: boolean) => {
                    if (isNew) return
                    handleItemSelect(row.rowId, Number(v))
                  }}
                  onTabKey={() => handleItemTab(row, idx)}
                  onSearch={(q) => searchItems(row.rowId, q)}
                  placeholder={
                    isPending ? row.sku : 'Type 2+ letters to search SKU…'
                  }
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
                  onValueChange={(v: string, label: string, isNew: boolean) => {
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
                  {rows.map((row, idx) => {
                    const isPending = !row.item_id && row.sku
                    return (
                      <tr
                        key={row.rowId}
                        className={`border-b border-slate-100 ${
                          isPending ? 'bg-amber-50/40' : ''
                        }`}
                      >
                        <td className="px-2 py-1 text-center text-slate-500 text-xs">
                          {idx + 1}
                        </td>
                        <td className="px-2 py-1">
                          <SmartCombobox
                            options={itemOptionsFor(row.rowId)}
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
                            onSearch={(q) => searchItems(row.rowId, q)}
                            placeholder={
                              isPending
                                ? `${row.sku} (new)`
                                : 'Type 2+ letters to search SKU…'
                            }
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
                    )
                  })}
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

            {(() => {
              const pendingCount = rows.filter((r) => !r.item_id && r.sku).length
              if (pendingCount === 0) return null
              return (
                <div className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <strong>{pendingCount}</strong> new item{pendingCount === 1 ? '' : 's'} will
                  be created when you click Save Purchase. Nothing is saved until then.
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
                  <th className="w-20 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">Lines</th>
                  <th className="w-28 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">Total</th>
                  <th className="w-32 border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentPurchases.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">
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
                      <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-600">{recentLineCounts[p.purchase_id] ?? 0}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-medium text-slate-800">
                        ₹ {Number(p.total_amount).toFixed(2)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Link
                            href={`/purchases/${p.purchase_id}/edit`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit
                          </Link>
                          <button
                            onClick={() => setConfirmDelete(p)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
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

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Delete purchase #{confirmDelete.purchase_id}?
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  This cannot be undone.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Supplier</span>
                <span className="font-medium text-slate-800">
                  {supplierName(confirmDelete.party_id)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Invoice</span>
                <span className="font-medium text-slate-800">
                  {confirmDelete.invoice_no || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date</span>
                <span className="font-medium text-slate-800">
                  {confirmDelete.purchase_date}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Lines</span>
                <span className="font-medium text-slate-800">
                  {recentLineCounts[confirmDelete.purchase_id] ?? 0}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                <span className="text-slate-500">Total</span>
                <span className="font-bold text-slate-900">
                  ₹ {Number(confirmDelete.total_amount).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
              <strong>Stock reversal:</strong> {recentLineCounts[confirmDelete.purchase_id] ?? 0} line
              {(recentLineCounts[confirmDelete.purchase_id] ?? 0) === 1 ? '' : 's'} will be removed and
              item stock reduced by the purchased quantities.
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="flex-1 h-10 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeletePurchase}
                disabled={deleting}
                className="flex-1 h-10 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete purchase'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
