'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Plus, Trash2, Pencil, Save, X, Search } from 'lucide-react'

// ---------- Types ----------
type Brand = {
  brand_id: number
  brand_name: string
  brand_code: string
  item_count?: number
}

// ---------- Component ----------
export default function BrandEntry() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [search, setSearch] = useState('')

  // Add form
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [adding, setAdding] = useState(false)

  // Edit
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // ---------- Load ----------
  useEffect(() => {
    loadBrands()
  }, [])

  async function loadBrands() {
    const { data: brandRows, error } = await supabase
      .from('brands')
      .select('*')
      .order('brand_name')

    if (error) {
      setMessage('Error loading: ' + error.message)
      return
    }

    // Fetch item counts per brand
    const { data: itemRows } = await supabase
      .from('items')
      .select('brand_id')

    const counts: Record<number, number> = {}
    for (const it of itemRows || []) {
      if (it.brand_id) counts[it.brand_id] = (counts[it.brand_id] || 0) + 1
    }

    setBrands(
      (brandRows || []).map((b) => ({
        ...b,
        item_count: counts[b.brand_id] || 0,
      }))
    )
  }

  // ---------- Add ----------
  async function addBrand() {
    setMessage('')
    if (!newName.trim()) {
      setMessage('Brand name is required.')
      return
    }
    const code = (newCode.trim() || newName.trim().slice(0, 3)).toUpperCase()
    if (code.length < 2 || code.length > 4) {
      setMessage('Brand code must be 2-4 letters.')
      return
    }

    setAdding(true)
    const { error } = await supabase
      .from('brands')
      .insert({ brand_name: newName.trim(), brand_code: code })

    if (error) {
      setMessage('Add error: ' + error.message)
    } else {
      setMessage(`Added "${newName.trim()}"`)
      setNewName('')
      setNewCode('')
      await loadBrands()
    }
    setAdding(false)
  }

  // ---------- Edit ----------
  function startEdit(b: Brand) {
    setEditingId(b.brand_id)
    setEditName(b.brand_name)
    setEditCode(b.brand_code)
    setMessage('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
    setEditCode('')
  }

  async function saveEdit() {
    if (!editingId) return
    if (!editName.trim()) {
      setMessage('Brand name is required.')
      return
    }
    const code = editCode.trim().toUpperCase()
    if (code.length < 2 || code.length > 4) {
      setMessage('Brand code must be 2-4 letters.')
      return
    }

    setSaving(true)
    const { error } = await supabase
      .from('brands')
      .update({ brand_name: editName.trim(), brand_code: code })
      .eq('brand_id', editingId)

    if (error) {
      setMessage('Update error: ' + error.message)
    } else {
      setMessage('Updated successfully.')
      cancelEdit()
      await loadBrands()
    }
    setSaving(false)
  }

  // ---------- Delete ----------
  async function deleteBrand(b: Brand) {
    if ((b.item_count ?? 0) > 0) {
      setMessage(
        `Cannot delete "${b.brand_name}" — ${b.item_count} item(s) use this brand.`
      )
      return
    }
    if (!confirm(`Delete brand "${b.brand_name}"?`)) return

    const { error } = await supabase
      .from('brands')
      .delete()
      .eq('brand_id', b.brand_id)

    if (error) setMessage('Delete error: ' + error.message)
    else {
      setMessage('Deleted: ' + b.brand_name)
      await loadBrands()
    }
  }

  // ---------- Filter ----------
  const visible = brands.filter((b) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      b.brand_name.toLowerCase().includes(q) ||
      b.brand_code.toLowerCase().includes(q)
    )
  })

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Brand Management</h1>
          <p className="text-sm text-gray-500">
            Every product belongs to a brand. Code is used in the SKU (e.g. SAM for Samsung).
          </p>
        </div>

        {/* ADD NEW BRAND BAR */}
        <div className="bg-white border border-gray-300 rounded p-4 mb-4 shadow-sm">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Brand Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value)
                  // Auto-suggest code if empty
                  if (!newCode) {
                    setNewCode(e.target.value.slice(0, 3).toUpperCase())
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addBrand()
                }}
                placeholder="e.g. Samsung"
                className="w-full h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            <div className="w-32">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Code
              </label>
              <input
                type="text"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addBrand()
                }}
                placeholder="SAM"
                maxLength={4}
                className="w-full h-9 px-3 text-sm font-mono border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
              />
            </div>

            <button
              onClick={addBrand}
              disabled={adding}
              className="h-9 px-5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Plus className="size-4" />
              {adding ? 'Adding...' : 'Add Brand'}
            </button>
          </div>

          {message && (
            <div className="mt-3 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2">
              {message}
            </div>
          )}
        </div>

        {/* BRAND LIST */}
        <div className="bg-white border border-gray-300 rounded shadow-sm">

          <div className="px-4 py-3 bg-gray-50 border-b border-gray-300 flex items-center justify-between gap-4">
            <span className="text-sm font-semibold text-gray-700">
              Brands ({visible.length}{search && ` of ${brands.length}`})
            </span>
            <div className="relative">
              <Search className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or code..."
                className="h-8 pl-8 pr-3 text-sm border border-gray-300 rounded w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="w-16 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">ID</th>
                <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Brand Name</th>
                <th className="w-24 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Code</th>
                <th className="w-24 border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Items</th>
                <th className="w-40 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-400">
                    {search
                      ? `No brands match "${search}"`
                      : 'No brands yet. Add one above.'}
                  </td>
                </tr>
              ) : (
                visible.map((b) => {
                  const isEditing = editingId === b.brand_id
                  return (
                    <tr key={b.brand_id} className="hover:bg-gray-50">
                      <td className="border-b border-gray-200 px-3 py-2 text-gray-600">
                        {b.brand_id}
                      </td>

                      <td className="border-b border-gray-200 px-3 py-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit()
                              if (e.key === 'Escape') cancelEdit()
                            }}
                            className="w-full h-8 px-2 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            autoFocus
                          />
                        ) : (
                          <span className="text-gray-800 font-medium">{b.brand_name}</span>
                        )}
                      </td>

                      <td className="border-b border-gray-200 px-3 py-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editCode}
                            onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                            maxLength={4}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit()
                              if (e.key === 'Escape') cancelEdit()
                            }}
                            className="w-full h-8 px-2 text-sm font-mono border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                          />
                        ) : (
                          <span className="font-mono text-gray-700 bg-gray-100 px-2 py-0.5 rounded text-xs">
                            {b.brand_code}
                          </span>
                        )}
                      </td>

                      <td className="border-b border-gray-200 px-3 py-2 text-right">
                        <span
                          className={`text-xs ${
                            (b.item_count ?? 0) > 0
                              ? 'text-green-700 font-medium'
                              : 'text-gray-400'
                          }`}
                        >
                          {b.item_count ?? 0}
                        </span>
                      </td>

                      <td className="border-b border-gray-200 px-3 py-2">
                        {isEditing ? (
                          <div className="flex gap-3">
                            <button
                              onClick={saveEdit}
                              disabled={saving}
                              className="text-xs font-medium text-green-700 hover:text-green-900 flex items-center gap-1"
                            >
                              <Save className="size-3" />
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-xs font-medium text-gray-600 hover:text-gray-800 flex items-center gap-1"
                            >
                              <X className="size-3" />
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <button
                              onClick={() => startEdit(b)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                              <Pencil className="size-3" />
                              Edit
                            </button>
                            <button
                              onClick={() => deleteBrand(b)}
                              className="text-xs font-medium text-red-600 hover:text-red-800 flex items-center gap-1"
                            >
                              <Trash2 className="size-3" />
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}