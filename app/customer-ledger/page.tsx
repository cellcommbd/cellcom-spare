'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { getRole } from '../../lib/auth'
import {
  ArrowLeft,
  Calendar,
  User,
  ChevronDown,
  ChevronRight,
  Banknote,
  Smartphone,
} from 'lucide-react'

type Party = {
  party_id: number
  party_name: string
  current_balance: number
}

type SaleRow = {
  sale_id: number
  bill_date: string
  total_amount: number
  paid_amount: number | null
  status: string
}

type SaleLine = {
  detail_id: number
  sale_id: number
  item_id: number
  sku: string
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

function todayStr() {
  return new Date().toLocaleDateString('en-CA')
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function money(n: number) {
  return `\u20B9 ${Number(n).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`
}

export default function CustomerLedgerPage() {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)

  const [customers, setCustomers] = useState<Party[]>([])
  const [pickedCustomerId, setPickedCustomerId] = useState<number | null>(null)

  const [from, setFrom] = useState(() => firstOfMonthStr())
  const [to, setTo] = useState(() => todayStr())

  const [aggregates, setAggregates] = useState<
    Record<
      number,
      { purchases: number; paid: number; cash: number; upi: number }
    >
  >({})

  const [custSales, setCustSales] = useState<SaleRow[]>([])
  const [custLines, setCustLines] = useState<SaleLine[]>([])
  const [custPayments, setCustPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(false)

  const [expandedSaleId, setExpandedSaleId] = useState<number | null>(null)

  useEffect(() => {
    const role = getRole()
    if (role !== 'owner' && role !== 'staff') {
      router.replace('/')
      return
    }
    setAllowed(true)
    loadCustomers()
  }, [router])

  useEffect(() => {
    if (!allowed) return
    loadAggregates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, allowed])

  useEffect(() => {
    if (!allowed) return
    if (pickedCustomerId) {
      loadCustomerDetail(pickedCustomerId)
    } else {
      setCustSales([])
      setCustLines([])
      setCustPayments([])
      setExpandedSaleId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedCustomerId, from, to, allowed])

  async function loadCustomers() {
    const { data } = await supabase
      .from('parties')
      .select('party_id, party_name, current_balance')
      .eq('party_type', 'Customer')
      .order('party_name')
    setCustomers((data as Party[]) || [])
  }

  async function loadAggregates() {
    const useRange = !!(from && to)

    let salesQ = supabase
      .from('sales')
      .select('sale_id, party_id, bill_date, total_amount, paid_amount, status')
    if (useRange) salesQ = salesQ.gte('bill_date', from).lte('bill_date', to)

    let paymentsQ = supabase
      .from('payments')
      .select('party_id, payment_date, amount, payment_mode')
    if (useRange)
      paymentsQ = paymentsQ.gte('payment_date', from).lte('payment_date', to)

    const [salesRes, paymentsRes] = await Promise.all([salesQ, paymentsQ])

    const sales = (salesRes.data as any[]) || []
    const payments = (paymentsRes.data as any[]) || []

    const agg: Record<
      number,
      { purchases: number; paid: number; cash: number; upi: number }
    > = {}

    for (const s of sales) {
      if (!agg[s.party_id])
        agg[s.party_id] = { purchases: 0, paid: 0, cash: 0, upi: 0 }
      agg[s.party_id].purchases += Number(s.total_amount)
    }
    for (const p of payments) {
      if (!agg[p.party_id])
        agg[p.party_id] = { purchases: 0, paid: 0, cash: 0, upi: 0 }
      if (p.payment_mode === 'UPI') agg[p.party_id].upi += Number(p.amount)
      else agg[p.party_id].cash += Number(p.amount)
      agg[p.party_id].paid += Number(p.amount)
    }
    setAggregates(agg)
  }

  async function loadCustomerDetail(partyId: number) {
    setLoading(true)
    const useRange = !!(from && to)

    let salesQ = supabase
      .from('sales')
      .select('sale_id, bill_date, total_amount, paid_amount, status')
      .eq('party_id', partyId)
    if (useRange) salesQ = salesQ.gte('bill_date', from).lte('bill_date', to)

    let paymentsQ = supabase
      .from('payments')
      .select('payment_id, payment_date, amount, payment_mode')
      .eq('party_id', partyId)
    if (useRange)
      paymentsQ = paymentsQ.gte('payment_date', from).lte('payment_date', to)

    const [salesRes, paymentsRes] = await Promise.all([
      salesQ
        .order('bill_date', { ascending: false })
        .order('sale_id', { ascending: false }),
      paymentsQ
        .order('payment_date', { ascending: false })
        .order('payment_id', { ascending: false }),
    ])

    const sales = (salesRes.data as SaleRow[]) || []
    setCustSales(sales)
    setCustPayments((paymentsRes.data as Payment[]) || [])

    const saleIds = sales.map((s) => s.sale_id)
    if (saleIds.length > 0) {
      const { data: linesData } = await supabase
        .from('sale_items')
        .select('detail_id, sale_id, item_id, quantity, rate, amount')
        .in('sale_id', saleIds)
        .order('detail_id', { ascending: true })

      const raw = (linesData as any[]) || []
      const itemIds = Array.from(
        new Set(raw.map((l) => l.item_id).filter(Boolean))
      )
      let skuMap: Record<number, string> = {}
      if (itemIds.length > 0) {
        const { data: itemRows } = await supabase
          .from('items')
          .select('item_id, sku')
          .in('item_id', itemIds)
        for (const it of itemRows || []) skuMap[it.item_id] = it.sku
      }

      const annotated: SaleLine[] = raw.map((l) => ({
        detail_id: l.detail_id,
        sale_id: l.sale_id,
        item_id: l.item_id,
        sku: skuMap[l.item_id] || `Item #${l.item_id}`,
        quantity: Number(l.quantity),
        rate: Number(l.rate),
        amount: Number(l.amount),
      }))
      setCustLines(annotated)
    } else {
      setCustLines([])
    }

    setLoading(false)
  }

  function setRange(mode: 'today' | 'yesterday' | 'week' | 'month') {
    const t = todayStr()
    if (mode === 'today') {
      setFrom(t)
      setTo(t)
    } else if (mode === 'yesterday') {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      const y = d.toLocaleDateString('en-CA')
      setFrom(y)
      setTo(y)
    } else if (mode === 'week') {
      const d = new Date()
      const day = d.getDay()
      const diff = d.getDate() - day
      const start = new Date(d.setDate(diff))
      setFrom(start.toLocaleDateString('en-CA'))
      setTo(t)
    } else {
      setFrom(firstOfMonthStr())
      setTo(t)
    }
  }

  const periodTotals = useMemo(() => {
    let purchases = 0
    let paid = 0
    let cash = 0
    let upi = 0
    for (const a of Object.values(aggregates)) {
      purchases += a.purchases
      paid += a.paid
      cash += a.cash
      upi += a.upi
    }
    return { purchases, paid, cash, upi }
  }, [aggregates])

  const allTime = useMemo(() => {
    let due = 0
    let activeCustomers = 0
    for (const c of customers) {
      const bal = Number(c.current_balance || 0)
      if (bal > 0) {
        due += bal
        activeCustomers += 1
      }
    }
    return { due, activeCustomers }
  }, [customers])

  const customerRows = useMemo(() => {
    return customers
      .map((c) => {
        const a = aggregates[c.party_id] || {
          purchases: 0,
          paid: 0,
          cash: 0,
          upi: 0,
        }
        return { ...c, ...a }
      })
      .filter(
        (c) =>
          c.purchases > 0 || c.paid > 0 || Number(c.current_balance) > 0
      )
      .sort((a, b) => Number(b.current_balance) - Number(a.current_balance))
  }, [customers, aggregates])

  const hasRange = !!(from && to)
  const totalBalance = allTime.due
  const totalCustomers = allTime.activeCustomers

  const selectedCustomer = customers.find(
    (c) => c.party_id === pickedCustomerId
  )

  const customerOptions = customers.map((c) => ({
    value: c.party_id,
    label: c.party_name,
  }))

  const linesBySale = useMemo(() => {
    const m: Record<number, SaleLine[]> = {}
    for (const l of custLines) {
      if (!m[l.sale_id]) m[l.sale_id] = []
      m[l.sale_id].push(l)
    }
    return m
  }, [custLines])

  if (!allowed) return null

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-4 flex items-center gap-3">
          <Link
            href="/"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Customer Ledger
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Purchases, payments, and balances by customer and date range.
            </p>
          </div>
        </div>

        {/* All-time stats — always visible */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-white border border-rose-200 rounded-xl p-3">
            <div className="text-[10px] uppercase text-rose-700 tracking-wide">
              Total Balance
            </div>
            <div className="text-base font-bold text-rose-800 mt-0.5">
              {money(totalBalance)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Outstanding (all-time)
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="text-[10px] uppercase text-slate-500 tracking-wide">
              Customers Owe
            </div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {totalCustomers}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">All-time</div>
          </div>
        </div>

        {/* Customer picker */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 mb-4">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            <User className="w-3.5 h-3.5 inline mr-1" />
            Customer
          </label>
          <SmartCombobox
            options={customerOptions}
            value={pickedCustomerId ? String(pickedCustomerId) : null}
            onValueChange={(v, _l, isNew) => {
              if (isNew) return
              setPickedCustomerId(Number(v))
            }}
            placeholder="All customers (aggregate view)"
            allowCreate={false}
          />
          {pickedCustomerId && (
            <button
              onClick={() => setPickedCustomerId(null)}
              className="text-[11px] text-slate-500 hover:text-slate-700 mt-1"
            >
              Clear — back to aggregate view
            </button>
          )}
        </div>

        {/* Date range — two column From / To */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 mb-4">
          <div className="flex items-center gap-2 text-slate-700 mb-2">
            <Calendar className="w-4 h-4" />
            <span className="text-xs font-medium">Date range</span>
            {!from && !to && (
              <span className="text-[10px] text-slate-500 ml-1">(all time)</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="block text-[10px] uppercase text-slate-500 mb-0.5">
                From
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-slate-500 mb-0.5">
                To
              </label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setRange('today')}
              className="h-8 px-3 text-xs bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Today
            </button>
            <button
              onClick={() => setRange('yesterday')}
              className="h-8 px-3 text-xs bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Yesterday
            </button>
            <button
              onClick={() => setRange('week')}
              className="h-8 px-3 text-xs bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              This Week
            </button>
            <button
              onClick={() => setRange('month')}
              className="h-8 px-3 text-xs bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              This Month
            </button>
            <button
              onClick={() => {
                setFrom('')
                setTo('')
              }}
              className="h-8 px-3 text-xs bg-slate-100 rounded-lg hover:bg-slate-200 text-rose-700"
            >
              Clear (All time)
            </button>
          </div>
        </div>

        {/* Sales + Paid in range */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="text-[10px] uppercase text-slate-500 tracking-wide">
              {hasRange ? 'Sales (in range)' : 'Sales'}
            </div>
            <div
              className={`text-base font-bold mt-0.5 ${
                hasRange ? 'text-slate-900' : 'text-slate-400'
              }`}
            >
              {hasRange ? money(periodTotals.purchases) : 'Select dates'}
            </div>
          </div>
          <div className="bg-white border border-emerald-200 rounded-xl p-3">
            <div className="text-[10px] uppercase text-emerald-700 tracking-wide">
              {hasRange ? 'Paid (in range)' : 'Paid'}
            </div>
            <div
              className={`text-base font-bold mt-0.5 ${
                hasRange ? 'text-emerald-800' : 'text-slate-400'
              }`}
            >
              {hasRange ? money(periodTotals.paid) : 'Select dates'}
            </div>
            {hasRange && (
              <div className="text-[10px] text-slate-500 mt-0.5">
                Cash {money(periodTotals.cash)} · UPI {money(periodTotals.upi)}
              </div>
            )}
          </div>
        </div>

        {!pickedCustomerId && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">
              All Customers ({customerRows.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">
                      Customer
                    </th>
                    {hasRange && (
                      <>
                        <th className="px-3 py-2 text-right font-semibold text-slate-600">
                          Purchases
                        </th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-600">
                          Paid
                        </th>
                      </>
                    )}
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {customerRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={hasRange ? 4 : 2}
                        className="px-3 py-6 text-center text-slate-400"
                      >
                        {hasRange
                          ? 'No activity in this date range.'
                          : 'No customers yet.'}
                      </td>
                    </tr>
                  ) : (
                    customerRows.map((c) => (
                      <tr
                        key={c.party_id}
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                        onClick={() => setPickedCustomerId(c.party_id)}
                      >
                        <td className="px-3 py-2 text-slate-800">
                          {c.party_name}
                        </td>
                        {hasRange && (
                          <>
                            <td className="px-3 py-2 text-right text-slate-700">
                              {money(c.purchases)}
                            </td>
                            <td className="px-3 py-2 text-right text-emerald-700">
                              {money(c.paid)}
                            </td>
                          </>
                        )}
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                          {money(Number(c.current_balance))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {pickedCustomerId && selectedCustomer && (
          <>
            <div className="bg-gradient-to-br from-slate-900 to-slate-700 text-white rounded-2xl p-4 mb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase text-slate-300 tracking-wide">
                    Customer
                  </div>
                  <div className="text-lg font-bold mt-0.5">
                    {selectedCustomer.party_name}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase text-slate-300 tracking-wide">
                    Balance
                  </div>
                  <div className="text-xl font-bold mt-0.5">
                    {money(Number(selectedCustomer.current_balance))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">
                Invoices ({custSales.length})
              </div>
              {loading ? (
                <div className="px-4 py-6 text-center text-slate-400 text-sm">
                  Loading…
                </div>
              ) : custSales.length === 0 ? (
                <div className="px-4 py-6 text-center text-slate-400 text-sm">
                  No invoices in this range.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {custSales.map((s) => {
                    const due = Math.max(
                      0,
                      Number(s.total_amount) - Number(s.paid_amount || 0)
                    )
                    const isOpen = expandedSaleId === s.sale_id
                    const saleLines = linesBySale[s.sale_id] || []
                    return (
                      <div key={s.sale_id}>
                        <button
                          onClick={() =>
                            setExpandedSaleId(isOpen ? null : s.sale_id)
                          }
                          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 text-left"
                        >
                          <div className="text-slate-400 shrink-0">
                            {isOpen ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-900">
                              #{s.sale_id} · {formatDate(s.bill_date)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {saleLines.length} item
                              {saleLines.length === 1 ? '' : 's'} · Paid{' '}
                              {money(Number(s.paid_amount || 0))}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-slate-900">
                              {money(Number(s.total_amount))}
                            </div>
                            {due > 0 && (
                              <div className="text-[10px] text-rose-700">
                                {money(due)} due
                              </div>
                            )}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="bg-slate-50 border-t border-slate-100 px-4 py-3">
                            <div className="space-y-1.5">
                              {saleLines.length === 0 ? (
                                <div className="text-xs text-slate-400">
                                  No line items.
                                </div>
                              ) : (
                                saleLines.map((l) => (
                                  <div
                                    key={l.detail_id}
                                    className="flex items-center justify-between text-xs bg-white border border-slate-200 rounded px-2 py-1.5"
                                  >
                                    <div className="font-mono text-slate-800 truncate flex-1">
                                      {l.sku}
                                    </div>
                                    <div className="text-slate-500 shrink-0 ml-2">
                                      {Number.isInteger(l.quantity)
                                        ? l.quantity
                                        : l.quantity.toFixed(2)}{' '}
                                      × {money(l.rate)}
                                    </div>
                                    <div className="text-slate-900 font-medium w-24 text-right shrink-0">
                                      {money(l.amount)}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">
                Payments ({custPayments.length})
              </div>
              {custPayments.length === 0 ? (
                <div className="px-4 py-6 text-center text-slate-400 text-sm">
                  No payments in this range.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {custPayments.map((p) => (
                    <div
                      key={p.payment_id}
                      className="px-4 py-2.5 flex items-center gap-3 text-xs"
                    >
                      <div className="text-slate-500 w-24 shrink-0">
                        {formatDate(p.payment_date)}
                      </div>
                      <div className="shrink-0">
                        {p.payment_mode === 'UPI' ? (
                          <Smartphone className="w-3.5 h-3.5 text-blue-600" />
                        ) : (
                          <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                      </div>
                      <div className="text-slate-600 flex-1">
                        {p.payment_mode}
                      </div>
                      <div className="font-semibold text-slate-900 shrink-0">
                        {money(Number(p.amount))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}