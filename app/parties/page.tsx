'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

type Party = {
  party_id: number
  party_name: string
  phone: string | null
  party_type: 'Customer' | 'Supplier'
  current_balance: number
}

export default function PartyEntry() {
  const [partyName, setPartyName] = useState('')
  const [phone, setPhone] = useState('')
  const [partyType, setPartyType] = useState<'Customer' | 'Supplier'>('Customer')
  const [balance, setBalance] = useState('0')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [parties, setParties] = useState<Party[]>([])
  const [filter, setFilter] = useState<'All' | 'Customer' | 'Supplier'>('All')

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Party | null>(null)

  async function loadParties() {
    let query = supabase.from('parties').select('*').order('party_name', { ascending: true })

    if (filter !== 'All') {
      query = query.eq('party_type', filter)
    }

    const { data, error } = await query
    if (error) setMessage('Error loading: ' + error.message)
    else setParties(data || [])
  }

  useEffect(() => { loadParties() }, [filter])

  async function saveParty() {
    if (!partyName.trim()) {
      setMessage('Please enter a party name.')
      return
    }

    setSaving(true)
    setMessage('')

    const { error } = await supabase.from('parties').insert({
      party_name: partyName.trim(),
      phone: phone.trim() || null,
      party_type: partyType,
      current_balance: parseFloat(balance) || 0,
    })

    if (error) setMessage('Error saving: ' + error.message)
    else {
      setMessage('Saved: ' + partyName)
      setPartyName('')
      setPhone('')
      setPartyType('Customer')
      setBalance('0')
      await loadParties()
    }
    setSaving(false)
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

    if (error) setMessage('Error updating: ' + error.message)
    else {
      setMessage('Updated successfully.')
      cancelEdit()
      await loadParties()
    }
  }

  async function deleteParty(id: number, name: string) {
    if (!confirm(`Delete party "${name}"?`)) return
    const { error } = await supabase.from('parties').delete().eq('party_id', id)
    if (error) setMessage('Error deleting: ' + error.message)
    else {
      setMessage('Deleted: ' + name)
      await loadParties()
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-5xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Party Entry</h1>
          <p className="text-sm text-gray-500">Manage customers (shops) and suppliers</p>
        </div>

        <div className="bg-white border border-gray-300 rounded p-4 mb-6 shadow-sm">
          <div className="grid grid-cols-2 gap-4 mb-4">

            <div className="flex items-center gap-3">
              <label className="w-32 text-sm font-medium text-gray-700">Party Name:</label>
              <input
                type="text"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="e.g. Shop 53 or REAL GOLD"
                className="flex-1 h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 text-sm font-medium text-gray-700">Phone:</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 9876543210"
                className="flex-1 h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 text-sm font-medium text-gray-700">Type:</label>
              <select
                value={partyType}
                onChange={(e) => setPartyType(e.target.value as 'Customer' | 'Supplier')}
                className="flex-1 h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Customer">Customer (Shop)</option>
                <option value="Supplier">Supplier</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <label className="w-32 text-sm font-medium text-gray-700">Opening Balance:</label>
              <input
                type="number"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="0"
                className="flex-1 h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
              />
            </div>

          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={saveParty}
              disabled={saving}
              className="h-9 px-6 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Party'}
            </button>

            {message && (
              <div className="text-sm text-gray-700">{message}</div>
            )}
          </div>
        </div>

        <div className="bg-white border border-gray-300 rounded shadow-sm">

          <div className="px-4 py-2 bg-gray-50 border-b border-gray-300 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">
              Parties ({parties.length})
            </span>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Show:</span>
              {(['All', 'Customer', 'Supplier'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-3 py-1 rounded border ${
                    filter === f
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {f === 'All' ? 'All' : f + 's'}
                </button>
              ))}
            </div>
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="w-14 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">ID</th>
                <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Name</th>
                <th className="w-32 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Phone</th>
                <th className="w-24 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Type</th>
                <th className="w-28 border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Balance</th>
                <th className="w-40 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {parties.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-gray-400">
                    No parties found. Add one above.
                  </td>
                </tr>
              ) : (
                parties.map((p) => {
                  const isEditing = editingId === p.party_id
                  return (
                    <tr key={p.party_id} className="hover:bg-gray-50">
                      <td className="border-b border-gray-200 px-3 py-2 text-sm text-gray-600">{p.party_id}</td>

                      <td className="border-b border-gray-200 px-3 py-2 text-sm text-gray-800">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editData?.party_name || ''}
                            onChange={(e) => setEditData({ ...editData!, party_name: e.target.value })}
                            className="w-full h-8 px-2 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : p.party_name}
                      </td>

                      <td className="border-b border-gray-200 px-3 py-2 text-sm text-gray-800">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editData?.phone || ''}
                            onChange={(e) => setEditData({ ...editData!, phone: e.target.value })}
                            className="w-full h-8 px-2 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (p.phone || '—')}
                      </td>

                      <td className="border-b border-gray-200 px-3 py-2 text-sm">
                        {isEditing ? (
                          <select
                            value={editData?.party_type}
                            onChange={(e) => setEditData({ ...editData!, party_type: e.target.value as 'Customer' | 'Supplier' })}
                            className="w-full h-8 px-2 text-sm border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="Customer">Customer</option>
                            <option value="Supplier">Supplier</option>
                          </select>
                        ) : (
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            p.party_type === 'Customer'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-orange-100 text-orange-800'
                          }`}>
                            {p.party_type}
                          </span>
                        )}
                      </td>

                      <td className="border-b border-gray-200 px-3 py-2 text-sm text-right font-medium text-gray-800">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editData?.current_balance || 0}
                            onChange={(e) => setEditData({ ...editData!, current_balance: parseFloat(e.target.value) || 0 })}
                            className="w-full h-8 px-2 text-sm border border-blue-400 rounded text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <>₹ {Number(p.current_balance).toFixed(2)}</>
                        )}
                      </td>

                      <td className="border-b border-gray-200 px-3 py-2 text-sm">
                        {isEditing ? (
                          <div className="flex gap-3">
                            <button onClick={saveEdit} className="text-xs font-medium text-green-700 hover:text-green-900">Save</button>
                            <button onClick={cancelEdit} className="text-xs font-medium text-gray-600 hover:text-gray-800">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <button onClick={() => startEdit(p)} className="text-xs font-medium text-blue-600 hover:text-blue-800">Edit</button>
                            <button onClick={() => deleteParty(p.party_id, p.party_name)} className="text-xs font-medium text-red-600 hover:text-red-800">Delete</button>
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