'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { SmartCombobox } from '../../../components/ui/smart-combobox'
import { SaleEditModal } from '../../../components/ui/sale-edit-modal'
import { searchItems, SearchItemResult } from '../../../lib/item-search'
import {
  ArrowLeft,
  Search,
  Calendar,
  Pencil,
  User,
  Package,
  X,
} from 'lucide-react'

type Party = {
  party_id: number
  party_name: string
}

type SaleRow = {
  sale_id: number
  bill_date: string
  party_id: number
  party_name: string
  total_amount: number
  paid_amount: number
  status: string
  item_count: number
  items_preview: string
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA')
}

function money(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`
}

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function FindSalePage() {
  const [fromDate, setFromDate] = useState(todayStr())
  const [toDate, setToDate] = useState(todayStr())

  const [partyId, setPartyId] = useState<string | null>(null)
  const [partyLabel, setPartyLabel] = useState('')
  const [itemId, setItemId] = useState<string | null>(null)
  const [itemLabel, setItemLabel] = useState('')
  const [itemOptions, setItemOptions] = useState<
    { value: number; label: string }[]
  >([])

  const [parties, setParties] = useState<Party[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [editingSaleId, setEditingSaleId] = useState<number | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('parties')
        .select('party_id, party_name')
        .eq('party_type', 'Customer')
        .order('party_name')
      setParties((data as Party[]) || [])
    })()
  }, [])

  useEffect(() => {
    search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, partyId, itemId])

  async function handleItemSearch(q: string) {
    if (q.trim().length < 2) {
      setItemOptions([])
      return
    }
    const results = await searchItems(q)
    setItemOptions(
      (results as SearchItemResult[]).map((it) => ({
        value: it.item_id,
        label: `${it.sku} · stock ${it.current_stock}`,
      }))
    )
  }

  async function search() {
    setLoading(true)
    setError('')

    if (!fromDate || !toDate) {
      setSales([])
      setLoading(false)
      return
    }

    // 1. Fetch sales in range (filtered by party if set)
    let salesQuery = supabase
      .from('sales')
      .select(
        'sale_id, bill_date, party_id, total_amount, paid_amount, status'
      )
      .gte('bill_date', fromDate)
      .lte('bill_date', toDate)
      .order('bill_date', { ascending: false })
      .order('sale_id', { ascending: false })

    if (partyId) salesQuery = salesQuery.eq('party_id', Number(partyId))

    const { data: salesData, error: salesErr } = await salesQuery

    if (salesErr) {
      setError('Could not search sales: ' + salesErr.message)
      setSales([])
      setLoading(false)
      return
    }

    let salesList = (salesData as any[]) || []

    // 2. If item filter set, restrict to sales that contain this item
    if (itemId && salesList.length > 0) {
      const saleIds = salesList.map((s) => s.sale_id)
      const { data: matching } = await supabase
        .from('sale_items')
        .select('sale_id')
        .in('sale_id', saleIds)
        .eq('item_id', Number(itemId))

      const matchingSaleIds = new Set(
        (matching || []).map((m: any) => m.sale_id)
      )
      salesList = salesList.filter((s) => matchingSaleIds.has(s.sale_id))
    }

    // 3. For each sale, get item count + first-3 SKUs preview
    const saleIds = salesList.map((s) => s.sale_id)
    const itemsBySale: Record<
      number,
      { count: number; skus: string[] }
    > = {}

    if (saleIds.length > 0) {
      const { data: linesData } = await supabase
        .from('sale_items')
        .select('sale_id, item_id, quantity')
        .in('sale_id', saleIds)

      const rawLines = (linesData as any[]) || []
      const itemIds = Array.from(
        new Set(rawLines.map((l) => l.item_id).filter(Boolean))
      ) as number[]

      let skuMap: Record<number, string> = {}
      if (itemIds.length > 0) {
        const { data: itemRows } = await supabase
          .from('items')
          .select('item_id, sku')
          .in('item_id', itemIds)
        for (const it of itemRows || []) skuMap[it.item_id] = it.sku
      }

      for (const l of rawLines) {
        if (!itemsBySale[l.sale_id]) {
          itemsBySale[l.sale_id] = { count: 0, skus: [] }
        }
        itemsBySale[l.sale_id].count += Number(l.quantity || 0)
        if (itemsBySale[l.sale_id].skus.length < 3) {
          const sku = skuMap[l.item_id]
          if (sku) itemsBySale[l.sale_id].skus.push(sku)
        }
      }
    }

    // 4. Party name lookup
    const partyMap: Record<number, string> = {}
    for (const p of parties) partyMap[p.party_id] = p.party_name

    const enriched: SaleRow[] = salesList.map((s) => {
      const info = itemsBySale[s.sale_id] || { count: 0, skus: [] }
      return {
        sale_id: s.sale_id,
        bill_date: s.bill_date,
        party_id: s.party_id,
        party_name: partyMap[s.party_id] || `Party #${s.party_id}`,
        total_amount: Number(s.total_amount),
        paid_amount: Number(s.paid_amount || 0),
        status: s.status,
        item_count: info.count,
        items_preview: info.skus.join(', '),
      }
    })

    setSales(enriched)
    setLoading(false)
  }

  function setRange(mode: 'today' | 'yesterday' | 'week' | 'month') {
    const t = todayStr()
    if (mode === 'today') {
      setFromDate(t)
      setToDate(t)
    } else if (mode === 'yesterday') {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      const y = d.toLocaleDateString('en-CA')
      setFromDate(y)
      setToDate(y)
    } else if (mode === 'week') {
      const d = new Date()
      const day = d.getDay()
      const diff = d.getDate() - day
      const start = new Date(d.setDate(diff))
      setFromDate(start.toLocaleDateString('en-CA'))
      setToDate(t)
    } else {
      const d = new Date()
      const fm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0'
      )}-01`
      setFromDate(fm)
      setToDate(t)
    }
  }

  function clearParty() {
    setPartyId(null)
    setPartyLabel('')
  }

  function clearItem() {
    setItemId(null)
    setItemLabel('')
    setItemOptions([])
  }

  const totalAmount = useMemo(
    () => sales.reduce((s, r) => s + r.total_amount, 0),
    [sales]
  )
  const totalDue = useMemo(
    () => sales.reduce((s, r) => s + Math.max(0, r.total_amount - r.paid_amount), 0),
    [sales]
  )

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/sales"
          className="inline-flex items-center gap-1 text-xs sm:text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Sales
        </Link>

        <div className="mb-5">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 sm:w-6 sm:h-6 text-slate-700" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Find Sale
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Search by date, customer, or item to edit any bill.
          </p>
        </div>

        {/* Date range */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-3">
          <div className="flex items-center gap-2 text-slate-700 mb-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span className="text-xs sm:text-sm font-medium">Date range</span>
            {loading && (
              <span className="text-[10px] text-slate-400 ml-auto">
                Searching…
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="flex-1 h-11 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
            />
            <span className="text-slate-400 text-sm shrink-0">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="flex-1 h-11 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setRange('today')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Today
            </button>
            <button
              onClick={() => setRange('yesterday')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Yesterday
            </button>
            <button
              onClick={() => setRange('week')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              This Week
            </button>
            <button
              onClick={() => setRange('month')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              This Month
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Customer
            </label>
            <SmartCombobox
              options={parties.map((p) => ({
                value: p.party_id,
                label: p.party_name,
              }))}
              value={partyId}
              onValueChange={(v, label) => {
                setPartyId(v || null)
                setPartyLabel(label || '')
              }}
              placeholder="All customers — optional"
              allowCreate={false}
              fallbackLabel={partyLabel || null}
            />
            {partyId && (
              <button
                onClick={clearParty}
                className="text-[11px] text-slate-500 hover:text-slate-700 mt-1 flex items-center gap-0.5"
              >
                <X className="w-3 h-3" />
                Clear customer
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Item
            </label>
            <SmartCombobox
              options={itemOptions}
              value={itemId}
              onValueChange={(v, label) => {
                setItemId(v || null)
                setItemLabel(label || '')
              }}
              onSearch={handleItemSearch}
              placeholder="Any item — optional"
              allowCreate={false}
              fallbackLabel={itemLabel || null}
            />
            {itemId && (
              <button
                onClick={clearItem}
                className="text-[11px] text-slate-500 hover:text-slate-700 mt-1 flex items-center gap-0.5"
              >
                <X className="w-3 h-3" />
                Clear item
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800 mb-4">
            {error}
          </div>
        )}

        {/* Summary */}
        {!loading && sales.length > 0 && (
          <div className="bg-gradient-to-r from-slate-700 to-slate-900 rounded-2xl p-4 mb-4 text-white shadow-sm">
            <div className="grid grid-cols-3 gap-3 text-xs sm:text-sm">
              <div>
                <div className="text-[10px] text-white/70 uppercase tracking-wide">
                  Bills
                </div>
                <div className="text-lg font-bold mt-0.5">{sales.length}</div>
              </div>
              <div className="border-l border-white/20 pl-3">
                <div className="text-[10px] text-white/70 uppercase tracking-wide">
                  Total
                </div>
                <div className="text-lg font-bold mt-0.5">
                  {money(totalAmount)}
                </div>
              </div>
              <div className="border-l border-white/20 pl-3">
                <div className="text-[10px] text-white/70 uppercase tracking-wide">
                  Due
                </div>
                <div className="text-lg font-bold mt-0.5">
                  {money(totalDue)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
            Searching…
          </div>
        ) : sales.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-600">
              No bills found.
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Try a different date range or clear filters.
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="divide-y divide-slate-100">
              {sales.map((s) => {
                const due = Math.max(0, s.total_amount - s.paid_amount)
                return (
                  <button
                    key={s.sale_id}
                    onClick={() => setEditingSaleId(s.sale_id)}
                    className="w-full text-left px-3 sm:px-4 py-3 hover:bg-slate-50 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-semibold text-slate-900">
                          {formatDate(s.bill_date)}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {s.party_name}
                        </div>
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${
                            s.status === 'Paid'
                              ? 'bg-emerald-100 text-emerald-700'
                              : s.status === 'Partially Paid'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {s.item_count} item
                        {s.item_count === 1 ? '' : 's'} ·{' '}
                        <span className="font-mono text-[11px]">
                          {s.items_preview}
                          {s.item_count > 3 && '…'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-slate-900">
                        {money(s.total_amount)}
                      </div>
                      {due > 0 && (
                        <div className="text-[10px] text-rose-700 font-medium">
                          {money(due)} due
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-slate-400 hover:text-blue-700 flex items-center self-center">
                      <Pencil className="w-4 h-4" />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {editingSaleId !== null && (
        <SaleEditModal
          saleId={editingSaleId}
          onClose={() => setEditingSaleId(null)}
          onSaved={() => {
            setEditingSaleId(null)
            search()
          }}
        />
      )}
    </div>
  )
}