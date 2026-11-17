(() => {
  const test = require('node:test')
  const assert = require('node:assert/strict')
  const {
    computeSaleStatus,
    normalizeAmount,
    computeDueAmount,
  } = require('./sale-status.js')

  test('marks fully paid bills as Paid', () => {
    assert.equal(computeSaleStatus(500, 500), 'Paid')
  })

  test('marks partial payments as Partially Paid', () => {
    assert.equal(computeSaleStatus(500, 250), 'Partially Paid')
  })

  test('marks zero payment as Pending', () => {
    assert.equal(computeSaleStatus(500, 0), 'Pending')
  })

  test('sanitizes invalid values and clamps overshoot', () => {
    assert.equal(normalizeAmount(undefined), 0)
    assert.equal(normalizeAmount(' 250 '), 250)
    assert.equal(normalizeAmount(-25), 0)
    assert.equal(computeSaleStatus(500, 700), 'Paid')
  })

  test('never leaks negative due amounts', () => {
    assert.equal(computeDueAmount(500, 0), 500)
    assert.equal(computeDueAmount(500, 250), 250)
    assert.equal(computeDueAmount(500, 700), 0)
  })
})()
