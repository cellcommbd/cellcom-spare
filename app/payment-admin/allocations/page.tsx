
'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { isOwner } from '@/lib/auth'
import { SmartCombobox } from '@/components/ui/smart-combobox'

type Party = {
  party_id: number
  party_name: string
  phone: string | null
  current_balance: number
}

type Payment = {
  payment_id: number
  party_id: number | null
  payment_date: string
  amount: number
  payment_mode: string | null
  collection_id: number | null
}

type Sale = {
  sale_id: number
  bill_date: string
  total_amount: number
  paid_amount: number
}

type Allocation = {
  id: number
  payment_id: number
  sale_id: number
  amount: number
}

type Audit = {
  audit_id: number
  action: string
  payment_id: number
  from_sale_id: number | null
  to_sale_id: number
  amount: number
  created_at: string
}

type SaleItem = {
  detail_id: number
  sale_id: number
  item_id: number
  quantity: number
  rate: number
  amount: number
  returned_qty: number | null
}

type ItemMaster = {
  item_id: number
  sku: string | null
}

export default function AllocationManagerPage() {
  const [authorized, setAuthorized] = useState(false)
  const [checkedOwner, setCheckedOwner] = useState(false)

  const [partyOptions, setPartyOptions] = useState<Party[]>([])
  const [partySearchValue, setPartySearchValue] = useState<string | null>(null)
  const [partySearchLoading, setPartySearchLoading] = useState(false)
  const [party, setParty] = useState<Party | null>(null)

  const [payments, setPayments] = useState<Payment[]>([])
  const [reversedPaymentIds, setReversedPaymentIds] = useState<number[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [history, setHistory] = useState<Audit[]>([])

  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [action, setAction] = useState<'allocate' | 'move'>('allocate')
  const [sourceAllocationId, setSourceAllocationId] = useState<string | null>(null)
  const [destinationSaleId, setDestinationSaleId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [itemSkus, setItemSkus] = useState<ItemMaster[]>([])
  const [expandedPaymentId, setExpandedPaymentId] = useState<number | null>(null)
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<number | null>(null)

  useEffect(() => {
    setAuthorized(isOwner())
    setCheckedOwner(true)
  }, [])

  const selectedPayment = payments.find(
    p => String(p.payment_id) === paymentId
  ) || null

  const selectedSource = allocations.find(
    a => String(a.id) === sourceAllocationId
  ) || null

  const selectedDestination = sales.find(
    s => String(s.sale_id) === destinationSaleId
  ) || null

  const paymentAllocations = allocations.filter(
    a => String(a.payment_id) === paymentId
  )

  const allocatedAmount = paymentAllocations.reduce(
    (sum, a) => sum + Number(a.amount), 0
  )

  const unallocatedAmount = selectedPayment
    ? Number(selectedPayment.amount) - allocatedAmount
    : 0

  const destinationOutstanding = selectedDestination
    ? Number(selectedDestination.total_amount) - Number(selectedDestination.paid_amount)
    : 0

  const sourceOptions = paymentAllocations
    .filter(a => Number(a.amount) > 0)
    .map(a => {
      const invoice = sales.find(s => s.sale_id === a.sale_id)

      return {
        value: a.id,
        label: `Allocation #${a.id} · Invoice #${a.sale_id} · ${invoice?.bill_date || ''} · ₹${Number(a.amount).toFixed(2)}`
      }
    })

  async function searchParties(query: string) {
    if (query.trim().length < 2) {
      setPartyOptions([])
      return
    }

    setPartySearchLoading(true)

    const { data, error } = await supabase
      .from('parties')
      .select('party_id, party_name, phone, current_balance')
      .ilike('party_name', `%${query.trim()}%`)
      .order('party_name')
      .limit(30)

    setPartySearchLoading(false)

    if (error) {
      setError(error.message)
      setPartyOptions([])
      return
    }

    setPartyOptions((data || []) as Party[])
  }

  async function loadParty(p: Party) {
    setLoading(true)
    setError('')
    setMessage('')

    setParty(p)
    setPaymentId(null)
    setSourceAllocationId(null)
    setDestinationSaleId(null)
    setAmount('')
    setAllocations([])
    setHistory([])
    setSaleItems([])
    setItemSkus([])
    setExpandedPaymentId(null)
    setExpandedInvoiceId(null)

    const [paymentResult, saleResult] = await Promise.all([
      supabase
        .from('payments')
        .select('payment_id, party_id, payment_date, amount, payment_mode, collection_id')
        .eq('party_id', p.party_id)
        .order('payment_date', { ascending: false }),

      supabase
        .from('sales')
        .select('sale_id, bill_date, total_amount, paid_amount')
        .eq('party_id', p.party_id)
        .order('bill_date', { ascending: false })
    ])

    if (paymentResult.error || saleResult.error) {
      setError(
        paymentResult.error?.message ||
        saleResult.error?.message ||
        'Could not load customer records.'
      )
      setLoading(false)
      return
    }

    const paymentRows = (paymentResult.data || []) as Payment[]
    const saleRows = (saleResult.data || []) as Sale[]

    setPayments(paymentRows)
    setSales(saleRows)

    const saleIds = saleRows.map(s => s.sale_id)

    if (saleIds.length > 0) {
      const { data: itemRows, error: itemError } = await supabase
        .from('sale_items')
        .select('detail_id, sale_id, item_id, quantity, rate, amount, returned_qty')
        .in('sale_id', saleIds)

      if (itemError) {
        setError(itemError.message)
        setLoading(false)
        return
      }

      const loadedItems = (itemRows || []) as SaleItem[]
      setSaleItems(loadedItems)

      const itemIds = [...new Set(loadedItems.map(i => i.item_id))]

      if (itemIds.length > 0) {
        const { data: masterRows, error: masterError } = await supabase
          .from('items')
          .select('item_id, sku')
          .in('item_id', itemIds)

        if (masterError) {
          setError(masterError.message)
          setLoading(false)
          return
        }

        setItemSkus((masterRows || []) as ItemMaster[])
      } else {
        setItemSkus([])
      }
    } else {
      setSaleItems([])
      setItemSkus([])
    }

    const ids = paymentRows.map(p => p.payment_id)

    if (ids.length > 0) {
      const [allocationResult, reversedResult, auditResult] = await Promise.all([
        supabase
          .from('payment_allocations')
          .select('id, payment_id, sale_id, amount')
          .in('payment_id', ids),

        supabase
          .from('payment_reversal_items')
          .select('payment_id')
          .in('payment_id', ids),

        supabase
          .from('payment_allocation_audit')
          .select('audit_id, action, payment_id, from_sale_id, to_sale_id, amount, created_at')
          .in('payment_id', ids)
          .order('created_at', { ascending: false })
      ])

      if (allocationResult.error || reversedResult.error || auditResult.error) {
        setError(
          allocationResult.error?.message ||
          reversedResult.error?.message ||
          auditResult.error?.message ||
          'Could not load allocation details.'
        )
        setLoading(false)
        return
      }

      setAllocations((allocationResult.data || []) as Allocation[])
      setReversedPaymentIds(
        (reversedResult.data || []).map(r => Number(r.payment_id))
      )
      setHistory((auditResult.data || []) as Audit[])
    } else {
      setAllocations([])
      setReversedPaymentIds([])
      setHistory([])
    }

    setLoading(false)
  }

  function clearSelection() {
    setPaymentId(null)
    setSourceAllocationId(null)
    setDestinationSaleId(null)
    setAmount('')
    setMessage('')
    setError('')
  }

  async function saveAllocation() {
    setError('')
    setMessage('')

    if (!selectedPayment) {
      setError('Select a payment first.')
      return
    }

    if (!destinationSaleId) {
      setError('Select a destination invoice.')
      return
    }

    const numericAmount = Number(amount)

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid amount.')
      return
    }

    if (action === 'allocate' && numericAmount > unallocatedAmount) {
      setError(`Only ₹${unallocatedAmount.toFixed(2)} is unallocated in this payment.`)
      return
    }

    if (action === 'move') {
      if (!selectedSource) {
        setError('Select the source allocation.')
        return
      }

      if (numericAmount > Number(selectedSource.amount)) {
        setError('Amount exceeds the source allocation.')
        return
      }
    }

    if (numericAmount > destinationOutstanding) {
      setError(`Destination invoice outstanding is only ₹${destinationOutstanding.toFixed(2)}.`)
      return
    }

    const confirmed = window.confirm(
      `${action === 'allocate' ? 'Allocate' : 'Move'} ₹${numericAmount.toFixed(2)} ${
        action === 'allocate'
          ? `to invoice #${destinationSaleId}?`
          : `from invoice #${selectedSource?.sale_id} to invoice #${destinationSaleId}?`
      }`
    )

    if (!confirmed) return

    setSaving(true)

    const { data, error } = await supabase.rpc('manage_payment_allocation', {
      p_action: action,
      p_payment_id: selectedPayment.payment_id,
      p_source_allocation_id: action === 'move' ? Number(sourceAllocationId) : null,
      p_destination_sale_id: Number(destinationSaleId),
      p_amount: numericAmount
    })

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    setMessage(
      `Successfully ${action === 'allocate' ? 'allocated' : 'moved'} ₹${numericAmount.toFixed(2)}. Audit record #${data?.audit_id || 'created'}.`
    )

    if (party) {
      await loadParty(party)
    }

    setPaymentId(String(selectedPayment.payment_id))
  }

  if (!checkedOwner) {
    return (
      <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        Checking access...
      </main>
    )
  }

  if (!authorized) {
    return (
      <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        <p className="text-red-600">Access denied. Owner only.</p>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-5 md:p-6">
      <header>
        <h1 className="text-2xl font-bold">Payment Allocation Manager</h1>
        <p className="mt-1 text-sm text-gray-500">
          Allocate unused payments or move existing allocations between invoices.
        </p>
      </header>

      <section className="min-w-0 rounded-lg border p-3 sm:p-4">
        <h2 className="mb-3 text-lg font-semibold">1. Find Customer</h2>

        <SmartCombobox
          options={partyOptions.map(p => ({
            value: p.party_id,
            label: `${p.party_name} · Balance ₹${Number(p.current_balance).toFixed(2)}${p.phone ? ` · ${p.phone}` : ''}`
          }))}
          value={partySearchValue}
          placeholder="Search customer name..."
          allowCreate={false}
          onSearch={searchParties}
          searchDebounceMs={300}
          onValueChange={(value) => {
            setPartySearchValue(value || null)

            const found = partyOptions.find(
              p => String(p.party_id) === value
            )

            if (found) {
              clearSelection()
              loadParty(found)
            } else if (!value) {
              setParty(null)
              setPayments([])
              setSales([])
              setAllocations([])
              setHistory([])
              setReversedPaymentIds([])
              setSaleItems([])
              setItemSkus([])
              setExpandedPaymentId(null)
              setExpandedInvoiceId(null)
              clearSelection()
            }
          }}
        />

        {partySearchLoading && (
          <p className="mt-2 text-sm text-gray-500">Searching customers...</p>
        )}

        {loading && (
          <p className="mt-2 text-sm text-gray-500">Loading customer records...</p>
        )}
      </section>

      {party && (
        <>
          <section className="min-w-0 rounded-lg border p-3 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="break-words text-xl font-semibold">{party.party_name}</h2>
                <p className="text-sm text-gray-500">Customer ID: {party.party_id}</p>
              </div>
              <div className="sm:text-right">
                <p className="text-sm text-gray-500">Current balance</p>
                <p className="text-xl font-bold">
                  ₹{Number(party.current_balance).toFixed(2)}
                </p>
              </div>
            </div>
          </section>

          <section className="min-w-0 rounded-lg border p-3 sm:p-4">
            <h2 className="mb-3 text-lg font-semibold">2. Select Payment</h2>

            <div className="space-y-3">
              {payments
                .filter(p => !reversedPaymentIds.includes(p.payment_id))
                .map(p => {
                  const rows = allocations.filter(a => a.payment_id === p.payment_id)
                  const allocated = rows.reduce((sum, a) => sum + Number(a.amount), 0)
                  const remaining = Number(p.amount) - allocated
                  const isSelected = String(p.payment_id) === paymentId
                  const isExpanded = expandedPaymentId === p.payment_id

                  return (
                    <div
                      key={p.payment_id}
                      className={`min-w-0 rounded-lg border p-3 ${
                        isSelected ? 'border-blue-500 bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentId(String(p.payment_id))
                            setSourceAllocationId(null)
                            setDestinationSaleId(null)
                            setAmount('')
                            setError('')
                            setMessage('')
                          }}
                          className="min-h-12 min-w-0 flex-1 text-left"
                        >
                          <strong>Payment #{p.payment_id}</strong>
                          <p className="break-words text-sm text-gray-600">
                            {p.payment_date} · {p.payment_mode || 'Payment'}
                            {p.collection_id ? ` · Collection #${p.collection_id}` : ''}
                          </p>
                          <p className="mt-1 font-semibold">
                            ₹{Number(p.amount).toFixed(2)}
                          </p>
                          <p className="text-xs text-gray-500">
                            Allocated ₹{allocated.toFixed(2)} · Unallocated ₹{remaining.toFixed(2)}
                          </p>
                          {isSelected && (
                            <span className="text-xs font-semibold text-blue-700">Selected</span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setExpandedPaymentId(isExpanded ? null : p.payment_id)}
                          className="min-h-10 w-full rounded-md border px-3 py-2 text-sm sm:w-auto"
                        >
                          {isExpanded ? 'Hide details ▲' : 'View details ▼'}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="mt-3 border-t pt-3">
                          <p className="mb-2 text-sm font-semibold">
                            Invoices paid by this payment
                          </p>

                          {rows.length === 0 ? (
                            <p className="text-sm text-gray-500">No invoice allocations yet.</p>
                          ) : (
                            <div className="space-y-2">
                              {rows.map(a => {
                                const invoice = sales.find(s => s.sale_id === a.sale_id)

                                return (
                                  <div key={a.id} className="rounded-md bg-white p-3 text-sm">
                                    <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                                      <span>Invoice #{a.sale_id} · {invoice?.bill_date || ''}</span>
                                      <strong>₹{Number(a.amount).toFixed(2)}</strong>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                      {saleItems.filter(i => i.sale_id === a.sale_id).length} invoice item(s)
                                    </p>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>

            {reversedPaymentIds.length > 0 && (
              <p className="mt-2 text-xs text-gray-500">
                {reversedPaymentIds.length} reversed payment(s) excluded.
              </p>
            )}

            {selectedPayment && (
              <div className="mt-4 grid grid-cols-1 gap-3 rounded-md bg-gray-50 p-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-gray-500">Payment amount</p>
                  <p className="font-semibold">₹{Number(selectedPayment.amount).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Already allocated</p>
                  <p className="font-semibold">₹{allocatedAmount.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Unallocated amount</p>
                  <p className="font-semibold">₹{unallocatedAmount.toFixed(2)}</p>
                </div>
              </div>
            )}
          </section>

          {selectedPayment && (
            <>
              <section className="min-w-0 rounded-lg border p-3 sm:p-4">
                <h2 className="mb-3 text-lg font-semibold">3. Choose Operation</h2>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAction('allocate')
                      setSourceAllocationId(null)
                      setDestinationSaleId(null)
                      setAmount('')
                      setError('')
                    }}
                    className={`min-h-11 rounded-md border px-4 py-2 ${
                      action === 'allocate'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    Allocate unused amount
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAction('move')
                      setSourceAllocationId(null)
                      setDestinationSaleId(null)
                      setAmount('')
                      setError('')
                    }}
                    className={`min-h-11 rounded-md border px-4 py-2 ${
                      action === 'move'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    Move existing allocation
                  </button>
                </div>

                {action === 'allocate' && (
                  <p className="mt-3 text-sm text-gray-500">
                    Available to allocate: ₹{unallocatedAmount.toFixed(2)}
                  </p>
                )}

                {action === 'move' && (
                  <div className="mt-4">
                    <label className="mb-2 block text-sm font-medium">
                      Source allocation
                    </label>

                    <div className="space-y-2">
                      {sourceOptions.map(option => {
                        const id = Number(option.value)
                        const allocation = allocations.find(a => a.id === id)
                        const isSourceSelected = sourceAllocationId === String(id)

                        return (
                          <button
                            type="button"
                            key={id}
                            onClick={() => {
                              setSourceAllocationId(String(id))
                              setAmount('')
                              setDestinationSaleId(null)
                              setError('')
                            }}
                            className={`min-h-14 w-full rounded-lg border p-3 text-left ${
                              isSourceSelected
                                ? 'border-blue-500 bg-blue-50'
                                : 'hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                              <strong>Allocation #{id}</strong>
                              <strong>₹{Number(allocation?.amount || 0).toFixed(2)}</strong>
                            </div>
                            <p className="break-words text-sm text-gray-600">{option.label}</p>
                            {isSourceSelected && (
                              <p className="mt-1 text-xs font-semibold text-blue-700">
                                Selected source
                              </p>
                            )}
                          </button>
                        )
                      })}
                    </div>

                    {selectedSource && (
                      <p className="mt-2 text-sm text-gray-500">
                        Source invoice #{selectedSource.sale_id} · Available to move ₹
                        {Number(selectedSource.amount).toFixed(2)}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-4">
                  <label className="mb-2 block text-sm font-medium">
                    Destination invoice
                  </label>

                  <div className="space-y-3">
                    {sales
                      .filter(s => Number(s.total_amount) > Number(s.paid_amount))
                      .filter(s =>
                        action !== 'allocate' ||
                        !allocations.some(a => Number(a.sale_id) === Number(s.sale_id))
                      )
                      .filter(s => action !== 'move' || s.sale_id !== selectedSource?.sale_id)
                      .map(s => {
                        const outstanding = Number(s.total_amount) - Number(s.paid_amount)
                        const isDestinationSelected = destinationSaleId === String(s.sale_id)
                        const expanded = expandedInvoiceId === s.sale_id
                        const rows = saleItems.filter(i => i.sale_id === s.sale_id)

                        return (
                          <div
                            key={s.sale_id}
                            className={`min-w-0 rounded-lg border p-3 ${
                              isDestinationSelected ? 'border-blue-500 bg-blue-50' : ''
                            }`}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <button
                                type="button"
                                onClick={() => {
                                  setDestinationSaleId(String(s.sale_id))
                                  setError('')
                                }}
                                className="min-h-12 min-w-0 flex-1 text-left"
                              >
                                <strong>Invoice #{s.sale_id}</strong>
                                <p className="text-sm text-gray-600">Date: {s.bill_date}</p>

                                <div className="mt-2 grid grid-cols-3 gap-2 text-xs sm:text-sm">
                                  <div className="min-w-0">
                                    <span className="text-gray-500">Total</span>
                                    <p className="break-words font-semibold">
                                      ₹{Number(s.total_amount).toFixed(2)}
                                    </p>
                                  </div>
                                  <div className="min-w-0">
                                    <span className="text-gray-500">Paid</span>
                                    <p className="break-words font-semibold">
                                      ₹{Number(s.paid_amount).toFixed(2)}
                                    </p>
                                  </div>
                                  <div className="min-w-0">
                                    <span className="text-gray-500">Due</span>
                                    <p className="break-words font-semibold text-red-600">
                                      ₹{outstanding.toFixed(2)}
                                    </p>
                                  </div>
                                </div>

                                {isDestinationSelected && (
                                  <p className="mt-2 text-xs font-semibold text-blue-700">
                                    Selected destination
                                  </p>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => setExpandedInvoiceId(expanded ? null : s.sale_id)}
                                className="min-h-10 w-full rounded-md border px-3 py-2 text-sm sm:w-auto"
                              >
                                {expanded ? 'Hide items ▲' : `View ${rows.length} items ▼`}
                              </button>
                            </div>

                            {expanded && (
                              <div className="mt-3 border-t pt-3">
                                {rows.length === 0 ? (
                                  <p className="text-sm text-gray-500">
                                    No item records found for this invoice.
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {rows.map(item => (
                                      <div
                                        key={item.detail_id}
                                        className="rounded-md bg-white p-3 text-sm"
                                      >
                                        <div className="break-words font-medium">
                                          {itemSkus.find(m => m.item_id === item.item_id)?.sku ||
                                            `Item #${item.item_id}`}
                                        </div>

                                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                          <div>
                                            <span className="text-xs text-gray-500">Qty</span>
                                            <p>{item.quantity}</p>
                                          </div>
                                          <div>
                                            <span className="text-xs text-gray-500">Rate</span>
                                            <p>₹{Number(item.rate).toFixed(2)}</p>
                                          </div>
                                          <div>
                                            <span className="text-xs text-gray-500">Amount</span>
                                            <p className="font-semibold">
                                              ₹{Number(item.amount).toFixed(2)}
                                            </p>
                                          </div>
                                          <div>
                                            <span className="text-xs text-gray-500">Returned</span>
                                            <p>{Number(item.returned_qty || 0)}</p>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}

                    {sales.filter(s =>
                      Number(s.total_amount) > Number(s.paid_amount) &&
                      (
                        action !== 'allocate' ||
                        !allocations.some(a => Number(a.sale_id) === Number(s.sale_id))
                      ) &&
                      (action !== 'move' || s.sale_id !== selectedSource?.sale_id)
                    ).length === 0 && (
                      <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-500">
                        No eligible destination invoices found for this operation.
                      </p>
                    )}
                  </div>

                  {selectedDestination && (
                    <p className="mt-2 text-sm text-gray-500">
                      Outstanding balance: ₹{destinationOutstanding.toFixed(2)}
                    </p>
                  )}
                </div>

                <div className="mt-4">
                  <label className="mb-2 block text-sm font-medium">
                    Amount (₹)
                  </label>

                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="Enter amount"
                    className="min-h-11 w-full rounded-md border px-3 py-2 text-base sm:max-w-xs"
                  />
                </div>

                <button
                  type="button"
                  onClick={saveAllocation}
                  disabled={
                    saving ||
                    !destinationSaleId ||
                    !amount ||
                    (action === 'allocate' && unallocatedAmount <= 0) ||
                    (action === 'move' && !sourceAllocationId)
                  }
                  className="mt-5 min-h-11 w-full rounded-md bg-blue-600 px-5 py-2 font-medium text-white disabled:opacity-50 sm:w-auto"
                >
                  {saving
                    ? 'Saving...'
                    : action === 'allocate'
                      ? 'Allocate Payment'
                      : 'Move Allocation'}
                </button>
              </section>

              <section className="min-w-0 rounded-lg border p-3 sm:p-4">
                <h2 className="mb-3 text-lg font-semibold">Current Allocations</h2>

                {paymentAllocations.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No allocations for this payment.
                  </p>
                ) : (
                  <div className="divide-y">
                    {paymentAllocations.map(a => (
                      <div
                        key={a.id}
                        className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:justify-between"
                      >
                        <span>Allocation #{a.id} · Invoice #{a.sale_id}</span>
                        <strong>₹{Number(a.amount).toFixed(2)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          <section className="min-w-0 rounded-lg border p-3 sm:p-4">
            <h2 className="mb-3 text-lg font-semibold">Allocation Audit History</h2>

            {history.length === 0 ? (
              <p className="text-sm text-gray-500">
                No allocation changes recorded yet.
              </p>
            ) : (
              <div className="divide-y">
                {history.map(item => (
                  <div key={item.audit_id} className="py-3 text-sm">
                    <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                      <strong>
                        {item.action === 'allocate' ? 'New allocation' : 'Allocation moved'}
                      </strong>
                      <strong>₹{Number(item.amount).toFixed(2)}</strong>
                    </div>

                    <p className="mt-1 break-words text-gray-600">
                      Payment #{item.payment_id}
                      {item.from_sale_id
                        ? ` · Invoice #${item.from_sale_id} → #${item.to_sale_id}`
                        : ` · Invoice #${item.to_sale_id}`}
                    </p>

                    <p className="text-xs text-gray-400">
                      {new Date(item.created_at).toLocaleString('en-IN')} · Audit #{item.audit_id}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {error && (
        <div className="break-words rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {message && (
        <div className="break-words rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-700">
          {message}
        </div>
      )}
    </main>
  )
}
