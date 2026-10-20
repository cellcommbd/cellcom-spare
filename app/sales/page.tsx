'use client'

import { useEffect, useRef, useState, createRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { NewPartyDialog } from '../../components/ui/new-party-dialog'
import { DateGroupedList } from '../../components/ui/date-grouped-list'
import { Plus, Trash2, Save, X } from 'lucide-react'
import { getRole } from '../../lib/auth'
import { searchItems as searchItemsShared } from '../../lib/item-search'

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

const COUNTER_SALE_NAME = 'Counter Sale'

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

  const todayStr = new Date().toISOString().slice(0, 10)
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
  const [nextRowId, setNextRowId] = useState(2)

  const [pendingFocusRowId, setPendingFocusRowId] = useState<number | null>(
    null
  )
  const [pendingFocusQtyRowId, setPendingFocusQtyRowId] = useState<
    number | null
  >(null)

  const [pendingNewParty, setPendingNewParty] = useState<string | null>(null)

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

  // Prefill shop from ?party_id= and focus the first item field
  useEffect(() => {
    if (!prefillPartyId) return
    const id = Number(prefillPartyId)
    if (!id || isNaN(id)) return
    if (shops.length === 0) return
    const shop = shops.find((s) => s.party_id === id)
    if (!shop) return

    setPickedShop({ id: shop.party_id, label: shop.party_name, isNew: false })

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
            // ignore
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
          // ignore
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
          if (focusVisible()) {
            setPendingFocusRowId(null)
          }
        }, delay)
      )
    })
    timers.push(
      setTimeout(() => {
        setPendingFocusRowId(null)
      }, 600)
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
        // ignore
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

    loadAndPrefill().then(() => {
      setPendingFocusQtyRowId(1)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillItemId])

  async function loadData() {
    const today = new Date().toISOString().slice(0, 10)
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
    const parties = (s.data as Party[]) || []
    setShops(parties)
    setTodaySales(t.data || [])

    const counter = parties.find((p) => p.party_name === COUNTER_SALE_NAME)
    if (counter && !prefillPartyId) {
      setPickedShop((prev) => {
        if (prev.isNew) return prev
        if (prev.id && prev.id !== counter.party_id) return prev
        return { id: counter.party_id, label: counter.party_name, isNew: false }
      })
    }
  }

  async function loadReport() {
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
    const items = results as Item[]
    setRowItemOptions((prev) => ({ ...prev, [rowId]: items }))
  }

  function addRow(): number {
    const newId = nextRowId
    setRows((prev) => [
      ...prev,
      { rowId: newId, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
    ])
    setNextRowId((n) => n + 1)
    setPendingFocusRowId(newId)
    return newId
  }

  function removeRow(rowId: number) {
    if (rows.length === 1) {
      setRows([
        { rowId: 1, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
      ])
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
    const rowOptions = rowItemOptions[rowId] || []
    const item = rowOptions.find((i) => i.item_id === itemId)
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
      const saveBtn = document.getElementById('save-sale-btn')
      saveBtn?.focus()
    }
  }

  function handleQtyKeyDown(
    rowId: number,
    idx: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const row = e.currentTarget.closest('tr') ?? e.currentTarget.closest('.grid')
      if (!row) return
      const rateInput = row.querySelector<HTMLInputElement>(
        'input[data-rate-row]'
      )
      if (rateInput) {
        rateInput.focus()
        try {
          rateInput.select()
        } catch {
          // ignore
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
      const nextRowId = rows[idx + 1]?.rowId
      if (nextRowId) {
        const el = itemRefs.current[nextRowId]?.current
        if (el) {
          el.focus()
          try {
            el.select()
          } catch {
            // ignore
          }
        }
      }
    } else {
      const saveBtn = document.getElementById('save-sale-btn')
      saveBtn?.focus()
    }
  }

  const subtotal = rows.reduce((s, r) => s + (r.amount || 0), 0)

  async function ensureShop(): Promise<number | null> {
    if (pickedShop.id) return pickedShop.id

    const counter = shops.find((s) => s.party_name === COUNTER_SALE_NAME)
    if (counter) return counter.party_id

    const { data: existing } = await supabase
      .from('parties')
      .select('party_id')
      .eq('party_name', COUNTER_SALE_NAME)
      .eq('party_type', 'Customer')
      .maybeSingle()

    if (existing?.party_id) return existing.party_id

    const { data, error } = await supabase
      .from('parties')
      .insert({
        party_name: COUNTER_SALE_NAME,
        party_type: 'Customer',
        current_balance: 0,
      })
      .select()
      .single()

    if (error) {
      setMessage('Could not resolve shop: ' + error.message)
      return null
    }
    return data.party_id
  }

  async function saveSale() {
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
        const opts = rowItemOptions[r.rowId] || []
        const item = opts.find((i) => i.item_id === r.item_id)
        return { row: r, item }
      })
      .filter(({ row, item }) => item && row.quantity > item.current_stock)

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

    const shopId = await ensureShop()
    if (!shopId) {
      setSaving(false)
      return
    }

    const { data: saleData, error: saleError } = await supabase
      .from('sales')
      .insert({
        party_id: shopId,
        bill_date: billDate,
        total_amount: subtotal,
        status: 'Pending',
      })
      .select()
      .single()

    if (saleError || !saleData) {
      setMessage('Save error: ' + (saleError?.message || 'unknown'))
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
      await supabase.from('sales').delete().eq('sale_id', saleId)
      setMessage('Save error: ' + linesError.message)
      setSaving(false)
      return
    }

    await supabase
      .from('parties')
      .update({ current_balance: prevBalance + subtotal })
      .eq('party_id', shopId)

    setMessage(`Saved sale #${saleId}. Stock decreased.`)

    const counter = shops.find((s) => s.party_name === COUNTER_SALE_NAME)
    setPickedShop(
      counter
        ? { id: counter.party_id, label: counter.party_name, isNew: false }
        : { id: null, label: '', isNew: false }
    )
    setRows([
      { rowId: 1, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
    ])
    setNextRowId(2)
    setRowItemOptions({})
    await loadData()
    await loadReport()

    setTimeout(() => {
      const el = itemRefs.current[1]?.current
      if (el) el.focus()
    }, 100)

    setSaving(false)
  }

  function resetForm() {
    const counter = shops.find((s) => s.party_name === COUNTER_SALE_NAME)
    setPickedShop(
      counter
        ? { id: counter.party_id, label: counter.party_name, isNew: false }
        : { id: null, label: '', isNew: false }
    )
    setRows([
      { rowId: 1, item_id: null, sku: '', quantity: 0, rate: 0, amount: 0 },
    ])
    setNextRowId(2)
    setRowItemOptions({})
    setMessage('')
  }

  async function deleteSale(id: number) {
    if (!confirm(`Delete sale #${id}? Stock will go back up.`)) return

    const sale = todaySales.find((s) => s.sale_id === id)
    if (sale) {
      const shop = shops.find((s) => s.party_id === sale.party_id)
      if (shop) {
        await supabase
          .from('parties')
          .update({ current_balance: shop.current_balance - sale.total_amount })
          .eq('party_id', shop.party_id)
      }
    }

    await supabase.from('sale_items').delete().eq('sale_id', id)
    const { error } = await supabase.from('sales').delete().eq('sale_id', id)

    if (error) setMessage('Delete error: ' + error.message)
    else {
      setMessage('Deleted sale #' + id)
      await loadData()
      await loadReport()
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

    const attempts = [50, 150, 300, 500, 800]
    attempts.forEach((delay) => {
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
            // ignore
          }
        }
      }, delay)
    })
  }
    return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">
            Sales Entry
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            One bill at a time. Save → form clears → next shop.
          </p>
        </div>

        {/* ============ MOBILE VIEW ============ */}
        <div className="md:hidden space-y-4 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Shop
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
                nextFieldSelector={`input[data-row-item="row-1"]`}
              />
              {pickedShop.label === COUNTER_SALE_NAME && (
                <div className="mt-1 text-[11px] text-slate-500">
                  Defaulting to Counter Sale. Pick a shop to change.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prev Balance
                </label>
                <div className="w-full h-11 px-3 flex items-center text-sm font-medium bg-red-50 border border-red-200 rounded-lg text-red-700">
                  ₹ {Number(prevBalance).toFixed(2)}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Subtotal
                </label>
                <div className="w-full h-11 px-3 flex items-center text-sm font-bold bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
                  ₹ {subtotal.toFixed(2)}
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
          </div>

          <div className="space-y-3">
            {rows.map((row, idx) => (
              <div
                key={row.rowId}
                className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-slate-500">
                    Item #{idx + 1}
                  </div>
                  <button
                    onClick={() => removeRow(row.rowId)}
                    className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
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
                      Qty
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
                      className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">
                      Rate
                    </label>
                    <input
                      data-rate-row={`rate-${row.rowId}`}
                      type="number"
                      inputMode="numeric"
                      value={row.rate || ''}
                      onChange={(e) =>
                        updateRow(row.rowId, {
                          rate: parseFloat(e.target.value) || 0,
                        })
                      }
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => handleRateTab(row.rowId, idx, e)}
                      className="w-full h-11 px-3 text-base text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <span className="text-xs text-slate-500">Amount</span>
                  <span className="text-base font-bold text-slate-800">
                    ₹ {row.amount.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}

            <button
              onClick={addRow}
              className="w-full h-12 text-sm font-medium text-blue-600 border-2 border-dashed border-blue-200 rounded-xl hover:bg-blue-50 flex items-center justify-center gap-1"
            >
              <Plus className="size-4" />
              Add Item
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Items Subtotal</span>
              <span className="font-medium text-slate-800">
                ₹ {subtotal.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Previous Balance</span>
              <span className="font-medium text-red-600">
                ₹ {Number(prevBalance).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-base border-t border-slate-200 pt-2">
              <span className="font-semibold text-slate-800">Total Due</span>
              <span className="font-bold text-slate-900">
                ₹ {(prevBalance + subtotal).toFixed(2)}
              </span>
            </div>
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
                  <label className="block text-[10px] text-slate-600 mb-0.5">From</label>
                  <input
                    type="date"
                    value={reportFrom}
                    onChange={(e) => setReportFrom(e.target.value)}
                    className="w-full h-9 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-600 mb-0.5">To</label>
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
                    <div className="grid grid-cols-12 gap-1 px-2 py-1.5 border-b border-slate-100 text-xs">
                      <div className="col-span-6 font-mono text-slate-800 break-all">
                        {l.sku || '—'}
                      </div>
                      <div className="col-span-2 text-right text-slate-800">
                        {l.quantity}
                      </div>
                      <div className="col-span-2 text-right text-slate-800">
                        {Number(l.rate).toFixed(0)}
                      </div>
                      <div className="col-span-2 text-right font-medium text-slate-800">
                        {Number(l.amount).toFixed(0)}
                      </div>
                    </div>
                  )}
                />
              )}
              {reportLines.length > 0 && !reportLoading && (
                <div className="bg-slate-50 border-t-2 border-slate-200 px-2 py-2 flex justify-between text-xs">
                  <span className="font-semibold text-slate-700">Total</span>
                  <span className="font-bold text-slate-900">
                    ₹{' '}
                    {reportLines
                      .reduce((s, l) => s + Number(l.amount || 0), 0)
                      .toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ============ DESKTOP VIEW ============ */}
        <div className="hidden md:block">
          <div className="flex items-end justify-between mb-6">
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

          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Shop
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
                  nextFieldSelector={`input[data-row-item="row-1"]`}
                />
                {pickedShop.label === COUNTER_SALE_NAME && (
                  <div className="mt-1 text-[11px] text-slate-500">
                    Defaulting to Counter Sale. Pick a shop to change.
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Previous Balance
                </label>
                <div className="w-full h-9 px-3 flex items-center text-sm font-medium bg-red-50 border border-red-200 rounded-lg text-red-700">
                  ₹ {Number(prevBalance).toFixed(2)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Bill Subtotal
                </label>
                <div className="w-full h-9 px-3 flex items-center text-sm font-bold bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
                  ₹ {subtotal.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="w-10 border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold text-slate-600">#</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold text-slate-600">Item (SKU)</th>
                    <th className="w-20 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">Qty</th>
                    <th className="w-24 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">Rate</th>
                    <th className="w-28 border-b border-slate-200 px-2 py-2 text-right text-xs font-semibold text-slate-600">Amount</th>
                    <th className="w-12 border-b border-slate-200 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.rowId} className="border-b border-slate-100">
                      <td className="px-2 py-1 text-center text-slate-500 text-xs">
                        {idx + 1}
                      </td>
                      <td className="px-2 py-1">
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
                      </td>
                      <td className="px-2 py-1">
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
                          className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          data-rate-row={`rate-${row.rowId}`}
                          type="number"
                          inputMode="numeric"
                          value={row.rate || ''}
                          onChange={(e) =>
                            updateRow(row.rowId, {
                              rate: parseFloat(e.target.value) || 0,
                            })
                          }
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => handleRateTab(row.rowId, idx, e)}
                          className="w-full h-8 px-2 text-sm text-right border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-2 py-1 text-right font-medium text-slate-800">
                        ₹ {row.amount.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          onClick={() => removeRow(row.rowId)}
                          className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button
                onClick={addRow}
                className="w-full px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-1 border-t border-slate-200"
              >
                <Plus className="size-4" />
                Add Row
              </button>
            </div>

            <div className="mt-6">
              <div className="ml-auto max-w-md space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Items Subtotal:</span>
                  <span className="font-medium text-slate-800">
                    ₹ {subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Previous Balance:</span>
                  <span className="font-medium text-red-600">
                    ₹ {Number(prevBalance).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-base border-t border-slate-300 pt-2">
                  <span className="font-semibold text-slate-800">Total Due:</span>
                  <span className="font-bold text-slate-900">
                    ₹ {(prevBalance + subtotal).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-200">
              <button
                id="save-sale-btn"
                onClick={saveSale}
                disabled={saving}
                className="h-10 px-6 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="size-4" />
                {saving ? 'Saving...' : 'Save Sale'}
              </button>
              <button
                onClick={resetForm}
                className="h-10 px-4 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-2"
              >
                <X className="size-4" />
                Clear
              </button>
              {message && (
                <div className="text-sm text-slate-700 ml-2">{message}</div>
              )}
            </div>
          </div>

          {/* Desktop Sales Report */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
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
                      <div className="col-span-2 text-right text-slate-800">
                        {l.quantity}
                      </div>
                      <div className="col-span-2 text-right text-slate-800">
                        ₹ {Number(l.rate).toFixed(2)}
                      </div>
                      <div className="col-span-2 text-right font-medium text-slate-800">
                        ₹ {Number(l.amount).toFixed(2)}
                      </div>
                    </div>
                  )}
                />
              )}
              {reportLines.length > 0 && !reportLoading && (
                <div className="bg-slate-50 border-t-2 border-slate-200 px-3 py-2 flex justify-between text-sm">
                  <span className="font-semibold text-slate-700">Total</span>
                  <span className="font-bold text-slate-900">
                    ₹{' '}
                    {reportLines
                      .reduce((s, l) => s + Number(l.amount || 0), 0)
                      .toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

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