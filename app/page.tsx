'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { getRole, Role } from '../lib/auth'
import {
  ShoppingCart,
  Search,
  Wallet,
  Package,
  PackageX,
  RotateCcw,
  BarChart3,
  Users,
  ChevronRight,
  Store,
  Receipt,
  Banknote,
  X,
} from 'lucide-react'

// ---------- Types ----------
type Party = {
  party_id: number
  party_name: string
  phone: string | null
  party_type: 'Customer' | 'Supplier'
  current_balance: number
}

type RecentSale = {
  sale_id: number
  party_id: number
  bill_date: string
  total_amount: number
  status: string
  party_name: string
}

type DebtorRow = {
  party_id: number
  party_name: string
  phone: string | null
  current_balance: number
}

// ---------- Helpers ----------
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function money(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`
}

// ---------- Component ----------
export default function Home() {
  const router = useRouter()

  const [role, setRole] = useState<Role>(null)
  const [roleChecked, setRoleChecked] = useState(false)

  const [todaySales, setTodaySales] = useState(0)
  const [todayCashIn, setTodayCashIn] = useState(0)
  const [todayPurchases, setTodayPurchases] = useState(0)
  const [pendingKhata, setPendingKhata] = useState(0)

  const [recentSales, setRecentSales] = useState<RecentSale[]>([])
  const [topDebtors, setTopDebtors] = useState<DebtorRow[]>([])

  const [loading, setLoading] = useState(true)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Party[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchWrapRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRole(getRole())
    setRoleChecked(true)
  }, [])

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        searchWrapRef.current &&
        !searchWrapRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)

    const q = searchQuery.trim()
    if (q.length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    searchDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('parties')
        .select('party_id, party_name, phone, party_type, current_balance')
        .eq('party_type', 'Customer')
        .ilike('party_name', `%${q}%`)
        .order('party_name')
        .limit(8)

      setSearchResults((data as Party[]) || [])
      setSearching(false)
      setSearchOpen(true)
    }, 250)

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchQuery])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadToday(), loadRecentSales(), loadTopDebtors()])
    setLoading(false)
  }

  async function loadToday() {
    const t = todayStr()
    const [s, p, pu] = await Promise.all([
      supabase.from('sales').select('total_amount').eq('bill_date', t),
      supabase.from('payments').select('amount').eq('payment_date', t),
      supabase.from('purchases').select('total_amount').eq('purchase_date', t),
    ])

    setTodaySales(
      (s.data || []).reduce((a, r) => a + Number(r.total_amount), 0)
    )
    setTodayCashIn(
      (p.data || []).reduce((a, r) => a + Number(r.amount), 0)
    )
    setTodayPurchases(
      (pu.data || []).reduce((a, r) => a + Number(r.total_amount), 0)
    )

    const { data: customers } = await supabase
      .from('parties')
      .select('current_balance')
      .eq('party_type', 'Customer')

    setPendingKhata(
      (customers || []).reduce(
        (a, r) => a + Number(r.current_balance || 0),
        0
      )
    )
  }

  async function loadRecentSales() {
    const { data: salesData } = await supabase
      .from('sales')
      .select('sale_id, party_id, bill_date, total_amount, status')
      .order('sale_id', { ascending: false })
      .limit(5)

    const rows = (salesData || []) as any[]
    const partyIds = Array.from(
      new Set(rows.map((r) => r.party_id).filter(Boolean))
    )

    let partyMap: Record<number, string> = {}
    if (partyIds.length > 0) {
      const { data: partyRows } = await supabase
        .from('parties')
        .select('party_id, party_name')
        .in('party_id', partyIds as number[])
      for (const p of partyRows || []) partyMap[p.party_id] = p.party_name
    }

    setRecentSales(
      rows.map((r) => ({
        sale_id: r.sale_id,
        party_id: r.party_id,
        bill_date: r.bill_date,
        total_amount: Number(r.total_amount),
        status: r.status,
        party_name: partyMap[r.party_id] || '—',
      }))
    )
  }

  async function loadTopDebtors() {
    const { data } = await supabase
      .from('parties')
      .select('party_id, party_name, phone, current_balance')
      .eq('party_type', 'Customer')
      .gt('current_balance', 0)
      .order('current_balance', { ascending: false })
      .limit(10)

    setTopDebtors((data as DebtorRow[]) || [])
  }

  function goToParty(partyId: number) {
    router.push(`/parties/${partyId}`)
  }

  function clearSearch() {
    setSearchQuery('')
    setSearchResults([])
    setSearchOpen(false)
    searchInputRef.current?.focus()
  }

  const isOwner = role === 'owner'

  const dateLabel = useMemo(() => {
    return new Date().toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }, [])

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            {greeting()}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {dateLabel}
          </p>
        </div>

        {/* CUSTOMER SEARCH */}
        <div className="mb-4 sm:mb-5 relative" ref={searchWrapRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setSearchOpen(true)
              }}
              placeholder="Search customer by name or phone…"
              className="w-full h-12 pl-10 pr-10 text-base border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              autoComplete="off"
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {searchOpen && searchQuery.trim().length >= 2 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 max-h-80 overflow-y-auto">
              {searching ? (
                <div className="px-4 py-3 text-sm text-slate-400">
                  Searching…
                </div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-3 text-sm text-slate-400">
                  No customers match "{searchQuery}".
                </div>
              ) : (
                searchResults.map((p) => {
                  const bal = Number(p.current_balance || 0)
                  return (
                    <button
                      key={p.party_id}
                      onClick={() => {
                        clearSearch()
                        goToParty(p.party_id)
                      }}
                      className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                    >
                      <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                        <Store className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {p.party_name}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {p.phone || 'No phone'}
                        </div>
                      </div>
                      <div
                        className={`text-sm font-bold shrink-0 ${
                          bal > 0
                            ? 'text-rose-600'
                            : bal < 0
                            ? 'text-emerald-600'
                            : 'text-slate-400'
                        }`}
                      >
                        {bal > 0 ? money(bal) : bal < 0 ? money(bal) : '₹0'}
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* TODAY AT A GLANCE */}
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-500 rounded-2xl p-4 sm:p-5 shadow-sm mb-5 text-white">
          <div className="flex items-center gap-2 text-white/80 text-xs font-medium uppercase tracking-wide mb-3">
            <Banknote className="w-4 h-4" />
            Today at a glance
          </div>
          <div
            className={`grid ${
              isOwner ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
            } gap-3 sm:gap-4`}
          >
            <div>
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Sales
              </div>
              <div className="text-base sm:text-xl font-bold mt-0.5">
                {money(todaySales)}
              </div>
            </div>
            <div className="sm:border-l border-white/20 sm:pl-4">
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Cash In
              </div>
              <div className="text-base sm:text-xl font-bold mt-0.5">
                {money(todayCashIn)}
              </div>
            </div>
            <div className="sm:border-l border-white/20 sm:pl-4">
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Pending Khata
              </div>
              <div className="text-base sm:text-xl font-bold mt-0.5">
                {money(pendingKhata)}
              </div>
            </div>
            {isOwner && (
              <div className="border-l border-white/20 pl-4">
                <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                  Purchases
                </div>
                <div className="text-base sm:text-xl font-bold mt-0.5">
                  {money(todayPurchases)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* QUICK ACTIONS — 9 tiles */}
        <div className="mb-5">
          <h2 className="text-xs sm:text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Quick Actions
          </h2>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <ActionTile
              href="/sales"
              label="Sales"
              Icon={ShoppingCart}
              color="indigo"
            />
            <ActionTile
              href="/payments"
              label="Payments"
              Icon={Wallet}
              color="emerald"
            />
            <ActionTile
              href="/find-stock"
              label="Find Stock"
              Icon={Search}
              color="blue"
            />
            <ActionTile
              href="/parties"
              label="Parties"
              Icon={Users}
              color="slate"
            />
            <ActionTile
              href="/returns"
              label="Returns"
              Icon={RotateCcw}
              color="amber"
            />
            <ActionTile
              href="/reports"
              label="Reports"
              Icon={BarChart3}
              color="purple"
            />
            <ActionTile
              href="/purchases"
              label="Purchases"
              Icon={Package}
              color="slate"
            />
            <ActionTile
              href="/purchase-returns"
              label="Purchase Returns"
              Icon={PackageX}
              color="amber"
            />
            <ActionTile
              href="/expenses"
              label="Expenses"
              Icon={Wallet}
              color="purple"
            />
          </div>
        </div>

        {/* RECENT SALES */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">
                Recent Sales
              </span>
            </div>
            <Link
              href="/sales"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              View all
              <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              Loading…
            </div>
          ) : recentSales.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              No sales yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentSales.map((s) => (
                <button
                  key={s.sale_id}
                  onClick={() => goToParty(s.party_id)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50"
                >
                  <div className="text-xs text-slate-400 w-12 shrink-0">
                    #{s.sale_id}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {s.party_name}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>{s.bill_date}</span>
                      <StatusPill status={s.status} />
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 shrink-0">
                    {money(s.total_amount)}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* TOP DEBTORS */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">
                Top Debtors
              </span>
            </div>
            <Link
              href="/parties"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              All parties
              <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              Loading…
            </div>
          ) : topDebtors.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <div className="text-sm font-medium text-slate-600">
                No pending khata.
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Everyone's settled up.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {topDebtors.map((d) => (
                <div
                  key={d.party_id}
                  className="px-4 py-3 flex items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                    <Store className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {d.party_name}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {d.phone || 'No phone'}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-rose-700 shrink-0">
                    {money(d.current_balance)}
                  </div>
                  <button
                    onClick={() => goToParty(d.party_id)}
                    className="h-9 px-3 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 flex items-center gap-1 shrink-0"
                  >
                    Open
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ---------- Sub-components ----------
function ActionTile({
  href,
  label,
  Icon,
  color,
}: {
  href: string
  label: string
  Icon: any
  color: 'indigo' | 'emerald' | 'blue' | 'slate' | 'amber' | 'purple'
}) {
  const themes: Record<typeof color, { bg: string; text: string }> = {
    indigo: { bg: 'bg-indigo-50 hover:bg-indigo-100', text: 'text-indigo-600' },
    emerald: {
      bg: 'bg-emerald-50 hover:bg-emerald-100',
      text: 'text-emerald-600',
    },
    blue: { bg: 'bg-blue-50 hover:bg-blue-100', text: 'text-blue-600' },
    slate: { bg: 'bg-slate-100 hover:bg-slate-200', text: 'text-slate-600' },
    amber: { bg: 'bg-amber-50 hover:bg-amber-100', text: 'text-amber-600' },
    purple: {
      bg: 'bg-purple-50 hover:bg-purple-100',
      text: 'text-purple-600',
    },
  }
  const t = themes[color]
  return (
    <Link
      href={href}
      className="group bg-white rounded-xl border border-slate-200 p-3 sm:p-4 flex flex-col items-center gap-2 hover:border-slate-300 hover:shadow-md transition-all min-h-[88px]"
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${t.bg} ${t.text}`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-xs font-medium text-slate-700 text-center leading-tight">
        {label}
      </div>
    </Link>
  )
}

function StatusPill({ status }: { status: string }) {
  const styles =
    status === 'Paid'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'Partially Paid'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-rose-100 text-rose-700'
  return (
    <span
      className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${styles}`}
    >
      {status}
    </span>
  )
}
