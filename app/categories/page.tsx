'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Plus, Trash2, Pencil, Save, X, Search } from 'lucide-react'

type Category = {
  category_id: number
  category_code: string
  category_name: string
  item_count?: number
}

export default function CategoryEntry() {
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')

  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [adding, setAdding] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadCategories()
  }, [])

  async function loadCategories() {
    const { data: catRows, error } = await supabase
      .from('categories')
      .select('*')
      .order('category_name')

    if (error) {
      setMessage('Error loading: ' + error.message)
      return
    }

    // Count items per category
    const { data: itemRows } = await supabase
      .from('items')
      .select('category_id')
      .eq('is_phone_part', false)

    const counts: Record<number, number> = {}
    for (const it of itemRows || []) {
      if (it.category_id) counts[it.category_id] = (counts[it.category_id] || 0) + 1
    }

    setCategories(
      (catRows || []).map((c) => ({
        ...c,
        item_count: counts[c.category_id] || 0,
      }))
    )
  }

  async function addCategory() {
    setMessage('')
    if (!newName.trim()) {
      setMessage('Category name is required.')
      return
    }
    const code = (newCode.trim() || newName.trim().slice(0, 6)).toUpperCase()
    if (!/^[A-Z0-9]+$/.test(code)) {
      setMessage('Category code must be A-Z and 0-9 only.')
      return
    }

    setAdding(true)
    const { error } = await supabase
      .from('categories')
      .insert({ category_name: newName.trim(), category_code: code })

    if (error) {
      setMessage('Add error: ' + error.message)
    } else {
      setMessage(`Added "${newName.trim()}"`)
      setNewName('')
      setNewCode('')
      await loadCategories()
    }
    setAdding(false)
  }

  function startEdit(c: Category) {
    setEditingId(c.category_id)
    setEditName(c.category_name)
    setEditCode(c.category_code)
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
      setMessage('Category name is required.')
      return
    }
    const code = editCode.trim().toUpperCase()
    if (!/^[A-Z0-9]+$/.test(code)) {
      setMessage('Category code must be A-Z and 0-9 only.')
      return
    }

    setSaving(true)
    const { error } = await supabase
      .from('categories')
      .update({ category_name: editName.trim(), category_code: code })
      .eq('category_id', editingId)

    if (error) {
      setMessage('Update error: ' + error.message)
    } else {
      setMessage('Updated successfully.')
      cancelEdit()
      await loadCategories()
    }
    setSaving(false)
  }

  async function deleteCategory(c: Category) {
    if ((c.item_count ?? 0) > 0) {
      setMessage(
        `Cannot delete "${c.category_name}" — ${c.item_count} item(s) use this category.`
      )
      return
    }
    if (!confirm(`Delete category "${c.category_name}"?`)) return

    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('category_id', c.category_id)

    if (error) setMessage('Delete error: ' + error.message)
    else {
      setMessage('Deleted: ' + c.category_name)
      await loadCategories()
    }
  }

  const visible = categories.filter((c) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      c.category_name.toLowerCase().includes(q) ||
      c.category_code.toLowerCase().includes(q)
    )
  })

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Category Management</h1>
          <p className="text-sm text-gray-500">
            Categories classify non-phone items like tools, cleaning supplies, and consumables.
            Code is used in the SKU for general items (e.g. TOOL, CLEANING).
          </p>
        </div>

        {/* ADD NEW BAR */}
        <div className="bg-white border border-gray-300 rounded p-4 mb-4 shadow-sm">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Category Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value)
                  if (!newCode) {
                    setNewCode(e.target.value.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCategory()
                }}
                placeholder="e.g. Cleaning"
                className="w-full h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            <div className="w-full sm:w-40">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Code
              </label>
              <input
                type="text"
                value={newCode}
                onChange={(e) =>
                  setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCategory()
                }}
                placeholder="CLEANING"
                maxLength={10}
                className="w-full h-9 px-3 text-sm font-mono border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
              />
            </div>

            <button
              onClick={addCategory}
              disabled={adding}
              className="h-9 px-5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 justify-center"
            >
              <Plus className="size-4" />
              {adding ? 'Adding...' : 'Add Category'}
            </button>
          </div>

          {message && (
            <div className="mt-3 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2">
              {message}
            </div>
          )}
        </div>

        {/* LIST */}
        <div className="bg-white border border-gray-300 rounded shadow-sm">

          <div className="px-4 py-3 bg-gray-50 border-b border-gray-300 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <span className="text-sm font-semibold text-gray-700">
              Categories ({visible.length}{search && ` of ${categories.length}`})
            </span>
            <div className="relative">
              <Search className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or code..."
                className="h-8 pl-8 pr-3 text-sm border border-gray-300 rounded w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="w-16 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">ID</th>
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Category Name</th>
                  <th className="w-32 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Code</th>
                  <th className="w-24 border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Items</th>
                  <th className="w-40 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-400">
                      {search
                        ? `No categories match "${search}"`
                        : 'No categories yet. Add one above.'}
                    </td>
                  </tr>
                ) : (
                  visible.map((c) => {
                    const isEditing = editingId === c.category_id
                    return (
                      <tr key={c.category_id} className="hover:bg-gray-50">
                        <td className="border-b border-gray-200 px-3 py-2 text-gray-600">
                          {c.category_id}
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
                            <span className="text-gray-800 font-medium">{c.category_name}</span>
                          )}
                        </td>

                        <td className="border-b border-gray-200 px-3 py-2">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editCode}
                              onChange={(e) =>
                                setEditCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                              }
                              maxLength={10}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit()
                                if (e.key === 'Escape') cancelEdit()
                              }}
                              className="w-full h-8 px-2 text-sm font-mono border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                            />
                          ) : (
                            <span className="font-mono text-gray-700 bg-gray-100 px-2 py-0.5 rounded text-xs">
                              {c.category_code}
                            </span>
                          )}
                        </td>

                        <td className="border-b border-gray-200 px-3 py-2 text-right">
                          <span
                            className={`text-xs ${
                              (c.item_count ?? 0) > 0
                                ? 'text-green-700 font-medium'
                                : 'text-gray-400'
                            }`}
                          >
                            {c.item_count ?? 0}
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
                                onClick={() => startEdit(c)}
                                className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                              >
                                <Pencil className="size-3" />
                                Edit
                              </button>
                              <button
                                onClick={() => deleteCategory(c)}
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
    </div>
  )
}