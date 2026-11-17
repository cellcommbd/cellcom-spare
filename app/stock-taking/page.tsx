'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { searchItems as searchItemsShared } from '../../lib/item-search'
import { getRole } from '../../lib/auth'
import { getStockAdjustmentPlan, type StockAdjustmentMode } from '../../lib/stock-adjustment'
import { AlertTriangle, Package, Plus, Minus, Search, ShieldCheck } from 'lucide-react'

type InventoryItem = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number | null
  selling_price: number | null
  quality?: string | null
  variant?: string | null
}

type RecentAdjustment = {
  item_id: number
  sku: string
  quantity: number
  amount: number
  reason: string
  kind: 'add' | 'loss'
  created_at: string
}

type ItemHistorySummary = {
  purchasedQty: number
  soldQty: number
  returnedQty: number
  lossQty: number
  purchaseValue: number
  saleValue: number
  lossValue: number
  currentStock: number
  expectedStock: number
  variance: number
}

const ADJUSTMENT_REASONS = [
  'Stock count',
  'Damaged',
  'Broken',
  'Defective',
  'Expired',
  'Loss',
  'Returned to stock',
  'Other',
]

export default function StockTakingPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([])
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [countedQty, setCountedQty] = useState('')
  const [adjustmentMode, setAdjustmentMode] = useState<StockAdjustmentMode>('set')
  const [reason, setReason] = useState('Stock count')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [recentAdjustments, setRecentAdjustments] = useState<RecentAdjustment[]>([])
  const [itemHistory, setItemHistory] = useState<ItemHistorySummary | null>(null)

  useEffect(() => {
    const role = getRole()
    if (role !== 'owner') {
      router.replace('/')
      return
    }
    loadRecentAdjustments()
  }, [router])

  async function loadRecentAdjustments() {
    const today = new Date().toISOString().slice(0, 10)

    const [lossRes, purchaseRes] = await Promise.all([
      supabase
        .from('losses')
        .select('loss_id, item_id, quantity, total_amount, reason, created_at')
        .eq('loss_date', today)
        .order('loss_id', { ascending: false })
        .limit(10),
      supabase
        .from('purchases')
        .select('purchase_id, purchase_date, party_id, total_amount')
        .eq('purchase_date', today)
        .order('purchase_id', { ascending: false })
        .limit(10),
    ])

    const lossRows = (lossRes.data || []) as any[]
    const purchaseRows = (purchaseRes.data || []) as any[]

    const itemIds = Array.from(
      new Set([
        ...lossRows.map((row) => row.item_id),
        ...purchaseRows.flatMap((row) => []),
      ])
    ) as number[]

    let itemMap: Record<number, { sku: string }> = {}
    if (itemIds.length > 0) {
      const { data: itemRows } = await supabase
        .from('items')
        .select('item_id, sku')
        .in('item_id', itemIds)
      itemMap = Object.fromEntries((itemRows || []).map((row: any) => [row.item_id, { sku: row.sku }]))
    }

    const recent: RecentAdjustment[] = [
      ...lossRows.map((row) => ({
        item_id: row.item_id,
        sku: itemMap[row.item_id]?.sku || `Item #${row.item_id}`,
        quantity: Number(row.quantity),
        amount: Number(row.total_amount),
        reason: row.reason || 'Loss',
        kind: 'loss' as const,
        created_at: row.created_at,
      })),
    ]

    setRecentAdjustments(recent.slice(0, 10))
  }

  async function handleSearch(queryText: string) {
    setQuery(queryText)
    const cleaned = queryText.trim()
    if (cleaned.length < 2) {
      setSearchResults([])
      return
    }

    const results = await searchItemsShared(cleaned)
    setSearchResults((results as InventoryItem[]) || [])
  }

  async function loadItemHistory(itemId: number, currentStock: number) {
    const [purchaseRes, saleRes, returnRes, lossRes] = await Promise.all([
      supabase
        .from('purchase_items')
        .select('quantity, amount')
        .eq('item_id', itemId),
      supabase
        .from('sale_items')
        .select('quantity, amount')
        .eq('item_id', itemId),
      supabase
        .from('returns')
        .select('quantity, total_amount')
        .eq('item_id', itemId),
      supabase
        .from('losses')
        .select('quantity, total_amount')
        .eq('item_id', itemId),
    ])

    const purchasedQty = (purchaseRes.data || []).reduce((sum, row: any) => sum + Number(row.quantity || 0), 0)
    const saleQty = (saleRes.data || []).reduce((sum, row: any) => sum + Number(row.quantity || 0), 0)
    const returnedQty = (returnRes.data || []).reduce((sum, row: any) => sum + Number(row.quantity || 0), 0)
    const lossQty = (lossRes.data || []).reduce((sum, row: any) => sum + Number(row.quantity || 0), 0)

    const purchaseValue = (purchaseRes.data || []).reduce((sum, row: any) => sum + Number(row.amount || 0), 0)
    const saleValue = (saleRes.data || []).reduce((sum, row: any) => sum + Number(row.amount || 0), 0)
    const lossValue = (lossRes.data || []).reduce((sum, row: any) => sum + Number(row.total_amount || 0), 0)

    const expectedStock = purchasedQty + returnedQty - saleQty - lossQty
    const variance = currentStock - expectedStock

    setItemHistory({
      purchasedQty,
      soldQty: saleQty,
      returnedQty,
      lossQty,
      purchaseValue,
      saleValue,
      lossValue,
      currentStock,
      expectedStock,
      variance,
    })
  }

  async function selectItem(itemId: number) {
    const { data, error } = await supabase
      .from('items')
      .select('item_id, sku, current_stock, cost_price, selling_price, quality, variant')
      .eq('item_id', itemId)
      .single()

    if (error || !data) {
      setMessage('Could not load that item. Try again.')
      return
    }

    setSelectedItem(data as InventoryItem)
    setCountedQty(String(Number(data.current_stock || 0)))
    setQuery(data.sku)
    setSearchResults([])
    setMessage('')
    await loadItemHistory(itemId, Number(data.current_stock || 0))
  }

  const preview = useMemo(() => {
    if (!selectedItem) return null
    try {
      const counted = Number(countedQty)
      if (!Number.isFinite(counted)) return null
      return getStockAdjustmentPlan(selectedItem.current_stock, counted, adjustmentMode)
    } catch {
      return null
    }
  }, [selectedItem, countedQty, adjustmentMode])

  async function ensureInventorySupplier() {
    const { data, error } = await supabase
      .from('parties')
      .select('party_id')
      .eq('party_name', 'Inventory Adjustment')
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data) return data.party_id

    const { data: created, error: createErr } = await supabase
      .from('parties')
      .insert({
        party_name: 'Inventory Adjustment',
        party_type: 'Supplier',
        current_balance: 0,
        phone: null,
      })
      .select('party_id')
      .single()

    if (createErr || !created) {
      throw new Error(createErr?.message || 'Could not create inventory adjustment supplier.')
    }

    return created.party_id
  }

  async function saveAdjustment() {
    if (!selectedItem) {
      setMessage('Select an item first.')
      return
    }

    const counted = Number(countedQty)
    if (!Number.isFinite(counted) || counted < 0) {
      setMessage('Physical count must be a valid non-negative number.')
      return
    }

    try {
      setSaving(true)
      setMessage('')

      const plan = getStockAdjustmentPlan(selectedItem.current_stock, counted, adjustmentMode)
      if (plan.quantity <= 0) {
        setMessage('No stock change to save.')
        return
      }

      const today = new Date().toISOString().slice(0, 10)
      const rate = Number(selectedItem.cost_price || 0)
      const value = Number((plan.quantity * rate).toFixed(2))

      if (plan.isIncrease) {
        const supplierId = await ensureInventorySupplier()
        const { data: createdPurchase, error: purchaseErr } = await supabase
          .from('purchases')
          .insert({
            party_id: supplierId,
            purchase_date: today,
            invoice_no: `STK-${Date.now()}`,
            total_amount: value,
            freight_charges: 0,
            cash_paid: 0,
            credit_applied: 0,
          })
          .select('purchase_id')
          .single()

        if (purchaseErr || !createdPurchase) {
          throw new Error(purchaseErr?.message || 'Purchase entry failed.')
        }

        const { error: lineErr } = await supabase.from('purchase_items').insert({
          purchase_id: createdPurchase.purchase_id,
          item_id: selectedItem.item_id,
          quantity: plan.quantity,
          rate,
          amount: value,
        })

        if (lineErr) {
          throw new Error(lineErr.message)
        }
      } else {
        const { error: lossErr } = await supabase.from('losses').insert({
          item_id: selectedItem.item_id,
          loss_date: today,
          quantity: plan.quantity,
          rate,
          total_amount: value,
          reason: reason || 'Stock count',
          notes: notes || `Manual stock count adjustment: ${plan.actionLabel}`,
        })

        if (lossErr) {
          throw new Error(lossErr.message)
        }
      }

      setMessage('Stock adjustment saved successfully.')
      setNotes('')
      setReason('Stock count')
      const refreshed = await supabase
        .from('items')
        .select('item_id, sku, current_stock, cost_price, selling_price, quality, variant')
        .eq('item_id', selectedItem.item_id)
        .single()

      if (refreshed.data) {
        const nextItem = refreshed.data as InventoryItem
        setSelectedItem(nextItem)
        setCountedQty(String(Number(nextItem.current_stock || 0)))
        await loadItemHistory(nextItem.item_id, Number(nextItem.current_stock || 0))
      }
      await loadRecentAdjustments()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Stock adjustment failed.'
      setMessage(msg)
    } finally {
      setSaving(false)
    }
  }

  const role = getRole()
  if (role !== 'owner') return null

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="text-lg font-bold text-slate-900">Stock Taking</div>
              <div className="text-xs text-slate-500">Add, subtract, or correct stock physically counted</div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5">
                  Search item
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    value={query}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search SKU or item name"
                    className="w-full h-11 pl-9 pr-3 border border-slate-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {searchResults.length > 0 && (
                  <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl divide-y divide-slate-200 max-h-56 overflow-auto">
                    {searchResults.map((item) => (
                      <button
                        key={item.item_id}
                        onClick={() => selectItem(item.item_id)}
                        className="w-full text-left px-3 py-2 hover:bg-white"
                      >
                        <div className="text-sm font-semibold text-slate-900">{item.sku}</div>
                        <div className="text-[11px] text-slate-500">
                          Stock: {item.current_stock} · Cost: ₹{Number(item.cost_price || 0).toFixed(2)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedItem && (
                <div className="space-y-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Selected item</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{selectedItem.sku}</div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-600">
                      <span>Current: <strong>{selectedItem.current_stock}</strong></span>
                      <span>Cost: ₹{Number(selectedItem.cost_price || 0).toFixed(2)}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5">
                      Mode
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { value: 'set', label: 'Set', icon: ShieldCheck },
                        { value: 'add', label: 'Add', icon: Plus },
                        { value: 'deduct', label: 'Deduct', icon: Minus },
                      ].map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setAdjustmentMode(value as StockAdjustmentMode)}
                          className={`h-11 rounded-lg border text-sm font-semibold flex items-center justify-center gap-1.5 ${
                            adjustmentMode === value
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5">
                      Physical count
                    </label>
                    <input
                      type="number"
                      value={countedQty}
                      onChange={(e) => setCountedQty(e.target.value)}
                      min={0}
                      className="w-full h-11 px-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {preview && (
                    <div className={`border rounded-xl px-3 py-2 ${preview.isIncrease ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                      <div className="text-[10px] uppercase tracking-wide text-slate-600">Preview</div>
                      <div className="mt-1 text-sm font-bold text-slate-900">{preview.actionLabel}</div>
                      <div className="text-xs text-slate-600 mt-1">{preview.description}</div>
                    </div>
                  )}

                  {itemHistory && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3">
                      <div className="text-[10px] uppercase tracking-wide text-slate-600 font-semibold">Stock movement summary</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-white border border-slate-200 rounded-lg px-2 py-2">
                          <div className="text-slate-500">Purchased</div>
                          <div className="font-bold text-slate-900">{itemHistory.purchasedQty}</div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-lg px-2 py-2">
                          <div className="text-slate-500">Sold</div>
                          <div className="font-bold text-slate-900">{itemHistory.soldQty}</div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-lg px-2 py-2">
                          <div className="text-slate-500">Returns</div>
                          <div className="font-bold text-slate-900">{itemHistory.returnedQty}</div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-lg px-2 py-2">
                          <div className="text-slate-500">Losses</div>
                          <div className="font-bold text-slate-900">{itemHistory.lossQty}</div>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Expected stock</span>
                          <span className="font-bold text-slate-900">{itemHistory.expectedStock}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-slate-500">Current stock</span>
                          <span className="font-bold text-slate-900">{itemHistory.currentStock}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-slate-500">Variance</span>
                          <span className={`font-bold ${itemHistory.variance === 0 ? 'text-slate-900' : itemHistory.variance > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {itemHistory.variance > 0 ? '+' : ''}{itemHistory.variance}
                          </span>
                        </div>
                        <div className="mt-2 text-slate-700">
                          {itemHistory.variance > 0
                            ? `Extra stock: ${itemHistory.variance} units.`
                            : itemHistory.variance < 0
                              ? `Missing stock: ${Math.abs(itemHistory.variance)} units.`
                              : 'Stock matches recorded movements.'}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                        <div className="bg-white border border-slate-200 rounded-lg px-2 py-2">
                          <div className="text-slate-500">Purchase value</div>
                          <div className="font-bold text-slate-900">₹{Number(itemHistory.purchaseValue || 0).toFixed(2)}</div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-lg px-2 py-2">
                          <div className="text-slate-500">Sales value</div>
                          <div className="font-bold text-slate-900">₹{Number(itemHistory.saleValue || 0).toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5">
                      Reason
                    </label>
                    <select
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full h-11 px-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {ADJUSTMENT_REASONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5">
                      Notes
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      placeholder="Optional details for staff or audit"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <button
                    onClick={saveAdjustment}
                    disabled={saving || !selectedItem}
                    className="w-full h-12 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save stock adjustment'}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">Today’s adjustments</div>
              {recentAdjustments.length === 0 ? (
                <div className="text-sm text-slate-500">No stock adjustments yet.</div>
              ) : (
                <div className="space-y-2">
                  {recentAdjustments.map((row, index) => (
                    <div key={`${row.item_id}-${row.kind}-${index}`} className="bg-white border border-slate-200 rounded-lg px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900 truncate">{row.sku}</div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${row.kind === 'loss' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {row.kind === 'loss' ? 'Deduct' : 'Add'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{row.reason}</div>
                      <div className="text-xs font-semibold text-slate-800 mt-1">
                        {row.kind === 'loss' ? '-' : '+'}{row.quantity} · ₹{Number(row.amount || 0).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {message && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 text-sm text-blue-800 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
