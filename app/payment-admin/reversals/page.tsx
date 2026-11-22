
'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getRole } from '@/lib/auth'
import { SmartCombobox } from '../../../components/ui/smart-combobox'

type Payment = {
  payment_id: number
  party_id: number | null
  payment_date: string
  amount: number
  payment_mode: string | null
  collection_id: number | null
  party_name: string
  reversed: boolean
}

type Allocation = {
  sale_id: number
  amount: number
}

type ReversalResult = {
  success?: boolean
  party_id?: number
  payment_ids?: number[]
  reversal_id?: number
  reversed_amount?: number
  updated_invoices?: number
  new_customer_balance?: number
  message?: string
}

type Customer = {
  party_id: number
  party_name: string
}

function localDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDateRange(preset: string) {
  const today = new Date()
  const to = localDate(today)
  const fromDate = new Date(today)

  if (preset === 'yesterday') {
    fromDate.setDate(fromDate.getDate() - 1)
    const yesterday = localDate(fromDate)
    return { from: yesterday, to: yesterday }
  }

  if (preset === 'week') {
    fromDate.setDate(fromDate.getDate() - 6)
    return { from: localDate(fromDate), to }
  }

  if (preset === 'month') {
    fromDate.setDate(1)
    return { from: localDate(fromDate), to }
  }

  return { from: to, to }
}

export default function PaymentReversalsPage() {
  const [access, setAccess] = useState<'checking' | 'owner' | 'denied'>('checking')

  const [preset, setPreset] = useState('today')
  const [dateFrom, setDateFrom] = useState(() => getDateRange('today').from)
  const [dateTo, setDateTo] = useState(() => getDateRange('today').to)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [payments, setPayments] = useState<Payment[]>([])

  const [customerId, setCustomerId] = useState('')
  const [paymentId, setPaymentId] = useState('')

  const [selected, setSelected] = useState<Payment | null>(null)
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [reason, setReason] = useState('')

  const [loading, setLoading] = useState(false)
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const [loadingAllocations, setLoadingAllocations] = useState(false)
  const [reversing, setReversing] = useState(false)

  const [error, setError] = useState('')
  const [customerError, setCustomerError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState<ReversalResult | null>(null)

  useEffect(() => {
    if (getRole() === 'owner') {
      setAccess('owner')
    } else {
      setAccess('denied')
    }
  }, [])

  // Load the complete customer list independently of payment dates.
  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true)
    setCustomerError('')

    try {
      const { data, error: partiesError } = await supabase
        .from('parties')
        .select('party_id, party_name')
        .order('party_name', { ascending: true })

      if (partiesError) throw partiesError

      setCustomers(
        (data || [])
          .map((p: any) => ({
            party_id: Number(p.party_id),
            party_name: p.party_name || 'Unknown customer',
          }))
          .sort((a, b) => a.party_name.localeCompare(b.party_name))
      )
    } catch (e: any) {
      setCustomerError(e?.message || 'Could not load customers.')
    } finally {
      setLoadingCustomers(false)
    }
  }, [])

  const loadPayments = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      setError('Please select both dates.')
      return
    }

    if (dateFrom > dateTo) {
      setError('From date cannot be later than To date.')
      return
    }

    setLoading(true)
    setError('')
    setNotice('')
    setSelected(null)
    setAllocations([])
    setResult(null)

    try {
      let query = supabase
        .from('payments')
        .select('payment_id, party_id, payment_date, amount, payment_mode, collection_id')
        .gte('payment_date', dateFrom)
        .lte('payment_date', dateTo)
        .order('payment_date', { ascending: false })
        .order('payment_id', { ascending: false })
        .limit(500)

      if (customerId) {
        query = query.eq('party_id', Number(customerId))
      }

      if (paymentId) {
        query = query.eq('payment_id', Number(paymentId))
      }

      const { data: paymentRows, error: paymentError } = await query

      if (paymentError) throw paymentError

      const rows = paymentRows || []
      const partyIds = Array.from(
        new Set(
          rows
            .map((p: any) => p.party_id)
            .filter((id: number | null): id is number => id !== null)
        )
      )

      let partyNames = new Map<number, string>()

      if (partyIds.length > 0) {
        const { data: parties, error: partiesError } = await supabase
          .from('parties')
          .select('party_id, party_name')
          .in('party_id', partyIds)

        if (partiesError) throw partiesError

        partyNames = new Map(
          (parties || []).map((p: any) => [
            p.party_id,
            p.party_name || 'Unknown customer',
          ])
        )
      }

      const ids = rows.map((p: any) => p.payment_id)
      let reversedIds = new Set<number>()

      if (ids.length > 0) {
        const { data: reversalRows, error: reversalError } = await supabase
          .from('payment_reversal_items')
          .select('payment_id')
          .in('payment_id', ids)

        if (reversalError) {
          throw new Error(
            'Could not check reversal history. ' + reversalError.message
          )
        }

        reversedIds = new Set(
          (reversalRows || []).map((r: any) => r.payment_id)
        )
      }

      const formatted: Payment[] = rows.map((p: any) => ({
        ...p,
        amount: Number(p.amount || 0),
        party_name: p.party_id
          ? partyNames.get(p.party_id) || 'Unknown customer'
          : 'No customer',
        reversed: reversedIds.has(p.payment_id),
      }))

      setPayments(formatted)

      setNotice(
        `Loaded ${formatted.length} payment(s). Maximum 500 records per search.`
      )
    } catch (e: any) {
      setError(e?.message || 'Could not load payment history.')
      setPayments([])
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, customerId, paymentId])

  useEffect(() => {
    if (access === 'owner') {
      void loadCustomers()
      void loadPayments()
    }
  }, [access, loadCustomers, loadPayments])

  const customerPayments = useMemo(() => {
    return payments.filter((p) => {
      if (!customerId) return true
      return p.party_id === Number(customerId)
    })
  }, [payments, customerId])

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.party_id,
        label: c.party_name,
      })),
    [customers]
  )

  function changePreset(value: string) {
    setPreset(value)

    if (value !== 'custom') {
      const range = getDateRange(value)
      setDateFrom(range.from)
      setDateTo(range.to)
    }

    setPaymentId('')
  }

  async function selectPayment(payment: Payment) {
    setSelected(payment)
    setAllocations([])
    setReason('')
    setResult(null)
    setError('')

    if (payment.reversed) return

    setLoadingAllocations(true)

    try {
      const { data, error: allocationError } = await supabase
        .from('payment_allocations')
        .select('sale_id, amount')
        .eq('payment_id', payment.payment_id)
        .order('sale_id', { ascending: true })

      if (allocationError) throw allocationError

      setAllocations(
        (data || []).map((a: any) => ({
          sale_id: a.sale_id,
          amount: Number(a.amount || 0),
        }))
      )
    } catch (e: any) {
      setError(e?.message || 'Could not load payment allocations.')
    } finally {
      setLoadingAllocations(false)
    }
  }

  async function reverseSelectedPayment() {
    if (!selected || selected.reversed || reversing) return

    const cleanReason = reason.trim()

    if (!cleanReason) {
      setError('Please enter a reason for this reversal.')
      return
    }

    const confirmed = window.confirm(
      `Reverse payment #${selected.payment_id} for ₹${selected.amount.toFixed(2)}?\n\n` +
      `Customer: ${selected.party_name}\n` +
      `Reason: ${cleanReason}\n\n` +
      'This will update invoice balances. Continue?'
    )

    if (!confirmed) return

    setReversing(true)
    setError('')
    setNotice('')
    setResult(null)

    try {
      const { data, error: rpcError } = await supabase.rpc('reverse_payment', {
        p_payment_id: selected.payment_id,
        p_collection_id: null,
        p_reason: cleanReason,
      })

      if (rpcError) throw rpcError

      const response = data as ReversalResult

      if (!response || response.success !== true) {
        throw new Error(
          response?.message || 'The database did not confirm the reversal.'
        )
      }

      setPayments((current) =>
        current.map((p) =>
          p.payment_id === selected.payment_id
            ? { ...p, reversed: true }
            : p
        )
      )

      setSelected({ ...selected, reversed: true })
      setResult(response)

      setNotice(
        `Payment #${selected.payment_id} reversed successfully. ` +
        `Reversal ID: ${response.reversal_id ?? '—'}.`
      )
    } catch (e: any) {
      setError(e?.message || 'Payment reversal failed.')
    } finally {
      setReversing(false)
    }
  }

  if (access === 'checking') {
    return <main style={styles.page}>Checking access…</main>
  }

  if (access === 'denied') {
    return (
      <main style={styles.page}>
        <section style={styles.panel}>
          <h1 style={styles.heading}>Payment Reversals</h1>
          <p style={styles.danger}>Owner access required.</p>
          <Link href="/payments" style={styles.link}>Back to Payments</Link>
        </section>
      </main>
    )
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.heading}>Payment Reversals</h1>
          <p style={styles.subheading}>
            Find a payment, review its allocations and reverse it when necessary.
          </p>
        </div>

        <Link href="/payments" style={styles.link}>
          ← Back to Payments
        </Link>
      </header>

      <section style={styles.panel}>
        <h2 style={styles.sectionHeading}>Find payments</h2>

        <div style={styles.filters}>
          <label style={styles.field}>
            <span>Date period</span>
            <select
              style={styles.input}
              value={preset}
              onChange={(e) => changePreset(e.target.value)}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">Last 7 days</option>
              <option value="month">This Month</option>
              <option value="custom">Custom Range</option>
            </select>
          </label>

          <div style={styles.field}>
            <span>Customer</span>
            <SmartCombobox
              options={customerOptions}
              value={customerId || null}
              onValueChange={(value) => {
                setCustomerId(value)
                setPaymentId('')
              }}
              placeholder={
                loadingCustomers
                  ? 'Loading customers…'
                  : 'All customers — type to search'
              }
              disabled={loadingCustomers}
              allowCreate={false}
            />
          </div>

          <label style={styles.field}>
            <span>Payment ID</span>
            <select
              style={styles.input}
              value={paymentId}
              onChange={(e) => setPaymentId(e.target.value)}
            >
              <option value="">All payments</option>
              {customerPayments.map((p) => (
                <option key={p.payment_id} value={p.payment_id}>
                  #{p.payment_id} — ₹{p.amount.toFixed(2)} — {p.payment_date}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            style={styles.primaryButton}
            onClick={() => void loadPayments()}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load Payments'}
          </button>
        </div>

        {preset === 'custom' && (
          <div style={styles.dateRange}>
            <label style={styles.field}>
              <span>From date</span>
              <input
                style={styles.input}
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>

            <label style={styles.field}>
              <span>To date</span>
              <input
                style={styles.input}
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
          </div>
        )}

        <p style={styles.muted}>
          Customer search uses the full customer list. Payment choices are limited
          to the payments currently loaded for the selected date period.
        </p>

        {customerError && <p style={styles.error}>{customerError}</p>}
        {error && <p style={styles.error}>{error}</p>}
        {notice && <p style={styles.success}>{notice}</p>}
      </section>

      <section style={styles.panel}>
        <h2 style={styles.sectionHeading}>Payment list</h2>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Payment ID</th>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Customer</th>
                <th style={styles.th}>Mode</th>
                <th style={styles.thRight}>Amount</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Action</th>
              </tr>
            </thead>

            <tbody>
              {payments.map((p) => {
                const isSelected = selected?.payment_id === p.payment_id

                return (
                  <tr
                    key={p.payment_id}
                    style={isSelected ? styles.selectedRow : undefined}
                  >
                    <td style={styles.td}>#{p.payment_id}</td>
                    <td style={styles.td}>{p.payment_date}</td>
                    <td style={styles.td}>{p.party_name}</td>
                    <td style={styles.td}>{p.payment_mode || '—'}</td>
                    <td style={styles.tdRight}>₹{p.amount.toFixed(2)}</td>
                    <td style={styles.td}>
                      {p.reversed
                        ? <span style={styles.reversed}>Reversed</span>
                        : <span style={styles.active}>Active</span>}
                    </td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        style={
                          p.reversed
                            ? styles.disabledButton
                            : isSelected
                              ? styles.selectedButton
                              : styles.smallButton
                        }
                        disabled={p.reversed}
                        onClick={() => void selectPayment(p)}
                      >
                        {p.reversed ? 'Reversed' : isSelected ? 'Selected' : 'Review'}
                      </button>
                    </td>
                  </tr>
                )
              })}

              {!loading && payments.length === 0 && (
                <tr>
                  <td style={styles.empty} colSpan={7}>
                    No payments found for this selection.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section style={styles.panel} id="payment-review">
          <h2 style={styles.sectionHeading}>
            Reviewing payment #{selected.payment_id}
          </h2>

          <div style={styles.detailsGrid}>
            <div><strong>Customer:</strong> {selected.party_name}</div>
            <div><strong>Date:</strong> {selected.payment_date}</div>
            <div><strong>Amount:</strong> ₹{selected.amount.toFixed(2)}</div>
            <div><strong>Mode:</strong> {selected.payment_mode || '—'}</div>
            <div><strong>Collection ID:</strong> {selected.collection_id ?? 'None'}</div>
          </div>

          <h3 style={styles.subheadingTitle}>Invoice allocations</h3>

          {loadingAllocations ? (
            <p style={styles.muted}>Loading allocations…</p>
          ) : allocations.length > 0 ? (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Sale ID</th>
                  <th style={styles.thRight}>Allocated amount</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a, index) => (
                  <tr key={`${a.sale_id}-${index}`}>
                    <td style={styles.td}>#{a.sale_id}</td>
                    <td style={styles.tdRight}>₹{a.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={styles.muted}>
              No payment allocation rows found for this payment.
            </p>
          )}

          {selected.reversed ? (
            <p style={styles.danger}>
              This payment has already been reversed. It cannot be reversed again.
            </p>
          ) : (
            <>
              <label style={styles.field}>
                <span>Reason for reversal (required)</span>
                <textarea
                  style={styles.textarea}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Enter why this payment is being reversed"
                  rows={3}
                />
              </label>

              <div style={styles.actions}>
                <button
                  type="button"
                  style={styles.dangerButton}
                  onClick={() => void reverseSelectedPayment()}
                  disabled={
                    reversing ||
                    loadingAllocations ||
                    !reason.trim()
                  }
                >
                  {reversing ? 'Reversing…' : 'Confirm payment reversal'}
                </button>

                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => {
                    setSelected(null)
                    setAllocations([])
                    setReason('')
                    setResult(null)
                  }}
                  disabled={reversing}
                >
                  Close review
                </button>
              </div>
            </>
          )}

          {result && (
            <div style={styles.resultBox}>
              <strong>Reversal confirmed</strong>
              <p>Reversal ID: {result.reversal_id ?? '—'}</p>
              <p>
                Amount reversed: ₹
                {Number(result.reversed_amount || 0).toFixed(2)}
              </p>
              <p>Invoices updated: {result.updated_invoices ?? '—'}</p>
              <p>
                Updated customer balance:{' '}
                {result.new_customer_balance == null
                  ? '—'
                  : `₹${Number(result.new_customer_balance).toFixed(2)}`}
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    padding: 20,
    maxWidth: 1250,
    margin: '0 auto',
    color: 'var(--foreground, #222)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  heading: { fontSize: 25, fontWeight: 700, margin: 0 },
  sectionHeading: { fontSize: 19, fontWeight: 700, margin: '0 0 16px' },
  subheading: { color: '#777', margin: '7px 0 0' },
  subheadingTitle: { fontSize: 16, margin: '22px 0 10px' },
  panel: {
    background: 'var(--card, #fff)',
    border: '1px solid var(--border, #ddd)',
    borderRadius: 10,
    padding: 18,
    marginBottom: 20,
  },
  filters: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    alignItems: 'end',
  },
  dateRange: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    maxWidth: 500,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    margin: '12px 0',
    fontSize: 13,
    fontWeight: 600,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 11px',
    border: '1px solid #ccc',
    borderRadius: 6,
    fontSize: 14,
    background: 'var(--background, #fff)',
    color: 'inherit',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: 10,
    border: '1px solid #ccc',
    borderRadius: 6,
    fontSize: 14,
    background: 'var(--background, #fff)',
    color: 'inherit',
    resize: 'vertical',
  },
  primaryButton: {
    padding: '10px 14px',
    border: 0,
    borderRadius: 6,
    background: '#2459a6',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
  },
  smallButton: {
    padding: '6px 10px',
    border: '1px solid #2459a6',
    borderRadius: 5,
    color: '#2459a6',
    background: 'transparent',
    cursor: 'pointer',
  },
  selectedButton: {
    padding: '6px 10px',
    border: '1px solid #167044',
    borderRadius: 5,
    color: '#fff',
    background: '#167044',
    cursor: 'default',
  },
  disabledButton: {
    padding: '6px 10px',
    border: '1px solid #bbb',
    borderRadius: 5,
    color: '#888',
    background: '#eee',
    cursor: 'not-allowed',
  },
  dangerButton: {
    padding: '10px 14px',
    border: 0,
    borderRadius: 6,
    background: '#b42318',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '10px 14px',
    border: '1px solid #aaa',
    borderRadius: 6,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  },
  link: {
    color: '#2459a6',
    textDecoration: 'none',
    fontWeight: 600,
  },
  tableWrap: { width: '100%', overflowX: 'auto', marginTop: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    textAlign: 'left',
    padding: '10px 8px',
    borderBottom: '2px solid #ddd',
    whiteSpace: 'nowrap',
  },
  thRight: {
    textAlign: 'right',
    padding: '10px 8px',
    borderBottom: '2px solid #ddd',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 8px',
    borderBottom: '1px solid #eee',
    whiteSpace: 'nowrap',
  },
  tdRight: {
    padding: '10px 8px',
    borderBottom: '1px solid #eee',
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  empty: { padding: 20, textAlign: 'center', color: '#777' },
  muted: { color: '#777', fontSize: 13 },
  error: { color: '#b42318', background: '#fff0ef', padding: 10, borderRadius: 6 },
  success: { color: '#167044', background: '#edf9f1', padding: 10, borderRadius: 6 },
  danger: { color: '#b42318', fontWeight: 700 },
  reversed: { color: '#b42318', fontWeight: 700 },
  active: { color: '#167044', fontWeight: 700 },
  selectedRow: { background: '#eaf3ff' },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 12,
    fontSize: 14,
  },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 },
  resultBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 7,
    background: '#edf9f1',
    color: '#145c36',
  },
}
