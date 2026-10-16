'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import {
  ArrowLeft,
  FileText,
  Copy,
  Check,
  Calendar,
  User,
  Search,
  MessageCircle,
  Phone,
} from 'lucide-react'
import {
  buildStatementText,
  buildWhatsAppUrl,
  normalizePhoneForWhatsApp,
} from '../../lib/statement-format'

type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
  phone: string | null
}

type SaleRow = {
  sale_id: number
  bill_date: string
  total_amount: number
  status: string
}

type SaleItem = {
  detail_id: number
  sale_id: number
  item_id: number
  quantity: number
  rate: number
  amount: number
}

type Payment = {
  payment_id: number
  payment_date: string
  amount: number
  payment_mode: string
}

type StatementLine = {
  detail_id: number
  sku: string
  quantity: number
  rate: number
  amount: number
}

function money(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function startOfWeekStr() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day
  const s = new Date(d.setDate(diff))
  return s.toISOString().slice(0, 10)
}

function startOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function formatDateLong(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function StatementPage() {
  const [customers, setCustomers] = useState<Party[]>([])
  const [search, setSearch] = useState('')
  const [pickedCustomerId, setPickedCustomerId] = useState<number | null>(null)
  const [from, setFrom] = useState(todayStr())
  const [to, setTo] = useState(todayStr())

  const [loading, setLoading] = useState(false)
  const [lines, setLines] = useState<StatementLine[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [currentBalance, setCurrentBalance] = useState(0)
  const [copied, setCopied] = useState(false)

  // Phone editing
  const [editingPhone, setEditingPhone] = useState(false)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const [phoneMessage, setPhoneMessage] = useState('')

  useEffect(() => {
    loadCustomers()
  }, [])

  useEffect(() => {
    if (pickedCustomerId) loadStatement()
    else {
      setLines([])
      setSales([])
      setPayments([])
      setCurrentBalance(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedCustomerId, from, to])

  async function loadCustomers() {
    const { data } = await supabase
      .from('parties')
      .select('party_id, party_name, party_type, current_balance, phone')
      .eq('party_type', 'Customer')
      .order('party_name')
    setCustomers((data as Party[]) || [])
  }

  async function loadStatement() {
    if (!pickedCustomerId) return
    setLoading(true)

    const cust = customers.find((c) => c.party_id === pickedCustomerId)
    setCurrentBalance(Number(cust?.current_balance || 0))

    const { data: salesData } = await supabase
      .from('sales')
      .select('sale_id, bill_date, total_amount, status')
      .eq('party_id', pickedCustomerId)
      .gte('bill_date', from)
      .lte('bill_date', to)
      .order('bill_date', { ascending: true })
      .order('sale_id', { ascending: true })

    const saleList = (salesData as SaleRow[]) || []
    setSales(saleList)

    const saleIds = saleList.map((s) => s.sale_id)
    if (saleIds.length > 0) {
      const { data: itemsData } = await supabase
        .from('sale_items')
        .select('detail_id, sale_id, item_id, quantity, rate, amount')
        .in('sale_id', saleIds)

      const itemList = (itemsData as SaleItem[]) || []

      const itemIds = Array.from(new Set(itemList.map((x) => x.item_id)))
      let itemMap: Record<number, string> = {}
      if (itemIds.length > 0) {
        const { data: itemRows } = await supabase
          .from('items')
          .select('item_id, sku')
          .in('item_id', itemIds)
        for (const it of itemRows || []) {
          itemMap[it.item_id] = it.sku
        }
      }

      setLines(
        itemList.map((it) => ({
          detail_id: it.detail_id,
          sku: itemMap[it.item_id] || '(unknown)',
          quantity: Number(it.quantity),
          rate: Number(it.rate),
          amount: Number(it.amount),
        }))
      )
    } else {
      setLines([])
    }

    const { data: paymentsData } = await supabase
      .from('payments')
      .select('payment_id, payment_date, amount, payment_mode')
      .eq('party_id', pickedCustomerId)
      .gte('payment_date', from)
      .lte('payment_date', to)
      .order('payment_date', { ascending: true })

    setPayments((paymentsData as Payment[]) || [])

    setLoading(false)
  }

  const purchasesTotal = useMemo(
    () => sales.reduce((s, x) => s + Number(x.total_amount), 0),
    [sales]
  )

  const cashPaid = useMemo(
    () =>
      payments
        .filter((p) => p.payment_mode === 'Cash')
        .reduce((s, x) => s + Number(x.amount), 0),
    [payments]
  )
  const upiPaid = useMemo(
    () =>
      payments
        .filter((p) => p.payment_mode === 'UPI')
        .reduce((s, x) => s + Number(x.amount), 0),
    [payments]
  )
  const totalPaid = cashPaid + upiPaid

  const previousBalance = currentBalance - purchasesTotal + totalPaid
  const netDue = currentBalance

  const filteredCustomers = useMemo(() => {
    if (!search.trim()) return customers
    const q = search.trim().toUpperCase()
    return customers.filter((c) => c.party_name.toUpperCase().includes(q))
  }, [customers, search])

  const selectedCustomer = customers.find(
    (c) => c.party_id === pickedCustomerId
  )

  const statementText = useMemo(() => {
    if (!selectedCustomer) return ''
    return buildStatementText({
      customerName: selectedCustomer.party_name,
      fromDate: from,
      toDate: to,
      items: lines.map((l) => ({
        sku: l.sku,
        quantity: l.quantity,
        rate: l.rate,
        amount: l.amount,
      })),
      purchasesTotal,
      previousBalance,
      cashPaid,
      upiPaid,
      netDue,
    })
  }, [
    selectedCustomer,
    from,
    to,
    lines,
    purchasesTotal,
    previousBalance,
    cashPaid,
    upiPaid,
    netDue,
  ])

  async function copyToClipboard() {
    if (!statementText) return
    try {
      await navigator.clipboard.writeText(statementText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = statementText
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // ignore
      }
      document.body.removeChild(ta)
    }
  }

  function openWhatsApp() {
    if (!selectedCustomer || !statementText) return
    const url = buildWhatsAppUrl(selectedCustomer.phone, statementText)
    if (!url) {
      setPhoneMessage('Add a valid 10-digit mobile number first.')
      setEditingPhone(true)
      setPhoneDraft(selectedCustomer.phone || '')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function savePhone() {
    if (!selectedCustomer) return
    setPhoneMessage('')

    const raw = phoneDraft.trim()
    if (!raw) {
      setPhoneMessage('Enter a phone number.')
      return
    }
    const normalized = normalizePhoneForWhatsApp(raw)
    if (!normalized) {
      setPhoneMessage('Invalid number. Enter a 10-digit Indian mobile.')
      return
    }

    // Store as 10-digit number (last 10 digits of normalized 91XXXXXXXXXX)
    const tenDigit = normalized.slice(-10)

    setSavingPhone(true)
    const { error } = await supabase
      .from('parties')
      .update({ phone: tenDigit })
      .eq('party_id', selectedCustomer.party_id)
    setSavingPhone(false)

    if (error) {
      setPhoneMessage('Could not save: ' + error.message)
      return
    }

    // Refetch and confirm
    const { data: verify } = await supabase
      .from('parties')
      .select('phone')
      .eq('party_id', selectedCustomer.party_id)
      .single()

    if (verify?.phone !== tenDigit) {
      setPhoneMessage('Save did not persist. Try again.')
      return
    }

    setCustomers((prev) =>
      prev.map((c) =>
        c.party_id === selectedCustomer.party_id
          ? { ...c, phone: tenDigit }
          : c
      )
    )
    setEditingPhone(false)
    setPhoneDraft('')
    setPhoneMessage('')
  }

  function setRange(mode: 'today' | 'yesterday' | 'week' | 'month') {
    if (mode === 'today') {
      setFrom(todayStr())
      setTo(todayStr())
    } else if (mode === 'yesterday') {
      setFrom(yesterdayStr())
      setTo(yesterdayStr())
    } else if (mode === 'week') {
      setFrom(startOfWeekStr())
      setTo(todayStr())
    } else {
      setFrom(startOfMonthStr())
      setTo(todayStr())
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-700" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Statement
            </h1>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mb-5">
          Pick a customer, choose a date range, then copy or send on WhatsApp.
        </p>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-5 space-y-4">

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              Customer
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer..."
                className="w-full h-11 pl-10 pr-3 text-base border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
              {filteredCustomers.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-400">
                  No customers found.
                </div>
              ) : (
                filteredCustomers.map((c) => {
                  const isSel = c.party_id === pickedCustomerId
                  return (
                    <button
                      key={c.party_id}
                      onClick={() => setPickedCustomerId(c.party_id)}
                      className={`w-full text-left px-3 py-2.5 text-sm border-b border-slate-100 last:border-b-0 flex items-center justify-between ${
                        isSel
                          ? 'bg-blue-50 text-blue-900 font-semibold'
                          : 'text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate">{c.party_name}</span>
                      <span
                        className={`text-xs font-medium ${
                          Number(c.current_balance) > 0
                            ? 'text-red-600'
                            : 'text-slate-400'
                        }`}
                      >
                        ₹{Number(c.current_balance).toFixed(0)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              Date Range
            </label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-10 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-10 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setRange('today')}
                className={`h-8 px-3 text-xs font-medium rounded-lg ${
                  from === todayStr() && to === todayStr()
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Today
              </button>
              <button
                onClick={() => setRange('yesterday')}
                className={`h-8 px-3 text-xs font-medium rounded-lg ${
                  from === yesterdayStr() && to === yesterdayStr()
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Yesterday
              </button>
              <button
                onClick={() => setRange('week')}
                className="h-8 px-3 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                This Week
              </button>
              <button
                onClick={() => setRange('month')}
                className="h-8 px-3 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                This Month
              </button>
            </div>
          </div>
        </div>

        {/* Statement */}
        {!pickedCustomerId ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center text-slate-500 text-sm">
            Pick a customer above to see their statement.
          </div>
        ) : loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
            Loading...
          </div>
        ) : (
          <>
            {/* Summary card */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-700 text-white rounded-2xl p-4 sm:p-5 shadow-sm mb-5">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="text-[10px] uppercase text-slate-300 font-medium tracking-wide">
                  {selectedCustomer?.party_name}
                </div>
                {selectedCustomer?.phone ? (
                  <div className="text-[10px] text-slate-300 flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {selectedCustomer.phone}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingPhone(true)
                      setPhoneDraft('')
                    }}
                    className="text-[10px] text-amber-300 hover:text-amber-200 flex items-center gap-1 underline"
                  >
                    <Phone className="w-3 h-3" />
                    Add phone
                  </button>
                )}
              </div>

              {/* Phone editor */}
              {editingPhone && (
                <div className="mb-3 bg-slate-800/50 rounded-lg p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="tel"
                      value={phoneDraft}
                      onChange={(e) => setPhoneDraft(e.target.value)}
                      placeholder="10-digit mobile"
                      className="flex-1 h-9 px-2 text-sm text-white bg-slate-900 border border-slate-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') savePhone()
                      }}
                    />
                    <button
                      onClick={savePhone}
                      disabled={savingPhone}
                      className="h-9 px-3 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded"
                    >
                      {savingPhone ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingPhone(false)
                        setPhoneMessage('')
                      }}
                      className="h-9 px-3 text-xs font-medium bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                  {phoneMessage && (
                    <div className="text-xs text-amber-300">
                      {phoneMessage}
                    </div>
                  )}
                </div>
              )}

              <div className="text-xs text-slate-400 mb-3">
                {from === to
                  ? formatDateLong(from)
                  : `${formatDateLong(from)} – ${formatDateLong(to)}`}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] uppercase text-slate-300 font-medium tracking-wide">
                    Previous
                  </div>
                  <div className="text-base sm:text-lg font-bold mt-0.5">
                    ₹{previousBalance.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-300 font-medium tracking-wide">
                    Purchases
                  </div>
                  <div className="text-base sm:text-lg font-bold mt-0.5 text-amber-300">
                    +₹{purchasesTotal.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-300 font-medium tracking-wide">
                    Paid
                  </div>
                  <div className="text-base sm:text-lg font-bold mt-0.5 text-emerald-300">
                    −₹{totalPaid.toFixed(0)}
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-600 mt-3 pt-3 flex items-baseline justify-between">
                <span className="text-sm text-slate-300">Net Due</span>
                <span className="text-xl sm:text-2xl font-bold">
                  ₹{netDue.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              <button
                onClick={copyToClipboard}
                className="h-12 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:bg-slate-100 flex items-center justify-center gap-2 shadow-sm"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy
                  </>
                )}
              </button>
              <button
                onClick={openWhatsApp}
                className="h-12 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 active:bg-emerald-800 flex items-center justify-center gap-2 shadow-sm"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp
              </button>
            </div>

            {/* Preview */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                Preview (what will be sent)
              </div>
              <pre className="p-4 text-xs whitespace-pre-wrap font-mono text-slate-800 max-h-96 overflow-y-auto">
                {statementText}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  )
}