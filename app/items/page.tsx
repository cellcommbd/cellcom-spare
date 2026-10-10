'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { searchItems as searchItemsShared } from '../../lib/item-search'
import { Plus, Trash2, X, Search, ChevronLeft, ChevronRight } from 'lucide-react'

// ---------- Types ----------
type Brand = { brand_id: number; brand_name: string; brand_code: string }
type PartType = { part_id: number; part_name: string; part_code: string }
type Category = {
  category_id: number
  category_name: string
  category_code: string
}
type Model = {
  model_id: number
  brand_id: number
  model_name: string
  network: string | null
}
type Item = {
  item_id: number
  sku: string
  brand_id: number | null
  model_id: number | null
  part_id: number | null
  category_id: number | null
  is_phone_part: boolean
  quality: string
  color: string | null
  current_stock: number
  cost_price: number | null
  selling_price: number | null
}

type Picked = {
  id: number | null
  label: string
  isNew: boolean
  code?: string
}

type ItemType = 'phone' | 'general'

const NETWORKS = ['N/A', '4G', '5G']
const QUALITIES = [
  'Normal',
  'OG',
  '100 OG',
  'Care OG',
  'China OG',
]
const PAGE_SIZE = 50

export default function ItemMasterPage() {
  // ----- Master data -----
  const [brands, setBrands] = useState<Brand[]>([])
  const [partTypes, setPartTypes] = useState<PartType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [models, setModels] = useState<Model[]>([])

  // ----- Form: type toggle -----
  const [itemType, setItemType] = useState<ItemType>('phone')

  // ----- Table state -----
  const [visibleItems, setVisibleItems] = useState<Item[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [brandFilter, setBrandFilter] = useState<string>('All')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ----- Form state -----
  const [pickedBrand, setPickedBrand] = useState<Picked>({ id: null, label: '', isNew: false })
  const [pickedModel, setPickedModel] = useState<Picked>({ id: null, label: '', isNew: false })
  const [pickedPart, setPickedPart] = useState<Picked>({ id: null, label: '', isNew: false })
  const [pickedCategory, setPickedCategory] = useState<Picked>({ id: null, label: '', isNew: false })
  const [pickedColor, setPickedColor] = useState<Picked>({ id: null, label: '', isNew: false })

  // General-item extra: free-text name
  const [generalName, setGeneralName] = useState('')

  const [network, setNetwork] = useState('N/A')
  const [quality, setQuality] = useState('Normal')

  // ----- UI state -----
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // ---------- Initial master data ----------
  useEffect(() => {
    loadMaster()
  }, [])

  async function loadMaster() {
    const [b, p, c] = await Promise.all([
      supabase.from('brands').select('brand_id, brand_name, brand_code').order('brand_name').range(0, 9999),
      supabase.from('part_types').select('part_id, part_name, part_code').order('part_name').range(0, 9999),
      supabase.from('categories').select('category_id, category_name, category_code').order('category_name').range(0, 9999),
    ])
    setBrands(b.data || [])
    setPartTypes(p.data || [])
    setCategories(c.data || [])
  }

  // ---------- Load models for the selected brand ----------
  useEffect(() => {
    if (!pickedBrand.id) {
      setModels([])
      return
    }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('models')
        .select('model_id, brand_id, model_name, network')
        .eq('brand_id', pickedBrand.id)
        .order('model_name')
        .range(0, 9999)
      if (!cancelled) setModels(data || [])
    })()
    return () => {
      cancelled = true
    }
  }, [pickedBrand.id])

  // ---------- Load items page ----------
  useEffect(() => {
    loadItemsPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, brandFilter])

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setPage(0)
      loadItemsPage()
    }, 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm])

  async function loadItemsPage() {
    setItemsLoading(true)
    try {
      if (searchTerm.trim().length >= 2) {
        const results = await searchItemsShared(searchTerm.trim())
        let list = results as any[]
        if (brandFilter !== 'All') {
          const bid = Number(brandFilter)
          list = list.filter((r) => r.brand_id === bid || r.brand_id == null)
        }
        setTotalCount(list.length)
        setVisibleItems(list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) as Item[])
      } else {
        let q = supabase
          .from('items')
          .select('*', { count: 'exact' })
          .order('item_id', { ascending: false })

        if (brandFilter !== 'All') {
          q = q.eq('brand_id', Number(brandFilter))
        }
        const from = page * PAGE_SIZE
        const to = from + PAGE_SIZE - 1
        const { data, count } = await q.range(from, to)
        setVisibleItems((data || []) as Item[])
        setTotalCount(count || 0)
      }
    } catch (e) {
      console.error('loadItemsPage error:', e)
      setVisibleItems([])
      setTotalCount(0)
    } finally {
      setItemsLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  // ---------- Combobox options ----------
  const brandOptions = brands.map((b) => ({
    value: b.brand_id,
    label: `${b.brand_name} (${b.brand_code})`,
  }))

  const modelOptions = models.map((m) => ({
    value: m.model_id,
    label: `${m.model_name}${m.network ? ' ' + m.network : ''}`,
  }))

  const partOptions = partTypes.map((p) => ({
    value: p.part_id,
    label: `${p.part_name} (${p.part_code})`,
  }))

  const categoryOptions = categories.map((c) => ({
    value: c.category_id,
    label: `${c.category_name} (${c.category_code})`,
  }))

  const colorOptions = useMemo(() => {
    const set = new Set<string>()
    for (const it of visibleItems) if (it.color) set.add(it.color)
    return Array.from(set).sort().map((c) => ({ value: c, label: c }))
  }, [visibleItems])

  // ---------- Live SKU generation ----------
  const liveSku = useMemo(() => {
    if (itemType === 'phone') {
      const brandCode = pickedBrand.isNew
        ? (pickedBrand.code || pickedBrand.label.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, '')
        : brands.find((b) => b.brand_id === pickedBrand.id)?.brand_code || ''

      const modelName = pickedModel.label
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')

      const partCode = pickedPart.isNew
        ? (pickedPart.code || pickedPart.label.slice(0, 4)).toUpperCase().replace(/[^A-Z0-9]/g, '')
        : partTypes.find((p) => p.part_id === pickedPart.id)?.part_code || ''

      if (!partCode) return ''

      const finalBrand = brandCode || 'GEN'
      const seg: string[] = [finalBrand]
      if (modelName) seg.push(modelName)
      seg.push(partCode)
      if (network !== 'N/A') seg.push(network)
      if (quality === 'OG') seg.push('OG')
      else if (quality === '100 OG') seg.push('100OG')
      else if (quality === 'Care OG') seg.push('CARE')
      else if (quality === 'China OG') seg.push('CHINAOG')

      return seg.join('-')
    }

    // General item SKU = CATEGORY-[BRAND]-[MODEL]-[NAME]
    const categoryCode =
      categories.find((c) => c.category_id === pickedCategory.id)?.category_code || ''
    if (!categoryCode) return ''

    const brandCode =
      brands.find((b) => b.brand_id === pickedBrand.id)?.brand_code || ''

    const modelName = pickedModel.label
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    const extraName = generalName
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    const seg: string[] = [categoryCode]
    if (brandCode) seg.push(brandCode)
    if (modelName) seg.push(modelName)
    if (extraName) seg.push(extraName)

    return seg.join('-')
  }, [
    itemType,
    pickedBrand, pickedModel, pickedPart, pickedCategory, generalName,
    network, quality, brands, partTypes, categories,
  ])
    // ---------- Ensure brand / model / part ----------
  async function ensureBrand(): Promise<number | null> {
    if (pickedBrand.isNew && pickedBrand.label) {
      const code = (pickedBrand.code || pickedBrand.label.slice(0, 3))
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
      if (!code) {
        setMessage('Brand code required.')
        return null
      }
      const { data, error } = await supabase
        .from('brands')
        .insert({ brand_name: pickedBrand.label, brand_code: code })
        .select()
        .single()
      if (error) {
        setMessage('Brand error: ' + error.message)
        return null
      }
      await loadMaster()
      return data.brand_id
    }
    return pickedBrand.id
  }

  async function ensureModel(brandId: number | null): Promise<number | null> {
    if (pickedModel.isNew && pickedModel.label) {
      if (!brandId) {
        setMessage('Brand required before creating a model.')
        return null
      }
      const { data, error } = await supabase
        .from('models')
        .insert({
          brand_id: brandId,
          model_name: pickedModel.label.trim(),
          network: network === 'N/A' ? null : network,
        })
        .select()
        .single()
      if (error) {
        setMessage('Model error: ' + error.message)
        return null
      }
      return data.model_id
    }
    return pickedModel.id
  }

  async function ensurePart(): Promise<number | null> {
    if (pickedPart.isNew && pickedPart.label) {
      const code = (pickedPart.code || pickedPart.label.slice(0, 4))
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
      if (!code) {
        setMessage('Part code required.')
        return null
      }
      const { data, error } = await supabase
        .from('part_types')
        .insert({ part_name: pickedPart.label, part_code: code })
        .select()
        .single()
      if (error) {
        setMessage('Part error: ' + error.message)
        return null
      }
      await loadMaster()
      return data.part_id
    }
    return pickedPart.id
  }

  // ---------- Save ----------
  async function saveItem() {
    setMessage('')

    if (itemType === 'phone') {
      // Phone part — only part is required; brand and model optional
      if (!pickedPart.label) return setMessage('Select or type a Part Type.')
      if (!liveSku) return setMessage('SKU could not be generated.')

      setSaving(true)
      const brandId = await ensureBrand()
      const modelId = await ensureModel(brandId)
      const partId = await ensurePart()
      if (!partId) { setSaving(false); return }

      const { data: existing } = await supabase
        .from('items')
        .select('item_id')
        .eq('sku', liveSku)
        .maybeSingle()

      if (existing) {
        setMessage(`SKU "${liveSku}" already exists.`)
        setSaving(false)
        return
      }

      const { error } = await supabase.from('items').insert({
        sku: liveSku,
        brand_id: brandId,
        model_id: modelId,
        part_id: partId,
        category_id: null,
        is_phone_part: true,
        quality,
        color: pickedColor.label || null,
        cost_price: null,
        selling_price: null,
        current_stock: 0,
      })

      if (error) {
        setMessage('Save error: ' + error.message)
      } else {
        setMessage(`Saved: ${liveSku}`)
        resetForm()
        await loadItemsPage()
      }
      setSaving(false)
      return
    }

    // ----- General item -----
    if (!pickedCategory.id) {
      return setMessage('Select a Category.')
    }
    if (!liveSku) return setMessage('SKU could not be generated.')

    setSaving(true)

    const brandId = pickedBrand.id || null
    const modelId = pickedModel.id || null
    const categoryId = pickedCategory.id

    const { data: existing } = await supabase
      .from('items')
      .select('item_id')
      .eq('sku', liveSku)
      .maybeSingle()

    if (existing) {
      setMessage(`SKU "${liveSku}" already exists.`)
      setSaving(false)
      return
    }

    const { error } = await supabase.from('items').insert({
      sku: liveSku,
      brand_id: brandId,
      model_id: modelId,
      part_id: null,
      category_id: categoryId,
      is_phone_part: false,
      quality: 'Normal',
      color: null,
      cost_price: null,
      selling_price: null,
      current_stock: 0,
    })

    if (error) {
      setMessage('Save error: ' + error.message)
    } else {
      setMessage(`Saved: ${liveSku}`)
      resetForm()
      await loadItemsPage()
    }
    setSaving(false)
  }

  function resetForm() {
    setPickedBrand({ id: null, label: '', isNew: false })
    setPickedModel({ id: null, label: '', isNew: false })
    setPickedPart({ id: null, label: '', isNew: false })
    setPickedCategory({ id: null, label: '', isNew: false })
    setPickedColor({ id: null, label: '', isNew: false })
    setGeneralName('')
    setNetwork('N/A')
    setQuality('Normal')
  }

  async function deleteItem(id: number, sku: string) {
    if (!confirm(`Delete item "${sku}"?`)) return
    const { error } = await supabase.from('items').delete().eq('item_id', id)
    if (error) {
      setMessage('Delete error: ' + error.message)
    } else {
      setMessage('Deleted: ' + sku)
      await loadItemsPage()
    }
  }

  // ---------- Display helpers ----------
  const brandName = (id: number | null) =>
    id ? brands.find((b) => b.brand_id === id)?.brand_name || '—' : '—'
  const modelName = (id: number | null) => {
    if (!id) return '—'
    const m = models.find((x) => x.model_id === id)
    if (!m) return '—'
    return m.model_name + (m.network ? ' ' + m.network : '')
  }
  const partName = (id: number | null) =>
    id ? partTypes.find((p) => p.part_id === id)?.part_name || '—' : '—'
  const categoryName = (id: number | null) =>
    id ? categories.find((c) => c.category_id === id)?.category_name || '—' : '—'

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Item Master</h1>
          <p className="text-sm text-gray-500">
            Define every product. Stock and prices are updated automatically by Purchases and Sales.
          </p>
        </div>

        {/* ============ FORM ============ */}
        <div className="bg-white border border-gray-300 rounded p-4 sm:p-6 mb-6 shadow-sm">

          {/* Type toggle */}
          <div className="flex flex-wrap gap-4 mb-5 pb-4 border-b border-gray-200">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="radio"
                name="item-type"
                checked={itemType === 'phone'}
                onChange={() => {
                  setItemType('phone')
                  resetForm()
                }}
                className="w-4 h-4"
              />
              <span className={`text-sm font-medium ${itemType === 'phone' ? 'text-blue-700' : 'text-gray-600'}`}>
                Phone Part
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="radio"
                name="item-type"
                checked={itemType === 'general'}
                onChange={() => {
                  setItemType('general')
                  resetForm()
                }}
                className="w-4 h-4"
              />
              <span className={`text-sm font-medium ${itemType === 'general' ? 'text-blue-700' : 'text-gray-600'}`}>
                General Item
              </span>
            </label>
            <span className="text-xs text-gray-400 self-center">
              {itemType === 'phone' ? '(default — phone spare parts)' : '(tools, cleaning, consumables, etc.)'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">

            {/* Category — general items only */}
            {itemType === 'general' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category <span className="text-red-500">*</span>
                </label>
                <SmartCombobox
                  options={categoryOptions}
                  value={pickedCategory.id ? String(pickedCategory.id) : null}
                  onValueChange={(v, label, isNew) =>
                    setPickedCategory({ id: isNew ? null : Number(v), label, isNew })
                  }
                  placeholder="Select category..."
                  allowCreate={false}
                  showReferenceLink={true}
                />
              </div>
            )}

            {/* Brand — optional for both */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Brand <span className="text-gray-400 text-xs">(optional — leave blank for generic / universal)</span>
              </label>
              <SmartCombobox
                options={brandOptions}
                value={
                  pickedBrand.id
                    ? String(pickedBrand.id)
                    : pickedBrand.isNew
                    ? `__new__${pickedBrand.label}`
                    : null
                }
                onValueChange={(v, label, isNew) =>
                  setPickedBrand({ id: isNew ? null : Number(v), label, isNew })
                }
                placeholder="Type or select brand..."
                allowCreate={true}
                showReferenceLink={true}
              />
              {pickedBrand.isNew && (
                <input
                  type="text"
                  value={pickedBrand.code || ''}
                  onChange={(e) =>
                    setPickedBrand((p) => ({ ...p, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="Brand code e.g. SAM, IP, VV"
                  className="mt-2 w-full h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            {/* Model — optional for both */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Model <span className="text-gray-400 text-xs">(optional — leave blank for universal parts)</span>
              </label>
              <SmartCombobox
                options={modelOptions}
                value={
                  pickedModel.id
                    ? String(pickedModel.id)
                    : pickedModel.isNew
                    ? `__new__${pickedModel.label}`
                    : null
                }
                onValueChange={(v, label, isNew) =>
                  setPickedModel({ id: isNew ? null : Number(v), label, isNew })
                }
                placeholder={
                  pickedBrand.id || pickedBrand.isNew
                    ? 'Type or select model (or leave blank)'
                    : 'Pick a brand first, or leave blank'
                }
                allowCreate={true}
              />
            </div>

            {/* Network — phone parts only */}
            {itemType === 'phone' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Network
                </label>
                <select
                  value={network}
                  onChange={(e) => setNetwork(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {NETWORKS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Part Type — phone parts only */}
            {itemType === 'phone' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Part Type <span className="text-red-500">*</span>
                </label>
                <SmartCombobox
                  options={partOptions}
                  value={
                    pickedPart.id
                      ? String(pickedPart.id)
                      : pickedPart.isNew
                      ? `__new__${pickedPart.label}`
                      : null
                  }
                  onValueChange={(v, label, isNew) =>
                    setPickedPart({ id: isNew ? null : Number(v), label, isNew })
                  }
                  placeholder="Type or select part..."
                  allowCreate={true}
                  showReferenceLink={true}
                />
                {pickedPart.isNew && (
                  <input
                    type="text"
                    value={pickedPart.code || ''}
                    onChange={(e) =>
                      setPickedPart((p) => ({ ...p, code: e.target.value.toUpperCase() }))
                    }
                    placeholder="Part code e.g. BP, FH, FF"
                    className="mt-2 w-full h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
            )}

            {/* Quality — phone parts only */}
            {itemType === 'phone' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quality
                </label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {QUALITIES.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Color — phone parts only */}
            {itemType === 'phone' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Color (optional)
                </label>
                <SmartCombobox
                  options={colorOptions}
                  value={
                    pickedColor.id
                      ? String(pickedColor.id)
                      : pickedColor.isNew
                      ? `__new__${pickedColor.label}`
                      : null
                  }
                  onValueChange={(v, label, isNew) =>
                    setPickedColor({ id: isNew ? null : Number(v), label, isNew })
                  }
                  placeholder="Type or select color..."
                  allowCreate={true}
                />
              </div>
            )}

            {/* General item name — general only */}
            {itemType === 'general' && (
              <div className="col-span-1 sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Item Name (optional)
                </label>
                <input
                  type="text"
                  value={generalName}
                  onChange={(e) => setGeneralName(e.target.value)}
                  placeholder="e.g. Soldering Iron 60W, Cleaning Cloth Pack"
                  className="w-full h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {/* Live SKU */}
            <div className="col-span-1 sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Generated SKU
              </label>
              <div className="w-full h-9 px-3 flex items-center text-sm font-mono bg-gray-100 border border-gray-300 rounded text-gray-800">
                {liveSku || (
                  <span className="text-gray-400">
                    {itemType === 'phone'
                      ? 'Fill part to generate (brand/model optional)'
                      : 'Fill category (and optionally brand/model/name) to generate'}
                  </span>
                )}
              </div>
            </div>

            <div className="col-span-1 sm:col-span-2 text-xs text-gray-500 italic">
              Cost price and selling price are updated automatically when the item is purchased or sold.
            </div>

          </div>

          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={saveItem}
              disabled={saving}
              className="h-9 px-6 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Plus className="size-4" />
              {saving ? 'Saving...' : 'Save Item'}
            </button>
            <button
              onClick={resetForm}
              className="h-9 px-4 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-2"
            >
              <X className="size-4" />
              Clear
            </button>
            {message && <div className="text-sm text-gray-700">{message}</div>}
          </div>
        </div>

        {/* ============ TABLE ============ */}
        <div className="bg-white border border-gray-300 rounded shadow-sm">

          <div className="px-4 py-3 bg-gray-50 border-b border-gray-300 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <span className="text-sm font-semibold text-gray-700">
              Items {totalCount > 0 && <span className="text-gray-500">({totalCount})</span>}
            </span>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search SKU (2+ chars)..."
                  className="h-9 pl-9 pr-3 text-sm border border-gray-300 rounded w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <select
                value={brandFilter}
                onChange={(e) => {
                  setBrandFilter(e.target.value)
                  setPage(0)
                }}
                className="h-9 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="All">All Brands</option>
                {brands.map((b) => (
                  <option key={b.brand_id} value={b.brand_id}>
                    {b.brand_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">ID</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">SKU</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Type</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Brand</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Model</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Part / Category</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Quality</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Color</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Stock</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Cost</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Sell</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody>
                {itemsLoading ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-sm text-gray-400">
                      Loading...
                    </td>
                  </tr>
                ) : visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-sm text-gray-400">
                      No items match the current filters.
                    </td>
                  </tr>
                ) : (
                  visibleItems.map((it) => (
                    <tr key={it.item_id} className="hover:bg-gray-50">
                      <td className="border-b border-gray-200 px-3 py-2 text-gray-600">{it.item_id}</td>
                      <td className="border-b border-gray-200 px-3 py-2 font-mono text-gray-800">{it.sku}</td>
                      <td className="border-b border-gray-200 px-3 py-2 text-xs">
                        {it.is_phone_part === false ? (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">General</span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded">Phone</span>
                        )}
                      </td>
                      <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{brandName(it.brand_id)}</td>
                      <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{modelName(it.model_id)}</td>
                      <td className="border-b border-gray-200 px-3 py-2 text-gray-800">
                        {it.is_phone_part === false ? categoryName(it.category_id) : partName(it.part_id)}
                      </td>
                      <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{it.quality}</td>
                      <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{it.color || '—'}</td>
                      <td className="border-b border-gray-200 px-3 py-2 text-right font-medium text-gray-800">{it.current_stock}</td>
                      <td className="border-b border-gray-200 px-3 py-2 text-right text-gray-800">
                        {it.cost_price != null ? `₹ ${Number(it.cost_price).toFixed(2)}` : '—'}
                      </td>
                      <td className="border-b border-gray-200 px-3 py-2 text-right text-gray-800">
                        {it.selling_price != null ? `₹ ${Number(it.selling_price).toFixed(2)}` : '—'}
                      </td>
                      <td className="border-b border-gray-200 px-3 py-2">
                        <button
                          onClick={() => deleteItem(it.item_id, it.sku)}
                          className="text-xs font-medium text-red-600 hover:text-red-800 flex items-center gap-1"
                        >
                          <Trash2 className="size-3" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 bg-gray-50 border-t border-gray-300 flex items-center justify-between text-sm">
            <span className="text-gray-600">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || itemsLoading}
                className="h-8 px-3 text-xs font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 flex items-center gap-1"
              >
                <ChevronLeft className="size-3.5" />
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || itemsLoading}
                className="h-8 px-3 text-xs font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 flex items-center gap-1"
              >
                Next
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}