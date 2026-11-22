
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

type Allocation = {
  id: number
  payment_id: number
  sale_id: number
  amount: number
}

type Sale = {
  sale_id: number
  bill_date: string
  total_amount: number
  paid_amount: number
}

type PaymentOption = {
  key: string
  label: string
  paymentId: number | null
  collectionId: number | null
  amount: number
  paymentIds: number[]
}

export default function PaymentAdminPage() {
  const [allowed, setAllowed] = useState(false)
  const [checking, setChecking] = useState(true)

  const [partyOptions, setPartyOptions] = useState<Party[]>([])
  const [partySearchValue, setPartySearchValue] = useState<string | null>(null)
  const [partySearchLoading, setPartySearchLoading] = useState(false)
  const [party, setParty] = useState<Party | null>(null)

  const [payments, setPayments] = useState<Payment[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [options, setOptions] = useState<PaymentOption[]>([])

  const [selected, setSelected] = useState<PaymentOption | null>(null)
  const [reason, setReason] = useState('')
  const [history, setHistory] = useState<any[]>([])

  const [loading, setLoading] = useState(false)
  const [reversing, setReversing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setAllowed(isOwner())
    setChecking(false)
  }, [])

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
    setParty(p)

    setSelected(null)
    setReason('')
    setError('')
    setMessage('')
    setPayments([])
    setAllocations([])
    setSales([])
    setOptions([])
    setHistory([])
    setLoading(true)

    const { data: paymentData, error: paymentError } = await supabase
      .from('payments')
      .select('payment_id, party_id, payment_date, amount, payment_mode, collection_id')
      .eq('party_id', p.party_id)
      .order('payment_date', { ascending: false })
      .order('payment_id', { ascending: false })

    if (paymentError) {
      setError(paymentError.message)
      setLoading(false)
      return
    }

    const paymentRows = (paymentData || []) as Payment[]
    setPayments(paymentRows)

    const ids = paymentRows.map(x => x.payment_id)

    let allocationRows: Allocation[] = []

    if (ids.length) {
      const { data, error: allocationError } = await supabase
        .from('payment_allocations')
        .select('id, payment_id, sale_id, amount')
        .in('payment_id', ids)

      if (allocationError) {
        setError(allocationError.message)
        setLoading(false)
        return
      }

      allocationRows = (data || []) as Allocation[]
      setAllocations(allocationRows)
    }

    const saleIds = [...new Set(allocationRows.map(x => x.sale_id))]
    let saleRows: Sale[] = []

    if (saleIds.length) {
      const { data, error: saleError } = await supabase
        .from('sales')
        .select('sale_id, bill_date, total_amount, paid_amount')
        .in('sale_id', saleIds)

      if (saleError) {
        setError(saleError.message)
        setLoading(false)
        return
      }

      saleRows = (data || []) as Sale[]
      setSales(saleRows)
    }

    // Group payments belonging to the same collection.
    const grouped = new Map<string, Payment[]>()

    for (const payment of paymentRows) {
      const key = payment.collection_id !== null
        ? `collection-${payment.collection_id}`
        : `payment-${payment.payment_id}`

      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(payment)
    }

    const paymentOptions: PaymentOption[] = []

    for (const [key, rows] of grouped) {
      const isCollection = rows[0].collection_id !== null
      const total = rows.reduce((sum, x) => sum + Number(x.amount), 0)
      const idsForOption = rows.map(x => x.payment_id)

      paymentOptions.push({
        key,
        label: isCollection
          ? `Collection #${rows[0].collection_id}`
          : `Payment #${rows[0].payment_id}`,
        paymentId: isCollection ? null : rows[0].payment_id,
        collectionId: isCollection ? rows[0].collection_id : null,
        amount: total,
        paymentIds: idsForOption
      })
    }

    setOptions(paymentOptions)

    // Load recent reversal history.
    const { data: reversalData, error: reversalError } = await supabase
      .from('payment_reversals')
      .select('reversal_id, collection_id, reason, total_amount, created_at')
      .eq('party_id', p.party_id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (reversalError) {
      setError(reversalError.message)
    } else {
      setHistory(reversalData || [])
    }

    setLoading(false)
  }

  function getPaymentAllocations(paymentIds: number[]) {
    return allocations.filter(x => paymentIds.includes(x.payment_id))
  }

  function getInvoice(saleId: number) {
    return sales.find(x => x.sale_id === saleId)
  }

  async function reverseSelected() {
    if (!selected || !party) return

    if (!reason.trim()) {
      setError('Please enter a reason for this reversal.')
      return
    }

    const target = selected.collectionId !== null
      ? `collection ${selected.collectionId}`
      : `payment ${selected.paymentId}`

    const confirmed = window.confirm(
      `Reverse ${target} for ${party.party_name}?\n\nAmount: ₹${selected.amount.toFixed(2)}\n\nThis will restore the affected invoice balances. The original payment records will be preserved.`
    )

    if (!confirmed) return

    setReversing(true)
    setError('')
    setMessage('')

    const { data, error: reversalError } = await supabase.rpc(
      'reverse_payment',
      {
        p_payment_id: selected.paymentId,
        p_collection_id: selected.collectionId,
        p_reason: reason.trim()
      }
    )

    setReversing(false)

    if (reversalError) {
      setError(reversalError.message)
      return
    }

    if (!data?.success) {
      setError('The reversal did not complete successfully.')
      return
    }

    setMessage(
      `Reversal #${data.reversal_id} completed. Amount: ₹${Number(data.reversed_amount).toFixed(2)}. New customer balance: ₹${Number(data.new_customer_balance).toFixed(2)}.`
    )

    setSelected(null)
    setReason('')

    // Refresh the customer payment list and reversal history.
    await loadParty(party)
  }

  if (checking) {
    return (
      <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        Checking access...
      </main>
    )
  }

  if (!allowed) {
    return (
      <main className="mx-auto w-full max-w-xl p-4 sm:p-6">
        <h1 className="text-2xl font-bold">Payment Admin</h1>
        <p className="mt-3 text-red-600">
          Owner access required.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-5 md:p-6">
      <header>
        <h1 className="text-2xl font-bold">Payment Admin</h1>
        <p className="text-sm text-gray-500">
          Payment reversal and history
        </p>
      </header>

      <section className="min-w-0 rounded-lg border p-3 sm:p-4">
        <h2 className="mb-3 text-lg font-semibold">Find Customer</h2>

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
              setError('')
              setMessage('')
              loadParty(found)
            } else if (!value) {
              setParty(null)
              setPayments([])
              setAllocations([])
              setSales([])
              setOptions([])
              setHistory([])
              setSelected(null)
            }
          }}
        />

        {partySearchLoading && (
          <p className="mt-2 text-sm text-gray-500">
            Searching customers...
          </p>
        )}
      </section>

      {message && (
        <div className="break-words rounded-md border border-green-300 bg-green-50 p-3 text-green-800">
          {message}
        </div>
      )}

      {error && (
        <div className="break-words rounded-md border border-red-300 bg-red-50 p-3 text-red-700">
          {error}
        </div>
      )}

      {party && (
        <>
          <section className="min-w-0 rounded-lg border p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="break-words text-xl font-semibold">
                  {party.party_name}
                </h2>
                <p className="text-sm text-gray-500">
                  Customer ID: {party.party_id}
                </p>
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
            <h2 className="mb-3 text-lg font-semibold">
              Payments and Collections
            </h2>

            {loading ? (
              <p className="text-gray-500">Loading...</p>
            ) : options.length === 0 ? (
              <p className="text-gray-500">No payment records found.</p>
            ) : (
              <div className="space-y-3">
                {options.map(option => {
                  const rows = payments.filter(x =>
                    option.paymentIds.includes(x.payment_id)
                  )

                  const isSelected = selected?.key === option.key

                  return (
                    <div
                      key={option.key}
                      className={`min-w-0 rounded-md border p-3 ${
                        isSelected ? 'border-blue-500 bg-blue-50' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="flex min-h-12 w-full flex-col items-start justify-between gap-2 text-left sm:flex-row sm:items-center"
                        onClick={() => setSelected(option)}
                      >
                        <div className="min-w-0">
                          <p className="break-words font-semibold">
                            {option.label}
                          </p>
                          <p className="text-sm text-gray-500">
                            {rows[0]?.payment_date}
                            {option.collectionId !== null
                              ? ' · Entire collection'
                              : ' · Standalone payment'}
                          </p>
                        </div>

                        <div className="w-full text-left sm:w-auto sm:text-right">
                          <p className="font-semibold">
                            ₹{option.amount.toFixed(2)}
                          </p>
                          <p className="text-sm text-blue-600">
                            {isSelected ? 'Selected' : 'Select'}
                          </p>
                        </div>
                      </button>

                      <div className="mt-3 space-y-3 border-t pt-3">
                        {rows.map(payment => (
                          <div
                            key={payment.payment_id}
                            className="min-w-0 text-sm"
                          >
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <span className="break-words">
                                Payment #{payment.payment_id} ·{' '}
                                {payment.payment_mode || 'Unspecified'}
                              </span>
                              <span className="font-medium">
                                ₹{Number(payment.amount).toFixed(2)}
                              </span>
                            </div>

                            {getPaymentAllocations([payment.payment_id]).map(a => {
                              const invoice = getInvoice(a.sale_id)

                              return (
                                <div
                                  key={a.id}
                                  className="ml-2 mt-1 break-words text-gray-500 sm:ml-3"
                                >
                                  Invoice #{a.sale_id}
                                  {invoice
                                    ? ` (${invoice.bill_date})`
                                    : ''}
                                  {' · '}Allocated ₹
                                  {Number(a.amount).toFixed(2)}
                                </div>
                              )
                            })}

                            {getPaymentAllocations([payment.payment_id]).length === 0 && (
                              <p className="ml-2 mt-1 text-gray-500 sm:ml-3">
                                No invoice allocation recorded
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      {option.collectionId !== null && (
                        <p className="mt-2 break-words text-xs text-orange-700">
                          Selecting this reverses every payment in this collection together.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {selected && (
            <section className="min-w-0 rounded-lg border border-orange-300 p-3 sm:p-4">
              <h2 className="text-lg font-semibold">Confirm Reversal</h2>

              <p className="mt-2 break-words">
                Selected: <strong>{selected.label}</strong>
              </p>
              <p>
                Amount: <strong>₹{selected.amount.toFixed(2)}</strong>
              </p>

              <label className="mt-4 block text-sm font-medium">
                Reason for reversal (required)
              </label>

              <textarea
                className="mt-1 min-h-24 w-full rounded-md border p-3 text-base"
                rows={3}
                placeholder="Example: Payment entered by mistake..."
                value={reason}
                onChange={e => setReason(e.target.value)}
              />

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={reverseSelected}
                  disabled={reversing || !reason.trim()}
                  className="min-h-11 w-full rounded-md bg-red-600 px-5 py-2 text-white disabled:opacity-50 sm:w-auto"
                >
                  {reversing ? 'Reversing...' : 'Confirm Reversal'}
                </button>

                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  disabled={reversing}
                  className="min-h-11 w-full rounded-md border px-5 py-2 sm:w-auto"
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

          <section className="min-w-0 rounded-lg border p-3 sm:p-4">
            <h2 className="mb-3 text-lg font-semibold">
              Reversal History
            </h2>

            {history.length === 0 ? (
              <p className="text-sm text-gray-500">
                No reversals recorded for this customer.
              </p>
            ) : (
              <div className="space-y-3">
                {history.map(item => (
                  <div
                    key={item.reversal_id}
                    className="min-w-0 rounded-md border p-3"
                  >
                    <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <strong>Reversal #{item.reversal_id}</strong>
                      <strong>
                        ₹{Number(item.total_amount).toFixed(2)}
                      </strong>
                    </div>

                    <p className="mt-1 text-sm text-gray-500">
                      {new Date(item.created_at).toLocaleString('en-IN')}
                    </p>

                    <p className="mt-2 break-words text-sm">
                      Reason: {item.reason}
                    </p>

                    {item.collection_id !== null && (
                      <p className="text-sm text-gray-500">
                        Collection #{item.collection_id}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
