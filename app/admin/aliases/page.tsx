'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getRole } from '../../../lib/auth'
import {
  ArrowLeft,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  Database,
} from 'lucide-react'

type TableConfig = {
  key: string
  label: string
  table: string
  sourceCol: string
  targetCol: string
  idCol: string
  extraCols?: { name: string; label: string }[]
  canonicalTable?: string
  canonicalKey?: string
}

const TABLES: TableConfig[] = [
  {
    key: 'parts',
    label: 'Parts',
    table: 'part_type_aliases',
    sourceCol: 'csv_text',
    targetCol: 'part_code',
    idCol: 'id',
    canonicalTable: 'part_types',
    canonicalKey: 'part_code',
  },
  {
    key: 'brands',
    label: 'Brands',
    table: 'brand_aliases',
    sourceCol: 'csv_code',
    targetCol: 'brand_code',
    idCol: 'id',
    canonicalTable: 'brands',
    canonicalKey: 'brand_code',
  },
  {
    key: 'colors',
    label: 'Colors',
    table: 'parser_color_aliases',
    sourceCol: 'csv_text',
    targetCol: 'color_value',
    idCol: 'csv_text',
  },
  {
    key: 'quality',
    label: 'Quality',
    table: 'quality_aliases',
    sourceCol: 'source_text',
    targetCol: 'target_quality',
    idCol: 'id',
    extraCols: [{ name: 'extra_flag', label: 'Extra Flag' }],
  },
  {
    key: 'flags',
    label: 'Flags',
    table: 'flag_aliases',
    sourceCol: 'source_text',
    targetCol: 'target_flag',
    idCol: 'id',
  },
  {
    key: 'variants',
    label: 'Variants',
    table: 'variant_aliases',
    sourceCol: 'source_text',
    targetCol: 'target_variant',
    idCol: 'id',
  },
  {
    key: 'typos',
    label: 'Typos',
    table: 'typo_rules',
    sourceCol: 'pattern',
    targetCol: 'replacement',
    idCol: 'id',
    extraCols: [
      { name: 'match_type', label: 'Match Type (word/phrase/regex)' },
      { name: 'priority', label: 'Priority (10=first, 100=default)' },
    ],
  },
]
type Row = Record<string, any>

export default function AliasesPage() {
  const router = useRouter()
  const [isOwner, setIsOwner] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('parts')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingRow, setEditingRow] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [orphanSet, setOrphanSet] = useState<Set<number>>(new Set())
  const [canonicalValues, setCanonicalValues] = useState<Set<string>>(new Set())

  const config = TABLES.find((t) => t.key === activeTab)!

  useEffect(() => {
    const role = getRole()
    if (role !== 'owner') {
      router.replace('/')
      return
    }
    setIsOwner(true)
    loadAllCounts()
  }, [router])

  useEffect(() => {
    if (isOwner) loadRows()
  }, [activeTab, isOwner])

  async function loadAllCounts() {
    const newCounts: Record<string, number> = {}
    for (const t of TABLES) {
      const { count } = await supabase
        .from(t.table)
        .select('*', { count: 'exact', head: true })
      newCounts[t.key] = count ?? 0
    }
    setCounts(newCounts)
  }

  async function loadRows() {
    setLoading(true)
    setMessage('')
    const { data, error } = await supabase
      .from(config.table)
      .select('*')
      .order(config.idCol, { ascending: true })
    if (error) {
      setMessage('Load failed: ' + error.message)
      setMessageType('error')
      setRows([])
      setLoading(false)
      return
    }
    const loaded = (data as Row[]) || []
    setRows(loaded)

    // Orphan detection
    if (config.canonicalTable && config.canonicalKey) {
      const { data: canon } = await supabase
        .from(config.canonicalTable)
        .select(config.canonicalKey)
      const validSet = new Set(
        ((canon as any[]) || []).map((r) => String(r[config.canonicalKey!]).toUpperCase())
      )
      setCanonicalValues(validSet)
      const orphans = new Set<number>()
      for (const r of loaded) {
        const target = String(r[config.targetCol] || '').toUpperCase()
        if (target && !validSet.has(target)) orphans.add(r.id)
      }
      setOrphanSet(orphans)
    } else {
      setCanonicalValues(new Set())
      setOrphanSet(new Set())
    }

    setLoading(false)
  }

  async function handleSave(formData: Row) {
    const payload: Row = {
      [config.sourceCol]: String(formData[config.sourceCol] || '').trim().toUpperCase(),
      [config.targetCol]: String(formData[config.targetCol] || '').trim(),
    }
    if (config.extraCols) {
      for (const col of config.extraCols) {
        const raw = formData[col.name]
        if (raw === undefined || raw === null || raw === '') {
          payload[col.name] = null
        } else if (col.name === 'priority') {
          const n = parseInt(String(raw), 10)
          payload[col.name] = isNaN(n) ? 100 : n
        } else {
          payload[col.name] = String(raw).trim()
        }
      }
    }

    if (!payload[config.sourceCol] || !payload[config.targetCol]) {
      setMessage('Source and target are required')
      setMessageType('error')
      return
    }

    let error
    if (editingRow) {
      const res = await supabase.from(config.table).update(payload).eq('id', editingRow.id)
      error = res.error
    } else {
      const res = await supabase.from(config.table).insert(payload)
      error = res.error
    }

    if (error) {
      setMessage('Save failed: ' + error.message)
      setMessageType('error')
      return
    }

    setMessage(editingRow ? 'Updated' : 'Added')
    setMessageType('success')
    setEditingRow(null)
    setAdding(false)
    await loadRows()
    await loadAllCounts()
  }

  async function handleDelete(row: Row) {
    if (!window.confirm(`Delete alias "${row[config.sourceCol]}"?`)) return
    const { error } = await supabase.from(config.table).delete().eq('id', row.id)
    if (error) {
      setMessage('Delete failed: ' + error.message)
      setMessageType('error')
      return
    }
    setMessage('Deleted')
    setMessageType('success')
    await loadRows()
    await loadAllCounts()
  }

  if (!isOwner) return null

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return (
      String(r[config.sourceCol] || '').toLowerCase().includes(s) ||
      String(r[config.targetCol] || '').toLowerCase().includes(s)
    )
  })

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5 flex items-center gap-3">
          <Link
            href="/admin"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Parser Aliases
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage alias mappings used by the CSV importer
            </p>
          </div>
        </div>

        {/* Summary bar */}
        <div className="mb-4 bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap gap-3 text-xs">
          {TABLES.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition ${
                activeTab === t.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Database className="w-3 h-3" />
              <span className="font-semibold">{t.label}</span>
              <span className={activeTab === t.key ? 'text-blue-100' : 'text-slate-500'}>
                {counts[t.key] ?? '—'}
              </span>
            </button>
          ))}
        </div>

        {message && (
          <div
            className={`mb-4 rounded-lg p-3 text-sm flex items-start gap-2 ${
              messageType === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            {messageType === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">{message}</div>
            <button onClick={() => setMessage('')} className="text-slate-500 hover:text-slate-800">
              ×
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${config.label.toLowerCase()}…`}
              className="w-full h-9 pl-8 pr-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => {
              setAdding(true)
              setEditingRow(null)
            }}
            className="h-9 px-3 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {/* Orphan warning */}
        {orphanSet.size > 0 && (
          <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {orphanSet.size} orphan alias{orphanSet.size === 1 ? '' : 'es'} — target code
            not in {config.canonicalTable}. Highlighted in red below.
          </div>
        )}

        {/* Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-8 text-center">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              {search ? 'No matches' : 'No aliases yet'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600 w-12">
                      ID
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">
                      Source
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">
                      Target
                    </th>
                    {config.extraCols?.map((c) => (
                      <th
                        key={c.name}
                        className="px-3 py-2 text-left font-semibold text-slate-600"
                      >
                        {c.label}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-semibold text-slate-600 w-20">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const isOrphan = orphanSet.has(r[config.idCol])
                    return (
                      <tr
                        key={r[config.idCol]}
                        className={`border-b border-slate-100 ${
                          isOrphan ? 'bg-rose-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="px-3 py-1.5 text-slate-500">{r[config.idCol]}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-800">
                          {r[config.sourceCol]}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-slate-800">
                          {r[config.targetCol]}
                        </td>
                        {config.extraCols?.map((c) => (
                          <td key={c.name} className="px-3 py-1.5 text-slate-600">
                            {r[c.name] || '—'}
                          </td>
                        ))}
                        <td className="px-3 py-1.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => {
                                setEditingRow(r)
                                setAdding(false)
                              }}
                              className="p-1 rounded hover:bg-slate-200 text-slate-500"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(r)}
                              className="p-1 rounded hover:bg-rose-100 text-rose-600"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {(adding || editingRow) && (
          <EditModal
            config={config}
            row={editingRow}
            onClose={() => {
              setAdding(false)
              setEditingRow(null)
            }}
            onSave={handleSave}
          />
        )}
      </div>
    </div>
  )
}

function EditModal({
  config,
  row,
  onClose,
  onSave,
}: {
  config: TableConfig
  row: Row | null
  onClose: () => void
  onSave: (data: Row) => void
}) {
  const [form, setForm] = useState<Row>(row || {})

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">
            {row ? 'Edit' : 'Add'} {config.label.slice(0, -1)}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Source (what appears in the invoice)
            </label>
            <input
              value={form[config.sourceCol] || ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, [config.sourceCol]: e.target.value }))
              }
              className="w-full h-9 px-2 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. OUT SIM TRY"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Target (canonical code)
            </label>
            <input
              value={form[config.targetCol] || ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, [config.targetCol]: e.target.value }))
              }
              className="w-full h-9 px-2 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. ST"
            />
          </div>
          {config.extraCols?.map((c) => (
            <div key={c.name}>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {c.label}
              </label>
              {c.name === 'match_type' ? (
                <select
                  value={form[c.name] || 'word'}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [c.name]: e.target.value }))
                  }
                  className="w-full h-9 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="word">word</option>
                  <option value="phrase">phrase</option>
                  <option value="regex">regex</option>
                </select>
              ) : c.name === 'priority' ? (
                <input
                  type="number"
                  value={form[c.name] ?? 100}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [c.name]: e.target.value }))
                  }
                  className="w-full h-9 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min={1}
                  max={200}
                />
              ) : (
                <input
                  value={form[c.name] || ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [c.name]: e.target.value }))
                  }
                  className="w-full h-9 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="h-9 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-white"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            className="h-9 px-4 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}