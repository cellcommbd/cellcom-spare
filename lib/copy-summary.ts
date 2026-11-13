import type { ParsedRow } from '@/lib/csv-parser'

const col = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}

export function buildSummaryText(rows: ParsedRow[]): string {
  const lines: string[] = [
    'row\tgenerated_sku\tstatus\tsize\tvariant\tflag\tnotes',
  ]

  for (const r of rows) {
    const notes = r.errorMessage ?? ''
    lines.push(
      [
        r.rowNumber,
        col(r.generatedSku),
        col(r.status),
        col(r.size),
        col(r.variant),
        col(r.flag),
        col(notes),
      ].join('\t')
    )
  }

  const matched = rows.filter((r) => r.status === 'matched').length
  const news = rows.filter((r) => r.status === 'new').length
  const errors = rows.filter((r) => r.status === 'needs_correction').length

  lines.push('')
  lines.push(`${matched} matched, ${news} new, ${errors} errors`)
  return lines.join('\n')
}

export function buildSummaryFromStaging(
  rows: Array<{
    row_num: number | null
    generated_sku: string | null
    resolved_action: string | null
    size?: string | null
    variant?: string | null
    flag?: string | null
    conflict_reason?: string | null
  }>
): string {
  const lines: string[] = [
    'row\tgenerated_sku\tstatus\tsize\tvariant\tflag\tnotes',
  ]
  for (const r of rows) {
    lines.push(
      [
        r.row_num ?? '',
        (r.generated_sku ?? '').replace(/\t/g, ' '),
        r.resolved_action ?? '',
        (r.size ?? '').replace(/\t/g, ' '),
        (r.variant ?? '').replace(/\t/g, ' '),
        (r.flag ?? '').replace(/\t/g, ' '),
        (r.conflict_reason ?? '').replace(/\r?\n/g, ' '),
      ].join('\t')
    )
  }
  const matched = rows.filter((r) => r.resolved_action === 'match').length
  const news = rows.filter((r) => r.resolved_action === 'new' || r.resolved_action === 'new_partial').length
  const errors = rows.filter((r) => r.resolved_action === 'unresolved' || r.resolved_action === 'ambiguous').length
  lines.push('')
  lines.push(`${matched} matched, ${news} new, ${errors} errors`)
  return lines.join('\n')
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export async function copySummaryToClipboard(rows: ParsedRow[]): Promise<boolean> {
  const text = buildSummaryText(rows)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy
  }
  // Fallback for non-secure contexts / older browsers
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}