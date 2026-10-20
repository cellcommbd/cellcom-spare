'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getRole } from '../../../lib/auth'
import {
  ArrowLeft,
  Calendar,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  AlertCircle,
  Receipt,
  Wallet,
  DollarSign,
} from 'lucide-react'

type ExpenseType = 'Rent' | 'Staff' | 'Kitty' | 'Bill' | 'Others'

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
  const s = Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  return n < 0 ? `− ₹ ${Math.abs(Number(n)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : `₹ ${s}`
}

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

type ReportData = {
  sales: number
  cogs: number
  gross: number
  margin: number
  losses: number
  expensesByType: Record<ExpenseType, number>
  expensesTotal: number
  net: number
  netMargin: number
  salesCount: number
  linesWithZeroCost: number
  expensesEmpty: boolean
}

export default function ProfitReportPage() {
  const [isOwner, setIsOwner] = useState(false)
  const [roleChecked, setRoleChecked] = useState(false)

  const [fromDate, setFromDate] = useState(firstOfMonthStr())
  const [toDate, setToDate] = useState(todayStr())

  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

    try {
      // Sales + COGS: from sale_items joined to sales for date filter
      const { data: saleItemRows, error: siErr } = await supabase
        .from('sale_items')
        .select(
          'quantity, returned_qty, rate, cost_at_sale, sales!inner(bill_date)'
        )
        .gte('sales.bill_date', fromDate)
        .lte('sales.bill_date', toDate)

      if (siErr) throw new Error(siErr.message)

      const rows = (saleItemRows || []) as any[]

      let sales = 0
      let cogs = 0
      let linesWithZeroCost = 0
      for (const r of rows) {
        const qty = Number(r.quantity || 0)
        const returned = Number(r.returned_qty || 0)
        const net = Math.max(0, qty - returned)
        const rate = Number(r.rate || 0)
        const cost = Number(r.cost_at_sale || 0)
        sales += net * rate
        cogs += net * cost
        if (net > 0 && cost === 0) linesWithZeroCost++
      }

      // Sales count for "N bills" display
      const { data: salesHeaderRows } = await supabase
        .from('sales')
        .select('sale_id')
        .gte('bill_date', fromDate)
        .lte('bill_date', toDate)
      const salesCount = (salesHeaderRows || []).length

      const gross = sales - cogs
      const margin = sales > 0 ? (gross / sales) * 100 : 0

      // Losses in range
      const { data: lossRows } = await supabase
        .from('losses')
        .select('total_amount')
        .gte('loss_date', fromDate)
        .lte('loss_date', toDate)
      const losses = (lossRows || []).reduce(
        (s, r: any) => s + Number(r.total_amount || 0),
        0
      )

      // Expenses in range
      const { data: expenseRows } = await supabase
        .from('expenses')
        .select('expense_type, amount')
        .gte('expense_date', fromDate)
        .lte('expense_date', toDate)

      const expensesByType: Record<ExpenseType, number> = {
        Rent: 0,
        Staff: 0,
        Kitty: 0,
        Bill: 0,
        Others: 0,
      }
      for (const e of expenseRows || []) {
        const t = e.expense_type as ExpenseType
        if (expensesByType[t] !== undefined) {
          expensesByType[t] += Number(e.amount || 0)
        }
      }
      const expensesTotal = Object.values(expensesByType).reduce(
        (a, b) => a + b,
        0
      )
      const expensesEmpty = (expenseRows || []).length === 0

      const net = gross - losses - expensesTotal
      const netMargin = sales > 0 ? (net / sales) * 100 : 0

      setData({
        sales,
        cogs,
        gross,
        margin,
        losses,
        expensesByType,
        expensesTotal,
        net,
        netMargin,
        salesCount,
        linesWithZeroCost,
        expensesEmpty,
      })
    } catch (e: any) {
      setError('Could not load report: ' + (e?.message || 'unknown'))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  function setRange(mode: 'today' | 'month' | 'last_month') {
    const t = todayStr()
    if (mode === 'today') {
      setFromDate(t)
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
      <div className="max-w-3xl mx-auto">

        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-xs sm:text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All reports
        </Link>

        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Profit Report
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Sales, cost of goods, losses, and expenses for the selected period.
          </p>
        </div>

        {/* Date range bar */}
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

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800 mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
            Loading…
          </div>
        ) : !data ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
            No data.
          </div>
        ) : (
          <>
            {/* Net Profit hero */}
            <div
              className={`rounded-2xl p-4 sm:p-5 shadow-sm mb-5 text-white ${
                data.net >= 0
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-500'
                  : 'bg-gradient-to-r from-rose-600 to-rose-500'
              }`}
            >
              <div className="flex items-center gap-2 text-white/80 text-xs font-medium uppercase tracking-wide mb-1">
                {data.net >= 0 ? (
                  <TrendingUp className="w-4 h-4" />
                ) : (
                  <TrendingDown className="w-4 h-4" />
                )}
                Net Profit
              </div>
              <div className="text-3xl sm:text-4xl font-bold">
                {moneySigned(data.net)}
              </div>
              <div className="text-xs text-white/80 mt-1">
                {data.sales > 0
                  ? `${data.netMargin.toFixed(1)}% margin · `
                  : ''}
                {data.salesCount} bill{data.salesCount === 1 ? '' : 's'} ·{' '}
                {formatDate(fromDate)} – {formatDate(toDate)}
              </div>
            </div>

            {/* Warnings */}
            {data.expensesEmpty && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-900">
                  <strong>No expenses recorded this period.</strong> Net profit
                  shown excludes rent, salary, and other operating costs. Add
                  expenses at{' '}
                  <Link
                    href="/expenses"
                    className="underline hover:text-amber-800"
                  >
                    /expenses
                  </Link>
                  .
                </div>
              </div>
            )}
            {data.linesWithZeroCost > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-900">
                  <strong>{data.linesWithZeroCost} line(s) have no cost recorded.</strong>{' '}
                  COGS may be understated, inflating gross profit.
                </div>
              </div>
            )}

            {/* P&L breakdown */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-5">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  Profit &amp; Loss
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                <PLRow
                  icon={<Receipt className="w-4 h-4" />}
                  label="Sales"
                  hint={`${data.salesCount} bill${data.salesCount === 1 ? '' : 's'} (net of returns)`}
                  value={data.sales}
                  tone="positive"
                />
                <PLRow
                  icon={<Receipt className="w-4 h-4" />}
                  label="Cost of Goods Sold"
                  hint="Cost of units actually sold"
                  value={-data.cogs}
                  tone="negative"
                />
                <PLRow
                  label="Gross Profit"
                  hint={
                    data.sales > 0
                      ? `${data.margin.toFixed(1)}% margin`
                      : 'No sales'
                  }
                  value={data.gross}
                  tone={data.gross >= 0 ? 'positive' : 'negative'}
                  bold
                />
                <PLRow
                  icon={<AlertTriangle className="w-4 h-4" />}
                  label="Losses"
                  hint="Damaged / broken inventory (at cost)"
                  value={-data.losses}
                  tone="negative"
                />
                <PLRow
                  icon={<Wallet className="w-4 h-4" />}
                  label="Operating Expenses"
                  hint={
                    data.expensesEmpty
                      ? 'None recorded'
                      : `${Object.values(data.expensesByType).filter((v) => v > 0).length} categories`
                  }
                  value={-data.expensesTotal}
                  tone="negative"
                />

                {/* Expense breakdown */}
                {!data.expensesEmpty && data.expensesTotal > 0 && (
                  <div className="bg-slate-50 px-4 py-2">
                    {(
                      Object.keys(data.expensesByType) as ExpenseType[]
                    ).map((t) => {
                      const v = data.expensesByType[t]
                      if (v === 0) return null
                      return (
                        <div
                          key={t}
                          className="flex items-center justify-between text-xs py-0.5"
                        >
                          <span className="text-slate-600 pl-6">└ {t}</span>
                          <span className="text-slate-700">
                            {money(v)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                <PLRow
                  label="Net Profit"
                  hint={
                    data.sales > 0
                      ? `${data.netMargin.toFixed(1)}% of sales`
                      : ''
                  }
                  value={data.net}
                  tone={data.net >= 0 ? 'positive' : 'negative'}
                  bold
                  large
                />
              </div>
            </div>

            {/* Footer note */}
            <div className="text-xs text-slate-500 text-center px-4 py-3">
              All amounts computed from actual sale lines, losses, and
              expenses. Returns are deducted at the line level.
            </div>
          </>
        )}

      </div>
    </div>
  )
}

// ---------- Sub-components ----------
function PLRow({
  icon,
  label,
  hint,
  value,
  tone,
  bold,
  large,
}: {
  icon?: React.ReactNode
  label: string
  hint?: string
  value: number
  tone: 'positive' | 'negative' | 'neutral'
  bold?: boolean
  large?: boolean
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
      ? value === 0
        ? 'text-slate-500'
        : 'text-rose-700'
      : 'text-slate-800'
  return (
    <div className={`px-4 py-3 flex items-center gap-3 ${bold ? 'bg-slate-50' : ''}`}>
      {icon && <div className="text-slate-400 shrink-0">{icon}</div>}
      {!icon && <div className="w-4 shrink-0" />}
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm ${
            bold ? 'font-semibold text-slate-800' : 'text-slate-700'
          }`}
        >
          {label}
        </div>
        {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
      </div>
      <div
        className={`text-right shrink-0 ${
          large ? 'text-lg font-bold' : bold ? 'text-base font-bold' : 'text-sm font-medium'
        } ${toneClass}`}
      >
        {value < 0 ? moneySigned(value) : money(value)}
      </div>
    </div>
  )
}