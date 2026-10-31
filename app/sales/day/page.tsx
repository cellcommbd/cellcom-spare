'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { SmartCombobox } from '../../../components/ui/smart-combobox'
import { NewPartyDialog } from '../../../components/ui/new-party-dialog'
import { applyFIFO } from '../../../lib/fifo'
import {
  buildStatementText,
  buildWhatsAppUrl,
  normalizePhoneForWhatsApp,
} from '../../../lib/statement-format'
import {
  Plus,
  X,
  Trash2,
  Pencil,
  RotateCcw,
  Save,
  Check,
  AlertTriangle,
  ChevronDown,
  User,
  Banknote,
  Smartphone,
  Loader2,
  Copy as CopyIcon,
  MessageCircle as MessageCircleIcon,
} from 'lucide-react'
import { searchItems as searchItemsShared } from '../../../lib/item-search'

// ============================================================
// Types
// ============================================================

type Item = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
  selling_price: number
  quality?: string | null
  variant?: string | null
}

type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
  phone: string | null
}

type DayRow = {
  rowId: number
  item_id: number | null
  sku: string
  quantity: number
  rate: number
  amount: number
  cost_at_sale: number
  party_id: number
  disabled: boolean
}

type DraftSnapshot = {
  bill_date: string
  rows: DayRow[]
  nextRowId: number
  lastPartyId: number | null
  state: 'adding' | 'closing' | 'closed' | 'error'
  lastSyncedAt: number | null
  pendingSync: boolean
}

type CloseResult = {
  party_id: number
  sale_id: number
  skipped: boolean
}

type PaymentSummaryRow = {
  party_id: number
  party_name: string
  phone: string | null
  sale_id: number
  bill_amount: number
  previous_balance: number
  total_due: number
  is_counter_sale: boolean
  amount: string
  mode: 'Cash' | 'Online'
  upiAmount: string
  cashPaid: number
  upiPaid: number
  skipped: boolean
  paid: boolean
  error: string
}

type ClosedSnapshot = {
  bill_date: string
  paymentSummary: PaymentSummaryRow[]
  daySummary: { count: number; total: number } | null
}

// ============================================================
// Constants
// ============================================================

const COUNTER_SALE_PARTY_ID = 3
const LOCAL_KEY = 'cellcom.day_sales.draft'
const LOCAL_KEY_CLOSED = 'cellcom.day_sales.closed'
const SYNC_DEBOUNCE_MS = 800
const RETRY_INTERVAL_MS = 10_000

// ============================================================
// Helpers
// ============================================================

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA')
}

function formatCurrency(n: number): string {
  return `₹ ${n.toFixed(2)}`
}

function formatDateLong(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function partyCount(rows: DayRow[]): number {
  return new Set(rows.map((r) => r.party_id)).size
}

function loadLocalDraft(): DraftSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftSnapshot
    if (parsed.bill_date !== todayStr()) return null
    return parsed
  } catch {
    return null
  }
}

function saveLocalDraft(snap: DraftSnapshot) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(snap))
  } catch {
    // ignore
  }
}

function clearLocalDraft() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(LOCAL_KEY)
  } catch {
    // ignore
  }
}

function loadClosedSnapshot(): ClosedSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LOCAL_KEY_CLOSED)
    if (!raw) return null
    return JSON.parse(raw) as ClosedSnapshot
  } catch {
    return null
  }
}

function saveClosedSnapshot(snap: ClosedSnapshot) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOCAL_KEY_CLOSED, JSON.stringify(snap))
  } catch {
    // ignore
  }
}

function clearClosedSnapshot() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(LOCAL_KEY_CLOSED)
  } catch {
    // ignore
  }
}
// ============================================================
// Component
// ============================================================

export default function DaySalesPage() {
  const router = useRouter()

  const [parties, setParties] = useState<Party[]>([])
  const [itemsCache, setItemsCache] = useState<Record<number, Item>>({})

  const [billDate, setBillDate] = useState(todayStr())
  const [rows, setRows] = useState<DayRow[]>([])
  const [nextRowId, setNextRowId] = useState(1)
  const [lastPartyId, setLastPartyId] = useState<number | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [editingRowId, setEditingRowId] = useState<number | null>(null)
  const [pendingNewParty, setPendingNewParty] = useState<string | null>(null)

  const [syncing, setSyncing] = useState(false)
  const [pendingSync, setPendingSync] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [closeState, setCloseState] = useState<
    'adding' | 'closing' | 'closed' | 'error'
  >('adding')
  const [closeError, setCloseError] = useState('')

  const [paymentSummary, setPaymentSummary] = useState<
    PaymentSummaryRow[] | null
  >(null)
  const [daySummary, setDaySummary] = useState<{
    count: number
    total: number
  } | null>(null)

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const skipNextSyncRef = useRef(false)

  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.party_id, label: p.party_name })),
    [parties]
  )

  const activeRows = rows.filter((r) => !r.disabled)
  const subtotal = activeRows.reduce((s, r) => s + r.amount, 0)
  const itemCount = activeRows.length

  // ============================================================
  // Initial load
  // ============================================================

  useEffect(() => {
    async function init() {
      // 1. Closed snapshot first (persists until Start New Sales)
      const closed = loadClosedSnapshot()
      if (closed && closed.paymentSummary) {
        setBillDate(closed.bill_date)
        setPaymentSummary(closed.paymentSummary)
        setDaySummary(closed.daySummary)
        setCloseState('closed')
        const { data: partiesData } = await supabase
          .from('parties')
          .select('party_id, party_name, party_type, current_balance, phone')
          .eq('party_type', 'Customer')
          .order('party_name')
        setParties((partiesData as Party[]) || [])
        return
      }

      // 2. In-progress draft
      const local = loadLocalDraft()
      if (local) {
        setBillDate(local.bill_date)
        setRows(local.rows)
        setNextRowId(local.nextRowId)
        setLastPartyId(local.lastPartyId)
        setCloseState(local.state)
        setLastSyncedAt(local.lastSyncedAt)
        if (local.state === 'closing') setPendingSync(true)
      }

      // 3. Parties
      const { data: partiesData } = await supabase
        .from('parties')
        .select('party_id, party_name, party_type, current_balance, phone')
        .eq('party_type', 'Customer')
        .order('party_name')
      setParties((partiesData as Party[]) || [])

      // 4. Cross-device DB draft
      if (!local || local.rows.length === 0) {
        const { data: dbDrafts } = await supabase.rpc('get_day_drafts', {
          p_bill_date: todayStr(),
        })
        if (dbDrafts && (dbDrafts as unknown[]).length > 0) {
          const merged = mergeDbDraftsIntoRows(
            dbDrafts as {
              party_id: number
              party_name: string
              rows: unknown
              updated_at: string
            }[]
          )
          if (merged.rows.length > 0) {
            setRows(merged.rows)
            setNextRowId(merged.nextRowId)
            setLastPartyId(merged.lastPartyId)
            saveLocalDraft({
              bill_date: todayStr(),
              rows: merged.rows,
              nextRowId: merged.nextRowId,
              lastPartyId: merged.lastPartyId,
              state: 'adding',
              lastSyncedAt: Date.now(),
              pendingSync: false,
            })
          }
        }
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ============================================================
  // Auto-save draft
  // ============================================================

  useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false
      return
    }
    if (closeState === 'closed') return
    if (rows.length === 0 && nextRowId === 1) return
    saveLocalDraft({
      bill_date: billDate,
      rows,
      nextRowId,
      lastPartyId,
      state: closeState,
      lastSyncedAt,
      pendingSync,
    })
  }, [
    rows,
    nextRowId,
    lastPartyId,
    billDate,
    closeState,
    lastSyncedAt,
    pendingSync,
  ])

  // ============================================================
  // DB sync
  // ============================================================

  const syncToDb = useCallback(async () => {
    if (closeState === 'closed') return
    if (rows.length === 0) return
    setSyncing(true)
    setPendingSync(false)

    try {
      const byParty = new Map<number, DayRow[]>()
      for (const r of rows) {
        if (r.disabled) continue
        if (!r.item_id) continue
        if (!byParty.has(r.party_id)) byParty.set(r.party_id, [])
        byParty.get(r.party_id)!.push(r)
      }

      const { data: existing } = await supabase
        .from('day_sales_drafts')
        .select('party_id')
        .eq('bill_date', billDate)

      const existingIds = new Set(
        ((existing || []) as { party_id: number }[]).map((d) => d.party_id)
      )
      const currentIds = new Set(byParty.keys())

      const toDelete = [...existingIds].filter((id) => !currentIds.has(id))
      if (toDelete.length > 0) {
        await supabase
          .from('day_sales_drafts')
          .delete()
          .eq('bill_date', billDate)
          .in('party_id', toDelete)
      }

      for (const [partyId, partyRows] of byParty.entries()) {
        const payload = partyRows.map((r) => ({
          item_id: r.item_id,
          quantity: r.quantity,
          rate: r.rate,
          amount: r.amount,
          cost_at_sale: r.cost_at_sale,
        }))
        await supabase.from('day_sales_drafts').upsert(
          {
            bill_date: billDate,
            party_id: partyId,
            rows: payload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'bill_date,party_id' }
        )
      }

      setLastSyncedAt(Date.now())
    } catch (e) {
      console.error('sync failed:', e)
      setPendingSync(true)
    } finally {
      setSyncing(false)
    }
  }, [rows, billDate, closeState])

  useEffect(() => {
    if (closeState === 'closed') return
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      syncToDb()
    }, SYNC_DEBOUNCE_MS)
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  useEffect(() => {
    if (!pendingSync) {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current)
        retryTimerRef.current = null
      }
      return
    }
    if (retryTimerRef.current) return
    retryTimerRef.current = setInterval(() => {
      syncToDb()
    }, RETRY_INTERVAL_MS)
    return () => {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
  }, [pendingSync, syncToDb])
    // ============================================================
  // Merge helper
  // ============================================================

  function mergeDbDraftsIntoRows(
    dbDrafts: { party_id: number; party_name: string; rows: unknown }[]
  ): { rows: DayRow[]; nextRowId: number; lastPartyId: number | null } {
    const out: DayRow[] = []
    let rid = 1
    for (const draft of dbDrafts) {
      const arr = Array.isArray(draft.rows) ? draft.rows : []
      for (const raw of arr as {
        item_id: number
        quantity: number
        rate: number
        amount: number
        cost_at_sale: number
      }[]) {
        out.push({
          rowId: rid++,
          item_id: raw.item_id,
          sku: '',
          quantity: Number(raw.quantity),
          rate: Number(raw.rate),
          amount: Number(raw.amount),
          cost_at_sale: Number(raw.cost_at_sale || 0),
          party_id: draft.party_id,
          disabled: false,
        })
      }
    }
    const itemIds = [
      ...new Set(out.map((r) => r.item_id).filter(Boolean)),
    ] as number[]
    if (itemIds.length > 0) {
      supabase
        .from('items')
        .select(
          'item_id, sku, current_stock, cost_price, selling_price, quality, variant'
        )
        .in('item_id', itemIds)
        .then(({ data }) => {
          if (data) {
            const cache: Record<number, Item> = {}
            for (const it of data) cache[it.item_id] = it as Item
            setItemsCache((prev) => ({ ...prev, ...cache }))
            setRows((prev) =>
              prev.map((r) =>
                r.item_id && cache[r.item_id]
                  ? { ...r, sku: cache[r.item_id].sku }
                  : r
              )
            )
          }
        })
    }
    return {
      rows: out,
      nextRowId: rid,
      lastPartyId: out.length > 0 ? out[out.length - 1].party_id : null,
    }
  }

  // ============================================================
  // Row operations
  // ============================================================

  function addRow(item: Item, qty: number, rate: number, partyId: number) {
    const id = nextRowId
    const newRow: DayRow = {
      rowId: id,
      item_id: item.item_id,
      sku: item.sku,
      quantity: qty,
      rate,
      amount: Number((qty * rate).toFixed(2)),
      cost_at_sale: item.cost_price,
      party_id: partyId,
      disabled: false,
    }
    setRows((prev) => [...prev, newRow])
    setNextRowId((n) => n + 1)
    setLastPartyId(partyId)
    setItemsCache((prev) => ({ ...prev, [item.item_id]: item }))
  }

  function updateRow(rowId: number, patch: Partial<DayRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r
        const merged = { ...r, ...patch }
        merged.amount = Number((merged.quantity * merged.rate).toFixed(2))
        return merged
      })
    )
  }

  function disableRow(rowId: number) {
    updateRow(rowId, { disabled: true })
  }

  function restoreRow(rowId: number) {
    updateRow(rowId, { disabled: false })
  }

  function deleteRow(rowId: number) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId))
  }

  function handleNewPartyCreated(party: Party) {
    setParties((prev) =>
      [...prev, party].sort((a, b) => a.party_name.localeCompare(b.party_name))
    )
    setLastPartyId(party.party_id)
    setPendingNewParty(null)
  }

  function defaultPartyForNewRow(): number {
    if (lastPartyId) return lastPartyId
    return COUNTER_SALE_PARTY_ID
  }
    // ============================================================
  // CLOSE DAY
  // ============================================================

  const handleCloseDayClick = useCallback(async () => {
    setCloseError('')
    if (itemCount === 0) {
      setCloseError('Nothing to close — add at least one item.')
      return
    }

    const bad = activeRows.filter(
      (r) => !r.item_id || r.quantity <= 0 || r.rate <= 0
    )
    if (bad.length > 0) {
      setCloseError(
        `${bad.length} row${
          bad.length > 1 ? 's' : ''
        } incomplete. Fix or disable them first.`
      )
      return
    }

    const groupCount = new Set(activeRows.map((r) => r.party_id)).size
    const confirmed = window.confirm(
      `Close day — ${formatDateLong(billDate)}\n\n` +
        `${activeRows.length} item${activeRows.length > 1 ? 's' : ''} ` +
        `across ${groupCount} part${groupCount > 1 ? 'ies' : 'y'}.\n\n` +
        `Total: ${formatCurrency(subtotal)}\n\n` +
        `Bills will be created in the database. Continue?`
    )
    if (!confirmed) return

    setCloseState('closing')
    setPendingSync(false)

    saveLocalDraft({
      bill_date: billDate,
      rows,
      nextRowId,
      lastPartyId,
      state: 'closing',
      lastSyncedAt,
      pendingSync: false,
    })

    try {
      await syncToDb()

      const { data, error } = await supabase.rpc('close_day_sales', {
        p_bill_date: billDate,
      })

      if (error) throw new Error(error.message)

      const results = (data as CloseResult[]) || []
      if (results.length === 0) {
        throw new Error('No bills returned from server. Retry.')
      }

      const partyIds = results.map((r) => r.party_id)
      const { data: partyData } = await supabase
        .from('parties')
        .select('party_id, party_name, current_balance, phone')
        .in('party_id', partyIds)

      const partyMap: Record<
        number,
        { name: string; balance: number; phone: string | null }
      > = {}
      for (const p of (partyData || []) as {
        party_id: number
        party_name: string
        current_balance: number
        phone: string | null
      }[]) {
        partyMap[p.party_id] = {
          name: p.party_name,
          balance: Number(p.current_balance || 0),
          phone: p.phone,
        }
      }

      const saleIds = results.map((r) => r.sale_id)
      const { data: saleData } = await supabase
        .from('sales')
        .select('sale_id, total_amount, party_id')
        .in('sale_id', saleIds)

      const saleTotals: Record<number, { party_id: number; total: number }> = {}
      for (const s of (saleData || []) as {
        sale_id: number
        total_amount: number
        party_id: number
      }[]) {
        saleTotals[s.sale_id] = {
          party_id: s.party_id,
          total: Number(s.total_amount || 0),
        }
      }

      const summary: PaymentSummaryRow[] = results.map((r) => {
        const bill = saleTotals[r.sale_id]
        const billAmount = bill?.total || 0
        const party = partyMap[r.party_id]
        const isCounter = r.party_id === COUNTER_SALE_PARTY_ID
        const previous = isCounter
          ? 0
          : Math.max(0, (party?.balance || 0) - billAmount)
        return {
          party_id: r.party_id,
          party_name: party?.name || `#${r.party_id}`,
          phone: party?.phone || null,
          sale_id: r.sale_id,
          bill_amount: billAmount,
          previous_balance: previous,
          total_due: isCounter ? 0 : billAmount + previous,
          is_counter_sale: isCounter,
          amount: '',
          mode: 'Cash',
          upiAmount: '',
          cashPaid: 0,
          upiPaid: 0,
          skipped: isCounter,
          paid: isCounter,
          error: '',
        }
      })

      const daySum = {
        count: results.length,
        total: summary.reduce((s, r) => s + r.bill_amount, 0),
      }

      setPaymentSummary(summary)
      setDaySummary(daySum)
      setCloseState('closed')

      saveClosedSnapshot({
        bill_date: billDate,
        paymentSummary: summary,
        daySummary: daySum,
      })

      clearLocalDraft()

      setRows([])
      setNextRowId(1)
      setLastPartyId(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Close failed'
      setCloseState('error')
      setCloseError(msg)
      saveLocalDraft({
        bill_date: billDate,
        rows,
        nextRowId,
        lastPartyId,
        state: 'error',
        lastSyncedAt,
        pendingSync: true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rows,
    itemCount,
    activeRows,
    subtotal,
    billDate,
    nextRowId,
    lastPartyId,
    lastSyncedAt,
    syncToDb,
  ])

  // ============================================================
  // Render close UI
  // ============================================================

  const renderCloseDayUI = useCallback(() => {
    if (closeState === 'closing') {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
            <div className="text-lg font-bold text-slate-900 mb-1">
              Closing day…
            </div>
            <div className="text-sm text-slate-600">
              Saving {itemCount} item{itemCount === 1 ? '' : 's'} to database.
              <br />
              Do not close this tab.
            </div>
          </div>
        </div>
      )
    }

    if (closeState === 'error') {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-rose-200 rounded-2xl shadow-lg p-5">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-lg font-bold text-slate-900">
                  Close failed
                </div>
                <div className="text-sm text-slate-600 mt-1">{closeError}</div>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 mb-4">
              Your rows are still saved locally. Nothing was lost. Try again — if
              the network is down, wait a moment.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCloseState('adding')}
                className="flex-1 h-11 text-sm font-medium text-slate-700 border border-slate-300 bg-white rounded-lg hover:bg-slate-50"
              >
                Back to editing
              </button>
              <button
                onClick={handleCloseDayClick}
                className="flex-1 h-11 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                Retry
              </button>
            </div>
          </div>
        </div>
      )
    }

    if (closeState === 'closed' && paymentSummary) {
      return (
        <PaymentSummaryScreen
          billDate={billDate}
          summary={paymentSummary}
          daySummary={daySummary}
          onChangeSummary={(updater) => {
            setPaymentSummary((prev) => {
              const next =
                typeof updater === 'function' ? updater(prev) : updater
              if (next) {
                saveClosedSnapshot({
                  bill_date: billDate,
                  paymentSummary: next,
                  daySummary,
                })
              }
              return next
            })
          }}
          onDone={() => {
            clearClosedSnapshot()
            clearLocalDraft()
            setPaymentSummary(null)
            setDaySummary(null)
            setBillDate(todayStr())
            setCloseState('adding')
            router.refresh()
          }}
        />
      )
    }

    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    closeState,
    closeError,
    itemCount,
    paymentSummary,
    daySummary,
    billDate,
    handleCloseDayClick,
    router,
  ])
    // ============================================================
  // Derived helpers
  // ============================================================

  const activeRowsForRender = rows.filter((r) => !r.disabled)
  const disabledRows = rows.filter((r) => r.disabled)

  const partiesById = useMemo(() => {
    const map: Record<number, Party> = {}
    for (const p of parties) map[p.party_id] = p
    return map
  }, [parties])

  const rowsByParty = useMemo(() => {
    const order: number[] = []
    const map: Record<number, DayRow[]> = {}
    for (const r of activeRowsForRender) {
      if (!map[r.party_id]) {
        map[r.party_id] = []
        order.push(r.party_id)
      }
      map[r.party_id].push(r)
    }
    return order.map((partyId) => ({
      partyId,
      rows: map[partyId],
      subtotal: map[partyId].reduce((s, r) => s + r.amount, 0),
    }))
  }, [activeRowsForRender])

  function partyName(id: number): string {
    return partiesById[id]?.party_name || `#${id}`
  }

  if (
    closeState === 'closing' ||
    closeState === 'closed' ||
    closeState === 'error'
  ) {
    return renderCloseDayUI()
  }

  // ============================================================
  // MAIN RENDER
  // ============================================================

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <div className="max-w-3xl mx-auto px-3 sm:px-4 pt-3 sm:pt-4">
        <div className="sticky top-0 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-slate-50/95 backdrop-blur border-b border-slate-200 z-20 mb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                  Day Sales
                </h1>
                {pendingSync && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-medium">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    syncing
                  </span>
                )}
                {!pendingSync && lastSyncedAt && (
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">
                    ✓ synced
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {formatDateLong(billDate)} · {itemCount} item
                {itemCount === 1 ? '' : 's'}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-base sm:text-lg font-bold text-slate-900">
                {formatCurrency(subtotal)}
              </div>
              <div className="text-[10px] text-slate-500">subtotal</div>
            </div>
          </div>
        </div>

        <UnclosedDaysBanner billDate={billDate} />

        {closeError && closeState === 'adding' && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 mb-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-sm text-rose-800 flex-1">{closeError}</div>
            <button
              onClick={() => setCloseError('')}
              className="text-rose-600 hover:text-rose-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="space-y-2 mb-3">
          {activeRowsForRender.length === 0 && !addOpen && (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl py-8 px-4 text-center">
              <div className="text-sm text-slate-500 mb-1">No items yet</div>
              <div className="text-xs text-slate-400">
                Tap “Add Item” to start today’s entries.
              </div>
            </div>
          )}

          {rowsByParty.map((group) => {
            const startIndex =
              activeRowsForRender.findIndex(
                (r) => r.rowId === group.rows[0].rowId
              ) + 1
            return (
              <PartyGroupSection
                key={group.partyId}
                group={group}
                party={partiesById[group.partyId]}
                startIndex={startIndex}
                onEdit={(rowId: number) => setEditingRowId(rowId)}
                onDisable={(rowId: number) => disableRow(rowId)}
                onDelete={(rowId: number) => deleteRow(rowId)}
              />
            )
          })}

          {disabledRows.length > 0 && (
            <div className="pt-2">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-1">
                Disabled ({disabledRows.length})
              </div>
              {disabledRows.map((row) => (
                <DisabledRowCard
                  key={row.rowId}
                  row={row}
                  partyName={partyName(row.party_id)}
                  onRestore={() => restoreRow(row.rowId)}
                  onDelete={() => deleteRow(row.rowId)}
                />
              ))}
            </div>
          )}
        </div>

        {!addOpen && (
          <button
            onClick={() => setAddOpen(true)}
            className="w-full h-12 text-sm font-semibold text-blue-700 border-2 border-dashed border-blue-300 rounded-xl hover:bg-blue-50 active:bg-blue-100 flex items-center justify-center gap-2 mb-3"
          >
            <Plus className="w-4 h-4" />
            Add Item
          </button>
        )}

        {addOpen && (
          <AddRowPanel
            parties={parties}
            partyOptions={partyOptions}
            defaultPartyId={defaultPartyForNewRow()}
            onCancel={() => setAddOpen(false)}
            onAdd={(item, qty, rate, partyId) => {
              addRow(item, qty, rate, partyId)
            }}
            onCreateNewParty={(name) => setPendingNewParty(name)}
            setItemsCache={setItemsCache}
          />
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 shadow-lg">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-2.5 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-500">
              {itemCount} item{itemCount === 1 ? '' : 's'} ·{' '}
              {partyCount(activeRowsForRender)} part
              {partyCount(activeRowsForRender) === 1 ? 'y' : 'ies'}
            </div>
            <div className="text-base font-bold text-slate-900">
              {formatCurrency(subtotal)}
            </div>
          </div>
          <button
            onClick={handleCloseDayClick}
            disabled={itemCount === 0}
            className="h-12 px-5 text-sm font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
          >
            <Check className="w-4 h-4" />
            Close Day
          </button>
        </div>
      </div>

      {editingRowId !== null &&
        (() => {
          const row = rows.find((r) => r.rowId === editingRowId)
          if (!row) return null
          return (
            <EditRowModal
              row={row}
              partyOptions={partyOptions}
              onSave={(patch) => {
                updateRow(row.rowId, patch)
                setEditingRowId(null)
              }}
              onDelete={() => {
                deleteRow(row.rowId)
                setEditingRowId(null)
              }}
              onClose={() => setEditingRowId(null)}
              setItemsCache={setItemsCache}
            />
          )
        })()}

      <NewPartyDialog
        open={pendingNewParty !== null}
        initialName={pendingNewParty || ''}
        partyType="Customer"
        onClose={() => setPendingNewParty(null)}
        onCreated={handleNewPartyCreated}
      />
    </div>
  )
}
// ============================================================
// SUB-COMPONENTS
// ============================================================

function PartyGroupSection({
  group,
  party,
  startIndex,
  onEdit,
  onDisable,
  onDelete,
}: {
  group: { partyId: number; rows: DayRow[]; subtotal: number }
  party: Party | undefined
  startIndex: number
  onEdit: (rowId: number) => void
  onDisable: (rowId: number) => void
  onDelete: (rowId: number) => void
}) {
  const fullName = party?.party_name || `#${group.partyId}`
  const phone = party?.phone
  const last4 = phone ? phone.slice(-4) : null
  const displayName = last4 ? `${fullName} · ${last4}` : fullName

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-xs font-semibold text-slate-800 truncate">
            {displayName}
          </span>
        </div>
        <span className="text-xs font-bold text-slate-700 shrink-0">
          {formatCurrency(group.subtotal)}
        </span>
      </div>

      <div className="divide-y divide-slate-100">
        {group.rows.map((row, i) => (
          <CompactRow
            key={row.rowId}
            row={row}
            index={startIndex + i}
            onEdit={() => onEdit(row.rowId)}
            onDisable={() => onDisable(row.rowId)}
            onDelete={() => onDelete(row.rowId)}
          />
        ))}
      </div>
    </div>
  )
}

function CompactRow({
  row,
  index,
  onEdit,
  onDisable,
  onDelete,
}: {
  row: DayRow
  index: number
  onEdit: () => void
  onDisable: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2 px-3 py-3 hover:bg-slate-50 active:bg-slate-100 cursor-pointer"
        onClick={onEdit}
      >
        <div className="w-5 text-[11px] font-semibold text-slate-400 shrink-0 text-center">
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs font-semibold text-slate-900 truncate">
            {row.sku || '—'}
          </div>
        </div>
        <div className="text-[11px] text-slate-500 shrink-0 text-right">
          {row.quantity} × {formatCurrency(row.rate)}
        </div>
        <div className="text-sm font-bold text-slate-900 shrink-0 w-20 text-right">
          {formatCurrency(row.amount)}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(!menuOpen)
          }}
          className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded shrink-0"
          aria-label="Row menu"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-2 top-full -mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-40 min-w-[140px] overflow-hidden">
            <button
              onClick={() => {
                setMenuOpen(false)
                onEdit()
              }}
              className="w-full text-left px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-b border-slate-100"
            >
              <Pencil className="w-3.5 h-3.5 text-slate-500" />
              Edit
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                onDisable()
              }}
              className="w-full text-left px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-b border-slate-100"
            >
              <X className="w-3.5 h-3.5 text-slate-500" />
              Disable
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
              className="w-full text-left px-3 py-2.5 text-sm text-rose-700 hover:bg-rose-50 flex items-center gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function DisabledRowCard({
  row,
  partyName,
  onRestore,
  onDelete,
}: {
  row: DayRow
  partyName: string
  onRestore: () => void
  onDelete: () => void
}) {
  return (
    <div className="bg-slate-100 border border-slate-200 rounded-xl mb-2">
      <div className="p-3 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs font-semibold text-slate-500 line-through truncate">
            {row.sku || '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {row.quantity} × {formatCurrency(row.rate)} · {partyName}
          </div>
        </div>
        <button
          onClick={onRestore}
          className="w-9 h-9 flex items-center justify-center text-emerald-700 hover:bg-emerald-50 rounded-lg active:bg-emerald-100 shrink-0"
          aria-label="Restore"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="w-9 h-9 flex items-center justify-center text-rose-700 hover:bg-rose-50 rounded-lg active:bg-rose-100 shrink-0"
          aria-label="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function AddRowPanel({
  partyOptions,
  defaultPartyId,
  onCancel,
  onAdd,
  onCreateNewParty,
  setItemsCache,
}: {
  parties: Party[]
  partyOptions: { value: number; label: string }[]
  defaultPartyId: number
  onCancel: () => void
  onAdd: (item: Item, qty: number, rate: number, partyId: number) => void
  onCreateNewParty: (name: string) => void
  setItemsCache: React.Dispatch<React.SetStateAction<Record<number, Item>>>
}) {
  const [searchResults, setSearchResults] = useState<Item[]>([])
  const [pickedItem, setPickedItem] = useState<Item | null>(null)
  const [qty, setQty] = useState('1')
  const [rate, setRate] = useState('')
  const [partyId, setPartyId] = useState<number>(defaultPartyId)
  const [error, setError] = useState('')

  const skuRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const rateRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => skuRef.current?.focus(), 150)
  }, [])

  async function handleSearch(q: string) {
    if (!q || q.trim().length < 2) {
      setSearchResults([])
      return
    }
    try {
      const results = (await searchItemsShared(q)) as Item[]
      setSearchResults(results)
      const cache: Record<number, Item> = {}
      for (const it of results) cache[it.item_id] = it
      setItemsCache((prev) => ({ ...prev, ...cache }))
    } catch {
      setSearchResults([])
    }
  }

  function handleItemPick(v: string) {
    const item = searchResults.find((i) => String(i.item_id) === v)
    if (!item) return
    setPickedItem(item)
    setRate(String(item.selling_price))
    setError('')
    setTimeout(() => {
      qtyRef.current?.focus()
      qtyRef.current?.select()
    }, 100)
  }

  function handleSubmit() {
    if (!pickedItem) {
      setError('Pick an item first.')
      return
    }
    const q = parseFloat(qty)
    const r = parseFloat(rate)
    if (!q || q <= 0) {
      setError('Qty must be greater than 0.')
      return
    }
    if (!r || r <= 0) {
      setError('Rate must be greater than 0.')
      return
    }
    onAdd(pickedItem, q, r, partyId)
    setPickedItem(null)
    setQty('1')
    setRate('')
    setSearchResults([])
    setError('')
    setTimeout(() => skuRef.current?.focus(), 100)
  }

  const itemOptions = searchResults.map((it) => ({
    value: it.item_id,
    label: `${it.sku} · stock ${it.current_stock} · sp ₹${it.selling_price}`,
  }))

  return (
    <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-blue-900">Add Item</div>
        <button
          onClick={onCancel}
          className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-white rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        <div>
          <label className="block text-[11px] font-medium text-slate-700 mb-1">
            SKU
          </label>
          <SmartCombobox
            options={itemOptions}
            value={pickedItem ? String(pickedItem.item_id) : null}
            fallbackLabel={pickedItem?.sku || null}
            onValueChange={(v) => handleItemPick(v)}
            onSearch={handleSearch}
            placeholder="Type 2+ letters to search..."
            allowCreate={false}
            inputRef={skuRef}
            inputDataAttr="day-add-sku"
          />
        </div>

        {pickedItem && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Qty
              </label>
              <input
                ref={qtyRef}
                type="number"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    rateRef.current?.focus()
                    rateRef.current?.select()
                  }
                }}
                className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Rate
              </label>
              <input
                ref={rateRef}
                type="number"
                inputMode="numeric"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault()
                    const partyInput =
                      document.querySelector<HTMLInputElement>(
                        'input[data-row-item="day-add-party"]'
                      )
                    if (partyInput) {
                      partyInput.focus()
                      try {
                        partyInput.select()
                      } catch {
                        // ignore
                      }
                    }
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSubmit()
                    setTimeout(() => {
                      skuRef.current?.focus()
                    }, 100)
                  }
                }}
                className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>
        )}

        {pickedItem && (
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">
              Party
            </label>
            <SmartCombobox
              options={partyOptions}
              value={String(partyId)}
              onValueChange={(v, label, isNew) => {
                if (isNew) {
                  onCreateNewParty(label)
                  return
                }
                setPartyId(Number(v))
              }}
              placeholder="Select party..."
              allowCreate={true}
              inputDataAttr="day-add-party"
              onTabKey={() => {
                setTimeout(() => {
                  handleSubmit()
                  setTimeout(() => skuRef.current?.focus(), 100)
                }, 10)
              }}
            />
          </div>
        )}

        {pickedItem && (
          <div className="flex items-center justify-between text-sm bg-white border border-blue-200 rounded-lg px-3 py-2">
            <span className="text-slate-600">Amount</span>
            <span className="font-bold text-slate-900">
              {formatCurrency(
                (parseFloat(qty) || 0) * (parseFloat(rate) || 0)
              )}
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSubmit}
            disabled={!pickedItem}
            className="flex-1 h-11 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
          <button
            onClick={onCancel}
            className="h-11 px-4 text-sm text-slate-700 border border-slate-300 bg-white rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
function EditRowModal({
  row,
  partyOptions,
  onSave,
  onDelete,
  onClose,
  setItemsCache,
}: {
  row: DayRow
  partyOptions: { value: number; label: string }[]
  onSave: (patch: Partial<DayRow>) => void
  onDelete: () => void
  onClose: () => void
  setItemsCache: React.Dispatch<React.SetStateAction<Record<number, Item>>>
}) {
  const [pickedItem, setPickedItem] = useState<Item | null>(null)
  const [searchResults, setSearchResults] = useState<Item[]>([])
  const [qty, setQty] = useState(String(row.quantity || 1))
  const [rate, setRate] = useState(String(row.rate || 0))
  const [partyId, setPartyId] = useState(row.party_id)

  async function handleSearch(q: string) {
    if (!q || q.trim().length < 2) {
      setSearchResults([])
      return
    }
    try {
      const results = (await searchItemsShared(q)) as Item[]
      setSearchResults(results)
      const cache: Record<number, Item> = {}
      for (const it of results) cache[it.item_id] = it
      setItemsCache((prev) => ({ ...prev, ...cache }))
    } catch {
      setSearchResults([])
    }
  }

  function handleItemPick(v: string) {
    const item = searchResults.find((i) => String(i.item_id) === v)
    if (!item) return
    setPickedItem(item)
    setRate(String(item.selling_price))
  }

  function handleSave() {
    const q = parseFloat(qty)
    const r = parseFloat(rate)
    if (!q || q <= 0 || !r || r <= 0) return
    const patch: Partial<DayRow> = {
      quantity: q,
      rate: r,
      party_id: partyId,
    }
    if (pickedItem) {
      patch.item_id = pickedItem.item_id
      patch.sku = pickedItem.sku
      patch.cost_at_sale = pickedItem.cost_price
    }
    onSave(patch)
  }

  const itemOptions = searchResults.map((it) => ({
    value: it.item_id,
    label: `${it.sku} · stock ${it.current_stock} · sp ₹${it.selling_price}`,
  }))

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="font-semibold text-slate-900">Edit Item</div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">
              SKU {pickedItem ? '(changing)' : '(search to change)'}
            </label>
            <SmartCombobox
              options={itemOptions}
              value={pickedItem ? String(pickedItem.item_id) : null}
              fallbackLabel={pickedItem?.sku || row.sku || null}
              onValueChange={(v) => handleItemPick(v)}
              onSearch={handleSearch}
              placeholder="Search to change item..."
              allowCreate={false}
            />
            <div className="text-[11px] text-slate-500 mt-1">
              Current: <span className="font-mono">{row.sku || '—'}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Qty
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Rate
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">
              Party
            </label>
            <SmartCombobox
              options={partyOptions}
              value={String(partyId)}
              onValueChange={(v) => setPartyId(Number(v))}
              placeholder="Select party..."
              allowCreate={false}
            />
          </div>

          <div className="flex items-center justify-between text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-slate-600">Amount</span>
            <span className="font-bold text-slate-900">
              {formatCurrency(
                (parseFloat(qty) || 0) * (parseFloat(rate) || 0)
              )}
            </span>
          </div>
        </div>

        <div className="border-t border-slate-200 p-3 flex gap-2 bg-slate-50">
          <button
            onClick={onDelete}
            className="h-11 px-3 text-sm font-medium text-rose-700 border border-rose-300 bg-white rounded-lg hover:bg-rose-50"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleSave}
            className="flex-1 h-11 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:bg-blue-800 flex items-center justify-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function UnclosedDaysBanner({ billDate }: { billDate: string }) {
  const [days, setDays] = useState<
    { bill_date: string; count: number; total: number }[]
  >([])

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('day_sales_drafts')
        .select('bill_date, rows')
        .lt('bill_date', billDate)
        .order('bill_date', { ascending: false })

      if (!data) return
      const grouped: Record<string, { count: number; total: number }> = {}
      for (const d of data as { bill_date: string; rows: unknown }[]) {
        if (!grouped[d.bill_date]) grouped[d.bill_date] = { count: 0, total: 0 }
        const arr = Array.isArray(d.rows) ? d.rows : []
        for (const r of arr as { amount?: number }[]) {
          grouped[d.bill_date].count++
          grouped[d.bill_date].total += Number(r.amount || 0)
        }
      }
      setDays(
        Object.entries(grouped).map(([bill_date, v]) => ({
          bill_date,
          count: v.count,
          total: v.total,
        }))
      )
    }
    load()
  }, [billDate])

  if (days.length === 0) return null

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 mb-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-900">
            Unclosed day{days.length > 1 ? 's' : ''}
          </div>
          <div className="text-xs text-amber-800 mt-1 space-y-0.5">
            {days.map((d) => (
              <div key={d.bill_date}>
                {formatDateLong(d.bill_date)} — {d.count} item
                {d.count === 1 ? '' : 's'} · {formatCurrency(d.total)}
              </div>
            ))}
          </div>
          <div className="text-[11px] text-amber-700 mt-1">
            Visit a previous day view to close them, or contact owner.
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// PaymentSummaryScreen — with split payment + persistence
// ============================================================

function PaymentSummaryScreen({
  billDate,
  summary,
  daySummary,
  onChangeSummary,
  onDone,
}: {
  billDate: string
  summary: PaymentSummaryRow[]
  daySummary: { count: number; total: number } | null
  onChangeSummary: (
    updater:
      | PaymentSummaryRow[]
      | null
      | ((prev: PaymentSummaryRow[] | null) => PaymentSummaryRow[] | null)
  ) => void
  onDone: () => void
}) {
  const [recording, setRecording] = useState<number | null>(null)
  const [recentlyRecorded, setRecentlyRecorded] = useState<Set<number>>(
    new Set()
  )
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [itemsBySaleId, setItemsBySaleId] = useState<
    Record<
      number,
      { sku: string; quantity: number; rate: number; amount: number }[]
    >
  >({})
  const [copiedPartyId, setCopiedPartyId] = useState<number | null>(null)
  const [phoneEditingFor, setPhoneEditingFor] = useState<number | null>(null)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneError, setPhoneError] = useState('')
  const [phones, setPhones] = useState<Record<number, string | null>>({})

  const unpaidRows = summary.filter(
    (r) =>
      !r.is_counter_sale &&
      !r.skipped &&
      (!r.paid || r.total_due - (r.cashPaid + r.upiPaid) > 0.01)
  )
  const paidRows = summary.filter(
    (r) =>
      !r.is_counter_sale &&
      r.paid &&
      r.total_due - (r.cashPaid + r.upiPaid) <= 0.01
  )
  const allDone = unpaidRows.length === 0

  useEffect(() => {
    const map: Record<number, string | null> = {}
    for (const r of summary) map[r.party_id] = r.phone
    setPhones(map)
  }, [summary])

  useEffect(() => {
    async function loadItems() {
      const saleIds = summary.map((r) => r.sale_id)
      if (saleIds.length === 0) return

      const { data: itemsData } = await supabase
        .from('sale_items')
        .select('sale_id, item_id, quantity, rate, amount')
        .in('sale_id', saleIds)

      if (!itemsData || itemsData.length === 0) return

      const itemIds = Array.from(
        new Set(itemsData.map((r) => r.item_id))
      ) as number[]

      let skuMap: Record<number, string> = {}
      if (itemIds.length > 0) {
        const { data: itemRows } = await supabase
          .from('items')
          .select('item_id, sku')
          .in('item_id', itemIds)
        for (const it of (itemRows || []) as {
          item_id: number
          sku: string
        }[]) {
          skuMap[it.item_id] = it.sku
        }
      }

      const grouped: Record<
        number,
        { sku: string; quantity: number; rate: number; amount: number }[]
      > = {}
      for (const row of itemsData as {
        sale_id: number
        item_id: number
        quantity: number
        rate: number
        amount: number
      }[]) {
        if (!grouped[row.sale_id]) grouped[row.sale_id] = []
        grouped[row.sale_id].push({
          sku: skuMap[row.item_id] || '—',
          quantity: Number(row.quantity),
          rate: Number(row.rate),
          amount: Number(row.amount),
        })
      }
      setItemsBySaleId(grouped)
    }
    loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleExpand(partyId: number) {
    setExpanded((prev) => ({ ...prev, [partyId]: !prev[partyId] }))
  }

  function updateRow(partyId: number, patch: Partial<PaymentSummaryRow>) {
    onChangeSummary((prev) => {
      if (!prev) return prev
      return prev.map((r) => (r.party_id === partyId ? { ...r, ...patch } : r))
    })
  }

  function buildStatementFor(row: PaymentSummaryRow): string {
    const items = itemsBySaleId[row.sale_id] || []
    const cashPaid = row.paid ? row.cashPaid : 0
    const upiPaid = row.paid ? row.upiPaid : 0
    const totalPaid = cashPaid + upiPaid
    const netDue = row.total_due - totalPaid

    return buildStatementText({
      customerName: row.party_name,
      fromDate: billDate,
      toDate: billDate,
      items: items.map((it) => ({
        sku: it.sku,
        quantity: it.quantity,
        rate: it.rate,
        amount: it.amount,
      })),
      purchasesTotal: row.bill_amount,
      previousBalance: row.previous_balance,
      cashPaid,
      upiPaid,
      netDue,
    })
  }

  async function copyStatement(row: PaymentSummaryRow) {
    const text = buildStatementFor(row)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        // ignore
      }
      document.body.removeChild(ta)
    }
    setCopiedPartyId(row.party_id)
    setTimeout(() => {
      setCopiedPartyId((curr) => (curr === row.party_id ? null : curr))
    }, 2000)
  }

  function openWhatsApp(row: PaymentSummaryRow) {
    const phone = phones[row.party_id] || row.phone
    if (!phone) {
      setPhoneEditingFor(row.party_id)
      setPhoneDraft('')
      setPhoneError('')
      return
    }
    const text = buildStatementFor(row)
    const url = buildWhatsAppUrl(phone, text)
    if (!url) {
      setPhoneEditingFor(row.party_id)
      setPhoneDraft(phone)
      setPhoneError('Invalid phone number. Enter a valid 10-digit mobile.')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function savePhoneAndOpen(row: PaymentSummaryRow) {
    const normalized = normalizePhoneForWhatsApp(phoneDraft)
    if (!normalized) {
      setPhoneError('Invalid number. Enter a 10-digit Indian mobile.')
      return
    }
    const tenDigit = normalized.slice(-10)
    setPhoneSaving(true)
    setPhoneError('')

    const { error } = await supabase
      .from('parties')
      .update({ phone: tenDigit })
      .eq('party_id', row.party_id)

    if (error) {
      setPhoneSaving(false)
      setPhoneError('Could not save: ' + error.message)
      return
    }

    setPhones((prev) => ({ ...prev, [row.party_id]: tenDigit }))
    setPhoneSaving(false)
    setPhoneEditingFor(null)
    setPhoneDraft('')

    const text = buildStatementFor(row)
    const url = buildWhatsAppUrl(tenDigit, text)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function recordPayment(partyId: number) {
    if (recording !== null) return
    if (recentlyRecorded.has(partyId)) return

    const row = summary.find((r) => r.party_id === partyId)
    if (!row) return
    const totalAmt = parseFloat(row.amount)
    if (!totalAmt || totalAmt <= 0) {
      updateRow(partyId, { error: 'Amount must be > 0' })
      return
    }

    let upiAmt = 0
    let cashAmt = totalAmt
    if (row.mode === 'Online') {
      const u = parseFloat(row.upiAmount)
      if (isNaN(u) || u < 0) {
        updateRow(partyId, { error: 'Invalid UPI amount' })
        return
      }
      if (u > totalAmt) {
        updateRow(partyId, { error: 'UPI cannot exceed total' })
        return
      }
      upiAmt = u
      cashAmt = totalAmt - u
    }

    setRecording(partyId)

    try {
      const inserts: {
        party_id: number
        payment_date: string
        amount: number
        payment_mode: string
      }[] = []

      if (upiAmt > 0) {
        inserts.push({
          party_id: row.party_id,
          payment_date: billDate,
          amount: upiAmt,
          payment_mode: 'UPI',
        })
      }
      if (cashAmt > 0) {
        inserts.push({
          party_id: row.party_id,
          payment_date: billDate,
          amount: cashAmt,
          payment_mode: 'Cash',
        })
      }

      const { error: payErr } = await supabase
        .from('payments')
        .insert(inserts)
      if (payErr) throw payErr

      const { data: party } = await supabase
        .from('parties')
        .select('current_balance')
        .eq('party_id', row.party_id)
        .single()

      if (party) {
        await supabase
          .from('parties')
          .update({
            current_balance: Number(party.current_balance) - totalAmt,
          })
          .eq('party_id', row.party_id)
      }

      await applyFIFO(row.party_id, totalAmt)

      updateRow(partyId, {
        paid: true,
        error: '',
        cashPaid: row.cashPaid + cashAmt,
        upiPaid: row.upiPaid + upiAmt,
        amount: '',
        upiAmount: '',
        mode: 'Cash',
      })

      setRecentlyRecorded((prev) => {
        const next = new Set(prev)
        next.add(partyId)
        return next
      })
      setTimeout(() => {
        setRecentlyRecorded((prev) => {
          const next = new Set(prev)
          next.delete(partyId)
          return next
        })
      }, 3000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Payment failed'
      updateRow(partyId, { error: msg })
    } finally {
      setRecording(null)
    }
  }

  function renderItemsFor(row: PaymentSummaryRow) {
    const items = itemsBySaleId[row.sale_id] || []
    if (items.length === 0) {
      return (
        <div className="text-[11px] text-slate-400 italic px-3 py-2">
          No items
        </div>
      )
    }
    return (
      <div className="bg-slate-50 border-y border-slate-200 px-3 py-2 space-y-1">
        {items.map((it, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 text-[11px]"
          >
            <span className="font-mono text-slate-700 truncate flex-1">
              {it.sku}
            </span>
            <span className="text-slate-500 shrink-0">
              {it.quantity} × ₹{it.rate.toFixed(2)}
            </span>
            <span className="font-semibold text-slate-800 shrink-0 w-16 text-right">
              ₹{it.amount.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    )
  }

  function renderRowCard(row: PaymentSummaryRow) {
    const isExpanded = !!expanded[row.party_id]
    const isPhoneEditing = phoneEditingFor === row.party_id
    const remaining = row.total_due - (row.cashPaid + row.upiPaid)

    const totalAmt = parseFloat(row.amount) || 0
    const upiAmt = parseFloat(row.upiAmount) || 0
    const splitUpi = row.mode === 'Online' ? Math.min(upiAmt, totalAmt) : 0
    const splitCash = row.mode === 'Online' ? totalAmt - splitUpi : totalAmt

    return (
      <div
        key={row.party_id}
        className="bg-white border border-slate-200 rounded-2xl mb-2 shadow-sm overflow-hidden"
      >
        <div className="p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <button
              onClick={() => toggleExpand(row.party_id)}
              className="min-w-0 text-left flex-1"
            >
              <div className="text-sm font-semibold text-slate-900 truncate">
                {row.party_name}
              </div>
              <div className="text-[11px] text-slate-500">
                Bill #{row.sale_id}
              </div>
            </button>
            <div className="flex items-center gap-1.5 shrink-0">
              {!row.is_counter_sale && (
                <>
                  <button
                    onClick={() => copyStatement(row)}
                    className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200"
                    aria-label="Copy statement"
                  >
                    {copiedPartyId === row.party_id ? (
                      <Check className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <CopyIcon className="w-5 h-5" />
                    )}
                  </button>
                  <button
                    onClick={() => openWhatsApp(row)}
                    className="w-10 h-10 flex items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100"
                    aria-label="Share on WhatsApp"
                  >
                    <MessageCircleIcon className="w-5 h-5" />
                  </button>
                </>
              )}
              <button
                onClick={() => toggleExpand(row.party_id)}
                className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
                aria-label="Toggle items"
              >
                <ChevronDown
                  className={`w-5 h-5 transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>
          </div>

          <button
            onClick={() => toggleExpand(row.party_id)}
            className="w-full text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-500">
                Today {formatCurrency(row.bill_amount)}
                {row.previous_balance > 0 && (
                  <>
                    {' · '}Prev {formatCurrency(row.previous_balance)}
                  </>
                )}
              </div>
              <div className="text-sm font-bold text-rose-700">
                Due {formatCurrency(remaining > 0 ? remaining : 0)}
              </div>
            </div>
          </button>
        </div>

        {isPhoneEditing && (
          <div className="px-3 py-2 border-t border-amber-200 bg-amber-50">
            <div className="text-[11px] text-amber-800 mb-1.5 font-medium">
              Enter WhatsApp number for {row.party_name}
            </div>
            <div className="flex gap-2">
              <input
                type="tel"
                inputMode="numeric"
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                placeholder="10-digit mobile"
                className="flex-1 h-9 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') savePhoneAndOpen(row)
                }}
              />
              <button
                onClick={() => savePhoneAndOpen(row)}
                disabled={phoneSaving}
                className="h-9 px-3 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {phoneSaving ? 'Saving…' : 'Save & Open'}
              </button>
              <button
                onClick={() => {
                  setPhoneEditingFor(null)
                  setPhoneDraft('')
                  setPhoneError('')
                }}
                className="h-9 px-3 text-xs font-medium bg-slate-200 rounded hover:bg-slate-300"
              >
                Cancel
              </button>
            </div>
            {phoneError && (
              <div className="text-[11px] text-rose-700 mt-1">
                {phoneError}
              </div>
            )}
          </div>
        )}

        {isExpanded && renderItemsFor(row)}

        {!row.skipped && remaining > 0.01 && (
          <div className="p-3 border-t border-slate-200">
            {row.cashPaid + row.upiPaid > 0 && (
              <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5 mb-2">
                Already paid: ₹{row.cashPaid.toFixed(2)} Cash + ₹
                {row.upiPaid.toFixed(2)} UPI
              </div>
            )}

            <div className="flex gap-2 mb-2">
              <input
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={row.amount}
                onChange={(e) =>
                  updateRow(row.party_id, {
                    amount: e.target.value,
                    error: '',
                  })
                }
                className="flex-1 h-11 px-3 text-base text-right font-semibold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() =>
                  updateRow(row.party_id, {
                    amount: String(remaining),
                  })
                }
                className="h-11 px-3 text-xs font-medium text-slate-700 border border-slate-300 bg-white rounded-lg hover:bg-slate-50"
              >
                Full
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                onClick={() =>
                  updateRow(row.party_id, { mode: 'Cash', upiAmount: '' })
                }
                className={`h-11 text-sm font-semibold rounded-lg border-2 flex items-center justify-center gap-1.5 transition-colors ${
                  row.mode === 'Cash'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-400'
                    : 'bg-white text-slate-600 border-slate-300'
                }`}
              >
                <Banknote className="w-4 h-4" />
                Cash
              </button>
              <button
                onClick={() =>
                  updateRow(row.party_id, {
                    mode: 'Online',
                    upiAmount: row.amount || '',
                  })
                }
                className={`h-11 text-sm font-semibold rounded-lg border-2 flex items-center justify-center gap-1.5 transition-colors ${
                  row.mode === 'Online'
                    ? 'bg-blue-50 text-blue-800 border-blue-400'
                    : 'bg-white text-slate-600 border-slate-300'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                Online
              </button>
            </div>

            {row.mode === 'Online' && (
              <div className="mb-2">
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  UPI Amount
                  <span className="text-slate-400 ml-1">
                    (rest becomes Cash)
                  </span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={row.upiAmount}
                  onChange={(e) =>
                    updateRow(row.party_id, {
                      upiAmount: e.target.value,
                      error: '',
                    })
                  }
                  className="w-full h-11 px-3 text-base text-right font-semibold border border-blue-300 bg-blue-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {totalAmt > 0 && (
                  <div className="mt-1.5 text-[11px] bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 flex justify-between">
                    <span className="text-slate-700">
                      UPI ₹{splitUpi.toFixed(2)} · Cash ₹{splitCash.toFixed(2)}
                    </span>
                    <span className="font-semibold text-slate-900">
                      Total ₹{totalAmt.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {row.error && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 mb-2">
                {row.error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => updateRow(row.party_id, { skipped: true })}
                className="h-11 px-3 text-xs font-medium text-slate-600 border border-slate-300 bg-white rounded-lg hover:bg-slate-50"
              >
                Skip
              </button>
              <button
                onClick={() => recordPayment(row.party_id)}
                disabled={
                  recording === row.party_id ||
                  recentlyRecorded.has(row.party_id)
                }
                className="flex-1 h-11 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {recording === row.party_id ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Record{' '}
                    {row.amount
                      ? formatCurrency(parseFloat(row.amount) || 0)
                      : 'Payment'}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {remaining <= 0.01 && row.cashPaid + row.upiPaid > 0 && (
          <div className="p-3 border-t border-slate-200">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5 flex-1">
                <Check className="w-4 h-4 shrink-0" />
                <span className="flex-1">
                  Paid ₹{(row.cashPaid + row.upiPaid).toFixed(2)}
                  {row.cashPaid > 0 && row.upiPaid > 0 && (
                    <>
                      {' '}
                      (₹{row.cashPaid.toFixed(2)} Cash + ₹
                      {row.upiPaid.toFixed(2)} UPI)
                    </>
                  )}
                </span>
              </div>
              {!row.is_counter_sale && (
                <button
                  onClick={() => openWhatsApp(row)}
                  className="h-10 px-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 flex items-center gap-1 shrink-0"
                >
                  <MessageCircleIcon className="w-4 h-4" />
                  Send
                </button>
              )}
            </div>
          </div>
        )}

        {row.skipped && remaining > 0.01 && (
          <div className="p-3 border-t border-slate-200">
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
              Skipped — bill stays pending, pays via /payments later
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="max-w-3xl mx-auto px-3 sm:px-4 pt-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-4 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto mb-2">
            <Check className="w-6 h-6" />
          </div>
          <div className="text-lg font-bold text-slate-900">
            Day closed — {formatDateLong(billDate)}
          </div>
          <div className="text-sm text-slate-600 mt-1">
            {daySummary?.count || summary.length} bill
            {(daySummary?.count || summary.length) === 1 ? '' : 's'} saved ·{' '}
            {formatCurrency(daySummary?.total || 0)}
          </div>
        </div>

        {summary
          .filter((r) => r.is_counter_sale)
          .map((row) => renderRowCard(row))}

        {unpaidRows.length > 0 && (
          <>
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2 mt-3 px-1">
              Record payment ({unpaidRows.length})
            </div>
            {unpaidRows.map((row) => renderRowCard(row))}
          </>
        )}

        {paidRows.length > 0 && (
          <>
            <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide mb-2 mt-4 px-1">
              Payment recorded ({paidRows.length})
            </div>
            {paidRows.map((row) => renderRowCard(row))}
          </>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 shadow-lg">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-2.5">
          <button
            onClick={onDone}
            className="w-full h-12 text-sm font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 active:bg-black flex items-center justify-center gap-2"
          >
            {allDone ? (
              <>
                <Check className="w-4 h-4" />
                Start New Sales
              </>
            ) : (
              <>Start New Sales — {unpaidRows.length} unpaid</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}