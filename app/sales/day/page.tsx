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

type DayItem = {
  id: number
  party_id: number
  item_id: number
  quantity: number
  rate: number
  amount: number
  cost_at_sale: number
  client_row_id: string
  created_at: string
}

type DayPayment = {
  id: number
  party_id: number
  cash: number
  upi: number
  created_at: string
}

type DayRow = {
  rowId: number
  client_row_id: string
  db_id: number | null
  item_id: number | null
  sku: string
  quantity: number
  rate: number
  amount: number
  cost_at_sale: number
  party_id: number
  saving: boolean
  error: string
}

type CloseResult = {
  party_id: number
  sale_id: number
  skipped: boolean
}

// ============================================================
// Constants
// ============================================================

const COUNTER_SALE_PARTY_ID = 3

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

function genRowId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ============================================================
// Component
// ============================================================

export default function DaySalesPage() {
  const router = useRouter()

  const [parties, setParties] = useState<Party[]>([])
  const [itemsCache, setItemsCache] = useState<Record<number, Item>>({})

  const [billDate] = useState(todayStr())
  const [rows, setRows] = useState<DayRow[]>([])
  const [payments, setPayments] = useState<DayPayment[]>([])
  const [lastPartyId, setLastPartyId] = useState<number | null>(null)

  const [addOpen, setAddOpen] = useState(true)
  const [editingRowId, setEditingRowId] = useState<number | null>(null)
  const [pendingNewParty, setPendingNewParty] = useState<string | null>(null)
  const [collectingPartyId, setCollectingPartyId] = useState<number | null>(
    null
  )

  const [closeState, setCloseState] = useState<
    'adding' | 'closing' | 'closed' | 'error'
  >('adding')
  const [closeError, setCloseError] = useState('')
  const [closeResult, setCloseResult] = useState<CloseResult[] | null>(null)
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [dialogData, setDialogData] = useState<{
    totalSales: number
    alreadyCash: number
    alreadyUpi: number
    counterSaleTotal: number
  } | null>(null)

  const [connected, setConnected] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [unclosedDays, setUnclosedDays] = useState<
    { bill_date: string; item_count: number }[]
  >([])
  const [closingUnclosed, setClosingUnclosed] = useState<string | null>(null)

  const nextRowIdRef = useRef(1)

  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.party_id, label: p.party_name })),
    [parties]
  )

  const partiesById = useMemo(() => {
    const map: Record<number, Party> = {}
    for (const p of parties) map[p.party_id] = p
    return map
  }, [parties])

  const activeRows = rows.filter((r) => r.item_id)
  const subtotal = activeRows.reduce((s, r) => s + r.amount, 0)

  // Aggregate rows by party
  const rowsByParty = useMemo(() => {
    const order: number[] = []
    const map: Record<number, DayRow[]> = {}
    for (const r of activeRows) {
      if (!map[r.party_id]) {
        map[r.party_id] = []
        order.push(r.party_id)
      }
      map[r.party_id].push(r)
    }
    return order
      .map((partyId) => {
        const partyRows = [...map[partyId]].reverse()
        const today = partyRows.reduce((s, r) => s + r.amount, 0)
        const partyPayments = payments.filter((p) => p.party_id === partyId)
        const paid = partyPayments.reduce((s, p) => s + p.cash + p.upi, 0)
        const currentBalance = Number(
          partiesById[partyId]?.current_balance || 0
        )
        const prev = currentBalance + paid
        const balance = prev + today - paid
        // Most recent row's rowId for sorting (higher = newer)
        const latestRowId = Math.max(...partyRows.map((r) => r.rowId))
        return {
          partyId,
          rows: partyRows,
          today,
          paid,
          prev,
          balance,
          latestRowId,
        }
      })
      // Sort by most recently added row (newest group at top)
      .sort((a, b) => b.latestRowId - a.latestRowId)
  }, [activeRows, payments, partiesById])

  // ============================================================
  // Initial load
  // ============================================================

  useEffect(() => {
    async function init() {
      const { data: partiesData } = await supabase
        .from('parties')
        .select('party_id, party_name, party_type, current_balance, phone')
        .eq('party_type', 'Customer')
        .order('party_name')
      setParties((partiesData as Party[]) || [])

      const { data: itemsData, error: itemsErr } = await supabase.rpc(
        'get_day_items',
        { p_bill_date: billDate }
      )
      if (itemsErr) {
        console.error('get_day_items failed:', itemsErr)
        setSyncError('Failed to load today\'s items')
      } else if (itemsData) {
        const loaded: DayRow[] = (
          itemsData as {
            id: number
            party_id: number
            item_id: number
            quantity: number
            rate: number
            amount: number
            cost_at_sale: number
            client_row_id: string
            created_at: string
          }[]
        ).map((r) => ({
          rowId: nextRowIdRef.current++,
          client_row_id: r.client_row_id,
          db_id: r.id,
          item_id: r.item_id,
          sku: '',
          quantity: Number(r.quantity),
          rate: Number(r.rate),
          amount: Number(r.amount),
          cost_at_sale: Number(r.cost_at_sale),
          party_id: r.party_id,
          saving: false,
          error: '',
        }))
        setRows(loaded)

        const itemIds = [...new Set(loaded.map((r) => r.item_id))]
        if (itemIds.length > 0) {
          const { data: itemRows } = await supabase
            .from('items')
            .select(
              'item_id, sku, current_stock, cost_price, selling_price, quality, variant'
            )
            .in('item_id', itemIds as number[])
          const cache: Record<number, Item> = {}
          for (const it of itemRows || []) cache[it.item_id] = it as Item
          setItemsCache(cache)
          setRows((prev) =>
            prev.map((r) =>
              r.item_id && cache[r.item_id]
                ? { ...r, sku: cache[r.item_id].sku }
                : r
            )
          )
        }
      }

      const { data: paymentsData } = await supabase
        .from('day_sales_payments')
        .select('id, party_id, cash, upi, created_at')
        .eq('bill_date', billDate)
        .order('id')
      setPayments((paymentsData as DayPayment[]) || [])

      // Check for unclosed previous days
      const { data: unclosedData } = await supabase
        .from('day_sales_items')
        .select('bill_date')
        .lt('bill_date', billDate)
      
      if (unclosedData) {
        const grouped: Record<string, number> = {}
        for (const r of unclosedData as { bill_date: string }[]) {
          grouped[r.bill_date] = (grouped[r.bill_date] || 0) + 1
        }
        const days = Object.entries(grouped)
          .map(([bill_date, item_count]) => ({ bill_date, item_count }))
          .sort((a, b) => b.bill_date.localeCompare(a.bill_date))
        setUnclosedDays(days)
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ============================================================
  // Realtime subscription — cross-device sync
  // ============================================================

  useEffect(() => {
    const channel = supabase
      .channel('day_sales_sync')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'day_sales_items',
          filter: `bill_date=eq.${billDate}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const r = payload.new as {
              id: number
              party_id: number
              item_id: number
              quantity: number
              rate: number
              amount: number
              cost_at_sale: number
              client_row_id: string
            }
            setRows((prev) => {
              if (prev.some((x) => x.client_row_id === r.client_row_id)) {
                return prev
              }
              return [
                ...prev,
                {
                  rowId: nextRowIdRef.current++,
                  client_row_id: r.client_row_id,
                  db_id: r.id,
                  item_id: r.item_id,
                  sku: itemsCache[r.item_id]?.sku || '',
                  quantity: Number(r.quantity),
                  rate: Number(r.rate),
                  amount: Number(r.amount),
                  cost_at_sale: Number(r.cost_at_sale),
                  party_id: r.party_id,
                  saving: false,
                  error: '',
                },
              ]
            })
            if (!itemsCache[r.item_id]) {
              supabase
                .from('items')
                .select(
                  'item_id, sku, current_stock, cost_price, selling_price, quality, variant'
                )
                .eq('item_id', r.item_id)
                .single()
                .then(({ data }) => {
                  if (data) {
                    setItemsCache((prev) => ({ ...prev, [data.item_id]: data as Item }))
                    setRows((prev) =>
                      prev.map((x) =>
                        x.client_row_id === r.client_row_id
                          ? { ...x, sku: (data as Item).sku }
                          : x
                      )
                    )
                  }
                })
            }
          } else if (payload.eventType === 'UPDATE') {
            const r = payload.new as {
              id: number
              quantity: number
              rate: number
              amount: number
              cost_at_sale: number
              client_row_id: string
            }
            setRows((prev) =>
              prev.map((x) =>
                x.client_row_id === r.client_row_id
                  ? {
                      ...x,
                      db_id: r.id,
                      quantity: Number(r.quantity),
                      rate: Number(r.rate),
                      amount: Number(r.amount),
                      cost_at_sale: Number(r.cost_at_sale),
                    }
                  : x
              )
            )
          } else if (payload.eventType === 'DELETE') {
            const r = payload.old as { client_row_id: string }
            setRows((prev) =>
              prev.filter((x) => x.client_row_id !== r.client_row_id)
            )
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'day_sales_payments',
          filter: `bill_date=eq.${billDate}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const p = payload.new as DayPayment
            setPayments((prev) => {
              if (prev.some((x) => x.id === p.id)) return prev
              return [...prev, p]
            })
          } else if (payload.eventType === 'DELETE') {
            const p = payload.old as { id: number }
            setPayments((prev) => prev.filter((x) => x.id !== p.id))
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnected(true)
        else setConnected(false)
      })

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billDate, itemsCache])

  // ============================================================
  // Derived helpers
  // ============================================================

  function partyName(id: number): string {
    return partiesById[id]?.party_name || `#${id}`
  }

  function defaultPartyForNewRow(): number {
    if (lastPartyId) return lastPartyId
    return COUNTER_SALE_PARTY_ID
  }

  // ============================================================
  // END OF PART 1 — continue with Part 2
  // ============================================================
    // ============================================================
  // Row operations — direct DB writes
  // ============================================================

  async function addRow(
    item: Item,
    qty: number,
    rate: number,
    partyId: number
  ) {
    const clientId = genRowId()
    const amount = Number((qty * rate).toFixed(2))
    const localRowId = nextRowIdRef.current++

    // Optimistic UI — add row locally with saving flag
    const optimisticRow: DayRow = {
      rowId: localRowId,
      client_row_id: clientId,
      db_id: null,
      item_id: item.item_id,
      sku: item.sku,
      quantity: qty,
      rate,
      amount,
      cost_at_sale: item.cost_price,
      party_id: partyId,
      saving: true,
      error: '',
    }
    setRows((prev) => [...prev, optimisticRow])
    setLastPartyId(partyId)
    setItemsCache((prev) => ({ ...prev, [item.item_id]: item }))

    const { data, error } = await supabase
      .from('day_sales_items')
      .insert({
        bill_date: billDate,
        party_id: partyId,
        item_id: item.item_id,
        quantity: qty,
        rate,
        amount,
        cost_at_sale: item.cost_price,
        client_row_id: clientId,
      })
      .select('id')
      .single()

    if (error) {
      console.error('addRow failed:', error)
      setRows((prev) =>
        prev.map((r) =>
          r.client_row_id === clientId
            ? { ...r, saving: false, error: 'Save failed — retry' }
            : r
        )
      )
    } else {
      setRows((prev) =>
        prev.map((r) =>
          r.client_row_id === clientId
            ? { ...r, db_id: data.id, saving: false }
            : r
        )
      )
    }
  }

  async function updateRow(rowId: number, patch: Partial<DayRow>) {
    const row = rows.find((r) => r.rowId === rowId)
    if (!row) return

    const merged = { ...row, ...patch }
    merged.amount = Number((merged.quantity * merged.rate).toFixed(2))

    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...merged, saving: true } : r))
    )

    if (!row.db_id) {
      // Row hasn't synced yet — will retry via optimistic insert
      setRows((prev) =>
        prev.map((r) => (r.rowId === rowId ? { ...r, saving: false } : r))
      )
      return
    }

    const { error } = await supabase
      .from('day_sales_items')
      .update({
        item_id: merged.item_id,
        quantity: merged.quantity,
        rate: merged.rate,
        amount: merged.amount,
        cost_at_sale: merged.cost_at_sale,
        party_id: merged.party_id,
      })
      .eq('id', row.db_id)

    if (error) {
      console.error('updateRow failed:', error)
      setRows((prev) =>
        prev.map((r) =>
          r.rowId === rowId ? { ...r, saving: false, error: 'Update failed' } : r
        )
      )
    } else {
      setRows((prev) =>
        prev.map((r) => (r.rowId === rowId ? { ...r, saving: false } : r))
      )
    }
  }

  async function deleteRow(rowId: number) {
    const row = rows.find((r) => r.rowId === rowId)
    if (!row) return

    setRows((prev) => prev.filter((r) => r.rowId !== rowId))

    if (row.db_id) {
      const { error } = await supabase
        .from('day_sales_items')
        .delete()
        .eq('id', row.db_id)
      if (error) {
        console.error('deleteRow failed:', error)
        // Rollback: re-add row
        setRows((prev) => [...prev, row])
      }
    }
  }

  // ============================================================
  // Party creation
  // ============================================================

  function handleNewPartyCreated(party: Party) {
    setParties((prev) =>
      [...prev, party].sort((a, b) => a.party_name.localeCompare(b.party_name))
    )
    setLastPartyId(party.party_id)
    setPendingNewParty(null)
  }

  // ============================================================
  // Collect payment (per party)
  // ============================================================

  async function collectPayment(
    partyId: number,
    cashAmount: number,
    upiAmount: number
  ): Promise<{ ok: boolean; error?: string }> {
    const total = cashAmount + upiAmount
    if (total <= 0) {
      return { ok: false, error: 'Amount must be > 0' }
    }

    try {
      // 1. Insert day_sales_payments row
      const { error: dayPayErr } = await supabase
        .from('day_sales_payments')
        .insert({
          bill_date: billDate,
          party_id: partyId,
          cash: cashAmount,
          upi: upiAmount,
        })
      if (dayPayErr) throw new Error(dayPayErr.message)

      // 2. Insert payments row(s) — Cash and/or UPI
      const inserts: {
        party_id: number
        payment_date: string
        amount: number
        payment_mode: string
      }[] = []
      if (cashAmount > 0) {
        inserts.push({
          party_id: partyId,
          payment_date: billDate,
          amount: cashAmount,
          payment_mode: 'Cash',
        })
      }
      if (upiAmount > 0) {
        inserts.push({
          party_id: partyId,
          payment_date: billDate,
          amount: upiAmount,
          payment_mode: 'UPI',
        })
      }
      const { error: payErr } = await supabase
        .from('payments')
        .insert(inserts)
      if (payErr) throw new Error(payErr.message)

      // 3. Update party balance
      const { data: party } = await supabase
        .from('parties')
        .select('current_balance')
        .eq('party_id', partyId)
        .single()
      if (party) {
        await supabase
          .from('parties')
          .update({
            current_balance: Number(party.current_balance) - total,
          })
          .eq('party_id', partyId)
        setParties((prev) =>
          prev.map((p) =>
            p.party_id === partyId
              ? {
                  ...p,
                  current_balance: Number(party.current_balance) - total,
                }
              : p
          )
        )
      }

      // 4. Apply FIFO to outstanding bills
      await applyFIFO(partyId, total)

      return { ok: true }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Payment failed'
      return { ok: false, error: msg }
    }
  }

  // ============================================================
  // CLOSE DAY
  // ============================================================

  // Opens the Close Day dialog — fetches current payment totals first
  const handleCloseDayClick = useCallback(async () => {
    setCloseError('')
    if (activeRows.length === 0) {
      setCloseError('Nothing to close — add at least one item.')
      return
    }

    // Fetch today's already-recorded payments (Cash + UPI)
    const { data: payData } = await supabase
      .from('payments')
      .select('amount, payment_mode')
      .eq('payment_date', billDate)

    const rows = (payData || []) as { amount: number; payment_mode: string }[]
    const alreadyCash = rows
      .filter((p) => p.payment_mode === 'Cash')
      .reduce((s, p) => s + Number(p.amount), 0)
    const alreadyUpi = rows
      .filter((p) => p.payment_mode === 'UPI')
      .reduce((s, p) => s + Number(p.amount), 0)

    // Counter Sale total (party 3)
    const counterSaleTotal = activeRows
      .filter((r) => r.party_id === COUNTER_SALE_PARTY_ID)
      .reduce((s, r) => s + r.amount, 0)

    setDialogData({
      totalSales: subtotal,
      alreadyCash,
      alreadyUpi,
      counterSaleTotal,
    })
    setShowCloseDialog(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRows, subtotal, billDate])

  // Actual close — called from the dialog after staff confirms UPI
  const performCloseDay = useCallback(
    async (totalUpiToday: number) => {
      setCloseState('closing')
      setShowCloseDialog(false)
      try {
        // 1. Run the close RPC (creates bills, clears day_sales_items)
        const { data, error } = await supabase.rpc('close_day_sales', {
          p_bill_date: billDate,
        })
        if (error) throw new Error(error.message)

        // 2. Insert Counter Sale payment rows based on UPI reconciliation
        if (dialogData && dialogData.counterSaleTotal > 0) {
          const deltaUpi = Math.max(0, totalUpiToday - dialogData.alreadyUpi)
          const counterSaleUpi = Math.min(
            deltaUpi,
            dialogData.counterSaleTotal
          )
          const counterSaleCash = Math.max(
            0,
            dialogData.counterSaleTotal - counterSaleUpi
          )

          const counterInserts: {
            party_id: number
            payment_date: string
            amount: number
            payment_mode: string
          }[] = []
          if (counterSaleCash > 0.01) {
            counterInserts.push({
              party_id: COUNTER_SALE_PARTY_ID,
              payment_date: billDate,
              amount: counterSaleCash,
              payment_mode: 'Cash',
            })
          }
          if (counterSaleUpi > 0.01) {
            counterInserts.push({
              party_id: COUNTER_SALE_PARTY_ID,
              payment_date: billDate,
              amount: counterSaleUpi,
              payment_mode: 'UPI',
            })
          }
          if (counterInserts.length > 0) {
            await supabase.from('payments').insert(counterInserts)
          }
        }

        const results = (data as CloseResult[]) || []
        setCloseResult(results)
        setRows([])
        setPayments([])
        setDialogData(null)
        setCloseState('closed')
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Close failed'
        setCloseState('error')
        setCloseError(msg)
        setShowCloseDialog(false)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [billDate, dialogData]
  )

  // ============================================================
  // END OF PART 2 — continue with Part 3
  // ============================================================
    // ============================================================
  // RENDER — close/error states
  // ============================================================

  if (closeState === 'closing') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <div className="text-lg font-bold text-slate-900 mb-1">
            Closing day…
          </div>
          <div className="text-sm text-slate-600">
            Creating bills for {activeRows.length} item
            {activeRows.length === 1 ? '' : 's'}.
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
            Your items are still saved. Try again — if the network is down,
            wait a moment.
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

  if (closeState === 'closed' && closeResult) {
    return (
      <CloseSummary
        billDate={billDate}
        results={closeResult}
        partiesById={partiesById}
        onDone={() => {
          setCloseResult(null)
          setCloseState('adding')
          router.refresh()
        }}
      />
    )
  }

  // ============================================================
  // MAIN RENDER
  // ============================================================

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <div className="max-w-3xl mx-auto px-3 sm:px-4 pt-3 sm:pt-4">
        {/* STICKY HEADER */}
        <div className="sticky top-0 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-slate-50/95 backdrop-blur border-b border-slate-200 z-20 mb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                  Day Sales
                </h1>
                {connected && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">
                    ● live
                  </span>
                )}
                {!connected && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-medium">
                    ○ offline
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {formatDateLong(billDate)} · {activeRows.length} item
                {activeRows.length === 1 ? '' : 's'} ·{' '}
                {rowsByParty.length} part
                {rowsByParty.length === 1 ? 'y' : 'ies'}
              </div>
            </div>
            <button
              onClick={handleCloseDayClick}
              disabled={activeRows.length === 0}
              className="h-9 px-3 text-xs font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              Close Day
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 mt-1">
            <div className="text-[10px] text-slate-500">Subtotal</div>
            <div className="text-sm font-bold text-slate-900">
              {formatCurrency(subtotal)}
            </div>
          </div>
        </div>

        {unclosedDays.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 mb-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-amber-900">
                  Unclosed day{unclosedDays.length > 1 ? 's' : ''}
                </div>
                <div className="mt-1 space-y-1.5">
                  {unclosedDays.map((d) => (
                    <div
                      key={d.bill_date}
                      className="flex items-center justify-between gap-2 text-xs bg-white border border-amber-200 rounded px-2 py-1.5"
                    >
                      <span className="text-amber-900">
                        {formatDateLong(d.bill_date)} — {d.item_count} item
                        {d.item_count === 1 ? '' : 's'}
                      </span>
                      <button
                        onClick={async () => {
                          if (!confirm(`Close ${formatDateLong(d.bill_date)}?`)) return
                          setClosingUnclosed(d.bill_date)
                          const { error } = await supabase.rpc('close_day_sales', {
                            p_bill_date: d.bill_date,
                          })
                          if (error) {
                            alert('Failed: ' + error.message)
                          } else {
                            setUnclosedDays((prev) =>
                              prev.filter((x) => x.bill_date !== d.bill_date)
                            )
                            alert('Closed successfully')
                          }
                          setClosingUnclosed(null)
                        }}
                        disabled={closingUnclosed === d.bill_date}
                        className="text-[11px] font-semibold text-white bg-amber-700 hover:bg-amber-800 px-2 py-1 rounded disabled:opacity-50 shrink-0"
                      >
                        {closingUnclosed === d.bill_date ? 'Closing…' : 'Close'}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-amber-700 mt-1.5">
                  Close these days to make them appear as bills.
                </div>
              </div>
            </div>
          </div>
        )}

        {syncError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 mb-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-sm text-rose-800 flex-1">{syncError}</div>
            <button
              onClick={() => setSyncError('')}
              className="text-rose-600 hover:text-rose-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {closeError && (
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
        {/* ADD BUTTON / PANEL */}
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
            onAdd={async (item, qty, rate, partyId) => {
              await addRow(item, qty, rate, partyId)
            }}
            onCreateNewParty={(name) => setPendingNewParty(name)}
            setItemsCache={setItemsCache}
          />
        )}
        {/* PARTY GROUPS */}
        <div className="space-y-2 mb-3">
          {rowsByParty.length === 0 && !addOpen && (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl py-8 px-4 text-center">
              <div className="text-sm text-slate-500 mb-1">No items yet</div>
              <div className="text-xs text-slate-400">
                Tap “Add Item” to start today’s entries.
              </div>
            </div>
          )}

          {rowsByParty.map((group) => (
            <div key={group.partyId} data-party-group={group.partyId}>
              <PartyGroupSection
                group={group}
                party={partiesById[group.partyId]}
                onEditRow={(rowId) => setEditingRowId(rowId)}
                onDeleteRow={(rowId) => deleteRow(rowId)}
                collecting={collectingPartyId === group.partyId}
                onCollect={() => setCollectingPartyId(group.partyId)}
                onCancelCollect={() => setCollectingPartyId(null)}
                onRecordPayment={async (cash, upi) => {
                  const res = await collectPayment(group.partyId, cash, upi)
                  if (res.ok) setCollectingPartyId(null)
                  return res
                }}
              />
            </div>
          ))}
        </div>


      </div>

      {/* EDIT MODAL */}
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

      {showCloseDialog && dialogData && (
        <CloseDayDialog
          billDate={billDate}
          totalSales={dialogData.totalSales}
          alreadyCash={dialogData.alreadyCash}
          alreadyUpi={dialogData.alreadyUpi}
          counterSaleTotal={dialogData.counterSaleTotal}
          onCancel={() => setShowCloseDialog(false)}
          onConfirm={performCloseDay}
        />
      )}
    </div>
  )
}

// ============================================================
// END OF PART 3 — continue with Part 4 (sub-components)
// ============================================================
// ============================================================
// SUB-COMPONENTS
// ============================================================

function PartyGroupSection({
  group,
  party,
  onEditRow,
  onDeleteRow,
  collecting,
  onCollect,
  onCancelCollect,
  onRecordPayment,
}: {
  group: {
    partyId: number
    rows: DayRow[]
    today: number
    paid: number
    prev: number
    balance: number
  }
  party: Party | undefined
  onEditRow: (rowId: number) => void
  onDeleteRow: (rowId: number) => void
  collecting: boolean
  onCollect: () => void
  onCancelCollect: () => void
  onRecordPayment: (
    cash: number,
    upi: number
  ) => Promise<{ ok: boolean; error?: string }>
}) {
  const payAmountRef = useRef<HTMLInputElement>(null)
  const upiAmountRef = useRef<HTMLInputElement>(null)

  const [payAmount, setPayAmount] = useState('')
  const [mode, setMode] = useState<'Cash' | 'Online'>('Cash')
  const [upiAmount, setUpiAmount] = useState('')
  const [recording, setRecording] = useState(false)
  const [payError, setPayError] = useState('')

  const fullName = party?.party_name || `#${group.partyId}`
  const phone = party?.phone
  const last4 = phone ? phone.slice(-4) : null
  const displayName = last4 ? `${fullName} · ${last4}` : fullName

  const totalAmt = parseFloat(payAmount) || 0
  const upiAmt = parseFloat(upiAmount) || 0
  const splitUpi = mode === 'Online' ? Math.min(upiAmt, totalAmt) : 0
  const splitCash = mode === 'Online' ? totalAmt - splitUpi : totalAmt

  function resetCollect() {
    setPayAmount('')
    setUpiAmount('')
    setMode('Cash')
    setPayError('')
  }

  useEffect(() => {
    if (collecting) {
      setTimeout(() => {
        payAmountRef.current?.focus()
        payAmountRef.current?.select()
      }, 100)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collecting])

  async function handleRecord() {
    if (totalAmt <= 0) {
      setPayError('Amount must be > 0')
      return
    }
    if (mode === 'Online' && upiAmt > totalAmt) {
      setPayError('UPI cannot exceed total')
      return
    }
    setRecording(true)
    setPayError('')
    const res = await onRecordPayment(splitCash, splitUpi)
    if (res.ok) {
      resetCollect()
    } else {
      setPayError(res.error || 'Payment failed')
    }
    setRecording(false)
  }

  function handleCancel() {
    resetCollect()
    onCancelCollect()
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-xs font-semibold text-slate-800 truncate">
            {displayName}
          </span>
        </div>
        {!collecting && party?.party_id !== 3 && (
          <button
            onClick={onCollect}
            className="h-7 px-2.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 active:bg-emerald-200 shrink-0"
          >
            Collect
          </button>
        )}
      </div>

      {/* Items */}
      <div className="divide-y divide-slate-100">
        {group.rows.map((row) => (
          <CompactRow
            key={row.rowId}
            row={row}
            onEdit={() => onEditRow(row.rowId)}
            onDelete={() => onDeleteRow(row.rowId)}
          />
        ))}
      </div>

      {/* Summary line */}
      <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 grid grid-cols-4 gap-1 text-[10px]">
        <div>
          <div className="text-slate-500 uppercase tracking-wide">Prev</div>
          <div className="text-slate-800 font-semibold mt-0.5">
            {formatCurrency(group.prev)}
          </div>
        </div>
        <div>
          <div className="text-slate-500 uppercase tracking-wide">Today</div>
          <div className="text-slate-800 font-semibold mt-0.5">
            {formatCurrency(group.today)}
          </div>
        </div>
        <div>
          <div className="text-slate-500 uppercase tracking-wide">Paid</div>
          <div className="text-emerald-700 font-semibold mt-0.5">
            {formatCurrency(group.paid)}
          </div>
        </div>
        <div>
          <div className="text-slate-500 uppercase tracking-wide">Balance</div>
          <div className="text-rose-700 font-bold mt-0.5">
            {formatCurrency(group.balance)}
          </div>
        </div>
      </div>

      {/* Inline collect payment */}
      {collecting && (
        <div className="p-3 border-t-2 border-emerald-300 bg-emerald-50">
          <div className="text-[11px] font-semibold text-emerald-900 mb-2">
            Collect payment — {displayName}
          </div>

          <div className="flex gap-2 mb-2">
            <input
              ref={payAmountRef}
              type="number"
              inputMode="numeric"
              placeholder="Enter amount"
              value={payAmount}
              onChange={(e) => {
                setPayAmount(e.target.value)
                setPayError('')
              }}
              onFocus={(e) => e.target.select()}
              className="flex-1 h-11 px-3 text-base text-right font-semibold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <button
              onClick={() => setPayAmount(String(group.balance))}
              className="h-11 px-3 text-xs font-medium text-slate-700 border border-slate-300 bg-white rounded-lg hover:bg-slate-50"
            >
              Full
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              onClick={() => {
                setMode('Cash')
                setUpiAmount('')
              }}
              className={`h-10 text-sm font-semibold rounded-lg border-2 flex items-center justify-center gap-1.5 transition-colors ${
                mode === 'Cash'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-400'
                  : 'bg-white text-slate-600 border-slate-300'
              }`}
            >
              <Banknote className="w-4 h-4" />
              Cash
            </button>
            <button
              onClick={() => {
                setMode('Online')
                setUpiAmount(payAmount || '')
                setTimeout(() => {
                  upiAmountRef.current?.focus()
                  upiAmountRef.current?.select()
                }, 100)
              }}
              className={`h-10 text-sm font-semibold rounded-lg border-2 flex items-center justify-center gap-1.5 transition-colors ${
                mode === 'Online'
                  ? 'bg-blue-50 text-blue-800 border-blue-400'
                  : 'bg-white text-slate-600 border-slate-300'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              Online
            </button>
          </div>

          {mode === 'Online' && (
            <div className="mb-2">
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                UPI Amount
                <span className="text-slate-400 ml-1">
                  (rest becomes Cash)
                </span>
              </label>
              <input
                ref={upiAmountRef}
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={upiAmount}
                onChange={(e) => {
                  setUpiAmount(e.target.value)
                  setPayError('')
                }}
                onFocus={(e) => e.target.select()}
                className="w-full h-10 px-3 text-sm text-right font-semibold border border-blue-300 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {totalAmt > 0 && (
                <div className="mt-1.5 text-[11px] bg-white border border-blue-200 rounded-lg px-2 py-1.5 flex justify-between">
                  <span className="text-slate-700">
                    UPI ₹{splitUpi.toFixed(2)} · Cash ₹{splitCash.toFixed(2)}
                  </span>
                  <span className="font-semibold text-slate-900">
                    ₹{totalAmt.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {payError && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 mb-2">
              {payError}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={recording}
              className="h-10 px-3 text-xs font-medium text-slate-600 border border-slate-300 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRecord}
              disabled={recording || totalAmt <= 0}
              className="flex-1 h-10 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {recording ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Record {totalAmt > 0 ? formatCurrency(totalAmt) : 'Payment'}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CompactRow({
  row,
  onEdit,
  onDelete,
}: {
  row: DayRow
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
      <button onClick={onEdit} className="flex-1 min-w-0 text-left flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs font-semibold text-slate-900 truncate">
            {row.sku || '—'}
          </div>
        </div>
        <div className="text-[11px] text-slate-500 shrink-0 text-right">
          {row.quantity} × {formatCurrency(row.rate)}
        </div>
        <div className="text-xs font-bold text-slate-900 shrink-0 w-16 text-right">
          {formatCurrency(row.amount)}
        </div>
        {row.saving && (
          <Loader2 className="w-3 h-3 animate-spin text-slate-400 shrink-0" />
        )}
        {row.error && (
          <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
        )}
      </button>
      <button
        onClick={onDelete}
        className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded shrink-0"
        aria-label="Delete"
      >
        <Trash2 className="w-3 h-3" />
      </button>
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
  onAdd: (item: Item, qty: number, rate: number, partyId: number) => Promise<void>
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
  const partyWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTimeout(() => skuRef.current?.focus(), 150)
  }, [])

  useEffect(() => {
    setPartyId(defaultPartyId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPartyId])

 
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

  async function handleSubmit() {
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
    await onAdd(pickedItem, q, r, partyId)
    setPickedItem(null)
    setQty('1')
    setRate('')
    setSearchResults([])
    setError('')
    setTimeout(() => {
      skuRef.current?.focus()
      // Scroll so the last party group is roughly upper-mid viewport
      const groups = document.querySelectorAll('[data-party-group]')
      if (groups.length > 0) {
        const newestGroup = groups[0] as HTMLElement
        const rect = newestGroup.getBoundingClientRect()
        const targetY = window.scrollY + rect.top - 320
        window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' })
      }
    }, 100)
  }

  const itemOptions = searchResults.map((it) => ({
    value: it.item_id,
    label: `${it.sku} · stock ${it.current_stock} · sp ₹${it.selling_price} · cp ₹${it.cost_price}`,
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
                      partyWrapRef.current?.querySelector<HTMLInputElement>(
                        'input'
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
                  }
                }}
className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>
        )}                

        {pickedItem && (
          <div
            ref={partyWrapRef}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault()
                e.stopPropagation()
                handleSubmit()
              }
            }}
          >
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
    label: `${it.sku} · stock ${it.current_stock} · sp ₹${it.selling_price} · cp ₹${it.cost_price}`,
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

function CloseSummary({
  billDate,
  results,
  partiesById,
  onDone,
}: {
  billDate: string
  results: CloseResult[]
  partiesById: Record<number, Party>
  onDone: () => void
}) {
  const committed = results.filter((r) => !r.skipped)
  const skipped = results.filter((r) => r.skipped)

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
            {committed.length} bill{committed.length === 1 ? '' : 's'} created
            {skipped.length > 0 && ` · ${skipped.length} already existed`}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-4">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="text-sm font-semibold text-slate-700">
              Bills created
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {results.map((r) => (
              <div
                key={`${r.party_id}-${r.sale_id}`}
                className="px-4 py-3 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {partiesById[r.party_id]?.party_name || `#${r.party_id}`}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Bill #{r.sale_id}
                    {r.skipped && (
                      <span className="ml-1 text-amber-700">· existed</span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400 shrink-0">
                  {r.skipped ? '—' : '✓'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 shadow-lg">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-2.5">
          <button
            onClick={onDone}
            className="w-full h-12 text-sm font-bold text-white bg-slate-900 rounded-xl hover:bg-slate-800 active:bg-black flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            Start New Day
          </button>
        </div>
      </div>
    </div>
  )
}
  // ============================================================
// CloseDayDialog — reconciliation before close
// ============================================================

function CloseDayDialog({
  billDate,
  totalSales,
  alreadyCash,
  alreadyUpi,
  counterSaleTotal,
  onCancel,
  onConfirm,
}: {
  billDate: string
  totalSales: number
  alreadyCash: number
  alreadyUpi: number
  counterSaleTotal: number
  onCancel: () => void
  onConfirm: (totalUpiToday: number) => Promise<void>
}) {
  const [upiInput, setUpiInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const enteredUpi = upiInput.trim() === '' ? alreadyUpi : parseFloat(upiInput)
  const validUpi = !isNaN(enteredUpi) && enteredUpi >= 0

  const deltaUpi = validUpi ? Math.max(0, enteredUpi - alreadyUpi) : 0
  const counterSaleUpi = Math.min(deltaUpi, counterSaleTotal)
  const counterSaleCash = Math.max(0, counterSaleTotal - counterSaleUpi)

  const totalUpiToday = alreadyUpi + counterSaleUpi
  const totalCashToday = alreadyCash + counterSaleCash

  async function handleConfirm() {
    if (!validUpi) {
      setError('Enter a valid UPI amount (or leave empty for all cash)')
      return
    }
    if (enteredUpi < alreadyUpi - 0.01) {
      setError(
        `Total UPI (₹${enteredUpi.toFixed(2)}) cannot be less than already recorded (₹${alreadyUpi.toFixed(2)}). Correct via /payments first.`
      )
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(enteredUpi)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Close failed'
      setError(msg)
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="text-base font-bold text-slate-900">Close Day</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {formatDateLong(billDate)}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Sales total */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-600">Total sales today</span>
              <span className="text-sm font-bold text-slate-900">
                {formatCurrency(totalSales)}
              </span>
            </div>
          </div>

          {/* Already recorded */}
          <div>
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Recorded during day
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                <div className="text-[10px] text-emerald-700 uppercase tracking-wide">
                  Cash
                </div>
                <div className="text-sm font-bold text-emerald-800 mt-0.5">
                  {formatCurrency(alreadyCash)}
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5">
                <div className="text-[10px] text-blue-700 uppercase tracking-wide">
                  UPI
                </div>
                <div className="text-sm font-bold text-blue-800 mt-0.5">
                  {formatCurrency(alreadyUpi)}
                </div>
              </div>
            </div>
          </div>

          {/* Counter Sale section */}
          {counterSaleTotal > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <div className="text-xs text-amber-800">
                Counter Sale (not yet recorded):
                <span className="font-bold ml-1">
                  {formatCurrency(counterSaleTotal)}
                </span>
              </div>
            </div>
          )}

          {/* UPI input */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Total UPI received today
              <span className="text-slate-400 ml-1">
                (leave empty for all cash)
              </span>
            </label>
            <input
              type="number"
              inputMode="numeric"
              placeholder={alreadyUpi > 0 ? `Total (already ₹${alreadyUpi.toFixed(2)})` : '0 (all cash)'}
              value={upiInput}
              onChange={(e) => {
                setUpiInput(e.target.value)
                setError('')
              }}
              className="w-full h-11 px-3 text-base text-right font-semibold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Preview */}
          {counterSaleTotal > 0 && validUpi && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 space-y-1">
              <div className="text-[11px] font-semibold text-blue-900 mb-1">
                Counter Sale will be split as:
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">UPI</span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency(counterSaleUpi)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Cash</span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency(counterSaleCash)}
                </span>
              </div>
            </div>
          )}

          {/* Totals preview */}
          {validUpi && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-1">
                Day total
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Cash</span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency(totalCashToday)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">UPI</span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency(totalUpiToday)}
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-3 flex gap-2 bg-slate-50">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="h-11 px-4 text-sm font-medium text-slate-700 border border-slate-300 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="flex-1 h-11 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Closing…
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Close Day
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
