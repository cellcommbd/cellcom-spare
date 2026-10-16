// lib/statement-format.ts
// Shared helper that builds the WhatsApp-ready statement text.
// Uses only WhatsApp-supported formatting: *bold*, _italic_, ~strike~.

export type StatementItem = {
  sku: string
  quantity: number
  rate: number
  amount: number
}

export type StatementData = {
  shopName?: string
  customerName: string
  fromDate: string
  toDate: string
  items: StatementItem[]
  purchasesTotal: number
  previousBalance: number
  cashPaid: number
  upiPaid: number
  netDue: number
}

function formatDateLong(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function padLeft(s: string, len: number): string {
  const pad = Math.max(0, len - s.length)
  return ' '.repeat(pad) + s
}

export function buildStatementText(data: StatementData): string {
  const shopName = data.shopName || 'CELLCOM SPARE'
  const totalPaid = data.cashPaid + data.upiPaid
  const out: string[] = []

  // ── Header ──
  out.push(`*${shopName}*`)
  out.push('━━━━━━━━━━━━━━━')
  out.push(`_Customer:_ *${data.customerName}*`)

  const dateLabel =
    data.fromDate === data.toDate
      ? formatDateLong(data.fromDate)
      : `${formatDateLong(data.fromDate)} – ${formatDateLong(data.toDate)}`
  out.push(`_Date:_ ${dateLabel}`)
  out.push('')

  // ── Items ──
  if (data.items.length > 0) {
    out.push('*🧾 ITEMS*')
    out.push('━━━━━━━━━━━━━━━')
    for (const item of data.items) {
      out.push(`*${item.sku}*`)
      out.push(
        `   ${item.quantity} × Rs.${item.rate.toFixed(2)} = *Rs.${item.amount.toFixed(2)}*`
      )
    }
    out.push('')
    out.push(`*Total Purchases: Rs.${data.purchasesTotal.toFixed(2)}*`)
    out.push('')
  } else {
    out.push('_No purchases in this period._')
    out.push('')
  }

  // ── Summary ──
  out.push('*💰 ACCOUNT SUMMARY*')
  out.push('━━━━━━━━━━━━━━━')

  const prevLabel = `Previous Balance`
  const prevVal = `Rs.${data.previousBalance.toFixed(2)}`
  out.push(`${padLeft(prevLabel + ':', 20)}${prevVal}`)

  if (data.purchasesTotal > 0) {
    const purLabel = `Purchases`
    const purVal = `+Rs.${data.purchasesTotal.toFixed(2)}`
    out.push(`${padLeft(purLabel + ':', 20)}${purVal}`)
  }

  if (totalPaid > 0) {
    if (data.cashPaid > 0 && data.upiPaid > 0) {
      out.push(
        `${padLeft('Paid (Cash):', 20)}-Rs.${data.cashPaid.toFixed(2)}`
      )
      out.push(
        `${padLeft('Paid (UPI):', 20)}-Rs.${data.upiPaid.toFixed(2)}`
      )
    } else {
      const mode = data.cashPaid > 0 ? 'Cash' : 'UPI'
      out.push(`${padLeft(`Paid (${mode}):`, 20)}-Rs.${totalPaid.toFixed(2)}`)
    }
  }

  out.push('━━━━━━━━━━━━━━━')
  out.push('')
  out.push(`*NET DUE:*  *Rs.${data.netDue.toFixed(2)}*`)
  out.push('')
  out.push('_Thank you for your business!_')

  return out.join('\n')
}

// Normalize Indian phone number to the digits WhatsApp expects (with 91 prefix).
export function normalizePhoneForWhatsApp(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = String(raw).replace(/\D/g, '')
  if (!digits) return null

  digits = digits.replace(/^0+/, '')

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits
  }
  if (digits.length === 10) {
    return '91' + digits
  }
  if (digits.length === 11) {
    return null
  }
  return null
}

export function buildWhatsAppUrl(
  phone: string | null | undefined,
  message: string
): string | null {
  const normalized = normalizePhoneForWhatsApp(phone)
  if (!normalized) return null
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
}