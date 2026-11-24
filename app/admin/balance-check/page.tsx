
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getRole } from '../../../lib/auth'
import { SmartCombobox } from '../../../components/ui/smart-combobox'
import {
  alignPartyBalanceToTarget,
  computeExpectedCustomerBalance,
  isCounterSaleParty,
} from '../../../lib/balance'
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Eye,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

type RecentSale = {
  sale_id: number
  total_amount: number
  paid_amount: number
  bill_date: string
}

type RecentPayment = {
  payment_id: number
  amount: number
  payment_date: string
  collection_id: number | null
  unallocated: number
}

type DriftRow = {
  party_id: number
  party_name: string
  stored: number
  computed: number
  drift: number
  unpaidSales: number
  customerReturns: number
  eligibleAdvances: number
  recentSales: RecentSale[]
  recentPayments: RecentPayment[]
  possibleReasons: string[]
}

type Party = {
  party_id: number
  party_name: string
  current_balance: number
}

function money(value: number) {
  return `₹${Number(value || 0).toFixed(2)}`
}

function dateLabel(value: string) {
  if (!value) return 'Date unavailable'
  return new Date(value + 'T00:00:00').toLocaleDateString('en-IN')
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export default function BalanceCheckPage() {
  const router = useRouter()

  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [partyList, setPartyList] = useState<Party[]>([])
  const [rows, setRows] = useState<DriftRow[]>([])
  const [fixing, setFixing] = useState<number | null>(null)

  const [manualValues, setManualValues] = useState<Record<number, string>>({})
  const [dismissedIds, setDismissedIds] = useState<number[]>([])
  const [expandedRows, setExpandedRows] = useState<number[]>([])
  const [showAllCustomers, setShowAllCustomers] = useState(false)
  const [filterPartyId, setFilterPartyId] = useState<number | null>(null)

  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  useEffect(() => {
    const role = getRole()

    if (role !== 'owner') {
      router.replace('/')
      return
    }

    setIsOwner(true)
    load()
  }, [router])

  async function load() {
    setLoading(true)
    setMessage('')
    setDismissedIds([])

    try {
      const { data: parties, error: partyError } = await supabase
        .from('parties')
        .select('party_id, party_name, current_balance')
        .eq('party_type', 'Customer')
        .order('party_name')

      if (partyError) throw partyError

      const safeParties = (parties || []) as Party[]
      setPartyList(safeParties)

      const partyIds = safeParties
        .filter((p) => !isCounterSaleParty(p.party_name, p.party_id))
        .map((p) => p.party_id)

      if (partyIds.length === 0) {
        setRows([])
        return
      }

      const [salesResult, returnsResult, paymentsResult] =
        await Promise.all([
          supabase
            .from('sales')
            .select('sale_id, party_id, total_amount, paid_amount, bill_date')
            .in('party_id', partyIds)
            .order('bill_date', { ascending: false })
            .order('sale_id', { ascending: false }),

          supabase
            .from('returns')
            .select('party_id, total_amount')
            .eq('return_type', 'Customer')
            .in('party_id', partyIds),

          supabase
            .from('payments')
            .select('payment_id, party_id, amount, payment_date, collection_id')
            .in('party_id', partyIds)
            .order('payment_date', { ascending: false })
            .order('payment_id', { ascending: false }),
        ])

      if (salesResult.error) throw salesResult.error
      if (returnsResult.error) throw returnsResult.error
      if (paymentsResult.error) throw paymentsResult.error

      const sales = salesResult.data || []
      const returns = returnsResult.data || []
      const payments = paymentsResult.data || []

      const paymentIds = payments.map((p) => Number(p.payment_id))

      let allocations: Array<{ payment_id: number; amount: number }> = []
      let reversedPaymentIds = new Set<number>()

      if (paymentIds.length > 0) {
        const [allocationResult, reversalResult] = await Promise.all([
          supabase
            .from('payment_allocations')
            .select('payment_id, amount')
            .in('payment_id', paymentIds),

          supabase
            .from('payment_reversal_items')
            .select('payment_id')
            .in('payment_id', paymentIds),
        ])

        if (allocationResult.error) throw allocationResult.error
        if (reversalResult.error) throw reversalResult.error

        allocations = allocationResult.data || []

        reversedPaymentIds = new Set(
          (reversalResult.data || []).map((r) => Number(r.payment_id))
        )
      }

      const allocatedByPayment = new Map<number, number>()

      for (const allocation of allocations) {
        const id = Number(allocation.payment_id)

        allocatedByPayment.set(
          id,
          (allocatedByPayment.get(id) || 0) +
            Number(allocation.amount || 0)
        )
      }

      const resultRows: DriftRow[] = []

      for (const party of safeParties) {
        if (isCounterSaleParty(party.party_name, party.party_id)) {
          continue
        }

        const salesForParty = sales.filter(
          (s) => Number(s.party_id) === party.party_id
        )

        const returnsForParty = returns.filter(
          (r) => Number(r.party_id) === party.party_id
        )

        const paymentsForParty = payments.filter(
          (p) => Number(p.party_id) === party.party_id
        )

        // Only Day Sales Collection payments count as eligible
        // unallocated advance credit. Historical direct payments
        // are deliberately not treated as advances.
        const unallocatedCollectionPayments = paymentsForParty
          .filter((payment) => {
            if (reversedPaymentIds.has(Number(payment.payment_id))) {
              return false
            }

            const allocated =
              allocatedByPayment.get(Number(payment.payment_id)) || 0

            return Number(payment.amount || 0) - allocated > 0.01
          })
          .map((payment) => {
            const allocated =
              allocatedByPayment.get(Number(payment.payment_id)) || 0

            return {
              payment_id: Number(payment.payment_id),
              amount: Number(payment.amount || 0),
              payment_date: String(payment.payment_date || ''),
              collection_id: payment.collection_id,
              unallocated: roundMoney(
                Math.max(Number(payment.amount || 0) - allocated, 0)
              ),
            }
          })

        const eligibleAdvances = roundMoney(
          unallocatedCollectionPayments.reduce(
            (sum, payment) => sum + payment.unallocated,
            0
          )
        )

        const computed = computeExpectedCustomerBalance({
          sales: salesForParty,
          returns: returnsForParty,
          partyName: party.party_name,
          partyId: party.party_id,
          unallocatedAdvances: eligibleAdvances,
        })

        const stored = Number(party.current_balance || 0)
        const diff = roundMoney(stored - computed)

        const unpaidSales = roundMoney(
          salesForParty.reduce(
            (sum, sale) =>
              sum +
              Number(sale.total_amount || 0) -
              Number(sale.paid_amount || 0),
            0
          )
        )

        const customerReturns = roundMoney(
          returnsForParty.reduce(
            (sum, entry) => sum + Number(entry.total_amount || 0),
            0
          )
        )

        const possibleReasons: string[] = []

        if (unallocatedCollectionPayments.length > 0) {
          possibleReasons.push(
        `There are ${unallocatedCollectionPayments.length} customer payment(s) with money not allocated to bills. This remaining amount is treated as customer advance credit.`
          )
        }

        if (salesForParty.length === 0 && stored !== 0) {
          possibleReasons.push(
            'Perhaps this customer has an old opening balance, or some old bills are missing from the system.'
          )
        }

        if (customerReturns > 0) {
          possibleReasons.push(
            'Returned goods have been recorded. Perhaps another return or credit adjustment is still missing.'
          )
        }

        if (diff > 0.01) {
          possibleReasons.push(
            'Perhaps the customer paid some money, but that payment was never entered in the system.'
          )
          possibleReasons.push(
            'Perhaps a payment was entered against another customer or the wrong invoice.'
          )
          possibleReasons.push(
            'Perhaps goods were returned but the return was not recorded.'
          )
          possibleReasons.push(
            'Perhaps an old balance or previous correction is included in the saved figure.'
          )
        } else if (diff < -0.01) {
          possibleReasons.push(
            'Perhaps a bill is missing, or a bill amount was entered incorrectly.'
          )
          possibleReasons.push(
            'Perhaps a payment, return or previous adjustment was recorded differently in the two balances.'
          )
          possibleReasons.push(
            'Perhaps a payment was allocated to the wrong invoice, or an invoice payment amount was not updated correctly.'
          )
        }

        if (possibleReasons.length === 0) {
          possibleReasons.push(
            'No obvious difference was found in the available figures.'
          )
        }

        resultRows.push({
          party_id: party.party_id,
          party_name: party.party_name,
          stored,
          computed,
          drift: diff,
          unpaidSales,
          customerReturns,
          eligibleAdvances,
          recentSales: salesForParty.slice(0, 3).map((s) => ({
            sale_id: Number(s.sale_id),
            total_amount: Number(s.total_amount || 0),
            paid_amount: Number(s.paid_amount || 0),
            bill_date: String(s.bill_date || ''),
          })),
          recentPayments: paymentsForParty.slice(0, 5).map((p) => {
            const allocated =
              allocatedByPayment.get(Number(p.payment_id)) || 0

            const isEligible =
              !reversedPaymentIds.has(Number(p.payment_id))

            return {
              payment_id: Number(p.payment_id),
              amount: Number(p.amount || 0),
              payment_date: String(p.payment_date || ''),
              collection_id: p.collection_id,
              unallocated: isEligible
                ? roundMoney(
                    Math.max(Number(p.amount || 0) - allocated, 0)
                  )
                : 0,
            }
          }),
          possibleReasons,
        })
      }

      resultRows.sort(
        (a, b) => Math.abs(b.drift) - Math.abs(a.drift)
      )

      setRows(resultRows)
    } catch (e: any) {
      setMessage(
        'Could not load all customer records. Please refresh and try again. ' +
          (e?.message || '')
      )
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  async function saveBalance(
    row: DriftRow,
    value: number,
    label: string
  ) {
    if (!Number.isFinite(value) || value < 0) {
      setMessage('Please enter a valid balance of zero or more.')
      setMessageType('error')
      return
    }

    const rounded = roundMoney(value)

    if (
      !confirm(
        `Customer: ${row.party_name}\n\n` +
          `Current saved balance: ${money(row.stored)}\n` +
          `New saved balance: ${money(rounded)}\n\n` +
          `Only the saved customer balance will change. Bills, payments, allocations and returns will remain untouched.\n\n` +
          `Do you want to continue?`
      )
    ) {
      return
    }

    setFixing(row.party_id)

    try {
      const aligned = await alignPartyBalanceToTarget(
        row.party_id,
        rounded
      )

      setMessage(
        `${row.party_name}: saved balance updated to ${money(aligned)}. No bills, payments, allocations or returns were changed.`
      )
      setMessageType('success')

      setManualValues((current) => {
        const next = { ...current }
        delete next[row.party_id]
        return next
      })

      await load()
    } catch (e: any) {
      setMessage(
        'Could not change the saved balance: ' +
          (e?.message || 'Unknown error')
      )
      setMessageType('error')
    } finally {
      setFixing(null)
    }
  }

  function leaveUnresolved(row: DriftRow) {
    setDismissedIds((current) =>
      current.includes(row.party_id)
        ? current
        : [...current, row.party_id]
    )

    setMessage(
      `${row.party_name}: left unresolved. No saved records were changed. You can see this customer again by refreshing.`
    )
    setMessageType('success')
  }

  function toggleDetails(partyId: number) {
    setExpandedRows((current) =>
      current.includes(partyId)
        ? current.filter((id) => id !== partyId)
        : [...current, partyId]
    )
  }

  if (!isOwner) return null

  const differenceRows = rows.filter(
    (row) => Math.abs(row.drift) > 0.01
  )

  const matchingCount = rows.length - differenceRows.length

  const customerOptions = [
    { value: 'all', label: 'All customers' },
    ...rows.map((row) => ({
      value: row.party_id,
      label: row.party_name,
    })),
  ]

  const visibleRows = (showAllCustomers ? rows : differenceRows)
    .filter((row) => !dismissedIds.includes(row.party_id))
    .filter(
      (row) => filterPartyId === null || row.party_id === filterPartyId
    )

  const totalDifference = differenceRows.reduce(
    (sum, row) => sum + Math.abs(row.drift),
    0
  )

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6">
      <div className="max-w-5xl mx-auto">

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Link
            href="/admin"
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-200"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Customer Balance Check
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Compare all customer balances and investigate differences.
            </p>
          </div>

          <button
            onClick={load}
            disabled={loading || fixing !== null}
            className="h-10 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {message && (
          <div
            className={`mb-4 rounded-xl p-3 text-sm flex items-start gap-2 ${
              messageType === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            {messageType === 'success'
              ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            }

            <div className="flex-1">{message}</div>

            <button
              onClick={() => setMessage('')}
              className="text-slate-500 hover:text-slate-800"
            >
              ×
            </button>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-2">
            <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-slate-900">
                What does this page check?
              </div>

              <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed">
                It compares the saved balance with the amount calculated
                              from unpaid bills, customer returns and all unused customer
              payments. Any payment amount that cannot be allocated to an
              outstanding invoice remains as an advance.
              </p>

              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                This page does not automatically change any accounting
                records. It only changes a saved customer balance when
                you explicitly choose and confirm an amount.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <Loader2 className="w-7 h-7 animate-spin text-slate-400 mx-auto" />
            <p className="text-sm text-slate-500 mt-3">
              Checking all customer records...
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="text-xs text-slate-500">
                  Customers checked
                </div>
                <div className="text-xl font-bold text-slate-900 mt-1">
                  {rows.length}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="text-xs text-slate-500">
                  Balances matching
                </div>
                <div className="text-xl font-bold text-emerald-700 mt-1">
                  {matchingCount}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-3 col-span-2 sm:col-span-1">
                <div className="text-xs text-slate-500">
                  Differences found
                </div>
                <div className="text-xl font-bold text-amber-700 mt-1">
                  {differenceRows.length}
                </div>
              </div>
            </div>

            {differenceRows.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />

                  <div className="flex-1">
                    <div className="font-bold text-amber-950 text-sm">
                      {differenceRows.length} customer balance difference(s) found
                    </div>

                    <p className="text-xs text-amber-800 mt-1">
                      These differences need investigation. The calculated
                      amount is not automatically the correct amount.
                    </p>

                    <div className="mt-2 text-xs text-amber-900">
                      Total of absolute differences:{' '}
                      <strong>{money(totalDifference)}</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl p-3 mb-4">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="flex-1 min-w-0">
                  <SmartCombobox
                    options={customerOptions}
                    value={filterPartyId === null ? 'all' : String(filterPartyId)}
                    onValueChange={(value) => {
                      if (value === 'all' || value === null) {
                        setFilterPartyId(null)
                      } else {
                        setFilterPartyId(Number(value))
                        setShowAllCustomers(true)
                      }
                    }}
                    placeholder="Search or select customer..."
                    disabled={loading}
                    allowCreate={false}
                  />
                </div>

                <button
                  onClick={() => setShowAllCustomers((v) => !v)}
                  className="h-10 px-3 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {showAllCustomers
                    ? 'Show differences only'
                    : 'Show all customers'}
                </button>
              </div>

              <p className="text-[11px] text-slate-500 mt-2">
                All {rows.length} customers were checked. Counter Sale is excluded.
                Matching customers are hidden unless you choose to show all.
              </p>
            </div>

            {visibleRows.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />

                <div className="text-lg font-bold text-slate-900">
                  {differenceRows.length === 0
                    ? 'All customer balances match'
                    : 'No customers to display'}
                </div>

                <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                  {differenceRows.length === 0
                    ? 'The saved balances match the calculated amounts within the available records.'
                    : 'Try showing all customers, selecting another customer, or refreshing the review.'}
                </p>

                {differenceRows.length > 0 && dismissedIds.length > 0 && (
                  <button
                    onClick={() => setDismissedIds([])}
                    className="mt-4 h-10 px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Show unresolved differences again
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {visibleRows.map((r) => {
                  const expanded = expandedRows.includes(r.party_id)
                  const hasDifference = Math.abs(r.drift) > 0.01
                  const isFixing = fixing === r.party_id

                  return (
                    <div
                      key={r.party_id}
                      className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
                    >
                      <div className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
                          <div>
                            <Link
                              href={`/parties/${r.party_id}`}
                              className="font-bold text-base text-slate-900 hover:text-blue-600"
                            >
                              {r.party_name}
                            </Link>

                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Customer ID: {r.party_id}
                            </div>
                          </div>

                          <span className={`text-xs font-semibold rounded-full px-3 py-1 ${
                            hasDifference
                              ? 'text-amber-800 bg-amber-100'
                              : 'text-emerald-800 bg-emerald-100'
                          }`}>
                            {hasDifference ? 'Needs checking' : 'Balances match'}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mb-4">
                          <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
                            <div className="text-[10px] sm:text-xs text-slate-500 font-medium">
                              Saved balance
                            </div>
                            <div className="text-sm sm:text-base font-bold text-slate-800 mt-1 break-all">
                              {money(r.stored)}
                            </div>
                          </div>

                          <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5">
                            <div className="text-[10px] sm:text-xs text-blue-700 font-medium">
                              Calculated balance
                            </div>
                            <div className="text-sm sm:text-base font-bold text-blue-900 mt-1 break-all">
                              {money(r.computed)}
                            </div>
                          </div>

                          <div className="rounded-lg bg-amber-50 border border-amber-100 p-2.5">
                            <div className="text-[10px] sm:text-xs text-amber-700 font-medium">
                              Difference
                            </div>
                            <div className="text-sm sm:text-base font-bold text-amber-900 mt-1 break-all">
                              {r.drift > 0 ? '+' : ''}{money(r.drift)}
                            </div>
                          </div>
                        </div>

                        {hasDifference && (
                          <>
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-3">
                              <div className="text-xs font-bold text-amber-950 mb-1">
                                Possible explanations — just guesses
                              </div>

                              <p className="text-[11px] text-amber-900 mb-2">
                                These are not confirmed mistakes. Please check
                                your bills, receipts, payment records or paper
                                accounts before deciding.
                              </p>

                              <ul className="space-y-2 list-disc pl-4 text-xs text-slate-700">
                                {r.possibleReasons.map((reason, index) => (
                                  <li key={index}>{reason}</li>
                                ))}
                              </ul>
                            </div>

                            <div className="border border-slate-200 rounded-lg p-3 mb-3">
                              <div className="text-xs font-bold text-slate-800 mb-2">
                                How the calculated balance is worked out
                              </div>

                              <div className="space-y-2 text-xs">
                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-600">
                                    Money remaining on bills
                                  </span>
                                  <strong className="text-slate-800">
                                    {money(r.unpaidSales)}
                                  </strong>
                                </div>

                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-600">
                                    Less: customer returns
                                  </span>
                                  <strong className="text-slate-800">
                                    − {money(r.customerReturns)}
                                  </strong>
                                </div>

                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-600">
                                    Less: unused customer payment advances

                                  </span>
                                  <strong className="text-slate-800">
                                    − {money(r.eligibleAdvances)}
                                  </strong>
                                </div>

                                <div className="border-t border-slate-200 pt-2 flex justify-between gap-3">
                                  <span className="font-semibold text-slate-800">
                                    Calculated balance
                                  </span>
                                  <strong className="text-blue-800">
                                    {money(r.computed)}
                                  </strong>
                                </div>
                              </div>
                            </div>
                          </>
                        )}

                        <button
                          onClick={() => toggleDetails(r.party_id)}
                          className="w-full flex items-center justify-between text-xs font-semibold text-blue-700 hover:text-blue-900 py-2"
                        >
                          <span className="flex items-center gap-2">
                            <Eye className="w-4 h-4" />
                            {expanded
                              ? 'Hide bills and payments'
                              : 'View bills and payments'}
                          </span>

                          {expanded
                            ? <ChevronUp className="w-4 h-4" />
                            : <ChevronDown className="w-4 h-4" />
                          }
                        </button>

                        {expanded && (
                          <div className="mt-2 space-y-3">
                            <div className="border border-slate-200 rounded-lg p-3">
                              <div className="text-xs font-bold text-slate-800 mb-2">
                                Recent bills
                              </div>

                              {r.recentSales.length === 0 ? (
                                <p className="text-xs text-slate-500">
                                  No bills found.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {r.recentSales.map((sale) => (
                                    <div
                                      key={sale.sale_id}
                                      className="flex justify-between gap-3 text-xs border-b border-slate-100 last:border-0 pb-2 last:pb-0"
                                    >
                                      <div>
                                        <div className="font-semibold text-slate-800">
                                          Bill #{sale.sale_id}
                                        </div>
                                        <div className="text-slate-500 mt-0.5">
                                          {dateLabel(sale.bill_date)}
                                        </div>
                                      </div>

                                      <div className="text-right">
                                        <div className="font-semibold text-slate-800">
                                          {money(sale.total_amount)}
                                        </div>
                                        <div className="text-slate-500 mt-0.5">
                                          Paid: {money(sale.paid_amount)}
                                        </div>
                                        <div className="text-slate-500 mt-0.5">
                                          Remaining: {money(
                                            sale.total_amount - sale.paid_amount
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="border border-slate-200 rounded-lg p-3">
                              <div className="text-xs font-bold text-slate-800 mb-2">
                                Recent payments
                              </div>

                              {r.recentPayments.length === 0 ? (
                                <p className="text-xs text-slate-500">
                                  No payments found.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {r.recentPayments.map((payment) => (
                                    <div
                                      key={payment.payment_id}
                                      className="flex justify-between gap-3 text-xs border-b border-slate-100 last:border-0 pb-2 last:pb-0"
                                    >
                                      <div>
                                        <div className="font-semibold text-slate-800">
                                          Payment #{payment.payment_id}
                                        </div>
                                        <div className="text-slate-500 mt-0.5">
                                          {dateLabel(payment.payment_date)}
                                        </div>
                                        {payment.collection_id !== null && (
                                          <div className="text-slate-500 mt-0.5">
                                            Day Sales Collection
                                          </div>
                                        )}
                                        {payment.unallocated > 0.01 && (
                                          <div className="text-amber-700 font-semibold mt-1">
                                            Unallocated: {money(payment.unallocated)}
                                          </div>
                                        )}
                                      </div>

                                      <strong className="text-slate-800">
                                        {money(payment.amount)}
                                      </strong>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {hasDifference && (
                          <div className="mt-4 rounded-lg bg-blue-50 border border-blue-100 p-3">
                            <div className="text-xs font-bold text-blue-900 mb-1">
                              Choose the balance you believe is correct
                            </div>

                            <p className="text-xs text-blue-800 leading-relaxed">
                              You can use the calculated amount, keep the
                              saved amount, or enter a different amount
                              confirmed from your memory, old ledger or
                              paperwork. You can also leave this unresolved.
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                              <button
                                onClick={() =>
                                  saveBalance(r, r.computed, 'calculated')
                                }
                                disabled={fixing !== null}
                                className="min-h-11 px-3 py-2 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                              >
                                {isFixing ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Wrench className="w-4 h-4" />
                                )}
                                Use calculated: {money(r.computed)}
                              </button>

                              <button
                                onClick={() =>
                                  saveBalance(r, r.stored, 'saved')
                                }
                                disabled={fixing !== null}
                                className="min-h-11 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-2"
                              >
                                <Eye className="w-4 h-4" />
                                Keep saved: {money(r.stored)}
                              </button>
                            </div>

                            <div className="mt-3 border-t border-blue-200 pt-3">
                              <label className="block text-xs font-semibold text-blue-900 mb-1">
                                Or enter another confirmed balance (₹)
                              </label>

                              <div className="flex flex-col sm:flex-row gap-2">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={manualValues[r.party_id] ?? ''}
                                  onChange={(e) =>
                                    setManualValues((current) => ({
                                      ...current,
                                      [r.party_id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Enter correct balance"
                                  className="flex-1 h-10 rounded-lg border border-blue-200 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                                />

                                <button
                                  onClick={() => {
                                    const raw = manualValues[r.party_id]
                                    if (raw === undefined || raw.trim() === '') {
                                      setMessage('Please enter a balance first.')
                                      setMessageType('error')
                                      return
                                    }

                                    const value = Number(raw)
                                    if (!Number.isFinite(value) || value < 0) {
                                      setMessage('Please enter a valid balance of zero or more.')
                                      setMessageType('error')
                                      return
                                    }

                                    saveBalance(r, value, 'manual')
                                  }}
                                  disabled={
                                    fixing !== null ||
                                    !manualValues[r.party_id]?.trim()
                                  }
                                  className="h-10 px-4 text-xs font-bold text-white bg-slate-800 rounded-lg hover:bg-slate-900 disabled:opacity-50"
                                >
                                  Save entered balance
                                </button>
                              </div>
                            </div>

                            <button
                              onClick={() => leaveUnresolved(r)}
                              disabled={fixing !== null}
                              className="w-full mt-3 min-h-10 px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-50"
                            >
                              Leave unresolved — do nothing for now
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
