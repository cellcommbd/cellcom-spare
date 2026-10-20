'use client'

import { Fragment, ReactNode } from 'react'

type DateGroupedListProps<T> = {
  rows: T[]
  getDate: (row: T) => string
  getAmount?: (row: T) => number
  amountPrefix?: string
  renderRow: (row: T, indexInGroup: number) => ReactNode
  emptyState?: ReactNode
  getKey?: (row: T, index: number) => string | number
  dayTotalLabel?: string
  hideRowCount?: boolean
}

function formatGroupDate(d: string) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function DateGroupedList<T>({
  rows,
  getDate,
  getAmount,
  amountPrefix = '₹',
  renderRow,
  emptyState,
  getKey,
  dayTotalLabel,
  hideRowCount,
}: DateGroupedListProps<T>) {
  if (rows.length === 0) {
    return <>{emptyState ?? null}</>
  }

  const groups: { date: string; items: T[] }[] = []
  for (const row of rows) {
    const d = getDate(row) || ''
    const last = groups[groups.length - 1]
    if (last && last.date === d) {
      last.items.push(row)
    } else {
      groups.push({ date: d, items: [row] })
    }
  }

  return (
    <div>
      {groups.map((g, gi) => {
        const dayTotal =
          getAmount != null
            ? g.items.reduce((s, r) => s + (Number(getAmount(r)) || 0), 0)
            : null

        return (
          <Fragment key={`${g.date}-${gi}`}>
            <div className="bg-slate-100 border-y border-slate-200 px-3 py-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] sm:text-xs font-semibold text-slate-700 truncate">
                  {formatGroupDate(g.date)}
                </span>
                {!hideRowCount && (
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {g.items.length} row{g.items.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              {dayTotal != null && (
                <div className="text-[11px] sm:text-xs font-bold text-slate-900 shrink-0">
                  {dayTotalLabel && (
                    <span className="text-slate-500 font-medium mr-1">
                      {dayTotalLabel}
                    </span>
                  )}
                  {amountPrefix}
                  {dayTotal.toLocaleString('en-IN', {
                    maximumFractionDigits: 2,
                  })}
                </div>
              )}
            </div>
            {g.items.map((row, i) => (
              <Fragment key={getKey ? getKey(row, i) : i}>
                {renderRow(row, i)}
              </Fragment>
            ))}
          </Fragment>
        )
      })}
    </div>
  )
}