'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import {
  ArrowLeft,
  Calendar,
  Flame,
  TrendingUp,
  Package,
} from 'lucide-react'

type FastMoveRow = {
  item_id: number
  sku: string
  total_qty: number
  total_revenue: number
  bill_count: number
  avg_rate: number
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
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

export default function FastMovingReportPage() {
  const [fromDate, setFromDate] = useState(firstOfMonthStr())
  const [toDate, setToDate] = useState(todayStr())

  const [rows, setRows] = useState<FastMoveRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [sortBy, setSortBy] = useState<'units' | 'revenue'>('units')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    loadReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate])

  async function loadReport() {
    setLoading(true)
    setError('')

    // Fetch sale_items joined to sales for date filter, and items for SKU
    const { data, error: err } = await supabase
      .from('sale_items')
      .select(
        'item_id, quantity, returned_qty, rate, amount, sale_id, sales!inner(bill_date)'
      )
      .gte('sales.bill_date', fromDate)
      .lte('sales.bill_date', toDate)

    if (err) {
      setError('Could not load report: ' + err.message)
      setRows([])
      setLoading(false)
      return
    }

    const raw = (data || []) as any[]

    // Aggregate by item_id: net qty (qty − returned_qty), net revenue
    const agg: Record<
      number,
      {
        item_id: number
        total_qty: number
        total_revenue: number
        billIds: Set<number>
      }
    > = {}

    for (const r of raw) {
      const itemId = r.item_id
      const qty = Number(r.quantity || 0)
      const ret = Number(r.returned_qty || 0)
      const net = Math.max(0, qty - ret)
      if (net <= 0) continue

      if (!agg[itemId]) {
        agg[itemId] = {
          item_id: itemId,
          total_qty: 0,
          total_revenue: 0,
          billIds: new Set(),
        }
      }
      // Revenue per unit at the rate sold. Since amount = quantity * rate,
      // net revenue = net * rate (approximates what we actually got back)
      agg[itemId].total_qty += net
      agg[itemId].total_revenue += net * Number(r.rate || 0)
      agg[itemId].billIds.add(r.sale_id)
    }

    const itemIds = Object.keys(agg).map((id) => Number(id))
    if (itemIds.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    // Fetch SKUs
    const { data: itemRows } = await supabase
      .from('items')
      .select('item_id, sku')
      .in('item_id', itemIds)

    const skuMap: Record<number, string> = {}
    for (const it of itemRows || []) skuMap[it.item_id] = it.sku

    const result: FastMoveRow[] = Object.values(agg).map((a) => ({
      item_id: a.item_id,
      sku: skuMap[a.item_id] || '(unknown)',
      total_qty: a.total_qty,
      total_revenue: a.total_revenue,
      bill_count: a.billIds.size,
      avg_rate: a.total_qty > 0 ? a.total_revenue / a.total_qty : 0,
    }))

    setRows(result)
    setLoading(false)
  }

  function setRange(mode: 'today' | 'week' | 'month' | 'last_month') {
    const t = todayStr()
    if (mode === 'today') {
      setFromDate(t)
      setToDate(t)
    } else if (mode === 'week') {
      const d = new Date()
      const day = d.getDay()
      const diff = d.getDate() - day
      const start = new Date(d.setDate(diff))
      setFromDate(start.toISOString().slice(0, 10))
      setToDate(t)
    } else if (mode === 'month') {
      setFromDate(firstOfMonthStr())
      setToDate(t)
    } else {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - 1)
      const fm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      const lm = lastDay.toISOString().slice(0, 10)
      setFromDate(fm)
      setToDate(lm)
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows]
    if (sortBy === 'units') {
      copy.sort((a, b) => b.total_qty - a.total_qty)
    } else {
      copy.sort((a, b) => b.total_revenue - a.total_revenue)
    }
    return copy
  }, [rows, sortBy])

  const displayed = showAll ? sorted : sorted.slice(0, 50)

  const totalUnits = rows.reduce((s, r) => s + r.total_qty, 0)
  const totalRevenue = rows.reduce((s, r) => s + r.total_revenue, 0)

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">

        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-xs sm:text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All reports
        </Link>

        <div className="mb-4 sm:mb-6">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Fast-Moving Items
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            What's selling in the selected period. Ranked by units or revenue.
          </p>
        </div>

        {/* Date range */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-4">
          <div className="flex items-center gap-2 text-slate-700 mb-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span className="text-xs sm:text-sm font-medium">Date range</span>
            {loading && (
              <span className="text-[10px] text-slate-400 ml-auto">
                Loading…
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="flex-1 h-9 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
            <span className="text-slate-400 text-sm shrink-0">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="flex-1 h-9 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
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
            <button
              onClick={() => setRange('last_month')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Last Month
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-2xl p-4 sm:p-5 shadow-sm mb-4 text-white">
          <div className="flex items-center gap-2 text-white/80 text-xs font-medium uppercase tracking-wide mb-1">
            <TrendingUp className="w-4 h-4" />
            Period Summary
          </div>
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <div>
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                SKUs Sold
              </div>
              <div className="text-lg sm:text-2xl font-bold mt-0.5">
                {rows.length}
              </div>
            </div>
            <div className="border-l border-white/20 pl-3 sm:pl-4">
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Units
              </div>
              <div className="text-lg sm:text-2xl font-bold mt-0.5">
                {totalUnits}
              </div>
            </div>
            <div className="border-l border-white/20 pl-3 sm:pl-4">
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Revenue
              </div>
              <div className="text-lg sm:text-2xl font-bold mt-0.5">
                {money(totalRevenue)}
              </div>
            </div>
          </div>
          <div className="text-[10px] sm:text-xs text-white/70 mt-2">
            {formatDate(fromDate)} – {formatDate(toDate)}
          </div>
        </div>

        {/* Sort toggle */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-slate-500">Sort by:</span>
          <button
            onClick={() => setSortBy('units')}
            className={`h-8 px-3 text-xs font-semibold rounded-lg ${
              sortBy === 'units'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Units
          </button>
          <button
            onClick={() => setSortBy('revenue')}
            className={`h-8 px-3 text-xs font-semibold rounded-lg ${
              sortBy === 'revenue'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Revenue
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800 mb-4">
            {error}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-600">
              No sales in this range.
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Try widening the date range.
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {/* Header row */}
            <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
              <div className="col-span-1">#</div>
              <div className="col-span-6">SKU</div>
              <div className="col-span-2 text-right">Units</div>
              <div className="col-span-3 text-right">Revenue</div>
            </div>

            <div className="divide-y divide-slate-100">
              {displayed.map((r, idx) => {
                const rank = idx + 1
                const isTop3 = rank <= 3
                return (
                  <div
                    key={r.item_id}
                    className="px-3 sm:px-4 py-3 grid grid-cols-12 gap-2 items-center"
                  >
                    <div className="col-span-2 sm:col-span-1">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                          isTop3
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {rank}
                      </div>
                    </div>
                    <div className="col-span-10 sm:col-span-6 min-w-0">
                      <div className="font-mono text-sm text-slate-800 truncate">
                        {r.sku}
                      </div>
                      <div className="sm:hidden text-[11px] text-slate-500 mt-0.5">
                        {r.total_qty} units · {money(r.total_revenue)}
                      </div>
                    </div>
                    <div className="hidden sm:block col-span-2 text-right text-sm font-semibold text-slate-800">
                      {r.total_qty}
                    </div>
                    <div className="hidden sm:block col-span-3 text-right text-sm font-bold text-slate-900">
                      {money(r.total_revenue)}
                    </div>
                  </div>
                )
              })}
            </div>

            {rows.length > 50 && !showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full py-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 border-t border-slate-200"
              >
                Show all {rows.length} SKUs
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  )
}