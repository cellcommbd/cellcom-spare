'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getRole } from '../../../lib/auth'
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Package,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

type ProfitRow = {
  item_id: number
  sku: string
  qty: number
  revenue: number
  cogs: number
  profit: number
  margin_pct: number
  bill_count: number
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

function moneySigned(n: number) {
  if (n < 0) {
    return `− ₹ ${Math.abs(Number(n)).toLocaleString('en-IN', {
      maximumFractionDigits: 2,
    })}`
  }
  return money(n)
}

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function ProfitPerItemReportPage() {
  const [isOwner, setIsOwner] = useState(false)
  const [roleChecked, setRoleChecked] = useState(false)

  const [fromDate, setFromDate] = useState(firstOfMonthStr())
  const [toDate, setToDate] = useState(todayStr())

  const [rows, setRows] = useState<ProfitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [sortBy, setSortBy] = useState<'profit' | 'margin' | 'revenue'>(
    'profit'
  )
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const r = getRole()
    setIsOwner(r === 'owner')
    setRoleChecked(true)
  }, [])

  useEffect(() => {
    if (isOwner) loadReport()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, fromDate, toDate])

  async function loadReport() {
    setLoading(true)
    setError('')

    const { data, error: err } = await supabase
      .from('sale_items')
      .select(
        'item_id, quantity, returned_qty, rate, cost_at_sale, sale_id, sales!inner(bill_date)'
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

    // Aggregate by item_id
    const agg: Record<
      number,
      {
        item_id: number
        qty: number
        revenue: number
        cogs: number
        billIds: Set<number>
      }
    > = {}

    for (const r of raw) {
      const itemId = r.item_id
      const qty = Number(r.quantity || 0)
      const ret = Number(r.returned_qty || 0)
      const net = Math.max(0, qty - ret)
      if (net <= 0) continue

      const rate = Number(r.rate || 0)
      const cost = Number(r.cost_at_sale || 0)

      if (!agg[itemId]) {
        agg[itemId] = {
          item_id: itemId,
          qty: 0,
          revenue: 0,
          cogs: 0,
          billIds: new Set(),
        }
      }
      agg[itemId].qty += net
      agg[itemId].revenue += net * rate
      agg[itemId].cogs += net * cost
      agg[itemId].billIds.add(r.sale_id)
    }

    const itemIds = Object.keys(agg).map((id) => Number(id))
    if (itemIds.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    const { data: itemRows } = await supabase
      .from('items')
      .select('item_id, sku')
      .in('item_id', itemIds)

    const skuMap: Record<number, string> = {}
    for (const it of itemRows || []) skuMap[it.item_id] = it.sku

    const result: ProfitRow[] = Object.values(agg).map((a) => {
      const profit = a.revenue - a.cogs
      const margin_pct = a.revenue > 0 ? (profit / a.revenue) * 100 : 0
      return {
        item_id: a.item_id,
        sku: skuMap[a.item_id] || '(unknown)',
        qty: a.qty,
        revenue: a.revenue,
        cogs: a.cogs,
        profit,
        margin_pct,
        bill_count: a.billIds.size,
      }
    })

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
    if (sortBy === 'profit') {
      copy.sort((a, b) => b.profit - a.profit)
    } else if (sortBy === 'margin') {
      copy.sort((a, b) => b.margin_pct - a.margin_pct)
    } else {
      copy.sort((a, b) => b.revenue - a.revenue)
    }
    return copy
  }, [rows, sortBy])

  const displayed = showAll ? sorted : sorted.slice(0, 50)

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenue,
        cogs: acc.cogs + r.cogs,
        profit: acc.profit + r.profit,
        qty: acc.qty + r.qty,
      }),
      { revenue: 0, cogs: 0, profit: 0, qty: 0 }
    )
  }, [rows])

  const overallMargin =
    totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0

  // ---------- Role gate ----------
  if (roleChecked && !isOwner) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <div className="text-slate-700 font-medium mb-1">
            Owner access required.
          </div>
          <div className="text-xs text-slate-500">
            Profit reports are visible to the shop owner only.
          </div>
          <Link
            href="/reports"
            className="mt-3 inline-block text-sm text-indigo-600 hover:text-indigo-800 underline"
          >
            ← Back to reports
          </Link>
        </div>
      </div>
    )
  }

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
            <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Profit per Item
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Which SKUs earn the most, and which barely break even.
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
        {!loading && rows.length > 0 && (
          <div
            className={`rounded-2xl p-4 sm:p-5 shadow-sm mb-4 text-white ${
              totals.profit >= 0
                ? 'bg-gradient-to-r from-emerald-600 to-emerald-500'
                : 'bg-gradient-to-r from-rose-600 to-rose-500'
            }`}
          >
            <div className="flex items-center gap-2 text-white/80 text-xs font-medium uppercase tracking-wide mb-1">
              {totals.profit >= 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              Total Gross Profit
            </div>
            <div className="text-3xl sm:text-4xl font-bold">
              {moneySigned(totals.profit)}
            </div>
            <div className="text-xs text-white/80 mt-1">
              {overallMargin.toFixed(1)}% overall margin ·{' '}
              {totals.qty.toFixed(0)} units sold · {rows.length} SKUs
            </div>
          </div>
        )}

        {/* Sort toggles */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs text-slate-500">Sort by:</span>
          <button
            onClick={() => setSortBy('profit')}
            className={`h-8 px-3 text-xs font-semibold rounded-lg ${
              sortBy === 'profit'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Profit
          </button>
          <button
            onClick={() => setSortBy('margin')}
            className={`h-8 px-3 text-xs font-semibold rounded-lg ${
              sortBy === 'margin'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Margin %
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

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800 mb-4">
            {error}
          </div>
        )}

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
            <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
              <div className="col-span-1">#</div>
              <div className="col-span-5">SKU</div>
              <div className="col-span-2 text-right">Qty</div>
              <div className="col-span-2 text-right">Revenue</div>
              <div className="col-span-2 text-right">Profit</div>
            </div>

            <div className="divide-y divide-slate-100">
              {displayed.map((r, idx) => {
                const rank = idx + 1
                const isPositive = r.profit >= 0
                const isLoss = r.profit < 0
                const marginClass =
                  r.margin_pct >= 20
                    ? 'text-emerald-700'
                    : r.margin_pct >= 5
                    ? 'text-amber-700'
                    : 'text-rose-700'
                return (
                  <div
                    key={r.item_id}
                    className="px-3 sm:px-4 py-3 grid grid-cols-12 gap-2 items-center"
                  >
                    <div className="col-span-2 sm:col-span-1">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                          rank <= 3 && isPositive
                            ? 'bg-emerald-100 text-emerald-800'
                            : isLoss
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {rank}
                      </div>
                    </div>
                    <div className="col-span-10 sm:col-span-5 min-w-0">
                      <div className="font-mono text-sm text-slate-800 truncate">
                        {r.sku}
                      </div>
                      <div className="sm:hidden text-[11px] text-slate-500 mt-0.5">
                        {r.qty} units · {money(r.revenue)} ·{' '}
                        <span className={marginClass}>
                          {r.margin_pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="hidden sm:block col-span-2 text-right text-sm text-slate-700">
                      {r.qty}
                    </div>
                    <div className="hidden sm:block col-span-2 text-right text-sm text-slate-700">
                      {money(r.revenue)}
                    </div>
                    <div className="hidden sm:block col-span-2 text-right">
                      <div
                        className={`text-sm font-bold ${
                          isPositive ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {moneySigned(r.profit)}
                      </div>
                      <div className={`text-[10px] ${marginClass}`}>
                        {r.margin_pct.toFixed(1)}%
                      </div>
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