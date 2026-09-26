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
} from 'lucide-react'

type ReportCard = {
  href: string
  title: string
  description: string
  Icon: any
  color: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'indigo' | 'slate'
  ownerOnly?: boolean
  comingSoon?: boolean
}

const REPORTS: ReportCard[] = [
  {
    href: '/reports/cost-history',
    title: 'Cost Change Tracker',
    description:
      'Rate history for each SKU across invoices — spot price shifts, cheapest supplier, and price creep.',
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
    comingSoon: true,
  },
  {
    href: '/reports/khata-aging',
    title: 'Khata Aging',
    description:
      'Receivables bucketed by age: 0–30, 31–60, 61–90, 90+ days.',
    Icon: Users,
    color: 'red',
    ownerOnly: true,
    comingSoon: true,
  },
  {
    href: '/reports/monthly-pnl',
    title: 'Monthly P&L',
    description:
      'Sales − COGS − Expenses − Losses. The bottom line, per month.',
    Icon: BarChart3,
    color: 'indigo',
    ownerOnly: true,
    comingSoon: true,
  },
  {
    href: '/reports/low-stock',
    title: 'Low Stock & Reorder',
    description:
      'Items at or below reorder point — ready to order list.',
    Icon: AlertTriangle,
    color: 'amber',
    comingSoon: true,
  },
  {
    href: '/reports/stock-value',
    title: 'Stock Value',
    description:
      'Total cash tied up in inventory, broken down by brand and part type.',
    Icon: Package,
    color: 'slate',
    ownerOnly: true,
    comingSoon: true,
  },
  {
    href: '/reports/recent-activity',
    title: 'Recent Activity',
    description:
      'Latest sales, purchases, payments, and returns in one list.',
    Icon: CalendarClock,
    color: 'blue',
    comingSoon: true,
  },
]

// Titles use 800 (darkened) shades for readability on white
const COLOR_THEMES: Record<
  string,
  { bg: string; iconBg: string; iconText: string; titleText: string }
> = {
  blue: {
    bg: 'hover:border-blue-300',
    iconBg: 'bg-blue-100',
    iconText: 'text-blue-700',
    titleText: 'text-blue-900',
  },
  green: {
    bg: 'hover:border-green-300',
    iconBg: 'bg-green-100',
    iconText: 'text-green-700',
    titleText: 'text-green-900',
  },
  amber: {
    bg: 'hover:border-amber-300',
    iconBg: 'bg-amber-100',
    iconText: 'text-amber-700',
    titleText: 'text-amber-900',
  },
  red: {
    bg: 'hover:border-red-300',
    iconBg: 'bg-red-100',
    iconText: 'text-red-700',
    titleText: 'text-red-900',
  },
  purple: {
    bg: 'hover:border-purple-300',
    iconBg: 'bg-purple-100',
    iconText: 'text-purple-700',
    titleText: 'text-purple-900',
  },
  indigo: {
    bg: 'hover:border-indigo-300',
    iconBg: 'bg-indigo-100',
    iconText: 'text-indigo-700',
    titleText: 'text-indigo-900',
  },
  slate: {
    bg: 'hover:border-slate-300',
    iconBg: 'bg-slate-100',
    iconText: 'text-slate-700',
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
      <div className="max-w-7xl mx-auto">

        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <BarChart3 className="w-6 h-6 text-blue-700" />
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Reports
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            Business insight across sales, purchases, stock, and ledger.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {visible.map((r) => {
            const t = COLOR_THEMES[r.color]
            const isComingSoon = !!r.comingSoon

            const Card = (
              <div
                className={`h-full bg-white rounded-xl border border-slate-200 p-5 transition-all ${
                  isComingSoon
                    ? 'opacity-60 cursor-not-allowed'
                    : `${t.bg} hover:shadow-md cursor-pointer group`
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div
                    className={`w-10 h-10 rounded-lg ${t.iconBg} ${t.iconText} flex items-center justify-center shrink-0`}
                  >
                    <r.Icon className="w-5 h-5" />
                  </div>
                  {isComingSoon ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase tracking-wide">
                      Soon
                    </span>
                  ) : (
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition-colors" />
                  )}
                </div>
                <h2
                  className={`text-base font-bold mb-1 ${t.titleText}`}
                >
                  {r.title}
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {r.description}
                </p>
              </div>
            )

            return isComingSoon ? (
              <div key={r.href}>{Card}</div>
            ) : (
              <Link key={r.href} href={r.href} className="block">
                {Card}
              </Link>
            )
          })}
        </div>

      </div>
    </div>
  )
}