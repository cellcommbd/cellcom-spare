'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getPins, setRole, getRole } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (getRole()) router.replace('/')
    else setChecking(false)
  }, [router])

  async function handleLogin() {
    setError('')
    setLoading(true)
    try {
      const pins = await getPins()

      const entered = pin.trim()
      if (entered === String(pins.staff_pin).trim()) {
        setRole('staff', pins.pin_version)
        router.replace('/')
        return
      }
      if (entered === String(pins.owner_pin).trim()) {
        setRole('owner', pins.pin_version)
        router.replace('/')
        return
      }
      setError('Incorrect PIN')
      setPin('')
    } catch (e: any) {
      setError('Could not verify PIN. Check your internet.')
    } finally {
      setLoading(false)
    }
  }

  if (checking) return null

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-7 h-7"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">
            Cellcom Spare ERP
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Enter your PIN to continue
          </p>
        </div>

        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleLogin()
          }}
          placeholder="• • • •"
          maxLength={8}
          autoFocus
          className="w-full h-14 px-4 text-center text-2xl tracking-widest bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
        />

        {error && (
          <div className="mt-3 text-sm text-red-600 text-center font-medium">
            {error}
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full mt-5 h-12 text-base font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-sm hover:shadow transition-all disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Login'}
        </button>
      </div>
    </div>
  )
}