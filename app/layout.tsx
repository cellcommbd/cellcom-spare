'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { getRole, clearRole, validateSession, Role } from '../lib/auth'
import './globals.css'

const ownerNav = [
  { href: '/', label: 'Home' },
  { href: '/sales', label: 'Sales' },
  { href: '/returns', label: 'Sales Returns' },
  { href: '/purchase-returns', label: 'Purchase Returns' },
  { href: '/payments', label: 'Payments' },
  { href: '/purchases', label: 'Purchases' },
  { href: '/items', label: 'Items' },
  { href: '/brands', label: 'Brands' },
  { href: '/parties', label: 'Parties' },
  { href: '/losses', label: 'Losses' },
  { href: '/reports', label: 'Reports' },
]

const staffNav = [
  { href: '/', label: 'Home' },
  { href: '/sales', label: 'Sales' },
  { href: '/returns', label: 'Sales Returns' },
  { href: '/purchase-returns', label: 'Purchase Returns' },
  { href: '/payments', label: 'Payments' },
  { href: '/reports', label: 'Reports' },
]

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [role, setRoleState] = useState<Role>(null)
  const [mounted, setMounted] = useState(false)
  const [versionChecked, setVersionChecked] = useState(false)
  const lastCheckRef = useRef<number>(0)

  // Initial role load
  useEffect(() => {
    const r = getRole()
    setRoleState(r)
    setMounted(true)
  }, [])

  // Route-change based auth check
  useEffect(() => {
    let cancelled = false

    async function check() {
      // Skip check for login/pinset pages
      if (pathname === '/login' || pathname === '/pinset') {
        setVersionChecked(true)
        return
      }

      const r = getRole()
      if (!r) {
        router.replace('/login')
        return
      }

      // Debounce: don't check more than once per 500ms
      const now = Date.now()
      if (now - lastCheckRef.current < 500) return
      lastCheckRef.current = now

      const valid = await validateSession()
      if (cancelled) return

      if (!valid) {
        clearRole()
        router.replace('/login')
      }
      setVersionChecked(true)
    }

    check()
    return () => {
      cancelled = true
    }
  }, [pathname, router])

  // Periodic version check every 60 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const r = getRole()
      if (!r) return
      if (pathname === '/login' || pathname === '/pinset') return

      const valid = await validateSession()
      if (!valid) {
        clearRole()
        router.replace('/login')
      }
    }, 60000)

    return () => clearInterval(interval)
  }, [pathname, router])

  function logout() {
    clearRole()
    router.replace('/login')
  }

  const navItems = role === 'owner' ? ownerNav : staffNav
  const showNav =
    mounted && role && pathname !== '/login' && pathname !== '/pinset'

  return (
    <html lang="en">
      <body className="bg-slate-50">
        {showNav && (
          <nav className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
            <div className="max-w-7xl mx-auto px-4">
              <div className="flex items-center h-14 gap-4">
                <Link
                  href="/"
                  className="font-bold text-base whitespace-nowrap hover:text-blue-400 transition-colors"
                >
                  Cellcom Spare
                </Link>

                <div className="flex items-center gap-1 overflow-x-auto flex-1">
                  {navItems.map((item) => {
                    const active =
                      item.href === '/'
                        ? pathname === '/'
                        : pathname.startsWith(item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`text-sm px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                          active
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {item.label}
                      </Link>
                    )
                  })}
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 hidden sm:block">
                    {role === 'owner' ? 'Owner' : 'Staff'}
                  </span>
                  <button
                    onClick={logout}
                    className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    Logout
                  </button>
                </div>
              </div>
            </div>
          </nav>
        )}
        {children}
      </body>
    </html>
  )
}