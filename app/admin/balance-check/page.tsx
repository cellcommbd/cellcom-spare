'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getRole } from '../../../lib/auth'
import { recomputePartyBalance } from '../../../lib/balance'
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
}

export default function BalanceCheckPage() {
  const router = useRouter()
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<DriftRow[]>([])
  const [fixing, setFixing] = useState<number | null>(null)
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

    // Fetch all sales + returns in parallel
    const partyIds = parties.map((p) => p.party_id)
    const { data: sales } = await supabase
      .from('sales')
      .select('party_id, total_amount, paid_amount')
      .in('party_id', partyIds)

    const { data: returns } = await supabase
      .from('returns')
      .select('party_id, total_amount')
      .eq('return_type', 'Customer')
      .in('party_id', partyIds)

    // Compute per party
    const salesByParty: Record<number, number> = {}
    for (const s of sales || []) {
      const unpaid = Number(s.total_amount) - Number(s.paid_amount || 0)
      salesByParty[s.party_id] = (salesByParty[s.party_id] || 0) + unpaid
    }
    const returnsByParty: Record<number, number> = {}
    for (const r of returns || []) {
      returnsByParty[r.party_id] = (returnsByParty[r.party_id] || 0) + Number(r.total_amount)
    }

    const drift: DriftRow[] = []
    for (const p of parties) {
      const computed = Math.round(
        ((salesByParty[p.party_id] || 0) - (returnsByParty[p.party_id] || 0)) * 100
      ) / 100
      const stored = Number(p.current_balance || 0)
      const diff = Math.round((stored - computed) * 100) / 100
      if (Math.abs(diff) > 0.01) {
        drift.push({
          party_id: p.party_id,
          party_name: p.party_name,
          stored,
          computed,
          drift: diff,
        })
      }
    }

    drift.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
    setRows(drift)
    setLoading(false)
  }

  async function handleFix(partyId: number, partyName: string) {
    if (!confirm(`Recompute balance for "${partyName}"?`)) return
    setFixing(partyId)
    try {
      const correct = await recomputePartyBalance(partyId)
      setMessage(`Fixed ${partyName} — new balance ₹${correct.toFixed(2)}`)
      setMessageType('success')
      await load()
    } catch (e: any) {
      setMessage('Fix failed: ' + (e?.message || 'unknown'))
      setMessageType('error')
    } finally {
      setFixing(null)
    }
  }

  async function handleFixAll() {
    if (rows.length === 0) return
    if (!confirm(`Fix all ${rows.length} parties with drift?`)) return
    setLoading(true)
    let fixed = 0
    let failed = 0
    for (const r of rows) {
      try {
        await recomputePartyBalance(r.party_id)
        fixed++
      } catch {
        failed++
      }
    }
    setMessage(`Fixed ${fixed} parties${failed > 0 ? `, ${failed} failed` : ''}.`)
    setMessageType(failed > 0 ? 'error' : 'success')
    await load()
  }

  if (!isOwner) return null

  const totalDrift = rows.reduce((s, r) => s + Math.abs(r.drift), 0)

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5 flex items-center gap-3">
          <Link
            href="/admin"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200"
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
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 flex items-center justify-between gap-3">
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
                className="h-9 px-4 text-xs font-semibold text-white bg-amber-700 rounded-lg hover:bg-amber-800 flex items-center gap-1.5 shrink-0"
              >
                <Wrench className="w-3.5 h-3.5" />
                Fix all
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Customer</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Stored</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Computed</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Drift</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600 w-24">Action</th>
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
                        {r.drift > 0 ? '+' : ''}
                        ₹{r.drift.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleFix(r.party_id, r.party_name)}
                          disabled={fixing !== null}
                          className="h-7 px-2.5 text-[11px] font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 ml-auto"
                        >
                          {fixing === r.party_id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Wrench className="w-3 h-3" />
                          )}
                          Fix
                        </button>
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