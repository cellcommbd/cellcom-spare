
/**
 * Customer balance calculations.
 *
 * Accounting source of truth:
 *   Invoice balances = sales.total_amount - sales.paid_amount
 *   Customer balance = outstanding invoices - customer returns
 *                     - unallocated collection advances
 *
 * Historical payments with collection_id NULL are excluded.
 */

type SaleBalanceRow = {
  total_amount?: number | string | null
  paid_amount?: number | string | null
}

type ReturnBalanceRow = {
  total_amount?: number | string | null
}

function money(value: unknown): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) {
    throw new Error('Invalid amount found while calculating customer balance.')
  }
  return n
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function isCounterSaleParty(
  partyName?: string | null,
  partyId?: number | null
): boolean {
  if (partyId !== undefined && partyId !== null && partyId === 3) {
    return true
  }

  const name = (partyName || '').trim().toLowerCase()
  return name === 'counter sale' || name === 'counter'
}

export function computeExpectedCustomerBalance({
  sales = [],
  returns = [],
  unallocatedAdvances = 0,
  partyName,
  partyId,
}: {
  sales?: SaleBalanceRow[]
  returns?: ReturnBalanceRow[]
  unallocatedAdvances?: number | string | null
  partyName?: string | null
  partyId?: number | null
}): number {
  if (isCounterSaleParty(partyName, partyId)) return 0

  const unpaid = sales.reduce((sum, sale) => {
    return sum + money(sale.total_amount) - money(sale.paid_amount)
  }, 0)

  const returned = returns.reduce(
    (sum, entry) => sum + money(entry.total_amount),
    0
  )

  const advances = money(unallocatedAdvances)

  if (advances < 0) {
    throw new Error('Invalid unallocated advance amount.')
  }

  return roundMoney(unpaid - returned - advances)
}

async function getSupabaseClient() {
  const mod = await import('./supabase.ts')
  return mod.supabase as any
}

/**
 * Recalculate and save one customer's stored balance.
 *
 * Only payments with collection_id IS NOT NULL are eligible advances.
 * Original allocation and reversal records are retained by the database.
 */
export async function recomputePartyBalance(
  partyId: number
): Promise<number> {
  if (!Number.isInteger(partyId) || partyId <= 0) {
    throw new Error('Invalid customer ID.')
  }

  const supabase = await getSupabaseClient()

  const [
    { data: party, error: partyError },
    { data: sales, error: salesError },
    { data: returns, error: returnsError },
    { data: payments, error: paymentsError },
  ] = await Promise.all([
    supabase
      .from('parties')
      .select('party_id, party_name')
      .eq('party_id', partyId)
      .single(),

    supabase
      .from('sales')
      .select('total_amount, paid_amount')
      .eq('party_id', partyId),

    supabase
      .from('returns')
      .select('total_amount')
      .eq('party_id', partyId)
      .eq('return_type', 'Customer'),

    supabase
      .from('payments')
      .select('payment_id, amount')
      .eq('party_id', partyId)
      .not('collection_id', 'is', null),
  ])

  if (partyError) {
    throw new Error(`Could not read customer: ${partyError.message}`)
  }

  if (!party) {
    throw new Error(`Customer #${partyId} was not found.`)
  }

  if (salesError) {
    throw new Error(`Could not read customer invoices: ${salesError.message}`)
  }

  if (returnsError) {
    throw new Error(`Could not read customer returns: ${returnsError.message}`)
  }

  if (paymentsError) {
    throw new Error(`Could not read collection payments: ${paymentsError.message}`)
  }

  const paymentRows = payments || []
  const paymentIds = paymentRows.map((p: any) => Number(p.payment_id))

  let allocations: any[] = []
  let reversalItems: any[] = []

  if (paymentIds.length > 0) {
    const [
      { data: allocationData, error: allocationError },
      { data: reversalData, error: reversalError },
    ] = await Promise.all([
      supabase
        .from('payment_allocations')
        .select('payment_id, amount')
        .in('payment_id', paymentIds),

      supabase
        .from('payment_reversal_items')
        .select('payment_id, reversed_amount')
        .in('payment_id', paymentIds),
    ])

    if (allocationError) {
      throw new Error(`Could not read payment allocations: ${allocationError.message}`)
    }

    if (reversalError) {
      throw new Error(`Could not read payment reversals: ${reversalError.message}`)
    }

    allocations = allocationData || []
    reversalItems = reversalData || []
  }

  const allocatedByPayment = new Map<number, number>()

  for (const allocation of allocations) {
    const id = Number(allocation.payment_id)
    allocatedByPayment.set(
      id,
      (allocatedByPayment.get(id) || 0) + money(allocation.amount)
    )
  }

  const reversedByPayment = new Map<number, number>()

  for (const reversal of reversalItems) {
    const id = Number(reversal.payment_id)
    reversedByPayment.set(
      id,
      (reversedByPayment.get(id) || 0) + money(reversal.reversed_amount)
    )
  }

  const unallocatedAdvances = paymentRows.reduce(
    (sum: number, payment: any) => {
      const id = Number(payment.payment_id)
      const amount = money(payment.amount)
      const allocated = allocatedByPayment.get(id) || 0
      const reversed = reversedByPayment.get(id) || 0

      // A fully reversed payment has no remaining advance.
      // Reversals in the current database function are always full reversals.
// Original allocation records remain, so a reversed payment contributes zero.
const remaining =
  reversed > 0 ? 0 : amount - allocated

      if (remaining < -0.01) {
        throw new Error(
          `Payment #${id} has allocations and reversals exceeding its amount.`
        )
      }

      return sum + Math.max(0, remaining)
    },
    0
  )

  const correct = computeExpectedCustomerBalance({
    sales: sales || [],
    returns: returns || [],
    unallocatedAdvances,
    partyName: party.party_name,
    partyId,
  })

  const { error: updateError } = await supabase
    .from('parties')
    .update({ current_balance: correct })
    .eq('party_id', partyId)

  if (updateError) {
    throw new Error(`Could not save customer balance: ${updateError.message}`)
  }

  return correct
}

/**
 * Set a customer's stored balance to a specified target.
 *
 * Changes ONLY parties.current_balance.
 */
export async function alignPartyBalanceToTarget(
  partyId: number,
  targetBalance: number
): Promise<number> {
  if (!Number.isInteger(partyId) || partyId <= 0) {
    throw new Error('Invalid customer ID.')
  }

  if (!Number.isFinite(targetBalance)) {
    throw new Error('Invalid target balance.')
  }

  const supabase = await getSupabaseClient()

  const { data: party, error: partyError } = await supabase
    .from('parties')
    .select('party_id')
    .eq('party_id', partyId)
    .single()

  if (partyError) {
    throw new Error(`Could not read customer: ${partyError.message}`)
  }

  if (!party) {
    throw new Error(`Customer #${partyId} was not found.`)
  }

  const safeTarget = roundMoney(targetBalance)

  const { error: updateError } = await supabase
    .from('parties')
    .update({ current_balance: safeTarget })
    .eq('party_id', partyId)

  if (updateError) {
    throw new Error(`Could not save customer balance: ${updateError.message}`)
  }

  return safeTarget
}

/**
 * Unsafe legacy operations disabled.
 */
export async function reverseFIFO(
  _partyId: number,
  _amount: number
): Promise<number[]> {
  throw new Error(
    'Unsafe legacy operation disabled. Reverse the actual payment allocations instead.'
  )
}

export async function alignPartyBalanceByPayments(
  _partyId: number,
  _targetBalance: number
): Promise<number> {
  throw new Error(
    'Unsafe balance alignment disabled. Correct the underlying invoices, payments and allocations instead.'
  )
}
