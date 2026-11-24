'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { isOwner } from '@/lib/auth'
import { SmartCombobox } from '@/components/ui/smart-combobox'

type Party = {
  party_id: number
  party_name: string
  phone: string | null
  current_balance: number
}

type Payment = {
  payment_id: number
  party_id: number
  payment_date: string
  amount: number
  payment_mode: string | null
  collection_id: number | null
}

type Sale = {
  sale_id: number
  bill_date: string
  total_amount: number
  paid_amount: number
  status: string
}

type Allocation = {
  id: number
  payment_id: number
  sale_id: number
  amount: number
}

type SaleItem = {
  detail_id: number
  sale_id: number
  item_id: number
  quantity: number
  rate: number
  amount: number
}

type ItemMaster = {
  item_id: number
  sku: string | null
  quality: string | null
  color: string | null
  variant: string | null
  brand_id: number | null
  model_id: number | null
  category_id: number | null
}

type Brand = { brand_id: number; brand_name: string }
type Model = { model_id: number; model_name: string }
type Category = { category_id: number; category_name: string }

type ReturnRow = {
  total_amount: number
  return_type: string | null
}

type Audit = {
  audit_id: number
  action: string
  payment_id: number
  from_sale_id: number | null
  to_sale_id: number
  amount: number
  reason: string | null
  created_at: string
}

type HistoricalMatch = {
  payment_id: number
  payment_date: string
  sale_id: number
  bill_date: string
  amount: number
}

const money = (value: number) =>
  Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

const matchKey = (paymentId: number, saleId: number) =>
  `${paymentId}-${saleId}`

const dateLabel = (value: string) => {
  if (!value) return 'Date unavailable'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
}

const paidAmount = (amount: number) => (
  <span className="line-through text-gray-400">
    ₹{money(amount)}
  </span>
)

export default function ReconciliationPage() {
  const [authorized, setAuthorized] = useState(false)
  const [checkedOwner, setCheckedOwner] = useState(false)

  const [partyOptions, setPartyOptions] = useState<Party[]>([])
  const [partySearchValue, setPartySearchValue] = useState<string | null>(null)
  const [partySearchLoading, setPartySearchLoading] = useState(false)
  const [party, setParty] = useState<Party | null>(null)

  const [payments, setPayments] = useState<Payment[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [itemCatalog, setItemCatalog] = useState<ItemMaster[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [reversedIds, setReversedIds] = useState<number[]>([])
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [history, setHistory] = useState<Audit[]>([])

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [databaseRebuildPreview, setDatabaseRebuildPreview] = useState<any>(null)
  const [lastRebuildId, setLastRebuildId] = useState<string | null>(null)

  const [selectedPaymentId, setSelectedPaymentId] = useState('')
  const [selectedSaleId, setSelectedSaleId] = useState('')
  const [linkAmount, setLinkAmount] = useState('')
  const [linkReason, setLinkReason] = useState('')

  const [selectedHistorical, setSelectedHistorical] =
    useState<Record<string, boolean>>({})

  const [historicalAmounts, setHistoricalAmounts] =
    useState<Record<string, string>>({})

  useEffect(() => {
    setAuthorized(isOwner())
    setCheckedOwner(true)
  }, [])

  async function searchParties(query: string) {
    if (query.trim().length < 2) {
      setPartyOptions([])
      return
    }

    setPartySearchLoading(true)

    const { data, error } = await supabase
      .from('parties')
      .select('party_id, party_name, phone, current_balance')
      .ilike('party_name', `%${query.trim()}%`)
      .order('party_name')
      .limit(30)

    setPartySearchLoading(false)

    if (error) {
      setError(error.message)
      setPartyOptions([])
      return
    }

    setPartyOptions((data || []) as Party[])
  }

  async function loadParty(selected: Party) {
    setLoading(true)
    setError('')
    setMessage('')
    setDatabaseRebuildPreview(null)
    setLastRebuildId(null)
    setParty(selected)
    setSelectedPaymentId('')
    setSelectedSaleId('')
    setLinkAmount('')
    setLinkReason('')
    setSelectedHistorical({})
    setHistoricalAmounts({})

    const [paymentResult, saleResult, returnResult] = await Promise.all([
      supabase
        .from('payments')
        .select('payment_id, party_id, payment_date, amount, payment_mode, collection_id')
        .eq('party_id', selected.party_id)
        .order('payment_date', { ascending: true }),

      supabase
        .from('sales')
        .select('sale_id, bill_date, total_amount, paid_amount, status')
        .eq('party_id', selected.party_id)
        .order('bill_date', { ascending: true }),

      supabase
        .from('returns')
        .select('total_amount, return_type')
        .eq('party_id', selected.party_id)
        .eq('return_type', 'Customer')
    ])

    if (paymentResult.error || saleResult.error || returnResult.error) {
      setError(
        paymentResult.error?.message ||
        saleResult.error?.message ||
        returnResult.error?.message ||
        'Could not load customer records.'
      )
      setLoading(false)
      return
    }

    const paymentRows = (paymentResult.data || []) as Payment[]
    const saleRows = (saleResult.data || []) as Sale[]

    setPayments(paymentRows)
    setSales(saleRows)
    setReturns((returnResult.data || []) as ReturnRow[])

    // Load invoice lines separately so we do not depend on implicit
    // Supabase relationship names. These are read-only queries.
    setSaleItems([])
    setItemCatalog([])
    setBrands([])
    setModels([])
    setCategories([])

    const saleIds = saleRows.map(s => s.sale_id)
    if (saleIds.length > 0) {
      const { data: lineRows, error: lineError } = await supabase
        .from('sale_items')
        .select('detail_id, sale_id, item_id, quantity, rate, amount')
        .in('sale_id', saleIds)

      if (lineError) {
        setError(`Invoice items could not be loaded: ${lineError.message}`)
      } else {
        const lines = (lineRows || []) as SaleItem[]
        setSaleItems(lines)

        const itemIds = [...new Set(lines.map(line => line.item_id))]
        if (itemIds.length > 0) {
          const { data: itemRows, error: itemError } = await supabase
            .from('items')
            .select('item_id, sku, quality, color, variant, brand_id, model_id, category_id')
            .in('item_id', itemIds)

          if (itemError) {
            setError(`Product descriptions could not be loaded: ${itemError.message}`)
          } else {
            const catalog = (itemRows || []) as ItemMaster[]
            setItemCatalog(catalog)

            const brandIds = [...new Set(catalog.map(i => i.brand_id).filter((v): v is number => v !== null))]
            const modelIds = [...new Set(catalog.map(i => i.model_id).filter((v): v is number => v !== null))]
            const categoryIds = [...new Set(catalog.map(i => i.category_id).filter((v): v is number => v !== null))]

            const [brandResult, modelResult, categoryResult] = await Promise.all([
              brandIds.length
                ? supabase.from('brands').select('brand_id, brand_name').in('brand_id', brandIds)
                : Promise.resolve({ data: [], error: null } as any),
              modelIds.length
                ? supabase.from('models').select('model_id, model_name').in('model_id', modelIds)
                : Promise.resolve({ data: [], error: null } as any),
              categoryIds.length
                ? supabase.from('categories').select('category_id, category_name').in('category_id', categoryIds)
                : Promise.resolve({ data: [], error: null } as any)
            ])

            if (brandResult.error || modelResult.error || categoryResult.error) {
              setError(
                brandResult.error?.message ||
                modelResult.error?.message ||
                categoryResult.error?.message ||
                'Some product names could not be loaded.'
              )
            } else {
              setBrands((brandResult.data || []) as Brand[])
              setModels((modelResult.data || []) as Model[])
              setCategories((categoryResult.data || []) as Category[])
            }
          }
        }
      }
    }

    const paymentIds = paymentRows.map(p => p.payment_id)

    if (paymentIds.length === 0) {
      setAllocations([])
      setReversedIds([])
      setHistory([])
      setLoading(false)
      return
    }

    const [allocationResult, reversalResult, auditResult] = await Promise.all([
      supabase
        .from('payment_allocations')
        .select('id, payment_id, sale_id, amount')
        .in('payment_id', paymentIds),

      supabase
        .from('payment_reversal_items')
        .select('payment_id')
        .in('payment_id', paymentIds),

      supabase
        .from('payment_allocation_audit')
        .select('audit_id, action, payment_id, from_sale_id, to_sale_id, amount, reason, created_at')
        .in('payment_id', paymentIds)
        .order('created_at', { ascending: false })
        .limit(200)
    ])

    if (allocationResult.error || reversalResult.error || auditResult.error) {
      setError(
        allocationResult.error?.message ||
        reversalResult.error?.message ||
        auditResult.error?.message ||
        'Could not load allocation details.'
      )
      setLoading(false)
      return
    }

    setAllocations((allocationResult.data || []) as Allocation[])
    setReversedIds(
      (reversalResult.data || []).map(r => Number(r.payment_id))
    )
    setHistory((auditResult.data || []) as Audit[])
    setLoading(false)
  }

  const allocationByPayment = useMemo(() => {
    const result = new Map<number, number>()

    allocations.forEach(a => {
      result.set(
        a.payment_id,
        (result.get(a.payment_id) || 0) + Number(a.amount)
      )
    })

    return result
  }, [allocations])

  const allocationBySale = useMemo(() => {
    const result = new Map<number, number>()

    allocations.forEach(a => {
      result.set(
        a.sale_id,
        (result.get(a.sale_id) || 0) + Number(a.amount)
      )
    })

    return result
  }, [allocations])

  const itemDetailsById = useMemo(() => {
    const brandById = new Map(brands.map(row => [row.brand_id, row.brand_name]))
    const modelById = new Map(models.map(row => [row.model_id, row.model_name]))
    const categoryById = new Map(categories.map(row => [row.category_id, row.category_name]))
    const itemById = new Map(itemCatalog.map(item => [item.item_id, item]))

    return { brandById, modelById, categoryById, itemById }
  }, [itemCatalog, brands, models, categories])

  const describeItem = (itemId: number) => {
    const item = itemDetailsById.itemById.get(itemId)
    if (!item) return 'Item details unavailable'

    const parts = [
      itemDetailsById.brandById.get(item.brand_id || -1),
      itemDetailsById.modelById.get(item.model_id || -1),
      itemDetailsById.categoryById.get(item.category_id || -1),
      item.sku,
      item.quality,
      item.color,
      item.variant
    ].filter(Boolean)

    return parts.length ? parts.join(' · ') : 'Item description unavailable'
  }

  const saleItemsBySale = useMemo(() => {
    const result = new Map<number, SaleItem[]>()
    saleItems.forEach(line => {
      const current = result.get(line.sale_id) || []
      current.push(line)
      result.set(line.sale_id, current)
    })
    return result
  }, [saleItems])

  const databaseRebuildImpact = useMemo(() => {
    if (!databaseRebuildPreview || !Array.isArray(databaseRebuildPreview.matches)) return null

    const proposedBySale = new Map<number, number>()
    for (const match of databaseRebuildPreview.matches) {
      const saleId = Number(match.sale_id)
      proposedBySale.set(
        saleId,
        Number(((proposedBySale.get(saleId) || 0) + Number(match.amount || 0)).toFixed(2))
      )
    }

    // The rebuild changes allocation links only. It does NOT change
    // sales.paid_amount, so invoice outstanding balances must use that
    // recorded paid amount, not the proposed receipt allocation.
    const rows = sales.map(sale => {
      const allocated = Number(proposedBySale.get(sale.sale_id) || 0)
      const total = Number(sale.total_amount || 0)
      const recordedPaid = Number(sale.paid_amount || 0)
      const unlinkedPaid = Math.max(Number((recordedPaid - allocated).toFixed(2)), 0)
      const outstanding = Math.max(Number((total - recordedPaid).toFixed(2)), 0)
      const paymentStatus = recordedPaid <= 0.009
        ? 'Unpaid'
        : recordedPaid >= total - 0.009
          ? 'Fully paid'
          : 'Partially paid'
      const linkStatus = allocated <= 0.009
        ? 'No receipt linked'
        : unlinkedPaid > 0.009
          ? 'Part of paid amount remains unlinked'
          : 'Recorded paid amount fully linked'
      return {
        ...sale,
        proposedAllocated: allocated,
        recordedPaid,
        unlinkedPaid,
        proposedRemaining: outstanding,
        proposedStatus: paymentStatus,
        linkStatus
      }
    })

    const unmatchedPaidRows = Array.isArray(databaseRebuildPreview.unmatched_invoice_paid)
      ? databaseRebuildPreview.unmatched_invoice_paid.map((row: any) => {
          const sale = sales.find(item => item.sale_id === Number(row.sale_id))
          return {
            ...row,
            bill_date: sale?.bill_date || row.bill_date || '',
            invoiceTotal: Number(sale?.total_amount || 0),
            recordedPaid: Number(sale?.paid_amount || row.amount || 0)
          }
        })
      : []

    const unmatchedReceiptRows = Array.isArray(databaseRebuildPreview.unmatched_receipts)
      ? databaseRebuildPreview.unmatched_receipts
      : []
    const unmatchedPaidTotal = Number(unmatchedPaidRows.reduce(
      (sum: number, row: any) => sum + Number(row.amount || 0), 0
    ).toFixed(2))
    const unusedReceiptTotal = Number(unmatchedReceiptRows.reduce(
      (sum: number, row: any) => sum + Number(row.amount || 0), 0
    ).toFixed(2))
    const recordedInvoicePaidTotal = Number(sales.reduce(
      (sum, sale) => sum + Number(sale.paid_amount || 0), 0
    ).toFixed(2))
    const nonReversedReceiptTotal = Number(payments.reduce(
      (sum, payment) => sum + (reversedIds.includes(payment.payment_id) ? 0 : Number(payment.amount || 0)), 0
    ).toFixed(2))
    const reversedReceiptTotal = Number(payments.reduce(
      (sum, payment) => sum + (reversedIds.includes(payment.payment_id) ? Number(payment.amount || 0) : 0), 0
    ).toFixed(2))
    const proposedAllocationTotal = Number(databaseRebuildPreview.proposed_allocation_total || 0)
    const receiptGap = Math.max(Number((unmatchedPaidTotal - unusedReceiptTotal).toFixed(2)), 0)

    // A sale-item total mismatch is a separate data-quality signal. It can
    // flag missing/incorrect invoice lines, but cannot prove which item is missing.
    const itemAuditRows = sales.map(sale => {
      const lines = saleItems.filter(line => line.sale_id === sale.sale_id)
      const lineTotal = Number(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0).toFixed(2))
      const difference = Number((Number(sale.total_amount || 0) - lineTotal).toFixed(2))
      return { ...sale, lineCount: lines.length, lineTotal, itemDifference: difference }
    }).filter(row => row.lineCount === 0 || Math.abs(row.itemDifference) > 0.02)

    return {
      rows,
      fullyPaid: rows.filter(row => row.proposedStatus === 'Fully paid').length,
      partiallyPaid: rows.filter(row => row.proposedStatus === 'Partially paid').length,
      unpaid: rows.filter(row => row.proposedStatus === 'Unpaid').length,
      totalOutstanding: Number(rows.reduce((sum, row) => sum + row.proposedRemaining, 0).toFixed(2)),
      unmatchedPaidRows,
      unmatchedPaidTotal,
      unmatchedReceiptRows,
      unusedReceiptTotal,
      recordedInvoicePaidTotal,
      nonReversedReceiptTotal,
      reversedReceiptTotal,
      proposedAllocationTotal,
      receiptGap,
      itemAuditRows
    }
  }, [databaseRebuildPreview, sales, payments, reversedIds, saleItems])

  const metrics = useMemo(() => {
    const invoiceDue = sales.reduce(
      (sum, s) => sum + Number(s.total_amount) - Number(s.paid_amount),
      0
    )

    const customerReturns = returns.reduce(
      (sum, r) => sum + Number(r.total_amount),
      0
    )

    const invoicePaid = sales.reduce(
      (sum, s) => sum + Number(s.paid_amount),
      0
    )

    const allocatedTotal = allocations.reduce(
      (sum, a) => sum + Number(a.amount),
      0
    )

    const unallocatedPayments = payments.reduce((sum, p) => {
      if (reversedIds.includes(p.payment_id)) return sum

      return sum + Math.max(
        Number(p.amount) - (allocationByPayment.get(p.payment_id) || 0),
        0
      )
    }, 0)

    const eligibleAdvances = payments.reduce((sum, p) => {
      if (
        p.collection_id === null ||
        reversedIds.includes(p.payment_id)
      ) return sum

      return sum + Math.max(
        Number(p.amount) - (allocationByPayment.get(p.payment_id) || 0),
        0
      )
    }, 0)

    const calculatedBalance = party?.party_id === 3
      ? 0
      : Number((
          invoiceDue -
          customerReturns -
          eligibleAdvances
        ).toFixed(2))

    const missingInvoiceLinks = sales.reduce((sum, s) => (
      sum + Math.max(
        Number(s.paid_amount) - (allocationBySale.get(s.sale_id) || 0),
        0
      )
    ), 0)

    const excessInvoiceLinks = sales.reduce((sum, s) => (
      sum + Math.max(
        (allocationBySale.get(s.sale_id) || 0) - Number(s.paid_amount),
        0
      )
    ), 0)

    const excessPaymentAllocations = payments.reduce((sum, p) => (
      sum + Math.max(
        (allocationByPayment.get(p.payment_id) || 0) - Number(p.amount),
        0
      )
    ), 0)

    return {
      invoiceDue,
      customerReturns,
      invoicePaid,
      allocatedTotal,
      unallocatedPayments,
      eligibleAdvances,
      calculatedBalance,
      balanceDifference: Number(
        (Number(party?.current_balance || 0) - calculatedBalance).toFixed(2)
      ),
      missingInvoiceLinks,
      excessInvoiceLinks,
      excessPaymentAllocations
    }
  }, [
    sales,
    returns,
    payments,
    allocations,
    reversedIds,
    allocationByPayment,
    allocationBySale,
    party
  ])

  const selectedPayment = payments.find(
    p => String(p.payment_id) === selectedPaymentId
  ) || null

  const selectedSale = sales.find(
    s => String(s.sale_id) === selectedSaleId
  ) || null

  const selectedPaymentRemaining = selectedPayment
    ? Number(selectedPayment.amount) -
      (allocationByPayment.get(selectedPayment.payment_id) || 0)
    : 0

  const selectedSaleLinkable = selectedSale
    ? Number(selectedSale.paid_amount) -
      (allocationBySale.get(selectedSale.sale_id) || 0)
    : 0

  const historicalPayments = payments.filter(p =>
    !reversedIds.includes(p.payment_id) &&
    Number(p.amount) - (allocationByPayment.get(p.payment_id) || 0) > 0.009
  )

  const historicalInvoices = sales.filter(s =>
    s.status === 'Paid' &&
    Number(s.paid_amount) >= Number(s.total_amount) - 0.01 &&
    Number(s.paid_amount) - (allocationBySale.get(s.sale_id) || 0) > 0.009
  )

  const historicalPreview = useMemo(() => {
    const invoiceRemaining = new Map<number, number>()

    historicalInvoices.forEach(s => {
      invoiceRemaining.set(
        s.sale_id,
        Math.max(
          Number(s.paid_amount) - (allocationBySale.get(s.sale_id) || 0),
          0
        )
      )
    })

    const sortedPayments = [...historicalPayments].sort((a, b) =>
      b.payment_date.localeCompare(a.payment_date) ||
      b.payment_id - a.payment_id
    )

    const matches: HistoricalMatch[] = []
    const paymentRemaining = new Map<number, number>()

    for (const payment of sortedPayments) {
      let remaining = Math.max(
        Number(payment.amount) -
        (allocationByPayment.get(payment.payment_id) || 0),
        0
      )

      const candidates = historicalInvoices
        .filter(s =>
          s.bill_date <= payment.payment_date &&
          (invoiceRemaining.get(s.sale_id) || 0) > 0.009
        )
        .sort((a, b) =>
          b.bill_date.localeCompare(a.bill_date) ||
          b.sale_id - a.sale_id
        )

      for (const invoice of candidates) {
        if (remaining <= 0.009) break

        const invoiceAvailable = invoiceRemaining.get(invoice.sale_id) || 0
        const amount = Math.min(remaining, invoiceAvailable)

        if (amount <= 0.009) continue

        matches.push({
          payment_id: payment.payment_id,
          payment_date: payment.payment_date,
          sale_id: invoice.sale_id,
          bill_date: invoice.bill_date,
          amount: Number(amount.toFixed(2))
        })

        remaining = Number((remaining - amount).toFixed(2))

        invoiceRemaining.set(
          invoice.sale_id,
          Number((invoiceAvailable - amount).toFixed(2))
        )
      }

      paymentRemaining.set(
        payment.payment_id,
        Number(remaining.toFixed(2))
      )
    }

    return {
      matches,
      total: matches.reduce((sum, m) => sum + m.amount, 0),
      unmatchedPayments: [...paymentRemaining.values()].reduce(
        (sum, amount) => sum + amount,
        0
      ),
      unmatchedInvoices: [...invoiceRemaining.values()].reduce(
        (sum, amount) => sum + amount,
        0
      )
    }
  }, [
    historicalPayments,
    historicalInvoices,
    allocationByPayment,
    allocationBySale
  ])

  const rebuildPreview = useMemo(() => {
    const invoiceRemaining = new Map<number, number>()

    sales.forEach(s => {
      invoiceRemaining.set(
        s.sale_id,
        Math.max(Number(s.paid_amount || 0), 0)
      )
    })

    const sortedPayments = [...payments]
      .filter(p =>
        !reversedIds.includes(p.payment_id) &&
        Number(p.amount) > 0
      )
      .sort((a, b) =>
        b.payment_date.localeCompare(a.payment_date) ||
        b.payment_id - a.payment_id
      )

    const sortedInvoices = [...sales].sort((a, b) =>
      b.bill_date.localeCompare(a.bill_date) ||
      b.sale_id - a.sale_id
    )

    const matches: {
      payment_id: number
      payment_date: string
      sale_id: number
      bill_date: string
      amount: number
    }[] = []

    const unmatchedPayments: {
      payment_id: number
      payment_date: string
      amount: number
    }[] = []

    for (const payment of sortedPayments) {
      let remaining = Number(payment.amount)

      const candidates = sortedInvoices.filter(s =>
        s.bill_date <= payment.payment_date &&
        (invoiceRemaining.get(s.sale_id) || 0) > 0.009
      )

      for (const invoice of candidates) {
        if (remaining <= 0.009) break

        const available = invoiceRemaining.get(invoice.sale_id) || 0
        const amount = Math.min(remaining, available)

        if (amount <= 0.009) continue

        matches.push({
          payment_id: payment.payment_id,
          payment_date: payment.payment_date,
          sale_id: invoice.sale_id,
          bill_date: invoice.bill_date,
          amount: Number(amount.toFixed(2))
        })

        remaining = Number((remaining - amount).toFixed(2))
        invoiceRemaining.set(
          invoice.sale_id,
          Number((available - amount).toFixed(2))
        )
      }

      if (remaining > 0.009) {
        unmatchedPayments.push({
          payment_id: payment.payment_id,
          payment_date: payment.payment_date,
          amount: Number(remaining.toFixed(2))
        })
      }
    }

    const unmatchedInvoices = sales
      .map(s => ({
        sale_id: s.sale_id,
        bill_date: s.bill_date,
        amount: Number((invoiceRemaining.get(s.sale_id) || 0).toFixed(2))
      }))
      .filter(s => s.amount > 0.009)

    return {
      matches,
      unmatchedPayments,
      unmatchedInvoices,
      matchedTotal: matches.reduce((sum, m) => sum + m.amount, 0),
      unusedReceiptTotal: unmatchedPayments.reduce((sum, p) => sum + p.amount, 0),
      unpaidReceiptGap: unmatchedInvoices.reduce((sum, s) => sum + s.amount, 0)
    }
  }, [payments, sales, reversedIds])

  async function generateDatabaseRebuildPreview() {
    if (!party) return

    setError('')
    setMessage('')
    setSaving(true)

    const { data, error } = await supabase.rpc(
      'preview_customer_payment_rebuild',
      { p_party_id: party.party_id }
    )

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    try {
      const result = typeof data === 'string' ? JSON.parse(data) : data

      if (!result?.success) {
        setError('Database did not return a valid preview.')
        return
      }

      if (Number(result.warning_paid_amount_exceeds_invoice_total) > 0) {
        setError(
          'Preview stopped: some invoice paid amounts exceed invoice totals. Review these records before rebuilding.'
        )
        return
      }

      setDatabaseRebuildPreview(result)

      setMessage(
        `Database preview ready: ${result.matches.length} proposed links totalling ₹${money(Number(result.proposed_allocation_total))}. Nothing has been changed.`
      )
    } catch {
      setError('Could not read the database preview.')
    }
  }

  async function applyFullRebuild() {
    if (!party || !databaseRebuildPreview) return

    const preview = databaseRebuildPreview

    const confirmed = window.confirm(
      `FULL ALLOCATION REBUILD\n\nCustomer: ${party.party_name}\nProposed links: ${preview.matches.length}\nAllocation total: ₹${money(Number(preview.proposed_allocation_total))}\nUnused receipts: ₹${money(preview.unmatched_receipts.reduce((sum: number, p: any) => sum + Number(p.amount), 0))}\nUnmatched invoice paid: ₹${money(preview.unmatched_invoice_paid.reduce((sum: number, s: any) => sum + Number(s.amount), 0))}\n\nIMPORTANT: This amount has no corresponding receipt link in the preview. Check the unmatched invoice list and receipt gap before proceeding.\n\nExisting allocation links will be backed up and replaced.\nInvoice paid amounts and customer balance will NOT change.\n\nProceed?`
    )

    if (!confirmed) return

    setError('')
    setMessage('')
    setSaving(true)

    const { data, error } = await supabase.rpc(
      'apply_customer_payment_rebuild',
      {
        p_party_id: party.party_id,
        p_expected_preview: preview,
        p_reason: 'Full customer allocation rebuild'
      }
    )

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    try {
      const result = typeof data === 'string' ? JSON.parse(data) : data

      if (!result?.success || !result?.rebuild_id) {
        setError('Database did not confirm the rebuild.')
        return
      }

      const rebuildId = String(result.rebuild_id)

      await loadParty(party)
      setLastRebuildId(rebuildId)

      setMessage(
        `Rebuild completed. ${result.new_links_created} links created, ₹${money(Number(result.new_allocation_total))} allocated. Backup saved.`
      )
    } catch {
      setError('The rebuild response could not be read. Check the database before retrying.')
    }
  }

  async function restoreFullRebuild() {
    if (!party || !lastRebuildId) return

    const confirmed = window.confirm(
      `RESTORE PREVIOUS ALLOCATIONS?\n\nThis will remove the links created by the last rebuild and restore the backed-up original links for ${party.party_name}.\n\nInvoice paid amounts and customer balance will not change.\n\nContinue?`
    )

    if (!confirmed) return

    setError('')
    setMessage('')
    setSaving(true)

    const { data, error } = await supabase.rpc(
      'restore_customer_payment_rebuild',
      {
        p_party_id: party.party_id,
        p_rebuild_id: lastRebuildId
      }
    )

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    try {
      const result = typeof data === 'string' ? JSON.parse(data) : data

      if (!result?.success) {
        setError('Database did not confirm the restoration.')
        return
      }

      await loadParty(party)
      setMessage(
        `Previous allocations restored: ${result.restored_links} links, ₹${money(Number(result.restored_amount))}.`
      )
    } catch {
      setError('The restore response could not be read. Check the database before retrying.')
    }
  }

  const isHistoricalSelected = (match: HistoricalMatch) =>
    selectedHistorical[matchKey(match.payment_id, match.sale_id)] ?? true

  const getHistoricalAmount = (match: HistoricalMatch) =>
    historicalAmounts[matchKey(match.payment_id, match.sale_id)] ??
    match.amount.toFixed(2)

  const selectedHistoricalCount = historicalPreview.matches.filter(
    isHistoricalSelected
  ).length

  const selectedHistoricalTotal = historicalPreview.matches.reduce(
    (sum, match) => {
      if (!isHistoricalSelected(match)) return sum
      return sum + Number(getHistoricalAmount(match) || 0)
    },
    0
  )

  const issues = useMemo(() => {
    const list: {
      title: string
      detail: string
      level: 'warning' | 'danger'
    }[] = []

    if (Math.abs(metrics.balanceDifference) > 0.01) {
      list.push({
        title: 'Customer balance drift',
        detail: `Stored balance differs from calculated balance by ₹${money(metrics.balanceDifference)}.`,
        level: 'danger'
      })
    }

    if (metrics.missingInvoiceLinks > 0.01) {
      list.push({
        title: 'Paid invoices missing allocation links',
        detail: `₹${money(metrics.missingInvoiceLinks)} of recorded invoice payments have no matching payment allocation.`,
        level: 'warning'
      })
    }

    if (metrics.excessInvoiceLinks > 0.01) {
      list.push({
        title: 'Invoice allocations exceed paid amount',
        detail: `Allocations exceed recorded invoice paid amounts by ₹${money(metrics.excessInvoiceLinks)}.`,
        level: 'danger'
      })
    }

    if (metrics.excessPaymentAllocations > 0.01) {
      list.push({
        title: 'Payment overallocated',
        detail: `Payment allocations exceed receipt amounts by ₹${money(metrics.excessPaymentAllocations)}.`,
        level: 'danger'
      })
    }

    const standaloneUnused = payments.filter(p =>
      p.collection_id === null &&
      !reversedIds.includes(p.payment_id) &&
      Number(p.amount) - (allocationByPayment.get(p.payment_id) || 0) > 0.009
    )

    if (standaloneUnused.length > 0) {
      const amount = standaloneUnused.reduce((sum, p) =>
        sum + Number(p.amount) - (allocationByPayment.get(p.payment_id) || 0),
        0
      )

      list.push({
        title: 'Unallocated standalone payments',
        detail: `${standaloneUnused.length} payment(s), ₹${money(amount)}. These are excluded from the existing advance calculation and need review.`,
        level: 'warning'
      })
    }

    const reversedAllocated = allocations.filter(a =>
      reversedIds.includes(a.payment_id)
    )

    if (reversedAllocated.length > 0) {
      list.push({
        title: 'Reversed payments still have allocations',
        detail: `${reversedAllocated.length} allocation record(s) belong to reversed payments.`,
        level: 'danger'
      })
    }

    return list
  }, [
    metrics,
    payments,
    reversedIds,
    allocations,
    allocationByPayment
  ])

  async function saveHistoricalLink() {
    setError('')
    setMessage('')

    if (!selectedPayment || !selectedSale) {
      setError('Select both a payment and a paid invoice.')
      return
    }

    const numericAmount = Number(linkAmount)

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid amount.')
      return
    }

    if (Math.round(numericAmount * 100) !== numericAmount * 100) {
      setError('Amount can have no more than two decimal places.')
      return
    }

    if (numericAmount > selectedPaymentRemaining + 0.001) {
      setError(`Payment has only ₹${money(selectedPaymentRemaining)} unallocated.`)
      return
    }

    if (numericAmount > selectedSaleLinkable + 0.001) {
      setError(`Invoice has only ₹${money(selectedSaleLinkable)} available for historical linking.`)
      return
    }

    if (!linkReason.trim()) {
      setError('Enter a reason for this historical link.')
      return
    }

    const confirmed = window.confirm(
      `Link ₹${money(numericAmount)} from the receipt dated ${dateLabel(selectedPayment.payment_date)} to the invoice dated ${dateLabel(selectedSale.bill_date)}?\n\nThe invoice paid amount and customer balance will not be changed.`
    )

    if (!confirmed) return

    setSaving(true)

    const { data, error } = await supabase.rpc(
      'link_payment_to_paid_invoice',
      {
        p_payment_id: selectedPayment.payment_id,
        p_sale_id: selectedSale.sale_id,
        p_amount: numericAmount,
        p_reason: linkReason.trim()
      }
    )

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    if (!data?.success) {
      setError('The database did not confirm the historical link.')
      return
    }

    setMessage('Historical link created successfully.')

    if (party) await loadParty(party)
  }

  async function applyHistoricalBatch() {
    setError('')
    setMessage('')

    if (!party) return

    const selected = historicalPreview.matches.filter(isHistoricalSelected)

    if (selected.length === 0) {
      setError('Select at least one proposed link.')
      return
    }

    const paymentTotals = new Map<number, number>()
    const saleTotals = new Map<number, number>()

    const links: {
      payment_id: number
      sale_id: number
      amount: number
      reason: string
    }[] = []

    for (const match of selected) {
      const amount = Number(getHistoricalAmount(match))

      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        Math.round(amount * 100) !== amount * 100
      ) {
        setError('One of the proposed amounts is invalid.')
        return
      }

      paymentTotals.set(
        match.payment_id,
        (paymentTotals.get(match.payment_id) || 0) + amount
      )

      saleTotals.set(
        match.sale_id,
        (saleTotals.get(match.sale_id) || 0) + amount
      )

      links.push({
        payment_id: match.payment_id,
        sale_id: match.sale_id,
        amount,
        reason: `Approved historical reconciliation for customer #${party.party_id}`
      })
    }

    for (const [paymentId, total] of paymentTotals) {
      const payment = payments.find(p => p.payment_id === paymentId)

      if (!payment) {
        setError('A selected receipt could not be found.')
        return
      }

      if (reversedIds.includes(paymentId)) {
        setError('A selected receipt has been reversed.')
        return
      }

      const available = Number(payment.amount) -
        (allocationByPayment.get(paymentId) || 0)

      if (total > available + 0.001) {
        setError('Selected links exceed an available receipt amount.')
        return
      }
    }

    for (const [saleId, total] of saleTotals) {
      const sale = sales.find(s => s.sale_id === saleId)

      if (!sale) {
        setError('A selected invoice could not be found.')
        return
      }

      if (
        sale.status !== 'Paid' ||
        Number(sale.paid_amount) < Number(sale.total_amount) - 0.01
      ) {
        setError('A selected invoice is no longer fully paid.')
        return
      }

      const available = Number(sale.paid_amount) -
        (allocationBySale.get(saleId) || 0)

      if (total > available + 0.001) {
        setError('Selected links exceed an invoice amount available for linking.')
        return
      }
    }

    const totalAmount = links.reduce(
      (sum, link) => sum + link.amount,
      0
    )

    const confirmed = window.confirm(
      `Apply ${links.length} historical links totalling ₹${money(totalAmount)} for ${party.party_name}?\n\nThis only creates payment allocation links. Invoice paid amounts and customer balances will not be changed.\n\nThe entire batch will roll back if any link fails.`
    )

    if (!confirmed) return

    setSaving(true)

    const { data, error } = await supabase.rpc(
      'link_payments_to_paid_invoices_bulk',
      {
        p_links: links,
        p_reason: `Approved historical reconciliation for customer #${party.party_id}`
      }
    )

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    if (!data?.success) {
      setError('The database did not confirm the bulk operation.')
      return
    }

    await loadParty(party)

    setMessage(
      `Successfully created ${data.links_created} historical links totalling ₹${money(Number(data.total_amount))}.`
    )
  }

  if (!checkedOwner) {
    return <main className="mx-auto max-w-6xl p-6">Checking access...</main>
  }

  if (!authorized) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <p className="text-red-600">Access denied. Owner only.</p>
      </main>
    )
  }

  const sortedPayments = [...payments].sort((a, b) =>
    b.payment_date.localeCompare(a.payment_date) ||
    b.payment_id - a.payment_id
  )

  const sortedSales = [...sales].sort((a, b) =>
    b.bill_date.localeCompare(a.bill_date) ||
    b.sale_id - a.sale_id
  )

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-3 py-5 sm:px-5 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Payment Reconciliation
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Customer receipts, invoice payments and allocation review.
        </p>
      </header>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">Find customer</h2>

        <SmartCombobox
          options={partyOptions.map(p => ({
            value: p.party_id,
            label: `${p.party_name} · Balance ₹${money(Number(p.current_balance))}${p.phone ? ` · ${p.phone}` : ''}`
          }))}
          value={partySearchValue}
          placeholder="Search customer name..."
          allowCreate={false}
          onSearch={searchParties}
          searchDebounceMs={300}
          onValueChange={value => {
            setPartySearchValue(value || null)

            const found = partyOptions.find(
              p => String(p.party_id) === value
            )

            if (found) {
              loadParty(found)
            } else if (!value) {
              setParty(null)
              setPayments([])
              setSales([])
              setSaleItems([])
              setItemCatalog([])
              setBrands([])
              setModels([])
              setCategories([])
              setAllocations([])
              setReturns([])
              setHistory([])
              setReversedIds([])
              setSelectedHistorical({})
              setHistoricalAmounts({})
              setDatabaseRebuildPreview(null)
              setLastRebuildId(null)
              setError('')
              setMessage('')
            }
          }}
        />

        {partySearchLoading && (
          <p className="mt-2 text-xs text-gray-500">Searching...</p>
        )}

        {loading && (
          <p className="mt-2 text-sm text-gray-500">Loading customer records...</p>
        )}
      </section>

      {party && !loading && (
        <>
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{party.party_name}</h2>
                {party.phone && (
                  <p className="text-sm text-gray-500">{party.phone}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500">Stored customer balance</p>
                <p className="text-2xl font-bold tabular-nums">
                  ₹{money(Number(party.current_balance))}
                </p>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Invoice outstanding', metrics.invoiceDue],
              ['Invoice paid amount', metrics.invoicePaid],
              ['Allocated amount', metrics.allocatedTotal],
              ['Available receipts', metrics.unallocatedPayments]
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border bg-white p-3 shadow-sm">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  ₹{money(Number(value))}
                </p>
              </div>
            ))}
          </section>

          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Balance reconciliation</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-gray-500">Stored balance</p>
                <p className="text-lg font-semibold">
                  ₹{money(Number(party.current_balance))}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Calculated balance</p>
                <p className="text-lg font-semibold">
                  ₹{money(metrics.calculatedBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Difference</p>
                <p className={`text-lg font-semibold ${
                  Math.abs(metrics.balanceDifference) > 0.01
                    ? 'text-red-600'
                    : 'text-green-700'
                }`}>
                  ₹{money(metrics.balanceDifference)}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Calculated using the current customer balance formula.
              This page does not automatically update the stored balance.
            </p>
          </section>

          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Discrepancies</h2>
              <span className="text-xs text-gray-500">
                {issues.length} issue(s) detected
              </span>
            </div>

            {issues.length === 0 ? (
              <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">
                No discrepancies detected by these checks.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {issues.map((issue, index) => (
                  <div
                    key={index}
                    className={`rounded-lg border p-3 ${
                      issue.level === 'danger'
                        ? 'border-red-200 bg-red-50'
                        : 'border-amber-200 bg-amber-50'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${
                      issue.level === 'danger' ? 'text-red-800' : 'text-amber-900'
                    }`}>
                      {issue.title}
                    </p>
                    <p className="mt-1 text-sm text-gray-700">
                      {issue.detail}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Historical matching */}
          <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  Historical Matching
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Review suggested links before applying them.
                </p>
              </div>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                Review before applying
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Suggested links</p>
                <p className="text-xl font-bold">{historicalPreview.matches.length}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Selected links</p>
                <p className="text-xl font-bold">{selectedHistoricalCount}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Selected amount</p>
                <p className="text-xl font-bold">₹{money(selectedHistoricalTotal)}</p>
              </div>
            </div>

            {historicalPreview.matches.length === 0 ? (
              <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-500">
                No historical matches can be proposed.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {historicalPreview.matches.map(match => {
                  const key = matchKey(match.payment_id, match.sale_id)
                  const checked = isHistoricalSelected(match)
                  const payment = payments.find(p => p.payment_id === match.payment_id)
                  const invoice = sales.find(s => s.sale_id === match.sale_id)

                  return (
                    <div key={key} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="flex min-w-0 items-start gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e =>
                              setSelectedHistorical(previous => ({
                                ...previous,
                                [key]: e.target.checked
                              }))
                            }
                            className="mt-1 h-4 w-4"
                          />
                          <span className="min-w-0">
                            <span className="block font-medium">
                              Receipt · {dateLabel(match.payment_date)}
                              {payment?.payment_mode ? ` · ${payment.payment_mode}` : ''}
                            </span>
                            <span className="mt-1 block text-xs text-gray-500">
                              Invoice · {dateLabel(match.bill_date)}
                              {match.bill_date === match.payment_date ? ' · Same day' : ''}
                            </span>
                          </span>
                        </label>

                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500">₹</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={getHistoricalAmount(match)}
                            disabled={!checked}
                            onChange={e =>
                              setHistoricalAmounts(previous => ({
                                ...previous,
                                [key]: e.target.value
                              }))
                            }
                            className="w-32 rounded-lg border px-2 py-2 text-right disabled:bg-gray-100"
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-4 space-y-2 border-t pt-3 text-sm">
              <p>
                Remaining unlinked paid-invoice amount:
                <strong className="ml-2">₹{money(historicalPreview.unmatchedInvoices)}</strong>
              </p>
              <p>
                Unmatched receipt amount:
                <strong className="ml-2">₹{money(historicalPreview.unmatchedPayments)}</strong>
              </p>
              <p className="text-xs text-gray-500">
                Suggestions are based on dates and available amounts, not proof
                of the original payment instruction. No database changes occur
                until you apply.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const selected: Record<string, boolean> = {}
                  historicalPreview.matches.forEach(m => {
                    selected[matchKey(m.payment_id, m.sale_id)] = true
                  })
                  setSelectedHistorical(selected)
                }}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Select all
              </button>

              <button
                type="button"
                onClick={() => {
                  const selected: Record<string, boolean> = {}
                  historicalPreview.matches.forEach(m => {
                    selected[matchKey(m.payment_id, m.sale_id)] = false
                  })
                  setSelectedHistorical(selected)
                }}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Clear selection
              </button>

              <button
                type="button"
                onClick={applyHistoricalBatch}
                disabled={saving || selectedHistoricalCount === 0}
                className="rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Applying...' : 'Apply selected links'}
              </button>
            </div>
          </section>

          {/* Manual historical linking */}
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Manual historical linking</h2>
            <p className="mt-1 text-sm text-gray-500">
              Link an unused receipt to an invoice already marked Paid.
              This creates the missing relationship only; it does not increase invoice paid amount.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Unallocated receipt
                </label>
                <select
                  value={selectedPaymentId}
                  onChange={e => {
                    setSelectedPaymentId(e.target.value)
                    setLinkAmount('')
                  }}
                  className="min-h-11 w-full rounded-lg border bg-white px-3"
                >
                  <option value="">Select receipt...</option>
                  {historicalPayments.map(p => {
                    const remaining = Number(p.amount) -
                      (allocationByPayment.get(p.payment_id) || 0)

                    return (
                      <option key={p.payment_id} value={p.payment_id}>
                        {dateLabel(p.payment_date)} · {p.payment_mode || 'Payment'} · Available ₹{money(remaining)}
                      </option>
                    )
                  })}
                </select>

                {selectedPayment && (
                  <p className="mt-1 text-xs text-gray-500">
                    Available receipt amount: ₹{money(selectedPaymentRemaining)}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Already-paid invoice
                </label>
                <select
                  value={selectedSaleId}
                  onChange={e => {
                    setSelectedSaleId(e.target.value)
                    setLinkAmount('')
                  }}
                  className="min-h-11 w-full rounded-lg border bg-white px-3"
                >
                  <option value="">Select invoice...</option>
                  {historicalInvoices.map(s => {
                    const available = Number(s.paid_amount) -
                      (allocationBySale.get(s.sale_id) || 0)

                    return (
                      <option key={s.sale_id} value={s.sale_id}>
                        {dateLabel(s.bill_date)} · Invoice total ₹{money(Number(s.total_amount))} · Linkable ₹{money(available)}
                      </option>
                    )
                  })}
                </select>

                {selectedSale && (
                  <p className="mt-1 text-xs text-gray-500">
                    Paid amount not yet linked: ₹{money(selectedSaleLinkable)}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Amount to link (₹)
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={linkAmount}
                  onChange={e => setLinkAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="min-h-11 w-full rounded-lg border px-3"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Reason for historical link
                </label>
                <input
                  value={linkReason}
                  onChange={e => setLinkReason(e.target.value)}
                  placeholder="Example: Customer confirmed this invoice was paid"
                  className="min-h-11 w-full rounded-lg border px-3"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={saveHistoricalLink}
              disabled={
                saving ||
                !selectedPayment ||
                !selectedSale ||
                !linkAmount ||
                !linkReason.trim()
              }
              className="mt-4 min-h-11 rounded-lg bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Create historical link'}
            </button>

            {historicalPayments.length === 0 && (
              <p className="mt-2 text-xs text-gray-500">
                No unallocated, non-reversed receipts available.
              </p>
            )}

            {historicalInvoices.length === 0 && (
              <p className="mt-2 text-xs text-gray-500">
                No fully paid invoices with unlinked paid amounts available.
              </p>
            )}
          </section>

          {/* Payment and invoice explorer */}
          <section className="space-y-4">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">Payment &amp; Invoice Explorer</h2>
              <p className="mt-1 text-sm text-gray-500">
                Allocated amounts are crossed out. Available and unlinked amounts
                remain normal. Expand a record to see its matching records.
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                <span>
                  <span className="font-semibold text-gray-400 line-through">₹ Allocated</span>
                  {' '}· Already linked
                </span>
                <span>
                  <span className="font-semibold text-green-700">₹ Available</span>
                  {' '}· Not yet linked
                </span>
              </div>
            </div>

            {/* Payments */}
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold">Receipts</h2>
                  <p className="text-xs text-gray-500">
                    {payments.length} receipts · Newest first
                  </p>
                </div>
                <strong className="text-lg">
                  ₹{money(payments.reduce((sum, p) => sum + Number(p.amount), 0))}
                </strong>
              </div>

              <div className="space-y-2">
                {sortedPayments.map(p => {
                  const linked = allocations.filter(a => a.payment_id === p.payment_id)
                  const allocated = linked.reduce((sum, a) => sum + Number(a.amount), 0)
                  const remaining = Number(p.amount) - allocated
                  const available = Math.max(remaining, 0)
                  const reversed = reversedIds.includes(p.payment_id)

                  return (
                    <details key={p.payment_id} className="group rounded-xl border">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-3 hover:bg-gray-50">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                            reversed
                              ? 'bg-red-100 text-red-700'
                              : 'bg-blue-50 text-blue-700'
                          }`}>
                            <span className="text-lg">₹</span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold">
                              {dateLabel(p.payment_date)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {p.payment_mode || 'Payment'}
                              {' · '}
                              {linked.length} invoice link{linked.length === 1 ? '' : 's'}
                              {reversed ? ' · REVERSED' : ''}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="font-bold">₹{money(Number(p.amount))}</p>
                          {reversed ? (
                            <p className="text-xs text-red-600">Reversed</p>
                          ) : (
                            <p className="text-xs">
                              {allocated > 0.009 && (
                                <>{paidAmount(allocated)}{' '}</>
                              )}
                              {available > 0.009 && (
                                <span className="font-medium text-green-700">
                                  ₹{money(available)} available
                                </span>
                              )}
                              {available <= 0.009 && remaining >= -0.009 && (
                                <span className="text-green-700">Fully allocated</span>
                              )}
                              {remaining < -0.009 && (
                                <span className="text-red-600">
                                  Overallocated ₹{money(Math.abs(remaining))}
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        <span className="text-gray-400 transition-transform group-open:rotate-180">⌄</span>
                      </summary>

                      <div className="border-t bg-gray-50 p-3">
                        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded-lg bg-white p-3">
                            <p className="text-xs text-gray-500">Allocated</p>
                            <strong>{paidAmount(allocated)}</strong>
                          </div>
                          <div className="rounded-lg bg-white p-3">
                            <p className="text-xs text-gray-500">Receipt remaining</p>
                            <strong className={available > 0.009 ? 'text-green-700' : 'text-gray-700'}>
                              ₹{money(available)}
                            </strong>
                          </div>
                        </div>

                        {linked.length === 0 ? (
                          <p className="rounded-lg bg-white p-3 text-sm text-gray-500">
                            No invoice allocations linked to this receipt.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {linked.map(a => {
                              const invoice = sales.find(s => s.sale_id === a.sale_id)

                              return (
                                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 text-sm">
                                  <div>
                                    <strong>
                                      Invoice · {invoice ? dateLabel(invoice.bill_date) : 'Date unavailable'}
                                    </strong>
                                    <p className="text-xs text-gray-500">
                                      {invoice
                                        ? `Total ₹${money(Number(invoice.total_amount))}`
                                        : 'Invoice details unavailable'}
                                    </p>
                                  </div>
                                  <strong>{paidAmount(Number(a.amount))}</strong>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })}

                {payments.length === 0 && (
                  <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
                    No receipts found for this customer.
                  </p>
                )}
              </div>
            </div>

            {/* Invoices */}
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold">Invoices</h2>
                  <p className="text-xs text-gray-500">
                    {sales.length} invoices · Newest first
                  </p>
                </div>
                <strong className="text-lg">
                  ₹{money(sales.reduce((sum, s) => sum + Number(s.total_amount), 0))}
                </strong>
              </div>

              <div className="space-y-2">
                {sortedSales.map(s => {
                  const linked = allocations.filter(a => a.sale_id === s.sale_id)
                  const allocated = linked.reduce((sum, a) => sum + Number(a.amount), 0)
                  const recordedPaid = Number(s.paid_amount)
                  const unlinkedPaid = Math.max(recordedPaid - allocated, 0)
                  const overallocated = Math.max(allocated - recordedPaid, 0)
                  const outstanding = Number(s.total_amount) - recordedPaid

                  return (
                    <details key={s.sale_id} className="group rounded-xl border">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-3 hover:bg-gray-50">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                            Math.abs(outstanding) <= 0.01
                              ? 'bg-green-50 text-green-700'
                              : outstanding > 0
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-700'
                          }`}>
                            <span className="text-lg">▤</span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold">{dateLabel(s.bill_date)}</p>
                            <p className="text-xs text-gray-500">
                              {s.status} · {linked.length} payment link{linked.length === 1 ? '' : 's'}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="font-bold">₹{money(Number(s.total_amount))}</p>
                          <p className="text-xs text-gray-500">
                            Paid {allocated > 0.009 ? paidAmount(allocated) : '₹0.00'}
                            {unlinkedPaid > 0.009 && (
                              <> + <span className="font-medium text-green-700">₹{money(unlinkedPaid)} unlinked</span></>
                            )}
                          </p>
                          <p className={`text-xs ${
                            outstanding > 0.01
                              ? 'text-amber-700'
                              : outstanding < -0.01
                                ? 'text-red-700'
                                : 'text-green-700'
                          }`}>
                            {outstanding > 0.01
                              ? `Outstanding ₹${money(outstanding)}`
                              : outstanding < -0.01
                                ? `Overpaid ₹${money(Math.abs(outstanding))}`
                                : 'Fully paid'}
                          </p>
                        </div>
                        <span className="text-gray-400 transition-transform group-open:rotate-180">⌄</span>
                      </summary>

                      <div className="border-t bg-gray-50 p-3">
                        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded-lg bg-white p-3">
                            <p className="text-xs text-gray-500">Allocated from receipts</p>
                            <strong>{paidAmount(allocated)}</strong>
                          </div>
                          <div className="rounded-lg bg-white p-3">
                            <p className="text-xs text-gray-500">Paid but not linked</p>
                            <strong className={unlinkedPaid > 0.009 ? 'text-green-700' : ''}>
                              ₹{money(unlinkedPaid)}
                            </strong>
                          </div>
                          <div className="rounded-lg bg-white p-3">
                            <p className="text-xs text-gray-500">Recorded paid</p>
                            <strong>₹{money(recordedPaid)}</strong>
                          </div>
                          <div className="rounded-lg bg-white p-3">
                            <p className="text-xs text-gray-500">Outstanding</p>
                            <strong className={outstanding > 0.01 ? 'text-amber-700' : ''}>
                              ₹{money(outstanding)}
                            </strong>
                          </div>
                        </div>

                        <div className="mb-3 rounded-lg bg-white p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-800">Purchased items</p>
                            <span className="text-xs text-gray-500">
                              {(saleItemsBySale.get(s.sale_id) || []).length} line(s)
                            </span>
                          </div>
                          {(saleItemsBySale.get(s.sale_id) || []).length === 0 ? (
                            <p className="text-sm text-gray-500">
                              No item details are recorded for this invoice.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {(saleItemsBySale.get(s.sale_id) || []).map(line => (
                                <div
                                  key={line.detail_id}
                                  className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0"
                                >
                                  <div className="min-w-0">
                                    <p className={`text-sm font-medium ${
                                      Number(s.paid_amount) >= Number(s.total_amount) - 0.009 &&
                                      allocated >= Number(s.paid_amount) - 0.009
                                        ? 'text-gray-400 line-through'
                                        : allocated > 0.009
                                          ? 'text-amber-700'
                                          : 'text-emerald-700'
                                    }`}>
                                      {describeItem(line.item_id)}
                                    </p>
                                    <p className="mt-0.5 text-xs text-gray-500">
                                      Qty {Number(line.quantity)} × ₹{money(Number(line.rate))}
                                    </p>
                                  </div>
                                  <strong className="shrink-0 text-sm tabular-nums">
                                    ₹{money(Number(line.amount))}
                                  </strong>
                                </div>
                              ))}
                            </div>
                          )}
                          <p className="mt-2 text-[11px] text-gray-400">
                            Item colour follows this invoice's allocation status; payments are linked to invoices, not to individual item lines.
                          </p>
                        </div>

                        {overallocated > 0.009 && (
                          <p className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                            Allocations exceed the recorded paid amount by ₹{money(overallocated)}.
                          </p>
                        )}

                        {linked.length === 0 ? (
                          <p className="rounded-lg bg-white p-3 text-sm text-gray-500">
                            No receipt links found for this invoice.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {linked.map(a => {
                              const payment = payments.find(p => p.payment_id === a.payment_id)

                              return (
                                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 text-sm">
                                  <div>
                                    <strong>
                                      Receipt · {payment ? dateLabel(payment.payment_date) : 'Date unavailable'}
                                    </strong>
                                    <p className="text-xs text-gray-500">
                                      {payment?.payment_mode || 'Payment'}
                                    </p>
                                  </div>
                                  <strong>{paidAmount(Number(a.amount))}</strong>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })}

                {sales.length === 0 && (
                  <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
                    No invoices found for this customer.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Full rebuild */}
          <section className="rounded-xl border-2 border-indigo-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">Full Allocation Rebuild</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Draft allocation plan using all non-reversed receipts and recorded invoice paid amounts.
                </p>
              </div>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                Preview first
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Proposed links</p>
                <p className="text-xl font-bold">{rebuildPreview.matches.length}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Proposed allocation</p>
                <p className="text-lg font-bold">₹{money(rebuildPreview.matchedTotal)}</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3">
                <p className="text-xs text-amber-800">Unused receipts</p>
                <p className="text-lg font-bold text-amber-800">
                  ₹{money(rebuildPreview.unusedReceiptTotal)}
                </p>
              </div>
              <div className="rounded-lg bg-red-50 p-3">
                <p className="text-xs text-red-800">Unmatched invoice paid</p>
                <p className="text-lg font-bold text-red-800">
                  ₹{money(rebuildPreview.unpaidReceiptGap)}
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              Matching order: newest receipts first; same-day invoices first,
              then older invoices. Future-dated invoices are excluded.
              Partial payments are included. Reversed receipts are excluded.
              Existing allocation links are ignored for this draft.
            </p>

            <details className="mt-4 rounded-lg border">
              <summary className="cursor-pointer p-3 text-sm font-semibold hover:bg-gray-50">
                Proposed receipt-to-invoice links ({rebuildPreview.matches.length})
              </summary>
              <div className="divide-y border-t">
                {rebuildPreview.matches.map((m, index) => {
                  const payment = payments.find(p => p.payment_id === m.payment_id)
                  return (
                    <div key={`${m.payment_id}-${m.sale_id}-${index}`} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                      <div>
                        <p className="font-medium">
                          Receipt · {dateLabel(m.payment_date)}
                          {payment?.payment_mode ? ` · ${payment.payment_mode}` : ''}
                        </p>
                        <p className="text-xs text-gray-500">
                          Invoice · {dateLabel(m.bill_date)}
                        </p>
                      </div>
                      <strong>₹{money(m.amount)}</strong>
                    </div>
                  )
                })}
                {rebuildPreview.matches.length === 0 && (
                  <p className="p-3 text-center text-sm text-gray-500">
                    No proposed links.
                  </p>
                )}
              </div>
            </details>

            <details className="mt-2 rounded-lg border">
              <summary className="cursor-pointer p-3 text-sm font-semibold hover:bg-gray-50">
                Unused receipt amounts ({rebuildPreview.unmatchedPayments.length})
              </summary>
              <div className="divide-y border-t">
                {rebuildPreview.unmatchedPayments.map(p => {
                  const payment = payments.find(item => item.payment_id === p.payment_id)
                  return (
                    <div key={p.payment_id} className="flex justify-between gap-3 p-3 text-sm">
                      <span>
                        {dateLabel(p.payment_date)}
                        {payment?.payment_mode ? ` · ${payment.payment_mode}` : ''}
                      </span>
                      <strong>₹{money(p.amount)}</strong>
                    </div>
                  )
                })}
                {rebuildPreview.unmatchedPayments.length === 0 && (
                  <p className="p-3 text-sm text-gray-500">No unused receipts.</p>
                )}
              </div>
            </details>

            <details className="mt-2 rounded-lg border">
              <summary className="cursor-pointer p-3 text-sm font-semibold hover:bg-gray-50">
                Unmatched invoice paid amounts ({rebuildPreview.unmatchedInvoices.length})
              </summary>
              <div className="divide-y border-t">
                {rebuildPreview.unmatchedInvoices.map(s => (
                  <div key={s.sale_id} className="flex justify-between gap-3 p-3 text-sm">
                    <span>Invoice · {dateLabel(s.bill_date)}</span>
                    <strong>₹{money(s.amount)}</strong>
                  </div>
                ))}
                {rebuildPreview.unmatchedInvoices.length === 0 && (
                  <p className="p-3 text-sm text-gray-500">No unmatched invoice amounts.</p>
                )}
              </div>
            </details>

            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              These figures are a local draft. Generate a database preview
              below before applying. No database changes occur until you
              press Apply full rebuild.
            </p>

            {databaseRebuildPreview && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
                <p className="font-semibold text-green-800">
                  Database preview verified
                </p>
                <p className="mt-1 text-sm text-green-800">
                  {databaseRebuildPreview.matches.length} proposed links ·
                  {' '}₹{money(Number(databaseRebuildPreview.proposed_allocation_total))}
                </p>
              </div>
            )}

            {databaseRebuildImpact && (
              <div className="mt-4 space-y-4 rounded-xl border-2 border-amber-300 bg-amber-50/60 p-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Will the existing receipts cover every recorded invoice payment?</h3>
                  <p className="mt-1 text-sm text-gray-700">
                    This is the main reconciliation check. The rebuild only creates links; it does not add missing receipts or change invoice paid amounts.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="rounded-lg bg-white p-3">
                    <p className="text-xs text-gray-500">Paid recorded on invoices</p>
                    <p className="text-lg font-bold">₹{money(databaseRebuildImpact.recordedInvoicePaidTotal)}</p>
                  </div>
                  <div className="rounded-lg bg-white p-3">
                    <p className="text-xs text-gray-500">Non-reversed receipts entered</p>
                    <p className="text-lg font-bold">₹{money(databaseRebuildImpact.nonReversedReceiptTotal)}</p>
                  </div>
                  <div className="rounded-lg bg-white p-3">
                    <p className="text-xs text-gray-500">Receipts proposed for linking</p>
                    <p className="text-lg font-bold text-emerald-700">₹{money(databaseRebuildImpact.proposedAllocationTotal)}</p>
                  </div>
                  <div className="rounded-lg bg-white p-3">
                    <p className="text-xs text-gray-500">Unused receipts after preview</p>
                    <p className="text-lg font-bold">₹{money(databaseRebuildImpact.unusedReceiptTotal)}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-rose-300 bg-white p-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-rose-800">Recorded invoice payments with no receipt link</p>
                      <p className="mt-1 text-xs text-gray-600">
                        {databaseRebuildImpact.unmatchedPaidRows.length} invoice(s) still have a paid amount that the available receipts cannot explain.
                      </p>
                    </div>
                    <p className="text-2xl font-bold tabular-nums text-rose-700">₹{money(databaseRebuildImpact.unmatchedPaidTotal)}</p>
                  </div>
                  {databaseRebuildImpact.unusedReceiptTotal <= 0.009 ? (
                    <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-medium text-rose-800">
                      There are no unused non-reversed receipts left to cover this amount. The current payment records are short by ₹{money(databaseRebuildImpact.receiptGap)} against the unmatched invoice-paid entries.
                    </p>
                  ) : (
                    <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                      ₹{money(databaseRebuildImpact.unusedReceiptTotal)} in receipts remains unused. These receipts must be checked against invoice dates and eligibility; their existence alone does not prove they can cover the unmatched amounts.
                    </p>
                  )}
                  <p className="mt-2 text-sm text-gray-700">
                    This points to missing payment entries or historical/manual paid entries. It does <strong>not</strong> by itself prove that sales invoices or sale items are missing.
                  </p>

                  <details className="mt-3 rounded-lg border">
                    <summary className="cursor-pointer p-3 text-sm font-semibold hover:bg-gray-50">
                      Show the invoices behind the ₹{money(databaseRebuildImpact.unmatchedPaidTotal)} gap ({databaseRebuildImpact.unmatchedPaidRows.length})
                    </summary>
                    <div className="divide-y">
                      {databaseRebuildImpact.unmatchedPaidRows.map((row: any, index: number) => (
                        <div key={`${row.sale_id ?? 'unmatched'}-${index}`} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                          <div>
                            <p className="font-semibold">Invoice · {dateLabel(row.bill_date)}</p>
                            <p className="text-xs text-gray-500">Invoice total ₹{money(Number(row.invoiceTotal || 0))} · Recorded paid ₹{money(Number(row.recordedPaid || row.amount || 0))}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-rose-700">₹{money(Number(row.amount || 0))} unmatched</p>
                          </div>
                        </div>
                      ))}
                      {databaseRebuildImpact.unmatchedPaidRows.length === 0 && (
                        <p className="p-3 text-sm text-gray-500">No unmatched invoice-paid amounts.</p>
                      )}
                    </div>
                  </details>

                  <details className="mt-2 rounded-lg border">
                    <summary className="cursor-pointer p-3 text-sm font-semibold hover:bg-gray-50">
                      Show receipts left unused ({databaseRebuildImpact.unmatchedReceiptRows.length})
                    </summary>
                    <div className="divide-y">
                      {databaseRebuildImpact.unmatchedReceiptRows.map((row: any, index: number) => (
                        <div key={`${row.payment_id ?? 'receipt'}-${index}`} className="flex items-center justify-between gap-3 p-3 text-sm">
                          <span>{dateLabel(row.payment_date || '')}</span>
                          <strong className="text-emerald-700">₹{money(Number(row.amount || 0))}</strong>
                        </div>
                      ))}
                      {databaseRebuildImpact.unmatchedReceiptRows.length === 0 && (
                        <p className="p-3 text-sm text-gray-500">No unused receipts. Every eligible receipt is already proposed for allocation.</p>
                      )}
                    </div>
                  </details>
                </div>

                <div className="rounded-xl border bg-white p-4">
                  <h3 className="font-semibold text-gray-900">Invoice balances after rebuild</h3>
                  <p className="mt-1 text-xs text-gray-600">
                    Outstanding is calculated from the invoice's existing recorded paid amount because the rebuild does not change it. The linked and unlinked columns show how much of that recorded paid amount has a receipt behind it.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Fully paid</p>
                      <p className="text-xl font-bold text-emerald-700">{databaseRebuildImpact.fullyPaid}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Partially paid</p>
                      <p className="text-xl font-bold text-amber-700">{databaseRebuildImpact.partiallyPaid}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Unpaid</p>
                      <p className="text-xl font-bold text-rose-700">{databaseRebuildImpact.unpaid}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Total outstanding</p>
                      <p className="text-lg font-bold">₹{money(databaseRebuildImpact.totalOutstanding)}</p>
                    </div>
                  </div>
                  <details className="mt-3 rounded-lg border">
                    <summary className="cursor-pointer p-3 text-sm font-semibold hover:bg-gray-50">
                      Invoice-by-invoice result ({databaseRebuildImpact.rows.length})
                    </summary>
                    <div className="divide-y">
                      {databaseRebuildImpact.rows
                        .slice()
                        .sort((a, b) => new Date(a.bill_date).getTime() - new Date(b.bill_date).getTime())
                        .map(invoice => (
                          <div key={invoice.sale_id} className="space-y-2 p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="font-semibold">Invoice · {dateLabel(invoice.bill_date)}</p>
                                <p className={`text-xs ${invoice.proposedStatus === 'Fully paid' ? 'text-emerald-700' : invoice.proposedStatus === 'Partially paid' ? 'text-amber-700' : 'text-rose-700'}`}>
                                  {invoice.proposedStatus} · {invoice.linkStatus}
                                </p>
                              </div>
                              <p className="font-bold">Outstanding ₹{money(invoice.proposedRemaining)}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                              <p>Total<br/><strong>₹{money(Number(invoice.total_amount))}</strong></p>
                              <p>Recorded paid<br/><strong>₹{money(invoice.recordedPaid)}</strong></p>
                              <p>Receipt linked<br/><strong className="text-emerald-700">₹{money(invoice.proposedAllocated)}</strong></p>
                              <p>Paid but unlinked<br/><strong className={invoice.unlinkedPaid > 0.009 ? 'text-rose-700' : 'text-gray-700'}>₹{money(invoice.unlinkedPaid)}</strong></p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </details>
                </div>

                <div className="rounded-xl border bg-white p-4">
                  <h3 className="font-semibold">Check whether invoice item entries are incomplete</h3>
                  <p className="mt-1 text-xs text-gray-600">
                    This separately compares each invoice total with the sum of its saved sale-item lines. A difference needs checking (taxes, discounts or other charges may explain it); it is not automatically proof of a missing item.
                  </p>
                  <p className="mt-2 text-sm font-semibold">
                    {databaseRebuildImpact.itemAuditRows.length === 0
                      ? 'All invoices have item lines and their line totals match invoice totals.'
                      : `${databaseRebuildImpact.itemAuditRows.length} invoice(s) have no item lines or a difference between item-line total and invoice total.`}
                  </p>
                  {databaseRebuildImpact.itemAuditRows.length > 0 && (
                    <details className="mt-2 rounded-lg border">
                      <summary className="cursor-pointer p-3 text-sm font-semibold hover:bg-gray-50">
                        Show invoice item-total checks ({databaseRebuildImpact.itemAuditRows.length})
                      </summary>
                      <div className="divide-y">
                        {databaseRebuildImpact.itemAuditRows.map(invoice => (
                          <div key={invoice.sale_id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                            <div>
                              <p className="font-medium">Invoice · {dateLabel(invoice.bill_date)}</p>
                              <p className="text-xs text-gray-500">{invoice.lineCount} item line(s) · Item total ₹{money(invoice.lineTotal)}</p>
                            </div>
                            <p className="font-semibold text-amber-700">Invoice/line difference ₹{money(invoice.itemDifference)}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                <p className="text-xs text-gray-700">
                  The ₹{money(databaseRebuildImpact.unmatchedPaidTotal)} is an unmatched recorded-paid amount, not an extra amount added to customer outstanding. No sales, item lines, payment records or balances are changed by generating this preview.
                </p>
              </div>
            )}

            {lastRebuildId && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">
                  Previous allocation backup is available
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  You can restore the previous allocation links if required.
                </p>
                <button
                  type="button"
                  onClick={restoreFullRebuild}
                  disabled={saving}
                  className="mt-3 rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
                >
                  Restore previous allocations
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={generateDatabaseRebuildPreview}
                disabled={saving}
                className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                {saving ? 'Please wait...' : 'Generate database preview'}
              </button>

              <button
                type="button"
                onClick={applyFullRebuild}
                disabled={saving || !databaseRebuildPreview || !databaseRebuildImpact}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Apply full rebuild
              </button>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              Apply is enabled only after a successful database preview.
              The database checks that the approved preview has not changed
              before applying.
            </p>
          </section>

          {/* Audit history */}
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Allocation history</h2>

            {history.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">
                No allocation history found.
              </p>
            ) : (
              <div className="mt-3 divide-y">
                {history.map(item => {
                  const payment = payments.find(p => p.payment_id === item.payment_id)
                  const invoice = sales.find(s => s.sale_id === item.to_sale_id)

                  return (
                    <div key={item.audit_id} className="py-3 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <strong>
                          {item.action === 'historical_link'
                            ? 'Historical link'
                            : item.action === 'allocate'
                              ? 'New allocation'
                              : item.action === 'move'
                                ? 'Allocation moved'
                                : item.action}
                        </strong>
                        <strong>{paidAmount(Number(item.amount))}</strong>
                      </div>

                      <p className="mt-1 text-gray-600">
                        Receipt · {payment
                          ? dateLabel(payment.payment_date)
                          : 'Date unavailable'}
                        {' · '}
                        Invoice · {invoice
                          ? dateLabel(invoice.bill_date)
                          : 'Date unavailable'}
                      </p>

                      {item.from_sale_id && (
                        <p className="mt-1 text-gray-600">
                          Previous invoice link was moved.
                        </p>
                      )}

                      {item.reason && (
                        <p className="mt-1 text-gray-600">
                          Reason: {item.reason}
                        </p>
                      )}

                      <p className="mt-1 text-xs text-gray-400">
                        {new Date(item.created_at).toLocaleString('en-IN')}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}

      {error && (
        <div className="break-words rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {message && (
        <div className="break-words rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {message}
        </div>
      )}
    </main>
  )
}