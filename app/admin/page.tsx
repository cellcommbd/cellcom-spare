
'use client'

import Link from 'next/link'

const tools = [
  {
    href: '/admin/balance-check',
    title: 'Balance Check',
    summary: 'Find customer drift, compare stored vs computed, and choose the right fix.',
    tone: 'bg-amber-50 border-amber-200 text-amber-900',
  },
  {
    href: '/payment-admin',
    title: 'Payment Admin',
    summary: 'Manage customer payments, allocations, reversals, and payment reconciliation.',
    tone: 'bg-indigo-50 border-indigo-200 text-indigo-900',
  },
  {
    href: '/admin/repair',
    title: 'Fix & Repair',
    summary: 'Clean duplicate records, merge data, and repair catalog issues.',
    tone: 'bg-rose-50 border-rose-200 text-rose-900',
  },
  {
    href: '/admin/aliases',
    title: 'Parser Aliases',
    summary: 'Create and edit aliases for parts, brands, colors, and quality tags.',
    tone: 'bg-sky-50 border-sky-200 text-sky-900',
  },
  {
    href: '/admin/batch-audit',
    title: 'Batch Audit',
    summary: 'Review bulk entries and flag likely inconsistencies across records.',
    tone: 'bg-violet-50 border-violet-200 text-violet-900',
  },
  {
    href: '/admin/purchase-audit',
    title: 'Purchase Audit',
    summary: 'Check purchase records and vendor data for missing or mismatched values.',
    tone: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  },
]

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Owner tools
          </div>

          <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
            Admin
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Data cleanup, audits, and balance checks for store operations.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className={`group block rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${tool.tone}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-base font-semibold">
                  {tool.title}
                </div>

                <span className="text-xl leading-none">→</span>
              </div>

              <div className="mt-2 text-sm leading-5 opacity-80">
                {tool.summary}
              </div>
            </Link>
          ))}
        </div>

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
    </div>
  )
}
