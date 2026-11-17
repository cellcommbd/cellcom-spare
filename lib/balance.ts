export function isCounterSaleParty(
  partyName?: string | null,
  partyId?: number | null
): boolean {
  if (partyId !== undefined && partyId !== null && partyId === 3) return true
  const name = (partyName || '').trim().toLowerCase()
  return name === 'counter sale' || name === 'counter'
}

export function computeExpectedCustomerBalance({
  sales = [],
  returns = [],
  partyName,
  partyId,
}: {
  sales?: Array<{ total_amount?: number | string | null; paid_amount?: number | string | null }>
  returns?: Array<{ total_amount?: number | string | null }>
  partyName?: string | null
  partyId?: number | null
}): number {
  if (isCounterSaleParty(partyName, partyId)) return 0

  const unpaid = sales.reduce(
    (sum, sale) => sum + (Number(sale.total_amount || 0) - Number(sale.paid_amount || 0)),
    0
  )
  const returned = returns.reduce(
    (sum, entry) => sum + Number(entry.total_amount || 0),
    0
  )

  return Math.round((unpaid - returned) * 100) / 100
}

async function getSupabaseClient() {
  const mod = await import('./supabase.ts')
  return mod.supabase as any
}

export async function recomputePartyBalance(partyId: number): Promise<number> {
  const supabase = await getSupabaseClient()

  const { data: party } = await supabase
    .from('parties')
    .select('party_name')
    .eq('party_id', partyId)
    .single()

  const { data: sales } = await supabase
    .from('sales')
    .select('total_amount, paid_amount')
    .eq('party_id', partyId)

  const { data: returns } = await supabase
    .from('returns')
    .select('total_amount')
    .eq('party_id', partyId)
    .eq('return_type', 'Customer')

  const correct = computeExpectedCustomerBalance({
    sales: sales || [],
    returns: returns || [],
    partyName: party?.party_name || null,
    partyId,
  })

  await supabase
    .from('parties')
    .update({ current_balance: correct })
    .eq('party_id', partyId)

  return correct
}

export async function reverseFIFO(
  partyId: number,
  amount: number
): Promise<number[]> {
  const supabase = await getSupabaseClient()
  const { data: bills } = await supabase
    .from('sales')
    .select('sale_id, total_amount, paid_amount, bill_date')
    .eq('party_id', partyId)
    .gt('paid_amount', 0)
    .order('bill_date', { ascending: false })
    .order('sale_id', { ascending: false })

  const touched: number[] = []
  let remaining = amount

  for (const bill of bills || []) {
    if (remaining <= 0) break
    const paid = Number(bill.paid_amount)
    const reverse = Math.min(paid, remaining)
    const newPaid = paid - reverse

    const newStatus =
      Number(bill.total_amount) - newPaid <= 0.01
        ? 'Paid'
        : newPaid > 0
        ? 'Partially Paid'
        : 'Pending'

    await supabase
      .from('sales')
      .update({ paid_amount: newPaid, status: newStatus })
      .eq('sale_id', bill.sale_id)

    touched.push(bill.sale_id)
    remaining -= reverse
  }

  return touched
}