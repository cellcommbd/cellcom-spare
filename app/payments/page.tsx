'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { Save, X, Trash2 } from 'lucide-react'

// ---------- Types ----------
type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
}

type Payment = {
  payment_id: number
  party_id: number
  payment_date: string
  amount: number
  payment_mode: string
}

type SaleRow = {
  sale_id: number
  party_id: number
  bill_date: string
  total_amount: number
  status: string
}

type PickedShop = {
  id: number | null
  label: string
  isNew: boolean
}

const MODES = ['Cash', 'UPI']

// ---------- Component ----------
export default function PaymentsPage() {
  const [shops, setShops] = useState<Party[]>([])
  const [todayPayments, setTodayPayments] = useState<Payment[]>([])
  const [selectedShopSales, setSelectedShopSales] = useState<SaleRow[]>([])

  const [pickedShop, setPickedShop] = useState<PickedShop>({
    id: null,
    label: '',
    isNew: false,
  })
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10)
  )
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('Cash')

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState('')

  const amountRef = useRef<HTMLInputElement>(null)

  // ---------- Load ----------
  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (pickedShop.id) loadShopSales(pickedShop.id)
    else setSelectedShopSales([])
  }, [pickedShop.id])

  async function loadData() {
    const today = new Date().toISOString().slice(0, 10)
    const [s, p] = await Promise.all([
      supabase
        .from('parties')
        .select('*')
        .eq('party_type', 'Customer')
        .order('party_name'),
      supabase
        .from('payments')
        .select('*')
        .eq('payment_date', today)
        .order('payment_id', { ascending: false }),
    ])
    setShops(s.data || [])
    setTodayPayments(p.data || [])
  }

  async function loadShopSales(shopId: number) {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('sales')
      .select('*')
      .eq('party_id', shopId)
      .eq('bill_date', today)
      .order('sale_id', { ascending: true })
    setSelectedShopSales(data || [])
  }

  // ---------- Options ----------
  const shopOptions = shops.map((s) => ({
    value: s.party_id,
    label: s.party_name,
  }))

  const currentBalance =
    shops.find((s) => s.party_id === pickedShop.id)?.current_balance || 0

  // ---------- Today's sales totals ----------
  const todaySalesTotal = selectedShopSales.reduce(
    (s, x) => s + Number(x.total_amount),
    0
  )
  const todayPaidTotal = selectedShopSales
    .filter((x) => x.status === 'Paid')
    .reduce((s, x) => s + Number(x.total_amount), 0)
  const todayPendingTotal = selectedShopSales
    .filter((x) => x.status !== 'Paid')
    .reduce((s, x) => s + Number(x.total_amount), 0)

  // ---------- Shops sorted by balance (for "no shop selected" view) ----------
  const shopsByBalance = [...shops].sort(
    (a, b) => Number(b.current_balance) - Number(a.current_balance)
  )
  const totalOutstanding = shops.reduce(
    (s, x) => s + Number(x.current_balance),
    0
  )

  // ---------- Warning ----------
  useEffect(() => {
    const amt = parseFloat(amount) || 0
    if (amt === 0) {
      setWarning('')
      return
    }
    if (amt > currentBalance && pickedShop.id) {
      const diff = amt - currentBalance
      setWarning(
        `Amount exceeds balance by ₹${diff.toFixed(2)}. This will create a credit balance for the shop.`
      )
    } else {
      setWarning('')
    }
  }, [amount, currentBalance, pickedShop.id])

  // ---------- Save ----------
  async function savePayment() {
    setMessage('')
    setWarning('')

    if (!pickedShop.id) {
      setMessage('Please select a shop.')
      return
    }

    const amt = parseFloat(amount)
    if (!amt || amt <= 0) {
      setMessage('Amount must be greater than zero.')
      return
    }

    setSaving(true)

    const { data: paymentData, error: paymentErr } = await supabase
      .from('payments')
      .insert({
        party_id: pickedShop.id,
        payment_date: paymentDate,
        amount: amt,
        payment_mode: mode,
      })
      .select()
      .single()

    if (paymentErr || !paymentData) {
      setMessage('Save error: ' + (paymentErr?.message || 'unknown'))
      setSaving(false)
      return
    }

    const newBalance = currentBalance - amt
    await supabase
      .from('parties')
      .update({ current_balance: newBalance })
      .eq('party_id', pickedShop.id)

    await applyFIFO(pickedShop.id, amt)

    setMessage(
      `Saved ₹${amt.toFixed(2)} from ${pickedShop.label}. New balance: ₹${newBalance.toFixed(2)}.`
    )

    const shopIdForRefresh = pickedShop.id
    resetForm()
    await loadData()
    await loadShopSales(shopIdForRefresh)
    setSaving(false)
  }

  // ---------- FIFO ----------
  async function applyFIFO(shopId: number, paymentAmount: number) {
    let remaining = paymentAmount

    const { data: pendingSales } = await supabase
      .from('sales')
      .select('*')
      .eq('party_id', shopId)
      .in('status', ['Pending', 'Partially Paid'])
      .order('bill_date', { ascending: true })
      .order('sale_id', { ascending: true })

    if (!pendingSales || pendingSales.length === 0) return

    for (const sale of pendingSales) {
      if (remaining <= 0) break

      if (remaining >= sale.total_amount) {
        remaining -= sale.total_amount
        await supabase
          .from('sales')
          .update({ status: 'Paid' })
          .eq('sale_id', sale.sale_id)
      } else {
        await supabase
          .from('sales')
          .update({ status: 'Partially Paid' })
          .eq('sale_id', sale.sale_id)
        remaining = 0
      }
    }
  }

  function resetForm() {
    setPickedShop({ id: null, label: '', isNew: false })
    setAmount('')
    setMode('Cash')
    setPaymentDate(new Date().toISOString().slice(0, 10))
    setWarning('')
    setMessage('')
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[data-row-item="payment-shop"]'
      )
      el?.focus()
    }, 100)
  }

  async function deletePayment(id: number) {
    if (!confirm(`Delete payment #${id}? Shop balance will increase back.`))
      return

    const p = todayPayments.find((x) => x.payment_id === id)
    if (!p) return

    const shop = shops.find((s) => s.party_id === p.party_id)
    if (shop) {
      await supabase
        .from('parties')
        .update({ current_balance: shop.current_balance + p.amount })
        .eq('party_id', p.party_id)
    }

    const { error } = await supabase
      .from('payments')
      .delete()
      .eq('payment_id', id)

    if (error) setMessage('Delete error: ' + error.message)
    else {
      setMessage('Deleted payment #' + id)
      await loadData()
    }
  }

  const shopName = (id: number) =>
    shops.find((s) => s.party_id === id)?.party_name || '—'

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">

        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Payments / Khata</h1>
            <p className="text-sm text-gray-500">
              Record cash/UPI received. Oldest bills are cleared first (FIFO).
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Payment Date
            </label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="bg-white border border-gray-300 rounded p-6 mb-6 shadow-sm">

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Shop
              </label>
              <SmartCombobox
                options={shopOptions}
                value={
                  pickedShop.id
                    ? String(pickedShop.id)
                    : pickedShop.isNew
                    ? `__new__${pickedShop.label}`
                    : null
                }
                onValueChange={(v, label, isNew) => {
                  setPickedShop({
                    id: isNew ? null : Number(v),
                    label,
                    isNew,
                  })
                  setTimeout(() => amountRef.current?.focus(), 50)
                }}
                placeholder="Select or type shop..."
                inputDataAttr="payment-shop"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Current Balance
              </label>
              <div className="w-full h-9 px-3 flex items-center text-sm font-medium bg-red-50 border border-red-200 rounded text-red-700">
                ₹ {Number(currentBalance).toFixed(2)}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount Received
              </label>
              <input
                ref={amountRef}
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') savePayment()
                }}
                placeholder="0.00"
                className="w-full h-9 px-3 text-sm text-right border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mode
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full h-9 px-3 text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {pickedShop.id && (
            <div className="bg-blue-50 border border-blue-200 rounded px-4 py-3 mb-4 text-sm">
              <div className="flex justify-between mb-1">
                <span className="text-gray-700">Current Balance:</span>
                <span className="font-medium text-red-700">
                  ₹ {Number(currentBalance).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between mb-1">
                <span className="text-gray-700">Payment:</span>
                <span className="font-medium text-green-700">
                  − ₹ {(parseFloat(amount) || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between border-t border-blue-300 pt-1 mt-1">
                <span className="font-semibold text-gray-800">New Balance:</span>
                <span className="font-bold text-gray-900">
                  ₹ {(currentBalance - (parseFloat(amount) || 0)).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {warning && (
            <div className="bg-yellow-50 border border-yellow-300 rounded px-4 py-2 mb-4 text-sm text-yellow-900">
              ⚠️ {warning}
            </div>
          )}

          <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={savePayment}
              disabled={saving}
              className="h-10 px-6 text-sm font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Save className="size-4" />
              {saving ? 'Saving...' : 'Save Payment'}
            </button>
            <button
              onClick={resetForm}
              className="h-10 px-4 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-2"
            >
              <X className="size-4" />
              Clear
            </button>
            {message && <div className="text-sm text-gray-700">{message}</div>}
          </div>
        </div>

        {/* ---------- CONDITIONAL PANEL ---------- */}
        {!pickedShop.id ? (
          /* NO SHOP SELECTED → Show shops with balances */
          <div className="bg-white border border-gray-300 rounded shadow-sm mb-6">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-300 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                Shop Balances (Khata)
              </span>
              <span className="text-xs text-gray-500">
                {shopsByBalance.length} shop{shopsByBalance.length !== 1 ? 's' : ''}
              </span>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Shop</th>
                  <th className="w-40 border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Balance</th>
                </tr>
              </thead>
              <tbody>
                {shopsByBalance.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-center text-sm text-gray-400">
                      No shops added yet.
                    </td>
                  </tr>
                ) : (
                  shopsByBalance.map((s) => (
                    <tr key={s.party_id} className="hover:bg-gray-50">
                      <td className="border-b border-gray-200 px-3 py-2 text-gray-800">
                        {s.party_name}
                      </td>
                      <td
                        className={`border-b border-gray-200 px-3 py-2 text-right font-medium ${
                          Number(s.current_balance) > 0
                            ? 'text-red-700'
                            : Number(s.current_balance) < 0
                            ? 'text-green-700'
                            : 'text-gray-500'
                        }`}
                      >
                        ₹ {Number(s.current_balance).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {shopsByBalance.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50">
                    <td className="px-3 py-2 text-sm font-semibold text-gray-700">
                      Total Outstanding
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-gray-900">
                      ₹ {totalOutstanding.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          /* SHOP SELECTED → Show today's sales for this shop */
          <div className="bg-white border border-gray-300 rounded shadow-sm mb-6">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-300 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                Today's Sales — {pickedShop.label}
              </span>
              <span className="text-xs text-gray-500">
                {selectedShopSales.length} bill{selectedShopSales.length !== 1 ? 's' : ''}
              </span>
            </div>

            {selectedShopSales.length === 0 ? (
              <div className="px-4 py-4 text-center text-sm text-gray-400">
                No sales today for this shop.
              </div>
            ) : (
              <>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="w-16 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Bill #</th>
                      <th className="w-28 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Date</th>
                      <th className="w-28 border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Amount</th>
                      <th className="w-32 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedShopSales.map((s) => (
                      <tr key={s.sale_id} className="hover:bg-gray-50">
                        <td className="border-b border-gray-200 px-3 py-2 text-gray-600">{s.sale_id}</td>
                        <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{s.bill_date}</td>
                        <td className="border-b border-gray-200 px-3 py-2 text-right font-medium text-gray-800">
                          ₹ {Number(s.total_amount).toFixed(2)}
                        </td>
                        <td className="border-b border-gray-200 px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              s.status === 'Paid'
                                ? 'bg-green-100 text-green-800'
                                : s.status === 'Partially Paid'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-6 text-sm">
                  <span>
                    <span className="text-gray-500">Total: </span>
                    <span className="font-medium text-gray-800">
                      ₹ {todaySalesTotal.toFixed(2)}
                    </span>
                  </span>
                  <span>
                    <span className="text-gray-500">Paid: </span>
                    <span className="font-medium text-green-700">
                      ₹ {todayPaidTotal.toFixed(2)}
                    </span>
                  </span>
                  <span>
                    <span className="text-gray-500">Pending: </span>
                    <span className="font-medium text-red-700">
                      ₹ {todayPendingTotal.toFixed(2)}
                    </span>
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* TODAY'S PAYMENTS */}
        <div className="bg-white border border-gray-300 rounded shadow-sm">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-300">
            <span className="text-sm font-semibold text-gray-700">
              Today's Payments ({todayPayments.length})
            </span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="w-16 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">ID</th>
                <th className="border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Shop</th>
                <th className="w-20 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Mode</th>
                <th className="w-32 border-b border-gray-300 px-3 py-2 text-right text-xs font-semibold text-gray-600">Amount</th>
                <th className="w-20 border-b border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {todayPayments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-gray-400">
                    No payments today yet.
                  </td>
                </tr>
              ) : (
                todayPayments.map((p) => (
                  <tr key={p.payment_id} className="hover:bg-gray-50">
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-600">{p.payment_id}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{shopName(p.party_id)}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-gray-800">{p.payment_mode}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-right font-medium text-gray-800">
                      ₹ {Number(p.amount).toFixed(2)}
                    </td>
                    <td className="border-b border-gray-200 px-3 py-2">
                      <button
                        onClick={() => deletePayment(p.payment_id)}
                        className="text-xs font-medium text-red-600 hover:text-red-800 flex items-center gap-1"
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}