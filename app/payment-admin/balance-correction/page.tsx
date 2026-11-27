'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, ShieldAlert, Save, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { isOwner } from '@/lib/auth'

type Party = { party_id: number; party_name: string; current_balance: number | string | null }
type Sale = { sale_id: number; bill_date: string; total_amount: number | string; paid_amount: number | string }
type Payment = { payment_id: number; payment_date: string; amount: number | string }
type Allocation = { payment_id: number; sale_id: number; amount: number | string }
type ReturnRow = { total_amount: number | string }
type Reversal = { payment_id: number; reversed_amount: number | string }
type Adjustment = { adjustment_id: number; adjustment_amount: number | string; balance_before: number | string; balance_after: number | string; reason: string | null; created_at: string }

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0 }
const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const money = (v: number) => `₹${round(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const EPS = 0.02

export default function BalanceCorrectionPage() {
  const [allowed, setAllowed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [parties, setParties] = useState<Party[]>([])
  const [partyId, setPartyId] = useState('')
  const [sales, setSales] = useState<Sale[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [reversals, setReversals] = useState<Reversal[]>([])
  const [history, setHistory] = useState<Adjustment[]>([])
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    const owner = isOwner()
    setAllowed(owner)
    setChecking(false)
    if (!owner) return
    void supabase.from('parties').select('party_id, party_name, current_balance').eq('party_type', 'Customer').order('party_name').limit(5000)
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setParties(((data || []) as Party[]).filter(p => Number(p.party_id) !== 3 && !['counter', 'counter sale'].includes(String(p.party_name || '').trim().toLowerCase())))
      })
  }, [])

  const loadParty = useCallback(async (id: number) => {
    setLoading(true); setError(''); setMessage(''); setConfirm(false)
    try {
      const [s, p, r, h] = await Promise.all([
        supabase.from('sales').select('sale_id, bill_date, total_amount, paid_amount').eq('party_id', id).order('bill_date').limit(10000),
        supabase.from('payments').select('payment_id, payment_date, amount').eq('party_id', id).order('payment_date').limit(10000),
        supabase.from('returns').select('total_amount').eq('party_id', id).eq('return_type', 'Customer').limit(10000),
        supabase.from('party_balance_adjustments').select('adjustment_id, adjustment_amount, balance_before, balance_after, reason, created_at').eq('party_id', id).order('created_at', { ascending: false }).limit(10000),
      ])
      const failed = [s, p, r, h].find(x => x.error)
      if (failed?.error) throw new Error(failed.error.message)
      const paymentIds = (p.data || []).map((x: any) => Number(x.payment_id))
      const saleIds = (s.data || []).map((x: any) => Number(x.sale_id))
      const [byPayment, bySale, reversalResult] = await Promise.all([
        paymentIds.length ? supabase.from('payment_allocations').select('payment_id, sale_id, amount').in('payment_id', paymentIds).limit(20000) : Promise.resolve({ data: [] as Allocation[], error: null }),
        saleIds.length ? supabase.from('payment_allocations').select('payment_id, sale_id, amount').in('sale_id', saleIds).limit(20000) : Promise.resolve({ data: [] as Allocation[], error: null }),
        paymentIds.length ? supabase.from('payment_reversal_items').select('payment_id, reversed_amount').in('payment_id', paymentIds).limit(20000) : Promise.resolve({ data: [] as Reversal[], error: null }),
      ])
      const queryError = [byPayment, bySale, reversalResult].find(x => x.error)
      if (queryError?.error) throw new Error(queryError.error.message)
      const allocationMap = new Map<string, Allocation>()
      for (const row of [...(byPayment.data || []), ...(bySale.data || [])] as Allocation[]) {
        allocationMap.set(`${row.payment_id}:${row.sale_id}:${row.amount}`, row)
      }
      setSales((s.data || []) as Sale[]); setPayments((p.data || []) as Payment[]); setReturns((r.data || []) as ReturnRow[])
      setAllocations([...allocationMap.values()])
      setReversals((reversalResult.data || []) as Reversal[])
      setHistory((h.data || []) as Adjustment[])
      const party = parties.find(x => x.party_id === id)
      if (party) setTarget(num(party.current_balance).toFixed(2))
    } catch (e: any) { setError(e?.message || 'Could not load this customer.') }
    finally { setLoading(false) }
  }, [parties])

  useEffect(() => { if (partyId && parties.length) void loadParty(Number(partyId)) }, [partyId, parties, loadParty])

  const selected = parties.find(p => p.party_id === Number(partyId))
  const analysis = useMemo(() => {
    const allocByPayment = new Map<number, number>(), allocBySale = new Map<number, number>(), reverseByPayment = new Map<number, number>()
    for (const a of allocations) {
      const pid = Number(a.payment_id), sid = Number(a.sale_id), amount = num(a.amount)
      allocByPayment.set(pid, round((allocByPayment.get(pid) || 0) + amount))
      allocBySale.set(sid, round((allocBySale.get(sid) || 0) + amount))
    }
    for (const r of reversals) { const id = Number(r.payment_id); reverseByPayment.set(id, round((reverseByPayment.get(id) || 0) + num(r.reversed_amount))) }
    const salesTotal = round(sales.reduce((sum, s) => sum + num(s.total_amount), 0))
    const returned = round(returns.reduce((sum, r) => sum + num(r.total_amount), 0))
    const paymentsTotal = round(payments.reduce((sum, p) => sum + num(p.amount), 0))
    const reversalTotal = round(reversals.reduce((sum, r) => sum + num(r.reversed_amount), 0))
    const savedAdjustments = round(history.reduce((sum, h) => sum + num(h.adjustment_amount), 0))
    // Match the existing customer balance formula; allocations are investigated separately.
    const baseFormula = round(salesTotal - returned - paymentsTotal + reversalTotal)
    const formula = round(baseFormula + savedAdjustments)
    const stored = num(selected?.current_balance)
    const paymentGaps = payments.map(p => {
      const id = Number(p.payment_id)
      const effectivePayment = Math.max(0, num(p.amount) - (reverseByPayment.get(id) || 0))
      return { ...p, gap: round(effectivePayment - (allocByPayment.get(id) || 0)) }
    }).filter(p => p.gap > EPS)
    const invoiceGaps = sales.map(s => ({ ...s, gap: round(num(s.paid_amount) - (allocBySale.get(Number(s.sale_id)) || 0)) })).filter(s => s.gap > EPS)
    const overPayments = payments.filter(p => (allocByPayment.get(Number(p.payment_id)) || 0) > Math.max(0, num(p.amount) - (reverseByPayment.get(Number(p.payment_id)) || 0)) + EPS)
    const overInvoices = sales.filter(s => (allocBySale.get(Number(s.sale_id)) || 0) > num(s.paid_amount) + EPS)
    const partialReversals = payments.filter(p => { const rev = reverseByPayment.get(Number(p.payment_id)) || 0; return rev > EPS && Math.abs(rev - num(p.amount)) > EPS })
    const advances = round(paymentGaps.reduce((sum, p) => sum + p.gap, 0))
    return { salesTotal, returned, paymentsTotal, reversalTotal, savedAdjustments, advances, formula, stored, difference: round(stored - formula), paymentGaps, invoiceGaps, overPayments, overInvoices, partialReversals }
  }, [sales, payments, returns, allocations, reversals, selected, history])

  const parsedTarget = Number(target)
  const validTarget = target.trim() !== '' && Number.isFinite(parsedTarget)
  const delta = validTarget ? round(parsedTarget - analysis.formula) : 0

  async function saveAdjustment() {
    if (!selected || !validTarget || !reason.trim()) return
    setSaving(true); setError(''); setMessage('')
    const safeTarget = round(parsedTarget)
    const adjustment = round(safeTarget - analysis.formula)
    try {
      if (Math.abs(adjustment) < 0.005) throw new Error('The target is already equal to the calculated balance.')
      const { error: updateError } = await supabase.from('parties').update({ current_balance: safeTarget }).eq('party_id', selected.party_id)
      if (updateError) throw new Error(`Could not update customer balance: ${updateError.message}`)
      const { error: insertError } = await supabase.from('party_balance_adjustments').insert({
        party_id: selected.party_id, adjustment_amount: adjustment, balance_before: analysis.stored,
        balance_after: safeTarget, reason: reason.trim(),
      })
      if (insertError) {
        await supabase.from('parties').update({ current_balance: analysis.stored }).eq('party_id', selected.party_id)
        throw new Error(`Adjustment history could not be saved; the previous balance was restored. ${insertError.message}`)
      }
      setParties(prev => prev.map(p => p.party_id === selected.party_id ? { ...p, current_balance: safeTarget } : p))
      setTarget(safeTarget.toFixed(2)); setReason(''); setConfirm(false)
      setMessage(`Saved ${money(adjustment)} adjustment. New saved balance: ${money(safeTarget)}.`)
      await loadParty(selected.party_id)
      setTarget(safeTarget.toFixed(2))
    } catch (e: any) { setError(e?.message || 'Could not save adjustment.') }
    finally { setSaving(false) }
  }

  if (checking) return <main className="p-6 text-sm">Checking owner access...</main>
  if (!allowed) return <main className="mx-auto max-w-xl p-6"><h1 className="text-xl font-bold">Balance Correction</h1><p className="mt-3 text-red-600">Owner access required.</p></main>

  return <main className="min-h-screen bg-slate-50 p-3 sm:p-6"><div className="mx-auto max-w-5xl">
    <div className="mb-5 flex items-center gap-3"><Link href="/payment-admin" className="rounded-lg p-2 hover:bg-slate-200"><ArrowLeft className="h-5 w-5" /></Link><div className="min-w-0 flex-1"><h1 className="text-2xl font-bold text-slate-900">Manual Balance Correction</h1><p className="text-sm text-slate-500">Investigate a customer, set the actual target balance, and retain an adjustment history.</p></div><button onClick={() => partyId && void loadParty(Number(partyId))} disabled={!partyId || loading} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button></div>
    <div className="mb-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950"><ShieldAlert className="h-4 w-4 shrink-0" /><p><b>Important:</b> This tool records a manual balance adjustment. It does not create payments, change invoices, or silently reassign allocations. Review the findings before setting a target.</p></div>
    {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}{message && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
    <section className="mb-4 rounded-xl border bg-white p-4"><label className="mb-2 block text-sm font-semibold text-slate-700">Select customer</label><select value={partyId} onChange={e => setPartyId(e.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Choose a customer...</option>{parties.map(p => <option key={p.party_id} value={p.party_id}>{p.party_name} (#{p.party_id})</option>)}</select></section>
    {partyId && <>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Saved customer balance" value={money(analysis.stored)} />
        <Metric label="Calculated balance" value={money(analysis.formula)} />
        <Metric label="Difference (saved − calculated)" value={money(analysis.difference)} tone={Math.abs(analysis.difference) > EPS ? 'amber' : 'green'} />
        <Metric label="Unallocated payment balance*" value={money(analysis.advances)} />
        <Metric label="Total sales" value={money(analysis.salesTotal)} />
        <Metric label="Payments received" value={money(analysis.paymentsTotal)} />
        <Metric label="Customer returns" value={money(analysis.returned)} />
        <Metric label="Reversals" value={money(analysis.reversalTotal)} />
      </div>
      <p className="mb-4 text-[11px] text-slate-500">*Unallocated amount is an investigation figure, not automatically an additional credit. The calculated balance follows the existing ledger formula and includes saved manual adjustments.</p>
      <section className="mb-4 rounded-xl border bg-white p-4"><h2 className="mb-3 font-semibold text-slate-900">Investigation findings</h2><div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3"><Finding label="Payments with unused amount" count={analysis.paymentGaps.length} /><Finding label="Invoices paid without links" count={analysis.invoiceGaps.length} /><Finding label="Allocations over payment" count={analysis.overPayments.length} /><Finding label="Allocations over invoice paid" count={analysis.overInvoices.length} /><Finding label="Partial / unequal reversals" count={analysis.partialReversals.length} /><Finding label="Invoices" count={sales.length} /></div>
        {(analysis.paymentGaps.length + analysis.invoiceGaps.length + analysis.overPayments.length + analysis.overInvoices.length + analysis.partialReversals.length) === 0 ? <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> No payment/allocation exceptions detected by these checks.</p> : <div className="space-y-2 text-xs">
          {analysis.paymentGaps.map(p => <Issue key={`p${p.payment_id}`} title={`Payment #${p.payment_id}: ${money(p.gap)} not linked`} detail={`Received ${money(num(p.amount))} on ${p.payment_date || 'unknown date'}. After recorded reversals, this payment has an unallocated remainder. It may be a genuine customer advance; it is not automatically an error.`} />)}
          {analysis.invoiceGaps.map(s => <Issue key={`s${s.sale_id}`} title={`Invoice #${s.sale_id}: ${money(s.gap)} paid amount has no allocation link`} detail={`Invoice total ${money(num(s.total_amount))}; recorded paid ${money(num(s.paid_amount))}. A missing link is not proof that a payment belongs to this invoice.`} />)}
          {analysis.overPayments.map(p => <Issue key={`op${p.payment_id}`} title={`Payment #${p.payment_id}: allocations exceed payment`} detail={`Payment amount ${money(num(p.amount))}. Review allocation and reversal history before changing anything.`} />)}
          {analysis.overInvoices.map(s => <Issue key={`oi${s.sale_id}`} title={`Invoice #${s.sale_id}: allocations exceed recorded paid`} detail={`Recorded paid ${money(num(s.paid_amount))}. Review invoice payment summary and allocations.`} />)}
          {analysis.partialReversals.map(p => <Issue key={`r${p.payment_id}`} title={`Payment #${p.payment_id}: partial / unequal reversal`} detail={`Payment ${money(num(p.amount))}; reversal total ${money(reversals.filter(r => Number(r.payment_id) === p.payment_id).reduce((sum,r)=>sum+num(r.reversed_amount),0))}. Do not automatically reallocate this payment.`} />)}
        </div>}
        <p className="mt-3 flex gap-2 border-t pt-3 text-[11px] leading-relaxed text-slate-500"><AlertTriangle className="h-4 w-4 shrink-0" /> Invoice paid amounts without allocation links and unused payments may be related, but dates or amounts alone cannot prove the intended match. This page leaves the ledger untouched.</p>
      </section>
      <section className="mb-4 rounded-xl border bg-white p-4"><h2 className="font-semibold text-slate-900">Set actual customer balance</h2><p className="mt-1 text-xs text-slate-500">Enter the correct final customer balance. The adjustment is calculated from the ledger estimate, not from the currently saved figure.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-xs font-medium text-slate-600">Target balance (₹)</label><input type="number" step="0.01" value={target} onChange={e => { setTarget(e.target.value); setConfirm(false) }} className="h-11 w-full rounded-lg border px-3 text-sm" /></div><div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Adjustment to record (target − calculated)</div><div className={`mt-1 text-xl font-bold tabular-nums ${delta < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{validTarget ? `${delta > 0 ? '+' : ''}${money(delta)}` : '—'}</div><div className="text-[11px] text-slate-500">Current saved {money(analysis.stored)} · Calculated {money(analysis.formula)}</div></div></div><label className="mb-1 mt-3 block text-xs font-medium text-slate-600">Reason (required)</label><textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Explain why this balance needs correction..." className="w-full rounded-lg border px-3 py-2 text-sm" />
        {!confirm ? <button disabled={!validTarget || Math.abs(delta) < 0.005 || !reason.trim() || saving} onClick={() => setConfirm(true)} className="mt-3 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Review correction</button> : <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-950">Confirm manual correction</p><p className="mt-1 text-xs text-amber-900">This will record {money(delta)} against the calculated balance of {money(analysis.formula)} and set the saved balance to {money(round(parsedTarget))}. Existing payments, invoices, returns and allocations will not be changed.</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void saveAdjustment()} disabled={saving} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Confirm & save'}</button><button onClick={() => setConfirm(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">Cancel</button></div></div>}
      </section>
      <section className="rounded-xl border bg-white p-4"><h2 className="mb-3 font-semibold text-slate-900">Adjustment history</h2>{history.length === 0 ? <p className="text-sm text-slate-500">No manual adjustments recorded for this customer.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="border-b text-slate-500"><tr><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Adjustment</th><th className="py-2 pr-3">Before</th><th className="py-2 pr-3">After</th><th className="py-2">Reason</th></tr></thead><tbody>{history.map(h => <tr key={h.adjustment_id} className="border-b last:border-0"><td className="py-2 pr-3">{new Date(h.created_at).toLocaleString('en-IN')}</td><td className={`py-2 pr-3 font-semibold ${num(h.adjustment_amount) < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(num(h.adjustment_amount))}</td><td className="py-2 pr-3">{money(num(h.balance_before))}</td><td className="py-2 pr-3">{money(num(h.balance_after))}</td><td className="py-2">{h.reason || '—'}</td></tr>)}</tbody></table></div>}</section>
    </>}
    <p className="mt-4 text-[11px] text-slate-400">Owner-only page · Counter Sale excluded · Ledger formula: sales − returns − payments + reversals + adjustments · No automatic payment or invoice changes</p>
  </div></main>
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'green' }) { return <div className="rounded-xl border bg-white p-3"><div className="text-[11px] text-slate-500">{label}</div><div className={`mt-1 text-lg font-bold tabular-nums ${tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</div></div> }
function Finding({ label, count }: { label: string; count: number }) { return <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">{label}</div><div className="mt-1 text-lg font-bold text-slate-900">{count}</div></div> }
function Issue({ title, detail }: { title: string; detail: string }) { return <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5"><div className="font-semibold text-amber-950">{title}</div><p className="mt-1 text-amber-900">{detail}</p></div> }
