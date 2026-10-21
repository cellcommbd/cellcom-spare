'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import {
  ArrowLeft,
  Calendar,
  Receipt,
  Wallet,
  Package,
  RotateCcw,
  Activity,
  PackageX,
  ChevronRight,
} from 'lucide-react'

type ActivityRow = {
  kind: 'sale' | 'payment' | 'purchase' | 'return' | 'loss'
  ref_id: number
  date: string
  party_id: number | null
  party_name: string
  amount: number
  subtitle: string
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

export default function RecentActivityReportPage() {
  const [fromDate, setFromDate] = useState(firstOfMonthStr())
  const [toDate, setToDate] = useState(todayStr())

  const [rows, setRows] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [filter, setFilter] = useState<
    'all' | 'sale' | 'payment' | 'purchase' | 'return' | 'loss'
  >('all')

  useEffect(() => {
    loadReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate])

  async function loadReport() {
    setLoading(true)
    setError('')

    try {
      // Fetch all five types in parallel
      const [salesRes, paymentsRes, purchasesRes, returnsRes, lossesRes] =
        await Promise.all([
          supabase
            .from('sales')
            .select('sale_id, party_id, bill_date, total_amount, status')
            .gte('bill_date', fromDate)
            .lte('bill_date', toDate),
          supabase
            .from('payments')
            .select('payment_id, party_id, payment_date, amount, payment_mode')
            .gte('payment_date', fromDate)
            .lte('payment_date', toDate),
          supabase
            .from('purchases')
            .select('purchase_id, party_id, purchase_date, invoice_no, total_amount')
            .gte('purchase_date', fromDate)
            .lte('purchase_date', toDate),
          supabase
            .from('returns')
            .select('return_id, party_id, return_date, item_id, quantity, total_amount, return_type, is_sellable')
            .gte('return_date', fromDate)
            .lte('return_date', toDate),
          supabase
            .from('losses')
            .select('loss_id, item_id, loss_date, quantity, total_amount, reason')
            .gte('loss_date', fromDate)
            .lte('loss_date', toDate),
        ])

      if (salesRes.error) throw new Error(salesRes.error.message)
      if (paymentsRes.error) throw new Error(paymentsRes.error.message)
      if (purchasesRes.error) throw new Error(purchasesRes.error.message)
      if (returnsRes.error) throw new Error(returnsRes.error.message)
      if (lossesRes.error) throw new Error(lossesRes.error.message)

      const sales = (salesRes.data || []) as any[]
      const payments = (paymentsRes.data || []) as any[]
      const purchases = (purchasesRes.data || []) as any[]
      const returns = (returnsRes.data || []) as any[]
      const losses = (lossesRes.data || []) as any[]

      // Collect all party IDs and item IDs for lookup
      const partyIds = Array.from(
        new Set(
          [
            ...sales.map((s) => s.party_id),
            ...payments.map((p) => p.party_id),
            ...purchases.map((p) => p.party_id),
            ...returns.map((r) => r.party_id),
          ].filter(Boolean)
        )
      )

      const returnItemIds = Array.from(
        new Set(returns.map((r) => r.item_id).filter(Boolean))
      )
      const lossItemIds = Array.from(
        new Set(losses.map((l) => l.item_id).filter(Boolean))
      )
      const allItemIds = Array.from(
        new Set([...returnItemIds, ...lossItemIds])
      )

      // Fetch party names
      let partyMap: Record<number, string> = {}
      if (partyIds.length > 0) {
        const { data: partyRows } = await supabase
          .from('parties')
          .select('party_id, party_name')
          .in('party_id', partyIds as number[])
        for (const p of partyRows || []) partyMap[p.party_id] = p.party_name
      }

      // Fetch item SKUs for returns + losses
      let skuMap: Record<number, string> = {}
      if (allItemIds.length > 0) {
        const { data: itemRows } = await supabase
          .from('items')
          .select('item_id, sku')
          .in('item_id', allItemIds as number[])
        for (const it of itemRows || []) skuMap[it.item_id] = it.sku
      }

      // Build activity rows
      const activity: ActivityRow[] = []

      for (const s of sales) {
        activity.push({
          kind: 'sale',
          ref_id: s.sale_id,
          date: s.bill_date,
          party_id: s.party_id,
          party_name: partyMap[s.party_id] || '—',
          amount: Number(s.total_amount || 0),
          subtitle: s.status || '',
        })
      }

      for (const p of payments) {
        activity.push({
          kind: 'payment',
          ref_id: p.payment_id,
          date: p.payment_date,
          party_id: p.party_id,
          party_name: partyMap[p.party_id] || '—',
          amount: Number(p.amount || 0),
          subtitle: p.payment_mode || '',
        })
      }

      for (const pu of purchases) {
        activity.push({
          kind: 'purchase',
          ref_id: pu.purchase_id,
          date: pu.purchase_date,
          party_id: pu.party_id,
          party_name: partyMap[pu.party_id] || '—',
          amount: Number(pu.total_amount || 0),
          subtitle: pu.invoice_no ? `Inv ${pu.invoice_no}` : '',
        })
      }

      for (const r of returns) {
        const sku = skuMap[r.item_id] || '(unknown)'
        const typeLabel = r.return_type === 'Supplier' ? 'to supplier' : 'from customer'
        activity.push({
          kind: 'return',
          ref_id: r.return_id,
          date: r.return_date,
          party_id: r.party_id,
          party_name: partyMap[r.party_id] || '—',
          amount: Number(r.total_amount || 0),
          subtitle: `${sku} × ${r.quantity} · ${typeLabel}${r.is_sellable ? '' : ' · not sellable'}`,
        })
      }

      for (const l of losses) {
        const sku = skuMap[l.item_id] || '(unknown)'
        activity.push({
          kind: 'loss',
          ref_id: l.loss_id,
          date: l.loss_date,
          party_id: null,
          party_name: '—',
          amount: Number(l.total_amount || 0),
          subtitle: `${sku} × ${l.quantity} · ${l.reason || 'damaged'}`,
        })
      }

      // Sort by date desc, then by kind for stable tiebreaker
      activity.sort((a, b) => {
        if (a.date < b.date) return 1
        if (a.date > b.date) return -1
        return b.ref_id - a.ref_id
      })

      setRows(activity)
    } catch (e: any) {
      setError('Could not load report: ' + (e?.message || 'unknown'))
      setRows([])
    } finally {
      setLoading(false)
    }
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

  const filtered = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter((r) => r.kind === filter)
  }, [rows, filter])

  const counts = useMemo(
    () => ({
      sale: rows.filter((r) => r.kind === 'sale').length,
      payment: rows.filter((r) => r.kind === 'payment').length,
      purchase: rows.filter((r) => r.kind === 'purchase').length,
      return: rows.filter((r) => r.kind === 'return').length,
      loss: rows.filter((r) => r.kind === 'loss').length,
    }),
    [rows]
  )

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
            <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Recent Activity
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Sales, payments, purchases, returns, and losses in one timeline.
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

        {/* Filter pills */}
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
          <FilterPill
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label={`All (${rows.length})`}
          />
          <FilterPill
            active={filter === 'sale'}
            onClick={() => setFilter('sale')}
            label={`Sales (${counts.sale})`}
            color="rose"
          />
          <FilterPill
            active={filter === 'payment'}
            onClick={() => setFilter('payment')}
            label={`Payments (${counts.payment})`}
            color="emerald"
          />
          <FilterPill
            active={filter === 'purchase'}
            onClick={() => setFilter('purchase')}
            label={`Purchases (${counts.purchase})`}
            color="indigo"
          />
          <FilterPill
            active={filter === 'return'}
            onClick={() => setFilter('return')}
            label={`Returns (${counts.return})`}
            color="amber"
          />
          <FilterPill
            active={filter === 'loss'}
            onClick={() => setFilter('loss')}
            label={`Losses (${counts.loss})`}
            color="slate"
          />
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
            <Activity className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-600">
              No activity in this range.
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Try widening the date range or clearing the filter.
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="divide-y divide-slate-100">
              {filtered.slice(0, 200).map((r) => (
                <ActivityRowItem key={`${r.kind}-${r.ref_id}`} row={r} />
              ))}
            </div>
            {filtered.length > 200 && (
              <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 text-center">
                Showing first 200 of {filtered.length}. Narrow the date range to
                see fewer.
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ---------- Sub-components ----------
function FilterPill({
  active,
  onClick,
  label,
  color = 'slate',
}: {
  active: boolean
  onClick: () => void
  label: string
  color?: 'slate' | 'rose' | 'emerald' | 'indigo' | 'amber'
}) {
  const activeColors: Record<typeof color, string> = {
    slate: 'bg-slate-700 text-white',
    rose: 'bg-rose-600 text-white',
    emerald: 'bg-emerald-600 text-white',
    indigo: 'bg-indigo-600 text-white',
    amber: 'bg-amber-600 text-white',
  }
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
        active
          ? activeColors[color]
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

function ActivityRowItem({ row }: { row: ActivityRow }) {
  const config: Record<
    ActivityRow['kind'],
    {
      Icon: any
      iconBg: string
      iconText: string
      label: string
      amountClass: string
    }
  > = {
    sale: {
      Icon: Receipt,
      iconBg: 'bg-rose-100',
      iconText: 'text-rose-700',
      label: 'Sale',
      amountClass: 'text-slate-900',
    },
    payment: {
      Icon: Wallet,
      iconBg: 'bg-emerald-100',
      iconText: 'text-emerald-700',
      label: 'Payment',
      amountClass: 'text-emerald-700',
    },
    purchase: {
      Icon: Package,
      iconBg: 'bg-indigo-100',
      iconText: 'text-indigo-700',
      label: 'Purchase',
      amountClass: 'text-indigo-700',
    },
    return: {
      Icon: RotateCcw,
      iconBg: 'bg-amber-100',
      iconText: 'text-amber-700',
      label: 'Return',
      amountClass: 'text-amber-700',
    },
    loss: {
      Icon: PackageX,
      iconBg: 'bg-slate-100',
      iconText: 'text-slate-600',
      label: 'Loss',
      amountClass: 'text-slate-600',
    },
  }

  const c = config[row.kind]
  const Icon = c.Icon

  return (
    <div className="px-3 sm:px-4 py-3 flex items-center gap-3">
      <div
        className={`w-9 h-9 rounded-lg ${c.iconBg} ${c.iconText} flex items-center justify-center shrink-0`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900 truncate">
            {row.party_name}
          </span>
          <span
            className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${c.iconBg} ${c.iconText}`}
          >
            {c.label}
          </span>
        </div>
        <div className="text-[11px] text-slate-500 truncate mt-0.5">
          {formatDate(row.date)}
          {row.subtitle && <> · {row.subtitle}</>}
        </div>
      </div>
      <div className={`text-sm font-bold shrink-0 ${c.amountClass}`}>
        {money(row.amount)}
      </div>
    </div>
  )
}