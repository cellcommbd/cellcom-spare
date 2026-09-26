'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  Download,
} from 'lucide-react'

type PurchaseRow = {
  detail_id: number
  purchase_id: number
  item_id: number
  quantity: number
  rate: number
  purchase_date: string
  party_name: string
  invoice_no: string
  sku: string
  quality: string
  variant: string | null
}

type SkuAgg = {
  sku: string
  item_id: number
  quality: string
  variant: string | null
  displayName: string
  current_stock: number
  current_cost: number
  purchases: PurchaseRow[]
  minRate: number
  maxRate: number
  latestRate: number
  firstRate: number
  change: number
  changePct: number
  totalQty: number
  suppliers: string[]
  sameInvoice: boolean
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function lastOfMonth() {
  const d = new Date()
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return last.toISOString().slice(0, 10)
}

function startOfWeek() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day
  return new Date(d.setDate(diff)).toISOString().slice(0, 10)
}

function qualityBadgeClass(q: string) {
  if (q === 'OG') return 'bg-blue-100 text-blue-800'
  if (q === '100 OG') return 'bg-indigo-100 text-indigo-800'
  if (q === 'ORG') return 'bg-amber-100 text-amber-800'
  if (q === 'Care OG') return 'bg-emerald-100 text-emerald-800'
  return 'bg-slate-100 text-slate-600'
}

export default function CostHistoryPage() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(lastOfMonth())
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<PurchaseRow[]>([])
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<
    'change-desc' | 'change-asc' | 'sku'
  >('change-desc')

  useEffect(() => {
    loadData()
  }, [from, to])

  async function loadData() {
    setLoading(true)

    const { data: lines } = await supabase
      .from('purchase_items')
      .select(
        'detail_id, purchase_id, item_id, quantity, rate, purchases!inner(purchase_date, invoice_no, party_id)'
      )
      .gte('purchases.purchase_date', from)
      .lte('purchases.purchase_date', to)

    if (!lines || lines.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    const itemIds = Array.from(new Set(lines.map((l: any) => l.item_id)))
    const partyIds = Array.from(
      new Set(
        lines
          .map((l: any) => l.purchases?.party_id)
          .filter((x: any) => typeof x === 'number')
      )
    )

    const [itemsRes, partiesRes] = await Promise.all([
      supabase
        .from('items')
        .select(
          'item_id, sku, current_stock, cost_price, quality, variant'
        )
        .in('item_id', itemIds),
      partyIds.length > 0
        ? supabase
            .from('parties')
            .select('party_id, party_name')
            .in('party_id', partyIds as number[])
        : Promise.resolve({ data: [] as any[] }),
    ])

    const itemMap: Record<number, any> = {}
    for (const it of itemsRes.data || []) itemMap[it.item_id] = it

    const partyMap: Record<number, string> = {}
    for (const p of (partiesRes as any).data || [])
      partyMap[p.party_id] = p.party_name

    const flat: PurchaseRow[] = lines.map((l: any) => {
      const it = itemMap[l.item_id] || {}
      return {
        detail_id: l.detail_id,
        purchase_id: l.purchase_id,
        item_id: l.item_id,
        quantity: Number(l.quantity),
        rate: Number(l.rate),
        purchase_date: l.purchases.purchase_date,
        invoice_no: l.purchases.invoice_no,
        party_name: partyMap[l.purchases.party_id] || '—',
        sku: it.sku || '(unknown)',
        quality: it.quality || 'Normal',
        variant: it.variant || null,
      }
    })

    setRows(flat)
    setLoading(false)
  }

  const aggregates: SkuAgg[] = useMemo(() => {
    const bySku: Record<string, SkuAgg> = {}

    for (const r of rows) {
      if (!bySku[r.sku]) {
        bySku[r.sku] = {
          sku: r.sku,
          item_id: r.item_id,
          quality: r.quality,
          variant: r.variant,
          displayName: '',
          current_stock: 0,
          current_cost: 0,
          purchases: [],
          minRate: r.rate,
          maxRate: r.rate,
          latestRate: r.rate,
          firstRate: r.rate,
          change: 0,
          changePct: 0,
          totalQty: 0,
          suppliers: [],
          sameInvoice: false,
        }
      }
      const a = bySku[r.sku]
      a.purchases.push(r)
      a.totalQty += r.quantity
      a.minRate = Math.min(a.minRate, r.rate)
      a.maxRate = Math.max(a.maxRate, r.rate)
    }

    for (const sku in bySku) {
      const a = bySku[sku]
      a.purchases.sort(
        (x, y) =>
          new Date(x.purchase_date).getTime() -
          new Date(y.purchase_date).getTime()
      )
      a.firstRate = a.purchases[0].rate
      a.latestRate = a.purchases[a.purchases.length - 1].rate
      a.change = a.latestRate - a.firstRate
      a.changePct = a.firstRate > 0 ? (a.change / a.firstRate) * 100 : 0
      a.suppliers = Array.from(new Set(a.purchases.map((p) => p.party_name)))

      // Detect "all lines on same invoice" — usually means variant merger, not a price change
      const invoices = new Set(a.purchases.map((p) => p.invoice_no))
      a.sameInvoice = invoices.size === 1 && a.purchases.length > 1

      // Build search-friendly display name
      const parts: string[] = [a.sku]
      if (a.quality && a.quality !== 'Normal') parts.push(a.quality)
      if (a.variant) parts.push(a.variant)
      a.displayName = parts.join(' · ')
    }

    return Object.values(bySku)
  }, [rows])

  const filtered = useMemo(() => {
    let list = aggregates

    if (search.trim()) {
      const q = search.trim().toUpperCase()
      list = list.filter((a) => a.displayName.toUpperCase().includes(q))
    }

    if (sortBy === 'change-desc') {
      list = [...list].sort((a, b) => b.changePct - a.changePct)
    } else if (sortBy === 'change-asc') {
      list = [...list].sort((a, b) => a.changePct - b.changePct)
    } else {
      list = [...list].sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      )
    }

    return list
  }, [aggregates, search, sortBy])

  const money = (n: number) =>
    `₹ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

  function exportCSV() {
    const headers = [
      'SKU',
      'Quality',
      'Variant',
      'First Rate',
      'Latest Rate',
      'Change',
      'Change %',
      'Min Rate',
      'Max Rate',
      'Total Qty',
      'Suppliers',
      'Same Invoice',
    ]
    const rowsForExport = filtered.map((a) => [
      a.sku,
      a.quality,
      a.variant || '',
      a.firstRate.toFixed(2),
      a.latestRate.toFixed(2),
      a.change.toFixed(2),
      a.changePct.toFixed(2) + '%',
      a.minRate.toFixed(2),
      a.maxRate.toFixed(2),
      a.totalQty,
      a.suppliers.join(' | '),
      a.sameInvoice ? 'YES' : '',
    ])
    const csv = [headers, ...rowsForExport]
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')
      )
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cost-history-${from}_to_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function setRange(mode: 'today' | 'week' | 'month') {
    if (mode === 'today') {
      const t = todayStr()
      setFrom(t)
      setTo(t)
    } else if (mode === 'week') {
      setFrom(startOfWeek())
      setTo(todayStr())
    } else {
      setFrom(firstOfMonth())
      setTo(lastOfMonth())
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <Link
            href="/reports"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            aria-label="Back to reports"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-700" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Cost Change Tracker
            </h1>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mb-5">
          Rate history per SKU. Search matches quality, variant, network.
          Sorted by biggest change first.
        </p>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-5">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex items-center gap-2 text-slate-700 shrink-0">
              <Calendar className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium">Range</span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-slate-400 text-sm">to</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setRange('today')}
                className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Today
              </button>
              <button
                onClick={() => setRange('week')}
                className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Week
              </button>
              <button
                onClick={() => setRange('month')}
                className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Month
              </button>
            </div>

            <div className="flex items-center gap-2 lg:ml-auto">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU, OG, Care, 5G…"
                className="h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-56"
              />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="h-9 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="change-desc">Biggest increase</option>
                <option value="change-asc">Biggest decrease</option>
                <option value="sku">SKU A–Z</option>
              </select>
              <button
                onClick={exportCSV}
                disabled={filtered.length === 0}
                className="h-9 px-3 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            </div>
          </div>
        </div>

        {!loading && (
          <div className="text-xs text-slate-500 mb-3">
            {filtered.length} SKU{filtered.length === 1 ? '' : 's'} purchased
            in range
          </div>
        )}

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
            No purchases in this range.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((a) => {
              const isUp = a.change > 0.01
              const isDown = a.change < -0.01
              const isStable = !isUp && !isDown
              return (
                <div
                  key={a.sku}
                  className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
                >
                  {/* Top row */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="font-mono text-sm font-semibold text-slate-900 break-all">
                          {a.sku}
                        </span>
                        {a.quality && a.quality !== 'Normal' && (
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${qualityBadgeClass(
                              a.quality
                            )}`}
                          >
                            {a.quality}
                          </span>
                        )}
                        {a.variant && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 uppercase tracking-wide">
                            {a.variant}
                          </span>
                        )}
                        {a.sameInvoice && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 uppercase tracking-wide"
                            title="All lines are on the same invoice — likely different variants, not a price change"
                          >
                            Same invoice
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {a.purchases.length} purchase
                        {a.purchases.length === 1 ? '' : 's'} · qty {a.totalQty}{' '}
                        · supplier{a.suppliers.length > 1 ? 's' : ''}:{' '}
                        {a.suppliers.join(', ')}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase text-slate-500 font-medium">
                        Change
                      </div>
                      <div
                        className={`text-sm font-bold flex items-center gap-1 justify-end ${
                          isUp
                            ? 'text-red-600'
                            : isDown
                            ? 'text-green-600'
                            : 'text-slate-500'
                        }`}
                      >
                        {isUp && <TrendingUp className="w-4 h-4" />}
                        {isDown && <TrendingDown className="w-4 h-4" />}
                        {isStable && <Minus className="w-4 h-4" />}
                        {isUp ? '+' : ''}
                        {money(a.change)} ({isUp ? '+' : ''}
                        {a.changePct.toFixed(1)}%)
                      </div>
                    </div>
                  </div>

                  {/* History rows */}
                  <div className="divide-y divide-slate-100">
                    {a.purchases.map((p) => (
                      <div
                        key={p.detail_id}
                        className="px-4 py-2 grid grid-cols-12 gap-2 text-xs items-center"
                      >
                        <div className="col-span-3 sm:col-span-2 text-slate-500">
                          {p.purchase_date}
                        </div>
                        <div className="col-span-4 sm:col-span-3 text-slate-700 truncate">
                          {p.party_name}
                        </div>
                        <div className="col-span-2 text-slate-500 truncate">
                          {p.invoice_no || '—'}
                        </div>
                        <div className="col-span-1 text-right text-slate-700">
                          ×{p.quantity}
                        </div>
                        <div className="col-span-2 text-right font-medium text-slate-900">
                          {money(p.rate)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}