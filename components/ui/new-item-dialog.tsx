'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SmartCombobox } from './smart-combobox'
import { X, Save, Package, AlertTriangle, ExternalLink } from 'lucide-react'

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

type Picked = {
  id: number | null
  label: string
  isNew: boolean
  code?: string
}

type ItemType = 'phone' | 'general'

type Props = {
  open: boolean
  onClose: () => void
  initialText?: string
  onCreated: (item: {
    item_id: number
    sku: string
    is_phone_part: boolean
  }) => void
}

const NETWORKS = ['N/A', '4G', '5G']
const QUALITIES = ['Normal', 'OG', '100 OG', 'Care OG', 'China OG']

export function NewItemDialog({
  open,
  onClose,
  initialText = '',
  onCreated,
}: Props) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [partTypes, setPartTypes] = useState<PartType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [models, setModels] = useState<Model[]>([])

  const [itemType, setItemType] = useState<ItemType>('phone')

  const [pickedBrand, setPickedBrand] = useState<Picked>({ id: null, label: '', isNew: false })
  const [pickedModel, setPickedModel] = useState<Picked>({ id: null, label: '', isNew: false })
  const [pickedPart, setPickedPart] = useState<Picked>({ id: null, label: '', isNew: false })
  const [pickedCategory, setPickedCategory] = useState<Picked>({ id: null, label: '', isNew: false })

  const [generalName, setGeneralName] = useState('')
  const [network, setNetwork] = useState('N/A')
  const [quality, setQuality] = useState('Normal')

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // Load master data + reset when dialog opens
  useEffect(() => {
    if (!open) return
    loadMaster()

    const trimmed = initialText.trim()

    if (!trimmed) {
      setPickedBrand({ id: null, label: '', isNew: false })
      setPickedModel({ id: null, label: '', isNew: false })
      setPickedPart({ id: null, label: '', isNew: false })
      setPickedCategory({ id: null, label: '', isNew: false })
      setGeneralName('')
      setNetwork('N/A')
      setQuality('Normal')
      setItemType('phone')
      setMessage('')
      return
    }

    // Split the typed text on dashes and distribute into brand / model / part
    const tokens = trimmed
      .split('-')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)

    if (tokens.length === 1) {
      // Only part
      setPickedBrand({ id: null, label: '', isNew: false })
      setPickedModel({ id: null, label: '', isNew: false })
      setPickedPart({ id: null, label: tokens[0], isNew: true, code: tokens[0] })
    } else if (tokens.length === 2) {
      // Brand + Part
      setPickedBrand({ id: null, label: tokens[0], isNew: true, code: tokens[0] })
      setPickedModel({ id: null, label: '', isNew: false })
      setPickedPart({ id: null, label: tokens[1], isNew: true, code: tokens[1] })
    } else {
      // Brand + Model... + Part
      const first = tokens[0]
      const last = tokens[tokens.length - 1]
      const middle = tokens.slice(1, -1).join('-')
      setPickedBrand({ id: null, label: first, isNew: true, code: first })
      setPickedModel({ id: null, label: middle, isNew: true })
      setPickedPart({ id: null, label: last, isNew: true, code: last })
    }

    setPickedCategory({ id: null, label: '', isNew: false })
    setGeneralName('')
    setNetwork('N/A')
    setQuality('Normal')
    setItemType('phone')
    setMessage('')
  }, [open, initialText])

  // Load models whenever brand changes
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

  // Combobox options
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

  // Live SKU preview
  const liveSku = useMemo(() => {
    if (itemType === 'phone') {
      const brandCode = pickedBrand.isNew
        ? (pickedBrand.code || pickedBrand.label.slice(0, 3))
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
        : brands.find((b) => b.brand_id === pickedBrand.id)?.brand_code || ''

      const modelName = pickedModel.label
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')

      const partCode = pickedPart.isNew
        ? (pickedPart.code || pickedPart.label.slice(0, 4))
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
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

    const catCode =
      categories.find((c) => c.category_id === pickedCategory.id)?.category_code || ''
    if (!catCode) return ''

    const brandCode = brands.find((b) => b.brand_id === pickedBrand.id)?.brand_code || ''
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

    const seg = [catCode]
    if (brandCode) seg.push(brandCode)
    if (modelName) seg.push(modelName)
    if (extraName) seg.push(extraName)

    return seg.join('-')
  }, [
    itemType, pickedBrand, pickedModel, pickedPart, pickedCategory,
    generalName, network, quality, brands, partTypes, categories,
  ])

  // ----- Ensure functions -----
  async function ensureBrand(): Promise<number | null> {
    if (pickedBrand.isNew && pickedBrand.label) {
      const code = (pickedBrand.code || pickedBrand.label.slice(0, 3))
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
      if (!code || code.length < 2) {
        setMessage('Brand code must be at least 2 characters.')
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
      if (!code || code.length < 2) {
        setMessage('Part code must be at least 2 characters.')
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
    async function save() {
    setMessage('')

    if (itemType === 'phone') {
      if (!pickedPart.label) return setMessage('Select or type a Part Type.')
      if (!liveSku) return setMessage('SKU could not be generated.')

      setSaving(true)
      const brandId = await ensureBrand()
      const modelId = await ensureModel(brandId)
      const partId = await ensurePart()
      if (!partId) { setSaving(false); return }

      const { data: existing } = await supabase
        .from('items')
        .select('item_id, sku, is_phone_part')
        .eq('sku', liveSku)
        .maybeSingle()

      if (existing) {
        onCreated({
          item_id: existing.item_id,
          sku: existing.sku,
          is_phone_part: existing.is_phone_part ?? true,
        })
        setSaving(false)
        return
      }

      const { data, error } = await supabase
        .from('items')
        .insert({
          sku: liveSku,
          brand_id: brandId,
          model_id: modelId,
          part_id: partId,
          category_id: null,
          is_phone_part: true,
          quality,
          color: null,
          cost_price: null,
          selling_price: null,
          current_stock: 0,
        })
        .select('item_id, sku, is_phone_part')
        .single()

      if (error || !data) {
        setMessage('Save error: ' + (error?.message || 'unknown'))
      } else {
        onCreated(data)
        onClose()
      }
      setSaving(false)
      return
    }

    // General item
    if (!pickedCategory.id) return setMessage('Select a Category.')
    if (!liveSku) return setMessage('SKU could not be generated.')

    setSaving(true)
    const brandId = pickedBrand.id || null
    const modelId = pickedModel.id || null
    const categoryId = pickedCategory.id

    const { data: existing } = await supabase
      .from('items')
      .select('item_id, sku, is_phone_part')
      .eq('sku', liveSku)
      .maybeSingle()

    if (existing) {
      onCreated({
        item_id: existing.item_id,
        sku: existing.sku,
        is_phone_part: existing.is_phone_part ?? false,
      })
      setSaving(false)
      return
    }

    const { data, error } = await supabase
      .from('items')
      .insert({
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
      .select('item_id, sku, is_phone_part')
      .single()

    if (error || !data) {
      setMessage('Save error: ' + (error?.message || 'unknown'))
    } else {
      onCreated(data)
      onClose()
    }
    setSaving(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-slate-800">Create New Item</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Type toggle */}
          <div className="flex flex-wrap gap-4 pb-3 border-b border-slate-200">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="radio"
                name="new-item-type"
                checked={itemType === 'phone'}
                onChange={() => setItemType('phone')}
                className="w-4 h-4"
              />
              <span className={`text-sm font-medium ${itemType === 'phone' ? 'text-blue-700' : 'text-slate-600'}`}>
                Phone Part
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="radio"
                name="new-item-type"
                checked={itemType === 'general'}
                onChange={() => setItemType('general')}
                className="w-4 h-4"
              />
              <span className={`text-sm font-medium ${itemType === 'general' ? 'text-blue-700' : 'text-slate-600'}`}>
                General Item
              </span>
            </label>
          </div>

          {/* Reference link tip */}
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2 flex-wrap">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
            <span>Not sure of a code? Click</span>
            <a
              href="/reference"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Browse all codes
            </a>
          </div>

          {/* Category (general only) */}
          {itemType === 'general' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
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

          {/* Brand */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Brand <span className="text-slate-400 text-xs">(optional — leave blank for generic / universal)</span>
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
              placeholder="Select or type brand..."
              allowCreate={true}
              showReferenceLink={true}
            />
            {pickedBrand.isNew && (
              <div className="mt-2 space-y-2">
                <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    New brand &ldquo;{pickedBrand.label}&rdquo; will be created. Confirm it isn&apos;t a duplicate.
                  </span>
                </div>
                <input
                  type="text"
                  value={pickedBrand.code || ''}
                  onChange={(e) =>
                    setPickedBrand((p) => ({
                      ...p,
                      code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                    }))
                  }
                  placeholder="Brand code (2-8 chars) e.g. SAM, HAKKO"
                  maxLength={8}
                  className="w-full h-9 px-3 text-sm font-mono border border-emerald-400 bg-emerald-50 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Model <span className="text-slate-400 text-xs">(optional — leave blank for universal parts)</span>
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
                  ? 'Select or type model (or leave blank)'
                  : 'Pick a brand first, or leave blank'
              }
              allowCreate={true}
              showReferenceLink={false}
            />
            {pickedModel.isNew && (
              <div className="mt-2 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  New model &ldquo;{pickedModel.label}&rdquo; will be created. Check it doesn&apos;t exist under a slightly different name.
                </span>
              </div>
            )}
          </div>

          {/* Part (phone only) */}
          {itemType === 'phone' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
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
                placeholder="Select or type part (e.g. Speaker Jali)"
                allowCreate={true}
                showReferenceLink={true}
              />
              {pickedPart.isNew && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      New part &ldquo;{pickedPart.label}&rdquo; will be created. Make sure the code isn&apos;t a duplicate of an existing one.
                    </span>
                  </div>
                  <input
                    type="text"
                    value={pickedPart.code || ''}
                    onChange={(e) =>
                      setPickedPart((p) => ({
                        ...p,
                        code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                      }))
                    }
                    placeholder="Part code e.g. SPKJ"
                    maxLength={12}
                    className="w-full h-9 px-3 text-sm font-mono border border-emerald-400 bg-emerald-50 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              )}
            </div>
          )}

          {/* Network + Quality (phone only) */}
          {itemType === 'phone' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Network
                </label>
                <select
                  value={network}
                  onChange={(e) => setNetwork(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-slate-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {NETWORKS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Quality
                </label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-slate-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {QUALITIES.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* General item extra name */}
          {itemType === 'general' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Item Name (optional)
              </label>
              <input
                type="text"
                value={generalName}
                onChange={(e) => setGeneralName(e.target.value)}
                placeholder="e.g. Soldering Iron 60W"
                className="w-full h-9 px-3 text-sm border border-slate-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* SKU preview */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              SKU
            </label>
            <div className="w-full min-h-9 px-3 py-2 flex items-center text-sm font-mono bg-slate-100 border border-slate-300 rounded text-slate-800 break-all">
              {liveSku || (
                <span className="text-slate-400">
                  Fill required fields to generate
                </span>
              )}
            </div>
          </div>

          {message && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-9 px-4 text-sm text-slate-700 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !liveSku}
            className="h-9 px-5 text-sm font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Save className="size-4" />
            {saving ? 'Creating...' : 'Create Item'}
          </button>
        </div>

      </div>
    </div>
  )
}