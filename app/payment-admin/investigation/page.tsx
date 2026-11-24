'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, RefreshCw, Search, ShieldAlert } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { getRole } from '../../../lib/auth'
import { isCounterSaleParty } from '../../../lib/balance'

type Party = { party_id: number; party_name: string; current_balance: number | string | null }
type Sale = { sale_id: number; party_id: number; bill_date: string; total_amount: number | string; paid_amount: number | string; status?: string | null }
type Payment = { payment_id: number; party_id: number; payment_date: string; amount: number | string; payment_mode?: string | null }
type Allocation = { payment_id: number; sale_id: number; amount: number | string }
type ReturnRow = { party_id: number; total_amount: number | string; return_type?: string | null }
type Reversal = { payment_id: number; reversed_amount: number | string }
type SaleItem = { sale_id: number; amount: number | string }
type Issue = {
  key: string
  partyId: number
  partyName: string
  kind: 'payment' | 'invoice' | 'items' | 'allocation'
  title: string
  detail: string
  date: string
  amount: number
  reference: string
  severity: 'review' | 'warning'
}

const n = (v: unknown) => {
  const value = Number(v ?? 0)
  return Number.isFinite(value) ? value : 0
}
const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const money = (v: number) => `₹${round(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const EPS = 0.02

export default function PaymentBalanceInvestigationPage() {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [partyCount, setPartyCount] = useState(0)
  const [paymentCount, setPaymentCount] = useState(0)
  const [invoiceCount, setInvoiceCount] = useState(0)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const [partyRes, saleRes, paymentRes, allocationRes, returnRes, reversalRes] = await Promise.all([
        supabase.from('parties').select('party_id, party_name, current_balance').eq('party_type', 'Customer').order('party_name').limit(5000),
        supabase.from('sales').select('sale_id, party_id, bill_date, total_amount, paid_amount, status').order('bill_date').limit(5000),
        supabase.from('payments').select('payment_id, party_id, payment_date, amount, payment_mode').order('payment_date').limit(5000),
        supabase.from('payment_allocations').select('payment_id, sale_id, amount').limit(10000),
        supabase.from('returns').select('party_id, total_amount, return_type').eq('return_type', 'Customer').limit(5000),
        supabase.from('payment_reversal_items').select('payment_id, reversed_amount').limit(10000),
      ])

      const failed = [partyRes, saleRes, paymentRes, allocationRes, returnRes, reversalRes].find(r => r.error)
      if (failed?.error) throw new Error(failed.error.message)

      const parties = (partyRes.data || []) as Party[]
      const sales = (saleRes.data || []) as Sale[]
      const payments = (paymentRes.data || []) as Payment[]
      const allocations = (allocationRes.data || []) as Allocation[]
      const returns = (returnRes.data || []) as ReturnRow[]
      const reversals = (reversalRes.data || []) as Reversal[]

      // PostgREST/Supabase may cap a response at 1,000 rows even when a larger
      // limit is requested. Read sale_items in explicit pages so later invoices
      // are not falsely reported as having zero item lines.
      const saleItems: SaleItem[] = []
      const itemPageSize = 1000
      for (let from = 0; ; from += itemPageSize) {
        const { data: itemPage, error: itemError } = await supabase
          .from('sale_items')
          .select('sale_id, amount')
          .order('detail_id', { ascending: true })
          .range(from, from + itemPageSize - 1)
        if (itemError) throw new Error(`Could not load invoice item lines: ${itemError.message}`)
        const pageRows = (itemPage || []) as SaleItem[]
        saleItems.push(...pageRows)
        if (pageRows.length < itemPageSize) break
      }

      const customerParties = parties.filter(p => !isCounterSaleParty(p.party_name, Number(p.party_id)))
      const customerPartyIds = new Set(customerParties.map(p => Number(p.party_id)))
      const customerPayments = payments.filter(p => customerPartyIds.has(Number(p.party_id)))
      const customerSales = sales.filter(s => customerPartyIds.has(Number(s.party_id)))

      setPartyCount(customerParties.length)
      setPaymentCount(customerPayments.length)
      setInvoiceCount(customerSales.length)

      const partyById = new Map(parties.map(p => [Number(p.party_id), p]))
      const saleById = new Map(sales.map(s => [Number(s.sale_id), s]))
      const allocatedByPayment = new Map<number, number>()
      const allocatedBySale = new Map<number, number>()
      const reversalByPayment = new Map<number, number>()
      const itemsBySale = new Map<number, { count: number; total: number }>()

      for (const a of allocations) {
        const pid = Number(a.payment_id)
        const sid = Number(a.sale_id)
        const amount = n(a.amount)
        allocatedByPayment.set(pid, round((allocatedByPayment.get(pid) || 0) + amount))
        allocatedBySale.set(sid, round((allocatedBySale.get(sid) || 0) + amount))
      }
      for (const r of reversals) {
        const pid = Number(r.payment_id)
        reversalByPayment.set(pid, round((reversalByPayment.get(pid) || 0) + n(r.reversed_amount)))
      }
      for (const line of saleItems) {
        const sid = Number(line.sale_id)
        const current = itemsBySale.get(sid) || { count: 0, total: 0 }
        current.count += 1
        current.total = round(current.total + n(line.amount))
        itemsBySale.set(sid, current)
      }

      const next: Issue[] = []
      const add = (issue: Issue) => next.push(issue)

      for (const payment of customerPayments) {
        const pid = Number(payment.payment_id)
        const partyId = Number(payment.party_id)
        const party = partyById.get(partyId)
        const amount = n(payment.amount)
        const allocated = allocatedByPayment.get(pid) || 0
        const reversed = reversalByPayment.get(pid) || 0
        const remaining = round(amount - allocated - reversed)
        if (remaining > EPS) {
          const possibleInvoices = sales.filter(s =>
            Number(s.party_id) === partyId &&
            String(s.bill_date || '') <= String(payment.payment_date || '') &&
            round(n(s.paid_amount) - (allocatedBySale.get(Number(s.sale_id)) || 0)) > EPS
          )
          const possibleAmount = round(possibleInvoices.reduce((sum, s) =>
            sum + Math.max(0, n(s.paid_amount) - (allocatedBySale.get(Number(s.sale_id)) || 0)), 0))
          add({
            key: `p-${pid}`, partyId, partyName: party?.party_name || `Customer #${partyId}`,
            kind: 'payment', title: `Payment #${pid} has no allocation for ${money(remaining)}`,
            detail: `${money(amount)} received on ${payment.payment_date || 'date unknown'}; ${money(allocated)} linked and ${money(reversed)} reversed. Remaining amount ${money(remaining)} has no invoice link. ${possibleInvoices.length} invoice(s) may be worth checking (${money(possibleAmount)} recorded paid gap), but dates alone do not prove a match.`,
            date: String(payment.payment_date || ''), amount: remaining, reference: `Payment #${pid}`, severity: possibleInvoices.length ? 'warning' : 'review'
          })
        }
        if (allocated > amount + EPS) {
          add({
            key: `pa-${pid}`, partyId, partyName: party?.party_name || `Customer #${partyId}`,
            kind: 'allocation', title: `Allocations exceed payment #${pid}`,
            detail: `Payment ${money(amount)}; allocation records total ${money(allocated)}; excess ${money(allocated - amount)}.`,
            date: String(payment.payment_date || ''), amount: round(allocated - amount), reference: `Payment #${pid}`, severity: 'warning'
          })
        }
        if (reversed > EPS && Math.abs(reversed - amount) > EPS) {
          add({
            key: `pr-${pid}`, partyId, partyName: party?.party_name || `Customer #${partyId}`,
            kind: 'allocation', title: `Partial/unequal reversal on payment #${pid}`,
            detail: `Payment ${money(amount)}; reversal records total ${money(reversed)}. Review reversal and allocation history before interpreting the remaining amount.`,
            date: String(payment.payment_date || ''), amount: reversed, reference: `Payment #${pid}`, severity: 'warning'
          })
        }
      }

      for (const sale of customerSales) {
        const sid = Number(sale.sale_id)
        const partyId = Number(sale.party_id)
        const party = partyById.get(partyId)
        const recordedPaid = n(sale.paid_amount)
        const linked = allocatedBySale.get(sid) || 0
        const unlinkedPaid = round(recordedPaid - linked)
        const total = n(sale.total_amount)
        const itemInfo = itemsBySale.get(sid) || { count: 0, total: 0 }
        if (unlinkedPaid > EPS) {
          add({
            key: `s-${sid}`, partyId, partyName: party?.party_name || `Customer #${partyId}`,
            kind: 'invoice', title: `Invoice #${sid} has paid amount without receipt links`,
            detail: `Bill date ${sale.bill_date || 'unknown'}; invoice total ${money(total)}; recorded paid ${money(recordedPaid)}; allocation links ${money(linked)}; unlinked paid amount ${money(unlinkedPaid)}. We received the payment, but cannot find which sales invoices it was used for. This may be an older payment entered separately or an allocation link that was not saved.`,
            date: String(sale.bill_date || ''), amount: unlinkedPaid, reference: `Invoice #${sid}`, severity: 'warning'
          })
        }
        if (linked > recordedPaid + EPS) {
          add({
            key: `sx-${sid}`, partyId, partyName: party?.party_name || `Customer #${partyId}`,
            kind: 'allocation', title: `Invoice #${sid} has more allocation than recorded paid`,
            detail: `Recorded paid ${money(recordedPaid)}; allocation links ${money(linked)}; excess ${money(linked - recordedPaid)}.`,
            date: String(sale.bill_date || ''), amount: round(linked - recordedPaid), reference: `Invoice #${sid}`, severity: 'warning'
          })
        }
        const itemDiff = round(total - itemInfo.total)
        if (itemInfo.count === 0 || Math.abs(itemDiff) > EPS) {
          add({
            key: `i-${sid}`, partyId, partyName: party?.party_name || `Customer #${partyId}`,
            kind: 'items', title: `Invoice #${sid} item total does not match`,
            detail: `${itemInfo.count} item line(s); invoice total ${money(total)}; item-line total ${money(itemInfo.total)}; difference ${money(itemDiff)}.`,
            date: String(sale.bill_date || ''), amount: Math.abs(itemDiff), reference: `Invoice #${sid}`, severity: 'warning'
          })
        }
      }

      // Surface saved-balance comparisons, but do not manufacture a new balance figure here.
      // A customer with both unlinked paid invoices and unused receipts needs historical review first.
      const byPartyIssues = new Map<number, number>()
      next.forEach(i => byPartyIssues.set(i.partyId, (byPartyIssues.get(i.partyId) || 0) + 1))
      for (const party of customerParties) {
        const customerSales = sales.filter(s => Number(s.party_id) === Number(party.party_id))
        const customerReturns = returns.filter(r => Number(r.party_id) === Number(party.party_id))
        const outstanding = round(customerSales.reduce((sum, s) => sum + n(s.total_amount) - n(s.paid_amount), 0))
        const returnTotal = round(customerReturns.reduce((sum, r) => sum + n(r.total_amount), 0))
        const customerPayments = payments.filter(p => Number(p.party_id) === Number(party.party_id))
        const unused = round(customerPayments.reduce((sum, p) => {
          const pid = Number(p.payment_id)
          if ((reversalByPayment.get(pid) || 0) > EPS) return sum
          return sum + Math.max(0, n(p.amount) - (allocatedByPayment.get(pid) || 0))
        }, 0))
        const stored = n(party.current_balance)
        const currentModelEstimate = round(outstanding - returnTotal - unused)
        const hasLedgerAmbiguity = (byPartyIssues.get(Number(party.party_id)) || 0) > 0
        const difference = round(stored - currentModelEstimate)
        if (Math.abs(difference) > EPS) {
          add({
            key: `b-${party.party_id}`, partyId: Number(party.party_id), partyName: party.party_name,
            kind: 'allocation', title: `Saved balance differs from current formula by ${money(Math.abs(difference))}`,
            detail: `Saved ${money(stored)}; formula estimate ${money(currentModelEstimate)} (outstanding invoices ${money(outstanding)} − customer returns ${money(returnTotal)} − unused non-reversed payments ${money(unused)}). ${hasLedgerAmbiguity ? 'This estimate is not conclusive because this customer also has underlying ledger exceptions.' : 'No other exception was detected by this page.'}`,
            date: '', amount: Math.abs(difference), reference: `Customer #${party.party_id}`, severity: hasLedgerAmbiguity ? 'review' : 'warning'
          })
        }
      }

      next.sort((a, b) => {
        const priority = (x: Issue) => x.kind === 'payment' ? 0 : x.kind === 'invoice' ? 1 : x.kind === 'items' ? 2 : 3
        return priority(a) - priority(b) || b.amount - a.amount || a.partyName.localeCompare(b.partyName)
      })
      setIssues(next)
    } catch (e: any) {
      setError(e?.message || 'Could not load investigation data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (getRole() !== 'owner') {
      router.replace('/')
      return
    }
    setAllowed(true)
    void load()
  }, [router, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return issues.filter(i =>
      (kind === 'all' || i.kind === kind) &&
      (!q || `${i.partyName} ${i.title} ${i.detail} ${i.reference}`.toLowerCase().includes(q))
    )
  }, [issues, search, kind])

  const totals = useMemo(() => ({
    payments: issues.filter(i => i.kind === 'payment').length,
    invoices: issues.filter(i => i.kind === 'invoice').length,
    items: issues.filter(i => i.kind === 'items').length,
    allocation: issues.filter(i => i.kind === 'allocation').length,
    invoiceGap: round(issues.filter(i => i.kind === 'invoice').reduce((sum, i) => sum + i.amount, 0)),
  }), [issues])

  const groups = useMemo(() => {
    const byParty = new Map<number, { partyId: number; partyName: string; issues: Issue[]; invoiceGap: number; paymentRemainder: number }>()
    for (const issue of filtered) {
      const group = byParty.get(issue.partyId) || { partyId: issue.partyId, partyName: issue.partyName, issues: [], invoiceGap: 0, paymentRemainder: 0 }
      group.issues.push(issue)
      if (issue.kind === 'invoice') group.invoiceGap = round(group.invoiceGap + issue.amount)
      if (issue.kind === 'payment') group.paymentRemainder = round(group.paymentRemainder + issue.amount)
      byParty.set(issue.partyId, group)
    }
    return [...byParty.values()].sort((a, b) =>
      (b.invoiceGap + b.paymentRemainder) - (a.invoiceGap + a.paymentRemainder) || a.partyName.localeCompare(b.partyName)
    )
  }, [filtered])

  if (!allowed) return null

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Link href="/admin" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200" aria-label="Back to admin">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Customer Payment Check</h1>
            <p className="mt-0.5 text-xs text-slate-500">A simple customer-wise check for payments that cannot be matched with sales invoices.</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="mb-4 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div><strong>What this means:</strong> “We received the payment, but cannot find which sales invoices it was used for.” This page only reports possible mismatches. It never changes payments, invoices, allocation links or balances.</div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[11px] text-slate-500">Customers to check</div><div className="mt-1 text-xl font-bold text-slate-900">{groups.length}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[11px] text-slate-500">Amount on invoices without links</div><div className="mt-1 text-xl font-bold tabular-nums text-amber-700">{money(totals.invoiceGap)}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[11px] text-slate-500">Invoices affected</div><div className="mt-1 text-xl font-bold text-slate-900">{totals.invoices}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[11px] text-slate-500">Customers scanned</div><div className="mt-1 text-xl font-bold text-slate-900">{partyCount}</div></div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Payments without invoice links', totals.payments, 'payment'],
            ['Invoice paid amounts without links', totals.invoices, 'invoice'],
            ['Invoice item differences', totals.items, 'items'],
            ['Other checks', totals.allocation, 'allocation'],
          ].map(([label, count, value]) => (
            <button key={String(value)} onClick={() => setKind(kind === value ? 'all' : String(value))} className={`rounded-lg border p-3 text-left ${kind === value ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
              <div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 text-lg font-bold text-slate-900">{count}</div>
            </button>
          ))}
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer or invoice number..." className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></div>
          <select value={kind} onChange={e => setKind(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700"><option value="all">All checks</option><option value="payment">Payments without invoice links</option><option value="invoice">Invoice paid amounts without links</option><option value="items">Invoice item differences</option><option value="allocation">Other checks</option></select>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /><p className="mt-2 text-sm text-slate-500">Checking customer records...</p></div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" /><p className="mt-3 font-semibold text-slate-800">No mismatches found</p><p className="mt-1 text-xs text-slate-500">All records passed the checks currently enabled on this page.</p></div>
        ) : (
          <div className="space-y-3">
            {groups.map(group => (
              <details key={group.partyId} className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-3 sm:p-4 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0 flex-1">
                    <Link href={`/parties/${group.partyId}`} onClick={e => e.stopPropagation()} className="text-sm font-bold text-slate-900 hover:text-blue-700">{group.partyName}</Link>
                    <div className="mt-1 text-xs text-slate-500">{group.issues.filter(i => i.kind === 'invoice').length} invoice(s) · {group.issues.length} item(s) to review</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500">{group.invoiceGap > 0 ? 'Invoice amount not linked' : 'Payment without invoice'}</div>
                    <div className="text-base font-bold tabular-nums text-amber-700">{money(group.invoiceGap > 0 ? group.invoiceGap : group.paymentRemainder)}</div>
                    {group.invoiceGap > 0 && group.paymentRemainder > 0 && <div className="text-[10px] text-slate-500">Plus {money(group.paymentRemainder)} payment to check</div>}
                  </div>
                  <span className="ml-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">View invoices</span>
                </summary>
                <div className="border-t border-slate-100 bg-slate-50/70 p-3 sm:p-4">
                  {(group.invoiceGap > 0 || group.paymentRemainder > 0) && (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
                      <strong>Possible explanation:</strong> An invoice shows an amount as paid, but the matching payment-to-invoice link is not present. This can happen when an older payment or invoice paid amount was entered separately, or when an allocation link was not saved. The available records cannot confirm which reason applies.
                      {group.paymentRemainder > 0 && <p className="mt-1">There is also {money(group.paymentRemainder)} in payment(s) without invoice links that may need checking against these invoices.</p>}
                    </div>
                  )}
                  <div className="space-y-2">
                    {group.issues.map(issue => (
                      <div key={issue.key} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-slate-800">{issue.title}</div>
                            <p className="mt-1 text-xs leading-relaxed text-slate-600">{issue.detail}</p>
                            <p className="mt-1 text-[10px] text-slate-400">{issue.reference}{issue.date ? ` · ${issue.date}` : ''}</p>
                          </div>
                          <div className="shrink-0 text-right"><div className="text-[10px] text-slate-400">Amount</div><div className="text-sm font-bold tabular-nums text-slate-900">{money(issue.amount)}</div></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
        <div className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-slate-500"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><p>These are warning signs, not proof of missing money. A mismatch may be historical or caused by a separately entered invoice paid amount. Check the customer's payment and invoice history before making any correction.</p></div>
        <div className="mt-2 text-[10px] text-slate-400">Read-only · {paymentCount} payments and {invoiceCount} invoices checked · Counter Sale excluded</div>
      </div>
    </div>
  )
}
