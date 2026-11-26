
'use client'

import { useEffect, useRef, useState, createRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { NewPartyDialog } from '../../components/ui/new-party-dialog'
import { DateGroupedList } from '../../components/ui/date-grouped-list'
import {
  Plus,
  Trash2,
  Save,
  X,
  Pencil,
  ChevronDown,
  ChevronRight,
  Users,
} from 'lucide-react'
import { getRole } from '../../lib/auth'
import { searchItems as searchItemsShared } from '../../lib/item-search'
import { recomputePartyBalance } from '../../lib/balance'
import {
  computeSaleStatus,
  normalizeAmount,
} from '../../lib/sale-status'

type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
  phone: string | null
}

type Item = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
  selling_price: number
  quality?: string | null
  variant?: string | null
  network?: string | null
}

type SaleRow = {
  rowId: number
  item_id: number | null
  sku: string
  quantity: number
  rate: number
  amount: number
  cost_price?: number
}

type SaleHeader = {
  sale_id: number
  party_id: number
  bill_date: string
  total_amount: number
  status: string
  paid_amount?: number | null
  entry_date?: string
}

type PickedShop = {
  id: number | null
  label: string
  isNew: boolean
}

type ReportLine = {
  bill_date: string | null
  sku: string | null
  quantity: number
  rate: number
  amount: number
}

type EditRow = {
  rowId: number
  detail_id: number | null
  item_id: number | null
  sku: string
  quantity: number
  rate: number
  amount: number
  cost_at_sale: number
}

type EditState = {
  sale_id: number
  party_id: number
  bill_date: string
  original_total: number
  paid_amount: number
  rows: EditRow[]
  nextRowId: number
  itemCache: Record<number, Item>
}

const COUNTER_SALE_NAME = 'Counter Sale'

function getLocalDateString() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function money(value: number | string | null | undefined) {
  return Number(value || 0).toFixed(2)
}

function saleStatusStyle(status: string) {
  const value = (status || '').toLowerCase().trim()

  if (value === 'paid') {
    return 'bg-emerald-100 text-emerald-800 border border-emerald-200'
  }

  if (
    value === 'partially paid' ||
    value === 'partial' ||
    value === 'partially_paid'
  ) {
    return 'bg-amber-100 text-amber-800 border border-amber-200'
  }

  if (
    value === 'partial return' ||
    value === 'partially returned' ||
    value === 'partial_return'
  ) {
    return 'bg-purple-100 text-purple-800 border border-purple-200'
  }

  if (value === 'returned') {
    return 'bg-slate-200 text-slate-700 border border-slate-300'
  }

  if (
    value === 'returned with balance' ||
    value === 'returned_with_balance'
  ) {
    return 'bg-orange-100 text-orange-800 border border-orange-200'
  }

  if (value === 'cancelled') {
    return 'bg-slate-100 text-slate-500 border border-slate-200'
  }

  return 'bg-rose-100 text-rose-800 border border-rose-200'
}

export default function SalesEntryPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-slate-500">
          Loading…
        </div>
      }
    >
      <SalesEntryPage />
    </Suspense>
  )
}

function SalesEntryPage() {
  const searchParams = useSearchParams()
  const prefillItemId = searchParams.get('prefill_item_id')
  const prefillPartyId = searchParams.get('party_id')

  const [shops, setShops] = useState<Party[]>([])
  const [todaySales, setTodaySales] = useState<SaleHeader[]>([])
  const [isOwner, setIsOwner] = useState(false)

  const todayStr = getLocalDateString()
  const [reportFrom, setReportFrom] = useState(todayStr)
  const [reportTo, setReportTo] = useState(todayStr)
  const [reportLines, setReportLines] = useState<ReportLine[]>([])
  const [reportLoading, setReportLoading] = useState(false)

  const [rowItemOptions, setRowItemOptions] = useState<Record<number, Item[]>>(
    {}
  )

  const [pickedShop, setPickedShop] = useState<PickedShop>({
    id: null,
    label: '',
    isNew: false,
  })

  const [billDate, setBillDate] = useState(todayStr)

  const [rows, setRows] = useState<SaleRow[]>([
    { rowId: 1, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
  ])

  const [paidAmount, setPaidAmount] = useState(0)
  const [nextRowId, setNextRowId] = useState(2)

  const [pendingFocusRowId, setPendingFocusRowId] = useState<number | null>(
    null
  )

  const [pendingFocusQtyRowId, setPendingFocusQtyRowId] = useState<
    number | null
  >(null)

  const [pendingNewParty, setPendingNewParty] = useState<string | null>(null)

  const [expandedCustomers, setExpandedCustomers] = useState<
    Record<number, boolean>
  >({})

  const [editState, setEditState] = useState<EditState | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editMessage, setEditMessage] = useState('')
  const [editRowOptions, setEditRowOptions] = useState<
    Record<number, Item[]>
  >({})

  const itemRefs = useRef<
    Record<number, React.RefObject<HTMLInputElement | null>>
  >({})

  function getItemRef(
    rowId: number
  ): React.RefObject<HTMLInputElement | null> {
    if (!itemRefs.current[rowId]) {
      itemRefs.current[rowId] = createRef<HTMLInputElement>()
    }
    return itemRefs.current[rowId]
  }

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
    setIsOwner(getRole() === 'owner')
    loadData()
  }, [])

  useEffect(() => {
    if (!prefillPartyId) return

    const id = Number(prefillPartyId)
    if (!id || isNaN(id) || shops.length === 0) return

    const shop = shops.find((s) => s.party_id === id)
    if (!shop) return

    setPickedShop({
      id: shop.party_id,
      label: shop.party_name,
      isNew: false,
    })

    const timers = [50, 150, 300].map((delay) =>
      setTimeout(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            'input[data-row-item="row-1"]'
          )
        )
        const el = candidates.find((c) => c.offsetParent !== null)

        if (el && document.activeElement !== el) {
          el.focus()
          try {
            el.select()
          } catch {
            // Ignore focus selection errors.
          }
        }
      }, delay)
    )

    return () => timers.forEach((t) => clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shops, prefillPartyId])

  useEffect(() => {
    loadReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportFrom, reportTo])

  useEffect(() => {
    if (pendingFocusRowId == null) return

    const focusVisible = (): boolean => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          `input[data-row-item="row-${pendingFocusRowId}"]`
        )
      )

      const el = candidates.find((c) => c.offsetParent !== null)

      if (el) {
        el.focus()
        try {
          el.select()
        } catch {
          // Ignore focus selection errors.
        }
        return true
      }

      return false
    }

    if (focusVisible()) {
      setPendingFocusRowId(null)
      return
    }

    const timers: ReturnType<typeof setTimeout>[] = []

    ;[50, 150, 300, 500].forEach((delay) => {
      timers.push(
        setTimeout(() => {
          if (focusVisible()) setPendingFocusRowId(null)
        }, delay)
      )
    })

    timers.push(
      setTimeout(() => setPendingFocusRowId(null), 600)
    )

    return () => timers.forEach((t) => clearTimeout(t))
  }, [pendingFocusRowId, rows])

  useEffect(() => {
    if (pendingFocusQtyRowId == null) return

    const candidates = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `input[data-qty-row="qty-${pendingFocusQtyRowId}"]`
      )
    )

    const el = candidates.find((c) => c.offsetParent !== null)

    if (el) {
      el.focus()
      try {
        el.select()
      } catch {
        // Ignore focus selection errors.
      }
      setPendingFocusQtyRowId(null)
    }
  }, [pendingFocusQtyRowId, rows])

  useEffect(() => {
    if (!prefillItemId) return

    const itemId = Number(prefillItemId)
    if (!itemId || isNaN(itemId)) return

    async function loadAndPrefill() {
      const { data, error } = await supabase
        .from('items')
        .select(
          'item_id, sku, current_stock, cost_price, selling_price, quality, variant'
        )
        .eq('item_id', itemId)
        .single()

      if (error || !data) return

      const item = data as Item

      setRowItemOptions((prev) => ({
        ...prev,
        1: [item],
      }))

      setRows([
        {
          rowId: 1,
          item_id: item.item_id,
          sku: item.sku,
          quantity: 1,
          rate: item.selling_price,
          amount: Number(item.selling_price),
          cost_price: item.cost_price,
        },
      ])

      setNextRowId(2)
    }

    loadAndPrefill().then(() => setPendingFocusQtyRowId(1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillItemId])

  async function loadData() {
    const today = getLocalDateString()

    const [s, t] = await Promise.all([
      supabase
        .from('parties')
        .select('party_id, party_name, party_type, current_balance, phone')
        .eq('party_type', 'Customer')
        .order('party_name'),

      supabase
        .from('sales')
        .select('*')
        .eq('bill_date', today)
        .order('sale_id', { ascending: false }),
    ])

    if (s.error) {
      setMessage('Could not load customers: ' + s.error.message)
    }

    if (t.error) {
      setMessage('Could not load today’s sales: ' + t.error.message)
    }

    const parties = (s.data as Party[]) || []
    setShops(parties)
    setTodaySales((t.data as SaleHeader[]) || [])

    const counter = parties.find(
      (p) => p.party_name === COUNTER_SALE_NAME
    )

    if (counter && !prefillPartyId) {
      setPickedShop((prev) => {
        if (prev.isNew) return prev
        if (prev.id && prev.id !== counter.party_id) return prev

        return {
          id: counter.party_id,
          label: counter.party_name,
          isNew: false,
        }
      })
    }
  }

  async function loadReport() {
    if (!reportFrom || !reportTo) {
      setReportLines([])
      setReportLoading(false)
      return
    }

    if (reportFrom > reportTo) {
      setReportLines([])
      setReportLoading(false)
      return
    }

    setReportLoading(true)

    try {
      const { data, error } = await supabase
        .from('sale_items')
        .select(`
          quantity, rate, amount,
          sales!inner ( bill_date ),
          items!inner ( sku )
        `)
        .gte('sales.bill_date', reportFrom)
        .lte('sales.bill_date', reportTo)

      if (error) {
        console.error('report error:', error.message)
        setReportLines([])
      } else {
        const lines: ReportLine[] = (data || []).map((row: any) => ({
          bill_date: row.sales?.bill_date || null,
          sku: row.items?.sku || null,
          quantity: row.quantity,
          rate: row.rate,
          amount: row.amount,
        }))

        lines.sort((a, b) =>
          (a.bill_date || '') < (b.bill_date || '') ? 1 : -1
        )

        setReportLines(lines)
      }
    } catch (e) {
      console.error('report fetch failed:', e)
      setReportLines([])
    } finally {
      setReportLoading(false)
    }
  }

  const shopOptions = shops.map((s) => ({
    value: s.party_id,
    label: s.party_name,
  }))

  const prevBalance =
    shops.find((s) => s.party_id === pickedShop.id)?.current_balance || 0

  async function searchItems(rowId: number, query: string) {
    if (!query || query.trim().length < 2) {
      setRowItemOptions((prev) => ({ ...prev, [rowId]: [] }))
      return
    }

    const results = await searchItemsShared(query)
    setRowItemOptions((prev) => ({
      ...prev,
      [rowId]: results as Item[],
    }))
  }

  function addRow(): number {
    const newId = nextRowId

    setRows((prev) => [
      ...prev,
      {
        rowId: newId,
        item_id: null,
        sku: '',
        quantity: 0,
        rate: 0,
        amount: 0,
      },
    ])

    setNextRowId((n) => n + 1)
    setPendingFocusRowId(newId)

    return newId
  }

  function removeRow(rowId: number) {
    if (rows.length === 1) {
      setRows([
        {
          rowId: 1,
          item_id: null,
          sku: '',
          quantity: 0,
          rate: 0,
          amount: 0,
        },
      ])
      setRowItemOptions({})
      return
    }

    setRows(rows.filter((r) => r.rowId !== rowId))

    setRowItemOptions((prev) => {
      const next = { ...prev }
      delete next[rowId]
      return next
    })
  }

  function updateRow(rowId: number, patch: Partial<SaleRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r

        const merged = { ...r, ...patch }
        merged.amount = Number(merged.quantity) * Number(merged.rate)

        return merged
      })
    )
  }

  function handleItemSelect(rowId: number, itemId: number) {
    const item = (rowItemOptions[rowId] || []).find(
      (i) => i.item_id === itemId
    )

    if (!item) return

    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r

        const qty = r.quantity > 0 ? r.quantity : 1

        return {
          ...r,
          item_id: item.item_id,
          sku: item.sku,
          quantity: qty,
          rate: item.selling_price,
          amount: Number(qty) * Number(item.selling_price),
          cost_price: item.cost_price,
        }
      })
    )

    setPendingFocusQtyRowId(rowId)
  }

  function handleItemTab(row: SaleRow, idx: number) {
    const isLastRow = idx === rows.length - 1
    if (!isLastRow) return

    if (row.item_id) {
      addRow()
    } else {
      document.getElementById('save-sale-btn')?.focus()
    }
  }

  function handleQtyKeyDown(
    rowId: number,
    idx: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()

      const row =
        e.currentTarget.closest('tr') ??
        e.currentTarget.closest('.grid')

      if (!row) return

      const rateInput = row.querySelector<HTMLInputElement>(
        'input[data-rate-row]'
      )

      if (rateInput) {
        rateInput.focus()
        try {
          rateInput.select()
        } catch {
          // Ignore focus selection errors.
        }
      }
    }
  }

  function handleRateTab(
    rowId: number,
    idx: number,
    e: React.KeyboardEvent
  ) {
    if (e.key !== 'Tab' && e.key !== 'Enter') return

    e.preventDefault()

    const isLastRow = idx === rows.length - 1
    const row = rows[idx]

    if (isLastRow && row.item_id) {
      addRow()
    } else if (!isLastRow) {
      const nextId = rows[idx + 1]?.rowId
      const el = nextId ? itemRefs.current[nextId]?.current : null

      if (el) {
        el.focus()
        try {
          el.select()
        } catch {
          // Ignore focus selection errors.
        }
      }
    } else {
      document.getElementById('save-sale-btn')?.focus()
    }
  }

  const subtotal = rows.reduce((s, r) => s + (r.amount || 0), 0)

  const isCounterSaleSelected =
    pickedShop.label === COUNTER_SALE_NAME ||
    (pickedShop.id != null &&
      shops.find((s) => s.party_id === pickedShop.id)?.party_name ===
        COUNTER_SALE_NAME)

  const normalizedPaidAmount = Math.min(
    normalizeAmount(paidAmount),
    subtotal
  )

  const saleStatusPreview = isCounterSaleSelected
    ? 'Paid'
    : computeSaleStatus(subtotal, normalizedPaidAmount)

  async function ensureShop(): Promise<{
    id: number
    isCounterSale: boolean
  } | null> {
    if (pickedShop.id) {
      const known = shops.find((s) => s.party_id === pickedShop.id)

      if (known) {
        return {
          id: known.party_id,
          isCounterSale: known.party_name === COUNTER_SALE_NAME,
        }
      }

      const { data, error } = await supabase
        .from('parties')
        .select('party_id, party_name')
        .eq('party_id', pickedShop.id)
        .maybeSingle()

      if (error || !data) {
        setMessage(
          'Could not verify selected customer: ' +
            (error?.message || 'Customer not found')
        )
        return null
      }

      return {
        id: data.party_id,
        isCounterSale: data.party_name === COUNTER_SALE_NAME,
      }
    }

    const counter = shops.find(
      (s) => s.party_name === COUNTER_SALE_NAME
    )

    if (counter) {
      return { id: counter.party_id, isCounterSale: true }
    }

    const { data: existing, error: findError } = await supabase
      .from('parties')
      .select('party_id')
      .eq('party_name', COUNTER_SALE_NAME)
      .eq('party_type', 'Customer')
      .maybeSingle()

    if (findError) {
      setMessage('Could not find Counter Sale: ' + findError.message)
      return null
    }

    if (existing?.party_id) {
      return { id: existing.party_id, isCounterSale: true }
    }

    const { data, error } = await supabase
      .from('parties')
      .insert({
        party_name: COUNTER_SALE_NAME,
        party_type: 'Customer',
        current_balance: 0,
      })
      .select('party_id')
      .single()

    if (error || !data) {
      setMessage(
        'Could not create Counter Sale: ' +
          (error?.message || 'Unknown error')
      )
      return null
    }

    return { id: data.party_id, isCounterSale: true }
  }

  async function saveSale() {
    if (saving) return

    setMessage('')

    const validRows = rows.filter(
      (r) => r.item_id && r.quantity > 0 && r.rate > 0
    )

    if (validRows.length === 0) {
      setMessage('Add at least one item with quantity and rate.')
      return
    }

    const stockIssues = validRows
      .map((r) => {
        const item = (rowItemOptions[r.rowId] || []).find(
          (i) => i.item_id === r.item_id
        )
        return { row: r, item }
      })
      .filter(
        ({ row, item }) => item && row.quantity > item.current_stock
      )

    if (stockIssues.length > 0) {
      const msg = stockIssues
        .map(
          ({ row, item }) =>
            `• ${item!.sku}: stock ${item!.current_stock}, selling ${row.quantity}`
        )
        .join('\n')

      const proceed = window.confirm(
        `⚠ Out of stock items:\n\n${msg}\n\nStock will go negative. Continue anyway?`
      )

      if (!proceed) return
    }

    setSaving(true)

    try {
      const shopResult = await ensureShop()

      if (!shopResult) {
        setSaving(false)
        return
      }

      const shopId = shopResult.id
      const isCounterSale = shopResult.isCounterSale

      const effectivePaid = isCounterSale
        ? subtotal
        : Math.min(normalizeAmount(paidAmount), subtotal)

      const saleStatus = isCounterSale
        ? 'Paid'
        : computeSaleStatus(subtotal, effectivePaid)

      const { data: saleData, error: saleError } = await supabase
        .from('sales')
        .insert({
          party_id: shopId,
          bill_date: billDate,
          total_amount: subtotal,
          status: saleStatus,
          paid_amount: effectivePaid,
        })
        .select()
        .single()

      if (saleError || !saleData) {
        setMessage(
          'Save error: ' + (saleError?.message || 'Unknown error')
        )
        setSaving(false)
        return
      }

      const saleId = saleData.sale_id

      const lineInserts = validRows.map((r) => ({
        sale_id: saleId,
        item_id: r.item_id,
        quantity: r.quantity,
        rate: r.rate,
        amount: Number((r.rate * r.quantity).toFixed(2)),
        cost_at_sale: r.cost_price || 0,
      }))

      const { error: linesError } = await supabase
        .from('sale_items')
        .insert(lineInserts)

      if (linesError) {
        // Remove the header only if line insertion failed.
        const { error: rollbackError } = await supabase
          .from('sales')
          .delete()
          .eq('sale_id', saleId)

        setMessage(
          'Item save failed: ' +
            linesError.message +
            (rollbackError
              ? ' The invoice header could not be rolled back: ' +
                rollbackError.message
              : ' The incomplete invoice header was rolled back.')
        )

        setSaving(false)
        return
      }

      if (!isCounterSale) {
        const { error: balanceError } = await recomputePartyBalance(shopId)
          .then((result: any) => ({
            error: result?.error || null,
          }))
          .catch((error: any) => ({ error }))

        if (balanceError) {
          setMessage(
            `Sale #${saleId} was saved, but balance refresh failed: ${balanceError.message || balanceError}`
          )
        }
      }

      if (!message) {
        setMessage(`Saved sale #${saleId}. Stock decreased.`)
      }

      const counter = shops.find(
        (s) => s.party_name === COUNTER_SALE_NAME
      )

      setPickedShop(
        counter
          ? {
              id: counter.party_id,
              label: counter.party_name,
              isNew: false,
            }
          : {
              id: null,
              label: '',
              isNew: false,
            }
      )

      setRows([
        {
          rowId: 1,
          item_id: null,
          sku: '',
          quantity: 0,
          rate: 0,
          amount: 0,
        },
      ])

      setPaidAmount(0)
      setNextRowId(2)
      setRowItemOptions({})

      await loadData()
      await loadReport()

      setTimeout(() => {
        const el = itemRefs.current[1]?.current
        if (el) el.focus()
      }, 100)
    } catch (error: any) {
      setMessage('Save failed: ' + (error?.message || 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    const counter = shops.find(
      (s) => s.party_name === COUNTER_SALE_NAME
    )

    setPickedShop(
      counter
        ? {
            id: counter.party_id,
            label: counter.party_name,
            isNew: false,
          }
        : {
            id: null,
            label: '',
            isNew: false,
          }
    )

    setRows([
      {
        rowId: 1,
        item_id: null,
        sku: '',
        quantity: 0,
        rate: 0,
        amount: 0,
      },
    ])

    setPaidAmount(0)
    setNextRowId(2)
    setRowItemOptions({})
    setMessage('')
  }

async function deleteSale(id: number) {
  if (!window.confirm(`Delete sale #${id}? Any payments allocated to it will be reassigned to other pending invoices of the same customer.`)) {
    return
  }

  const sale = todaySales.find((s) => s.sale_id === id)

  if (!sale) {
    setMessage('Sale not found in the current list. Nothing was deleted.')
    return
  }

  const { error } = await supabase.rpc('delete_sale_with_reallocation', {
    p_sale_id: id,
  })

  if (error) {
    setMessage('Delete error: ' + error.message)
    return
  }

  setMessage('Deleted sale #' + id + '. Payments were reallocated where possible.')
  await loadData()
  await loadReport()
}

  // ============ EDIT MODAL HANDLERS ============

  async function openEditSale(saleId: number) {
    setEditMessage('')

const { data: sale, error: saleError } = await supabase
  .from('sales')
  .select('*')
  .eq('sale_id', saleId)
  .single()

if (saleError || !sale) {
  setMessage('Could not find invoice: ' + (saleError?.message || 'Invoice not found'))
  return
}
    const { data: lineData, error: lineErr } = await supabase
      .from('sale_items')
      .select('detail_id, item_id, quantity, rate, amount, cost_at_sale')
      .eq('sale_id', saleId)
      .order('detail_id')

    if (lineErr) {
      setMessage('Could not open sale: ' + lineErr.message)
      return
    }

    const lines = (lineData || []) as any[]
    const itemIds = Array.from(
      new Set(lines.map((l) => l.item_id).filter(Boolean))
    ) as number[]

    const itemCache: Record<number, Item> = {}

    if (itemIds.length > 0) {
      const { data: itemRows, error: itemError } = await supabase
        .from('items')
        .select(
          'item_id, sku, current_stock, cost_price, selling_price, quality, variant'
        )
        .in('item_id', itemIds)

      if (itemError) {
        setMessage('Could not load invoice items: ' + itemError.message)
        return
      }

      for (const it of itemRows || []) {
        itemCache[it.item_id] = it as Item
      }
    }

    let nid = 1

    const editRows: EditRow[] = lines.map((l) => {
      const it = itemCache[l.item_id]

      return {
        rowId: nid++,
        detail_id: l.detail_id,
        item_id: l.item_id,
        sku: it?.sku || '(unknown)',
        quantity: Number(l.quantity),
        rate: Number(l.rate),
        amount: Number(l.amount),
        cost_at_sale: Number(l.cost_at_sale || 0),
      }
    })

    if (editRows.length === 0) {
      editRows.push({
        rowId: nid++,
        detail_id: null,
        item_id: null,
        sku: '',
        quantity: 0,
        rate: 0,
        amount: 0,
        cost_at_sale: 0,
      })
    }

    setEditRowOptions({})

    setEditState({
      sale_id: sale.sale_id,
      party_id: sale.party_id,
      bill_date: sale.bill_date,
      original_total: Number(sale.total_amount),
      paid_amount: Number(sale.paid_amount || 0),
      rows: editRows,
      nextRowId: nid,
      itemCache,
    })
  }

  function closeEdit() {
    setEditState(null)
    setEditMessage('')
    setEditRowOptions({})
  }

  async function searchEditRow(rowId: number, query: string) {
    if (!query || query.trim().length < 2) {
      setEditRowOptions((prev) => ({ ...prev, [rowId]: [] }))
      return
    }

    const results = (await searchItemsShared(query)) as Item[]

    setEditRowOptions((prev) => ({
      ...prev,
      [rowId]: results,
    }))

    setEditState((prev) => {
      if (!prev) return prev

      const next = { ...prev.itemCache }

      for (const it of results) {
        next[it.item_id] = it
      }

      return { ...prev, itemCache: next }
    })
  }

  function editAddRow() {
    setEditState((prev) => {
      if (!prev) return prev

      const newId = prev.nextRowId

      return {
        ...prev,
        rows: [
          ...prev.rows,
          {
            rowId: newId,
            detail_id: null,
            item_id: null,
            sku: '',
            quantity: 0,
            rate: 0,
            amount: 0,
            cost_at_sale: 0,
          },
        ],
        nextRowId: newId + 1,
      }
    })
  }

  function editRemoveRow(rowId: number) {
    setEditState((prev) => {
      if (!prev) return prev

      const filtered = prev.rows.filter((r) => r.rowId !== rowId)

      if (filtered.length === 0) {
        return {
          ...prev,
          rows: [
            {
              rowId: prev.nextRowId,
              detail_id: null,
              item_id: null,
              sku: '',
              quantity: 0,
              rate: 0,
              amount: 0,
              cost_at_sale: 0,
            },
          ],
          nextRowId: prev.nextRowId + 1,
        }
      }

      return { ...prev, rows: filtered }
    })

    setEditRowOptions((prev) => {
      const next = { ...prev }
      delete next[rowId]
      return next
    })
  }

  function editUpdateRow(rowId: number, patch: Partial<EditRow>) {
    setEditState((prev) => {
      if (!prev) return prev

      return {
        ...prev,
        rows: prev.rows.map((r) => {
          if (r.rowId !== rowId) return r

          const merged = { ...r, ...patch }
          merged.amount = Number(merged.quantity) * Number(merged.rate)

          return merged
        }),
      }
    })
  }

  function editSelectItem(rowId: number, itemId: number) {
    setEditState((prev) => {
      if (!prev) return prev

      const it = prev.itemCache[itemId]
      if (!it) return prev

      return {
        ...prev,
        rows: prev.rows.map((r) => {
          if (r.rowId !== rowId) return r

          const qty = r.quantity > 0 ? r.quantity : 1

          return {
            ...r,
            item_id: it.item_id,
            sku: it.sku,
            quantity: qty,
            rate: it.selling_price,
            amount: Number(qty) * Number(it.selling_price),
            cost_at_sale: it.cost_price,
          }
        }),
      }
    })
  }

  function editOptionsFor(rowId: number) {
    if (!editState) return []

    const seen = new Set<number>()
    const out: { value: number; label: string }[] = []
    const row = editState.rows.find((r) => r.rowId === rowId)

    if (row?.item_id) {
      const cached = editState.itemCache[row.item_id]

      if (cached) {
        seen.add(cached.item_id)
        out.push({
          value: cached.item_id,
          label: itemLabel(cached),
        })
      }
    }

    for (const it of editRowOptions[rowId] || []) {
      if (seen.has(it.item_id)) continue

      seen.add(it.item_id)
      out.push({
        value: it.item_id,
        label: itemLabel(it),
      })
    }

    return out
  }


async function saveEdit() {
  if (!editState || editSaving) return

  setEditMessage('')

  const validRows = editState.rows.filter(
    (r) => r.item_id && r.quantity > 0 && r.rate > 0
  )

  if (validRows.length === 0) {
    setEditMessage('Add at least one item with quantity and rate.')
    return
  }

  const newTotal = validRows.reduce(
    (s, r) => s + r.quantity * r.rate,
    0
  )

  const newPartyId = editState.party_id

  const isCounterSaleEdit =
    shops.find((s) => s.party_id === newPartyId)?.party_name ===
    COUNTER_SALE_NAME

  const effectivePaid = isCounterSaleEdit
    ? newTotal
    : Math.min(normalizeAmount(editState.paid_amount), newTotal)

  setEditSaving(true)

  try {
    const { error } = await supabase.rpc(
      'edit_sale_with_reallocation',
      {
        p_sale_id: editState.sale_id,
        p_party_id: newPartyId,
        p_bill_date: editState.bill_date,
        p_total_amount: Number(newTotal.toFixed(2)),
        p_paid_amount: Number(effectivePaid.toFixed(2)),
        p_lines: validRows.map((r) => ({
          item_id: r.item_id,
          quantity: r.quantity,
          rate: r.rate,
          cost_at_sale: r.cost_at_sale || 0,
        })),
      }
    )

    if (error) {
      setEditMessage('Save failed: ' + error.message)
      return
    }

    await loadData()
    await loadReport()

    closeEdit()
    setMessage(`Updated sale #${editState.sale_id}. Payments were reallocated where possible.`)
  } catch (error: any) {
    setEditMessage(
      'Save failed: ' + (error?.message || 'Unknown error')
    )
  } finally {
    setEditSaving(false)
  }
}

  const shopName = (id: number) =>
    shops.find((s) => s.party_id === id)?.party_name || '—'

  function itemLabel(it: Item): string {
    const parts = [
      it.sku,
      `stock ${it.current_stock}`,
      `sp ₹${Number(it.selling_price).toFixed(0)}`,
      `cp ₹${Number(it.cost_price).toFixed(0)}`,
      it.quality && it.quality !== 'Normal' ? it.quality : null,
      it.variant || null,
    ].filter(Boolean)

    return parts.join(' · ')
  }

  function itemOptionsFor(rowId: number) {
    return (rowItemOptions[rowId] || []).map((it) => ({
      value: it.item_id,
      label: itemLabel(it),
    }))
  }

  function formatTime(entry?: string) {
    if (!entry) return ''

    const d = new Date(entry)
    if (isNaN(d.getTime())) return ''

    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const todayGrouped = (() => {
    const byCustomer: Record<number, SaleHeader[]> = {}

    for (const s of todaySales) {
      if (!byCustomer[s.party_id]) byCustomer[s.party_id] = []
      byCustomer[s.party_id].push(s)
    }

    return Object.keys(byCustomer)
      .map((pid) => {
        const sales = byCustomer[Number(pid)]
        const total = sales.reduce(
          (sum, s) => sum + Number(s.total_amount),
          0
        )

        return {
          party_id: Number(pid),
          party_name: shopName(Number(pid)),
          sales,
          total,
        }
      })
      .sort((a, b) => b.total - a.total)
  })()

  const todayTotal = todaySales.reduce(
    (s, x) => s + Number(x.total_amount),
    0
  )

  function toggleCustomer(partyId: number) {
    setExpandedCustomers((prev) => ({
      ...prev,
      [partyId]: !prev[partyId],
    }))
  }

  function handleNewPartyCreated(party: {
    party_id: number
    party_name: string
    party_type: 'Customer' | 'Supplier'
    current_balance: number
    phone: string | null
    purchase_prefix: string | null
  }) {
    setShops((prev) =>
      [...prev, party as Party].sort((a, b) =>
        a.party_name.localeCompare(b.party_name)
      )
    )

    setPickedShop({
      id: party.party_id,
      label: party.party_name,
      isNew: false,
    })

    setPendingNewParty(null)

    ;[50, 150, 300, 500, 800].forEach((delay) => {
      setTimeout(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            'input[data-row-item="row-1"]'
          )
        )

        const el = candidates.find((c) => c.offsetParent !== null)

        if (el && document.activeElement !== el) {
          el.focus()
          try {
            el.select()
          } catch {
            // Ignore focus selection errors.
          }
        }
      }, delay)
    })
  }

  // ============ RENDER ============

  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-5 lg:p-7">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-800">
                Sales Entry
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                One bill at a time. Save the bill and continue with the next shop.
              </p>
            </div>

            <div className="text-xs text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2">
              {todayStr}
            </div>
          </div>
        </div>

        {/* ============ MOBILE VIEW ============ */}

        <div className="md:hidden space-y-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Shop / Customer
              </label>

              <SmartCombobox
                options={shopOptions}
                value={
                  pickedShop.id
                    ? String(pickedShop.id)
                    : pickedShop.isNew
                      ? `__new__${pickedShop.label}`
                      : null
                }
                onValueChange={(v: string, label: string, isNew: boolean) => {
                  if (isNew) {
                    setPendingNewParty(label)
                    return
                  }

                  setPickedShop({
                    id: Number(v),
                    label,
                    isNew: false,
                  })
                }}
                placeholder="Select or type shop..."
                inputDataAttr="shop-input"
                focusNextOnSelect={true}
                nextFieldSelector="input[data-row-item='row-1']"
              />

              {pickedShop.label === COUNTER_SALE_NAME && (
                <div className="mt-1.5 text-[11px] text-slate-500">
                  Counter Sale — automatically treated as paid.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Previous Balance
                </label>
                <div className="h-11 px-3 flex items-center text-sm font-semibold bg-rose-50 border border-rose-200 rounded-lg text-rose-700 tabular-nums">
                  ₹ {money(prevBalance)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Bill Subtotal
                </label>
                <div className="h-11 px-3 flex items-center text-sm font-bold bg-blue-50 border border-blue-200 rounded-lg text-blue-700 tabular-nums">
                  ₹ {money(subtotal)}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Bill Date
              </label>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="w-full h-11 px-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>

            {!isCounterSaleSelected && (
              <div>
                <label className="block text-xs font-semibold text-emerald-800 mb-1">
                  Amount Received Today
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={paidAmount || ''}
                  onChange={(e) =>
                    setPaidAmount(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="w-full h-11 px-3 text-base border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-emerald-50"
                  placeholder="Enter amount received"
                />
                <div className="mt-1.5 flex justify-between text-xs">
                  <span className="text-slate-500">
                    Received against this invoice
                  </span>
                  <span
                    className={`font-semibold ${
                      saleStatusPreview === 'Paid'
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {saleStatusPreview}
                  </span>
                </div>
                {normalizedPaidAmount > 0 && (
                  <div className="mt-1 text-xs text-slate-500">
                    Remaining on this invoice: ₹
                    {money(subtotal - normalizedPaidAmount)}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            {rows.map((row, idx) => (
              <div
                key={row.rowId}
                className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2.5">
                  <div className="text-xs font-semibold text-slate-500">
                    ITEM #{idx + 1}
                  </div>

                  <button
                    onClick={() => removeRow(row.rowId)}
                    className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                    aria-label="Remove item"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <SmartCombobox
                  options={itemOptionsFor(row.rowId)}
                  value={row.item_id ? String(row.item_id) : null}
                  fallbackLabel={row.item_id && row.sku ? row.sku : null}
                  onValueChange={(
                    v: string,
                    label: string,
                    isNew: boolean
                  ) => {
                    if (isNew) return
                    handleItemSelect(row.rowId, Number(v))
                  }}
                  onTabKey={() => handleItemTab(row, idx)}
                  onSearch={(q) => searchItems(row.rowId, q)}
                  placeholder="Type 2+ letters to search SKU…"
                  allowCreate={false}
                  inputDataAttr={`row-${row.rowId}`}
                  focusNextOnSelect={false}
                  inputRef={getItemRef(row.rowId)}
                  showReferenceLink={true}
                />

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">
                      Quantity
                    </label>
                    <input
                      data-qty-row={`qty-${row.rowId}`}
                      ref={(el) => {
                        qtyRefs.current[row.rowId] = el
                      }}
                      type="number"
                      inputMode="numeric"
                      value={row.quantity || ''}
                      onChange={(e) =>
                        updateRow(row.rowId, {
                          quantity: parseFloat(e.target.value) || 0,
                        })
                      }
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) =>
                        handleQtyKeyDown(row.rowId, idx, e)
                      }
                      className="w-full h-11 px-3 text-base text-right tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-600 mb-1">
                      Rate
                    </label>
                    <input
                      data-rate-row={`rate-${row.rowId}`}
                      type="number"
                      inputMode="decimal"
                      value={row.rate || ''}
                      onChange={(e) =>
                        updateRow(row.rowId, {
                          rate: parseFloat(e.target.value) || 0,
                        })
                      }
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => handleRateTab(row.rowId, idx, e)}
                      className="w-full h-11 px-3 text-base text-right tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <span className="text-xs text-slate-500">Line Amount</span>
                  <span className="text-base font-bold text-slate-900 tabular-nums">
                    ₹ {money(row.amount)}
                  </span>
                </div>
              </div>
            ))}

            <button
              onClick={addRow}
              className="w-full h-12 text-sm font-semibold text-blue-700 border-2 border-dashed border-blue-200 rounded-xl hover:bg-blue-50 flex items-center justify-center gap-2"
            >
              <Plus className="size-4" />
              Add Item
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Items Subtotal</span>
              <span className="font-semibold text-slate-800 tabular-nums">
                ₹ {money(subtotal)}
              </span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Previous Balance</span>
              <span className="font-medium text-rose-600 tabular-nums">
                ₹ {money(prevBalance)}
              </span>
            </div>

            <div className="flex justify-between text-base border-t border-slate-200 pt-3">
              <span className="font-semibold text-slate-800">
                Total Due Including Previous Balance
              </span>
              <span className="font-bold text-slate-900 tabular-nums">
                ₹ {money(Number(prevBalance) + subtotal)}
              </span>
            </div>

            {!isCounterSaleSelected && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-700">Received Now</span>
                  <span className="font-semibold text-emerald-700 tabular-nums">
                    ₹ {money(normalizedPaidAmount)}
                  </span>
                </div>

                <div className="flex justify-between text-sm">
                  <span className="text-amber-700">Remaining on This Bill</span>
                  <span className="font-semibold text-amber-700 tabular-nums">
                    ₹ {money(subtotal - normalizedPaidAmount)}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="flex gap-3">
            <button
              id="save-sale-btn"
              onClick={saveSale}
              disabled={saving}
              className="flex-1 h-12 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              <Save className="size-4" />
              {saving ? 'Saving...' : 'Save Sale'}
            </button>

            <button
              onClick={resetForm}
              disabled={saving}
              className="h-12 px-4 text-sm text-slate-700 border border-slate-300 rounded-xl hover:bg-slate-50 flex items-center justify-center"
            >
              <X className="size-4" />
            </button>
          </div>

          {message && (
            <div className="text-sm text-slate-700 bg-white border border-slate-200 rounded-lg p-3">
              {message}
            </div>
          )}

          {/* Mobile Sales Report */}

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 space-y-2">
              <div className="text-sm font-semibold text-slate-700">
                Sales Report ({reportLines.length})
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-600 mb-0.5">
                    From
                  </label>
                  <input
                    type="date"
                    value={reportFrom}
                    onChange={(e) => setReportFrom(e.target.value)}
                    className="w-full h-9 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-slate-600 mb-0.5">
                    To
                  </label>
                  <input
                    type="date"
                    value={reportTo}
                    onChange={(e) => setReportTo(e.target.value)}
                    className="w-full h-9 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              {reportLoading ? (
                <div className="px-2 py-6 text-center text-xs text-slate-400">
                  Loading...
                </div>
              ) : (
                <DateGroupedList
                  rows={reportLines}
                  getDate={(l) => l.bill_date || ''}
                  getAmount={(l) => Number(l.amount || 0)}
                  getKey={(l, i) => `${l.bill_date}-${l.sku}-${i}`}
                  emptyState={
                    <div className="px-2 py-6 text-center text-xs text-slate-400">
                      No sales in this range.
                    </div>
                  }
                  renderRow={(l) => (
                    <div className="grid grid-cols-12 gap-1 px-2 py-2 border-b border-slate-100 text-xs">
                      <div className="col-span-6 font-mono text-slate-800 break-all">
                        {l.sku || '—'}
                      </div>
                      <div className="col-span-2 text-right text-slate-800 tabular-nums">
                        {l.quantity}
                      </div>
                      <div className="col-span-2 text-right text-slate-800 tabular-nums">
                        {Number(l.rate).toFixed(0)}
                      </div>
                      <div className="col-span-2 text-right font-semibold text-slate-800 tabular-nums">
                        {Number(l.amount).toFixed(0)}
                      </div>
                    </div>
                  )}
                />
              )}

              {reportLines.length > 0 && !reportLoading && (
                <div className="bg-slate-50 border-t-2 border-slate-200 px-2 py-2 flex justify-between text-xs">
                  <span className="font-semibold text-slate-700">Total</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    ₹{' '}
                    {reportLines
                      .reduce((s, l) => s + Number(l.amount || 0), 0)
                      .toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <TodaySalesGrouped
            grouped={todayGrouped}
            todayTotal={todayTotal}
            expanded={expandedCustomers}
            onToggle={toggleCustomer}
            onEdit={openEditSale}
            onDelete={deleteSale}
            formatTime={formatTime}
          />
        </div>

        {/* ============ DESKTOP VIEW ============ */}

        <div className="hidden md:block">
          <div className="flex items-end justify-between mb-5">
            <h2 className="text-xl font-semibold text-slate-700">
              Bill Details
            </h2>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Bill Date
              </label>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="h-9 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6 mb-6 shadow-sm">
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Shop / Customer
                </label>

                <SmartCombobox
                  options={shopOptions}
                  value={
                    pickedShop.id
                      ? String(pickedShop.id)
                      : pickedShop.isNew
                        ? `__new__${pickedShop.label}`
                        : null
                  }
                  onValueChange={(v: string, label: string, isNew: boolean) => {
                    if (isNew) {
                      setPendingNewParty(label)
                      return
                    }

                    setPickedShop({
                      id: Number(v),
                      label,
                      isNew: false,
                    })
                  }}
                  placeholder="Select or type shop..."
                  inputDataAttr="shop-input"
                  focusNextOnSelect={true}
                  nextFieldSelector="input[data-row-item='row-1']"
                />

                {pickedShop.label === COUNTER_SALE_NAME && (
                  <div className="mt-1 text-[11px] text-slate-500">
                    Counter Sale — automatically treated as paid.
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Previous Balance
                </label>
                <div className="w-full h-9 px-3 flex items-center text-sm font-semibold bg-rose-50 border border-rose-200 rounded-lg text-rose-700 tabular-nums">
                  ₹ {money(prevBalance)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Bill Subtotal
                </label>
                <div className="w-full h-9 px-3 flex items-center text-sm font-bold bg-blue-50 border border-blue-200 rounded-lg text-blue-700 tabular-nums">
                  ₹ {money(subtotal)}
                </div>
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="w-10 border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold text-slate-600">
                        #
                      </th>
                      <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold text-slate-600">
                        Item (SKU)
                      </th>
                      <th className="w-20 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">
                        Qty
                      </th>
                      <th className="w-24 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">
                        Rate
                      </th>
                      <th className="w-28 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">
                        Amount
                      </th>
                      <th className="w-12 border-b border-slate-200 px-2 py-2" />
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((row, idx) => (
                      <tr
                        key={row.rowId}
                        className="border-b border-slate-100 hover:bg-slate-50/70"
                      >
                        <td className="px-2 py-1.5 text-center text-slate-500 text-xs">
                          {idx + 1}
                        </td>

                        <td className="px-2 py-1.5">
                          <SmartCombobox
                            options={itemOptionsFor(row.rowId)}
                            value={row.item_id ? String(row.item_id) : null}
                            fallbackLabel={
                              row.item_id && row.sku ? row.sku : null
                            }
                            onValueChange={(
                              v: string,
                              label: string,
                              isNew: boolean
                            ) => {
                              if (isNew) return
                              handleItemSelect(row.rowId, Number(v))
                            }}
                            onTabKey={() => handleItemTab(row, idx)}
                            onSearch={(q) => searchItems(row.rowId, q)}
                            placeholder="Type 2+ letters to search SKU…"
                            allowCreate={false}
                            inputDataAttr={`row-${row.rowId}`}
                            focusNextOnSelect={false}
                            inputRef={getItemRef(row.rowId)}
                            showReferenceLink={true}
                          />
                        </td>

                        <td className="px-2 py-1.5">
                          <input
                            data-qty-row={`qty-${row.rowId}`}
                            ref={(el) => {
                              qtyRefs.current[row.rowId] = el
                            }}
                            type="number"
                            inputMode="numeric"
                            value={row.quantity || ''}
                            onChange={(e) =>
                              updateRow(row.rowId, {
                                quantity: parseFloat(e.target.value) || 0,
                              })
                            }
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) =>
                              handleQtyKeyDown(row.rowId, idx, e)
                            }
                            className="w-full h-9 px-2 text-sm text-right tabular-nums border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </td>

                        <td className="px-2 py-1.5">
                          <input
                            data-rate-row={`rate-${row.rowId}`}
                            type="number"
                            inputMode="decimal"
                            value={row.rate || ''}
                            onChange={(e) =>
                              updateRow(row.rowId, {
                                rate: parseFloat(e.target.value) || 0,
                              })
                            }
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) =>
                              handleRateTab(row.rowId, idx, e)
                            }
                            className="w-full h-9 px-2 text-sm text-right tabular-nums border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </td>

                        <td className="px-2 py-1.5 text-right font-semibold text-slate-800 tabular-nums">
                          ₹ {money(row.amount)}
                        </td>

                        <td className="px-2 py-1.5 text-center">
                          <button
                            onClick={() => removeRow(row.rowId)}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded"
                            aria-label="Remove item"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={addRow}
                className="w-full px-3 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50 flex items-center justify-center gap-2 border-t border-slate-200"
              >
                <Plus className="size-4" />
                Add Row
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              <div>
                {!isCounterSaleSelected ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                    <label className="block text-sm font-semibold text-emerald-900 mb-1.5">
                      Amount Received Today
                    </label>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={paidAmount || ''}
                      onChange={(e) =>
                        setPaidAmount(
                          Math.max(0, Number(e.target.value) || 0)
                        )
                      }
                      className="w-full h-10 px-3 text-sm border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                      placeholder="0.00"
                    />

                    <div className="mt-2 flex justify-between text-xs">
                      <span className="text-emerald-800">
                        Remaining on this invoice
                      </span>
                      <span className="font-bold text-emerald-900 tabular-nums">
                        ₹ {money(subtotal - normalizedPaidAmount)}
                      </span>
                    </div>

                    <div className="mt-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${saleStatusStyle(
                          saleStatusPreview
                        )}`}
                      >
                        {saleStatusPreview}
                      </span>
                    </div>

                    <p className="mt-2 text-[11px] text-emerald-800">
                      Enter only the amount received against this invoice now.
                      The remaining amount stays due.
                    </p>
                  </div>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                    <div className="text-sm font-semibold text-emerald-800">
                      Counter Sale
                    </div>
                    <div className="text-xs text-emerald-700 mt-1">
                      This sale is automatically recorded as fully paid.
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Items Subtotal</span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    ₹ {money(subtotal)}
                  </span>
                </div>

                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Previous Balance</span>
                  <span className="font-medium text-rose-600 tabular-nums">
                    ₹ {money(prevBalance)}
                  </span>
                </div>

                <div className="flex justify-between text-base border-t border-slate-200 pt-3">
                  <span className="font-semibold text-slate-800">
                    Total Due
                  </span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    ₹ {money(Number(prevBalance) + subtotal)}
                  </span>
                </div>

                {!isCounterSaleSelected && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-700">Received Now</span>
                    <span className="font-semibold text-emerald-700 tabular-nums">
                      ₹ {money(normalizedPaidAmount)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t border-slate-200">
              <button
                id="save-sale-btn"
                onClick={saveSale}
                disabled={saving}
                className="h-10 px-6 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 shadow-sm"
              >
                <Save className="size-4" />
                {saving ? 'Saving...' : 'Save Sale'}
              </button>

              <button
                onClick={resetForm}
                disabled={saving}
                className="h-10 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2"
              >
                <X className="size-4" />
                Clear
              </button>

              {message && (
                <div className="text-sm text-slate-700 ml-1">
                  {message}
                </div>
              )}
            </div>
          </div>

          {/* Desktop Sales Report */}

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-6">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span className="text-sm font-semibold text-slate-700">
                Sales Report ({reportLines.length})
              </span>

              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600">From</label>
                <input
                  type="date"
                  value={reportFrom}
                  onChange={(e) => setReportFrom(e.target.value)}
                  className="h-8 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />

                <label className="text-xs text-slate-600">To</label>
                <input
                  type="date"
                  value={reportTo}
                  onChange={(e) => setReportTo(e.target.value)}
                  className="h-8 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              {reportLoading ? (
                <div className="px-3 py-6 text-center text-sm text-slate-400">
                  Loading...
                </div>
              ) : (
                <DateGroupedList
                  rows={reportLines}
                  getDate={(l) => l.bill_date || ''}
                  getAmount={(l) => Number(l.amount || 0)}
                  getKey={(l, i) => `${l.bill_date}-${l.sku}-${i}`}
                  emptyState={
                    <div className="px-3 py-6 text-center text-sm text-slate-400">
                      No sales in this date range.
                    </div>
                  }
                  renderRow={(l) => (
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-slate-100 text-sm hover:bg-slate-50">
                      <div className="col-span-6 font-mono text-slate-800">
                        {l.sku || '—'}
                      </div>
                      <div className="col-span-2 text-right text-slate-800 tabular-nums">
                        {l.quantity}
                      </div>
                      <div className="col-span-2 text-right text-slate-800 tabular-nums">
                        ₹ {Number(l.rate).toFixed(2)}
                      </div>
                      <div className="col-span-2 text-right font-semibold text-slate-800 tabular-nums">
                        ₹ {Number(l.amount).toFixed(2)}
                      </div>
                    </div>
                  )}
                />
              )}

              {reportLines.length > 0 && !reportLoading && (
                <div className="bg-slate-50 border-t-2 border-slate-200 px-3 py-2 flex justify-between text-sm">
                  <span className="font-semibold text-slate-700">Total</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    ₹{' '}
                    {reportLines
                      .reduce((s, l) => s + Number(l.amount || 0), 0)
                      .toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <TodaySalesGrouped
            grouped={todayGrouped}
            todayTotal={todayTotal}
            expanded={expandedCustomers}
            onToggle={toggleCustomer}
            onEdit={openEditSale}
            onDelete={deleteSale}
            formatTime={formatTime}
          />
        </div>
      </div>

      {/* ============ EDIT MODAL ============ */}

      {editState && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="px-4 sm:px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-base font-bold text-slate-900">
                  Edit Sale #{editState.sale_id}
                </div>

                <div className="text-xs text-slate-500 mt-0.5">
                  Original total ₹{money(editState.original_total)}
                  {editState.paid_amount > 0 && (
                    <>
                      {' '}
                      · Paid ₹{money(editState.paid_amount)}
                    </>
                  )}
                </div>
              </div>

              <button
                onClick={closeEdit}
                disabled={editSaving}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Shop
                  </label>

                  <SmartCombobox
                    options={shopOptions}
                    value={String(editState.party_id)}
                    onValueChange={(
                      v: string,
                      _l: string,
                      isNew: boolean
                    ) => {
                      if (isNew) return

                      setEditState((prev) =>
                        prev
                          ? {
                              ...prev,
                              party_id: Number(v),
                            }
                          : prev
                      )
                    }}
                    placeholder="Select shop..."
                    allowCreate={false}
                    focusNextOnSelect={false}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bill Date
                  </label>

                  <input
  type="date"
  value={editState.bill_date}
  disabled
  title="Bill date cannot be changed while editing an invoice."
  className="w-full h-10 px-2 text-sm border border-slate-200 rounded-lg bg-slate-100 text-slate-500 cursor-not-allowed"
/>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                  Items ({editState.rows.length})
                </div>

                <div className="space-y-2">
                  {editState.rows.map((row, idx) => (
                    <div
                      key={row.rowId}
                      className="border border-slate-200 rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-slate-500">
                          Item #{idx + 1}
                        </div>

                        <button
                          onClick={() => editRemoveRow(row.rowId)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <SmartCombobox
                        options={editOptionsFor(row.rowId)}
                        value={row.item_id ? String(row.item_id) : null}
                        fallbackLabel={
                          row.item_id && row.sku ? row.sku : null
                        }
                        onValueChange={(
                          v: string,
                          _l: string,
                          isNew: boolean
                        ) => {
                          if (isNew) return
                          editSelectItem(row.rowId, Number(v))
                        }}
                        onSearch={(q) => searchEditRow(row.rowId, q)}
                        placeholder="Search SKU..."
                        allowCreate={false}
                        focusNextOnSelect={false}
                      />

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">
                            Qty
                          </label>

                          <input
                            type="number"
                            inputMode="numeric"
                            value={row.quantity || ''}
                            onChange={(e) =>
                              editUpdateRow(row.rowId, {
                                quantity: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-full h-9 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">
                            Rate
                          </label>

                          <input
                            type="number"
                            inputMode="decimal"
                            value={row.rate || ''}
                            onChange={(e) =>
                              editUpdateRow(row.rowId, {
                                rate: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-full h-9 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">
                            Amount
                          </label>

                          <div className="h-9 px-2 flex items-center justify-end text-sm font-bold text-slate-800 tabular-nums">
                            ₹ {money(row.amount)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={editAddRow}
                    className="w-full h-10 text-xs font-semibold text-blue-700 border-2 border-dashed border-blue-200 rounded-lg hover:bg-blue-50 flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Item
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">New Total</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    ₹{' '}
                    {money(
                      editState.rows.reduce(
                        (s, r) => s + (r.amount || 0),
                        0
                      )
                    )}
                  </span>
                </div>

                {editState.paid_amount > 0 && (
                  <div className="text-[11px] text-amber-800">
                    Already paid ₹{money(editState.paid_amount)}. The total
                    cannot be reduced below this amount.
                  </div>
                )}
              </div>

              {editMessage && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {editMessage}
                </div>
              )}
            </div>

            <div className="px-4 sm:px-5 py-3 border-t border-slate-200 flex items-center gap-2 bg-slate-50 rounded-b-2xl">
              <button
                onClick={closeEdit}
                disabled={editSaving}
                className="flex-1 h-10 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="flex-1 h-10 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

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

// ============ TODAY'S SALES GROUPED COMPONENT ============

type TodayGroupedRow = {
  party_id: number
  party_name: string
  sales: SaleHeader[]
  total: number
}

function TodaySalesGrouped({
  grouped,
  todayTotal,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  formatTime,
}: {
  grouped: TodayGroupedRow[]
  todayTotal: number
  expanded: Record<number, boolean>
  onToggle: (partyId: number) => void
  onEdit: (saleId: number) => void
  onDelete: (saleId: number) => void
  formatTime: (entry?: string) => string
}) {
  if (grouped.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-700">
            Today's Sales
          </span>
        </div>

        <div className="px-4 py-8 text-center text-sm text-slate-400">
          No sales entered today yet.
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-700">
            Today's Sales
          </span>
          <span className="text-xs text-slate-500">
            ({grouped.length} customer{grouped.length === 1 ? '' : 's'})
          </span>
        </div>

        <span className="text-sm font-bold text-slate-900 tabular-nums">
          ₹ {money(todayTotal)}
        </span>
      </div>

      <div className="divide-y divide-slate-100">
        {grouped.map((g) => {
          const isOpen = !!expanded[g.party_id]

          return (
            <div key={g.party_id}>
              <button
                onClick={() => onToggle(g.party_id)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 text-left"
              >
                <div className="shrink-0 text-slate-400">
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {g.party_name}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {g.sales.length} bill{g.sales.length === 1 ? '' : 's'}
                  </div>
                </div>

                <div className="text-sm font-bold text-slate-900 shrink-0 tabular-nums">
                  ₹ {money(g.total)}
                </div>
              </button>

              {isOpen && (
                <div className="bg-slate-50 divide-y divide-slate-100 border-t border-slate-100">
                  {g.sales.map((s) => {
                    const paid = Number(s.paid_amount || 0)
                    const total = Number(s.total_amount || 0)
                    const remaining = Math.max(0, total - paid)

                    return (
                      <div
                        key={s.sale_id}
                        className="px-3 sm:px-4 py-2.5 flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 text-xs"
                      >
                        <div className="text-slate-400 w-14 shrink-0">
                          #{s.sale_id}
                        </div>

                        <div className="text-slate-500 w-16 shrink-0">
                          {formatTime(s.entry_date)}
                        </div>

                        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-block px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wide ${saleStatusStyle(
                              s.status
                            )}`}
                          >
                            {s.status || 'Due'}
                          </span>

                          {paid > 0 && (
                            <span className="text-[10px] text-emerald-700">
                              Received ₹{money(paid)}
                            </span>
                          )}

                          {remaining > 0 && (
                            <span className="text-[10px] text-rose-700">
                              Due ₹{money(remaining)}
                            </span>
                          )}
                        </div>

                        <div className="font-semibold text-slate-800 shrink-0 tabular-nums">
                          ₹ {money(total)}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => onEdit(s.sale_id)}
                            className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-blue-700 hover:bg-blue-100 rounded-lg"
                            aria-label="Edit sale"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => onDelete(s.sale_id)}
                            className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-rose-700 hover:bg-rose-100 rounded-lg"
                            aria-label="Delete sale"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
  )
}
