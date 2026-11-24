
'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { searchItems, SearchItemResult } from '../../lib/item-search'
import {
  Save,
  X,
  Calendar,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
}

type SaleHeader = {
  sale_id: number
  party_id: number
  bill_date: string
  total_amount: number
  status: string
  party_name: string
}

type SaleItem = {
  detail_id: number
  sale_id: number
  item_id: number
  quantity: number
  rate: number
  amount: number
  returned_qty: number
  sku: string
}

type ReturnRow = {
  rowId: number
  detail_id: number
  item_id: number
  sku: string
  original_qty: number
  already_returned: number
  rate: number
  return_qty: number
  reason: string
  is_sellable: boolean
}

type Notice = {
  type: 'success' | 'error'
  text: string
}

const REASONS: { label: string; sellable: boolean }[] = [
  { label: 'Wrong Item', sellable: true },
  { label: 'Version Mismatch', sellable: true },
  { label: 'Costly', sellable: true },
  { label: 'Faulty', sellable: false },
  { label: 'Other', sellable: false },
]

const DEFAULT_REASON = 'Wrong Item'

function todayStr() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)

  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export default function SalesReturnPage() {
  // Filters
  const [fromDate, setFromDate] = useState(addDays(todayStr(), -30))
  const [toDate, setToDate] = useState(todayStr())
  const [partyId, setPartyId] = useState<string | null>(null)
  const [partyLabel, setPartyLabel] = useState('')
  const [itemId, setItemId] = useState<string | null>(null)
  const [itemLabel, setItemLabel] = useState('')
  const [itemOptions, setItemOptions] = useState<
    { value: number; label: string }[]
  >([])

  // Data
  const [parties, setParties] = useState<Party[]>([])
  const [matchingSales, setMatchingSales] = useState<SaleHeader[]>([])
  const [expandedSaleId, setExpandedSaleId] = useState<number | null>(null)
  const [itemsBySale, setItemsBySale] = useState<
    Record<number, SaleItem[]>
  >({})
  const [todayReturns, setTodayReturns] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  // Return basket
  const [checkedDetailIds, setCheckedDetailIds] = useState<number[]>([])
  const [rows, setRows] = useState<ReturnRow[]>([])
  const [nextRowId, setNextRowId] = useState(1)
  const [returnDate, setReturnDate] = useState(todayStr())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadBase().catch((error) => {
      setNotice({
        type: 'error',
        text: 'Could not load customers and returns: ' + errorMessage(error),
      })
    })
  }, [])

  useEffect(() => {
    if (parties.length === 0) return

    search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, partyId, itemId, parties.length])

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function loadBase() {
    const today = todayStr()

    const [p, r] = await Promise.all([
      supabase
        .from('parties')
        .select('party_id, party_name, party_type, current_balance')
        .eq('party_type', 'Customer')
        .order('party_name'),

      supabase
        .from('returns')
        .select('*')
        .eq('return_date', today)
        .eq('return_type', 'Customer')
        .order('return_id', { ascending: false }),
    ])

    if (p.error) {
      throw new Error('Customer loading failed: ' + p.error.message)
    }

    if (r.error) {
      throw new Error('Returns loading failed: ' + r.error.message)
    }

    setParties((p.data as Party[]) || [])
    setTodayReturns(r.data || [])
  }

  async function handleItemSearch(q: string) {
    if (q.trim().length < 2) {
      setItemOptions([])
      return
    }

    try {
      const results = await searchItems(q)

      setItemOptions(
        (results as SearchItemResult[]).map((it) => ({
          value: it.item_id,
          label: `${it.sku} · stock ${it.current_stock}`,
        }))
      )
    } catch (error) {
      setNotice({
        type: 'error',
        text: 'Item search failed: ' + errorMessage(error),
      })
      setItemOptions([])
    }
  }

  async function search(clearNotice = true) {
    setLoading(true)

    if (clearNotice) setNotice(null)

    try {
      if (!fromDate || !toDate) {
        setMatchingSales([])
        setItemsBySale({})
        return
      }

      if (fromDate > toDate) {
        setMatchingSales([])
        setItemsBySale({})
        setNotice({
          type: 'error',
          text: 'From Date cannot be later than To Date.',
        })
        return
      }

      let q = supabase
        .from('sales')
        .select('sale_id, party_id, bill_date, total_amount, status')
        .gte('bill_date', fromDate)
        .lte('bill_date', toDate)
        .order('bill_date', { ascending: false })
        .order('sale_id', { ascending: false })

      if (partyId) {
        q = q.eq('party_id', Number(partyId))
      }

      const { data: salesData, error } = await q

      if (error) {
        throw new Error('Sales search failed: ' + error.message)
      }

      let salesList = salesData || []
      const saleIds = salesList.map((s) => s.sale_id)

      const itemsMap: Record<number, SaleItem[]> = {}

      if (saleIds.length > 0) {
        const CHUNK = 80
        const allLines: any[] = []

        for (let i = 0; i < saleIds.length; i += CHUNK) {
          const slice = saleIds.slice(i, i + CHUNK)

          const { data: chunkData, error: chunkError } =
            await supabase
              .from('sale_items')
              .select(
                'detail_id, sale_id, item_id, quantity, rate, amount, returned_qty'
              )
              .in('sale_id', slice)

          if (chunkError) {
            throw new Error(
              'Invoice items loading failed: ' + chunkError.message
            )
          }

          allLines.push(...(chunkData || []))
        }

        const itemIds = Array.from(
          new Set(
            allLines
              .map((l) => Number(l.item_id))
              .filter((id) => Number.isFinite(id) && id > 0)
          )
        )

        const skuMap: Record<number, string> = {}

        if (itemIds.length > 0) {
          const { data: itemRows, error: itemError } = await supabase
            .from('items')
            .select('item_id, sku')
            .in('item_id', itemIds)

          if (itemError) {
            throw new Error(
              'Item SKU loading failed: ' + itemError.message
            )
          }

          for (const it of itemRows || []) {
            skuMap[it.item_id] = it.sku
          }
        }

        for (const l of allLines) {
          const sid = Number(l.sale_id)

          if (!itemsMap[sid]) {
            itemsMap[sid] = []
          }

          itemsMap[sid].push({
            detail_id: Number(l.detail_id),
            sale_id: sid,
            item_id: Number(l.item_id),
            quantity: Number(l.quantity),
            rate: Number(l.rate),
            amount: Number(l.amount),
            returned_qty: Number(l.returned_qty || 0),
            sku: skuMap[l.item_id] || `Item #${l.item_id}`,
          })
        }
      }

      // Item filter
      if (itemId) {
        const itemIdNum = Number(itemId)

        salesList = salesList.filter((s) => {
          const lines = itemsMap[s.sale_id] || []
          return lines.some((l) => l.item_id === itemIdNum)
        })
      }

      // Add customer names
      const partyMap: Record<number, string> = {}

      for (const p of parties) {
        partyMap[p.party_id] = p.party_name
      }

      const enriched: SaleHeader[] = salesList.map((s) => ({
        sale_id: Number(s.sale_id),
        party_id: Number(s.party_id),
        bill_date: s.bill_date,
        total_amount: Number(s.total_amount),
        status: s.status,
        party_name: partyMap[s.party_id] || `Party #${s.party_id}`,
      }))

      setMatchingSales(enriched)
      setItemsBySale(itemsMap)
    } catch (error) {
      setMatchingSales([])
      setItemsBySale({})

      setNotice({
        type: 'error',
        text: errorMessage(error),
      })
    } finally {
      setLoading(false)
    }
  }

  function toggleSaleExpand(saleId: number) {
    setExpandedSaleId(
      expandedSaleId === saleId ? null : saleId
    )
  }

  function toggleChecked(si: SaleItem, sale: SaleHeader) {
    const remaining = si.quantity - si.returned_qty

    if (remaining <= 0 || saving) return

    const isChecked = checkedDetailIds.includes(si.detail_id)

    if (isChecked) {
      setCheckedDetailIds((prev) =>
        prev.filter((d) => d !== si.detail_id)
      )

      setRows((prev) =>
        prev.filter((r) => r.detail_id !== si.detail_id)
      )
    } else {
      setCheckedDetailIds((prev) => [...prev, si.detail_id])

      setRows((prev) => [
        ...prev,
        {
          rowId: nextRowId,
          detail_id: si.detail_id,
          item_id: si.item_id,
          sku: si.sku,
          original_qty: si.quantity,
          already_returned: si.returned_qty,
          rate: si.rate,
          return_qty: 1,
          reason: DEFAULT_REASON,
          is_sellable: true,
        },
      ])

      setNextRowId((n) => n + 1)
    }
  }

  function updateRow(rowId: number, patch: Partial<ReturnRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r

        const merged = { ...r, ...patch }

        if (patch.reason) {
          const reasonObj = REASONS.find(
            (x) => x.label === patch.reason
          )

          if (reasonObj) {
            merged.is_sellable = reasonObj.sellable
          }
        }

        return merged
      })
    )
  }

  function removeRow(rowId: number, detailId: number) {
    setRows((prev) =>
      prev.filter((r) => r.rowId !== rowId)
    )

    setCheckedDetailIds((prev) =>
      prev.filter((d) => d !== detailId)
    )
  }

  const totalReturnValue = rows.reduce(
    (s, r) => s + r.return_qty * r.rate,
    0
  )

  async function saveReturn() {
    if (saving) return

    setNotice(null)

    if (!returnDate) {
      setNotice({
        type: 'error',
        text: 'Please select a return date.',
      })
      return
    }

    if (returnDate > todayStr()) {
      setNotice({
        type: 'error',
        text: 'Return date cannot be in the future.',
      })
      return
    }

    if (rows.length === 0) {
      setNotice({
        type: 'error',
        text: 'Select at least one item to return.',
      })
      return
    }

    // Validate every row
    for (const r of rows) {
      const maxQty = r.original_qty - r.already_returned

      if (
        !Number.isInteger(r.return_qty) ||
        r.return_qty <= 0 ||
        r.return_qty > maxQty
      ) {
        setNotice({
          type: 'error',
          text: `Invalid return quantity for ${r.sku}. Maximum allowed quantity is ${maxQty}.`,
        })
        return
      }

      if (!r.reason.trim()) {
        setNotice({
          type: 'error',
          text: `Please select a return reason for ${r.sku}.`,
        })
        return
      }
    }

    const partyIds = new Set<number>()

    for (const r of rows) {
      const matchingSale = matchingSales.find((s) =>
        (itemsBySale[s.sale_id] || []).some(
          (l) => l.detail_id === r.detail_id
        )
      )

      if (!matchingSale) {
        setNotice({
          type: 'error',
          text: `Could not find the original invoice for ${r.sku}. Search again before saving.`,
        })
        return
      }

      partyIds.add(matchingSale.party_id)
    }

    if (partyIds.size > 1) {
      setNotice({
        type: 'error',
        text: 'All items in a return must be from the same customer.',
      })
      return
    }

    const returnPartyId = Array.from(partyIds)[0]

    if (!returnPartyId) {
      setNotice({
        type: 'error',
        text: 'Could not determine customer.',
      })
      return
    }

    setSaving(true)

    try {
      // The database gets the original rate from sale_items.
      // Do not send a browser-calculated rate as the accounting value.
      const returnRows = rows.map((r) => ({
        detail_id: r.detail_id,
        item_id: r.item_id,
        quantity: r.return_qty,
        is_sellable: r.is_sellable,
        reason: r.reason,
      }))

      const { data, error } = await supabase.rpc(
        'save_customer_return',
        {
          p_party_id: returnPartyId,
          p_return_date: returnDate,
          p_rows: returnRows,
        }
      )

      if (error) {
        setNotice({
          type: 'error',
          text:
            'Return save could not be confirmed. Do NOT submit it again until you check the Sales Return records. Database error: ' +
            error.message,
        })
        return
      }

      if (!data || data.success !== true) {
        setNotice({
          type: 'error',
          text:
            'Return save could not be confirmed. Do NOT submit it again until you check the Sales Return records.',
        })
        return
      }

      const savedTotal = Number(data.total_return_value)
      const newBalance = Number(data.new_balance)

      if (
        !Number.isFinite(savedTotal) ||
        !Number.isFinite(newBalance)
      ) {
        setNotice({
          type: 'error',
          text:
            'The database reported a successful return but returned an unexpected balance response. Check the Sales Return records before submitting again.',
        })
        return
      }

      // Clear basket only after database confirms success.
      setCheckedDetailIds([])
      setRows([])
      setExpandedSaleId(null)

      setNotice({
        type: 'success',
        text:
          `Return saved successfully: ₹${savedTotal.toFixed(2)}. ` +
          `Customer balance: ₹${newBalance.toFixed(2)}.`,
      })

      // Refresh separately. A refresh failure does not undo a saved return.
      try {
        await loadBase()
        await search(false)
      } catch (refreshError) {
        setNotice({
          type: 'success',
          text:
            `Return saved successfully: ₹${savedTotal.toFixed(2)}. ` +
            `Customer balance: ₹${newBalance.toFixed(2)}. ` +
            `However, the page could not refresh. Please refresh manually. ` +
            errorMessage(refreshError),
        })
      }
    } catch (error) {
      setNotice({
        type: 'error',
        text:
          'Return save could not be confirmed. Do NOT submit it again until you check the Sales Return records. Details: ' +
          errorMessage(error),
      })
    } finally {
      setSaving(false)
    }
  }

  function clearFilters() {
    setPartyId(null)
    setPartyLabel('')
    setItemId(null)
    setItemLabel('')
    setItemOptions([])
    setFromDate(addDays(todayStr(), -30))
    setToDate(todayStr())
  }

  function setRange(mode: 'today' | 'yesterday' | 'week' | 'month') {
    const t = todayStr()

    if (mode === 'today') {
      setFromDate(t)
      setToDate(t)
    } else if (mode === 'yesterday') {
      const y = addDays(t, -1)
      setFromDate(y)
      setToDate(y)
    } else if (mode === 'week') {
      setFromDate(addDays(t, -6))
      setToDate(t)
    } else {
      setFromDate(addDays(t, -29))
      setToDate(t)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">
              Sales Return
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Filter by date, customer, or item. Tap any bill to expand and pick items.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-medium text-slate-600 mb-1">
              Return Date
            </label>
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              max={todayStr()}
              disabled={saving}
              className="h-10 px-2 text-sm border border-slate-300 rounded-lg bg-white"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700 mb-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span>Date range</span>

            {loading && (
              <span className="text-[10px] text-slate-400 ml-auto">
                Searching…
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mb-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="flex-1 h-10 px-2 text-sm border border-slate-300 rounded-lg bg-white"
            />

            <span className="text-slate-400 text-sm">to</span>

            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="flex-1 h-10 px-2 text-sm border border-slate-300 rounded-lg bg-white"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['today', 'yesterday', 'week', 'month'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setRange(m)}
                className="h-7 px-2.5 text-xs font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200"
              >
                {m === 'today'
                  ? 'Today'
                  : m === 'yesterday'
                    ? 'Yesterday'
                    : m === 'week'
                      ? 'This Week'
                      : 'This Month'}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-sm mb-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Customer (optional)
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
              placeholder="All customers"
              allowCreate={false}
              fallbackLabel={partyLabel || null}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Item SKU (optional)
            </label>

            <SmartCombobox
              options={itemOptions}
              value={itemId}
              onValueChange={(v, label) => {
                setItemId(v || null)
                setItemLabel(label || '')
              }}
              onSearch={handleItemSearch}
              placeholder="Search by SKU…"
              allowCreate={false}
              fallbackLabel={itemLabel || null}
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={clearFilters}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear filters
            </button>
          </div>
        </div>

        {notice && (
          <div
            className={`mb-3 rounded-lg p-3 text-sm border ${
              notice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* Matching sales */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            Matching bills ({matchingSales.length})
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400">
              Searching…
            </div>
          ) : matchingSales.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              No bills found
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {matchingSales.map((s) => {
                const isExpanded = expandedSaleId === s.sale_id
                const lines = itemsBySale[s.sale_id] || []

                return (
                  <div key={s.sale_id}>
                    <button
                      onClick={() => toggleSaleExpand(s.sale_id)}
                      className="w-full px-3 py-2.5 text-left hover:bg-slate-50 flex items-center gap-2"
                    >
                      <div className="shrink-0 text-slate-400">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          #{s.sale_id} · {s.bill_date}
                        </div>

                        <div className="text-xs text-slate-500">
                          {s.party_name} · {lines.length} line
                          {lines.length === 1 ? '' : 's'}
                        </div>
                      </div>

                      <div className="text-sm font-bold text-slate-900">
                        ₹{s.total_amount.toFixed(2)}
                      </div>

                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${
                          s.status === 'Paid'
                            ? 'bg-emerald-100 text-emerald-700'
                            : s.status === 'Partially Paid'
                              ? 'border border-orange-200 bg-orange-100 text-orange-700'
                              : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {s.status}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100 px-3 py-2 space-y-1.5">
                        {lines.map((l) => {
                          const remaining = l.quantity - l.returned_qty
                          const fullyReturned = remaining <= 0
                          const checked = checkedDetailIds.includes(l.detail_id)

                          return (
                            <label
                              key={l.detail_id}
                              className={`flex items-center gap-2 px-2 py-2 rounded border ${
                                fullyReturned
                                  ? 'bg-slate-100 opacity-60'
                                  : checked
                                    ? 'bg-blue-50 border-blue-300'
                                    : 'bg-white border-slate-200'
                              } ${
                                fullyReturned
                                  ? ''
                                  : 'cursor-pointer hover:border-slate-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={fullyReturned || saving}
                                onChange={() => toggleChecked(l, s)}
                                className="size-4 accent-blue-600"
                              />

                              <span className="flex-1 font-mono text-xs text-slate-800 break-all">
                                {l.sku}
                              </span>

                              <span className="text-[10px] text-slate-500 whitespace-nowrap">
                                Qty {l.quantity}
                                {l.returned_qty > 0 &&
                                  ` · ret ${l.returned_qty} · left ${remaining}`}
                              </span>

                              <span className="text-xs text-slate-700 whitespace-nowrap">
                                ₹{l.rate.toFixed(2)}
                              </span>

                              {fullyReturned && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                  DONE
                                </span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Return basket */}
        {rows.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
            <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 text-xs font-semibold text-blue-800">
              Items to return ({rows.length})
            </div>

            <div className="divide-y divide-slate-100">
              {rows.map((r) => {
                const maxQty = r.original_qty - r.already_returned

                return (
                  <div key={r.rowId} className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs text-slate-800 break-all">
                          {r.sku}
                        </div>

                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Bill Qty {r.original_qty}
                          {r.already_returned > 0 &&
                            ` · already returned ${r.already_returned}`}
                          {' · '}Rate ₹{r.rate.toFixed(2)}
                        </div>
                      </div>

                      <button
                        onClick={() => removeRow(r.rowId, r.detail_id)}
                        disabled={saving}
                        className="p-1 text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">
                          Return Qty
                        </label>

                        <input
                          type="number"
                          step="1"
                          min="1"
                          max={maxQty}
                          value={r.return_qty || ''}
                          disabled={saving}
                          onChange={(e) => {
                            const raw = e.target.value

                            if (raw === '') {
                              updateRow(r.rowId, { return_qty: 0 })
                              return
                            }

                            const value = Number(raw)

                            if (!Number.isFinite(value)) return

                            updateRow(r.rowId, {
                              return_qty: Math.min(
                                Math.max(0, Math.floor(value)),
                                maxQty
                              ),
                            })
                          }}
                          className="w-full h-10 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">
                          Reason
                        </label>

                        <select
                          value={r.reason}
                          disabled={saving}
                          onChange={(e) =>
                            updateRow(r.rowId, {
                              reason: e.target.value,
                            })
                          }
                          className="w-full h-10 px-2 text-sm border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {REASONS.map((rs) => (
                            <option key={rs.label} value={rs.label}>
                              {rs.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={`font-medium px-2 py-0.5 rounded ${
                          r.is_sellable
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {r.is_sellable ? 'Sellable' : 'Faulty'}
                      </span>

                      <span className="font-bold text-slate-900">
                        ₹{(r.return_qty * r.rate).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <div className="text-sm font-bold text-blue-800">
                ₹{totalReturnValue.toFixed(2)}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setRows([])
                    setCheckedDetailIds([])
                  }}
                  disabled={saving}
                  className="h-9 px-3 text-sm text-slate-700 border border-slate-300 rounded hover:bg-white disabled:opacity-50"
                >
                  Clear
                </button>

                <button
                  onClick={saveReturn}
                  disabled={saving}
                  className="h-9 px-4 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving…' : 'Save Return'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Today's returns */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
            Today's Returns ({todayReturns.length})
          </div>

          {todayReturns.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">
              No returns today
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {todayReturns.map((r: any) => (
                <div
                  key={r.return_id}
                  className="px-3 py-2 flex items-center gap-2 text-xs"
                >
                  <span className="text-slate-500 w-12">
                    #{r.return_id}
                  </span>

                  <span className="flex-1 text-slate-800">
                    {parties.find((p) => p.party_id === r.party_id)
                      ?.party_name || '—'}
                  </span>

                  <span className="text-slate-600">
                    {r.reason || '—'}
                  </span>

                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                      r.is_sellable
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {r.is_sellable ? 'S' : 'F'}
                  </span>

                  <span className="font-semibold text-slate-900 w-20 text-right">
                    ₹{Number(r.total_amount).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
