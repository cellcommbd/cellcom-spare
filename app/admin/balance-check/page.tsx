'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getRole } from '../../../lib/auth'
import {
  recomputePartyBalance,
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
} from 'lucide-react'

type DriftRow = {
  party_id: number
  party_name: string
  stored: number
  computed: number
  drift: number
  note: string
  recentSales: Array<{ sale_id: number; total_amount: number; paid_amount: number; bill_date: string }>
  recentPayments: Array<{ payment_id: number; amount: number; payment_date: string }>
  unpaidSales: number
  customerReturns: number
  explanation: string
  calculation: string
}

export default function BalanceCheckPage() {
  const router = useRouter()
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [partyList, setPartyList] = useState<Array<{ party_id: number; party_name: string; current_balance: number }>>([])
  const [rows, setRows] = useState<DriftRow[]>([])
  const [fixing, setFixing] = useState<number | null>(null)
  const [manualPartyId, setManualPartyId] = useState<number | null>(null)
  const [manualValue, setManualValue] = useState('')
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

    const { data: parties } = await supabase
      .from('parties')
      .select('party_id, party_name, current_balance')
      .eq('party_type', 'Customer')
      .order('party_name')

    if (!parties) {
      setLoading(false)
      return
    }

    setPartyList(parties)

    const partyIds = parties.map((p) => p.party_id)
    const { data: sales } = await supabase
      .from('sales')
      .select('sale_id, party_id, total_amount, paid_amount, bill_date')
      .in('party_id', partyIds)
      .order('bill_date', { ascending: false })
      .order('sale_id', { ascending: false })

    const { data: returns } = await supabase
      .from('returns')
      .select('party_id, total_amount')
      .eq('return_type', 'Customer')
      .in('party_id', partyIds)

    const { data: payments } = await supabase
      .from('payments')
      .select('payment_id, party_id, amount, payment_date')
      .in('party_id', partyIds)
      .order('payment_date', { ascending: false })
      .order('payment_id', { ascending: false })

    const drift: DriftRow[] = []
    for (const p of parties) {
      if (isCounterSaleParty(p.party_name, p.party_id)) {
        continue
      }

      const salesForParty = (sales || []).filter((s) => s.party_id === p.party_id)
      const returnsForParty = (returns || []).filter((r) => r.party_id === p.party_id)
      const recentSales = salesForParty
        .slice()
        .sort((a, b) => {
          const dateA = a.bill_date ? new Date(a.bill_date).getTime() : 0
          const dateB = b.bill_date ? new Date(b.bill_date).getTime() : 0
          return dateB - dateA || Number(b.sale_id ?? 0) - Number(a.sale_id ?? 0)
        })
        .slice(0, 3)
      const recentPayments = (payments || [])
        .filter((x) => x.party_id === p.party_id)
        .sort((a, b) => {
          const dateA = a.payment_date ? new Date(a.payment_date).getTime() : 0
          const dateB = b.payment_date ? new Date(b.payment_date).getTime() : 0
          return dateB - dateA || Number(b.payment_id ?? 0) - Number(a.payment_id ?? 0)
        })
        .slice(0, 3)
      const computed = computeExpectedCustomerBalance({
        sales: salesForParty,
        returns: returnsForParty,
        partyName: p.party_name,
        partyId: p.party_id,
      })
      const stored = Number(p.current_balance || 0)
      const diff = Math.round((stored - computed) * 100) / 100
      if (Math.abs(diff) > 0.01) {
        const unpaidSales = Math.round(salesForParty.reduce(
          (sum, sale) => sum + (Number(sale.total_amount || 0) - Number(sale.paid_amount || 0)),
          0
        ) * 100) / 100
        const customerReturns = Math.round(returnsForParty.reduce(
          (sum, entry) => sum + Number(entry.total_amount || 0),
          0
        ) * 100) / 100

        let explanation = ''
        let note = ''
        if (diff > 0) {
          note = 'The saved balance is higher than the ledger calculation.'
          if (salesForParty.length === 0) {
            explanation = 'No customer sales were found, so the ledger currently calculates this balance as ₹0.00. The saved higher balance likely came from a sale that is missing or was deleted, or from an old balance that was not cleared.'
          } else {
            explanation = 'Possible causes: a payment was not recorded, a previous sale was not cleared correctly, or this customer’s balance was changed manually. Compare the recent sales and payments shown below.'
          }
        } else {
          note = 'The saved balance is lower than the ledger calculation.'
          explanation = 'Possible causes: an extra or duplicate payment was recorded, a sale was reversed or deleted without updating the balance, or a customer return was entered incorrectly.'
        }

        const calculation = `Outstanding sales ₹${unpaidSales.toFixed(2)} − customer returns ₹${customerReturns.toFixed(2)} = calculated balance ₹${computed.toFixed(2)}. Saved balance is ₹${stored.toFixed(2)}, so the difference is ₹${diff > 0 ? '+' : ''}${diff.toFixed(2)}.`

        drift.push({
          party_id: p.party_id,
          party_name: p.party_name,
          stored,
          computed,
          drift: diff,
          note,
          explanation,
          calculation,
          unpaidSales,
          customerReturns,
          recentSales: recentSales.map((s) => ({
            sale_id: Number(s.sale_id),
            total_amount: Number(s.total_amount || 0),
            paid_amount: Number(s.paid_amount || 0),
            bill_date: String(s.bill_date || ''),
          })),
          recentPayments: recentPayments.map((pmt) => ({
            payment_id: Number(pmt.payment_id),
            amount: Number(pmt.amount || 0),
            payment_date: String(pmt.payment_date || ''),
          })),
        })
      }
    }

    drift.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
    setRows(drift)

    if (!manualPartyId && parties.length > 0) {
      const firstCustomer = parties.find((p) => !isCounterSaleParty(p.party_name, p.party_id))
      setManualPartyId(firstCustomer?.party_id ?? null)
    }

    setLoading(false)
  }

  async function handleManualAdjust() {
    if (manualPartyId === null || manualValue === '') return
    const value = Number(manualValue)
    if (!Number.isFinite(value)) {
      setMessage('Enter a valid numeric balance.')
      setMessageType('error')
      return
    }

    try {
      await alignPartyBalanceToTarget(manualPartyId, value)

      setMessage(`Balance aligned for party #${manualPartyId}.`)
      setMessageType('success')
      setManualValue('')
      await load()
    } catch (e: any) {
      setMessage('Manual balance update failed: ' + (e?.message || 'unknown'))
      setMessageType('error')
    }
  }

  async function applyBalanceDecision(
    partyId: number,
    partyName: string,
    value: number,
    decision: 'computed' | 'stored'
  ) {
    const label = decision === 'computed' ? 'computed' : 'stored'
    if (!confirm(`Set ${partyName} balance to ₹${value.toFixed(2)} (${label})?`)) return

    setFixing(partyId)
    try {
      const aligned = await alignPartyBalanceToTarget(partyId, value)

      setMessage(`Aligned ${partyName} to the ${label} balance: ₹${aligned.toFixed(2)}. Sales paid amounts and statuses were updated.`)
      setMessageType('success')
      await load()
    } catch (e: any) {
      setMessage('Alignment failed: ' + (e?.message || 'unknown'))
      setMessageType('error')
    } finally {
      setFixing(null)
    }
  }

  async function handleFixAll() {
    if (rows.length === 0) return
    if (!confirm(`Apply the computed balance to all ${rows.length} drift rows?`)) return
    setLoading(true)
    let fixed = 0
    let failed = 0
    for (const r of rows) {
      try {
        await alignPartyBalanceToTarget(r.party_id, r.computed)
        fixed++
      } catch {
        failed++
      }
    }
    setMessage(`Applied computed values to ${fixed} rows${failed > 0 ? `, ${failed} failed` : ''}.`)
    setMessageType(failed > 0 ? 'error' : 'success')
    await load()
  }

  if (!isOwner) return null

  const totalDrift = rows.reduce((s, r) => s + Math.abs(r.drift), 0)

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5 flex flex-wrap items-center gap-2 sm:gap-3">
          <Link
            href="/admin"
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Balance Check
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Detect customers whose balance doesn't match their sales.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {message && (
          <div
            className={`mb-4 rounded-lg p-3 text-sm flex items-start gap-2 ${
              messageType === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            {messageType === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">{message}</div>
            <button onClick={() => setMessage('')} className="text-slate-500 hover:text-slate-800">
              ×
            </button>
          </div>
        )}

        {!loading && (
          <div className="mb-5 bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  Manual balance adjust
                </label>
                <select
                  value={manualPartyId ?? ''}
                  onChange={(e) => setManualPartyId(Number(e.target.value) || null)}
                  className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select customer</option>
                  {partyList
                    .filter((p) => !isCounterSaleParty(p.party_name, p.party_id))
                    .map((p) => (
                      <option key={p.party_id} value={p.party_id}>
                        {p.party_name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="w-full sm:w-40">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  New balance
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleManualAdjust}
                disabled={manualPartyId === null || manualValue === ''}
                className="h-10 w-full sm:w-auto px-4 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Set balance
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" />
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <div className="text-lg font-semibold text-slate-800">All balances clean</div>
            <div className="text-sm text-slate-500 mt-1">
              Every customer's balance matches their sales and returns.
            </div>
          </div>
        ) : (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-amber-900">
                    {rows.length} {rows.length === 1 ? 'customer' : 'customers'} with drift
                  </div>
                  <div className="text-xs text-amber-800 mt-0.5">
                    Total absolute drift: ₹{totalDrift.toFixed(2)}
                  </div>
                </div>
              </div>
              <button
                onClick={handleFixAll}
                className="h-10 sm:h-9 w-full sm:w-auto px-4 text-xs font-semibold text-white bg-amber-700 rounded-lg hover:bg-amber-800 flex items-center justify-center gap-1.5"
              >
                <Wrench className="w-3.5 h-3.5" />
                Apply computed to all
              </button>
            </div>

            <div className="space-y-3 md:hidden">
              {rows.map((r) => (
                <div key={r.party_id} className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                  <Link
                    href={`/parties/${r.party_id}`}
                    className="block font-semibold text-slate-900 hover:text-blue-600 mb-3"
                  >
                    {r.party_name}
                  </Link>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Stored</div>
                      <div className="mt-1 text-sm font-semibold text-slate-700">₹{r.stored.toFixed(2)}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Computed</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">₹{r.computed.toFixed(2)}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Drift</div>
                      <div className={`mt-1 text-sm font-bold ${r.drift > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {r.drift > 0 ? '+' : ''}₹{r.drift.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 leading-snug mb-2">{r.note}</div>
                  {r.recentSales.length > 0 && (
                    <div className="text-[11px] text-slate-500 leading-snug mb-1">
                      Sales: {r.recentSales.map((s) => `#${s.sale_id} ₹${s.total_amount.toFixed(2)} / paid ₹${s.paid_amount.toFixed(2)}`).join(' • ')}
                    </div>
                  )}
                  {r.recentPayments.length > 0 && (
                    <div className="text-[11px] text-slate-500 leading-snug mb-3">
                      Payments: {r.recentPayments.map((p) => `#${p.payment_id} ₹${p.amount.toFixed(2)}`).join(' • ')}
                    </div>
                  )}

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 mb-3">
                    <div className="text-xs font-semibold text-slate-800 mb-1">Why this drift happened</div>
                    <div className="text-[11px] text-slate-600 leading-snug">{r.explanation}</div>
                    <div className="mt-2 text-[11px] font-medium text-slate-700 leading-snug">{r.calculation}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => applyBalanceDecision(r.party_id, r.party_name, r.computed, 'computed')}
                      disabled={fixing !== null}
                      title={`Set balance to computed value: ₹${r.computed.toFixed(2)}`}
                      className="h-10 px-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {fixing === r.party_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Wrench className="w-3.5 h-3.5" />
                      )}
                      Set computed
                    </button>
                    <button
                      onClick={() => applyBalanceDecision(r.party_id, r.party_name, r.stored, 'stored')}
                      disabled={fixing !== null}
                      title={`Keep the existing stored value: ₹${r.stored.toFixed(2)}`}
                      className="h-10 px-2 text-xs font-semibold text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300 disabled:opacity-50"
                    >
                      Keep original
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Customer</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Stored</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Computed</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Drift</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600 w-[210px]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.party_id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <Link
                          href={`/parties/${r.party_id}`}
                          className="text-slate-800 hover:text-blue-600"
                        >
                          {r.party_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        ₹{r.stored.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        ₹{r.computed.toFixed(2)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-bold ${
                          r.drift > 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        <div className="flex flex-col items-end gap-0.5">
                          <span>
                            {r.drift > 0 ? '+' : ''}
                            ₹{r.drift.toFixed(2)}
                          </span>
                          <span className="text-[10px] font-medium text-slate-500 max-w-[180px] text-right leading-tight">
                            {r.note}
                          </span>
                          {r.recentSales.length > 0 && (
                            <span className="text-[9px] text-slate-500 max-w-[180px] text-right leading-tight">
                              Sales: {r.recentSales.map((s) => `#${s.sale_id} ₹${s.total_amount.toFixed(2)} / paid ₹${s.paid_amount.toFixed(2)}`).join(' • ')}
                            </span>
                          )}
                          {r.recentPayments.length > 0 && (
                            <span className="text-[9px] text-slate-500 max-w-[180px] text-right leading-tight">
                              Payments: {r.recentPayments.map((p) => `#${p.payment_id} ₹${p.amount.toFixed(2)}`).join(' • ')}
                            </span>
                          )}
                          <span className="text-[9px] font-medium text-slate-700 max-w-[180px] text-right leading-tight">
                            {r.explanation}
                          </span>
                          <span className="text-[9px] text-slate-500 max-w-[180px] text-right leading-tight">
                            {r.calculation}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-col gap-1 items-stretch ml-auto w-[150px] sm:w-[165px]">
                          <button
                            onClick={() => applyBalanceDecision(r.party_id, r.party_name, r.computed, 'computed')}
                            disabled={fixing !== null}
                            title={`Set balance to computed value: ₹${r.computed.toFixed(2)}`}
                            className="h-7 w-full px-2 text-[10px] sm:text-[11px] font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1 whitespace-nowrap"
                          >
                            {fixing === r.party_id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Wrench className="w-3 h-3" />
                            )}
                            Set computed
                          </button>
                          <button
                            onClick={() => applyBalanceDecision(r.party_id, r.party_name, r.stored, 'stored')}
                            disabled={fixing !== null}
                            title={`Keep the existing stored value: ₹${r.stored.toFixed(2)}`}
                            className="h-7 w-full px-2 text-[10px] sm:text-[11px] font-semibold text-slate-700 bg-slate-200 rounded hover:bg-slate-300 disabled:opacity-50 whitespace-nowrap"
                          >
                            Keep original
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}