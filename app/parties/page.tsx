'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import {
  Plus,
  Search,
  X,
  Pencil,
  Trash2,
  Check,
  Phone,
  Store,
  Truck,
  Users,
  ChevronRight,
} from 'lucide-react'

type Party = {
  party_id: number
  party_name: string
  phone: string | null
  party_type: 'Customer' | 'Supplier'
  current_balance: number
}

type Filter = 'All' | 'Customer' | 'Supplier'

export default function PartyEntry() {
  const router = useRouter()

  const [partyName, setPartyName] = useState('')
  const [phone, setPhone] = useState('')
  const [partyType, setPartyType] = useState<'Customer' | 'Supplier'>('Customer')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageOk, setMessageOk] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const [parties, setParties] = useState<Party[]>([])
  const [filter, setFilter] = useState<Filter>('All')
  const [search, setSearch] = useState('')

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Party | null>(null)

  async function loadParties() {
    let query = supabase
      .from('parties')
      .select('*')
      .order('party_name', { ascending: true })

    if (filter !== 'All') {
      query = query.eq('party_type', filter)
    }

    const { data, error } = await query
    if (error) {
      setMessage('Error loading: ' + error.message)
      setMessageOk(false)
    } else {
      setParties((data as Party[]) || [])
    }
  }

  useEffect(() => {
    loadParties()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  async function saveParty() {
    const trimmed = partyName.trim()
    if (!trimmed) {
      setMessage('Please enter a party name.')
      setMessageOk(false)
      nameRef.current?.focus()
      return
    }

    setSaving(true)
    setMessage('')
    setMessageOk(false)

    const { error } = await supabase.from('parties').insert({
      party_name: trimmed,
      phone: phone.trim() || null,
      party_type: partyType,
      current_balance: 0,
    })

    setSaving(false)

    if (error) {
      setMessage('Error saving: ' + error.message)
      setMessageOk(false)
      return
    }

    setMessage('Saved: ' + trimmed)
    setMessageOk(true)
    setPartyName('')
    setPhone('')
    setPartyType('Customer')

    await loadParties()

    setTimeout(() => {
      nameRef.current?.focus()
    }, 50)

    setTimeout(() => {
      setMessage('')
      setMessageOk(false)
    }, 2000)
  }

  function handleAddKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!saving) saveParty()
    }
  }

  function startEdit(p: Party) {
    setEditingId(p.party_id)
    setEditData({ ...p })
    setMessage('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditData(null)
  }

  async function saveEdit() {
    if (!editData) return
    if (!editData.party_name.trim()) {
      setMessage('Party name cannot be empty.')
      setMessageOk(false)
      return
    }

    const { error } = await supabase
      .from('parties')
      .update({
        party_name: editData.party_name.trim(),
        phone: editData.phone?.trim() || null,
        party_type: editData.party_type,
        current_balance: Number(editData.current_balance) || 0,
      })
      .eq('party_id', editData.party_id)

    if (error) {
      setMessage('Error updating: ' + error.message)
      setMessageOk(false)
    } else {
      setMessage('Updated successfully.')
      setMessageOk(true)
      cancelEdit()
      await loadParties()
      setTimeout(() => {
        setMessage('')
        setMessageOk(false)
      }, 2000)
    }
  }

  async function deleteParty(id: number, name: string) {
    if (!confirm(`Delete party "${name}"?`)) return
    const { error } = await supabase
      .from('parties')
      .delete()
      .eq('party_id', id)
    if (error) {
      setMessage('Error deleting: ' + error.message)
      setMessageOk(false)
    } else {
      setMessage('Deleted: ' + name)
      setMessageOk(true)
      await loadParties()
      setTimeout(() => {
        setMessage('')
        setMessageOk(false)
      }, 2000)
    }
  }

  function openParty(id: number) {
    router.push(`/parties/${id}`)
  }

  const visibleParties = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = parties
    if (q) {
      list = list.filter(
        (p) =>
          p.party_name.toLowerCase().includes(q) ||
          (p.phone || '').includes(q)
      )
    }
    return [...list].sort((a, b) => {
      const ba = Number(a.current_balance || 0)
      const bb = Number(b.current_balance || 0)
      if (bb !== ba) return bb - ba
      return a.party_name.localeCompare(b.party_name)
    })
  }, [parties, search])

  const totalOutstanding = useMemo(
    () =>
      parties
        .filter((p) => p.party_type === 'Customer')
        .reduce((s, p) => s + Number(p.current_balance || 0), 0),
    [parties]
  )

  function balanceClass(n: number) {
    if (n > 0) return 'text-rose-600'
    if (n < 0) return 'text-emerald-600'
    return 'text-slate-500'
  }

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Parties
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Add customers and suppliers. Tap Open to view an account.
          </p>
        </div>

        {/* Add form */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Name
              </label>
              <input
                ref={nameRef}
                type="text"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                onKeyDown={handleAddKeyDown}
                placeholder="Shop 53 / Ramu Kirana"
                className="w-full h-11 px-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                autoComplete="off"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
                <Phone className="w-3 h-3" />
                Phone <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={handleAddKeyDown}
                placeholder="9876543210"
                className="w-full h-11 px-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoComplete="off"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Type
              </label>
              <select
                value={partyType}
                onChange={(e) =>
                  setPartyType(e.target.value as 'Customer' | 'Supplier')
                }
                className="w-full h-11 px-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="Customer">Customer (shop)</option>
                <option value="Supplier">Supplier</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-3">
            <button
              onClick={saveParty}
              disabled={saving}
              className="w-full sm:w-auto h-11 px-6 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save Party'}
            </button>
            {message && (
              <div
                className={`text-xs sm:text-sm px-3 py-2 rounded-lg ${
                  messageOk
                    ? 'text-emerald-800 bg-emerald-50 border border-emerald-200'
                    : 'text-red-800 bg-red-50 border border-red-200'
                }`}
              >
                {message}
              </div>
            )}
          </div>
        </div>

        {/* List card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">

          {/* Toolbar */}
          <div className="px-3 sm:px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-700 shrink-0">
                {visibleParties.length}{' '}
                {visibleParties.length === 1 ? 'party' : 'parties'}
              </div>
              {totalOutstanding > 0 && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5 shrink-0">
                  ₹{totalOutstanding.toFixed(0)} owed
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex-1 sm:flex-initial sm:w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full h-9 pl-8 pr-8 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Filter pills */}
          <div className="px-3 sm:px-4 py-2 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto">
            {(['All', 'Customer', 'Supplier'] as const).map((f) => {
              const active = filter === f
              const Icon =
                f === 'Customer' ? Store : f === 'Supplier' ? Truck : Users
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`h-8 px-3 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {f === 'All' ? 'All' : f === 'Customer' ? 'Customers' : 'Suppliers'}
                </button>
              )
            })}
          </div>

          {/* Empty state */}
          {visibleParties.length === 0 && (
            <div className="px-4 py-12 text-center">
              <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <div className="text-sm font-medium text-slate-600">
                {search ? 'No matches for "' + search + '"' : 'No parties yet.'}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {search
                  ? 'Try a different name or clear search.'
                  : 'Add one above to get started.'}
              </div>
            </div>
          )}

          {/* Mobile cards */}
          {visibleParties.length > 0 && (
            <div className="sm:hidden divide-y divide-slate-100">
              {visibleParties.map((p) => {
                const isEditing = editingId === p.party_id
                if (isEditing && editData) {
                  return (
                    <div key={p.party_id} className="p-3 space-y-2 bg-blue-50/40">
                      <input
                        type="text"
                        value={editData.party_name}
                        onChange={(e) =>
                          setEditData({ ...editData, party_name: e.target.value })
                        }
                        placeholder="Name"
                        className="w-full h-10 px-2 text-sm border border-blue-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="tel"
                        inputMode="numeric"
                        value={editData.phone || ''}
                        onChange={(e) =>
                          setEditData({ ...editData, phone: e.target.value })
                        }
                        placeholder="Phone"
                        className="w-full h-10 px-2 text-sm border border-blue-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={editData.party_type}
                          onChange={(e) =>
                            setEditData({
                              ...editData,
                              party_type: e.target.value as
                                | 'Customer'
                                | 'Supplier',
                            })
                          }
                          className="h-10 px-2 text-sm border border-blue-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                          <option value="Customer">Customer</option>
                          <option value="Supplier">Supplier</option>
                        </select>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={editData.current_balance}
                          onChange={(e) =>
                            setEditData({
                              ...editData,
                              current_balance:
                                parseFloat(e.target.value) || 0,
                            })
                          }
                          placeholder="Balance"
                          className="h-10 px-2 text-sm text-right border border-blue-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={saveEdit}
                          className="flex-1 h-10 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-1.5"
                        >
                          <Check className="w-4 h-4" />
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="h-10 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                }

                const bal = Number(p.current_balance || 0)
                return (
                  <div key={p.party_id} className="p-3">
                    {/* Info row */}
                    <div className="flex items-center gap-3 mb-2">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          p.party_type === 'Customer'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-orange-100 text-orange-700'
                        }`}
                      >
                        {p.party_type === 'Customer' ? (
                          <Store className="w-4 h-4" />
                        ) : (
                          <Truck className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {p.party_name}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {p.phone || p.party_type}
                        </div>
                      </div>
                      <div
                        className={`text-base font-bold shrink-0 ${balanceClass(
                          bal
                        )}`}
                      >
                        ₹{bal.toFixed(0)}
                      </div>
                    </div>

                    {/* Action pads */}
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => openParty(p.party_id)}
                        className="h-11 flex items-center justify-center gap-1 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:bg-blue-800"
                      >
                        Open
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => startEdit(p)}
                        className="h-11 flex items-center justify-center gap-1 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 active:bg-slate-300"
                      >
                        <Pencil className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => deleteParty(p.party_id, p.party_name)}
                        className="h-11 flex items-center justify-center gap-1 text-sm font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 active:bg-rose-200"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Desktop table */}
          {visibleParties.length > 0 && (
            <div className="hidden sm:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">
                      Name
                    </th>
                    <th className="w-40 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">
                      Phone
                    </th>
                    <th className="w-28 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600">
                      Type
                    </th>
                    <th className="w-32 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Balance
                    </th>
                    <th className="w-56 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleParties.map((p) => {
                    const isEditing = editingId === p.party_id
                    const bal = Number(p.current_balance || 0)

                    if (isEditing && editData) {
                      return (
                        <tr key={p.party_id} className="bg-blue-50/40">
                          <td className="border-b border-slate-100 px-3 py-2">
                            <input
                              type="text"
                              value={editData.party_name}
                              onChange={(e) =>
                                setEditData({
                                  ...editData,
                                  party_name: e.target.value,
                                })
                              }
                              className="w-full h-8 px-2 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <input
                              type="tel"
                              value={editData.phone || ''}
                              onChange={(e) =>
                                setEditData({
                                  ...editData,
                                  phone: e.target.value,
                                })
                              }
                              className="w-full h-8 px-2 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <select
                              value={editData.party_type}
                              onChange={(e) =>
                                setEditData({
                                  ...editData,
                                  party_type: e.target.value as
                                    | 'Customer'
                                    | 'Supplier',
                                })
                              }
                              className="w-full h-8 px-2 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            >
                              <option value="Customer">Customer</option>
                              <option value="Supplier">Supplier</option>
                            </select>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <input
                              type="number"
                              value={editData.current_balance}
                              onChange={(e) =>
                                setEditData({
                                  ...editData,
                                  current_balance:
                                    parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full h-8 px-2 text-sm text-right border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={saveEdit}
                                className="h-8 px-2.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="h-8 px-2.5 text-xs font-medium text-slate-700 border border-slate-300 rounded hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    return (
                      <tr key={p.party_id} className="hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-900">
                          {p.party_name}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-600">
                          {p.phone || '—'}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                              p.party_type === 'Customer'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-orange-100 text-orange-700'
                            }`}
                          >
                            {p.party_type}
                          </span>
                        </td>
                        <td
                          className={`border-b border-slate-100 px-3 py-2 text-sm text-right font-semibold ${balanceClass(
                            bal
                          )}`}
                        >
                          ₹ {bal.toFixed(2)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => openParty(p.party_id)}
                              className="h-8 px-2.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 flex items-center gap-1"
                            >
                              Open
                              <ChevronRight className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => startEdit(p)}
                              className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded"
                              aria-label="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteParty(p.party_id, p.party_name)}
                              className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded"
                              aria-label="Delete"
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
      </div>
    </div>
  )
}