'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Search, RotateCcw, ChevronDown, ChevronUp, X } from 'lucide-react'

// ---------- Types ----------
type Brand = { brand_id: number; brand_name: string; brand_code: string }
type PartType = { part_id: number; part_code: string; part_name: string }

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

const QUALITY_OPTIONS = [
  { value: '', label: '— Any —' },
  { value: 'Normal', label: 'Normal' },
  { value: 'OG', label: 'OG' },
  { value: '100 OG', label: '100 OG' },
  { value: 'ORG', label: 'ORG' },
  { value: 'Care OG', label: 'Care OG' },
  { value: 'China OG', label: 'China OG' },
]

export default function FindStockPage() {
  const router = useRouter()

  const [brands, setBrands] = useState<Brand[]>([])
  const [parts, setParts] = useState<PartType[]>([])

  const [query, setQuery] = useState('')
  const [brandId, setBrandId] = useState<number | null>(null)
  const [partId, setPartId] = useState<number | null>(null)
  const [quality, setQuality] = useState('')
  const [stockMin, setStockMin] = useState<string>('')
  const [stockMax, setStockMax] = useState<string>('')
  const [costMin, setCostMin] = useState<string>('')
  const [costMax, setCostMax] = useState<string>('')
  const [spMin, setSpMin] = useState<string>('')
  const [spMax, setSpMax] = useState<string>('')
  const [stockOnly, setStockOnly] = useState(true)
  const [purchasedFrom, setPurchasedFrom] = useState('')
  const [purchasedTo, setPurchasedTo] = useState('')
  const [soldFrom, setSoldFrom] = useState('')
  const [soldTo, setSoldTo] = useState('')
  const [neverPurchased, setNeverPurchased] = useState(false)
  const [neverSold, setNeverSold] = useState(false)

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [results, setResults] = useState<ResultRow[]>([])
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    loadLookups()
  }, [])

  async function loadLookups() {
    const [b, p] = await Promise.all([
      supabase.from('brands').select('*').order('brand_name'),
      supabase.from('part_types').select('*').order('part_code'),
    ])
    setBrands(b.data || [])
    setParts(p.data || [])
  }

  async function runSearch() {
    setSearching(true)
    setMessage('')

    const numericOrNull = (s: string) => {
      if (!s || s.trim() === '') return null
      const n = Number(s)
      return isNaN(n) ? null : n
    }
    const dateOrNull = (s: string) => {
      if (!s || s.trim() === '') return null
      return s
    }

    const { data, error } = await supabase.rpc('find_items', {
      p_query: query.trim() || null,
      p_brand_id: brandId,
      p_model_id: null,
      p_part_id: partId,
      p_quality: quality || null,
      p_stock_min: numericOrNull(stockMin),
      p_stock_max: numericOrNull(stockMax),
      p_cost_min: numericOrNull(costMin),
      p_cost_max: numericOrNull(costMax),
      p_sp_min: numericOrNull(spMin),
      p_sp_max: numericOrNull(spMax),
      p_stock_only: stockOnly,
      p_purchased_from: dateOrNull(purchasedFrom),
      p_purchased_to: dateOrNull(purchasedTo),
      p_sold_from: dateOrNull(soldFrom),
      p_sold_to: dateOrNull(soldTo),
      p_never_purchased: neverPurchased,
      p_never_sold: neverSold,
      p_limit: 200,
    })

    setSearching(false)
    setHasSearched(true)

    if (error) {
      setMessage('Search error: ' + error.message)
      setResults([])
      return
    }

    setResults((data as ResultRow[]) || [])
  }

  const filterKey = JSON.stringify({
    query, brandId, partId, quality,
    stockMin, stockMax, costMin, costMax, spMin, spMax,
    stockOnly, purchasedFrom, purchasedTo, soldFrom, soldTo,
    neverPurchased, neverSold,
  })

  useEffect(() => {
    if (!hasSearched && !query && !brandId && !partId && !quality) return
    const t = setTimeout(() => {
      runSearch()
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey])

  function resetAll() {
    setQuery('')
    setBrandId(null)
    setPartId(null)
    setQuality('')
    setStockMin(''); setStockMax('')
    setCostMin(''); setCostMax('')
    setSpMin(''); setSpMax('')
    setStockOnly(true)
    setPurchasedFrom(''); setPurchasedTo('')
    setSoldFrom(''); setSoldTo('')
    setNeverPurchased(false); setNeverSold(false)
    setResults([])
    setHasSearched(false)
    setMessage('')
  }

  function sellItem(itemId: number) {
    router.push(`/sales?prefill_item_id=${itemId}`)
  }

  const chips: { label: string; onClear: () => void }[] = []
  if (brandId) {
    const b = brands.find((x) => x.brand_id === brandId)
    chips.push({ label: `Brand: ${b?.brand_name ?? '?'}`, onClear: () => setBrandId(null) })
  }
  if (partId) {
    const p = parts.find((x) => x.part_id === partId)
    chips.push({ label: `Part: ${p?.part_name ?? '?'}`, onClear: () => setPartId(null) })
  }
  if (quality) {
    chips.push({ label: `Quality: ${quality}`, onClear: () => setQuality('') })
  }

  // ---------- Summary calculations ----------
  const summary = useMemo(() => {
    const totalItems = results.length
    const totalUnits = results.reduce((s, r) => s + (r.current_stock || 0), 0)
    const stockValue = results.reduce(
      (s, r) => s + (r.current_stock || 0) * Number(r.cost_price || 0),
      0
    )
    const retailValue = results.reduce(
      (s, r) => s + (r.current_stock || 0) * Number(r.selling_price || 0),
      0
    )
    const margin = retailValue - stockValue
    const capped = results.length >= 200
    return { totalItems, totalUnits, stockValue, retailValue, margin, capped }
  }, [results])

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">Find Stock</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Type anything — brand, model, part, SKU, color. Use filters below to narrow.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 mb-6 shadow-sm space-y-4">

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Search (type model name, part, SKU, color — multi-word)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
                placeholder="e.g. vivo y21 back panel"
                className="flex-1 h-11 px-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={runSearch}
                disabled={searching}
                className="h-11 px-4 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                <Search className="size-4" />
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Model names are searched here — no dropdown needed.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Brand</label>
              <div className="relative">
                <select
                  value={brandId ?? ''}
                  onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-11 pl-2 pr-8 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white appearance-none"
                >
                  <option value="">— Any —</option>
                  {brands.map((b) => (
                    <option key={b.brand_id} value={b.brand_id}>
                      {b.brand_name} ({b.brand_code})
                    </option>
                  ))}
                </select>
                {brandId && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setBrandId(null) }}
                    className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-600"
                    aria-label="Clear brand"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Part</label>
              <div className="relative">
                <select
                  value={partId ?? ''}
                  onChange={(e) => setPartId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-11 pl-2 pr-8 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white appearance-none"
                >
                  <option value="">— Any —</option>
                  {parts.map((p) => (
                    <option key={p.part_id} value={p.part_id}>
                      {p.part_name}
                    </option>
                  ))}
                </select>
                {partId && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setPartId(null) }}
                    className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-600"
                    aria-label="Clear part"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Quality</label>
              <div className="relative">
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full h-11 pl-2 pr-8 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white appearance-none"
                >
                  {QUALITY_OPTIONS.map((q) => (
                    <option key={q.value} value={q.value}>{q.label}</option>
                  ))}
                </select>
                {quality && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setQuality('') }}
                    className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-600"
                    aria-label="Clear quality"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-blue-50 border border-blue-200 rounded-full text-blue-800"
                >
                  {c.label}
                  <button
                    type="button"
                    onClick={c.onClear}
                    className="text-blue-600 hover:text-red-600"
                    aria-label="Remove filter"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              id="stockOnly"
              type="checkbox"
              checked={stockOnly}
              onChange={(e) => setStockOnly(e.target.checked)}
              className="size-4 accent-blue-600"
            />
            <label htmlFor="stockOnly" className="text-sm text-slate-700">
              In-stock only
            </label>
          </div>

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            {showAdvanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            Advanced filters (stock, price, dates)
          </button>

          {showAdvanced && (
            <div className="border-t border-slate-200 pt-4 space-y-4">
              <div>
                <div className="text-xs font-semibold text-slate-600 mb-2">Stock between</div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    value={stockMin}
                    onChange={(e) => setStockMin(e.target.value)}
                    placeholder="Min"
                    className="h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    value={stockMax}
                    onChange={(e) => setStockMax(e.target.value)}
                    placeholder="Max"
                    className="h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-600 mb-2">Cost price between</div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    value={costMin}
                    onChange={(e) => setCostMin(e.target.value)}
                    placeholder="Min ₹"
                    className="h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    value={costMax}
                    onChange={(e) => setCostMax(e.target.value)}
                    placeholder="Max ₹"
                    className="h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-600 mb-2">Selling price between</div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    value={spMin}
                    onChange={(e) => setSpMin(e.target.value)}
                    placeholder="Min ₹"
                    className="h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    value={spMax}
                    onChange={(e) => setSpMax(e.target.value)}
                    placeholder="Max ₹"
                    className="h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-600 mb-2">Last purchased between</div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    value={purchasedFrom}
                    onChange={(e) => setPurchasedFrom(e.target.value)}
                    className="h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="date"
                    value={purchasedTo}
                    onChange={(e) => setPurchasedTo(e.target.value)}
                    className="h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-600 mb-2">Last sold between</div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    value={soldFrom}
                    onChange={(e) => setSoldFrom(e.target.value)}
                    className="h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="date"
                    value={soldTo}
                    onChange={(e) => setSoldTo(e.target.value)}
                    className="h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={neverPurchased}
                    onChange={(e) => setNeverPurchased(e.target.checked)}
                    className="size-4 accent-blue-600"
                  />
                  Never purchased
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={neverSold}
                    onChange={(e) => setNeverSold(e.target.checked)}
                    className="size-4 accent-blue-600"
                  />
                  Never sold
                </label>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
            <button
              onClick={resetAll}
              className="h-9 px-3 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2"
            >
              <RotateCcw className="size-3.5" />
              Reset all
            </button>
            {message && <div className="text-sm text-red-600">{message}</div>}
          </div>
        </div>

        {hasSearched && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">

            {/* Summary bar */}
            <div className="px-4 py-3 bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-200 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-slate-700">
                  <span className="font-bold text-slate-900 text-base">{summary.totalItems}</span>{' '}
                  item{summary.totalItems === 1 ? '' : 's'}
                  {summary.capped && (
                    <span className="text-amber-700 font-normal ml-1">
                      (capped at 200 — narrow filters to see all)
                    </span>
                  )}
                </span>
                <span className="text-slate-600">
                  Total units:{' '}
                  <span className="font-semibold text-slate-900">{summary.totalUnits}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-slate-700">
                  Stock value:{' '}
                  <span className="font-bold text-blue-700">
                    ₹{summary.stockValue.toFixed(2)}
                  </span>
                </span>
                <span className="text-slate-700">
                  Retail value:{' '}
                  <span className="font-bold text-green-700">
                    ₹{summary.retailValue.toFixed(2)}
                  </span>
                </span>
                <span className="text-slate-700">
                  Potential margin:{' '}
                  <span className={`font-bold ${summary.margin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    ₹{summary.margin.toFixed(2)}
                  </span>
                </span>
              </div>
            </div>

            {results.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                No matching items.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm min-w-[900px]">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">SKU</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Brand</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Model</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Part</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Quality</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Stock</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Cost</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">SP</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.item_id} className="hover:bg-slate-50 border-b border-slate-100">
                        <td className="px-3 py-2 font-mono text-xs text-slate-800">{r.sku}</td>
                        <td className="px-3 py-2 text-slate-700">{r.brand_name || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{r.model_name || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{r.part_code || '—'}</td>
                        <td className="px-3 py-2 text-slate-600 text-xs">{r.quality || '—'}</td>
                        <td className={`px-3 py-2 text-right font-medium ${r.current_stock > 0 ? 'text-green-700' : 'text-slate-400'}`}>
                          {r.current_stock}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">₹{Number(r.cost_price).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-slate-800 font-medium">₹{Number(r.selling_price).toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          {r.current_stock > 0 && (
                            <button
                              onClick={() => sellItem(r.item_id)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
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
            )}
          </div>
        )}

        {!hasSearched && (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-slate-500 text-sm">
            Type in the search box or set filters — results appear automatically.
          </div>
        )}

      </div>
    </div>
  )
}