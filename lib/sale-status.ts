export function normalizeAmount(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0

  return Math.max(0, numeric)
}

export function computeDueAmount(
  totalAmount: number | string | null | undefined,
  paidAmount: number | string | null | undefined
): number {
  const total = normalizeAmount(totalAmount)
  const paid = Math.min(normalizeAmount(paidAmount), total)
  return Math.max(0, total - paid)
}

export function computeSaleStatus(
  totalAmount: number | string | null | undefined,
  paidAmount: number | string | null | undefined
): 'Pending' | 'Partially Paid' | 'Paid' {
  const total = normalizeAmount(totalAmount)
  const paid = Math.min(normalizeAmount(paidAmount), total)

  if (total <= 0) {
    return paid > 0 ? 'Paid' : 'Pending'
  }

  if (paid >= total) return 'Paid'
  if (paid > 0) return 'Partially Paid'
  return 'Pending'
}
