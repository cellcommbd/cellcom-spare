'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import {
  ArrowLeft,
  Package,
  Download,
  Search,
} from 'lucide-react'

type Item = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
  selling_price: number
  stock_value: number
  last_sale: string | null
}

type Summary = {
  total_value: number
  total_items: number
  never_sold_value: number
  never_sold_items: number
}

type Tab = 'value' | 'never'

function money(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`
}

export default function DeadStockPage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [summary, setSummary] = useState<Summary>({
    total_value: 0,
    total_items: 0,
    never_sold_value: 0,
    never_sold_items: 0,
  })
  const [search, setSearch] = useState('')
  const [minStock, setMinStock] = useState(1)
  const [tab, setTab] = useState<Tab>('value')

  useEffect(() => {
    loadSummary()
  }, [])

  useEffect(() => {
    loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, minStock, search])

  async function loadSummary() {
    const { data, error } = await supabase.rpc('dead_stock_summary')
    if (error) {
      console.error('dead_stock_summary error:', error.message)
      return
    }
    const row = (data as any[])?.[0]
    if (row) {
      setSummary({
        total_value: Number(row.total_value || 0),
        total_items: Number(row.total_items || 0),
        never_sold_value: Number(row.never_sold_value || 0),
        never_sold_items: Number(row.never_sold_items || 0),
      })
    }
  }

  async function loadItems() {
    setLoading(true)
    const { data, error } = await supabase.rpc('dead_stock_items', {
      p_never_only: tab === 'never',
      p_min_stock: minStock,
      p_search: search.trim() || null,
      p_limit: 2000,
    })

    if (error) {
      console.error('dead_stock_items error:', error.message)
      setItems([])
    } else {
      setItems((data as Item[]) || [])
    }
    setLoading(false)
  }

  const filteredValue = useMemo(
    () => items.reduce((s, i) => s + Number(i.stock_value || 0), 0),
    [items]
  )

  function exportCSV() {
    const headers = [
      'SKU',
      'Current Stock',
      'Cost Price',
      'Stock Value',
      'Last Sale',
    ]
    const rowsForExport = items.map((i) => [
      i.sku,
      i.current_stock,
      Number(i.cost_price || 0).toFixed(2),
      Number(i.stock_value || 0).toFixed(2),
      i.last_sale || 'Never',
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
    a.download = `dead-stock-${tab}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isCapped = items.length === 2000

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">

        <div className="mb-5 flex items-center gap-3">
          <Link
            href="/reports"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            aria-label="Back to reports"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-amber-700" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Dead Stock
            </h1>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mb-5">
          Cash tied up in inventory. Two views: highest stock value, and items
          never sold.
        </p>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-5 overflow-hidden">
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => setTab('value')}
              className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                tab === 'value'
                  ? 'bg-amber-50 text-amber-900 border-b-2 border-amber-600'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Highest Stock Value
            </button>
            <button
              onClick={() => setTab('never')}
              className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                tab === 'never'
                  ? 'bg-amber-50 text-amber-900 border-b-2 border-amber-600'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Never Sold
            </button>
          </div>

          <div className="p-3 sm:p-4 bg-slate-50 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase text-slate-500 font-medium">
                Total stock value
              </div>
              <div className="text-base font-bold text-slate-900">
                {money(summary.total_value)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {summary.total_items} items
              </div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase text-slate-500 font-medium">
                Never-sold value
              </div>
              <div className="text-base font-bold text-amber-800">
                {money(summary.never_sold_value)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {summary.never_sold_items} items
              </div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase text-slate-500 font-medium">
                Showing ({tab === 'never' ? 'never sold' : 'all in stock'})
              </div>
              <div className="text-base font-bold text-slate-900">
                {items.length} items · {money(filteredValue)}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-600">Min stock</span>
              <input
                type="number"
                min="1"
                value={minStock}
                onChange={(e) =>
                  setMinStock(Math.max(1, parseInt(e.target.value) || 1))
                }
                className="w-16 h-9 px-2 text-sm text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2 sm:ml-auto flex-1 sm:flex-initial">
              <div className="relative flex-1 sm:w-72">
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
                disabled={items.length === 0}
                className="h-9 px-3 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
            Loading...
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
            {tab === 'never'
              ? 'No never-sold items match your filters.'
              : 'No in-stock items match your filters.'}
          </div>
        ) : (
          <>
            {isCapped && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                Showing first 2000 items. Refine search to see more.
              </div>
            )}

            <div className="md:hidden space-y-3">
              {items.map((i) => (
                <div
                  key={i.item_id}
                  className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"
                >
                  <div className="font-mono text-sm font-semibold text-slate-900 break-all mb-2">
                    {i.sku}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-slate-500">Stock</div>
                      <div className="font-medium text-slate-800">
                        {i.current_stock}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Cost</div>
                      <div className="font-medium text-slate-800">
                        {money(i.cost_price || 0)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Value</div>
                      <div className="font-bold text-amber-800">
                        {money(i.stock_value)}
                      </div>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-100">
                    Last sale: {i.last_sale || 'Never'}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">
                      SKU
                    </th>
                    <th className="w-24 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Stock
                    </th>
                    <th className="w-28 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Cost
                    </th>
                    <th className="w-32 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Stock Value
                    </th>
                    <th className="w-32 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Last Sale
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.item_id} className="hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-3 py-2 font-mono text-slate-800">
                        {i.sku}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-800">
                        {i.current_stock}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-800">
                        {money(i.cost_price || 0)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-medium text-amber-800">
                        {money(i.stock_value)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right text-xs text-slate-500">
                        {i.last_sale || 'Never'}
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