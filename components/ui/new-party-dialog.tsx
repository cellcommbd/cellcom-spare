'use client'

import * as React from 'react'
import { supabase } from '@/lib/supabase'
import { X, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

type PartyType = 'Customer' | 'Supplier'

type CreatedParty = {
  party_id: number
  party_name: string
  party_type: PartyType
  current_balance: number
  phone: string | null
  purchase_prefix: string | null
}

type NewPartyDialogProps = {
  open: boolean
  initialName: string
  partyType: PartyType
  onClose: () => void
  onCreated: (party: CreatedParty) => void
}

function toTitleCase(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      if (!word) return word
      // Preserve certain all-caps tokens
      const special = ['M/S', 'MR', 'MRS', 'DR', 'S/O', 'D/O', 'W/O']
      if (special.includes(word.toUpperCase())) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

export function NewPartyDialog({
  open,
  initialName,
  partyType,
  onClose,
  onCreated,
}: NewPartyDialogProps) {
  const [name, setName] = React.useState('')
  const [checking, setChecking] = React.useState(false)
  const [duplicate, setDuplicate] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const [success, setSuccess] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setName(initialName || '')
      setDuplicate(null)
      setError('')
      setSuccess(false)
      setChecking(false)
      setSaving(false)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    }
  }, [open, initialName])

  // Debounced duplicate check
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = name.trim()
    if (!trimmed) {
      setDuplicate(null)
      setChecking(false)
      return
    }

    setChecking(true)
    debounceRef.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from('parties')
        .select('party_id, party_name')
        .eq('party_type', partyType)
        .ilike('party_name', trimmed)
        .limit(1)

      // Fallback to LOWER/TRIM comparison since ILIKE doesn't trim
      if (error || !data || data.length === 0) {
        // Second check with exact lowercase match
        const { data: data2 } = await supabase
          .from('parties')
          .select('party_id, party_name')
          .eq('party_type', partyType)
          .ilike('party_name', trimmed)
          .limit(5)

        const exact = (data2 || []).find(
          (p) =>
            p.party_name.trim().toLowerCase() === trimmed.toLowerCase()
        )
        if (exact) {
          setDuplicate(exact.party_name)
        } else {
          setDuplicate(null)
        }
      } else {
        const exact = data.find(
          (p) =>
            p.party_name.trim().toLowerCase() === trimmed.toLowerCase()
        )
        setDuplicate(exact ? exact.party_name : null)
      }
      setChecking(false)
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [name, open, partyType])

  async function handleSave() {
    setError('')

    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name cannot be empty.')
      return
    }

    if (duplicate) {
      setError('This name already exists. Add a differentiator.')
      return
    }

    const titleCased = toTitleCase(trimmed)

    // Final duplicate check right before insert (race-condition safe-ish)
    const { data: existing } = await supabase
      .from('parties')
      .select('party_id, party_name')
      .eq('party_type', partyType)
      .ilike('party_name', titleCased)
      .limit(5)

    const stillDupe = (existing || []).find(
      (p) =>
        p.party_name.trim().toLowerCase() === titleCased.toLowerCase()
    )
    if (stillDupe) {
      setDuplicate(stillDupe.party_name)
      setError('This name already exists.')
      return
    }

    setSaving(true)

    const { data, error: insertErr } = await supabase
      .from('parties')
      .insert({
        party_name: titleCased,
        party_type: partyType,
        current_balance: 0,
      })
      .select()
      .single()

    setSaving(false)

    if (insertErr || !data) {
      setError('Could not save: ' + (insertErr?.message || 'unknown error'))
      return
    }

    setSuccess(true)

    // Give the success state a moment to render, then notify parent
    setTimeout(() => {
      onCreated(data as CreatedParty)
    }, 400)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!saving && !duplicate && name.trim()) {
        handleSave()
      }
    }
    if (e.key === 'Escape') {
      if (!saving) onClose()
    }
  }

  if (!open) return null

  const canSave = !saving && !duplicate && name.trim().length > 0

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            Add new {partyType === 'Customer' ? 'customer' : 'supplier'}
          </h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={saving || success}
              placeholder={
                partyType === 'Customer'
                  ? 'e.g. Ramu Kirana'
                  : 'e.g. RealGold Traders'
              }
              className="w-full h-11 px-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
            />

            {/* Status line */}
            <div className="mt-2 min-h-[20px]">
              {checking && (
                <div className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Checking…
                </div>
              )}
              {!checking && duplicate && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    <strong>&ldquo;{duplicate}&rdquo;</strong> already exists.
                    Add an area, shop number, or differentiator.
                  </span>
                </div>
              )}
              {!checking && !duplicate && name.trim() && (
                <div className="text-xs text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Looks good — will save as &ldquo;{toTitleCase(name.trim())}&rdquo;
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {success && (
            <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Saved — added as new {partyType.toLowerCase()}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 h-10 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || success}
            className="flex-1 h-10 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : success ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Added
              </>
            ) : (
              'Add'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}