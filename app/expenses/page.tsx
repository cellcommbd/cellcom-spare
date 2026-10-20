'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getRole } from '../../lib/auth'
import { Plus, Trash2, Save, X, Wallet, AlertCircle } from 'lucide-react'

// ---------- Types ----------
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

// ---------- Component ----------
export default function ExpensesPage() {
  const [isOwner, setIsOwner] = useState(false)
  const [roleChecked, setRoleChecked] = useState(false)

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)

  const [expenseDate, setExpenseDate] = useState(todayStr())
  const [expenseType, setExpenseType] = useState<ExpenseType>('Staff')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageOk, setMessageOk] = useState(false)

  const amountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const r = getRole()
    setIsOwner(r === 'owner')
    setRoleChecked(true)
  }, [])

  useEffect(() => {
    if (isOwner) loadExpenses()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner])

  async function loadExpenses() {
    setLoading(true)
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .gte('expense_date', firstOfMonthStr())
      .lte('expense_date', todayStr())
      .order('expense_date', { ascending: false })
      .order('expense_id', { ascending: false })

    if (error) {
      setMessage('Error loading: ' + error.message)
      setMessageOk(false)
      setExpenses([])
    } else {
      setExpenses((data as Expense[]) || [])
    }
    setLoading(false)
  }

  async function saveExpense() {
    setMessage('')
    setMessageOk(false)

    const amt = parseFloat(amount) || 0
    if (!amt || amt <= 0) {
      setMessage('Amount must be greater than zero.')
      amountRef.current?.focus()
      return
    }

    setSaving(true)

    const { error } = await supabase.from('expenses').insert({
      expense_date: expenseDate,
      expense_type: expenseType,
      amount: amt,
      note: note.trim() || null,
    })

    setSaving(false)

    if (error) {
      setMessage('Error saving: ' + error.message)
      return
    }

    setMessage(`Saved ${expenseType} ${money(amt)}`)
    setMessageOk(true)

    // Keep date + type (usually entering the same category repeatedly)
    // Clear amount + note, refocus amount
    setAmount('')
    setNote('')
    setTimeout(() => amountRef.current?.focus(), 50)

    await loadExpenses()

    setTimeout(() => {
      setMessage('')
      setMessageOk(false)
    }, 2500)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!saving) saveExpense()
    }
  }

  async function deleteExpense(id: number) {
    if (!confirm(`Delete expense #${id}?`)) return
    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('expense_id', id)
    if (error) {
      setMessage('Delete error: ' + error.message)
      setMessageOk(false)
    } else {
      setMessage(`Deleted expense #${id}`)
      setMessageOk(true)
      await loadExpenses()
      setTimeout(() => {
        setMessage('')
        setMessageOk(false)
      }, 2000)
    }
  }

  const monthTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)

  const byType = EXPENSE_TYPES.map((t) => ({
    type: t,
    total: expenses
      .filter((e) => e.expense_type === t)
      .reduce((s, e) => s + Number(e.amount || 0), 0),
    count: expenses.filter((e) => e.expense_type === t).length,
  }))

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
            Expenses are visible to the shop owner only.
          </div>
        </div>
      </div>
    )
  }

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Expenses
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Rent, staff wages, kitty, bills, and others.
          </p>
        </div>

        {/* Month summary */}
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-2xl p-4 sm:p-5 shadow-sm mb-5 text-white">
          <div className="flex items-center gap-2 text-white/80 text-xs font-medium uppercase tracking-wide mb-2">
            <Wallet className="w-4 h-4" />
            This Month
          </div>
          <div className="text-3xl sm:text-4xl font-bold">
            {money(monthTotal)}
          </div>
          <div className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-2">
            {byType.map((b) => (
              <div key={b.type} className="text-center">
                <div className="text-[9px] sm:text-[10px] text-white/70 uppercase tracking-wide truncate">
                  {b.type}
                </div>
                <div className="text-[11px] sm:text-sm font-semibold mt-0.5">
                  ₹{Math.round(b.total)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Entry form */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm mb-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Date
              </label>
              <input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full h-11 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Type
              </label>
              <select
                value={expenseType}
                onChange={(e) =>
                  setExpenseType(e.target.value as ExpenseType)
                }
                className="w-full h-11 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {EXPENSE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Amount
              </label>
              <input
                ref={amountRef}
                type="number"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="0"
                className="w-full h-11 px-2 text-base text-right font-semibold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Note <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. Ramu daily"
                className="w-full h-11 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-3">
            <button
              onClick={saveExpense}
              disabled={saving}
              className="w-full sm:w-auto h-11 px-6 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save Expense'}
            </button>
            {message && (
              <div
                className={`text-xs sm:text-sm px-3 py-2 rounded-lg ${
                  messageOk
                    ? 'text-emerald-800 bg-emerald-50 border border-emerald-200'
                    : 'text-red-800 bg-red-50 border border-red-200'
                }`}
              >
                {message}
              </div>
            )}
          </div>
        </div>

        {/* This month's list */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">
              This Month ({expenses.length})
            </span>
            <span className="text-xs text-slate-500">
              {formatDate(firstOfMonthStr())} – {formatDate(todayStr())}
            </span>
          </div>

          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              Loading…
            </div>
          ) : expenses.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Wallet className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <div className="text-sm font-medium text-slate-600">
                No expenses this month yet.
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Add one above to get started.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {expenses.map((e) => (
                <div
                  key={e.expense_id}
                  className="px-3 sm:px-4 py-2.5 flex items-center gap-3"
                >
                  <div className="w-16 shrink-0 text-xs text-slate-500">
                    {formatDate(e.expense_date).slice(0, 6)}
                  </div>
                  <div className="w-16 shrink-0">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                        e.expense_type === 'Rent'
                          ? 'bg-indigo-100 text-indigo-700'
                          : e.expense_type === 'Staff'
                          ? 'bg-amber-100 text-amber-700'
                          : e.expense_type === 'Kitty'
                          ? 'bg-emerald-100 text-emerald-700'
                          : e.expense_type === 'Bill'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {e.expense_type}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 text-sm text-slate-700 truncate">
                    {e.note || '—'}
                  </div>
                  <div className="text-sm font-semibold text-rose-700 shrink-0">
                    {money(e.amount)}
                  </div>
                  <button
                    onClick={() => deleteExpense(e.expense_id)}
                    className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-rose-50 rounded shrink-0"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}