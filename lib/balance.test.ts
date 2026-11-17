(() => {
  const test = require('node:test')
  const assert = require('node:assert/strict')
  const { computeExpectedCustomerBalance, isCounterSaleParty } = require('./balance.ts')

  test('counter sale party always computes to zero balance', () => {
    const value = computeExpectedCustomerBalance({
      sales: [{ total_amount: 1200, paid_amount: 0 }],
      returns: [],
      partyName: 'Counter Sale',
      partyId: 3,
    })
    assert.equal(value, 0)
    assert.equal(isCounterSaleParty('Counter Sale', 3), true)
  })

  test('customer balance reflects unpaid sales minus returns', () => {
    const value = computeExpectedCustomerBalance({
      sales: [
        { total_amount: 1500, paid_amount: 600 },
        { total_amount: 800, paid_amount: 800 },
      ],
      returns: [{ total_amount: 200 }],
      partyName: 'Ravi',
      partyId: 7,
    })
    assert.equal(value, 700)
  })
})()
