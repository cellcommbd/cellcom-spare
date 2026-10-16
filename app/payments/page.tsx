'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SmartCombobox } from '../../components/ui/smart-combobox'
import { NewPartyDialog } from '../../components/ui/new-party-dialog'
import {
  Save,
  X,
  Trash2,
  Copy,
  Check,
  MessageCircle,
  Phone,
  User,
} from 'lucide-react'
import {
  buildStatementText,
  buildWhatsAppUrl,
  normalizePhoneForWhatsApp,
} from '../../lib/statement-format'

// ---------- Types ----------
type Party = {
  party_id: number
  party_name: string
  party_type: 'Customer' | 'Supplier'
  current_balance: number
  phone: string | null
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

type SaleItem = {
  detail_id: number
  sale_id: number
  item_id: number
  quantity: number
  rate: number
  amount: number
}

type StatementLine = {
  detail_id: number
  sku: string
  quantity: number
  rate: number
  amount: number
}

type PickedShop = {
  id: number | null
  label: string
  isNew: boolean
}

type PayMode = 'Cash' | 'Online'

// ---------- Helpers ----------
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function formatDateLong(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// ---------- Component ----------
export default function PaymentsPage() {
  const [shops, setShops] = useState<Party[]>([])
  const [todayPayments, setTodayPayments] = useState<Payment[]>([])
  const [selectedShopSales, setSelectedShopSales] = useState<SaleRow[]>([])
  const [statementLines, setStatementLines] = useState<StatementLine[]>([])

  const [pickedShop, setPickedShop] = useState<PickedShop>({
    id: null,
    label: '',
    isNew: false,
  })
  const [paymentDate, setPaymentDate] = useState(todayStr())
  const [amount, setAmount] = useState('')
  const [payMode, setPayMode] = useState<PayMode>('Cash')
  const [upiAmount, setUpiAmount] = useState('')

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  const [pendingNewParty, setPendingNewParty] = useState<string | null>(null)

  const [copied, setCopied] = useState(false)
  const [editingPhone, setEditingPhone] = useState(false)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const [phoneMessage, setPhoneMessage] = useState('')

  const amountRef = useRef<HTMLInputElement>(null)
  const upiRef = useRef<HTMLInputElement>(null)

  // ---------- Load ----------
  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (pickedShop.id) {
      loadShopSales(pickedShop.id)
      loadStatementLines(pickedShop.id)
    } else {
      setSelectedShopSales([])
      setStatementLines([])
    }
  }, [pickedShop.id])

  // Mirror amount → upi when in Online mode, unless user has edited upi
  useEffect(() => {
    if (payMode === 'Online' && pickedShop.id) {
      // Only set upiAmount if the user hasn't typed a different value
      const amt = parseFloat(amount) || 0
      const upi = parseFloat(upiAmount) || 0
      if (upi === 0 || upi > amt) {
        setUpiAmount(amount)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, payMode])

  async function loadData() {
    const today = todayStr()
    const [s, p] = await Promise.all([
      supabase
        .from('parties')
        .select('party_id, party_name, party_type, current_balance, phone')
        .eq('party_type', 'Customer')
        .order('party_name'),
      supabase
        .from('payments')
        .select('*')
        .eq('payment_date', today)
        .order('payment_id', { ascending: false }),
    ])
    setShops((s.data as Party[]) || [])
    setTodayPayments((p.data as Payment[]) || [])
  }

  async function loadShopSales(shopId: number) {
    const today = todayStr()
    const { data } = await supabase
      .from('sales')
      .select('*')
      .eq('party_id', shopId)
      .eq('bill_date', today)
      .order('sale_id', { ascending: true })
    setSelectedShopSales((data as SaleRow[]) || [])
  }

  async function loadStatementLines(shopId: number) {
    const today = todayStr()
    const { data: salesData } = await supabase
      .from('sales')
      .select('sale_id')
      .eq('party_id', shopId)
      .eq('bill_date', today)

    const saleIds = ((salesData as any[]) || []).map((s) => s.sale_id)
    if (saleIds.length === 0) {
      setStatementLines([])
      return
    }

    const { data: itemsData } = await supabase
      .from('sale_items')
      .select('detail_id, sale_id, item_id, quantity, rate, amount')
      .in('sale_id', saleIds)

    const itemList = (itemsData as SaleItem[]) || []
    const itemIds = Array.from(new Set(itemList.map((x) => x.item_id)))

    let itemMap: Record<number, string> = {}
    if (itemIds.length > 0) {
      const { data: itemRows } = await supabase
        .from('items')
        .select('item_id, sku')
        .in('item_id', itemIds)
      for (const it of itemRows || []) {
        itemMap[it.item_id] = it.sku
      }
    }

    setStatementLines(
      itemList.map((it) => ({
        detail_id: it.detail_id,
        sku: itemMap[it.item_id] || '(unknown)',
        quantity: Number(it.quantity),
        rate: Number(it.rate),
        amount: Number(it.amount),
      }))
    )
  }

  // ---------- Options ----------
  const shopOptions = shops.map((s) => ({
    value: s.party_id,
    label: s.party_name,
  }))

  const selectedShop = shops.find((s) => s.party_id === pickedShop.id)
  const currentBalance = Number(selectedShop?.current_balance || 0)

  const todaySalesTotal = selectedShopSales.reduce(
    (s, x) => s + Number(x.total_amount),
    0
  )

  // ---------- Shops sorted ----------
  const shopsByBalance = useMemo(
    () =>
      [...shops].sort(
        (a, b) => Number(b.current_balance) - Number(a.current_balance)
      ),
    [shops]
  )
  const totalOutstanding = useMemo(
    () => shops.reduce((s, x) => s + Number(x.current_balance), 0),
    [shops]
  )

  // ---------- Payment split computation ----------
  const paymentAmt = parseFloat(amount) || 0
  const upiAmt = parseFloat(upiAmount) || 0

  const splitUpi = payMode === 'Online' ? Math.min(upiAmt, paymentAmt) : 0
  const splitCash = payMode === 'Online' ? paymentAmt - splitUpi : paymentAmt

  const newBalance = currentBalance - paymentAmt

  // ---------- Save ----------
  async function savePayment() {
    setMessage('')
    setSuccess(false)

    if (!pickedShop.id) {
      setMessage('Please select a shop.')
      return
    }

    if (!paymentAmt || paymentAmt <= 0) {
      setMessage('Amount must be greater than zero.')
      return
    }

    setSaving(true)

    // Build rows to insert
    const rows: {
      party_id: number
      payment_date: string
      amount: number
      payment_mode: string
    }[] = []

    if (payMode === 'Cash' || splitUpi === 0) {
      // All cash
      rows.push({
        party_id: pickedShop.id,
        payment_date: paymentDate,
        amount: paymentAmt,
        payment_mode: 'Cash',
      })
    } else if (splitUpi === paymentAmt) {
      // All UPI
      rows.push({
        party_id: pickedShop.id,
        payment_date: paymentDate,
        amount: paymentAmt,
        payment_mode: 'UPI',
      })
    } else {
      // Split
      rows.push({
        party_id: pickedShop.id,
        payment_date: paymentDate,
        amount: splitUpi,
        payment_mode: 'UPI',
      })
      rows.push({
        party_id: pickedShop.id,
        payment_date: paymentDate,
        amount: splitCash,
        payment_mode: 'Cash',
      })
    }

    const { error: insertErr } = await supabase
      .from('payments')
      .insert(rows)

    if (insertErr) {
      setMessage('Save error: ' + insertErr.message)
      setSaving(false)
      return
    }

    // Update balance
    const { error: balErr } = await supabase
      .from('parties')
      .update({ current_balance: newBalance })
      .eq('party_id', pickedShop.id)

    if (balErr) {
      setMessage('Payment saved but balance update failed: ' + balErr.message)
      setSaving(false)
      return
    }

    // FIFO
    await applyFIFO(pickedShop.id, paymentAmt)

    // Verify
    const { data: verify } = await supabase
      .from('parties')
      .select('current_balance')
      .eq('party_id', pickedShop.id)
      .single()

    if (Number(verify?.current_balance) !== newBalance) {
      setMessage('Warning: balance verification mismatch. Check customer record.')
    } else {
      setMessage(
        `Saved ₹${paymentAmt.toFixed(2)} from ${pickedShop.label}. New balance: ₹${newBalance.toFixed(2)}.`
      )
    }

    setSuccess(true)
    setAmount('')
    setUpiAmount('')
    setPayMode('Cash')

    await loadData()
    await loadShopSales(pickedShop.id)
    await loadStatementLines(pickedShop.id)

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
    setUpiAmount('')
    setPayMode('Cash')
    setPaymentDate(todayStr())
    setMessage('')
    setSuccess(false)
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
        .update({
          current_balance: Number(shop.current_balance) + Number(p.amount),
        })
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

  // ---------- Statement text ----------
  const statementText = useMemo(() => {
    if (!selectedShop) return ''
    const today = todayStr()

    // previous balance = current_balance + today's payments - today's sales
    // (we're showing today as the range, and statement uses current balance as net due)
    // payments shown include the ones in the payments table for today
    const todayPaymentsForShop = todayPayments.filter(
      (p) => p.party_id === pickedShop.id
    )
    const cashPaidToday = todayPaymentsForShop
      .filter((p) => p.payment_mode === 'Cash')
      .reduce((s, p) => s + Number(p.amount), 0)
    const upiPaidToday = todayPaymentsForShop
      .filter((p) => p.payment_mode === 'UPI')
      .reduce((s, p) => s + Number(p.amount), 0)
    const totalPaid = cashPaidToday + upiPaidToday

    // Previous balance = current + paid - purchases (since current = prev + purchases - paid)
    const purchasesTotal = todaySalesTotal
    const previousBalance = currentBalance - purchasesTotal + totalPaid

    return buildStatementText({
      customerName: selectedShop.party_name,
      fromDate: today,
      toDate: today,
      items: statementLines.map((l) => ({
        sku: l.sku,
        quantity: l.quantity,
        rate: l.rate,
        amount: l.amount,
      })),
      purchasesTotal,
      previousBalance,
      cashPaid: cashPaidToday,
      upiPaid: upiPaidToday,
      netDue: currentBalance,
    })
  }, [
    selectedShop,
    todayPayments,
    pickedShop.id,
    todaySalesTotal,
    currentBalance,
    statementLines,
  ])

  async function copyToClipboard() {
    if (!statementText) return
    try {
      await navigator.clipboard.writeText(statementText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = statementText
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // ignore
      }
      document.body.removeChild(ta)
    }
  }

  function openWhatsApp() {
    if (!selectedShop || !statementText) return
    const url = buildWhatsAppUrl(selectedShop.phone, statementText)
    if (!url) {
      setPhoneMessage('Add a valid 10-digit mobile number first.')
      setEditingPhone(true)
      setPhoneDraft(selectedShop.phone || '')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function savePhone() {
    if (!selectedShop) return
    setPhoneMessage('')

    const raw = phoneDraft.trim()
    if (!raw) {
      setPhoneMessage('Enter a phone number.')
      return
    }
    const normalized = normalizePhoneForWhatsApp(raw)
    if (!normalized) {
      setPhoneMessage('Invalid number. Enter a 10-digit Indian mobile.')
      return
    }

    const tenDigit = normalized.slice(-10)

    setSavingPhone(true)
    const { error } = await supabase
      .from('parties')
      .update({ phone: tenDigit })
      .eq('party_id', selectedShop.party_id)
    setSavingPhone(false)

    if (error) {
      setPhoneMessage('Could not save: ' + error.message)
      return
    }

    const { data: verify } = await supabase
      .from('parties')
      .select('phone')
      .eq('party_id', selectedShop.party_id)
      .single()

    if (verify?.phone !== tenDigit) {
      setPhoneMessage('Save did not persist. Try again.')
      return
    }

    setShops((prev) =>
      prev.map((c) =>
        c.party_id === selectedShop.party_id ? { ...c, phone: tenDigit } : c
      )
    )
    setEditingPhone(false)
    setPhoneDraft('')
    setPhoneMessage('')
  }

  function handleNewPartyCreated(party: {
    party_id: number
    party_name: string
    party_type: 'Customer' | 'Supplier'
    current_balance: number
    phone: string | null
    purchase_prefix: string | null
  }) {
    setShops((prev) =>
      [...prev, party as Party].sort((a, b) =>
        a.party_name.localeCompare(b.party_name)
      )
    )
    setPickedShop({
      id: party.party_id,
      label: party.party_name,
      isNew: false,
    })
    setPendingNewParty(null)
    setTimeout(() => amountRef.current?.focus(), 200)
  }

  // ============ RENDER ============
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Payments
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Record money received. Oldest bills cleared first.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Date
            </label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="h-11 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
        </div>

        {/* Entry card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm mb-5 space-y-4">

          {/* Shop picker */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
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
                if (isNew) {
                  setPendingNewParty(label)
                  return
                }
                setPickedShop({ id: Number(v), label, isNew: false })
                setMessage('')
                setSuccess(false)
                setTimeout(() => amountRef.current?.focus(), 100)
              }}
              placeholder="Select or type shop..."
              inputDataAttr="payment-shop"
              fallbackLabel={pickedShop.label || null}
            />
          </div>

          {/* Balance display */}
          {pickedShop.id && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-slate-600">Current Balance</span>
              <span
                className={`text-sm font-bold ${
                  currentBalance > 0 ? 'text-red-700' : 'text-slate-500'
                }`}
              >
                ₹ {currentBalance.toFixed(2)}
              </span>
            </div>
          )}

          {/* Amount */}
          {pickedShop.id && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Amount Received
                </label>
                <input
                  ref={amountRef}
                  type="number"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') savePayment()
                  }}
                  placeholder="0"
                  className="w-full h-12 px-3 text-lg text-right font-semibold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Mode toggle */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMode('Cash')}
                    className={`h-11 text-sm font-semibold rounded-lg border-2 transition-colors ${
                      payMode === 'Cash'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-400'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPayMode('Online')
                      setTimeout(() => upiRef.current?.focus(), 50)
                    }}
                    className={`h-11 text-sm font-semibold rounded-lg border-2 transition-colors ${
                      payMode === 'Online'
                        ? 'bg-blue-50 text-blue-800 border-blue-400'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Online
                  </button>
                </div>
              </div>

              {/* UPI field (only Online mode) */}
              {payMode === 'Online' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    UPI Amount
                    <span className="text-slate-400 ml-1">
                      (rest will be recorded as Cash)
                    </span>
                  </label>
                  <input
                    ref={upiRef}
                    type="number"
                    inputMode="numeric"
                    value={upiAmount}
                    onChange={(e) => setUpiAmount(e.target.value)}
                    placeholder="0"
                    className="w-full h-12 px-3 text-lg text-right font-semibold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {paymentAmt > 0 && (
                    <div className="mt-2 text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex justify-between">
                      <span className="text-slate-700">
                        UPI ₹{splitUpi.toFixed(2)} · Cash ₹
                        {splitCash.toFixed(2)}
                      </span>
                      <span className="font-semibold text-slate-900">
                        Total ₹{paymentAmt.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Preview new balance */}
              {paymentAmt > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-600">Balance now</span>
                    <span className="font-medium text-red-700">
                      ₹ {currentBalance.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-600">Payment</span>
                    <span className="font-medium text-emerald-700">
                      − ₹ {paymentAmt.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-blue-300 pt-1 mt-1">
                    <span className="font-semibold text-slate-800">
                      New Balance
                    </span>
                    <span className="font-bold text-slate-900">
                      ₹ {newBalance.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Save button */}
          <div className="flex gap-2 pt-2 border-t border-slate-200">
            <button
              onClick={savePayment}
              disabled={saving || !pickedShop.id}
              className="flex-1 h-12 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              <Save className="size-4" />
              {saving ? 'Saving...' : 'Save Payment'}
            </button>
            <button
              onClick={resetForm}
              className="h-12 px-4 text-sm text-slate-700 border border-slate-300 rounded-xl hover:bg-slate-50 flex items-center justify-center"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Message */}
          {message && (
            <div
              className={`text-sm rounded-lg p-3 ${
                success
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {message}
            </div>
          )}
        </div>

        {/* Today's sales for selected shop */}
        {pickedShop.id && selectedShopSales.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-5">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-700">
                Today's Bills — {pickedShop.label}
              </span>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Bill #</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Date</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedShopSales.map((s) => (
                  <tr key={s.sale_id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-2 text-slate-600">{s.sale_id}</td>
                    <td className="px-3 py-2 text-slate-800">{s.bill_date}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-800">
                      ₹ {Number(s.total_amount).toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.status === 'Paid'
                            ? 'bg-emerald-100 text-emerald-800'
                            : s.status === 'Partially Paid'
                            ? 'bg-amber-100 text-amber-800'
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
          </div>
        )}

        {/* Statement after save (or when shop picked) */}
        {pickedShop.id && success && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mb-5 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                Statement for {pickedShop.label}
              </span>
              {selectedShop?.phone ? (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {selectedShop.phone}
                </span>
              ) : (
                <button
                  onClick={() => {
                    setEditingPhone(true)
                    setPhoneDraft('')
                  }}
                  className="text-xs text-amber-700 hover:text-amber-900 flex items-center gap-1 underline"
                >
                  <Phone className="w-3 h-3" />
                  Add phone
                </button>
              )}
            </div>

            {editingPhone && (
              <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="tel"
                    value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value)}
                    placeholder="10-digit mobile"
                    className="flex-1 h-9 px-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') savePhone()
                    }}
                  />
                  <button
                    onClick={savePhone}
                    disabled={savingPhone}
                    className="h-9 px-3 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 rounded"
                  >
                    {savingPhone ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setEditingPhone(false)
                      setPhoneMessage('')
                    }}
                    className="h-9 px-3 text-xs font-medium bg-slate-200 hover:bg-slate-300 rounded"
                  >
                    Cancel
                  </button>
                </div>
                {phoneMessage && (
                  <div className="text-xs text-amber-800">{phoneMessage}</div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 p-4">
              <button
                onClick={copyToClipboard}
                className="h-12 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 flex items-center justify-center gap-2"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy
                  </>
                )}
              </button>
              <button
                onClick={openWhatsApp}
                className="h-12 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp
              </button>
            </div>

            <pre className="px-4 pb-4 text-xs whitespace-pre-wrap font-mono text-slate-700 max-h-64 overflow-y-auto bg-slate-50 border-t border-slate-200 pt-3">
              {statementText}
            </pre>
          </div>
        )}

        {/* Shop balances (when no shop picked) */}
        {!pickedShop.id && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mb-5 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                Shop Balances (Khata)
              </span>
              <span className="text-xs text-slate-500">
                {shopsByBalance.length} shops
              </span>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Shop</th>
                  <th className="w-32 px-3 py-2 text-right text-xs font-semibold text-slate-600">Balance</th>
                </tr>
              </thead>
              <tbody>
                {shopsByBalance.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-center text-sm text-slate-400">
                      No shops added yet.
                    </td>
                  </tr>
                ) : (
                  shopsByBalance.map((s) => (
                    <tr
                      key={s.party_id}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer"
                      onClick={() => {
                        setPickedShop({
                          id: s.party_id,
                          label: s.party_name,
                          isNew: false,
                        })
                      }}
                    >
                      <td className="px-3 py-2.5 text-slate-800">
                        {s.party_name}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-medium ${
                          Number(s.current_balance) > 0
                            ? 'text-red-700'
                            : Number(s.current_balance) < 0
                            ? 'text-emerald-700'
                            : 'text-slate-500'
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
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td className="px-3 py-2 text-sm font-semibold text-slate-700">
                      Total Outstanding
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">
                      ₹ {totalOutstanding.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* Today's payments */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <span className="text-sm font-semibold text-slate-700">
              Today's Payments ({todayPayments.length})
            </span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="w-16 px-3 py-2 text-left text-xs font-semibold text-slate-600">ID</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Shop</th>
                <th className="w-20 px-3 py-2 text-left text-xs font-semibold text-slate-600">Mode</th>
                <th className="w-28 px-3 py-2 text-right text-xs font-semibold text-slate-600">Amount</th>
                <th className="w-16 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {todayPayments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-slate-400">
                    No payments today yet.
                  </td>
                </tr>
              ) : (
                todayPayments.map((p) => (
                  <tr key={p.payment_id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-2 text-slate-500 text-xs">{p.payment_id}</td>
                    <td className="px-3 py-2 text-slate-800">{shopName(p.party_id)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          p.payment_mode === 'UPI'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {p.payment_mode}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-slate-800">
                      ₹ {Number(p.amount).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => deletePayment(p.payment_id)}
                        className="text-slate-400 hover:text-red-600 p-1"
                        aria-label="Delete"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <NewPartyDialog
        open={pendingNewParty !== null}
        initialName={pendingNewParty || ''}
        partyType="Customer"
        onClose={() => setPendingNewParty(null)}
        onCreated={handleNewPartyCreated}
      />
    </div>
  )
}