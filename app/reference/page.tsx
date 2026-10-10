'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Search } from 'lucide-react'

type Brand = {
  brand_id: number
  brand_name: string
  brand_code: string
}
type PartType = {
  part_id: number
  part_name: string
  part_code: string
}
type Category = {
  category_id: number
  category_name: string
  category_code: string
}
type BrandAlias = { csv_code: string; brand_code: string }
type PartAlias = { csv_text: string; part_code: string }

const QUALITIES = [
  { name: 'Normal', note: 'No quality marker in the invoice.' },
  { name: 'OG', note: 'Marked as {OG}, {Ori}, {ORI}, {ORIG}, {ORIGINAL}.' },
  { name: '100 OG', note: 'Marked as {100%}, {100% OG}, {100 % OG}, {100% Og}.' },
  { name: 'Care OG', note: 'Marked as {CARE}, {CARE OG}, {100% CARE}, {CARE SET REMOVE}, {ORI}, {ORG}.' },
  { name: 'China OG', note: 'Marked as {CHINA OG}, {C+ 100% ORIG}.' },
]

export default function ReferencePage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [parts, setParts] = useState<PartType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [brandAliases, setBrandAliases] = useState<BrandAlias[]>([])
  const [partAliases, setPartAliases] = useState<PartAlias[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'brands' | 'parts' | 'categories' | 'quality'>('parts')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [b, p, c, ba, pa] = await Promise.all([
      supabase.from('brands').select('brand_id, brand_name, brand_code').order('brand_code'),
      supabase.from('part_types').select('part_id, part_name, part_code').order('part_code'),
      supabase.from('categories').select('category_id, category_name, category_code').order('category_code'),
      supabase.from('brand_aliases').select('csv_code, brand_code').order('brand_code'),
      supabase.from('part_type_aliases').select('csv_text, part_code').order('part_code'),
    ])
    setBrands(b.data || [])
    setParts(p.data || [])
    setCategories(c.data || [])
    setBrandAliases(ba.data || [])
    setPartAliases(pa.data || [])
    setLoading(false)
  }

  // -------- filter --------
  const q = search.trim().toLowerCase()

  const filteredBrands = useMemo(() => {
    if (!q) return brands
    return brands.filter((b) => {
      if (b.brand_name.toLowerCase().includes(q)) return true
      if (b.brand_code.toLowerCase().includes(q)) return true
      const aliases = brandAliases.filter((a) => a.brand_code === b.brand_code)
      return aliases.some((a) => a.csv_code.toLowerCase().includes(q))
    })
  }, [brands, brandAliases, q])

  const filteredParts = useMemo(() => {
    if (!q) return parts
    return parts.filter((p) => {
      if (p.part_name.toLowerCase().includes(q)) return true
      if (p.part_code.toLowerCase().includes(q)) return true
      const aliases = partAliases.filter((a) => a.part_code === p.part_code)
      return aliases.some((a) => a.csv_text.toLowerCase().includes(q))
    })
  }, [parts, partAliases, q])

  const filteredCategories = useMemo(() => {
    if (!q) return categories
    return categories.filter(
      (c) =>
        c.category_name.toLowerCase().includes(q) ||
        c.category_code.toLowerCase().includes(q)
    )
  }, [categories, q])

  const filteredQualities = useMemo(() => {
    if (!q) return QUALITIES
    return QUALITIES.filter(
      (x) =>
        x.name.toLowerCase().includes(q) ||
        x.note.toLowerCase().includes(q)
    )
  }, [q])

  const aliasesForBrand = (code: string) =>
    brandAliases.filter((a) => a.brand_code === code).map((a) => a.csv_code)

  const aliasesForPart = (code: string) =>
    partAliases.filter((a) => a.part_code === code).map((a) => a.csv_text)

  const TABS: { key: typeof activeTab; label: string }[] = [
    { key: 'brands', label: `Brands (${brands.length})` },
    { key: 'parts', label: `Parts (${parts.length})` },
    { key: 'categories', label: `Categories (${categories.length})` },
    { key: 'quality', label: `Quality (${QUALITIES.length})` },
  ]

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Reference</h1>
          <p className="text-sm text-gray-500">
            Code cheatsheet. Codes used in SKUs and their aliases (what vendors write on invoices).
          </p>
        </div>

        {/* Search */}
        <div className="bg-white border border-gray-300 rounded p-4 mb-4 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name, or alias (e.g. 'ear', 'SPKJ', 'samsung')..."
              className="w-full h-11 pl-10 pr-4 text-base border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {search && (
            <div className="mt-2 text-xs text-gray-500">
              Filtering all sections by &ldquo;{search}&rdquo;
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`h-9 px-4 text-sm font-medium rounded-lg ${
                activeTab === t.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="bg-white border border-gray-300 rounded p-12 text-center text-gray-400">
            Loading reference data...
          </div>
        ) : (
          <div className="bg-white border border-gray-300 rounded shadow-sm">

            {activeTab === 'brands' && (
              <div className="divide-y divide-gray-200">
                {filteredBrands.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">No brands match.</div>
                ) : (
                  filteredBrands.map((b) => {
                    const al = aliasesForBrand(b.brand_code)
                    return (
                      <div key={b.brand_id} className="p-4 hover:bg-gray-50">
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <span className="font-mono font-bold text-base text-gray-900">
                            {b.brand_code}
                          </span>
                          <span className="text-gray-700">{b.brand_name}</span>
                        </div>
                        {al.length > 0 && (
                          <div className="mt-1 text-xs text-gray-500">
                            <span className="font-medium">Aliases:</span> {al.join(', ')}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {activeTab === 'parts' && (
              <div className="divide-y divide-gray-200">
                {filteredParts.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">No parts match.</div>
                ) : (
                  filteredParts.map((p) => {
                    const al = aliasesForPart(p.part_code)
                    return (
                      <div key={p.part_id} className="p-4 hover:bg-gray-50">
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <span className="font-mono font-bold text-base text-gray-900">
                            {p.part_code}
                          </span>
                          <span className="text-gray-700">{p.part_name}</span>
                        </div>
                        {al.length > 0 && (
                          <div className="mt-1 text-xs text-gray-500">
                            <span className="font-medium">Aliases:</span> {al.join(', ')}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {activeTab === 'categories' && (
              <div className="divide-y divide-gray-200">
                {filteredCategories.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">No categories match.</div>
                ) : (
                  filteredCategories.map((c) => (
                    <div key={c.category_id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <span className="font-mono font-bold text-base text-gray-900">
                          {c.category_code}
                        </span>
                        <span className="text-gray-700">{c.category_name}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'quality' && (
              <div className="divide-y divide-gray-200">
                {filteredQualities.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">No quality values match.</div>
                ) : (
                  filteredQualities.map((qr) => (
                    <div key={qr.name} className="p-4 hover:bg-gray-50">
                      <div className="font-bold text-base text-gray-900">{qr.name}</div>
                      <div className="mt-1 text-xs text-gray-600">{qr.note}</div>
                    </div>
                  ))
                )}
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  )
}