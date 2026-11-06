'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { SmartCombobox } from '../../../components/ui/smart-combobox'
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronRight,
  Receipt,
  User,
  Banknote,
  Smartphone,
  Copy,
  Check,
  MessageCircle,
} from 'lucide-react'

type Party = {
  party_id: number
  party_name: string
}

type Payment = {
  payment_id: number
  party_id: number
  party_name: string
  payment_date: string
  amount: number
  payment_mode: string
}

type Allocation = {
  payment_id: number
  sale_id: number
  amount: number
}

type SaleInfo = {
  sale_id: number
  bill_date: string
  total_amount: number
  paid_amount: number
}

type SaleLine = {
  sale_id: number
  detail_id: number
  sku: string
  quantity: number
  rate: number
  amount: number
}

type ModeFilter = 'All' | 'Cash' | 'UPI'

function todayStr() {
  return new Date().toLocaleDateString('en-CA')
}

function thirtyDaysAgoStr() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toLocaleDateString('en-CA')
}

function money(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function PaymentsReportPage() {
  const [fromDate, setFromDate] = useState(thirtyDaysAgoStr())
  const [toDate, setToDate] = useState(todayStr())
  const [partyId, setPartyId] = useState<string | null>(null)
  const [partyLabel, setPartyLabel] = useState('')
  const [mode, setMode] = useState<ModeFilter>('All')

  const [parties, setParties] = useState<Party[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [allocationsByPayment, setAllocationsByPayment] = useState<
    Record<number, Allocation[]>
  >({})
  const [salesById, setSalesById] = useState<Record<number, SaleInfo>>({})
  const [linesBySale, setLinesBySale] = useState<Record<number, SaleLine[]>>({})
  const [expandedPayments, setExpandedPayments] = useState<Set<number>>(new Set())

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // Phone lookup for WhatsApp — fetch parties includes phone? We have party_name only. Need phone too.
  const [partyPhone, setPartyPhone] = useState<string | null>(null)

  useEffect(() => {
    if (!partyId) {
      setPartyPhone(null)
      return
    }
    ;(async () => {
      const { data } = await supabase
        .from('parties')
        .select('phone')
        .eq('party_id', Number(partyId))
        .maybeSingle()
      setPartyPhone(data?.phone || null)
    })()
  }, [partyId])
  const totals = useMemo(() => {
    const total = payments.reduce((s, p) => s + p.amount, 0)
    const cash = payments
      .filter((p) => p.payment_mode === 'Cash')
      .reduce((s, p) => s + p.amount, 0)
    const upi = payments
      .filter((p) => p.payment_mode === 'UPI')
      .reduce((s, p) => s + p.amount, 0)
    return { total, cash, upi, count: payments.length }
  }, [payments])

  const reportText = useMemo(() => {
    if (!partyId || payments.length === 0) return ''

    const lines: string[] = []
    const label = partyLabel || 'Customer'
    lines.push(`*Payments — ${label}*`)
    lines.push(`Period: ${formatDate(fromDate)} – ${formatDate(toDate)}`)
    lines.push('')
    lines.push(`Total received: ${money(totals.total)}`)
    if (totals.cash > 0 || totals.upi > 0) {
      const parts: string[] = []
      if (totals.cash > 0) parts.push(`Cash ${money(totals.cash)}`)
      if (totals.upi > 0) parts.push(`UPI ${money(totals.upi)}`)
      lines.push(parts.join(' · '))
    }
    lines.push(
      `${totals.count} payment${totals.count === 1 ? '' : 's'}`
    )
    lines.push('')
    lines.push('*Recent:*')
    for (const p of payments.slice(0, 20)) {
      lines.push(
        `${formatDate(p.payment_date)} · ${money(p.amount)} · ${p.payment_mode}`
      )
    }
    if (payments.length > 20) {
      lines.push(`… and ${payments.length - 20} more`)
    }
    return lines.join('\n')
  }, [partyId, partyLabel, payments, totals, fromDate, toDate])

  async function copyReport() {
    if (!reportText) return
    try {
      await navigator.clipboard.writeText(reportText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = reportText
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
    if (!reportText) return
    const phone = partyPhone?.replace(/\D/g, '').slice(-10)
    const url = phone
      ? `https://wa.me/91${phone}?text=${encodeURIComponent(reportText)}`
      : `https://wa.me/?text=${encodeURIComponent(reportText)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('parties')
        .select('party_id, party_name')
        .eq('party_type', 'Customer')
        .order('party_name')
      setParties((data as Party[]) || [])
    })()
  }, [])

  useEffect(() => {
    if (parties.length === 0) return
    loadReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, partyId, mode, parties.length])

  async function loadReport() {
    setLoading(true)
    setError('')
    setExpandedPayments(new Set())

    if (!fromDate || !toDate) {
      setPayments([])
      setLoading(false)
      return
    }

    let q = supabase
      .from('payments')
      .select('payment_id, party_id, payment_date, amount, payment_mode')
      .gte('payment_date', fromDate)
      .lte('payment_date', toDate)
      .order('payment_date', { ascending: false })
      .order('payment_id', { ascending: false })

    if (partyId) q = q.eq('party_id', Number(partyId))
    if (mode !== 'All') q = q.eq('payment_mode', mode)

    const { data: payData, error: payErr } = await q
    if (payErr) {
      setError('Could not load payments: ' + payErr.message)
      setPayments([])
      setLoading(false)
      return
    }

    const payList = (payData as any[]) || []
    const partyMap: Record<number, string> = {}
    for (const p of parties) partyMap[p.party_id] = p.party_name

    const enriched: Payment[] = payList.map((p) => ({
      payment_id: p.payment_id,
      party_id: p.party_id,
      party_name: partyMap[p.party_id] || `Party #${p.party_id}`,
      payment_date: p.payment_date,
      amount: Number(p.amount),
      payment_mode: p.payment_mode,
    }))

    setPayments(enriched)

    // Fetch allocations for these payments
    const paymentIds = enriched.map((p) => p.payment_id)
    let allocsMap: Record<number, Allocation[]> = {}
    let salesMap: Record<number, SaleInfo> = {}
    let linesMap: Record<number, SaleLine[]> = {}

    if (paymentIds.length > 0) {
      const { data: allocData } = await supabase
        .from('payment_allocations')
        .select('payment_id, sale_id, amount')
        .in('payment_id', paymentIds)

      const allocs = (allocData as any[]) || []
      const saleIds = Array.from(new Set(allocs.map((a) => a.sale_id)))

      for (const a of allocs) {
        if (!allocsMap[a.payment_id]) allocsMap[a.payment_id] = []
        allocsMap[a.payment_id].push({
          payment_id: a.payment_id,
          sale_id: a.sale_id,
          amount: Number(a.amount),
        })
      }

      if (saleIds.length > 0) {
        const { data: salesData } = await supabase
          .from('sales')
          .select('sale_id, bill_date, total_amount, paid_amount')
          .in('sale_id', saleIds)

        for (const s of salesData || []) {
          salesMap[s.sale_id] = {
            sale_id: s.sale_id,
            bill_date: s.bill_date,
            total_amount: Number(s.total_amount),
            paid_amount: Number(s.paid_amount || 0),
          }
        }

        // Fetch sale_items chunked
        const CHUNK = 80
        const rawLines: any[] = []
        for (let i = 0; i < saleIds.length; i += CHUNK) {
          const slice = saleIds.slice(i, i + CHUNK)
          const { data: chunkData } = await supabase
            .from('sale_items')
            .select('sale_id, detail_id, item_id, quantity, rate, amount')
            .in('sale_id', slice)
          if (chunkData) rawLines.push(...chunkData)
        }

        const itemIds = Array.from(
          new Set(rawLines.map((l) => l.item_id).filter(Boolean))
        ) as number[]

        const skuMap: Record<number, string> = {}
        if (itemIds.length > 0) {
          const ICHUNK = 80
          for (let i = 0; i < itemIds.length; i += ICHUNK) {
            const slice = itemIds.slice(i, i + ICHUNK)
            const { data: itemRows } = await supabase
              .from('items')
              .select('item_id, sku')
              .in('item_id', slice)
            for (const it of itemRows || []) skuMap[it.item_id] = it.sku
          }
        }

        for (const l of rawLines) {
          if (!linesMap[l.sale_id]) linesMap[l.sale_id] = []
          linesMap[l.sale_id].push({
            sale_id: l.sale_id,
            detail_id: l.detail_id,
            sku: skuMap[l.item_id] || `Item #${l.item_id}`,
            quantity: Number(l.quantity),
            rate: Number(l.rate),
            amount: Number(l.amount),
          })
        }
      }
    }

    setAllocationsByPayment(allocsMap)
    setSalesById(salesMap)
    setLinesBySale(linesMap)
    setLoading(false)
  }

  function toggleExpand(paymentId: number) {
    setExpandedPayments((prev) => {
      const next = new Set(prev)
      if (next.has(paymentId)) next.delete(paymentId)
      else next.add(paymentId)
      return next
    })
  }



  function clearParty() {
    setPartyId(null)
    setPartyLabel('')
  }

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-xs sm:text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All reports
        </Link>

        <div className="mb-4 sm:mb-6">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 sm:w-6 sm:h-6 text-slate-700" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Payments Report
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            All payments received, and the bills they cleared.
          </p>
        </div>

        {/* Date range */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-3">
          <div className="flex items-center gap-2 text-slate-700 mb-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span className="text-xs sm:text-sm font-medium">Date range</span>
            {loading && (
              <span className="text-[10px] text-slate-400 ml-auto">
                Loading…
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="flex-1 h-9 px-2 text-sm border border-slate-300 rounded-lg bg-white"
            />
            <span className="text-slate-400 text-sm shrink-0">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="flex-1 h-9 px-2 text-sm border border-slate-300 rounded-lg bg-white"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button
              onClick={() => {
                const t = todayStr()
                setFromDate(t)
                setToDate(t)
              }}
              className="h-7 px-2.5 text-xs font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200"
            >
              Today
            </button>
            <button
              onClick={() => {
                const d = new Date()
                d.setDate(d.getDate() - 1)
                const y = d.toLocaleDateString('en-CA')
                setFromDate(y)
                setToDate(y)
              }}
              className="h-7 px-2.5 text-xs font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200"
            >
              Yesterday
            </button>
            <button
              onClick={() => {
                setFromDate(thirtyDaysAgoStr())
                setToDate(todayStr())
              }}
              className="h-7 px-2.5 text-xs font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200"
            >
              Last 30 days
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Customer (optional)
            </label>
            <SmartCombobox
              options={parties.map((p) => ({
                value: p.party_id,
                label: p.party_name,
              }))}
              value={partyId}
              onValueChange={(v, label) => {
                setPartyId(v || null)
                setPartyLabel(label || '')
              }}
              placeholder="All customers"
              allowCreate={false}
              fallbackLabel={partyLabel || null}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Mode
            </label>
            <div className="flex gap-2">
              {(['All', 'Cash', 'UPI'] as ModeFilter[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`h-9 px-4 text-xs font-semibold rounded-lg ${
                    mode === m
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Summary */}
        {!loading && payments.length > 0 && (
          <div className="bg-gradient-to-r from-slate-700 to-slate-900 rounded-2xl p-4 sm:p-5 shadow-sm mb-4 text-white">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs sm:text-sm">
              <div>
                <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                  Count
                </div>
                <div className="text-base sm:text-xl font-bold mt-0.5">
                  {totals.count}
                </div>
              </div>
              <div>
                <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                  Total
                </div>
                <div className="text-base sm:text-xl font-bold mt-0.5">
                  {money(totals.total)}
                </div>
              </div>
              <div>
                <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide flex items-center gap-1">
                  <Banknote className="w-3 h-3" /> Cash
                </div>
                <div className="text-base sm:text-xl font-bold mt-0.5">
                  {money(totals.cash)}
                </div>
              </div>
              <div>
                <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide flex items-center gap-1">
                  <Smartphone className="w-3 h-3" /> UPI
                </div>
                <div className="text-base sm:text-xl font-bold mt-0.5">
                  {money(totals.upi)}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Copy / WhatsApp — only when customer is selected */}
        {partyId && reportText && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              onClick={copyReport}
              className="h-11 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 flex items-center justify-center gap-2"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" /> Copy
                </>
              )}
            </button>
            <button
              onClick={openWhatsApp}
              className="h-11 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </button>
          </div>
        )}
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
        ) : payments.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <Receipt className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-600">
              No payments found.
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Try a different date range or filter.
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="divide-y divide-slate-100">
              {payments.map((p) => {
                const allocs = allocationsByPayment[p.payment_id] || []
                const hasAllocs = allocs.length > 0
                const isExpanded = expandedPayments.has(p.payment_id)
                const isLegacy = !hasAllocs && p.amount > 0

                return (
                  <div key={p.payment_id}>
                    <div
                      className="px-3 sm:px-4 py-3 flex items-start gap-3 hover:bg-slate-50 cursor-pointer"
                      onClick={() => toggleExpand(p.payment_id)}
                    >
                      <div className="shrink-0 text-slate-400 self-center">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-sm font-semibold text-slate-900">
                            {formatDate(p.payment_date)}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {p.party_name}
                          </div>
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${
                              p.payment_mode === 'UPI'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {p.payment_mode}
                          </span>
                          {isLegacy && (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-500">
                              no allocation
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          #{p.payment_id}
                          {hasAllocs && (
                            <span className="ml-2">
                              → {allocs.length} bill
                              {allocs.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-slate-900">
                          {money(p.amount)}
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100 px-3 sm:px-4 py-3">
                        {!hasAllocs ? (
                          <div className="text-xs text-slate-500 italic">
                            No bill allocations tracked (payment recorded before allocation tracking was added on 2026-11-07).
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {allocs.map((a) => {
                              const sale = salesById[a.sale_id]
                              const lines = linesBySale[a.sale_id] || []
                              return (
                                <div
                                  key={`${a.payment_id}-${a.sale_id}`}
                                  className="bg-white border border-slate-200 rounded-lg p-2"
                                >
                                  <div className="flex items-center justify-between text-xs mb-1.5 pb-1.5 border-b border-slate-100">
                                    <div>
                                      <span className="font-semibold text-slate-800">
                                        Bill #{a.sale_id}
                                      </span>
                                      {sale && (
                                        <span className="text-slate-500 ml-2">
                                          {formatDate(sale.bill_date)} · total{' '}
                                          {money(sale.total_amount)}
                                        </span>
                                      )}
                                    </div>
                                    <span className="font-bold text-slate-900">
                                      {money(a.amount)}
                                    </span>
                                  </div>
                                  <div className="space-y-0.5">
                                    {lines.length === 0 ? (
                                      <div className="text-[11px] text-slate-400 italic">
                                        No lines found
                                      </div>
                                    ) : (
                                      lines.map((l) => (
                                        <div
                                          key={l.detail_id}
                                          className="flex items-center gap-2 text-[11px]"
                                        >
                                          <span className="font-mono text-slate-800 flex-1 break-all">
                                            {l.sku}
                                          </span>
                                          <span className="text-slate-500 whitespace-nowrap">
                                            {l.quantity} × {money(l.rate)}
                                          </span>
                                          <span className="font-semibold text-slate-900 w-20 text-right">
                                            {money(l.amount)}
                                          </span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}