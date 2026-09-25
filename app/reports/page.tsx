'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getRole } from '../../lib/auth'
import {
  DollarSign,
  Package,
  TrendingUp,
  AlertTriangle,
  Users,
  ShoppingCart,
  Flame,
  PieChart,
} from 'lucide-react'

type Role = 'staff' | 'owner' | null

export default function ReportsPage() {
  const [role, setRole] = useState<Role>(null)
  const [loading, setLoading] = useState(true)
  const today = new Date().toISOString().slice(0, 10)

  const [shopBalances, setShopBalances] = useState<any[]>([])
  const [todaySales, setTodaySales] = useState<any[]>([])
  const [shops, setShops] = useState<Record<number, string>>({})

  const [monthlyStart, setMonthlyStart] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10)
  )
  const [monthlyEnd, setMonthlyEnd] = useState(today)

  const [profitData, setProfitData] = useState({
    sales: 0,
    cost: 0,
    profit: 0,
    losses: 0,
    netProfit: 0,
    billCount: 0,
  })
  const [topItems, setTopItems] = useState<any[]>([])
  const [lowStock, setLowStock] = useState<any[]>([])
  const [losses, setLosses] = useState<any[]>([])

  useEffect(() => {
    const r = getRole()
    setRole(r)
    loadAll(r)
  }, [])

  async function loadAll(r: Role) {
    setLoading(true)
    try {
      await loadStaffData()
    } catch (e) {
      console.error(e)
    }
    if (r === 'owner') {
      try {
        await loadOwnerData()
      } catch (e) {
        console.error(e)
      }
    }
    setLoading(false)
  }

  async function loadStaffData() {
    const { data: shopData } = await supabase
      .from('parties')
      .select('party_id, party_name, current_balance')
      .eq('party_type', 'Customer')
      .order('current_balance', { ascending: false })

    setShopBalances(shopData || [])
    const shopMap: Record<number, string> = {}
    for (const s of shopData || []) shopMap[s.party_id] = s.party_name
    setShops(shopMap)

    const { data: salesData } = await supabase
      .from('sales')
      .select('sale_id, party_id, bill_date, total_amount, status')
      .eq('bill_date', today)
      .order('sale_id', { ascending: false })

    setTodaySales(salesData || [])
  }

  async function loadOwnerData() {
    const { data: salesInPeriod } = await supabase
      .from('sales')
      .select('sale_id')
      .gte('bill_date', monthlyStart)
      .lte('bill_date', monthlyEnd)

    const saleIds = (salesInPeriod || []).map((s) => s.sale_id)

    if (saleIds.length === 0) {
      setProfitData({
        sales: 0,
        cost: 0,
        profit: 0,
        losses: 0,
        netProfit: 0,
        billCount: 0,
      })
      setTopItems([])
      setLosses([])
      return
    }

    const { data: saleItems } = await supabase
      .from('sale_items')
      .select('quantity, rate, cost_at_sale, item_id, sale_id')
      .in('sale_id', saleIds)

    let totalSales = 0
    let totalCost = 0
    const itemQty: Record<number, number> = {}

    for (const si of saleItems || []) {
      totalSales += Number(si.rate) * Number(si.quantity)
      totalCost += Number(si.cost_at_sale) * Number(si.quantity)
      itemQty[si.item_id] = (itemQty[si.item_id] || 0) + Number(si.quantity)
    }

    const topIds = Object.entries(itemQty)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([id]) => Number(id))

    if (topIds.length > 0) {
      const { data: topItemsData } = await supabase
        .from('items')
        .select('item_id, sku')
        .in('item_id', topIds)

      const topItemsWithQty = (topItemsData || []).map((it) => ({
        ...it,
        quantity: itemQty[it.item_id],
      }))
      topItemsWithQty.sort((a, b) => b.quantity - a.quantity)
      setTopItems(topItemsWithQty)
    }

    const { data: lossData } = await supabase
      .from('losses')
      .select(
        'loss_id, loss_date, item_id, quantity, rate, total_amount, reason'
      )
      .gte('loss_date', monthlyStart)
      .lte('loss_date', monthlyEnd)

    setLosses(lossData || [])
    const totalLosses = (lossData || []).reduce(
      (s, l) => s + Number(l.total_amount),
      0
    )

    setProfitData({
      sales: totalSales,
      cost: totalCost,
      profit: totalSales - totalCost,
      losses: totalLosses,
      netProfit: totalSales - totalCost - totalLosses,
      billCount: saleIds.length,
    })

    const { data: itemsData } = await supabase
      .from('items')
      .select('item_id, sku, current_stock, reorder_point')
      .gt('reorder_point', 0)

    const lowStockItems = (itemsData || [])
      .filter((it) => it.current_stock <= it.reorder_point)
      .sort((a, b) => a.current_stock - b.current_stock)
    setLowStock(lowStockItems)
  }

  async function refreshOwner() {
    try {
      await loadOwnerData()
    } catch (e) {
      console.error(e)
    }
  }

  const money = (n: number) => `₹ ${Number(n).toFixed(2)}`
  const margin =
    profitData.sales > 0
      ? ((profitData.profit / profitData.sales) * 100).toFixed(1)
      : '0.0'
  const totalOutstanding = shopBalances.reduce(
    (s, x) => s + Number(x.current_balance),
    0
  )
  const todaySalesTotal = todaySales.reduce(
    (s, x) => s + Number(x.total_amount),
    0
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
            <div className="text-lg text-slate-600">Loading reports...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="max-w-7xl mx-auto">

        {/* HEADER */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Reports</h1>
            <p className="text-sm text-slate-500 mt-1">
              {role === 'owner'
                ? 'Full analytics — profit, losses, top items, stock alerts'
                : "Shop balances and today's sales"}
            </p>
          </div>

          {role === 'owner' && (
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  From
                </label>
                <input
                  type="date"
                  value={monthlyStart}
                  onChange={(e) => setMonthlyStart(e.target.value)}
                  className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  To
                </label>
                <input
                  type="date"
                  value={monthlyEnd}
                  onChange={(e) => setMonthlyEnd(e.target.value)}
                  className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={refreshOwner}
                className="h-9 px-4 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm"
              >
                Refresh
              </button>
            </div>
          )}
        </div>

        {/* PROFIT TILES — OWNER ONLY */}
        {role === 'owner' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Sales"
              value={money(profitData.sales)}
              sub={`${profitData.billCount} bills`}
              icon={<DollarSign className="w-5 h-5" />}
              color="blue"
            />
            <StatCard
              label="Cost of Goods"
              value={money(profitData.cost)}
              sub="Landed cost"
              icon={<Package className="w-5 h-5" />}
              color="slate"
            />
            <StatCard
              label="Gross Profit"
              value={money(profitData.profit)}
              sub={`${margin}% margin`}
              icon={<TrendingUp className="w-5 h-5" />}
              color="green"
            />
            <StatCard
              label="Net Profit"
              value={money(profitData.netProfit)}
              sub={`After ${money(profitData.losses)} losses`}
              icon={<PieChart className="w-5 h-5" />}
              color="purple"
            />
          </div>
        )}

        {/* TWO-COLUMN LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

          {/* SHOP BALANCES */}
          <Section
            title="Shop Balances"
            icon={<Users className="w-4 h-4" />}
            badge={
              <span className="text-sm font-semibold text-red-600">
                {money(totalOutstanding)}
              </span>
            }
          >
            {shopBalances.length === 0 ? (
              <EmptyState text="No shops yet." />
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {shopBalances.map((s, i) => (
                      <tr
                        key={s.party_id}
                        className={`${
                          i % 2 === 0 ? 'bg-slate-50/50' : 'bg-white'
                        } hover:bg-blue-50 transition-colors`}
                      >
                        <td className="px-4 py-2.5 text-slate-700 font-medium">
                          {s.party_name}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold ${
                            Number(s.current_balance) > 0
                              ? 'text-red-600'
                              : Number(s.current_balance) < 0
                              ? 'text-green-600'
                              : 'text-slate-400'
                          }`}
                        >
                          {money(s.current_balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* TODAY'S SALES */}
          <Section
            title="Today's Sales"
            icon={<ShoppingCart className="w-4 h-4" />}
            badge={
              <span className="text-sm font-semibold text-blue-600">
                {money(todaySalesTotal)}
              </span>
            }
          >
            {todaySales.length === 0 ? (
              <EmptyState text="No sales today yet." />
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {todaySales.map((s, i) => (
                      <tr
                        key={s.sale_id}
                        className={`${
                          i % 2 === 0 ? 'bg-slate-50/50' : 'bg-white'
                        } hover:bg-blue-50 transition-colors`}
                      >
                        <td className="px-4 py-2.5 text-slate-500 w-16">
                          #{s.sale_id}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 font-medium">
                          {shops[s.party_id] || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                          {money(s.total_amount)}
                        </td>
                        <td className="px-4 py-2.5 w-24 text-right">
                          <StatusPill status={s.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>

        {/* OWNER-ONLY SECTIONS */}
        {role === 'owner' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

              {/* FAST-MOVING */}
              <Section
                title="Fast-Moving Items"
                icon={<Flame className="w-4 h-4" />}
                badge={
                  <span className="text-xs text-slate-500">
                    Top {topItems.length}
                  </span>
                }
              >
                {topItems.length === 0 ? (
                  <EmptyState text="No sales in this period." />
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {topItems.map((it, i) => (
                        <tr
                          key={it.item_id}
                          className={`${
                            i % 2 === 0 ? 'bg-slate-50/50' : 'bg-white'
                          } hover:bg-blue-50 transition-colors`}
                        >
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                            {it.sku}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-800 w-24">
                            {it.quantity} units
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              {/* REORDER */}
              <Section
                title="Reorder Alerts"
                icon={<AlertTriangle className="w-4 h-4" />}
                badge={
                  <span
                    className={`text-sm font-semibold ${
                      lowStock.length > 0 ? 'text-orange-600' : 'text-green-600'
                    }`}
                  >
                    {lowStock.length} item{lowStock.length !== 1 ? 's' : ''}
                  </span>
                }
              >
                {lowStock.length === 0 ? (
                  <EmptyState
                    text="All items above reorder point."
                    tone="success"
                  />
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">SKU</th>
                        <th className="px-4 py-2 text-right font-medium">Stock</th>
                        <th className="px-4 py-2 text-right font-medium">ROP</th>
                        <th className="px-4 py-2 text-right font-medium">
                          Short
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStock.map((it, i) => (
                        <tr
                          key={it.item_id}
                          className={`${
                            i % 2 === 0 ? 'bg-slate-50/50' : 'bg-white'
                          } hover:bg-orange-50 transition-colors`}
                        >
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                            {it.sku}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-red-600">
                            {it.current_stock}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-600">
                            {it.reorder_point}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-orange-600">
                            {it.reorder_point - it.current_stock}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>
            </div>

            {/* LOSSES */}
            <Section
              title="Losses in Period"
              icon={<AlertTriangle className="w-4 h-4" />}
              badge={
                <span className="text-sm font-semibold text-red-600">
                  {money(profitData.losses)}
                </span>
              }
            >
              {losses.length === 0 ? (
                <EmptyState text="No losses in this period." tone="success" />
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Date</th>
                      <th className="px-4 py-2 text-left font-medium">Reason</th>
                      <th className="px-4 py-2 text-right font-medium">Qty</th>
                      <th className="px-4 py-2 text-right font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {losses.map((l, i) => (
                      <tr
                        key={l.loss_id}
                        className={`${
                          i % 2 === 0 ? 'bg-slate-50/50' : 'bg-white'
                        } hover:bg-red-50 transition-colors`}
                      >
                        <td className="px-4 py-2.5 text-slate-600">
                          {l.loss_date}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {l.reason}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700">
                          {l.quantity}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-red-600">
                          {money(l.total_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </>
        )}

      </div>
    </div>
  )
}

// ---------- Sub-components ----------

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
  color: 'blue' | 'green' | 'purple' | 'slate' | 'red'
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
    purple: {
      bg: 'from-purple-50 to-white border-purple-100',
      text: 'text-purple-700',
      iconBg: 'bg-purple-100 text-purple-600',
    },
    red: {
      bg: 'from-red-50 to-white border-red-100',
      text: 'text-red-700',
      iconBg: 'bg-red-100 text-red-600',
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
      className={`bg-gradient-to-br ${t.bg} border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          {label}
        </div>
        <div className={`p-1.5 rounded-lg ${t.iconBg}`}>{icon}</div>
      </div>
      <div className={`text-2xl font-bold ${t.text}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  )
}

function Section({
  title,
  icon,
  badge,
  children,
}: {
  title: string
  icon: React.ReactNode
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-slate-500">{icon}</div>
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            {title}
          </h2>
        </div>
        {badge}
      </div>
      {children}
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
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles}`}
    >
      {status}
    </span>
  )
}

function EmptyState({
  text,
  tone = 'neutral',
}: {
  text: string
  tone?: 'neutral' | 'success'
}) {
  return (
    <div
      className={`px-4 py-12 text-center text-sm ${
        tone === 'success' ? 'text-green-600' : 'text-slate-400'
      }`}
    >
      {text}
    </div>
  )
}