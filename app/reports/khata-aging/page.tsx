'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

import {
  ArrowLeft,
  Users,

  ChevronRight,
  ChevronDown,
  Store,
  Clock,
} from 'lucide-react'

type AgeBucket = '0-30' | '31-60' | '61-90' | '90+'

type CustomerAging = {
  party_id: number
  party_name: string
  phone: string | null
  total_due: number
  oldest_days: number
  bills: {
    sale_id: number
    bill_date: string
    total_amount: number
    paid_amount: number
    due: number
    days_old: number
    bucket: AgeBucket
  }[]
}

const BUCKETS: {
  key: AgeBucket
  label: string
  hint: string
  color: {
    bg: string
    text: string
    border: string
    gradient: string
  }
}[] = [
  {
    key: '0-30',
    label: '0–30 days',
    hint: 'Recent — usually fine',
    color: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      gradient: 'from-emerald-600 to-emerald-500',
    },
  },
  {
    key: '31-60',
    label: '31–60 days',
    hint: 'Getting old — follow up',
    color: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      border: 'border-amber-200',
      gradient: 'from-amber-500 to-amber-400',
    },
  },
  {
    key: '61-90',
    label: '61–90 days',
    hint: 'Overdue — chase now',
    color: {
      bg: 'bg-orange-50',
      text: 'text-orange-700',
      border: 'border-orange-200',
      gradient: 'from-orange-600 to-orange-500',
    },
  },
  {
    key: '90+',
    label: '90+ days',
    hint: 'Critical — may be bad debt',
    color: {
      bg: 'bg-rose-50',
      text: 'text-rose-700',
      border: 'border-rose-200',
      gradient: 'from-rose-600 to-rose-500',
    },
  },
]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function money(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`
}

function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(fromDate + 'T00:00:00').getTime()
  const to = new Date(toDate + 'T00:00:00').getTime()
  return Math.max(0, Math.floor((to - from) / (1000 * 60 * 60 * 24)))
}

function bucketFor(days: number): AgeBucket {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function KhataAgingReportPage() {
  const router = useRouter()



  const [customers, setCustomers] = useState<CustomerAging[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [expandedCustomers, setExpandedCustomers] = useState<
    Record<number, boolean>
  >({})
  const [collapsedBuckets, setCollapsedBuckets] = useState<
    Record<AgeBucket, boolean>
  >({
    '0-30': false,
    '31-60': false,
    '61-90': false,
    '90+': false,
  })

  useEffect(() => {
    loadReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadReport() {
    setLoading(true)
    setError('')

    // 1. All outstanding sales
    const { data: salesData, error: sErr } = await supabase
      .from('sales')
      .select('sale_id, party_id, bill_date, total_amount, paid_amount')
      .order('bill_date', { ascending: true })

    if (sErr) {
      setError('Could not load report: ' + sErr.message)
      setLoading(false)
      return
    }

    const allSales = ((salesData || []) as any[]).filter(
      (s) => Number(s.paid_amount || 0) < Number(s.total_amount)
    )

    if (allSales.length === 0) {
      setCustomers([])
      setLoading(false)
      return
    }

    // 2. Fetch customer info
    const partyIds = Array.from(
      new Set(allSales.map((s) => s.party_id).filter(Boolean))
    )
    const { data: partyRows } = await supabase
      .from('parties')
      .select('party_id, party_name, phone, party_type')
      .in('party_id', partyIds as number[])

    const partyMap: Record<
      number,
      { name: string; phone: string | null; type: string }
    > = {}
    for (const p of partyRows || []) {
      partyMap[p.party_id] = {
        name: p.party_name,
        phone: p.phone,
        type: p.party_type,
      }
    }

    // 3. Build per-customer aging
    const today = todayStr()
    const byCustomer: Record<number, CustomerAging> = {}

    for (const s of allSales) {
      const party = partyMap[s.party_id]
      if (!party || party.type !== 'Customer') continue

      const total = Number(s.total_amount || 0)
      const paid = Number(s.paid_amount || 0)
      const due = Math.max(0, total - paid)
      if (due <= 0) continue

      const days = daysBetween(s.bill_date, today)
      const bucket = bucketFor(days)

      if (!byCustomer[s.party_id]) {
        byCustomer[s.party_id] = {
          party_id: s.party_id,
          party_name: party.name,
          phone: party.phone,
          total_due: 0,
          oldest_days: 0,
          bills: [],
        }
      }
      byCustomer[s.party_id].total_due += due
      if (days > byCustomer[s.party_id].oldest_days) {
        byCustomer[s.party_id].oldest_days = days
      }
      byCustomer[s.party_id].bills.push({
        sale_id: s.sale_id,
        bill_date: s.bill_date,
        total_amount: total,
        paid_amount: paid,
        due,
        days_old: days,
        bucket,
      })
    }

    // 4. Sort each customer's bills (oldest first), then customers by total due
    const result = Object.values(byCustomer)
      .map((c) => ({
        ...c,
        bills: [...c.bills].sort((a, b) => b.days_old - a.days_old),
      }))
      .sort((a, b) => b.total_due - a.total_due)

    setCustomers(result)
    setLoading(false)
  }

  function toggleCustomer(partyId: number) {
    setExpandedCustomers((prev) => ({ ...prev, [partyId]: !prev[partyId] }))
  }

  function toggleBucket(bucket: AgeBucket) {
    setCollapsedBuckets((prev) => ({ ...prev, [bucket]: !prev[bucket] }))
  }

  // Bucket summary: total due + customer count per bucket
  const bucketSummary = useMemo(() => {
    const summary: Record<
      AgeBucket,
      { total_due: number; customer_count: number }
    > = {
      '0-30': { total_due: 0, customer_count: 0 },
      '31-60': { total_due: 0, customer_count: 0 },
      '61-90': { total_due: 0, customer_count: 0 },
      '90+': { total_due: 0, customer_count: 0 },
    }

    for (const c of customers) {
      // A customer may have bills in multiple buckets.
      // For bucket customer_count, count if they have ANY bill in that bucket.
      // For bucket total_due, sum only the bills in that bucket.
      const seenBuckets = new Set<AgeBucket>()
      for (const b of c.bills) {
        summary[b.bucket].total_due += b.due
        seenBuckets.add(b.bucket)
      }
      for (const bucket of seenBuckets) {
        summary[bucket].customer_count += 1
      }
    }

    return summary
  }, [customers])

  const grandTotal = customers.reduce((s, c) => s + c.total_due, 0)
  const grandCustomerCount = customers.length

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
            <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-rose-600" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Khata Aging
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Who owes money, and how long it's been outstanding. Aged as of
            today.
          </p>
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
            Loading…
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800">
            {error}
          </div>
        ) : customers.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-600">
              Everyone's paid up.
            </div>
            <div className="text-xs text-slate-400 mt-1">
              No outstanding khata at the moment.
            </div>
          </div>
        ) : (
          <>
            {/* Grand total */}
            <div className="bg-gradient-to-r from-rose-600 to-rose-500 rounded-2xl p-4 sm:p-5 shadow-sm mb-4 text-white">
              <div className="flex items-center gap-2 text-white/80 text-xs font-medium uppercase tracking-wide mb-1">
                <Users className="w-4 h-4" />
                Total Khata Outstanding
              </div>
              <div className="text-3xl sm:text-4xl font-bold">
                {money(grandTotal)}
              </div>
              <div className="text-xs text-white/80 mt-1">
                {grandCustomerCount} customer
                {grandCustomerCount === 1 ? '' : 's'} owing
              </div>
            </div>

            {/* Bucket summary tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {BUCKETS.map((b) => {
                const s = bucketSummary[b.key]
                return (
                  <div
                    key={b.key}
                    className={`rounded-xl border ${b.color.bg} ${b.color.border} p-3`}
                  >
                    <div
                      className={`text-[10px] font-semibold uppercase tracking-wide ${b.color.text}`}
                    >
                      {b.label}
                    </div>
                    <div
                      className={`text-base sm:text-lg font-bold mt-0.5 ${b.color.text}`}
                    >
                      {money(s.total_due)}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {s.customer_count} customer
                      {s.customer_count === 1 ? '' : 's'}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Per-bucket customer lists */}
            <div className="space-y-3">
              {BUCKETS.map((b) => {
                // Customers who have at least one bill in this bucket
                const customersInBucket = customers
                  .filter((c) => c.bills.some((bill) => bill.bucket === b.key))
                  .sort(
                    (a, bb) =>
                      bb.bills
                        .filter((x) => x.bucket === b.key)
                        .reduce((s, x) => s + x.due, 0) -
                      a.bills
                        .filter((x) => x.bucket === b.key)
                        .reduce((s, x) => s + x.due, 0)
                  )

                if (customersInBucket.length === 0) return null

                const isCollapsed = collapsedBuckets[b.key]

                return (
                  <div
                    key={b.key}
                    className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
                  >
                    {/* Bucket header */}
                    <button
                      onClick={() => toggleBucket(b.key)}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 text-left border-b border-slate-100"
                    >
                      <div className="shrink-0 text-slate-400">
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-bold ${b.color.text}`}>
                          {b.label}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {b.hint} · {customersInBucket.length} customer
                          {customersInBucket.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div
                        className={`text-sm font-bold shrink-0 ${b.color.text}`}
                      >
                        {money(bucketSummary[b.key].total_due)}
                      </div>
                    </button>

                    {/* Customer rows */}
                    {!isCollapsed && (
                      <div className="divide-y divide-slate-100">
                        {customersInBucket.map((c) => {
                          const billsInBucket = c.bills.filter(
                            (bill) => bill.bucket === b.key
                          )
                          const bucketDue = billsInBucket.reduce(
                            (s, bill) => s + bill.due,
                            0
                          )
                          const isExpanded = !!expandedCustomers[c.party_id]
                          const oldestInBucket = billsInBucket.reduce(
                            (max, bill) =>
                              bill.days_old > max ? bill.days_old : max,
                            0
                          )
                          return (
                            <div key={c.party_id}>
                              <div className="px-3 sm:px-4 py-3 flex items-center gap-3">
                                <div
                                  className={`w-9 h-9 rounded-lg ${b.color.bg} ${b.color.text} flex items-center justify-center shrink-0`}
                                >
                                  <Store className="w-4 h-4" />
                                </div>
                                <button
                                  onClick={() => toggleCustomer(c.party_id)}
                                  className="flex-1 min-w-0 text-left"
                                >
                                  <div className="text-sm font-semibold text-slate-900 truncate">
                                    {c.party_name}
                                  </div>
                                  <div className="text-[11px] text-slate-500 truncate">
                                    {billsInBucket.length} bill
                                    {billsInBucket.length === 1 ? '' : 's'} ·
                                    oldest {oldestInBucket}d
                                    {c.phone && <> · {c.phone}</>}
                                  </div>
                                </button>
                                <div
                                  className={`text-sm font-bold shrink-0 ${b.color.text}`}
                                >
                                  {money(bucketDue)}
                                </div>
                                <button
                                  onClick={() =>
                                    router.push(`/parties/${c.party_id}`)
                                  }
                                  className="h-9 px-3 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 flex items-center gap-1 shrink-0"
                                >
                                  Open
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              </div>

                              {/* Expanded bills list */}
                              {isExpanded && (
                                <div className="bg-slate-50 border-t border-slate-100 px-3 sm:px-4 py-2">
                                  <div className="space-y-1">
                                    {billsInBucket.map((bill) => (
                                      <div
                                        key={bill.sale_id}
                                        className="flex items-center gap-2 text-xs py-0.5"
                                      >
                                        <div className="text-slate-500 w-24 shrink-0">
                                          {formatDate(bill.bill_date)}
                                        </div>
                                        <div className="text-slate-400 w-10 shrink-0 text-right">
                                          {bill.days_old}d
                                        </div>
                                        <div className="flex-1 text-right text-slate-700">
                                          {money(bill.due)} due
                                          <span className="text-slate-400 ml-1">
                                            of {money(bill.total_amount)}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

      </div>
    </div>
  )
}