'use client'

import { supabase } from './supabase'

export type Role = 'staff' | 'owner' | null

const ROLE_KEY = 'cellcom_role'
const VERSION_KEY = 'cellcom_pin_version'

export type Pins = {
  staff_pin: string
  owner_pin: string
  pin_version: string
}

// ---------- Local storage ----------
export function getRole(): Role {
  if (typeof window === 'undefined') return null
  const r = localStorage.getItem(ROLE_KEY)
  if (r === 'staff' || r === 'owner') return r
  return null
}

export function setRole(role: Role, pinVersion: string): void {
  if (typeof window === 'undefined') return
  if (role === null) {
    localStorage.removeItem(ROLE_KEY)
    localStorage.removeItem(VERSION_KEY)
  } else {
    localStorage.setItem(ROLE_KEY, role)
    localStorage.setItem(VERSION_KEY, pinVersion)
  }
}

export function clearRole(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(VERSION_KEY)
}

export function isOwner(): boolean {
  return getRole() === 'owner'
}

export function getStoredPinVersion(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(VERSION_KEY)
}

// ---------- DB ----------
export async function getPins(): Promise<Pins> {
  const { data, error } = await supabase.from('settings').select('key, value')

  if (error || !data) {
    return { staff_pin: '1234', owner_pin: '9999', pin_version: '1' }
  }

  const map: Record<string, string> = {}
  for (const row of data as any[]) {
    map[row.key] = row.value
  }

  return {
    staff_pin: map['staff_pin'] ?? '1234',
    owner_pin: map['owner_pin'] ?? '9999',
    pin_version: map['pin_version'] ?? '1',
  }
}

// ---------- Session validation ----------
export async function validateSession(): Promise<boolean> {
  const role = getRole()
  if (!role) return false

  try {
    // Fetch current version from DB with a timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'pin_version')
      .maybeSingle()

    clearTimeout(timeout)

    // Network error or no data → KEEP session alive (don't logout)
    if (error || !data) return true

    const currentVersion = String((data as any).value)
    const stored = getStoredPinVersion()

    // Only logout if we SUCCESSFULLY fetched version AND it differs
    if (stored && stored !== currentVersion) {
      clearRole()
      return false
    }
    return true
  } catch {
    // Any exception (network drop, timeout, etc.) → keep session alive
    return true
  }
}