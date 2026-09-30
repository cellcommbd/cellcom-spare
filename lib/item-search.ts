import { supabase } from './supabase'

export type ItemSearchResult = {
  item_id: number
  sku: string
  current_stock: number
  cost_price: number
  selling_price: number
  quality: string | null
  variant: string | null
}

/**
 * Multi-word, cross-field item search.
 * - Splits query on whitespace
 * - Each token matches SKU OR brand code OR brand name OR model name OR part code
 * - All tokens AND-ed (each additional token narrows results)
 * - Result count capped based on viewport:
 *     10 on mobile (< 768px)
 *     25 on desktop (>= 768px)
 */
export async function searchItems(
  query: string
): Promise<ItemSearchResult[]> {
  const q = (query || '').trim()
  if (q.length < 2) return []

  const isDesktop =
    typeof window !== 'undefined' &&
    window.matchMedia('(min-width: 768px)').matches

  const limit = isDesktop ? 25 : 10

  const { data, error } = await supabase.rpc('search_items', {
    p_query: q,
    p_limit: limit,
  })

  if (error) {
    console.error('search_items error:', error)
    return []
  }

  return (data || []) as ItemSearchResult[]
}