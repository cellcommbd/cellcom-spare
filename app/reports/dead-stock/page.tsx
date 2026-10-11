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
  cost_price: number | null
  selling_price: number | null
  is_active: boolean
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
  const [lastSaleByItem, setLastSaleByItem] = useState<Record<number, string>>({})
  const [soldItemIds, setSoldItemIds] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [minStock, setMinStock] = useState(1)
  const [tab, setTab] = useState<Tab>('value')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)

    const { data: itemsRes, error: itemsErr } = await supabase
      .from('items')
      .select('item_id, sku, current_stock, cost_price, selling_price, is_active')
      .eq('is_active', true)
      .gt('current_stock', 0)
      .order('sku', { ascending: true })

    if (itemsErr) {
      console.error('dead stock items error:', itemsErr.message)
      setItems([])
      setLoading(false)
      return
    }

    const itemList = (itemsRes as Item[]) || []
    setItems(itemList)

    const { data: saleLines, error: saleErr } = await supabase
      .from('sale_items')
      .select('item_id, sales!inner(bill_date)')

    if (saleErr) {
      console.error('dead stock sale_items error:', saleErr.message)
    } else {
      const lastSale: Record<number, string> = {}
      const sold = new Set<number>()
      for (const line of (saleLines as any[]) || []) {
        const itemId = line.item_id as number
        const date = line.sales?.bill_date as string | undefined
        sold.add(itemId)
        if (date) {
          if (!lastSale[itemId] || date > lastSale[itemId]) {
            lastSale[itemId] = date
          }
        }
      }
      setLastSaleByItem(lastSale)
      setSoldItemIds(sold)
    }

    setLoading(false)
  }

  const filtered = useMemo(() => {
    let list = items.filter((i) => i.current_stock >= minStock)

    if (tab === 'never') {
      list = list.filter((i) => !soldItemIds.has(i.item_id))
    }

    if (search.trim()) {
      const q = search.trim().toUpperCase()
      list = list.filter((i) => i.sku.toUpperCase().includes(q))
    }

    list = [...list].sort((a, b) => {
      const av = Number(a.current_stock) * Number(a.cost_price || 0)
      const bv = Number(b.current_stock) * Number(b.cost_price || 0)
      return bv - av
    })

    return list
  }, [items, soldItemIds, minStock, search, tab])

  const totalStockValue = useMemo(
    () =>
      items.reduce(
        (s, i) => s + Number(i.current_stock) * Number(i.cost_price || 0),
        0
      ),
    [items]
  )

  const totalNeverSoldValue = useMemo(() => {
    return items
      .filter((i) => !soldItemIds.has(i.item_id))
      .reduce(
        (s, i) => s + Number(i.current_stock) * Number(i.cost_price || 0),
        0
      )
  }, [items, soldItemIds])

  const filteredValue = useMemo(
    () =>
      filtered.reduce(
        (s, i) => s + Number(i.current_stock) * Number(i.cost_price || 0),
        0
      ),
    [filtered]
  )

  function exportCSV() {
    const headers = [
      'SKU',
      'Current Stock',
      'Cost Price',
      'Stock Value',
      'Last Sale',
    ]
    const rowsForExport = filtered.map((i) => {
      const sv = Number(i.current_stock) * Number(i.cost_price || 0)
      const lastSale = lastSaleByItem[i.item_id] || 'Never'
      return [
        i.sku,
        i.current_stock,
        (i.cost_price ?? 0).toFixed(2),
        sv.toFixed(2),
        lastSale,
      ]
    })
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
                {money(totalStockValue)}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase text-slate-500 font-medium">
                Never-sold value
              </div>
              <div className="text-base font-bold text-amber-800">
                {money(totalNeverSoldValue)}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase text-slate-500 font-medium">
                Showing ({tab === 'never' ? 'never sold' : 'all in stock'})
              </div>
              <div className="text-base font-bold text-slate-900">
                {filtered.length} items · {money(filteredValue)}
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
                disabled={filtered.length === 0}
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
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
            {tab === 'never'
              ? 'No never-sold items match your filters.'
              : 'No in-stock items match your filters.'}
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-3">
              {filtered.map((i) => {
                const sv = Number(i.current_stock) * Number(i.cost_price || 0)
                const lastSale = lastSaleByItem[i.item_id]
                return (
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
                          {money(i.cost_price ?? 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Value</div>
                        <div className="font-bold text-amber-800">
                          {money(sv)}
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-100">
                      Last sale: {lastSale || 'Never'}
                    </div>
                  </div>
                )
              })}
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
                  {filtered.map((i) => {
                    const sv =
                      Number(i.current_stock) * Number(i.cost_price || 0)
                    const lastSale = lastSaleByItem[i.item_id]
                    return (
                      <tr key={i.item_id} className="hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-3 py-2 font-mono text-slate-800">
                          {i.sku}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-800">
                          {i.current_stock}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-800">
                          {money(i.cost_price ?? 0)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-medium text-amber-800">
                          {money(sv)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-xs text-slate-500">
                          {lastSale || 'Never'}
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
    </div>
  )
}