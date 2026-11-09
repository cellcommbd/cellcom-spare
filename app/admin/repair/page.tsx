'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getRole } from '../../../lib/auth'
import {
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  Merge,
  Loader2,
  Info,
} from 'lucide-react'

type DuplicatePair = {
  id_a: number
  sku_a: string
  stock_a: number
  cost_a: number
  id_b: number
  sku_b: string
  stock_b: number
  cost_b: number
}

function formatCurrency(n: number): string {
  return `₹ ${Number(n).toFixed(2)}`
}

function mergePreview(pair: DuplicatePair) {
  const totalStock = pair.stock_a + pair.stock_b
  let newCost: number
  if (pair.stock_a > 0 && pair.stock_b > 0) {
    newCost =
      (pair.stock_a * pair.cost_a + pair.stock_b * pair.cost_b) / totalStock
  } else if (pair.stock_b > 0) {
    newCost = pair.cost_b
  } else {
    newCost = pair.cost_a
  }
  return { stock: totalStock, cost: newCost }
}

export default function RepairPage() {
  const router = useRouter()
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([])
  const [merging, setMerging] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  useEffect(() => {
    const role = getRole()
    if (role !== 'owner') {
      router.replace('/')
      return
    }
    setIsOwner(true)
    loadDuplicates()
  }, [router])

  async function loadDuplicates() {
    setLoading(true)
    const { data, error } = await supabase.rpc('find_duplicate_items')
    if (error) {
      console.error(error)
      setMessage('Failed to load duplicates: ' + error.message)
      setMessageType('error')
    } else {
      setDuplicates((data as DuplicatePair[]) || [])
    }
    setLoading(false)
  }

  async function handleMerge(
    survivorId: number,
    victimId: number,
    survivorSku: string,
    victimSku: string
  ) {
    const confirmMsg =
      `Merge "${victimSku}" into "${survivorSku}"?\n\n` +
      `- All purchases, sales, returns, losses will move to survivor\n` +
      `- Stock will be combined\n` +
      `- Victim item will be DELETED\n\n` +
      `This cannot be undone. Continue?`
    if (!window.confirm(confirmMsg)) return

    setMerging(survivorId)
    setMessage('')

    const { data, error } = await supabase.rpc('merge_items', {
      p_survivor: survivorId,
      p_victim: victimId,
    })

    if (error) {
      setMessage('Merge failed: ' + error.message)
      setMessageType('error')
    } else {
      const r = data as any
      setMessage(
        `Merged "${victimSku}" into "${survivorSku}". ` +
        `New stock: ${r.new_stock}, new cost: ${formatCurrency(
          Number(r.new_cost)
        )}. ` +
        `Moved: ${r.moved_purchases} purchase, ${r.moved_sales} sale, ${r.moved_returns} return, ${r.moved_losses} loss.`
      )
      setMessageType('success')
      await loadDuplicates()
    }
    setMerging(null)
  }

  if (!isOwner) return null

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5 flex items-center gap-3">
          <Link
            href="/"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Fix & Repair
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Owner-only diagnostics and corrections
            </p>
          </div>
        </div>

        {/* Parser rule card */}
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-blue-900">
                Current SKU grammar (v34.2)
              </div>
              <div className="text-[11px] text-blue-800 mt-1 font-mono">
                BRAND - MODEL - YEAR - PART - NETWORK - FLAG - VARIANT - COLOR - QUALITY
              </div>
              <ul className="text-[11px] text-blue-800 mt-1.5 space-y-0.5 list-disc list-inside">
                <li>Year (if present) comes AFTER model, BEFORE part</li>
                <li>Flag comes BEFORE variant</li>
                <li>Color comes AFTER variant</li>
                <li>Quality suffix is LAST</li>
              </ul>
              <div className="text-[11px] text-blue-700 mt-1.5">
                When merging duplicates, keep the item whose SKU follows this
                grammar.
              </div>
            </div>
          </div>
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
            <button
              onClick={() => setMessage('')}
              className="text-slate-500 hover:text-slate-800"
            >
              ×
            </button>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Merge className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">
                Duplicate items
              </span>
            </div>
            <span className="text-xs text-slate-500">
              {duplicates.length} pair{duplicates.length === 1 ? '' : 's'}
            </span>
          </div>

          {duplicates.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <div className="text-sm font-medium text-slate-700">
                No duplicates found
              </div>
              <div className="text-xs text-slate-500 mt-1">Catalog is clean</div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {duplicates.map((pair) => {
                const preview = mergePreview(pair)
                return (
                  <div
                    key={`${pair.id_a}-${pair.id_b}`}
                    className="p-4 space-y-3"
                  >
                    {/* Two item cards side by side */}
                    <div className="grid grid-cols-2 gap-2">
                      {/* Item A */}
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 flex flex-col">
                        <div className="text-[10px] text-slate-500 uppercase mb-1">
                          Item A · id {pair.id_a}
                        </div>
                        <div className="font-mono text-xs text-slate-900 break-all flex-1">
                          {pair.sku_a}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-1">
                          Stock: {pair.stock_a} · Cost:{' '}
                          {formatCurrency(pair.cost_a)}
                        </div>
                        <button
                          onClick={() =>
                            handleMerge(
                              pair.id_a,
                              pair.id_b,
                              pair.sku_a,
                              pair.sku_b
                            )
                          }
                          disabled={merging !== null}
                          className="mt-2 h-9 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          {merging === pair.id_a ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Merging…
                            </>
                          ) : (
                            <>Keep this</>
                          )}
                        </button>
                      </div>

                      {/* Item B */}
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 flex flex-col">
                        <div className="text-[10px] text-slate-500 uppercase mb-1">
                          Item B · id {pair.id_b}
                        </div>
                        <div className="font-mono text-xs text-slate-900 break-all flex-1">
                          {pair.sku_b}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-1">
                          Stock: {pair.stock_b} · Cost:{' '}
                          {formatCurrency(pair.cost_b)}
                        </div>
                        <button
                          onClick={() =>
                            handleMerge(
                              pair.id_b,
                              pair.id_a,
                              pair.sku_b,
                              pair.sku_a
                            )
                          }
                          disabled={merging !== null}
                          className="mt-2 h-9 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          {merging === pair.id_b ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Merging…
                            </>
                          ) : (
                            <>Keep this</>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Preview line */}
                    <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 flex items-center justify-between">
                      <span className="text-slate-500">After merge</span>
                      <span className="font-semibold text-slate-800">
                        Stock: {preview.stock} · Cost:{' '}
                        {formatCurrency(preview.cost)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}