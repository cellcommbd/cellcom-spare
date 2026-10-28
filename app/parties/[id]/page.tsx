'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import {
  ArrowLeft,
  Copy,
  Check,
  Phone,
  Plus,
  Wallet,
  ShoppingCart,
  User,
  Calendar,
  BookOpen,
  TrendingUp,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  Pencil,
} from 'lucide-react'
import {
  buildStatementText,
  buildWhatsAppUrl,
  normalizePhoneForWhatsApp,
} from '../../../lib/statement-format'
import { SaleEditModal } from '../../../components/ui/sale-edit-modal'

// ---------- Types ----------
type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
  phone: string | null
}

type Sale = {
  sale_id: number
  bill_date: string
  total_amount: number
  paid_amount: number | null
  status: string
}

type SaleItem = {
  detail_id: number
  sale_id: number
  item_id: number
  quantity: number
  rate: number
  amount: number
  sku: string
}

type Payment = {
  payment_id: number
  payment_date: string
  amount: number
  payment_mode: string
}

type Tab = 'summary' | 'purchases' | 'payments' | 'ledger'

type LedgerRow = {
  date: string
  type: 'Sale' | 'Payment'
  ref_id: number
  amount: number
  balance: number
}

type PurchaseDay = {
  date: string
  bills: Sale[]
  total: number
  itemCount: number
  items: SaleItem[]
}

type OutstandingDay = PurchaseDay & {
  paid: number
  due: number
}

// ---------- Helpers ----------
function todayStr() {
  return new Date().toLocaleDateString('en-CA')
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

function daysAgo(d: string) {
  const then = new Date(d + 'T00:00:00').getTime()
  const now = new Date(todayStr() + 'T00:00:00').getTime()
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)))
}

// ---------- Component ----------
export default function PartyAccountPage() {
  const params = useParams()
  const partyId = Number(params?.id)

  const [party, setParty] = useState<Party | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [lifetimePurchased, setLifetimePurchased] = useState(0)
  const [lifetimePaid, setLifetimePaid] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [lastPurchaseDate, setLastPurchaseDate] = useState<string | null>(null)
  const [lastPaymentDate, setLastPaymentDate] = useState<string | null>(null)

  const [fromDate, setFromDate] = useState(todayStr())
  const [toDate, setToDate] = useState(todayStr())
  const [rangeLoading, setRangeLoading] = useState(false)

  const [rangeSales, setRangeSales] = useState<Sale[]>([])
  const [rangeSaleItems, setRangeSaleItems] = useState<SaleItem[]>([])
  const [rangePayments, setRangePayments] = useState<Payment[]>([])
  const [openingBalance, setOpeningBalance] = useState(0)

  const [tab, setTab] = useState<Tab>('summary')
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({})

  const [copied, setCopied] = useState(false)
  const [editingSaleId, setEditingSaleId] = useState<number | null>(null)

  const [editingPhone, setEditingPhone] = useState(false)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const [phoneMessage, setPhoneMessage] = useState('')

  useEffect(() => {
    if (!partyId || isNaN(partyId)) {
      setError('Invalid party ID')
      setLoading(false)
      return
    }
    loadParty()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId])

  useEffect(() => {
    if (party) loadRange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party, fromDate, toDate])

  async function loadParty() {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('parties')
      .select('party_id, party_name, party_type, current_balance, phone')
      .eq('party_id', partyId)
      .single()

    if (err || !data) {
      setError('Customer not found.')
      setLoading(false)
      return
    }
    setParty(data as Party)
    await loadLifetimeStats(partyId)
    setLoading(false)
  }

  async function loadLifetimeStats(id: number) {
    const { data: salesAll } = await supabase
      .from('sales')
      .select('total_amount, bill_date')
      .eq('party_id', id)
      .order('bill_date', { ascending: false })

    const salesRows = (salesAll || []) as {
      total_amount: number
      bill_date: string
    }[]
    setLifetimePurchased(
      salesRows.reduce((s, r) => s + Number(r.total_amount), 0)
    )
    setLastPurchaseDate(salesRows[0]?.bill_date || null)

    const { data: pendingRows } = await supabase
      .from('sales')
      .select('sale_id')
      .eq('party_id', id)
      .in('status', ['Pending', 'Partially Paid'])
    setPendingCount((pendingRows || []).length)

    const { data: paymentsAll } = await supabase
      .from('payments')
      .select('amount, payment_date')
      .eq('party_id', id)
      .order('payment_date', { ascending: false })

    const payRows = (paymentsAll || []) as {
      amount: number
      payment_date: string
    }[]
    setLifetimePaid(payRows.reduce((s, r) => s + Number(r.amount), 0))
    setLastPaymentDate(payRows[0]?.payment_date || null)
  }

  async function loadRange() {
    if (!party) return
    setRangeLoading(true)
    const { from, to } = { from: fromDate, to: toDate }

    const { data: salesData } = await supabase
      .from('sales')
      .select('sale_id, bill_date, total_amount, paid_amount, status')
      .eq('party_id', party.party_id)
      .gte('bill_date', from)
      .lte('bill_date', to)
      .order('bill_date', { ascending: true })
      .order('sale_id', { ascending: true })

    const sales = (salesData as Sale[]) || []
    setRangeSales(sales)

    const saleIds = sales.map((s) => s.sale_id)
    let items: SaleItem[] = []
    if (saleIds.length > 0) {
      const { data: itemsData } = await supabase
        .from('sale_items')
        .select('detail_id, sale_id, item_id, quantity, rate, amount')
        .in('sale_id', saleIds)

      const raw = (itemsData || []) as {
        detail_id: number
        sale_id: number
        item_id: number
        quantity: number
        rate: number
        amount: number
      }[]

      const itemIds = Array.from(new Set(raw.map((x) => x.item_id)))
      let skuMap: Record<number, string> = {}
      if (itemIds.length > 0) {
        const { data: itemRows } = await supabase
          .from('items')
          .select('item_id, sku')
          .in('item_id', itemIds)
        for (const it of itemRows || []) skuMap[it.item_id] = it.sku
      }

      items = raw.map((it) => ({
        detail_id: it.detail_id,
        sale_id: it.sale_id,
        item_id: it.item_id,
        quantity: Number(it.quantity),
        rate: Number(it.rate),
        amount: Number(it.amount),
        sku: skuMap[it.item_id] || '(unknown)',
      }))
    }
    setRangeSaleItems(items)

    const { data: payData } = await supabase
      .from('payments')
      .select('payment_id, payment_date, amount, payment_mode')
      .eq('party_id', party.party_id)
      .gte('payment_date', from)
      .lte('payment_date', to)
      .order('payment_date', { ascending: true })

    setRangePayments((payData as Payment[]) || [])

    await computeOpeningBalance(party.party_id, from)
    setRangeLoading(false)
  }

  async function computeOpeningBalance(id: number, from: string) {
    const { data: allSales } = await supabase
      .from('sales')
      .select('total_amount')
      .eq('party_id', id)
      .gte('bill_date', from)

    const { data: allPays } = await supabase
      .from('payments')
      .select('amount')
      .eq('party_id', id)
      .gte('payment_date', from)

    const salesSum = (allSales || []).reduce(
      (s, r: any) => s + Number(r.total_amount),
      0
    )
    const paysSum = (allPays || []).reduce(
      (s, r: any) => s + Number(r.amount),
      0
    )
    const current = Number(party?.current_balance || 0)
    setOpeningBalance(current - salesSum + paysSum)
  }

  // ---------- Computed ----------
  const rangePurchased = useMemo(
    () => rangeSales.reduce((s, r) => s + Number(r.total_amount), 0),
    [rangeSales]
  )
  const rangeCashPaid = useMemo(
    () =>
      rangePayments
        .filter((p) => p.payment_mode === 'Cash')
        .reduce((s, r) => s + Number(r.amount), 0),
    [rangePayments]
  )
  const rangeUpiPaid = useMemo(
    () =>
      rangePayments
        .filter((p) => p.payment_mode === 'UPI')
        .reduce((s, r) => s + Number(r.amount), 0),
    [rangePayments]
  )
  const rangePaid = rangeCashPaid + rangeUpiPaid
  const balance = Number(party?.current_balance || 0)

  // Group range sales by day (all sales, paid or not)
  const purchaseDays: PurchaseDay[] = useMemo(() => {
    const byDate: Record<string, Sale[]> = {}
    for (const s of rangeSales) {
      if (!byDate[s.bill_date]) byDate[s.bill_date] = []
      byDate[s.bill_date].push(s)
    }

    const itemsBySale: Record<number, SaleItem[]> = {}
    for (const it of rangeSaleItems) {
      if (!itemsBySale[it.sale_id]) itemsBySale[it.sale_id] = []
      itemsBySale[it.sale_id].push(it)
    }

    return Object.keys(byDate)
      .sort()
      .reverse() // newest first for purchase history
      .map((date) => {
        const bills = byDate[date]
        const total = bills.reduce((s, b) => s + Number(b.total_amount), 0)
        const items: SaleItem[] = []
        let itemCount = 0
        for (const b of bills) {
          const billItems = itemsBySale[b.sale_id] || []
          for (const it of billItems) {
            items.push(it)
            itemCount += it.quantity
          }
        }
        return { date, bills, total, itemCount, items }
      })
  }, [rangeSales, rangeSaleItems])

  // Only days with money still due — used for balance breakdown (oldest first)
  const outstandingDays: OutstandingDay[] = useMemo(() => {
    return purchaseDays
      .map((day) => {
        const paid = day.bills.reduce(
          (s, b) => s + Number(b.paid_amount || 0),
          0
        )
        const due = Math.max(0, day.total - paid)
        return { ...day, paid, due }
      })
      .filter((day) => day.due > 0)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
  }, [purchaseDays])

  const ledgerRows: LedgerRow[] = useMemo(() => {
    const rows: Omit<LedgerRow, 'balance'>[] = []
    for (const s of rangeSales) {
      rows.push({
        date: s.bill_date,
        type: 'Sale',
        ref_id: s.sale_id,
        amount: Number(s.total_amount),
      })
    }
    for (const p of rangePayments) {
      rows.push({
        date: p.payment_date,
        type: 'Payment',
        ref_id: p.payment_id,
        amount: -Number(p.amount),
      })
    }
    rows.sort((a, b) => {
      if (a.date < b.date) return -1
      if (a.date > b.date) return 1
      return a.type === b.type ? a.ref_id - b.ref_id : a.type === 'Sale' ? -1 : 1
    })

    let running = openingBalance
    const withBalance: LedgerRow[] = []
    for (const r of rows) {
      running += r.amount
      withBalance.push({ ...r, balance: running })
    }
    return withBalance
  }, [rangeSales, rangePayments, openingBalance])

  const statementText = useMemo(() => {
    if (!party) return ''
    const flatItems = rangeSaleItems.map((l) => ({
      sku: l.sku,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
    }))
    return buildStatementText({
      customerName: party.party_name,
      fromDate,
      toDate,
      items: flatItems,
      purchasesTotal: rangePurchased,
      previousBalance: openingBalance,
      cashPaid: rangeCashPaid,
      upiPaid: rangeUpiPaid,
      netDue: balance,
    })
  }, [
    party,
    fromDate,
    toDate,
    rangeSaleItems,
    rangePurchased,
    openingBalance,
    rangeCashPaid,
    rangeUpiPaid,
    balance,
  ])

  async function copyStatement() {
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
    if (!party || !statementText) return
    const url = buildWhatsAppUrl(party.phone, statementText)
    if (!url) {
      setPhoneMessage('Add a valid 10-digit mobile number first.')
      setEditingPhone(true)
      setPhoneDraft(party.phone || '')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function savePhone() {
    if (!party) return
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
    const tenDigit = normalized.slice(-10)
    setSavingPhone(true)
    const { error } = await supabase
      .from('parties')
      .update({ phone: tenDigit })
      .eq('party_id', party.party_id)
    setSavingPhone(false)
    if (error) {
      setPhoneMessage('Could not save: ' + error.message)
      return
    }
    const { data: verify } = await supabase
      .from('parties')
      .select('phone')
      .eq('party_id', party.party_id)
      .single()
    if (verify?.phone !== tenDigit) {
      setPhoneMessage('Save did not persist. Try again.')
      return
    }
    setParty({ ...party, phone: tenDigit })
    setEditingPhone(false)
    setPhoneDraft('')
    setPhoneMessage('')
  }

  function setRange(mode: 'today' | 'yesterday' | 'week' | 'month') {
    const t = todayStr()
    if (mode === 'today') {
      setFromDate(t)
      setToDate(t)
    } else if (mode === 'yesterday') {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      const y = d.toISOString().slice(0, 10)
      setFromDate(y)
      setToDate(y)
    } else if (mode === 'week') {
      const d = new Date()
      const day = d.getDay()
      const diff = d.getDate() - day
      const start = new Date(d.setDate(diff))
      setFromDate(start.toISOString().slice(0, 10))
      setToDate(t)
    } else {
      setFromDate(firstOfMonthStr())
      setToDate(t)
    }
  }

  function toggleDay(date: string) {
    setExpandedDays((prev) => ({ ...prev, [date]: !prev[date] }))
  }
    // ============ RENDER ============
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-slate-400 text-sm">Loading account…</div>
      </div>
    )
  }

  if (error || !party) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <User className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <div className="text-slate-700 font-medium mb-1">
            {error || 'Customer not found.'}
          </div>
          <Link
            href="/parties"
            className="text-sm text-indigo-600 hover:text-indigo-800 underline"
          >
            ← Back to parties
          </Link>
        </div>
      </div>
    )
  }

  const isOwed = balance > 0
  const isCredit = balance < 0
  const balanceLabel = isOwed
    ? 'Amount Owed'
    : isCredit
    ? 'Credit Balance'
    : 'Settled'

  const balanceChipClass = isOwed
    ? 'bg-rose-600'
    : isCredit
    ? 'bg-emerald-600'
    : 'bg-slate-500'

  const paidPct =
    lifetimePurchased > 0
      ? Math.min(100, (lifetimePaid / lifetimePurchased) * 100)
      : 0

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6">

        <Link
          href="/parties"
          className="inline-flex items-center gap-1 text-xs sm:text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All parties
        </Link>

        {/* HEADER CARD */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 mb-4">
          <div className="mb-4">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">
              {party.party_name}
            </h1>
            {party.phone ? (
              <div className="flex items-center gap-1 text-xs sm:text-sm text-slate-500 mt-0.5">
                <Phone className="w-3 h-3" />
                {party.phone}
              </div>
            ) : (
              <button
                onClick={() => {
                  setEditingPhone(true)
                  setPhoneDraft('')
                }}
                className="text-xs text-amber-700 hover:text-amber-900 underline mt-0.5"
              >
                + Add phone
              </button>
            )}
          </div>

          {editingPhone && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  placeholder="10-digit mobile"
                  className="flex-1 h-10 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') savePhone()
                  }}
                />
                <button
                  onClick={savePhone}
                  disabled={savingPhone}
                  className="h-10 px-3 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded"
                >
                  {savingPhone ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setEditingPhone(false)
                    setPhoneMessage('')
                  }}
                  className="h-10 px-3 text-xs font-medium bg-slate-200 hover:bg-slate-300 rounded"
                >
                  Cancel
                </button>
              </div>
              {phoneMessage && (
                <div className="text-xs text-amber-800">{phoneMessage}</div>
              )}
            </div>
          )}

          {/* Balance hero */}
          <div
            className={`${balanceChipClass} rounded-xl px-4 py-4 text-center text-white`}
          >
            <div className="text-[10px] sm:text-xs uppercase tracking-wide opacity-80">
              {balanceLabel}
            </div>
            <div className="text-3xl sm:text-4xl font-bold mt-0.5">
              {money(Math.abs(balance))}
            </div>
          </div>

          {/* Statement actions */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button
              onClick={copyStatement}
              className="h-11 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 flex items-center justify-center gap-2"
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
              className="h-11 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </button>
          </div>

          {/* Lifetime sub-values */}
          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100">
            <div className="text-center">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wide">
                Total Purchased
              </div>
              <div className="text-sm sm:text-base font-semibold text-slate-800 mt-0.5">
                {money(lifetimePurchased)}
              </div>
            </div>
            <div className="text-center border-l border-slate-100">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wide">
                Total Paid
              </div>
              <div className="text-sm sm:text-base font-semibold text-emerald-700 mt-0.5">
                {money(lifetimePaid)}
              </div>
            </div>
          </div>
        </div>

        {/* DATE RANGE BAR */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-4">
          <div className="flex items-center gap-2 text-slate-700 mb-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span className="text-xs sm:text-sm font-medium">Date range</span>
            {rangeLoading && (
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
            {(
              [
                ['today', 'Today'],
                ['yesterday', 'Yesterday'],
                ['week', 'This Week'],
                ['month', 'This Month'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* TABS */}
        <div className="bg-white border border-slate-200 rounded-t-xl shadow-sm overflow-hidden">
          <div className="flex border-b border-slate-200 overflow-x-auto">
            {(
              [
                { key: 'summary', label: 'Summary', icon: TrendingUp },
                { key: 'purchases', label: 'Purchases', icon: ShoppingCart },
                { key: 'payments', label: 'Payments', icon: Wallet },
                { key: 'ledger', label: 'Ledger', icon: BookOpen },
              ] as { key: Tab; label: string; icon: any }[]
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 min-w-[80px] h-11 px-2 flex items-center justify-center gap-1.5 text-xs font-semibold border-b-2 transition-colors ${
                  tab === key
                    ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* SUMMARY */}
          {tab === 'summary' && (
            <div className="p-4 sm:p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <StatBox
                  label="Lifetime Purchased"
                  value={money(lifetimePurchased)}
                  tone="slate"
                />
                <StatBox
                  label="Lifetime Paid"
                  value={money(lifetimePaid)}
                  tone="emerald"
                />
                <StatBox
                  label="Current Balance"
                  value={money(balance)}
                  tone={isOwed ? 'rose' : isCredit ? 'emerald' : 'slate'}
                />
                <StatBox
                  label="Pending Bills"
                  value={`${pendingCount} bill${pendingCount === 1 ? '' : 's'}`}
                  tone={pendingCount > 0 ? 'amber' : 'slate'}
                />
              </div>

              {/* Balance breakdown — which days/bills make up the balance */}
              {outstandingDays.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                    Balance Breakdown
                  </div>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {outstandingDays.map((day) => {
                      const isOpen = !!expandedDays[day.date]
                      const age = daysAgo(day.date)
                      const ageColor =
                        age < 7
                          ? 'text-slate-400'
                          : age <= 30
                          ? 'text-amber-700'
                          : 'text-rose-700'
                      return (
                        <div key={day.date}>
                          <button
                            onClick={() => toggleDay(day.date)}
                            className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-slate-50 text-left"
                          >
                            <div className="shrink-0 text-slate-400">
                              {isOpen ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-slate-800">
                                {formatDate(day.date)}
                                {age > 0 && (
                                  <span
                                    className={`ml-1.5 text-[10px] font-normal ${ageColor}`}
                                  >
                                    · {age}d old
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                ₹{day.total.toFixed(0)} total · ₹
                                {day.paid.toFixed(0)} paid
                              </div>
                            </div>
                            <div className="text-xs font-bold text-rose-700 shrink-0">
                              ₹ {day.due.toFixed(0)} due
                            </div>
                          </button>
                          {isOpen && (
                            <div className="px-8 pb-2 pt-1 bg-slate-50 space-y-1">
                              {day.items.length === 0 ? (
                                <div className="text-[11px] text-slate-400 py-1">
                                  No line items.
                                </div>
                              ) : (
                                day.items.map((it) => (
                                  <div
                                    key={it.detail_id}
                                    className="flex items-center justify-between text-[11px] gap-2"
                                  >
                                    <div className="font-mono text-slate-700 truncate flex-1">
                                      {it.sku}
                                    </div>
                                    <div className="text-slate-500 shrink-0">
                                      {it.quantity} × ₹{it.rate.toFixed(0)}
                                    </div>
                                    <div className="text-slate-800 w-16 text-right shrink-0">
                                      ₹{it.amount.toFixed(0)}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {lifetimePurchased > 0 && (
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Paid {paidPct.toFixed(0)}%</span>
                    <span>Owed {(100 - paidPct).toFixed(0)}%</span>
                  </div>
                  <div className="h-2.5 w-full bg-rose-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${paidPct}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                    Last Purchase
                  </div>
                  <div className="text-sm font-medium text-slate-800 mt-0.5">
                    {lastPurchaseDate ? formatDate(lastPurchaseDate) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                    Last Payment
                  </div>
                  <div className="text-sm font-medium text-slate-800 mt-0.5">
                    {lastPaymentDate ? formatDate(lastPaymentDate) : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PURCHASES — grouped by day */}
          {tab === 'purchases' && (
            <div>
              {rangeLoading ? (
                <TabLoading />
              ) : purchaseDays.length === 0 ? (
                <TabEmpty
                  icon={<ShoppingCart className="w-8 h-8 text-slate-300" />}
                  title="No purchases in this range."
                  sub="Try widening the date range."
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {purchaseDays.map((day) => {
                    const isOpen = !!expandedDays[day.date]
                    return (
                      <div key={day.date}>
                        <button
                          onClick={() => toggleDay(day.date)}
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
                            <div className="text-sm font-semibold text-slate-900">
                              {formatDate(day.date)}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {day.itemCount} item
                              {day.itemCount === 1 ? '' : 's'}
                              {day.bills.length > 1 && (
                                <> · {day.bills.length} bills</>
                              )}
                            </div>
                          </div>
                          <div className="text-sm font-bold text-slate-900 shrink-0">
                            {money(day.total)}
                          </div>
                          {day.bills.length === 1 && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingSaleId(day.bills[0].sale_id)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setEditingSaleId(day.bills[0].sale_id)
                                }
                              }}
                              className="p-1.5 text-slate-400 hover:text-blue-700 hover:bg-blue-50 rounded shrink-0 cursor-pointer"
                              aria-label="Edit bill"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </button>

                        {isOpen && (
                          <div className="bg-slate-50 border-t border-slate-100 px-3 sm:px-4 py-3">
                            {day.items.length === 0 ? (
                              <div className="text-xs text-slate-400 text-center py-2">
                                No line items.
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {day.items.map((it) => (
                                  <div
                                    key={it.detail_id}
                                    className="flex items-center justify-between text-xs gap-2"
                                  >
                                    <div className="font-mono text-slate-700 truncate flex-1">
                                      {it.sku}
                                    </div>
                                    <div className="text-slate-500 shrink-0">
                                      {it.quantity} × ₹{it.rate.toFixed(0)}
                                    </div>
                                    <div className="font-medium text-slate-800 w-20 text-right shrink-0">
                                      {money(it.amount)}
                                    </div>
                                  </div>
                                ))}
                                <div className="pt-2 mt-2 border-t border-slate-200 flex justify-between text-xs">
                                  <span className="text-slate-500">
                                    {day.itemCount} item
                                    {day.itemCount === 1 ? '' : 's'}
                                  </span>
                                  <span className="font-semibold text-slate-800">
                                    Total {money(day.total)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* PAYMENTS */}
          {tab === 'payments' && (
            <div>
              {rangeLoading ? (
                <TabLoading />
              ) : rangePayments.length === 0 ? (
                <TabEmpty
                  icon={<Wallet className="w-8 h-8 text-slate-300" />}
                  title="No payments in this range."
                  sub="Payments received from this customer appear here."
                />
              ) : (
                <div>
                  {rangePayments.map((p) => (
                    <div
                      key={p.payment_id}
                      className="px-4 py-3 border-b border-slate-100 last:border-b-0 flex items-center gap-3"
                    >
                      <div className="text-xs text-slate-400 w-16 shrink-0">
                        #{p.payment_id}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800">
                          {formatDate(p.payment_date)}
                        </div>
                        <div className="mt-0.5">
                          <ModePill mode={p.payment_mode} />
                        </div>
                      </div>
                      <div className="text-sm font-bold text-emerald-700 shrink-0">
                        {money(p.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LEDGER — chronological, unchanged */}
          {tab === 'ledger' && (
            <div>
              {rangeLoading ? (
                <TabLoading />
              ) : ledgerRows.length === 0 ? (
                <TabEmpty
                  icon={<BookOpen className="w-8 h-8 text-slate-300" />}
                  title="No activity in this range."
                  sub="Sales and payments will appear here chronologically."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-3 py-2 text-left text-[10px] sm:text-xs font-semibold text-slate-600">
                          Date
                        </th>
                        <th className="px-3 py-2 text-left text-[10px] sm:text-xs font-semibold text-slate-600">
                          Type
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] sm:text-xs font-semibold text-slate-600">
                          Amount
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] sm:text-xs font-semibold text-slate-600">
                          Balance
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRows.map((r, i) => (
                        <tr
                          key={`${r.type}-${r.ref_id}-${i}`}
                          className="border-b border-slate-100 last:border-b-0"
                        >
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                            {formatDate(r.date).slice(0, 6)}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                                r.type === 'Sale'
                                  ? 'bg-rose-100 text-rose-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {r.type}
                            </span>
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-medium whitespace-nowrap ${
                              r.amount >= 0
                                ? 'text-rose-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            {r.amount >= 0 ? '+' : '−'}{' '}
                            {money(Math.abs(r.amount))}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900 whitespace-nowrap">
                            {money(r.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Range summary line */}
        <div className="bg-white border border-slate-200 border-t-0 rounded-b-xl px-4 py-2.5 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <span>
            {rangeSales.length} sale{rangeSales.length === 1 ? '' : 's'} ·{' '}
            {rangePayments.length} payment
            {rangePayments.length === 1 ? '' : 's'}
          </span>
          <span>
            <span className="font-medium text-slate-700">
              {money(rangePurchased)}
            </span>{' '}
            purchased ·{' '}
            <span className="font-medium text-emerald-700">
              {money(rangePaid)}
            </span>{' '}
            paid
          </span>
        </div>
      </div>

      {/* Sticky mobile actions */}
      <div className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 px-3 py-2 flex gap-2 z-20 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">
        <Link
          href={`/sales?party_id=${party.party_id}`}
          className="flex-1 h-12 flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          New Sale
        </Link>
        <Link
          href={`/payments?party_id=${party.party_id}`}
          className="flex-1 h-12 flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700"
        >
          <Wallet className="w-4 h-4" />
          New Payment
        </Link>
      </div>

      {/* Desktop actions */}
      <div className="hidden md:flex max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 gap-2 justify-end">
        <Link
          href={`/sales?party_id=${party.party_id}`}
          className="h-10 px-4 flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          New Sale
        </Link>
        <Link
          href={`/payments?party_id=${party.party_id}`}
          className="h-10 px-4 flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
        >
          <Wallet className="w-4 h-4" />
          New Payment
        </Link>
      </div>
    </div>
  )
}

// ---------- Sub-components ----------
function StatBox({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'slate' | 'rose' | 'emerald' | 'amber'
}) {
  const tones: Record<typeof tone, string> = {
    slate: 'bg-slate-50 border-slate-200 text-slate-800',
    rose: 'bg-rose-50 border-rose-200 text-rose-800',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
  }
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="text-base font-bold mt-0.5">{value}</div>
    </div>
  )
}

function ModePill({ mode }: { mode: string }) {
  const isUpi = mode === 'UPI'
  return (
    <span
      className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
        isUpi ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
      }`}
    >
      {mode}
    </span>
  )
}

function TabLoading() {
  return (
    <div className="px-4 py-8 text-center text-xs text-slate-400">Loading…</div>
  )
}

function TabEmpty({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode
  title: string
  sub: string
}) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="flex justify-center mb-2">{icon}</div>
      <div className="text-sm font-medium text-slate-600 mb-0.5">{title}</div>
      <div className="text-xs text-slate-400">{sub}</div>
    </div>
  )
}