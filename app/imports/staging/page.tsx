'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { listSessions, StagingSession } from '@/lib/import-staging'
import { FileText, Clock, ChevronRight } from 'lucide-react'

export default function StagingListPage() {
  const [sessions, setSessions] = useState<StagingSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await listSessions()
        if (!cancelled) setSessions(list)
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load sessions')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-5 h-5 text-blue-600" />
        <h1 className="text-lg font-semibold text-slate-800">
          Import Staging Sessions
        </h1>
      </div>

      <p className="text-xs text-slate-600 mb-4">
        Each session is a parsed CSV waiting for review. Nothing is written to
        items until you promote a session.
      </p>

      {loading && (
        <div className="text-sm text-slate-500 py-8 text-center">
          Loading sessions…
        </div>
      )}

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-300 rounded-lg">
          No staging sessions. Import a CSV from the purchases page to create one.
        </div>
      )}

      {!loading && sessions.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">
                  Session
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">
                  Rows
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">
                  Created
                </th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.session_id}
                  className="border-t border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">
                    {s.session_id.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.row_count}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {new Date(s.last_created).toLocaleString('en-IN', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/imports/staging/${s.session_id}`}
                      className="inline-flex items-center text-blue-600 hover:text-blue-800"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}