import { supabase } from '@/lib/supabase'
import type { ParsedRow, Quality } from '@/lib/csv-parser'
import { buildFingerprint, previewNormalizedText } from '@/lib/csv-parser'

export type StagingAction =
  | 'match'
  | 'match_reformat'
  | 'new'
  | 'new_partial'
  | 'ambiguous'
  | 'unresolved'
  | 'price_mismatch'
  | 'return'

export type StagingRow = {
  staging_id: number
  session_id: string
  row_num: number | null
  raw_description: string | null
  processed_text: string | null
  raw_type: string | null
  raw_quality: string | null
  qty: number | null
  rate: number | null
  brand_code: string | null
  model_name: string | null
  part_code: string | null
  quality: string | null
  color: string | null
  variant: string | null
  flag: string | null
  network: string | null
  year: string | null
  generated_sku: string | null
  fingerprint: string | null
  resolved_action: StagingAction | null
  matched_item_id: number | null
  conflict_reason: string | null
  created_at: string | null
}

export type StagingSession = {
  session_id: string
  row_count: number
  first_created: string
  last_created: string
}

const PRICE_THRESHOLD_PCT = 6

export function newSessionId(): string {
  return crypto.randomUUID()
}

export async function writeStagingRows(
  sessionId: string,
  rows: ParsedRow[]
): Promise<void> {
  if (rows.length === 0) return

  // Merge duplicate invoice lines: same physical item (fingerprint) at
  // same rate → one staging row with summed qty. Different rate → keep
  // separate so cost averaging respects both.
  const grouped = new Map<string, ParsedRow & { qty: number }>()
  for (const r of rows) {
    const fp =
      r.brandCode && r.partCode
        ? buildFingerprint({
            brandCode: r.brandCode,
            modelName: r.modelName,
            partCode: r.partCode,
            quality: r.quality,
            color: r.color,
            variant: r.variant,
            flag: r.flag,
            network: r.network,
            year: r.year,
          })
        : ''
    const key = `${fp}|${r.rate}`
    const existing = grouped.get(key)
    if (existing) {
      existing.qty += r.qty || 0
    } else {
      grouped.set(key, { ...r, qty: r.qty || 0 })
    }
  }

  const payload = Array.from(grouped.values()).map((r) => {
    const fingerprint =
      r.brandCode && r.partCode
        ? buildFingerprint({
            brandCode: r.brandCode,
            modelName: r.modelName,
            partCode: r.partCode,
            quality: r.quality,
            color: r.color,
            variant: r.variant,
            flag: r.flag,
            network: r.network,
            year: r.year,
          })
        : null

    return {
      session_id: sessionId,
      row_num: r.rowNumber,
      raw_description: r.rawDescription,
      processed_text: previewNormalizedText(r.rawDescription + ' ' + (r.rawType || '')),
      raw_type: r.rawType,
      raw_quality: null as string | null,
      qty: r.qty,
      rate: r.rate,
      brand_code: r.brandCode,
      model_name: r.modelName,
      part_code: r.partCode,
      quality: r.quality,
      color: r.color,
      variant: r.variant,
      flag: r.flag,
      network: r.network,
      year: r.year,
      generated_sku: r.generatedSku,
      fingerprint,
    }
  })

  const CHUNK = 500
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK)
    const { error } = await supabase.from('import_staging').insert(slice)
    if (error) throw new Error('Could not write staging rows: ' + error.message)
  }
}

// Classify a single row (shared logic between classifySession and reclassifyRow)
function classifyOne(
  r: StagingRow,
  matches: { item_id: number; sku: string; cost_price: number | null }[]
): {
  action: StagingAction
  matched_item_id: number | null
  conflict_reason: string | null
} {
  let action: StagingAction = 'new'
  let matched_item_id: number | null = null
  let conflict_reason: string | null = null

  if ((r.qty != null && r.qty < 0) || (r.rate != null && r.rate < 0)) {
    action = 'return'
    conflict_reason = `Negative invoice line: qty ${r.qty}, rate ${r.rate}`
  } else if (!r.brand_code || !r.part_code) {
    action = 'unresolved'
    conflict_reason = 'Missing brand or part code'
  } else if (!r.fingerprint || r.fingerprint === '||||||||') {
    action = 'unresolved'
    conflict_reason = 'Could not compute fingerprint'
  } else if (matches.length > 1) {
    action = 'ambiguous'
    conflict_reason = `Multiple items (${matches.length}) share this fingerprint`
  } else if (matches.length === 1) {
    const m = matches[0]
    matched_item_id = m.item_id
    const skuDiffers = (m.sku || '') !== (r.generated_sku || '')
    const pctDiff =
      m.cost_price && r.rate
        ? Math.abs((r.rate - m.cost_price) / m.cost_price) * 100
        : 0
    const significantPriceDiff = pctDiff > PRICE_THRESHOLD_PCT

    if (skuDiffers) {
      action = 'match_reformat'
      conflict_reason = `Existing SKU: ${m.sku}`
    } else if (significantPriceDiff) {
      action = 'price_mismatch'
      conflict_reason = `Cost ₹${m.cost_price} → Now ₹${r.rate} (${pctDiff.toFixed(1)}% diff)`
    } else {
      action = 'match'
    }
  } else {
    const partial =
      !r.quality && !r.color && !r.variant && !r.flag && !r.network && !r.year
    action = partial ? 'new_partial' : 'new'
    if (partial) conflict_reason = 'All optional fields blank'
  }

  return { action, matched_item_id, conflict_reason }
}

async function fetchMatchesForFingerprints(fingerprints: string[]): Promise<
  Map<string, { item_id: number; sku: string; cost_price: number | null }[]>
> {
  type ItemRow = {
    item_id: number
    sku: string
    cost_price: number | null
    fingerprint: string | null
  }
  const itemsByFp = new Map<
    string,
    { item_id: number; sku: string; cost_price: number | null }[]
  >()
  if (fingerprints.length === 0) return itemsByFp

  const CHUNK = 500
  for (let i = 0; i < fingerprints.length; i += CHUNK) {
    const slice = fingerprints.slice(i, i + CHUNK)
    const { data: itemRows, error: ie } = await supabase
      .from('items')
      .select('item_id, sku, cost_price, fingerprint')
      .in('fingerprint', slice)
    if (ie) throw new Error('Could not look up items: ' + ie.message)
    for (const it of (itemRows as ItemRow[]) || []) {
      if (!it.fingerprint) continue
      if (!itemsByFp.has(it.fingerprint)) itemsByFp.set(it.fingerprint, [])
      itemsByFp.get(it.fingerprint)!.push({
        item_id: it.item_id,
        sku: it.sku,
        cost_price: it.cost_price,
      })
    }
  }
  return itemsByFp
}

export async function classifySession(sessionId: string): Promise<void> {
  const { data: stagingRows, error: se } = await supabase
    .from('import_staging')
    .select('*')
    .eq('session_id', sessionId)
  if (se) throw new Error('Could not load staging rows: ' + se.message)
  if (!stagingRows || stagingRows.length === 0) return

  const fingerprints = Array.from(
    new Set(
      (stagingRows as StagingRow[])
        .map((r) => r.fingerprint)
        .filter(Boolean) as string[]
    )
  )

  const itemsByFp = await fetchMatchesForFingerprints(fingerprints)

  type Update = {
    staging_id: number
    resolved_action: StagingAction
    matched_item_id: number | null
    conflict_reason: string | null
  }
  const updates: Update[] = []

  for (const r of stagingRows as StagingRow[]) {
    const matches = r.fingerprint ? itemsByFp.get(r.fingerprint) || [] : []
    const { action, matched_item_id, conflict_reason } = classifyOne(r, matches)
    updates.push({
      staging_id: r.staging_id,
      resolved_action: action,
      matched_item_id,
      conflict_reason,
    })
  }

  const CHUNK = 100
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK)
    await Promise.all(
      slice.map((u) =>
        supabase
          .from('import_staging')
          .update({
            resolved_action: u.resolved_action,
            matched_item_id: u.matched_item_id,
            conflict_reason: u.conflict_reason,
          })
          .eq('staging_id', u.staging_id)
          .then(({ error }) => {
            if (error) throw new Error('Update failed: ' + error.message)
          })
      )
    )
  }
}

// Classify a single row after edit/action
export async function reclassifyRow(stagingId: number): Promise<void> {
  const { data, error } = await supabase
    .from('import_staging')
    .select('*')
    .eq('staging_id', stagingId)
  if (error) throw new Error('Row load failed: ' + error.message)
  if (!data || data.length === 0) return
  const r = data[0] as StagingRow

  // Recompute fingerprint from current fields
  const fingerprint =
    r.brand_code && r.part_code
      ? buildFingerprint({
          brandCode: r.brand_code,
          modelName: r.model_name,
          partCode: r.part_code,
          quality: (r.quality || 'Normal') as Quality,
          color: r.color,
          variant: r.variant,
          flag: r.flag,
          network: r.network,
          year: r.year,
        })
      : null

  const fps = fingerprint ? [fingerprint] : []
  const itemsByFp = await fetchMatchesForFingerprints(fps)
  const matches = fingerprint ? itemsByFp.get(fingerprint) || [] : []

  const updated = { ...r, fingerprint }
  const { action, matched_item_id, conflict_reason } = classifyOne(updated, matches)

  const { error: ue } = await supabase
    .from('import_staging')
    .update({
      fingerprint,
      resolved_action: action,
      matched_item_id,
      conflict_reason,
    })
    .eq('staging_id', stagingId)
  if (ue) throw new Error('Reclassify failed: ' + ue.message)
}

// ----- Actions -----

export async function skipRow(stagingId: number): Promise<void> {
  const { error } = await supabase
    .from('import_staging')
    .delete()
    .eq('staging_id', stagingId)
  if (error) throw new Error('Skip failed: ' + error.message)
}

export async function useOldPrice(stagingId: number): Promise<void> {
  const { data, error } = await supabase
    .from('import_staging')
    .select('*')
    .eq('staging_id', stagingId)
  if (error) throw new Error('Row load failed: ' + error.message)
  if (!data || data.length === 0) throw new Error('Row not found')
  const r = data[0] as StagingRow
  if (!r.matched_item_id) throw new Error('No matched item')

  const { data: itemRows } = await supabase
    .from('items')
    .select('cost_price')
    .eq('item_id', r.matched_item_id)
  const oldCost = itemRows?.[0]?.cost_price
  if (oldCost == null) throw new Error('Old cost not available')

  const { error: ue } = await supabase
    .from('import_staging')
    .update({ rate: oldCost })
    .eq('staging_id', stagingId)
  if (ue) throw new Error('Update failed: ' + ue.message)
  await reclassifyRow(stagingId)
}

export async function keepOldSku(stagingId: number): Promise<void> {
  const { data, error } = await supabase
    .from('import_staging')
    .select('*')
    .eq('staging_id', stagingId)
  if (error) throw new Error('Row load failed: ' + error.message)
  if (!data || data.length === 0) throw new Error('Row not found')
  const r = data[0] as StagingRow
  if (!r.matched_item_id) throw new Error('No matched item')

  const { data: itemRows } = await supabase
    .from('items')
    .select('sku')
    .eq('item_id', r.matched_item_id)
  const oldSku = itemRows?.[0]?.sku
  if (!oldSku) throw new Error('Old SKU not available')

  const { error: ue } = await supabase
    .from('import_staging')
    .update({ generated_sku: oldSku })
    .eq('staging_id', stagingId)
  if (ue) throw new Error('Update failed: ' + ue.message)
  await reclassifyRow(stagingId)
}

export async function renameOldItem(stagingId: number): Promise<void> {
  // ⚠ Destructive — rewrites history. Caller must confirm.
  const { data, error } = await supabase
    .from('import_staging')
    .select('*')
    .eq('staging_id', stagingId)
  if (error) throw new Error('Row load failed: ' + error.message)
  if (!data || data.length === 0) throw new Error('Row not found')
  const r = data[0] as StagingRow
  if (!r.matched_item_id) throw new Error('No matched item')
  if (!r.generated_sku) throw new Error('No SKU on staging row')

  const { error: ue } = await supabase
    .from('items')
    .update({ sku: r.generated_sku, fingerprint: r.fingerprint })
    .eq('item_id', r.matched_item_id)
  if (ue) throw new Error('Rename failed: ' + ue.message)

  await reclassifyRow(stagingId)
}

export async function treatReturnAsPurchase(stagingId: number): Promise<void> {
  const { data, error } = await supabase
    .from('import_staging')
    .select('*')
    .eq('staging_id', stagingId)
  if (error) throw new Error('Row load failed: ' + error.message)
  if (!data || data.length === 0) throw new Error('Row not found')
  const r = data[0] as StagingRow

  const { error: ue } = await supabase
    .from('import_staging')
    .update({
      qty: Math.abs(r.qty || 0),
      rate: Math.abs(r.rate || 0),
    })
    .eq('staging_id', stagingId)
  if (ue) throw new Error('Update failed: ' + ue.message)
  await reclassifyRow(stagingId)
}

export type StagingPatch = {
  brand_code?: string | null
  model_name?: string | null
  part_code?: string | null
  quality?: string | null
  color?: string | null
  variant?: string | null
  flag?: string | null
  network?: string | null
  year?: string | null
  qty?: number
  rate?: number
  generated_sku?: string | null
}

export async function updateStagingRow(
  stagingId: number,
  patch: StagingPatch
): Promise<void> {
  const { error } = await supabase
    .from('import_staging')
    .update(patch)
    .eq('staging_id', stagingId)
  if (error) throw new Error('Update failed: ' + error.message)
  await reclassifyRow(stagingId)
}

// ----- Read / promote / discard -----

export async function loadSession(sessionId: string): Promise<StagingRow[]> {
  const { data, error } = await supabase
    .from('import_staging')
    .select('*')
    .eq('session_id', sessionId)
    .order('row_num', { ascending: true })
  if (error) throw new Error('Could not load session: ' + error.message)
  return (data as StagingRow[]) || []
}

export async function listSessions(): Promise<StagingSession[]> {
  const { data, error } = await supabase
    .from('import_staging')
    .select('session_id, created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error('Could not list sessions: ' + error.message)

  const bySession = new Map<
    string,
    { count: number; first: string; last: string }
  >()
  for (const r of (data as { session_id: string; created_at: string }[]) || []) {
    const cur = bySession.get(r.session_id)
    if (!cur) {
      bySession.set(r.session_id, {
        count: 1,
        first: r.created_at,
        last: r.created_at,
      })
    } else {
      cur.count += 1
      if (r.created_at < cur.first) cur.first = r.created_at
      if (r.created_at > cur.last) cur.last = r.created_at
    }
  }

  return Array.from(bySession.entries())
    .map(([session_id, s]) => ({
      session_id,
      row_count: s.count,
      first_created: s.first,
      last_created: s.last,
    }))
    .sort((a, b) => (a.last_created < b.last_created ? 1 : -1))
}

export async function discardSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('import_staging')
    .delete()
    .eq('session_id', sessionId)
  if (error) throw new Error('Could not discard session: ' + error.message)
}

export async function promoteSession(
  sessionId: string,
  partyId: number,
  invoiceNo: string,
  purchaseDate: string,
  freight: number,
  cashPaid: number
): Promise<number> {
  const rows = await loadSession(sessionId)
  const promotable = rows.filter(
    (r) =>
      r.resolved_action === 'match' ||
      r.resolved_action === 'new' ||
      r.resolved_action === 'new_partial'
  )
  if (promotable.length === 0) {
    throw new Error('No rows ready to promote')
  }

  const payloadLines = promotable.map((r) => {
    const qty = r.qty || 0
    const rate = r.rate || 0
    return {
      sku: r.generated_sku,
      brand_code: r.brand_code,
      model_name: r.model_name,
      part_code: r.part_code,
      network: r.network,
      flag: r.flag,
      year: r.year,
      quality: r.quality,
      variant: r.variant,
      color: r.color,
      quantity: qty,
      rate: rate,
      invoice_rate: rate,
      amount: Number((rate * qty).toFixed(2)),
      is_general_item: false,
      category_code: null,
    }
  })

  const { data, error } = await supabase.rpc('save_purchase_full', {
    p_party_id: partyId,
    p_invoice_no: invoiceNo,
    p_purchase_date: purchaseDate,
    p_freight: freight,
    p_cash_paid: cashPaid,
    p_items: payloadLines,
  })
  if (error) throw new Error('Promote failed: ' + error.message)
  const purchaseId = Number(data)

  await discardSession(sessionId)

  return purchaseId
}