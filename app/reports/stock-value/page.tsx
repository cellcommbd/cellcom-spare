'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import {
  ArrowLeft,
  Package,
  Download,
  Search,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

type BrandAgg = {
  brand_id: number | null
  brand_code: string
  brand_name: string
  items: number
  units: number
  stock_value: number
  pct: number
}

type TopItem = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
  stock_value: number
}

function money(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`
}

function moneyShort(n: number) {
  const num = Number(n)
  if (num >= 100000) return `₹${(num / 100000).toFixed(2)}L`
  if (num >= 1000) return `₹${(num / 1000).toFixed(1)}K`
  return `₹${num.toFixed(0)}`
}

export default function StockValuePage() {
  const [loading, setLoading] = useState(true)
  const [brands, setBrands] = useState<BrandAgg[]>([])
  const [topItems, setTopItems] = useState<Record<string, TopItem[]>>({})
  const [loadingItems, setLoadingItems] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data, error } = await supabase.rpc('stock_value_by_brand')

    if (error) {
      console.error('stock_value_by_brand error:', error.message)
      setBrands([])
      setLoading(false)
      return
    }

    const rows: BrandAgg[] = (data || []).map((r: any) => ({
      brand_id: r.brand_id,
      brand_code: r.brand_code,
      brand_name: r.brand_name,
      items: Number(r.items),
      units: Number(r.units),
      stock_value: Number(r.stock_value),
      pct: 0,
    }))

    const total = rows.reduce((s, r) => s + r.stock_value, 0)
    for (const r of rows) {
      r.pct = total > 0 ? (r.stock_value / total) * 100 : 0
    }

    setBrands(rows)
    setLoading(false)
  }

  async function loadTopItems(brandId: number | null, key: string) {
    if (topItems[key]) return
    setLoadingItems((prev) => new Set(prev).add(key))
    const { data, error } = await supabase.rpc('top_items_by_brand', {
      p_brand_id: brandId,
      p_limit: 10,
    })
    setLoadingItems((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    if (error) {
      console.error('top_items_by_brand error:', error.message)
      setTopItems((prev) => ({ ...prev, [key]: [] }))
      return
    }
    setTopItems((prev) => ({ ...prev, [key]: (data as TopItem[]) || [] }))
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return brands
    const q = search.trim().toUpperCase()
    return brands.filter(
      (b) =>
        b.brand_code.toUpperCase().includes(q) ||
        b.brand_name.toUpperCase().includes(q)
    )
  }, [brands, search])

  const total = useMemo(() => {
    return brands.reduce(
      (acc, b) => ({
        value: acc.value + b.stock_value,
        items: acc.items + b.items,
        units: acc.units + b.units,
      }),
      { value: 0, items: 0, units: 0 }
    )
  }, [brands])

  function toggleExpand(b: BrandAgg) {
    const key = b.brand_id === null ? '__null__' : String(b.brand_id)
    const isOpen = expanded.has(key)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (isOpen) next.delete(key)
      else next.add(key)
      return next
    })
    if (!isOpen) {
      loadTopItems(b.brand_id, key)
    }
  }

  function exportCSV() {
    const headers = [
      'Brand Code',
      'Brand Name',
      'Items',
      'Units',
      'Stock Value',
      '% of Total',
    ]
    const rows = filtered.map((b) => [
      b.brand_code,
      b.brand_name,
      b.items,
      b.units,
      b.stock_value.toFixed(2),
      b.pct.toFixed(2) + '%',
    ])
    const csv = [headers, ...rows]
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')
      )
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stock-value-by-brand-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">

        <div className="mb-5 flex items-center gap-3">
          <Link
            href="/reports"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            aria-label="Back to reports"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-slate-700" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Stock Value by Brand
            </h1>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mb-5">
          Where your money is sitting. Sorted by value. Tap a brand to see its
          top items.
        </p>

        <div className="bg-gradient-to-br from-slate-900 to-slate-700 text-white rounded-2xl p-4 sm:p-5 shadow-sm mb-5">
          <div className="grid grid-cols-3 gap-3 sm:gap-6">
            <div>
              <div className="text-[10px] uppercase text-slate-300 font-medium tracking-wide">
                Total value
              </div>
              <div className="text-lg sm:text-2xl font-bold mt-1">
                {moneyShort(total.value)}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {money(total.value)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-300 font-medium tracking-wide">
                Brands
              </div>
              <div className="text-lg sm:text-2xl font-bold mt-1">
                {brands.length}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                with stock
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-300 font-medium tracking-wide">
                Items
              </div>
              <div className="text-lg sm:text-2xl font-bold mt-1">
                {total.items}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {total.units} units
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-5">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search brand…"
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

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
            No brands match your search.
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((b) => {
              const key = b.brand_id === null ? '__null__' : String(b.brand_id)
              const isOpen = expanded.has(key)
              const items = topItems[key]
              const isLoadingItems = loadingItems.has(key)

              return (
                <div
                  key={key}
                  className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
                >
                  <button
                    onClick={() => toggleExpand(b)}
                    className="w-full text-left p-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-slate-500 uppercase">
                            {b.brand_code}
                          </span>
                          <span className="text-sm font-bold text-slate-900">
                            {b.brand_name}
                          </span>
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {b.items} item{b.items === 1 ? '' : 's'} · {b.units}{' '}
                          unit{b.units === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-base sm:text-lg font-bold text-slate-900">
                          {moneyShort(b.stock_value)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {b.pct.toFixed(1)}% of total
                        </div>
                      </div>
                    </div>

                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
                        style={{ width: `${Math.max(b.pct, 0.5)}%` }}
                      />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/50">
                      {isLoadingItems ? (
                        <div className="px-4 py-4 text-center text-xs text-slate-400">
                          Loading items…
                        </div>
                      ) : items && items.length > 0 ? (
                        <>
                          {items.map((it) => (
                            <div
                              key={it.item_id}
                              className="px-4 py-2 flex items-center justify-between gap-3 border-b border-slate-100 last:border-b-0"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-mono text-xs text-slate-800 truncate">
                                  {it.sku}
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  {it.current_stock} × {money(it.cost_price)}
                                </div>
                              </div>
                              <div className="text-sm font-semibold text-slate-800 shrink-0">
                                {money(it.stock_value)}
                              </div>
                            </div>
                          ))}
                          {b.items > 10 && (
                            <div className="px-4 py-2 text-xs text-slate-500 text-center">
                              + {b.items - 10} more items
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="px-4 py-4 text-center text-xs text-slate-400">
                          No items
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}