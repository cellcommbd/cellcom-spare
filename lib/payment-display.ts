export type InvoiceItemSummaryInput = {
  sku: string
  quantity: number
}

export function summarizeInvoiceItemNames(
  items: InvoiceItemSummaryInput[],
  maxItems = 3
): string {
  if (!items || items.length === 0) return 'No items'

  const visible = items
    .filter((it) => it && typeof it.sku === 'string')
    .slice(0, maxItems)
    .map((it) => `${it.sku} x${Number(it.quantity || 0)}`)

  if (items.length <= maxItems) {
    return visible.join(', ') || 'No items'
  }

  return `${visible.join(', ')} +${items.length - maxItems} more`
}
