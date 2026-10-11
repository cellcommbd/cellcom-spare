'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import {
  ArrowLeft,
  PackageX,
  Download,
  Search,
  Copy,
  Check,
  X,
} from 'lucide-react'

type Item = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number | null
  selling_price: number | null
  is_active: boolean
}

const QUICK_PICKS = [0, 2, 3, 5]

function money(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`
}

export default function LowStockPage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [search, setSearch] = useState('')
  const [threshold, setThreshold] = useState(0)
  const [selected, setSelected] = useState<Record<number, number>>({})
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data, error } = await supabase
      .from('items')
      .select('item_id, sku, current_stock, cost_price, selling_price, is_active')
      .eq('is_active', true)
      .lte('current_stock', 10)
      .order('sku', { ascending: true })

    if (error) {
      console.error('low stock load error:', error.message)
      setItems([])
    } else {
      setItems((data as Item[]) || [])
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let list = items.filter((i) => i.current_stock <= threshold)

    if (search.trim()) {
      const q = search.trim().toUpperCase()
      list = list.filter((i) => i.sku.toUpperCase().includes(q))
    }

    return list
  }, [items, threshold, search])

  const selectedItems = useMemo(() => {
    return filtered
      .map((i) => ({ item: i, qty: selected[i.item_id] || 0 }))
      .filter((x) => x.qty > 0)
  }, [filtered, selected])

  const totalPieces = selectedItems.reduce((s, x) => s + x.qty, 0)
  const totalCost = selectedItems.reduce(
    (s, x) => s + x.qty * Number(x.item.cost_price || 0),
    0
  )

  function toggleItem(itemId: number) {
    setSelected((prev) => {
      const next = { ...prev }
      if (next[itemId]) {
        delete next[itemId]
      } else {
        next[itemId] = 1
      }
      return next
    })
  }

  function setQty(itemId: number, qty: number) {
    setSelected((prev) => {
      const next = { ...prev }
      if (qty <= 0) {
        delete next[itemId]
      } else {
        next[itemId] = qty
      }
      return next
    })
  }

  function clearAll() {
    setSelected({})
  }

  async function copyToClipboard() {
    if (selectedItems.length === 0) return

    const text = selectedItems
      .map((x) => `${x.item.sku} x ${x.qty}`)
      .join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for old browsers
      const ta = document.createElement('textarea')
      ta.value = text
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

  function exportCSV() {
    const headers = ['SKU', 'Current Stock', 'Cost Price', 'Selling Price']
    const rowsForExport = filtered.map((i) => [
      i.sku,
      i.current_stock,
      (i.cost_price ?? 0).toFixed(2),
      (i.selling_price ?? 0).toFixed(2),
    ])
    const csv = [headers, ...rowsForExport]
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')
      )
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `low-stock-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8 pb-32">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <Link
            href="/reports"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            aria-label="Back to reports"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <PackageX className="w-5 h-5 text-amber-700" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Low Stock &amp; Reorder
            </h1>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mb-5">
          Tick items you want to order, set qty, then copy the list.
        </p>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-600 shrink-0">
                Show items with stock ≤
              </span>
              <input
                type="number"
                min="0"
                value={threshold}
                onChange={(e) =>
                  setThreshold(Math.max(0, parseInt(e.target.value) || 0))
                }
                className="w-16 h-9 px-2 text-sm text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-1.5">
                {QUICK_PICKS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setThreshold(n)}
                    className={`h-9 px-2.5 text-xs font-medium rounded-lg ${
                      threshold === n
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search SKU…"
                  className="w-full h-9 pl-8 pr-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={exportCSV}
                disabled={filtered.length === 0}
                className="h-9 px-3 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            </div>
          </div>
        </div>

        {!loading && (
          <div className="text-xs text-slate-500 mb-3">
            {filtered.length} item{filtered.length === 1 ? '' : 's'} with stock
            ≤ {threshold}
          </div>
        )}

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
            No items with stock ≤ {threshold}.
          </div>
        ) : (
          <>
            {/* MOBILE */}
            <div className="md:hidden space-y-3">
              {filtered.map((i) => {
                const qty = selected[i.item_id] || 0
                const isSelected = qty > 0
                return (
                  <div
                    key={i.item_id}
                    className={`bg-white border rounded-xl p-3 shadow-sm ${
                      isSelected ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-start gap-3 mb-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleItem(i.item_id)}
                        className="mt-1 w-5 h-5 rounded border-slate-300 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-sm font-semibold text-slate-900 break-all">
                          {i.sku}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              i.current_stock === 0
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            Stock {i.current_stock}
                          </span>
                          <span className="text-xs text-slate-500">
                            cost {money(i.cost_price ?? 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="flex items-center gap-3 pl-8 pt-2 border-t border-slate-100">
                        <span className="text-xs text-slate-600">Order qty</span>
                        <input
                          type="number"
                          min="1"
                          value={qty || ''}
                          onChange={(e) =>
                            setQty(i.item_id, parseInt(e.target.value) || 0)
                          }
                          className="w-20 h-9 px-2 text-sm text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-xs text-slate-500 ml-auto">
                          = {money(qty * Number(i.cost_price || 0))}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* DESKTOP */}
            <div className="hidden md:block bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="w-12 border-b border-slate-200 px-3 py-2"></th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">
                      SKU
                    </th>
                    <th className="w-24 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Stock
                    </th>
                    <th className="w-28 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Cost
                    </th>
                    <th className="w-28 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Selling
                    </th>
                    <th className="w-28 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Order Qty
                    </th>
                    <th className="w-28 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Line Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => {
                    const qty = selected[i.item_id] || 0
                    const isSelected = qty > 0
                    return (
                      <tr
                        key={i.item_id}
                        className={isSelected ? 'bg-amber-50/60' : 'hover:bg-slate-50'}
                      >
                        <td className="border-b border-slate-100 px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleItem(i.item_id)}
                            className="w-4 h-4 rounded border-slate-300"
                          />
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 font-mono text-slate-800">
                          {i.sku}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right">
                          <span
                            className={`inline-block min-w-[2rem] px-2 py-0.5 text-xs font-bold rounded-full ${
                              i.current_stock === 0
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {i.current_stock}
                          </span>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-800">
                          {money(i.cost_price ?? 0)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-800">
                          {money(i.selling_price ?? 0)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right">
                          <input
                            type="number"
                            min="1"
                            value={qty || ''}
                            onChange={(e) =>
                              setQty(i.item_id, parseInt(e.target.value) || 0)
                            }
                            disabled={!isSelected}
                            placeholder="—"
                            className="w-20 h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-medium text-slate-800">
                          {isSelected
                            ? money(qty * Number(i.cost_price || 0))
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* STICKY BOTTOM BAR */}
      {selectedItems.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900 text-white shadow-lg z-40 border-t border-slate-700">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-slate-300">
                {selectedItems.length} item{selectedItems.length === 1 ? '' : 's'}{' '}
                · {totalPieces} pc{totalPieces === 1 ? '' : 's'}
              </div>
              <div className="text-base font-bold">
                {money(totalCost)}
              </div>
            </div>
            <button
              onClick={copyToClipboard}
              className="h-10 px-4 text-sm font-semibold bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-2 shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy list
                </>
              )}
            </button>
            <button
              onClick={clearAll}
              className="h-10 w-10 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-lg shrink-0"
              aria-label="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}