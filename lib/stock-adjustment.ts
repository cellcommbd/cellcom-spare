export type StockAdjustmentMode = 'add' | 'deduct' | 'set'

export type StockAdjustmentPlan = {
  mode: StockAdjustmentMode
  delta: number
  quantity: number
  isIncrease: boolean
  actionLabel: string
  description: string
}

export function getStockAdjustmentPlan(
  currentStock: number,
  countedQty: number,
  mode: StockAdjustmentMode
): StockAdjustmentPlan {
  if (!Number.isFinite(currentStock) || !Number.isFinite(countedQty)) {
    throw new Error('Stock values must be numeric.')
  }

  if (mode === 'add') {
    const quantity = Math.max(0, Number(countedQty))
    if (quantity <= 0) {
      throw new Error('Add quantity must be greater than 0.')
    }
    return {
      mode,
      delta: quantity,
      quantity,
      isIncrease: true,
      actionLabel: 'Add stock',
      description: `Add ${quantity} units to inventory.`,
    }
  }

  if (mode === 'deduct') {
    const quantity = Math.max(0, Number(countedQty))
    if (quantity <= 0) {
      throw new Error('Deduct quantity must be greater than 0.')
    }
    return {
      mode,
      delta: quantity,
      quantity,
      isIncrease: false,
      actionLabel: 'Deduct stock',
      description: `Reduce stock by ${quantity} units.`,
    }
  }

  const delta = Number(countedQty) - currentStock
  if (delta === 0) {
    return {
      mode: 'set',
      delta: 0,
      quantity: 0,
      isIncrease: false,
      actionLabel: 'No change',
      description: 'Count matches current stock.',
    }
  }

  if (delta > 0) {
    return {
      mode: 'set',
      delta,
      quantity: delta,
      isIncrease: true,
      actionLabel: 'Add to match count',
      description: `Physical count is ${delta} units higher than stock.`,
    }
  }

  return {
    mode: 'set',
    delta: Math.abs(delta),
    quantity: Math.abs(delta),
    isIncrease: false,
    actionLabel: 'Deduct to match count',
    description: `Physical count is ${Math.abs(delta)} units lower than stock.`,
  }
}
