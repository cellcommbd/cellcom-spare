// lib/item-search.ts
// Thin wrapper around the `search_items` RPC.
// Searches across SKU, brand, model, part code, part name, quality, variant, color.

import { supabase } from './supabase'

export type SearchItemResult = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number | null
  selling_price: number | null
  quality: string | null
  variant: string | null
  brand_id?: number | null
}

export async function searchItems(query: string): Promise<SearchItemResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  try {
    const { data, error } = await supabase.rpc('search_items', {
      p_query: trimmed,
    })

    if (error) {
      // Soft-fail: network blip, special char, transient PostgREST issue.
      // Return empty so callers don't get an unhandled rejection.
      console.warn('search_items RPC error:', error.message)
      return []
    }

    return (data as SearchItemResult[]) || []
  } catch (err) {
    // supabase-js can throw on network failure (fetch rejects).
    console.warn('search_items failed:', err instanceof Error ? err.message : err)
    return []
  }
}