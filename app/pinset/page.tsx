'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { getRole } from '../../lib/auth'
import { Save, ShieldCheck, X, Eye, EyeOff } from 'lucide-react'

export default function PinSetPage() {
  const router = useRouter()
  const [staffPin, setStaffPin] = useState('')
  const [ownerPin, setOwnerPin] = useState('')
  const [showStaff, setShowStaff] = useState(false)
  const [showOwner, setShowOwner] = useState(false)
  const [confirmChange, setConfirmChange] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    // Only owner can access
    const role = getRole()
    if (role !== 'owner') {
      router.replace('/login')
      return
    }
    loadPins()
  }, [router])

  async function loadPins() {
    setLoading(true)
    const { data } = await supabase.from('settings').select('key, value')

    const map: Record<string, string> = {}
    for (const r of (data as any[]) || []) map[r.key] = r.value
    setStaffPin(map['staff_pin'] || '')
    setOwnerPin(map['owner_pin'] || '')
    setLoading(false)
  }

  async function savePins() {
    setError('')
    setMessage('')

    if (staffPin.length < 4 || ownerPin.length < 4) {
      setError('PINs must be at least 4 digits.')
      return
    }
    if (staffPin === ownerPin) {
      setError('Staff PIN and Owner PIN must be different.')
      return
    }

    setSaving(true)

    // Get current pin_version
    const { data: versionRow } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'pin_version')
      .single()

    const currentVersion = parseInt(
      (versionRow as any)?.value || '1',
      10
    )
    const newVersion = String(currentVersion + 1)

    // Update all three settings
    const { error: updError } = await supabase.from('settings').upsert([
      { key: 'staff_pin', value: staffPin },
      { key: 'owner_pin', value: ownerPin },
      { key: 'pin_version', value: newVersion },
    ])

    if (updError) {
      setError('Save error: ' + updError.message)
      setSaving(false)
      return
    }

    setMessage(
      `PINs updated. All users must re-login. New version: ${newVersion}`
    )
    setSaving(false)
    setConfirmChange(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">

        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 mb-4">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Change PINs</h1>
          <p className="text-sm text-slate-500 mt-1">
            Admin only — all users will be logged out after saving
          </p>
        </div>

        <div className="space-y-4">
          {/* Staff PIN */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Staff PIN
            </label>
            <div className="relative">
              <input
                type={showStaff ? 'text' : 'password'}
                value={staffPin}
                onChange={(e) =>
                  setStaffPin(e.target.value.replace(/\D/g, ''))
                }
                maxLength={8}
                inputMode="numeric"
                className="w-full h-12 px-4 pr-12 text-center text-xl tracking-widest font-mono bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowStaff(!showStaff)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showStaff ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Owner PIN */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Owner PIN
            </label>
            <div className="relative">
              <input
                type={showOwner ? 'text' : 'password'}
                value={ownerPin}
                onChange={(e) =>
                  setOwnerPin(e.target.value.replace(/\D/g, ''))
                }
                maxLength={8}
                inputMode="numeric"
                className="w-full h-12 px-4 pr-12 text-center text-xl tracking-widest font-mono bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowOwner(!showOwner)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showOwner ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 px-3 py-2 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg">
            {error}
          </div>
        )}
        {message && (
          <div className="mt-4 px-3 py-2 text-sm bg-green-50 border border-green-200 text-green-700 rounded-lg">
            {message}
          </div>
        )}

        {!confirmChange ? (
          <button
            onClick={() => setConfirmChange(true)}
            className="w-full mt-6 h-12 text-base font-semibold text-white bg-amber-600 rounded-xl hover:bg-amber-700 shadow-sm"
          >
            Change PINs
          </button>
        ) : (
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="text-sm font-medium text-amber-900 mb-3">
              ⚠️ This will log out ALL users immediately. Continue?
            </div>
            <div className="flex gap-2">
              <button
                onClick={savePins}
                disabled={saving}
                className="flex-1 h-10 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Yes, save'}
              </button>
              <button
                onClick={() => setConfirmChange(false)}
                className="flex-1 h-10 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center justify-center gap-2"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 text-xs text-slate-400 text-center">
          Staff and Owner PINs are stored in the settings table
        </div>
      </div>
    </div>
  )
}