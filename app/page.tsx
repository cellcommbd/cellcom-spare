'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { getRole, Role } from '../lib/auth'
import {
  Wallet,
  ShoppingCart,
  Package,
  RotateCcw,
  AlertTriangle,
  Users,
  BarChart3,
  ArrowRight,
  Receipt,
} from 'lucide-react'

export default function Home() {
  const [role, setRole] = useState<Role>(null)
  const [loading, setLoading] = useState(true)

  const [todaySales, setTodaySales] = useState(0)
  const [todaySalesCount, setTodaySalesCount] = useState(0)
  const [todayPayments, setTodayPayments] = useState(0)
  const [todayReturns, setTodayReturns] = useState(0)
  const [todayPurchases, setTodayPurchases] = useState(0)
  const [todayLosses, setTodayLosses] = useState(0)
  const [pendingKhata, setPendingKhata] = useState(0)
  const [lowStockCount, setLowStockCount] = useState(0)

  const [topShops, setTopShops] = useState<any[]>([])
  const [todayBills, setTodayBills] = useState<any[]>([])

  useEffect(() => {
    setRole(getRole())
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadStats(), loadLists()])
    setLoading(false)
  }

  async function loadStats() {
    const today = new Date().toISOString().slice(0, 10)

    const [sales, payments, returns, purchases, losses, parties, items] =
      await Promise.all([
        supabase.from('sales').select('total_amount').eq('bill_date', today),
        supabase.from('payments').select('amount').eq('payment_date', today),
        supabase.from('returns').select('total_amount').eq('return_date', today),
        supabase
          .from('purchases')
          .select('total_amount')
          .eq('purchase_date', today),
        supabase.from('losses').select('total_amount').eq('loss_date', today),
        supabase
          .from('parties')
          .select('current_balance')
          .eq('party_type', 'Customer'),
        supabase
          .from('items')
          .select('current_stock, reorder_point')
          .gt('reorder_point', 0),
      ])

    setTodaySales(
      (sales.data || []).reduce((s, r) => s + Number(r.total_amount), 0)
    )
    setTodaySalesCount((sales.data || []).length)
    setTodayPayments(
      (payments.data || []).reduce((s, r) => s + Number(r.amount), 0)
    )
    setTodayReturns(
      (returns.data || []).reduce((s, r) => s + Number(r.total_amount), 0)
    )
    setTodayPurchases(
      (purchases.data || []).reduce((s, r) => s + Number(r.total_amount), 0)
    )
    setTodayLosses(
      (losses.data || []).reduce((s, r) => s + Number(r.total_amount), 0)
    )
    setPendingKhata(
      (parties.data || []).reduce((s, r) => s + Number(r.current_balance), 0)
    )
    setLowStockCount(
      (items.data || []).filter((it) => it.current_stock <= it.reorder_point)
        .length
    )
  }

  async function loadLists() {
    const today = new Date().toISOString().slice(0, 10)

    const { data: shops } = await supabase
      .from('parties')
      .select('party_id, party_name, current_balance')
      .eq('party_type', 'Customer')
      .order('current_balance', { ascending: false })
      .limit(5)

    setTopShops(shops || [])

    const { data: bills } = await supabase
      .from('sales')
      .select('sale_id, party_id, total_amount, status')
      .eq('bill_date', today)
      .order('sale_id', { ascending: false })
      .limit(6)

    if (bills && bills.length > 0) {
      const partyIds = [...new Set(bills.map((b) => b.party_id))]
      const { data: partyData } = await supabase
        .from('parties')
        .select('party_id, party_name')
        .in('party_id', partyIds)

      const partyMap: Record<number, string> = {}
      for (const p of partyData || []) partyMap[p.party_id] = p.party_name

      setTodayBills(
        bills.map((b) => ({
          ...b,
          party_name: partyMap[b.party_id] || '—',
        }))
      )
    } else {
      setTodayBills([])
    }
  }

  const money = (n: number) =>
    `₹ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-slate-400 text-sm">Loading dashboard...</div>
      </div>
    )
  }

  const isOwner = role === 'owner'

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">

        {/* HEADER — stacks on phone, side-by-side on tablet+ */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">
              Welcome back
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              {new Date().toLocaleDateString('en-IN', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>
          <div className="sm:text-right">
            <div className="text-xs text-slate-500 mb-0.5">Signed in as</div>
            <div className="text-sm font-semibold text-slate-800">
              {isOwner ? 'Owner' : 'Staff'}
            </div>
          </div>
        </div>

        {/* STAT CARDS — 1 col phone, 2 col tablet, 4 col desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <StatCard
            label="Today's Sales"
            value={money(todaySales)}
            sub={`${todaySalesCount} bill${todaySalesCount === 1 ? '' : 's'}`}
            icon={<ShoppingCart className="w-5 h-5" />}
            color="blue"
          />
          <StatCard
            label="Payments Collected"
            value={money(todayPayments)}
            sub="Cash + UPI received"
            icon={<Wallet className="w-5 h-5" />}
            color="green"
          />
          {isOwner ? (
            <>
              <StatCard
                label="Today's Purchases"
                value={money(todayPurchases)}
                sub="Stock bought today"
                icon={<Package className="w-5 h-5" />}
                color="purple"
              />
              <StatCard
                label="Losses Today"
                value={money(todayLosses)}
                sub="Damaged / broken"
                icon={<AlertTriangle className="w-5 h-5" />}
                color="red"
              />
            </>
          ) : (
            <>
              <StatCard
                label="Today's Returns"
                value={money(todayReturns)}
                sub="Items returned"
                icon={<RotateCcw className="w-5 h-5" />}
                color="amber"
              />
              <StatCard
                label="Pending Khata"
                value={money(pendingKhata)}
                sub="Total outstanding"
                icon={<Users className="w-5 h-5" />}
                color="red"
              />
            </>
          )}
        </div>

        {/* MINI STATS (Owner only) — 1 col phone, 3 col tablet+ */}
        {isOwner && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <MiniStat
              label="Today's Returns"
              value={money(todayReturns)}
              icon={<RotateCcw className="w-4 h-4" />}
            />
            <MiniStat
              label="Pending Khata"
              value={money(pendingKhata)}
              icon={<Users className="w-4 h-4" />}
            />
            <MiniStat
              label="Low Stock Items"
              value={lowStockCount.toString()}
              icon={<AlertTriangle className="w-4 h-4" />}
              highlight={lowStockCount > 0}
            />
          </div>
        )}

        {/* TWO COLUMNS — stacks on phone, 2 cols on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
          <SectionCard
            title="Top Shops by Balance"
            icon={<Users className="w-4 h-4" />}
            action={{ label: 'View all', href: '/reports' }}
          >
            {topShops.length === 0 ? (
              <EmptyState text="No shops yet." />
            ) : (
              <div>
                {topShops.map((s, i) => (
                  <div
                    key={s.party_id}
                    className={`flex items-center justify-between py-3 gap-2 ${
                      i !== topShops.length - 1
                        ? 'border-b border-slate-100'
                        : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 shrink-0">
                        {i + 1}
                      </div>
                      <div className="text-sm font-medium text-slate-800 truncate">
                        {s.party_name}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-red-600 shrink-0">
                      {money(s.current_balance)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Today's Bills"
            icon={<Receipt className="w-4 h-4" />}
            action={{ label: 'Go to Sales', href: '/sales' }}
          >
            {todayBills.length === 0 ? (
              <EmptyState text="No bills today yet." />
            ) : (
              <div>
                {todayBills.map((b, i) => (
                  <div
                    key={b.sale_id}
                    className={`flex items-center justify-between py-3 gap-2 ${
                      i !== todayBills.length - 1
                        ? 'border-b border-slate-100'
                        : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <div className="text-xs text-slate-400 w-10 shrink-0">
                        #{b.sale_id}
                      </div>
                      <div className="text-sm font-medium text-slate-800 truncate">
                        {b.party_name}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusPill status={b.status} />
                      <div className="text-sm font-semibold text-slate-800">
                        {money(b.total_amount)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* QUICK ACTIONS — 2 col phone, 3 tablet, 6 desktop */}
        <div>
          <h2 className="text-xs sm:text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <ActionTile
              href="/sales"
              label="Sales"
              icon={<ShoppingCart />}
              color="blue"
            />
            <ActionTile
              href="/purchases"
              label="Purchases"
              icon={<Package />}
              color="purple"
            />
            <ActionTile
              href="/payments"
              label="Payments"
              icon={<Wallet />}
              color="green"
            />
            <ActionTile
              href="/returns"
              label="Sales Returns"
              icon={<RotateCcw />}
              color="amber"
            />
            <ActionTile
              href="/items"
              label="Items"
              icon={<Package />}
              color="slate"
            />
            <ActionTile
              href="/reports"
              label="Reports"
              icon={<BarChart3 />}
              color="indigo"
            />
          </div>
        </div>

      </div>
    </div>
  )
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  color: 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'slate' | 'indigo'
}) {
  const themes: Record<string, { bg: string; text: string; iconBg: string }> = {
    blue: {
      bg: 'from-blue-50 to-white border-blue-100',
      text: 'text-blue-700',
      iconBg: 'bg-blue-100 text-blue-600',
    },
    green: {
      bg: 'from-green-50 to-white border-green-100',
      text: 'text-green-700',
      iconBg: 'bg-green-100 text-green-600',
    },
    red: {
      bg: 'from-red-50 to-white border-red-100',
      text: 'text-red-700',
      iconBg: 'bg-red-100 text-red-600',
    },
    amber: {
      bg: 'from-amber-50 to-white border-amber-100',
      text: 'text-amber-700',
      iconBg: 'bg-amber-100 text-amber-600',
    },
    purple: {
      bg: 'from-purple-50 to-white border-purple-100',
      text: 'text-purple-700',
      iconBg: 'bg-purple-100 text-purple-600',
    },
    indigo: {
      bg: 'from-indigo-50 to-white border-indigo-100',
      text: 'text-indigo-700',
      iconBg: 'bg-indigo-100 text-indigo-600',
    },
    slate: {
      bg: 'from-slate-50 to-white border-slate-200',
      text: 'text-slate-700',
      iconBg: 'bg-slate-100 text-slate-600',
    },
  }
  const t = themes[color]
  return (
    <div
      className={`bg-gradient-to-br ${t.bg} border rounded-xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow`}
    >
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <div className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wide">
          {label}
        </div>
        <div className={`p-1.5 rounded-lg ${t.iconBg}`}>{icon}</div>
      </div>
      <div className={`text-xl sm:text-2xl font-bold ${t.text}`}>{value}</div>
      {sub && (
        <div className="text-[10px] sm:text-xs text-slate-400 mt-1">{sub}</div>
      )}
    </div>
  )
}

function MiniStat({
  label,
  value,
  icon,
  highlight,
}: {
  label: string
  value: string
  icon: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
      <div
        className={`p-2 rounded-lg ${
          highlight
            ? 'bg-amber-100 text-amber-600'
            : 'bg-slate-100 text-slate-600'
        }`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-base sm:text-lg font-bold text-slate-800">
          {value}
        </div>
      </div>
    </div>
  )
}

function SectionCard({
  title,
  icon,
  action,
  children,
}: {
  title: string
  icon: React.ReactNode
  action?: { label: string; href: string }
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-slate-500 shrink-0">{icon}</div>
          <h2 className="text-xs sm:text-sm font-semibold text-slate-700 uppercase tracking-wide truncate">
            {title}
          </h2>
        </div>
        {action && (
          <Link
            href={action.href}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 shrink-0"
          >
            <span className="hidden sm:inline">{action.label}</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
      <div className="px-4 sm:px-5 py-2">{children}</div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const styles =
    status === 'Paid'
      ? 'bg-green-100 text-green-700'
      : status === 'Partially Paid'
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-red-100 text-red-700'
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap ${styles}`}
    >
      {status}
    </span>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="px-4 py-6 sm:py-8 text-center text-xs sm:text-sm text-slate-400">
      {text}
    </div>
  )
}

function ActionTile({
  href,
  label,
  icon,
  color,
}: {
  href: string
  label: string
  icon: React.ReactNode
  color: 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'slate' | 'indigo'
}) {
  const themes: Record<string, { bg: string; text: string }> = {
    blue: { bg: 'bg-blue-50 group-hover:bg-blue-100', text: 'text-blue-600' },
    green: {
      bg: 'bg-green-50 group-hover:bg-green-100',
      text: 'text-green-600',
    },
    red: { bg: 'bg-red-50 group-hover:bg-red-100', text: 'text-red-600' },
    amber: {
      bg: 'bg-amber-50 group-hover:bg-amber-100',
      text: 'text-amber-600',
    },
    purple: {
      bg: 'bg-purple-50 group-hover:bg-purple-100',
      text: 'text-purple-600',
    },
    indigo: {
      bg: 'bg-indigo-50 group-hover:bg-indigo-100',
      text: 'text-indigo-600',
    },
    slate: { bg: 'bg-slate-100 group-hover:bg-slate-200', text: 'text-slate-600' },
  }
  const t = themes[color]
  return (
    <Link
      href={href}
      className="group bg-white rounded-xl border border-slate-200 p-3 sm:p-4 flex flex-col items-center gap-2 hover:border-slate-300 hover:shadow-md transition-all"
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${t.bg} ${t.text}`}
      >
        {icon}
      </div>
      <div className="text-xs font-medium text-slate-700 text-center leading-tight">
        {label}
      </div>
    </Link>
  )
}