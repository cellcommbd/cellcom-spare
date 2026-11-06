import { supabase } from './supabase'

export async function recomputePartyBalance(partyId: number): Promise<number> {
  const { data: sales } = await supabase
    .from('sales')
    .select('total_amount, paid_amount')
    .eq('party_id', partyId)

  const { data: returns } = await supabase
    .from('returns')
    .select('total_amount')
    .eq('party_id', partyId)
    .eq('return_type', 'Customer')

  const { data: payments } = await supabase
    .from('payments')
    .select('amount')
    .eq('party_id', partyId)

  const unpaid = (sales || []).reduce(
    (s, x) => s + (Number(x.total_amount) - Number(x.paid_amount || 0)),
    0
  )
  const returned = (returns || []).reduce(
    (s, x) => s + Number(x.total_amount),
    0
  )
  const totalPayments = (payments || []).reduce(
    (s, x) => s + Number(x.amount),
    0
  )
  const totalApplied = (sales || []).reduce(
    (s, x) => s + Number(x.paid_amount || 0),
    0
  )
  const overpaid = Math.max(0, totalPayments - totalApplied)

  const correct = Math.round((unpaid - returned - overpaid) * 100) / 100

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