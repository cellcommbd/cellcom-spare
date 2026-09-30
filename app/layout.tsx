'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { getRole, clearRole, validateSession, Role } from '../lib/auth'
import {
  Home,
  ShoppingCart,
  Search,
  RotateCcw,
  RotateCw,
  Wallet,
  ShoppingBag,
  Package,
  Tag,
  Users,
  AlertTriangle,
  BarChart3,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import './globals.css'

const ownerNav = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/sales', label: 'Sales', Icon: ShoppingCart },
  { href: '/find-stock', label: 'Find Stock', Icon: Search },
  { href: '/returns', label: 'Returns', Icon: RotateCcw },
  { href: '/purchase-returns', label: 'Purch. Ret', Icon: RotateCw },
  { href: '/payments', label: 'Payments', Icon: Wallet },
  { href: '/purchases', label: 'Purchases', Icon: ShoppingBag },
  { href: '/items', label: 'Items', Icon: Package },
  { href: '/brands', label: 'Brands', Icon: Tag },
  { href: '/parties', label: 'Parties', Icon: Users },
  { href: '/losses', label: 'Losses', Icon: AlertTriangle },
  { href: '/reports', label: 'Reports', Icon: BarChart3 },
]

const staffNav = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/sales', label: 'Sales', Icon: ShoppingCart },
  { href: '/find-stock', label: 'Find Stock', Icon: Search },
  { href: '/returns', label: 'Returns', Icon: RotateCcw },
  { href: '/purchase-returns', label: 'Purch. Ret', Icon: RotateCw },
  { href: '/payments', label: 'Payments', Icon: Wallet },
  { href: '/reports', label: 'Reports', Icon: BarChart3 },
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
  const [menuOpen, setMenuOpen] = useState(false)
  const lastCheckRef = useRef<number>(0)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setRoleState(getRole())
    setMounted(true)
  }, [pathname])

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuOpen) return
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  useEffect(() => {
    let cancelled = false

    async function check() {
      if (pathname === '/login' || pathname === '/pinset') return
      const r = getRole()
      if (!r) {
        router.replace('/login')
        return
      }
      const now = Date.now()
      if (now - lastCheckRef.current < 500) return
      lastCheckRef.current = now

      const valid = await validateSession()
      if (cancelled) return
      if (!valid) {
        clearRole()
        router.replace('/login')
      }
    }

    check()
    return () => {
      cancelled = true
    }
  }, [pathname, router])

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

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <html lang="en">
      <body className="bg-slate-50 overflow-x-hidden">
        {showNav && (
          <nav className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800">
            <div className="max-w-[1400px] mx-auto px-3 sm:px-4">
              <div className="flex items-center h-14 gap-3">

                <Link
                  href="/"
                  className="shrink-0 font-semibold text-sm text-white hover:text-indigo-300 transition-colors whitespace-nowrap"
                >
                  Cellcom Spare
                </Link>

                <div className="hidden lg:flex items-center gap-0.5 flex-1 min-w-0 justify-start">
                  {navItems.map((item) => {
                    const active = isActive(item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={item.label}
                        className={`flex items-center gap-1.5 text-[13px] px-2 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                          active
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <item.Icon className="w-4 h-4 shrink-0" />
                        <span className="hidden lg:inline">{item.label}</span>
                      </Link>
                    )
                  })}
                </div>

                <div className="ml-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {role && (
                    <span className="hidden sm:inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                      {role === 'owner' ? 'Owner' : 'Staff'}
                    </span>
                  )}

                  <button
                    onClick={logout}
                    aria-label="Logout"
                    className="hidden sm:inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span className="hidden xl:inline">Logout</span>
                  </button>

                  <button
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-label="Menu"
                    className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    {menuOpen ? (
                      <X className="w-5 h-5" />
                    ) : (
                      <Menu className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {menuOpen && (
              <div
                ref={menuRef}
                className="lg:hidden absolute right-3 top-[calc(100%+6px)] w-[min(22rem,calc(100vw-1.5rem))] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2"
              >
                <div className="grid grid-cols-2 gap-1">
                  {navItems.map((item) => {
                    const active = isActive(item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] transition-colors ${
                          active
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <item.Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
                <div className="border-t border-slate-800 mt-1.5 pt-1.5">
                  <button
                    onClick={logout}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-[13px] text-red-400 hover:bg-slate-800 rounded-md transition-colors"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    Logout
                  </button>
                </div>
              </div>
            )}
          </nav>
        )}
        {children}
      </body>
    </html>
  )
}