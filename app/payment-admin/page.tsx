
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { isOwner } from '@/lib/auth'

const tools = [
  {
    section: 'Payment Operations',
    items: [
      {
        href: '/payments',
        title: 'Payments',
        summary: 'Enter and manage customer payments.',
        tone: 'bg-emerald-50 border-emerald-200 text-emerald-900',
      },
      {
        href: '/payment-admin/explorer',
        title: 'Payment Explorer',
        summary: 'Inspect customer payments, collections, invoice allocations and reversal history.',
        tone: 'bg-sky-50 border-sky-200 text-sky-900',
      },
      {
        href: '/payment-admin/allocations',
        title: 'Allocation Manager',
        summary: 'Manage payment allocations and invoice-level transfers.',
        tone: 'bg-indigo-50 border-indigo-200 text-indigo-900',
      },
      {
        href: '/payment-admin/reversals',
        title: 'Payment Reversals',
        summary: 'Review payments and reverse incorrect entries.',
        tone: 'bg-rose-50 border-rose-200 text-rose-900',
      },
    ],
  },
  {
    section: 'Reconciliation & Verification',
    items: [
      {
        href: '/payment-admin/reconciliation',
        title: 'Payment Reconciliation & Bulk Allocation',
        summary: 'Find unallocated payments, investigate balance drift and preview FIFO invoice allocations customer by customer.',
        tone: 'bg-teal-50 border-teal-200 text-teal-900',
      },
      {
        href: '/payment-admin/investigation',
        title: 'Payment & Balance Investigation',
        summary: 'Find customer payment discrepancies and invoice amounts that cannot be matched to payment allocations.',
        tone: 'bg-violet-50 border-violet-200 text-violet-900',
      },
      {
        href: '/admin/balance-check',
        title: 'Balance Check',
        summary: 'Compare stored and calculated customer balances and investigate discrepancies.',
        tone: 'bg-amber-50 border-amber-200 text-amber-900',
      },
    ],
  },
]

export default function PaymentAdminPage() {
  const [allowed, setAllowed] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    setAllowed(isOwner())
    setChecking(false)
  }, [])

  if (checking) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        Checking access...
      </main>
    )
  }

  if (!allowed) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-bold text-slate-900">
          Payment Admin
        </h1>
        <p className="mt-3 text-red-600">
          Owner access required.
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-7">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Owner tools
          </div>

          <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
            Payment Admin
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Payment management, allocation, reversal and balance reconciliation.
          </p>
        </header>

        {tools.map((group) => (
          <section key={group.section} className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-slate-800">
              {group.section}
            </h2>

            <div className="grid gap-3 sm:grid-cols-2">
              {group.items.map((tool) => (
                <Link
                  key={tool.href}
                  href={tool.href}
                  className={`group block rounded-2xl border p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${tool.tone}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-base font-semibold">
                      {tool.title}
                    </div>
                    <span className="text-xl leading-none transition-transform group-hover:translate-x-1">
                      →
                    </span>
                  </div>

                  <div className="mt-2 text-sm leading-5 opacity-80">
                    {tool.summary}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <div className="mt-6 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Back
            </div>
            <div className="text-sm text-slate-700">
              Return to the main shop screen
            </div>
          </div>

          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  )
}
