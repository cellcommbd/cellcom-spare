
import { supabase } from './supabase'

/**
 * Apply an existing payment to outstanding invoices, oldest first.
 *
 * The database RPC performs the entire operation in one transaction:
 * - Locks the payment and relevant invoices.
 * - Checks existing allocations to prevent duplicate processing.
 * - Allocates only the unallocated remainder.
 * - Updates invoice paid_amount and status.
 * - Inserts allocation records.
 *
 * A payment must already exist in the payments table.
 */
export async function applyFIFO(
  partyId: number,
  paymentAmount: number,
  paymentId?: number
): Promise<number[]> {
  // Validate input before contacting the database.
  if (!Number.isInteger(partyId) || partyId <= 0) {
    throw new Error('Invalid customer ID.')
  }

  if (!Number.isInteger(paymentId) || !paymentId || paymentId <= 0) {
    throw new Error('A valid payment ID is required for safe allocation.')
  }

  const amount = Number(paymentAmount)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be greater than zero.')
  }

  // Use integer paise to avoid floating-point comparison errors.
  const amountPaise = Math.round(amount * 100)

  if (Math.abs(amount - amountPaise / 100) > 0.000001) {
    throw new Error('Payment amount cannot have fractions of a paisa.')
  }

  // The database verifies the actual payment amount and party.
  // Allocation, invoice updates and duplicate protection happen atomically.
  const { data, error } = await supabase.rpc('apply_payment_fifo', {
    p_party_id: partyId,
    p_payment_id: paymentId,
  })

  if (error) {
    throw new Error(`Payment allocation failed: ${error.message}`)
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Allocation returned an invalid database response.')
  }

  const result = data as {
    allocated_sale_ids?: number[]
    allocated_amount?: number
    unallocated_amount?: number
  }

  if (
    !Array.isArray(result.allocated_sale_ids) ||
    !Number.isFinite(Number(result.allocated_amount)) ||
    !Number.isFinite(Number(result.unallocated_amount))
  ) {
    throw new Error('Allocation response is incomplete. Please verify the payment before retrying.')
  }

  const allocatedPaise = Math.round(Number(result.allocated_amount) * 100)
  const unallocatedPaise = Math.round(Number(result.unallocated_amount) * 100)

  if (
    allocatedPaise < 0 ||
    unallocatedPaise < 0 ||
    allocatedPaise + unallocatedPaise > amountPaise
  ) {
    throw new Error('Allocation totals failed verification. Please check the payment ledger.')
  }

  if (unallocatedPaise > 0) {
    console.warn(
      `Payment #${paymentId}: ₹${(unallocatedPaise / 100).toFixed(2)} remains unallocated.`
    )
  }

  return result.allocated_sale_ids
}
