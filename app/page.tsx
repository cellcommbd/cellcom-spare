'use client'

import { useEffect, useState, useMemo } from 'react'
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
  TrendingUp,
  Calendar,
} from 'lucide-react'

type Range = { from: string; to: string }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function lastOfMonth() {
  const d = new Date()
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return last.toISOString().slice(0, 10)
}

function startOfWeek() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day
  const start = new Date(d.setDate(diff))
  return start.toISOString().slice(0, 10)
}

export default function Home() {
  const [role, setRole] = useState<Role>(null)
  const [loading, setLoading] = useState(true)

  const [range, setRange] = useState<Range>({
    from: firstOfMonth(),
    to: lastOfMonth(),
  })

  const [sales, setSales] = useState(0)
  const [salesCount, setSalesCount] = useState(0)
  const [cogs, setCogs] = useState(0)
  const [payments, setPayments] = useState(0)
  const [returns, setReturns] = useState(0)
  const [purchases, setPurchases] = useState(0)
  const [losses, setLosses] = useState(0)
  const [pendingKhata, setPendingKhata] = useState(0)
  const [lowStockCount, setLowStockCount] = useState(0)

  const [topShops, setTopShops] = useState<any[]>([])
  const [recentSales, setRecentSales] = useState<any[]>([])
  const [recentPurchases, setRecentPurchases] = useState<any[]>([])

  useEffect(() => {
    setRole(getRole())
  }, [])

  useEffect(() => {
    loadAll()
  }, [range.from, range.to])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadStats(), loadLists()])
    setLoading(false)
  }

  async function loadStats() {
    const { from, to } = range

    const [
      salesRes,
      saleItemsRes,
      paymentsRes,
      returnsRes,
      purchasesRes,
      lossesRes,
      partiesRes,
      itemsRes,
    ] = await Promise.all([
      supabase
        .from('sales')
        .select('total_amount')
        .gte('bill_date', from)
        .lte('bill_date', to),
      supabase
        .from('sale_items')
        .select('quantity, cost_at_sale, sale_id, sales!inner(bill_date)')
        .gte('sales.bill_date', from)
        .lte('sales.bill_date', to),
      supabase
        .from('payments')
        .select('amount')
        .gte('payment_date', from)
        .lte('payment_date', to),
      supabase
        .from('returns')
        .select('total_amount, return_type')
        .gte('return_date', from)
        .lte('return_date', to)
        .eq('return_type', 'Sales'),
      supabase
        .from('purchases')
        .select('total_amount')
        .gte('purchase_date', from)
        .lte('purchase_date', to),
      supabase
        .from('losses')
        .select('total_amount')
        .gte('loss_date', from)
        .lte('loss_date', to),
      supabase
        .from('parties')
        .select('current_balance')
        .eq('party_type', 'Customer'),
      supabase
        .from('items')
        .select('current_stock, reorder_point')
        .gt('reorder_point', 0),
    ])

    const s = (salesRes.data || []).reduce(
      (a, r) => a + Number(r.total_amount),
      0
    )
    setSales(s)
    setSalesCount((salesRes.data || []).length)

    // COGS = sum(quantity * cost_at_sale) across sale_items in range
    const c = (saleItemsRes.data || []).reduce(
      (a: number, r: any) =>
        a + Number(r.quantity) * Number(r.cost_at_sale || 0),
      0
    )
    setCogs(c)

    setPayments(
      (paymentsRes.data || []).reduce((a, r) => a + Number(r.amount), 0)
    )
    setReturns(
      (returnsRes.data || []).reduce((a, r) => a + Number(r.total_amount), 0)
    )
    setPurchases(
      (purchasesRes.data || []).reduce((a, r) => a + Number(r.total_amount), 0)
    )
    setLosses(
      (lossesRes.data || []).reduce((a, r) => a + Number(r.total_amount), 0)
    )
    setPendingKhata(
      (partiesRes.data || []).reduce(
        (a, r) => a + Number(r.current_balance),
        0
      )
    )
    setLowStockCount(
      (itemsRes.data || []).filter(
        (it) => it.current_stock <= it.reorder_point
      ).length
    )
  }

  async function loadLists() {
    const { from, to } = range

    const [shopsRes, salesRes, purchasesRes] = await Promise.all([
      supabase
        .from('parties')
        .select('party_id, party_name, current_balance')
        .eq('party_type', 'Customer')
        .order('current_balance', { ascending: false })
        .limit(5),
      supabase
        .from('sales')
        .select('sale_id, party_id, total_amount, status, bill_date')
        .gte('bill_date', from)
        .lte('bill_date', to)
        .order('sale_id', { ascending: false })
        .limit(6),
      supabase
        .from('purchases')
        .select('purchase_id, party_id, invoice_no, total_amount, purchase_date')
        .gte('purchase_date', from)
        .lte('purchase_date', to)
        .order('purchase_id', { ascending: false })
        .limit(6),
    ])

    setTopShops(shopsRes.data || [])

    // Resolve party names for both lists
    const salesRows = salesRes.data || []
    const purchaseRows = purchasesRes.data || []
    const partyIds = Array.from(
      new Set([
        ...salesRows.map((r) => r.party_id),
        ...purchaseRows.map((r) => r.party_id),
      ])
    ).filter(Boolean)

    let partyMap: Record<number, string> = {}
    if (partyIds.length > 0) {
      const { data: pdata } = await supabase
        .from('parties')
        .select('party_id, party_name')
        .in('party_id', partyIds as number[])
      for (const p of pdata || []) partyMap[p.party_id] = p.party_name
    }

    setRecentSales(
      salesRows.map((b) => ({
        ...b,
        party_name: partyMap[b.party_id] || '—',
      }))
    )
    setRecentPurchases(
      purchaseRows.map((p) => ({
        ...p,
        party_name: partyMap[p.party_id] || '—',
      }))
    )
  }

  const money = (n: number) =>
    `₹ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

  const grossProfit = sales - cogs
  const profitMargin = sales > 0 ? (grossProfit / sales) * 100 : 0

  const setRangeTo = (mode: 'today' | 'week' | 'month') => {
    if (mode === 'today') {
      const t = todayStr()
      setRange({ from: t, to: t })
    } else if (mode === 'week') {
      setRange({ from: startOfWeek(), to: todayStr() })
    } else {
      setRange({ from: firstOfMonth(), to: lastOfMonth() })
    }
  }

  const isOwner = role === 'owner'

  // Label for the range shown in cards
  const rangeLabel = useMemo(() => {
    if (range.from === range.to) {
      return new Date(range.from).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
      })
    }
    const f = new Date(range.from).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    })
    const t = new Date(range.to).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    })
    return `${f} – ${t}`
  }, [range.from, range.to])

  if (loading && role === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-slate-400 text-sm">Loading dashboard...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">

        {/* HEADER */}
        <div className="mb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
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

        {/* DATE RANGE BAR */}
        <div className="mb-6 bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 text-slate-700 shrink-0">
              <Calendar className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium">Date range</span>
            </div>

            <div className="flex items-center gap-2 flex-1">
              <input
                type="date"
                value={range.from}
                onChange={(e) =>
                  setRange((r) => ({ ...r, from: e.target.value }))
                }
                className="h-9 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-slate-400 text-sm">to</span>
              <input
                type="date"
                value={range.to}
                onChange={(e) =>
                  setRange((r) => ({ ...r, to: e.target.value }))
                }
                className="h-9 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setRangeTo('today')}
                className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Today
              </button>
              <button
                onClick={() => setRangeTo('week')}
                className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Week
              </button>
              <button
                onClick={() => setRangeTo('month')}
                className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Month
              </button>
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-2">
            Showing <strong className="text-slate-700">{rangeLabel}</strong>
          </div>
        </div>

        {/* MAIN STAT CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <StatCard
            label="Sales"
            value={money(sales)}
            sub={`${salesCount} bill${salesCount === 1 ? '' : 's'}`}
            icon={<ShoppingCart className="w-5 h-5" />}
            color="blue"
          />
          <StatCard
            label="Payments Collected"
            value={money(payments)}
            sub="Cash + UPI received"
            icon={<Wallet className="w-5 h-5" />}
            color="green"
          />
          {isOwner ? (
            <>
              <StatCard
                label="Purchases"
                value={money(purchases)}
                sub="Stock bought"
                icon={<Package className="w-5 h-5" />}
                color="purple"
              />
              <StatCard
                label="Gross Profit"
                value={money(grossProfit)}
                sub={
                  sales > 0
                    ? `${profitMargin.toFixed(1)}% margin`
                    : 'No sales in range'
                }
                icon={<TrendingUp className="w-5 h-5" />}
                color={grossProfit >= 0 ? 'green' : 'red'}
              />
            </>
          ) : (
            <>
              <StatCard
                label="Returns"
                value={money(returns)}
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

        {/* MINI STATS (Owner only) */}
        {isOwner && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <MiniStat
              label="Returns"
              value={money(returns)}
              icon={<RotateCcw className="w-4 h-4" />}
            />
            <MiniStat
              label="Pending Khata"
              value={money(pendingKhata)}
              icon={<Users className="w-4 h-4" />}
            />
            <MiniStat
              label="Losses"
              value={money(losses)}
              icon={<AlertTriangle className="w-4 h-4" />}
              highlight={losses > 0}
            />
            <MiniStat
              label="Low Stock Items"
              value={lowStockCount.toString()}
              icon={<AlertTriangle className="w-4 h-4" />}
              highlight={lowStockCount > 0}
            />
          </div>
        )}

        {/* LISTS */}
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
            title="Recent Sales"
            icon={<Receipt className="w-4 h-4" />}
            action={{ label: 'Go to Sales', href: '/sales' }}
          >
            {recentSales.length === 0 ? (
              <EmptyState text="No sales in this range." />
            ) : (
              <div>
                {recentSales.map((b, i) => (
                  <div
                    key={b.sale_id}
                    className={`flex items-center justify-between py-3 gap-2 ${
                      i !== recentSales.length - 1
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

        {/* RECENT PURCHASES — Owner only */}
        {isOwner && (
          <div className="mb-6">
            <SectionCard
              title="Recent Purchases"
              icon={<Package className="w-4 h-4" />}
              action={{ label: 'Go to Purchases', href: '/purchases' }}
            >
              {recentPurchases.length === 0 ? (
                <EmptyState text="No purchases in this range." />
              ) : (
                <div>
                  {recentPurchases.map((p, i) => (
                    <div
                      key={p.purchase_id}
                      className={`flex items-center justify-between py-3 gap-2 ${
                        i !== recentPurchases.length - 1
                          ? 'border-b border-slate-100'
                          : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <div className="text-xs text-slate-400 w-10 shrink-0">
                          #{p.purchase_id}
                        </div>
                        <div className="text-sm font-medium text-slate-800 truncate">
                          {p.party_name}
                        </div>
                        <div className="text-xs text-slate-400 hidden sm:block">
                          {p.invoice_no}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-slate-800 shrink-0">
                        {money(p.total_amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {/* QUICK ACTIONS */}
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