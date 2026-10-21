'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getRole } from '../../../lib/auth'
import {
  ArrowLeft,
  Calendar,
  Store,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Trophy,
} from 'lucide-react'

type PurchaseLine = {
  item_id: number
  party_id: number
  quantity: number
  rate: number
  purchase_date: string
}

type SupplierAgg = {
  party_id: number
  party_name: string
  avg_rate: number
  last_rate: number
  last_date: string
  total_qty: number
  lines: number
}

type SkuGroup = {
  item_id: number
  sku: string
  suppliers: SupplierAgg[]
  cheapest_party_id: number | null
  most_expensive_party_id: number | null
  spread: number
  spread_pct: number
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function ninetyDaysAgoStr() {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
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

export default function SupplierPricesReportPage() {
  const [isOwner, setIsOwner] = useState(false)
  const [roleChecked, setRoleChecked] = useState(false)

  const [fromDate, setFromDate] = useState(ninetyDaysAgoStr())
  const [toDate, setToDate] = useState(todayStr())

  const [groups, setGroups] = useState<SkuGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

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
      .from('purchase_items')
      .select(
        'item_id, quantity, rate, purchases!inner(party_id, purchase_date)'
      )
      .gte('purchases.purchase_date', fromDate)
      .lte('purchases.purchase_date', toDate)

    if (err) {
      setError('Could not load report: ' + err.message)
      setGroups([])
      setLoading(false)
      return
    }

    const raw = (data || []) as any[]

    const byItem: Record<
      number,
      Record<
        number,
        {
          qty: number
          sumRateQty: number
          lines: number
          last_rate: number
          last_date: string
        }
      >
    > = {}

    for (const r of raw) {
      const itemId = r.item_id
      const partyId = r.purchases?.party_id
      const date = r.purchases?.purchase_date
      const qty = Number(r.quantity || 0)
      const rate = Number(r.rate || 0)
      if (!itemId || !partyId || !date || qty <= 0) continue

      if (!byItem[itemId]) byItem[itemId] = {}
      if (!byItem[itemId][partyId]) {
        byItem[itemId][partyId] = {
          qty: 0,
          sumRateQty: 0,
          lines: 0,
          last_rate: rate,
          last_date: date,
        }
      }
      const a = byItem[itemId][partyId]
      a.qty += qty
      a.sumRateQty += rate * qty
      a.lines += 1
      if (date > a.last_date) {
        a.last_date = date
        a.last_rate = rate
      }
    }

    const qualifying: number[] = []
    for (const itemId in byItem) {
      if (Object.keys(byItem[itemId]).length >= 2) {
        qualifying.push(Number(itemId))
      }
    }

    if (qualifying.length === 0) {
      setGroups([])
      setLoading(false)
      return
    }

    const { data: itemRows } = await supabase
      .from('items')
      .select('item_id, sku')
      .in('item_id', qualifying)
    const skuMap: Record<number, string> = {}
    for (const it of itemRows || []) skuMap[it.item_id] = it.sku

    const partyIds = Array.from(
      new Set(raw.map((r: any) => r.purchases?.party_id).filter(Boolean))
    )
    let partyMap: Record<number, string> = {}
    if (partyIds.length > 0) {
      const { data: partyRows } = await supabase
        .from('parties')
        .select('party_id, party_name')
        .in('party_id', partyIds as number[])
      for (const p of partyRows || []) partyMap[p.party_id] = p.party_name
    }

    const result: SkuGroup[] = qualifying.map((itemId) => {
      const suppliers: SupplierAgg[] = Object.entries(byItem[itemId]).map(
        ([pid, a]) => ({
          party_id: Number(pid),
          party_name: partyMap[Number(pid)] || '—',
          avg_rate: a.qty > 0 ? a.sumRateQty / a.qty : 0,
          last_rate: a.last_rate,
          last_date: a.last_date,
          total_qty: a.qty,
          lines: a.lines,
        })
      )
      suppliers.sort((a, b) => a.avg_rate - b.avg_rate)

      const cheapest = suppliers[0]
      const expensive = suppliers[suppliers.length - 1]
      const spread = expensive.avg_rate - cheapest.avg_rate
      const spread_pct =
        cheapest.avg_rate > 0 ? (spread / cheapest.avg_rate) * 100 : 0

      return {
        item_id: itemId,
        sku: skuMap[itemId] || '(unknown)',
        suppliers,
        cheapest_party_id: cheapest.party_id,
        most_expensive_party_id: expensive.party_id,
        spread,
        spread_pct,
      }
    })

    result.sort((a, b) => b.spread_pct - a.spread_pct)

    setGroups(result)
    setLoading(false)
  }

  function setRange(mode: 'month' | 'quarter' | 'year' | 'all') {
    const t = todayStr()
    if (mode === 'month') {
      const d = new Date()
      const fm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      setFromDate(fm)
      setToDate(t)
    } else if (mode === 'quarter') {
      setFromDate(ninetyDaysAgoStr())
      setToDate(t)
    } else if (mode === 'year') {
      const d = new Date()
      d.setFullYear(d.getFullYear() - 1)
      setFromDate(d.toISOString().slice(0, 10))
      setToDate(t)
    } else {
      setFromDate('2020-01-01')
      setToDate(t)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => g.sku.toLowerCase().includes(q))
  }, [groups, search])

  function toggle(itemId: number) {
    setExpanded((prev) => ({ ...prev, [itemId]: !prev[itemId] }))
  }

  const totalSkus = groups.length
  const totalSavingsPotential = groups.reduce(
    (s, g) => s + g.spread * g.suppliers[0].total_qty,
    0
  )

  if (roleChecked && !isOwner) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <div className="text-slate-700 font-medium mb-1">
            Owner access required.
          </div>
          <div className="text-xs text-slate-500">
            Supplier price comparison is visible to the shop owner only.
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
            <Store className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Supplier Price Comparison
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            SKUs bought from 2+ suppliers. Sorted by biggest price spread.
          </p>
        </div>

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
              onClick={() => setRange('month')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              This Month
            </button>
            <button
              onClick={() => setRange('quarter')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Last 90 Days
            </button>
            <button
              onClick={() => setRange('year')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Last Year
            </button>
            <button
              onClick={() => setRange('all')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              All Time
            </button>
          </div>
        </div>

        {!loading && groups.length > 0 && (
          <div className="bg-gradient-to-r from-purple-600 to-purple-500 rounded-2xl p-4 sm:p-5 shadow-sm mb-4 text-white">
            <div className="flex items-center gap-2 text-white/80 text-xs font-medium uppercase tracking-wide mb-1">
              <Trophy className="w-4 h-4" />
              Savings Opportunity
            </div>
            <div className="text-2xl sm:text-3xl font-bold">
              {money(totalSavingsPotential)}
            </div>
            <div className="text-xs text-white/80 mt-1">
              {totalSkus} SKU{totalSkus === 1 ? '' : 's'} bought from multiple
              suppliers · buy all from cheapest
            </div>
          </div>
        )}

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU…"
            className="w-full h-10 pl-9 pr-9 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded"
              aria-label="Clear"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
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
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <Store className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-600">
              {search
                ? `No SKUs match "${search}"`
                : 'No SKUs bought from multiple suppliers in this range.'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {search
                ? 'Try a different search term.'
                : 'Try widening the date range, or buy the same SKU from 2+ suppliers.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((g) => {
              const isOpen = !!expanded[g.item_id]
              return (
                <div
                  key={g.item_id}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm"
                >
                  <button
                    onClick={() => toggle(g.item_id)}
                    className="w-full px-3 sm:px-4 py-3 flex items-center gap-3 hover:bg-slate-50 text-left"
                  >
                    <div className="shrink-0 text-slate-400">
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm font-semibold text-slate-900 truncate">
                        {g.sku}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {g.suppliers.length} suppliers · spread{' '}
                        {money(g.spread)} ({g.spread_pct.toFixed(1)}%)
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-slate-500">Cheapest</div>
                      <div className="text-sm font-bold text-emerald-700">
                        {money(g.suppliers[0].avg_rate)}
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="bg-slate-50 border-t border-slate-100 px-3 sm:px-4 py-3">
                      <div className="space-y-2">
                        {g.suppliers.map((s) => {
                          const isCheapest =
                            s.party_id === g.cheapest_party_id
                          const isExpensive =
                            s.party_id === g.most_expensive_party_id &&
                            g.suppliers.length > 1
                          return (
                            <div
                              key={s.party_id}
                              className={`flex items-center gap-3 p-2 rounded-lg ${
                                isCheapest
                                  ? 'bg-emerald-50 border border-emerald-200'
                                  : isExpensive
                                  ? 'bg-rose-50 border border-rose-200'
                                  : 'bg-white border border-slate-200'
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-slate-800 truncate">
                                  {s.party_name}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {s.total_qty} units · {s.lines} purchase
                                  {s.lines === 1 ? '' : 's'} · last{' '}
                                  {formatDate(s.last_date)}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-xs text-slate-500">
                                  Avg rate
                                </div>
                                <div
                                  className={`text-sm font-bold ${
                                    isCheapest
                                      ? 'text-emerald-700'
                                      : isExpensive
                                      ? 'text-rose-700'
                                      : 'text-slate-800'
                                  }`}
                                >
                                  {money(s.avg_rate)}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  last {money(s.last_rate)}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}