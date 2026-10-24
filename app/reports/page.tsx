'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getRole, Role } from '../../lib/auth'
import {
  TrendingUp,
  Store,
  Flame,
  PackageX,
  ArrowRight,
  BarChart3,
  DollarSign,
  Users,
  AlertTriangle,
  Package,
  CalendarClock,
  Wallet,
  Search,
} from 'lucide-react'

type ReportCard = {
  href: string
  title: string
  description: string
  Icon: any
  color: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'indigo' | 'slate'
  ownerOnly?: boolean
}

const REPORTS: ReportCard[] = [
  {
    href: '/reports/cost-history',
    title: 'Cost Change Tracker',
    description:
      'Rate history for each SKU across invoices — spot price shifts and price creep.',
    Icon: TrendingUp,
    color: 'blue',
  },
  {
    href: '/reports/supplier-prices',
    title: 'Supplier Price Comparison',
    description:
      'Same SKU bought from different suppliers — find who is cheaper and by how much.',
    Icon: Store,
    color: 'purple',
    ownerOnly: true,
  },
  {
    href: '/reports/fast-moving',
    title: 'Fast-Moving Items',
    description:
      'Top-selling SKUs in the selected period, ranked by quantity and revenue.',
    Icon: Flame,
    color: 'red',
  },
  {
    href: '/reports/sales-explorer',
    title: 'Sales Explorer',
    description:
      'Find sales by date, customer, item, or Counter Sale. Group by day, party, item, or bill.',
    Icon: Search,
    color: 'slate',
  },
  {
    href: '/reports/dead-stock',
    title: 'Dead Stock',
    description:
      'Items sitting in inventory with zero sales in the range. Cash tied up.',
    Icon: PackageX,
    color: 'amber',
  },
  {
    href: '/reports/profit-per-item',
    title: 'Profit per Item',
    description:
      'Ranked SKUs by gross profit — sale revenue minus cost at sale.',
    Icon: DollarSign,
    color: 'green',
    ownerOnly: true,
  },
  {
    href: '/reports/khata-aging',
    title: 'Khata Aging',
    description:
      'Receivables bucketed by age: 0–30, 31–60, 61–90, 90+ days.',
    Icon: Users,
    color: 'red',
    ownerOnly: true,
  },
  {
    href: '/reports/expenses',
    title: 'Expenses by Type',
    description:
      'Rent, staff wages, kitty, and bills — grouped by category with per-entry detail.',
    Icon: Wallet,
    color: 'amber',
    ownerOnly: true,
  },
  {
    href: '/reports/profit',
    title: 'Profit Report',
    description:
      'Sales − COGS − Losses − Expenses. Gross and net profit for any date range.',
    Icon: BarChart3,
    color: 'indigo',
    ownerOnly: true,
  },
  {
    href: '/reports/low-stock',
    title: 'Low Stock & Reorder',
    description:
      'Zero-stock and low-stock items — quick view to know what to reorder.',
    Icon: AlertTriangle,
    color: 'amber',
  },
  {
    href: '/reports/stock-value',
    title: 'Stock Value',
    description:
      'Total cash tied up in inventory, broken down by brand and part type.',
    Icon: Package,
    color: 'slate',
    ownerOnly: true,
  },
  {
    href: '/reports/recent-activity',
    title: 'Recent Activity',
    description:
      'Latest sales, purchases, payments, and returns in one list.',
    Icon: CalendarClock,
    color: 'blue',
  },
]

const COLOR_THEMES: Record<
  string,
  { hoverBorder: string; iconBg: string; iconText: string; titleText: string }
> = {
  blue: {
    hoverBorder: 'hover:border-blue-400',
    iconBg: 'bg-blue-50',
    iconText: 'text-blue-600',
    titleText: 'text-slate-900',
  },
  green: {
    hoverBorder: 'hover:border-emerald-400',
    iconBg: 'bg-emerald-50',
    iconText: 'text-emerald-600',
    titleText: 'text-slate-900',
  },
  amber: {
    hoverBorder: 'hover:border-amber-400',
    iconBg: 'bg-amber-50',
    iconText: 'text-amber-600',
    titleText: 'text-slate-900',
  },
  red: {
    hoverBorder: 'hover:border-rose-400',
    iconBg: 'bg-rose-50',
    iconText: 'text-rose-600',
    titleText: 'text-slate-900',
  },
  purple: {
    hoverBorder: 'hover:border-purple-400',
    iconBg: 'bg-purple-50',
    iconText: 'text-purple-600',
    titleText: 'text-slate-900',
  },
  indigo: {
    hoverBorder: 'hover:border-indigo-400',
    iconBg: 'bg-indigo-50',
    iconText: 'text-indigo-600',
    titleText: 'text-slate-900',
  },
  slate: {
    hoverBorder: 'hover:border-slate-400',
    iconBg: 'bg-slate-100',
    iconText: 'text-slate-600',
    titleText: 'text-slate-900',
  },
}

export default function ReportsIndex() {
  const [role, setRole] = useState<Role>(null)

  useEffect(() => {
    setRole(getRole())
  }, [])

  const isOwner = role === 'owner'

  const visible = REPORTS.filter((r) => !r.ownerOnly || isOwner)

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">

        <div className="mb-6 sm:mb-8">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Reports
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 ml-13 pl-1">
            Business insight across sales, purchases, stock, and ledger.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {visible.map((r) => {
            const t = COLOR_THEMES[r.color]
            return (
              <Link key={r.href} href={r.href} className="block group">
                <div
                  className={`h-full bg-white rounded-xl border border-slate-200 p-5 transition-all group-hover:shadow-md group-active:scale-[0.99] ${t.hoverBorder}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div
                      className={`w-10 h-10 rounded-lg ${t.iconBg} ${t.iconText} flex items-center justify-center shrink-0`}
                    >
                      <r.Icon className="w-5 h-5" />
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <h2 className={`text-base font-bold mb-1 ${t.titleText}`}>
                    {r.title}
                  </h2>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {r.description}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>

      </div>
    </div>
  )
}