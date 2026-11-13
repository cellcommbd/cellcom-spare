'use client'

import Link from 'next/link'

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-4">Admin</h1>
        <div className="grid gap-2">
          <Link
            href="/admin/repair"
            className="block p-3 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <div className="text-sm font-semibold text-slate-800">Fix & Repair</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Duplicate items, merge, catalog cleanup
            </div>
          </Link>
          <Link
            href="/admin/aliases"
            className="block p-3 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <div className="text-sm font-semibold text-slate-800">Parser Aliases</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Add/edit part, brand, color, quality aliases
            </div>
          </Link>
          <Link
            href="/admin/balance-check"
            className="block p-3 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <div className="text-sm font-semibold text-slate-800">Balance Check</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Detect and fix customer balance drift
            </div>
          </Link>
          <Link
            href="/admin/batch-audit"
            className="block p-3 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <div className="text-sm font-semibold text-slate-800">Batch Audit</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Audit bulk data for inconsistencies
            </div>
          </Link>
          <Link
            href="/admin/purchase-audit"
            className="block p-3 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <div className="text-sm font-semibold text-slate-800">Purchase Audit</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Audit purchases and vendor records
            </div>
          </Link>
        </div>
        <Link href="/" className="text-blue-600 mt-4 inline-block text-sm">
          ← Home
        </Link>
      </div>
    </div>
  )
}