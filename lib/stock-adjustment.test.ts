(() => {
  const test = require('node:test')
  const assert = require('node:assert/strict')
  const { getStockAdjustmentPlan } = require('./stock-adjustment.js')

  test('add stock plan adds a positive delta', () => {
    const plan = getStockAdjustmentPlan(12, 18, 'add')
    assert.equal(plan.delta, 18)
    assert.equal(plan.quantity, 18)
    assert.equal(plan.isIncrease, true)
  })

  test('deduct stock plan creates a negative delta', () => {
    const plan = getStockAdjustmentPlan(12, 7, 'deduct')
    assert.equal(plan.delta, 7)
    assert.equal(plan.quantity, 7)
    assert.equal(plan.isIncrease, false)
  })

  test('set stock plan matches exact physical count', () => {
    const plan = getStockAdjustmentPlan(20, 14, 'set')
    assert.equal(plan.delta, 6)
    assert.equal(plan.quantity, 6)
    assert.equal(plan.isIncrease, false)
  })

  test('set stock plan can add missing stock', () => {
    const plan = getStockAdjustmentPlan(20, 27, 'set')
    assert.equal(plan.delta, 7)
    assert.equal(plan.quantity, 7)
    assert.equal(plan.isIncrease, true)
  })
})()
