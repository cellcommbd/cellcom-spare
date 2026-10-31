import { supabase } from './supabase'

/**
 * Apply a payment amount to outstanding bills oldest-first.
 * Reads paid_amount per bill, writes back paid_amount + derived status.
 * Returns touched sale_ids.
 *
 * Extracted 2026-10-31 from app/payments/page.tsx so /sales/day can reuse.
 * If you change this, verify /payments still works.
 */
export async function applyFIFO(
  shopId: number,
  paymentAmount: number
): Promise<number[]> {
  let remaining = paymentAmount
  const touched: number[] = []

  const { data: pendingSales } = await supabase
    .from('sales')
    .select('sale_id, total_amount, paid_amount, status')
    .eq('party_id', shopId)
    .in('status', ['Pending', 'Partially Paid'])
    .order('bill_date', { ascending: true })
    .order('sale_id', { ascending: true })

  if (!pendingSales || pendingSales.length === 0) return touched

  for (const sale of pendingSales) {
    if (remaining <= 0) break

    const total = Number(sale.total_amount || 0)
    const alreadyPaid = Number(sale.paid_amount || 0)
    const due = Math.max(0, total - alreadyPaid)
    if (due <= 0) continue

    const applied = Math.min(remaining, due)
    const newPaid = alreadyPaid + applied
    const newStatus =
      newPaid >= total ? 'Paid' : newPaid > 0 ? 'Partially Paid' : 'Pending'

    await supabase
      .from('sales')
      .update({ paid_amount: newPaid, status: newStatus })
      .eq('sale_id', sale.sale_id)

    touched.push(sale.sale_id)
    remaining -= applied
  }

  return touched
}