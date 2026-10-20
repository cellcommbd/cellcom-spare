'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getRole } from '../../../lib/auth'
import {
  ArrowLeft,
  Calendar,
  Wallet,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  TrendingDown,
} from 'lucide-react'

type ExpenseType = 'Rent' | 'Staff' | 'Kitty' | 'Bill' | 'Others'

type Expense = {
  expense_id: number
  expense_date: string
  expense_type: ExpenseType
  amount: number
  note: string | null
  created_at: string | null
}

const EXPENSE_TYPES: ExpenseType[] = [
  'Rent',
  'Staff',
  'Kitty',
  'Bill',
  'Others',
]

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

function formatDateShort(d: string) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  })
}

const TYPE_COLORS: Record<ExpenseType, { bg: string; text: string }> = {
  Rent: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  Staff: { bg: 'bg-amber-100', text: 'text-amber-700' },
  Kitty: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Bill: { bg: 'bg-blue-100', text: 'text-blue-700' },
  Others: { bg: 'bg-slate-100', text: 'text-slate-700' },
}

export default function ExpensesReportPage() {
  const [isOwner, setIsOwner] = useState(false)
  const [roleChecked, setRoleChecked] = useState(false)

  const [fromDate, setFromDate] = useState(firstOfMonthStr())
  const [toDate, setToDate] = useState(todayStr())

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const r = getRole()
    setIsOwner(r === 'owner')
    setRoleChecked(true)
  }, [])

  useEffect(() => {
    if (isOwner) loadExpenses()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, fromDate, toDate])

  async function loadExpenses() {
    setLoading(true)
    setError('')

    const { data, error: err } = await supabase
      .from('expenses')
      .select('*')
      .gte('expense_date', fromDate)
      .lte('expense_date', toDate)
      .order('expense_date', { ascending: false })
      .order('expense_id', { ascending: false })

    if (err) {
      setError('Could not load expenses: ' + err.message)
      setExpenses([])
    } else {
      setExpenses((data as Expense[]) || [])
    }
    setLoading(false)
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

  const grouped = useMemo(() => {
    return EXPENSE_TYPES.map((type) => {
      const rows = expenses.filter((e) => e.expense_type === type)
      return {
        type,
        rows,
        count: rows.length,
        total: rows.reduce((s, e) => s + Number(e.amount || 0), 0),
      }
    }).sort((a, b) => b.total - a.total) // highest-spend category first
  }, [expenses])

  const grandTotal = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
    [expenses]
  )

  function toggle(type: string) {
    setExpanded((prev) => ({ ...prev, [type]: !prev[type] }))
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
            Expense reports are visible to the shop owner only.
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

        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Expenses by Type
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Grouped by category. Tap a row to see individual entries.
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

        {/* Grand total card */}
        <div className="bg-gradient-to-r from-rose-600 to-rose-500 rounded-2xl p-4 sm:p-5 shadow-sm mb-5 text-white">
          <div className="flex items-center gap-2 text-white/80 text-xs font-medium uppercase tracking-wide mb-1">
            <TrendingDown className="w-4 h-4" />
            Total Expenses
          </div>
          <div className="text-3xl sm:text-4xl font-bold">
            {money(grandTotal)}
          </div>
          <div className="text-xs text-white/70 mt-1">
            {expenses.length} entr{expenses.length === 1 ? 'y' : 'ies'} ·{' '}
            {formatDate(fromDate)} – {formatDate(toDate)}
          </div>
        </div>

        {/* Grouped list */}
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800">
            {error}
          </div>
        ) : loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
            Loading…
          </div>
        ) : expenses.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <Wallet className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-600">
              No expenses in this range.
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Try widening the date range, or add an expense first.
            </div>
            <Link
              href="/expenses"
              className="mt-3 inline-block text-sm text-indigo-600 hover:text-indigo-800 underline"
            >
              Go to expenses entry →
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {grouped.map((g, idx) => {
              const isOpen = !!expanded[g.type]
              const color = TYPE_COLORS[g.type]
              const pct =
                grandTotal > 0 ? (g.total / grandTotal) * 100 : 0
              return (
                <div
                  key={g.type}
                  className={
                    idx !== grouped.length - 1
                      ? 'border-b border-slate-100'
                      : ''
                  }
                >
                  {/* Header row */}
                  <button
                    onClick={() => toggle(g.type)}
                    disabled={g.count === 0}
                    className={`w-full px-4 py-3 flex items-center gap-3 text-left ${
                      g.count === 0
                        ? 'opacity-50 cursor-default'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="shrink-0">
                      {g.count === 0 ? (
                        <div className="w-4 h-4" />
                      ) : isOpen ? (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="shrink-0">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${color.bg} ${color.text}`}
                      >
                        {g.type}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 text-xs text-slate-500">
                      {g.count === 0
                        ? 'No entries'
                        : `${g.count} entr${g.count === 1 ? 'y' : 'ies'}`}
                    </div>
                    <div className="text-sm font-bold text-slate-900 shrink-0">
                      {money(g.total)}
                    </div>
                  </button>

                  {/* Percentage bar */}
                  {g.total > 0 && (
                    <div className="px-4 pb-2 -mt-1">
                      <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            g.type === 'Rent'
                              ? 'bg-indigo-500'
                              : g.type === 'Staff'
                              ? 'bg-amber-500'
                              : g.type === 'Kitty'
                              ? 'bg-emerald-500'
                              : g.type === 'Bill'
                              ? 'bg-blue-500'
                              : 'bg-slate-400'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {pct.toFixed(1)}% of total
                      </div>
                    </div>
                  )}

                  {/* Expanded entries */}
                  {isOpen && g.rows.length > 0 && (
                    <div className="bg-slate-50 border-t border-slate-100">
                      {g.rows.map((e) => (
                        <div
                          key={e.expense_id}
                          className="px-4 py-2 border-b border-slate-100 last:border-b-0 flex items-center gap-3 text-sm"
                        >
                          <div className="text-xs text-slate-500 w-20 shrink-0">
                            {formatDateShort(e.expense_date)}
                          </div>
                          <div className="flex-1 min-w-0 text-slate-700 truncate">
                            {e.note || '—'}
                          </div>
                          <div className="font-medium text-slate-800 shrink-0">
                            {money(e.amount)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Grand total footer */}
            <div className="px-4 py-3 bg-slate-50 border-t-2 border-slate-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                Total
              </span>
              <span className="text-base font-bold text-slate-900">
                {money(grandTotal)}
              </span>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}