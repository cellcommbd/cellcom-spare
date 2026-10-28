'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { SmartCombobox } from '../../../components/ui/smart-combobox'
import { searchItems, SearchItemResult } from '../../../lib/item-search'
import { SaleEditModal } from '../../../components/ui/sale-edit-modal'
import {
  ArrowLeft,
  Search,
  Calendar,
  Receipt,
  Copy,
  ChevronDown,
  ChevronRight,
  Pencil,
} from 'lucide-react'

type GroupBy = 'line' | 'day' | 'party' | 'item' | 'bill'
type SortBy = 'qty' | 'amount' | 'date' | 'entry'
type DateMode = 'bill' | 'entry'

type SaleRow = {
  sale_id: number
  bill_date: string
  entry_date: string | null
  party_id: number
  party_name: string
  total_amount: number
  paid_amount: number
  status: string
}

type LineRow = {
  sale_id: number
  detail_id: number
  item_id: number
  quantity: number
  returned_qty: number
  rate: number
  sku: string
}

type Agg = {
  key: string
  label: string
  sublabel?: string
  bills: Set<number>
  lines: number
  qty: number
  amount: number
  paid: number
  due: number
  date: string
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA')
}

function thirtyDaysAgoStr() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toLocaleDateString('en-CA')
}

function money(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`
}

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function SalesExplorerPage() {
  const [fromDate, setFromDate] = useState(thirtyDaysAgoStr())
  const [toDate, setToDate] = useState(todayStr())
  const [dateMode, setDateMode] = useState<DateMode>('bill')

  const [groupBy, setGroupBy] = useState<GroupBy>('line')
  const [sortBy, setSortBy] = useState<SortBy>('date')

  const [partyId, setPartyId] = useState<string | null>(null)
  const [partyLabel, setPartyLabel] = useState<string>('')
  const [counterOnly, setCounterOnly] = useState(false)

  const [itemQuery, setItemQuery] = useState('')
  const [itemOptions, setItemOptions] = useState<
    { value: number; label: string }[]
  >([])
  const [itemId, setItemId] = useState<string | null>(null)
  const [itemLabel, setItemLabel] = useState<string>('')

  const [parties, setParties] = useState<
    { party_id: number; party_name: string }[]
  >([])

  const [sales, setSales] = useState<SaleRow[]>([])
  const [lines, setLines] = useState<LineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)
  const [editingSaleId, setEditingSaleId] = useState<number | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('parties')
        .select('party_id, party_name')
        .eq('party_type', 'Customer')
        .order('party_name')
      setParties((data as any) || [])
    })()
  }, [])

  useEffect(() => {
    loadReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, dateMode, partyId, counterOnly, itemId])

  async function loadReport() {
    setLoading(true)
    setError('')

    let salesQuery = supabase
      .from('sales')
      .select(
        'sale_id, bill_date, entry_date, party_id, total_amount, paid_amount, status'
      )
      .order('bill_date', { ascending: false })

    if (dateMode === 'bill') {
      salesQuery = salesQuery
        .gte('bill_date', fromDate)
        .lte('bill_date', toDate)
    } else {
      salesQuery = salesQuery
        .gte('entry_date', fromDate + 'T00:00:00')
        .lte('entry_date', toDate + 'T23:59:59')
    }

    if (partyId) salesQuery = salesQuery.eq('party_id', Number(partyId))

    const { data: salesData, error: salesErr } = await salesQuery
    if (salesErr) {
      setError('Could not load sales: ' + salesErr.message)
      setSales([])
      setLines([])
      setLoading(false)
      return
    }

    let salesList = ((salesData as any[]) || []) as Omit<
      SaleRow,
      'party_name'
    >[]

    if (counterOnly) {
      const counter = parties.find((p) => p.party_name === 'Counter Sale')
      if (counter) {
        salesList = salesList.filter((s) => s.party_id === counter.party_id)
      } else {
        salesList = []
      }
    }

    const saleIds = salesList.map((s) => s.sale_id)
    let linesList: LineRow[] = []
    if (saleIds.length > 0) {
      const rawLines: any[] = []
      const PAGE = 1000
      for (let from = 0; from < 200000; from += PAGE) {
        const { data, error: linesErr } = await supabase
          .from('sale_items')
          .select('sale_id, detail_id, item_id, quantity, returned_qty, rate')
          .in('sale_id', saleIds)
          .range(from, from + PAGE - 1)

        if (linesErr) {
          setError('Could not load lines: ' + linesErr.message)
          setLoading(false)
          return
        }
        if (!data || data.length === 0) break
        rawLines.push(...data)
        if (data.length < PAGE) break
      }

      const itemIds = Array.from(
        new Set(rawLines.map((l) => l.item_id).filter(Boolean))
      ) as number[]
      const { data: itemRows } = await supabase
        .from('items')
        .select('item_id, sku')
        .in('item_id', itemIds)
      const skuMap: Record<number, string> = {}
      for (const it of itemRows || []) skuMap[it.item_id] = it.sku

      linesList = rawLines.map((l) => ({
        sale_id: l.sale_id,
        detail_id: l.detail_id,
        item_id: l.item_id,
        quantity: Number(l.quantity || 0),
        returned_qty: Number(l.returned_qty || 0),
        rate: Number(l.rate || 0),
        sku: skuMap[l.item_id] || '(unknown)',
      }))
    }

    if (itemId) {
      const itemIdNum = Number(itemId)
      const matchingSaleIds = new Set(
        linesList.filter((l) => l.item_id === itemIdNum).map((l) => l.sale_id)
      )
      salesList = salesList.filter((s) => matchingSaleIds.has(s.sale_id))
      linesList = linesList.filter((l) => l.item_id === itemIdNum)
    }

    const partyMap: Record<number, string> = {}
    for (const p of parties) partyMap[p.party_id] = p.party_name

    const enriched: SaleRow[] = salesList.map((s) => ({
      ...s,
      party_name: partyMap[s.party_id] || `Party #${s.party_id}`,
    }))

    setSales(enriched)
    setLines(linesList)
    setLoading(false)
  }

  async function handleItemSearch(q: string) {
    setItemQuery(q)
    if (q.trim().length < 2) {
      setItemOptions([])
      return
    }
    const results = await searchItems(q)
    setItemOptions(
      (results as SearchItemResult[]).map((it) => ({
        value: it.item_id,
        label: `${it.sku} · stock ${it.current_stock}`,
      }))
    )
  }

  const linesBySale = useMemo(() => {
    const m: Record<number, LineRow[]> = {}
    for (const l of lines) {
      if (!m[l.sale_id]) m[l.sale_id] = []
      m[l.sale_id].push(l)
    }
    return m
  }, [lines])

  type FlatRow = {
    key: string
    bill_date: string
    entry_date: string | null
    detail_id: number
    party_id: number
    party_name: string
    sku: string
    qty: number
    rate: number
    amount: number
    sale_id: number
  }

  const flatRows: FlatRow[] = useMemo(() => {
    if (groupBy !== 'line') return []
    const salesById: Record<number, SaleRow> = {}
    for (const s of sales) salesById[s.sale_id] = s
    const out: FlatRow[] = []
    for (const l of lines) {
      const s = salesById[l.sale_id]
      if (!s) continue
      const net = Math.max(0, l.quantity - l.returned_qty)
      if (net <= 0) continue
      out.push({
        key: `line-${l.detail_id}`,
        bill_date: s.bill_date,
        entry_date: s.entry_date,
        detail_id: l.detail_id,
        party_id: s.party_id,
        party_name: s.party_name,
        sku: l.sku,
        qty: net,
        rate: l.rate,
        amount: net * l.rate,
        sale_id: l.sale_id,
      })
    }
    return out
  }, [lines, sales, groupBy])

  const sortedFlat = useMemo(() => {
    const copy = [...flatRows]
    if (sortBy === 'qty') {
      copy.sort((a, b) => b.qty - a.qty)
    } else if (sortBy === 'amount') {
      copy.sort((a, b) => b.amount - a.amount)
    } else if (sortBy === 'entry') {
      copy.sort((a, b) => {
        const ea = a.entry_date || ''
        const eb = b.entry_date || ''
        if (ea !== eb) return ea < eb ? 1 : -1
        return b.detail_id - a.detail_id
      })
    } else {
      copy.sort((a, b) => (a.bill_date < b.bill_date ? 1 : -1))
    }
    return copy
  }, [flatRows, sortBy])

  const aggregated: Agg[] = useMemo(() => {
    if (groupBy === 'line') return []

    if (groupBy === 'bill') {
      return sales.map((s) => {
        const ls = linesBySale[s.sale_id] || []
        const qty = ls.reduce(
          (sum, l) => sum + Math.max(0, l.quantity - l.returned_qty),
          0
        )
        const due = Number(s.total_amount) - Number(s.paid_amount || 0)
        return {
          key: `bill-${s.sale_id}`,
          label: `#${s.sale_id} · ${s.party_name}`,
          sublabel: formatDate(s.bill_date),
          bills: new Set([s.sale_id]),
          lines: ls.length,
          qty,
          amount: Number(s.total_amount),
          paid: Number(s.paid_amount || 0),
          due,
          date: s.bill_date,
        }
      })
    }

    if (groupBy === 'day') {
      const m: Record<string, Agg> = {}
      for (const s of sales) {
        const d = s.bill_date
        if (!m[d]) {
          m[d] = {
            key: `day-${d}`,
            label: formatDate(d),
            bills: new Set(),
            lines: 0,
            qty: 0,
            amount: 0,
            paid: 0,
            due: 0,
            date: d,
          }
        }
        m[d].bills.add(s.sale_id)
        m[d].amount += Number(s.total_amount)
        m[d].paid += Number(s.paid_amount || 0)
        m[d].due += Number(s.total_amount) - Number(s.paid_amount || 0)
        const ls = linesBySale[s.sale_id] || []
        m[d].lines += ls.length
        m[d].qty += ls.reduce(
          (sum, l) => sum + Math.max(0, l.quantity - l.returned_qty),
          0
        )
      }
      return Object.values(m)
    }

    if (groupBy === 'party') {
      const m: Record<number, Agg> = {}
      for (const s of sales) {
        if (!m[s.party_id]) {
          m[s.party_id] = {
            key: `party-${s.party_id}`,
            label: s.party_name,
            bills: new Set(),
            lines: 0,
            qty: 0,
            amount: 0,
            paid: 0,
            due: 0,
            date: '',
          }
        }
        m[s.party_id].bills.add(s.sale_id)
        m[s.party_id].amount += Number(s.total_amount)
        m[s.party_id].paid += Number(s.paid_amount || 0)
        m[s.party_id].due +=
          Number(s.total_amount) - Number(s.paid_amount || 0)
        const ls = linesBySale[s.sale_id] || []
        m[s.party_id].lines += ls.length
        m[s.party_id].qty += ls.reduce(
          (sum, l) => sum + Math.max(0, l.quantity - l.returned_qty),
          0
        )
      }
      return Object.values(m)
    }

    const m: Record<number, Agg> = {}
    for (const l of lines) {
      const net = Math.max(0, l.quantity - l.returned_qty)
      if (net <= 0) continue
      if (!m[l.item_id]) {
        m[l.item_id] = {
          key: `item-${l.item_id}`,
          label: l.sku,
          bills: new Set(),
          lines: 0,
          qty: 0,
          amount: 0,
          paid: 0,
          due: 0,
          date: '',
        }
      }
      m[l.item_id].bills.add(l.sale_id)
      m[l.item_id].lines += 1
      m[l.item_id].qty += net
      m[l.item_id].amount += net * l.rate
    }
    return Object.values(m)
  }, [sales, lines, linesBySale, groupBy])

  const sortedAgg = useMemo(() => {
    const copy = [...aggregated]
    if (sortBy === 'qty') copy.sort((a, b) => b.qty - a.qty)
    else if (sortBy === 'amount') copy.sort((a, b) => b.amount - a.amount)
    else copy.sort((a, b) => (a.date < b.date ? 1 : -1))
    return copy
  }, [aggregated, sortBy])

  const totals = useMemo(() => {
    if (groupBy === 'line') {
      return flatRows.reduce(
        (acc, r) => ({
          bills: acc.bills + 1,
          lines: acc.lines + 1,
          qty: acc.qty + r.qty,
          amount: acc.amount + r.amount,
          paid: acc.paid,
          due: acc.due,
        }),
        { bills: 0, lines: 0, qty: 0, amount: 0, paid: 0, due: 0 }
      )
    }
    return aggregated.reduce(
      (acc, a) => ({
        bills: acc.bills + a.bills.size,
        lines: acc.lines + a.lines,
        qty: acc.qty + a.qty,
        amount: acc.amount + a.amount,
        paid: acc.paid + a.paid,
        due: acc.due + a.due,
      }),
      { bills: 0, lines: 0, qty: 0, amount: 0, paid: 0, due: 0 }
    )
  }, [aggregated, flatRows, groupBy])

  function setRange(mode: 'today' | 'week' | 'month' | 'last_month') {
    const t = todayStr()
    if (mode === 'today') {
      setFromDate(t)
      setToDate(t)
    } else if (mode === 'week') {
      const d = new Date()
      const day = d.getDay()
      const diff = d.getDate() - day
      const start = new Date(d.setDate(diff))
      setFromDate(start.toLocaleDateString('en-CA'))
      setToDate(t)
    } else if (mode === 'month') {
      const d = new Date()
      const fm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      setFromDate(fm)
      setToDate(t)
    } else {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - 1)
      const fm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      const lm = lastDay.toLocaleDateString('en-CA')
      setFromDate(fm)
      setToDate(lm)
    }
  }

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function copySummary() {
    const lines: string[] = []
    lines.push(
      `Sales Explorer — ${formatDate(fromDate)} to ${formatDate(toDate)}`
    )
    lines.push(`Grouped by: ${groupBy}`)
    lines.push(
      `Bills: ${totals.bills} · Lines: ${totals.lines} · Qty: ${totals.qty}`
    )
    lines.push(`Total: ${money(totals.amount)} · Due: ${money(totals.due)}`)
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-xs sm:text-sm text-slate-500 hover:text-slate-800 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All reports
        </Link>

        <div className="mb-4 sm:mb-6">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 sm:w-6 sm:h-6 text-slate-700" />
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Sales Explorer
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Every sale line in the range — date, party, item, qty, rate,
            amount. Filter and regroup as needed.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-4">
          <div className="flex items-center gap-2 text-slate-700 mb-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span className="text-xs sm:text-sm font-medium">Date range</span>
            {loading && (
              <span className="text-[10px] text-slate-400 ml-auto">
                Loading…
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mb-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="flex-1 h-9 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
            />
            <span className="text-slate-400 text-sm shrink-0">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="flex-1 h-9 px-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
            />
          </div>

          <div className="flex flex-wrap gap-1.5 mb-2">
            <button
              onClick={() => setRange('today')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Today
            </button>
            <button
              onClick={() => setRange('week')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              This Week
            </button>
            <button
              onClick={() => setRange('month')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              This Month
            </button>
            <button
              onClick={() => setRange('last_month')}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Last Month
            </button>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <span className="text-xs text-slate-500">Filter by:</span>
            <button
              onClick={() => setDateMode('bill')}
              className={`h-7 px-2.5 text-xs font-medium rounded-lg ${
                dateMode === 'bill'
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Bill Date
            </button>
            <button
              onClick={() => setDateMode('entry')}
              className={`h-7 px-2.5 text-xs font-medium rounded-lg ${
                dateMode === 'entry'
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Entry Date
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Party
            </label>
            <SmartCombobox
              options={parties.map((p) => ({
                value: p.party_id,
                label: p.party_name,
              }))}
              value={partyId}
              onValueChange={(v, label) => {
                setPartyId(v || null)
                setPartyLabel(label || '')
              }}
              placeholder="All parties — type to filter..."
              allowCreate={false}
              fallbackLabel={partyLabel || null}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Item
            </label>
            <SmartCombobox
              options={itemOptions}
              value={itemId}
              onValueChange={(v, label) => {
                setItemId(v || null)
                setItemLabel(label || '')
              }}
              onSearch={handleItemSearch}
              placeholder="Any item — type 2+ letters..."
              allowCreate={false}
              fallbackLabel={itemLabel || null}
            />
            {itemId && (
              <button
                onClick={() => {
                  setItemId(null)
                  setItemLabel('')
                  setItemQuery('')
                  setItemOptions([])
                }}
                className="text-[11px] text-slate-500 hover:text-slate-700 mt-1"
              >
                Clear item filter
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={counterOnly}
              onChange={(e) => setCounterOnly(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300"
            />
            <span>Counter Sale only</span>
          </label>
        </div>

        <div className="bg-gradient-to-r from-slate-700 to-slate-900 rounded-2xl p-4 sm:p-5 shadow-sm mb-4 text-white">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-xs sm:text-sm">
            <div>
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Lines
              </div>
              <div className="text-base sm:text-xl font-bold mt-0.5">
                {totals.lines}
              </div>
            </div>
            <div>
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Qty
              </div>
              <div className="text-base sm:text-xl font-bold mt-0.5">
                {totals.qty}
              </div>
            </div>
            <div>
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Total
              </div>
              <div className="text-base sm:text-xl font-bold mt-0.5">
                {money(totals.amount)}
              </div>
            </div>
            <div>
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Paid
              </div>
              <div className="text-base sm:text-xl font-bold mt-0.5">
                {money(totals.paid)}
              </div>
            </div>
            <div>
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Due
              </div>
              <div className="text-base sm:text-xl font-bold mt-0.5">
                {money(totals.due)}
              </div>
            </div>
            <div>
              <div className="text-[10px] sm:text-xs text-white/70 uppercase tracking-wide">
                Bills
              </div>
              <div className="text-base sm:text-xl font-bold mt-0.5">
                {totals.bills}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/20">
            <div className="text-[10px] sm:text-xs text-white/70">
              {formatDate(fromDate)} – {formatDate(toDate)} ·{' '}
              {dateMode === 'bill' ? 'Bill Date' : 'Entry Date'}
            </div>
            <button
              onClick={copySummary}
              className="flex items-center gap-1 text-[11px] sm:text-xs font-medium text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg px-2.5 py-1"
            >
              <Copy className="w-3 h-3" />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-slate-500">Group:</span>
          {(['line', 'day', 'party', 'item', 'bill'] as GroupBy[]).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={`h-8 px-3 text-xs font-semibold rounded-lg capitalize ${
                groupBy === g
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {g}
            </button>
          ))}
          <span className="text-xs text-slate-500 ml-2">Sort:</span>
          {(
            [
              ['date', 'Date'],
              ['entry', 'Entry time'],
              ['qty', 'Qty'],
              ['amount', 'Amount'],
            ] as [SortBy, string][]
          ).map(([s, label]) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`h-8 px-3 text-xs font-semibold rounded-lg ${
                sortBy === s
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800 mb-4">
            {error}
          </div>
        )}

        {groupBy === 'line' ? (
          loading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
              Loading…
            </div>
          ) : sortedFlat.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
              <Receipt className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <div className="text-sm font-medium text-slate-600">
                No sales found.
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Try widening the date range or clearing filters.
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
                <div className="col-span-2">Date</div>
                <div className="col-span-3">Party</div>
                <div className="col-span-4">SKU</div>
                <div className="col-span-1 text-right">Qty</div>
                <div className="col-span-1 text-right">Rate</div>
                <div className="col-span-1 text-right">Amount</div>
              </div>
              <div className="divide-y divide-slate-100">
                {sortedFlat.map((r) => (
                  <div
                    key={r.key}
                    className="px-3 sm:px-4 py-2.5 grid grid-cols-12 gap-2 items-center text-sm"
                  >
                    <div className="col-span-3 sm:col-span-2 text-[11px] sm:text-xs text-slate-500">
                      {formatDate(r.bill_date)}
                      {sortBy === 'entry' && r.entry_date && (
                        <div className="text-[10px] text-slate-400">
                          {new Date(r.entry_date).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      )}
                    </div>
                    <div className="col-span-9 sm:col-span-3 text-xs sm:text-sm text-slate-700 truncate">
                      {r.party_name}
                    </div>
                    <div className="col-span-12 sm:col-span-4 font-mono text-[11px] sm:text-xs text-slate-800 truncate">
                      {r.sku}
                    </div>
                    <div className="col-span-4 sm:col-span-1 text-right text-xs sm:text-sm font-semibold text-slate-800">
                      {r.qty}
                    </div>
                    <div className="col-span-4 sm:col-span-1 text-right text-xs sm:text-sm text-slate-700">
                      {money(r.rate)}
                    </div>
                    <div className="col-span-4 sm:col-span-1 text-right text-xs sm:text-sm font-bold text-slate-900">
                      {money(r.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
            Loading…
          </div>
        ) : sortedAgg.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <Receipt className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-600">
              No sales found.
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Try widening the date range or clearing filters.
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
              <div className="col-span-4">
                {groupBy === 'item'
                  ? 'SKU'
                  : groupBy === 'party'
                  ? 'Party'
                  : groupBy === 'day'
                  ? 'Date'
                  : 'Bill'}
              </div>
              <div className="col-span-2 text-right">Bills</div>
              <div className="col-span-1 text-right">Qty</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-2 text-right">Due</div>
              <div className="col-span-1"></div>
            </div>
            <div className="divide-y divide-slate-100">
              {sortedAgg.map((a) => {
                const isOpen = !!expandedKeys[a.key]
                const showExpand = groupBy !== 'bill'
                return (
                  <div key={a.key}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => showExpand && toggleExpand(a.key)}
                      onKeyDown={(e) => {
                        if (
                          (e.key === 'Enter' || e.key === ' ') &&
                          showExpand
                        ) {
                          e.preventDefault()
                          toggleExpand(a.key)
                        }
                      }}
                      className={`w-full px-3 sm:px-4 py-3 grid grid-cols-12 gap-2 items-center text-left ${
                        showExpand ? 'hover:bg-slate-50 cursor-pointer' : ''
                      }`}
                    >
                      <div className="col-span-8 sm:col-span-4 min-w-0 flex items-center gap-1.5">
                        {showExpand && (
                          <span className="text-slate-400 shrink-0">
                            {isOpen ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">
                            {a.label}
                          </div>
                          {a.sublabel && (
                            <div className="text-[11px] text-slate-500">
                              {a.sublabel}
                            </div>
                          )}
                          <div className="sm:hidden text-[11px] text-slate-500 mt-0.5">
                            {a.bills.size} bill{a.bills.size === 1 ? '' : 's'} ·{' '}
                            {a.qty} qty · {money(a.amount)}
                          </div>
                        </div>
                      </div>
                      <div className="hidden sm:block col-span-2 text-right text-sm text-slate-700">
                        {a.bills.size}
                      </div>
                      <div className="hidden sm:block col-span-1 text-right text-sm font-semibold text-slate-800">
                        {a.qty}
                      </div>
                      <div className="hidden sm:block col-span-2 text-right text-sm font-bold text-slate-900">
                        {money(a.amount)}
                      </div>
                      <div className="hidden sm:block col-span-2 text-right text-sm font-medium text-rose-700">
                        {a.due > 0 ? money(a.due) : '—'}
                      </div>
                      <div className="flex col-span-1 justify-end gap-1">
                        {groupBy === 'party' && (
                          <Link
                            href={`/parties/${a.key.replace('party-', '')}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] text-slate-600 hover:text-slate-900 font-medium"
                          >
                            Open ›
                          </Link>
                        )}
                        {groupBy === 'bill' && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingSaleId(
                                Number(a.key.replace('bill-', ''))
                              )
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                e.stopPropagation()
                                setEditingSaleId(
                                  Number(a.key.replace('bill-', ''))
                                )
                              }
                            }}
                            className="p-1.5 text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer"
                            aria-label="Edit bill"
                          >
                            <Pencil className="w-4 h-4" />
                          </span>
                        )}
                      </div>
                    </div>

                    {isOpen && showExpand && (
                      <div className="bg-slate-50 border-t border-slate-100 px-3 sm:px-4 py-2 space-y-1">
                        {Array.from(a.bills).map((bid) => {
                          const bill = sales.find((s) => s.sale_id === bid)
                          if (!bill) return null
                          return (
                            <div
                              key={bid}
                              className="flex items-center gap-2 text-xs py-1"
                            >
                              <div className="text-slate-500 w-16 shrink-0">
                                #{bill.sale_id}
                              </div>
                              <div className="text-slate-600 flex-1 truncate">
                                {bill.party_name}
                              </div>
                              <div className="text-slate-500 w-20 shrink-0 text-right">
                                {formatDate(bill.bill_date)}
                              </div>
                              <div className="font-semibold text-slate-800 w-20 shrink-0 text-right">
                                {money(Number(bill.total_amount))}
                              </div>
                              <Link
                                href={`/parties/${bill.party_id}`}
                                className="text-[11px] text-slate-600 hover:text-slate-900 font-medium shrink-0"
                              >
                                Open ›
                              </Link>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {editingSaleId !== null && (
        <SaleEditModal
          saleId={editingSaleId}
          onClose={() => setEditingSaleId(null)}
          onSaved={() => {
            setEditingSaleId(null)
            loadReport()
          }}
        />
      )}
    </div>
  )
}