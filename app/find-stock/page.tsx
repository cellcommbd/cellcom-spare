'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Search, X, Package, Sparkles } from 'lucide-react'

// ---------- Types ----------
type Brand = { brand_id: number; brand_name: string; brand_code: string }

type ResultRow = {
  item_id: number
  sku: string
  brand_name: string | null
  brand_code: string | null
  model_name: string | null
  part_code: string | null
  quality: string | null
  variant: string | null
  current_stock: number
  cost_price: number
  selling_price: number
  last_purchased: string | null
  last_sold: string | null
  total_purchased: number
  total_sold: number
}

export default function FindStockPage() {
  const router = useRouter()

  const [brands, setBrands] = useState<Brand[]>([])
  const [query, setQuery] = useState('')
  const [brandId, setBrandId] = useState<number | null>(null)
  const [stockOnly, setStockOnly] = useState(true)

  const [results, setResults] = useState<ResultRow[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadLookups()
    inputRef.current?.focus()
  }, [])

  async function loadLookups() {
    const { data } = await supabase
      .from('brands')
      .select('*')
      .order('brand_name')
    setBrands(data || [])
  }

  async function runSearch(currentQuery: string, currentBrandId: number | null) {
    setLoading(true)
    setMessage('')

    const { data, error } = await supabase.rpc('find_items', {
      p_query: currentQuery.trim() || null,
      p_brand_id: currentBrandId,
      p_model_id: null,
      p_part_id: null,
      p_quality: null,
      p_stock_min: null,
      p_stock_max: null,
      p_cost_min: null,
      p_cost_max: null,
      p_sp_min: null,
      p_sp_max: null,
      p_stock_only: stockOnly,
      p_purchased_from: null,
      p_purchased_to: null,
      p_sold_from: null,
      p_sold_to: null,
      p_never_purchased: false,
      p_never_sold: false,
      p_limit: 200,
    })

    setLoading(false)
    setHasSearched(true)

    if (error) {
      setMessage('Search error: ' + error.message)
      setResults([])
      return
    }

    setResults((data as ResultRow[]) || [])
  }

  // Debounced auto-search on query/brand change
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed && !brandId) {
      setResults([])
      setHasSearched(false)
      return
    }
    const t = setTimeout(() => {
      runSearch(query, brandId)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, brandId, stockOnly])

  function resetAll() {
    setQuery('')
    setBrandId(null)
    setStockOnly(true)
    setResults([])
    setHasSearched(false)
    setMessage('')
    inputRef.current?.focus()
  }

  function sellItem(itemId: number) {
    router.push(`/sales?prefill_item_id=${itemId}`)
  }

  const summary = useMemo(() => {
    const totalItems = results.length
    const totalUnits = results.reduce((s, r) => s + (r.current_stock || 0), 0)
    const retailValue = results.reduce(
      (s, r) => s + (r.current_stock || 0) * Number(r.selling_price || 0),
      0
    )
    return { totalItems, totalUnits, retailValue, capped: results.length >= 200 }
  }, [results])

  const hasFilters = query.trim() !== '' || brandId !== null || !stockOnly

  function itemDescription(r: ResultRow): string {
    const parts = [r.brand_name, r.model_name, r.part_code, r.quality]
      .filter((p) => p && p !== 'Normal')
      .map((p) => String(p))
    return parts.join(' · ') || '—'
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top progress bar */}
      <div className="fixed top-0 left-0 right-0 h-0.5 z-50 pointer-events-none">
        {loading && (
          <div className="h-full bg-blue-500 animate-pulse" style={{ width: '100%' }} />
        )}
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">

        {/* Header */}
        <div className="mb-5">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2">
            <Search className="w-6 h-6 text-blue-600" />
            Find Stock
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Type anything — SKU, brand, model, part, color.
          </p>
        </div>

        {/* Search box */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3 sm:p-4 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  runSearch(query, brandId)
                }
              }}
              placeholder="e.g. vivo y21 back panel"
              className="w-full h-12 pl-10 pr-10 text-base border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Quick filters */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => setStockOnly((v) => !v)}
              className={`h-9 px-3 text-xs font-medium rounded-lg border transition-colors ${
                stockOnly
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {stockOnly ? '✓ In stock only' : 'In stock only'}
            </button>

            <div className="relative">
              <select
                value={brandId ?? ''}
                onChange={(e) =>
                  setBrandId(e.target.value ? Number(e.target.value) : null)
                }
                className={`h-9 pl-3 pr-8 text-xs font-medium rounded-lg border appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  brandId
                    ? 'bg-blue-50 text-blue-800 border-blue-300'
                    : 'bg-white text-slate-600 border-slate-300'
                }`}
              >
                <option value="">All brands</option>
                {brands.map((b) => (
                  <option key={b.brand_id} value={b.brand_id}>
                    {b.brand_name}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                ▾
              </span>
            </div>

            {hasFilters && (
              <button
                type="button"
                onClick={resetAll}
                className="h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              >
                Clear all
              </button>
            )}
          </div>

          {message && (
            <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {message}
            </div>
          )}
        </div>

        {/* Results summary — one line */}
        {hasSearched && results.length > 0 && (
          <div className="text-xs text-slate-500 mb-3 px-1">
            <span className="font-semibold text-slate-800">{summary.totalItems}</span> item
            {summary.totalItems === 1 ? '' : 's'} ·{' '}
            <span className="font-semibold text-slate-800">{summary.totalUnits}</span> unit
            {summary.totalUnits === 1 ? '' : 's'} in stock ·{' '}
            <span className="text-slate-600">₹{summary.retailValue.toFixed(0)} retail</span>
            {summary.capped && (
              <span className="text-amber-700 ml-2">
                (showing first 200 — refine search)
              </span>
            )}
          </div>
        )}

        {/* Results */}
        {!hasSearched ? (
          <EmptyState />
        ) : results.length === 0 ? (
          <NoResults query={query} />
        ) : (
          <>
            {/* MOBILE — cards */}
            <div className="md:hidden space-y-2">
              {results.map((r) => (
                <ResultCard key={r.item_id} row={r} onSell={sellItem} />
              ))}
            </div>

            {/* DESKTOP — table */}
            <div className="hidden md:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      SKU
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Description
                    </th>
                    <th className="w-20 px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Stock
                    </th>
                    <th className="w-32 px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      SP / CP
                    </th>
                    <th className="w-24 px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr
                      key={r.item_id}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-900 break-all max-w-[280px]">
                        {r.sku}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{itemDescription(r)}</span>
                          {r.current_stock > 0 && r.total_sold > 0 && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                              sold {r.total_sold}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <StockBadge stock={r.current_stock} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-bold text-slate-900">
                          ₹{Number(r.selling_price).toFixed(0)}
                        </div>
                        <div className="text-xs text-slate-600">
                          CP ₹{Number(r.cost_price).toFixed(2)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.current_stock > 0 && (
                          <button
                            onClick={() => sellItem(r.item_id)}
                            className="h-8 px-3 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                          >
                            Sell
                          </button>
                        )}
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

function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) {
    return (
      <span className="inline-block px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-100 text-slate-500">
        0
      </span>
    )
  }
  if (stock <= 5) {
    return (
      <span className="inline-block px-2 py-0.5 text-xs font-bold rounded-full bg-amber-100 text-amber-800">
        {stock}
      </span>
    )
  }
  return (
    <span className="inline-block px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800">
      {stock}
    </span>
  )
}

function ResultCard({
  row,
  onSell,
}: {
  row: ResultRow
  onSell: (id: number) => void
}) {
  const description = [row.brand_name, row.model_name, row.part_code, row.quality]
    .filter((p) => p && p !== 'Normal')
    .map((p) => String(p))
    .join(' · ')

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="font-mono text-xs sm:text-sm font-semibold text-slate-900 break-all flex-1">
          {row.sku}
        </div>
        <StockBadge stock={row.current_stock} />
      </div>
      <div className="text-xs text-slate-600 mb-3">{description || '—'}</div>

      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[10px] uppercase text-slate-500 font-medium">SP</div>
            <div className="text-base font-bold text-slate-900">
              ₹{Number(row.selling_price).toFixed(0)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500 font-medium">CP</div>
            <div className="text-sm font-semibold text-slate-700">
              ₹{Number(row.cost_price).toFixed(2)}
            </div>
          </div>
        </div>
        {row.current_stock > 0 && (
          <button
            onClick={() => onSell(row.item_id)}
            className="h-9 px-4 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:bg-blue-800"
          >
            Sell
          </button>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 sm:p-12 text-center">
      <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-3" />
      <div className="text-sm font-medium text-slate-600 mb-1">
        Start typing to find stock
      </div>
      <div className="text-xs text-slate-400 max-w-md mx-auto">
        Try &ldquo;vivo y21&rdquo;, &ldquo;iphone 11 back&rdquo;, &ldquo;redmi note 10 lcd&rdquo;, or any SKU fragment.
      </div>
    </div>
  )
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
      <Package className="w-8 h-8 text-slate-300 mx-auto mb-3" />
      <div className="text-sm font-medium text-slate-700 mb-1">
        No items found
      </div>
      <div className="text-xs text-slate-400">
        {query ? `Nothing matched "${query.trim()}".` : 'Try different keywords.'}
      </div>
    </div>
  )
}