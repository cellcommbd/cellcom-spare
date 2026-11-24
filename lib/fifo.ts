import { supabase } from './supabase'

function toPaise(value: unknown, label: string): number {
  const amount = Number(value)

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} is not a valid non-negative amount.`)
  }

  const paise = Math.round(amount * 100)

  if (Math.abs(amount - paise / 100) > 0.000001) {
    throw new Error(`${label} cannot have fractions of a paisa.`)
  }

  return paise
}

/**
 * Apply an existing payment to outstanding invoices, oldest first.
 *
 * The database RPC is authoritative and performs allocation atomically.
 * Its allocated_amount is the amount newly allocated in this call, not the
 * payment's lifetime allocation total. Therefore it must not be compared
 * directly with the full payment amount on retries.
 */
export async function applyFIFO(
  partyId: number,
  paymentAmount: number,
  paymentId?: number
): Promise<number[]> {
  if (!Number.isInteger(partyId) || partyId <= 0) {
    throw new Error('Invalid customer ID.')
  }

  if (!Number.isInteger(paymentId) || !paymentId || paymentId <= 0) {
    throw new Error('A valid payment ID is required for safe allocation.')
  }

  const expectedPaymentPaise = toPaise(paymentAmount, 'Payment amount')

  if (expectedPaymentPaise <= 0) {
    throw new Error('Payment amount must be greater than zero.')
  }

  const { data, error } = await supabase.rpc('apply_payment_fifo', {
    p_party_id: partyId,
    p_payment_id: paymentId,
  })

  if (error) {
    throw new Error(`Payment allocation failed: ${error.message}`)
  }

  if (!data || typeof data !== 'object') {
    throw new Error(
      'Allocation returned an invalid response. Verify the payment before retrying.'
    )
  }

  const result = data as {
    allocated_sale_ids?: number[]
    allocated_amount?: number | string
    unallocated_amount?: number | string
    already_allocated?: boolean
  }

  if (
    !Array.isArray(result.allocated_sale_ids) ||
    result.allocated_amount === undefined ||
    result.unallocated_amount === undefined
  ) {
    throw new Error(
      'Allocation response is incomplete. Verify the payment before retrying.'
    )
  }

  // These are this RPC call's allocation and remaining amounts. On a retry,
  // earlier allocations are not included in allocated_amount.
  const newlyAllocatedPaise = toPaise(
    result.allocated_amount,
    'Newly allocated amount'
  )
  const rpcUnallocatedPaise = toPaise(
    result.unallocated_amount,
    'Unallocated amount'
  )

  if (newlyAllocatedPaise + rpcUnallocatedPaise > expectedPaymentPaise) {
    throw new Error(
      `Allocation response exceeds payment #${paymentId}. Please verify the ledger.`
    )
  }

  // Verify the persisted payment and all its allocations. This is the
  // authoritative check and also handles payments that were partly allocated
  // before this RPC call.
  const [paymentResult, allocationResult] = await Promise.all([
    supabase
      .from('payments')
      .select('party_id, amount')
      .eq('payment_id', paymentId)
      .single(),
    supabase
      .from('payment_allocations')
      .select('amount')
      .eq('payment_id', paymentId),
  ])

  if (paymentResult.error || !paymentResult.data) {
    throw new Error(
      `Allocation may have been saved, but payment #${paymentId} could not be verified. ` +
        `${paymentResult.error?.message || 'Payment record not found.'} Do not enter it again.`
    )
  }

  if (allocationResult.error) {
    throw new Error(
      `Allocation may have been saved, but allocations for payment #${paymentId} could not be verified. ` +
        `${allocationResult.error.message} Do not enter it again.`
    )
  }

  if (Number(paymentResult.data.party_id) !== partyId) {
    throw new Error(`Payment #${paymentId} belongs to a different customer.`)
  }

  const actualPaymentPaise = toPaise(
    paymentResult.data.amount,
    'Stored payment amount'
  )

  if (actualPaymentPaise !== expectedPaymentPaise) {
    throw new Error(
      `Payment #${paymentId} amount changed. Expected ₹${(expectedPaymentPaise / 100).toFixed(2)}, ` +
        `database has ₹${(actualPaymentPaise / 100).toFixed(2)}. Do not retry blindly.`
    )
  }

  const actualAllocatedPaise = (allocationResult.data || []).reduce(
    (sum: number, allocation: { amount: number | string }) =>
      sum + toPaise(allocation.amount, 'Stored allocation amount'),
    0
  )

  if (actualAllocatedPaise > actualPaymentPaise) {
    throw new Error(
      `Payment #${paymentId} has allocations exceeding its amount. ` +
        'The payment needs manual ledger review.'
    )
  }

  const actualUnallocatedPaise = actualPaymentPaise - actualAllocatedPaise

  if (actualUnallocatedPaise > 0) {
    console.warn(
      `Payment #${paymentId}: ₹${(actualUnallocatedPaise / 100).toFixed(2)} remains as customer advance.`
    )
  }

  return result.allocated_sale_ids.map(Number)
}
