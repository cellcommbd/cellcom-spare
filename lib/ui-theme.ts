
/**
 * CellCom Accounting - Universal UI Theme
 *
 * Central styling definitions for all application pages.
 * Presentation only: never use these styles to calculate balances,
 * payment status, returns, stock, or other accounting values.
 */

/* -------------------------------------------------------
   STATUS TYPES
------------------------------------------------------- */

export type AccountingStatus =
  | 'paid'
  | 'due'
  | 'partially_paid'
  | 'partial_return'
  | 'returned'
  | 'returned_with_balance'
  | 'info'
  | 'pending'
  | 'cancelled'

export type StatusStyle = {
  label: string
  badge: string
  text: string
  dot: string
  row: string
}

/* -------------------------------------------------------
   UNIVERSAL STATUS COLORS
------------------------------------------------------- */

export const statusStyles: Record<AccountingStatus, StatusStyle> = {
  paid: {
    label: 'Paid',
    badge: 'bg-green-100 text-green-800 border border-green-200',
    text: 'text-green-700',
    dot: 'bg-green-500',
    row: 'bg-green-50/50',
  },

  due: {
    label: 'Due',
    badge: 'bg-red-100 text-red-800 border border-red-200',
    text: 'text-red-700',
    dot: 'bg-red-500',
    row: 'bg-red-50/40',
  },

  partially_paid: {
    label: 'Partially Paid',
    badge: 'bg-amber-100 text-amber-800 border border-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    row: 'bg-amber-50/40',
  },

  partial_return: {
    label: 'Partial Return',
    badge: 'bg-purple-100 text-purple-800 border border-purple-200',
    text: 'text-purple-700',
    dot: 'bg-purple-500',
    row: 'bg-purple-50/40',
  },

  returned: {
    label: 'Returned',
    badge: 'bg-gray-100 text-gray-600 border border-gray-200',
    text: 'text-gray-500',
    dot: 'bg-gray-400',
    row: 'bg-gray-50',
  },

  returned_with_balance: {
    label: 'Returned - Balance Due',
    badge: 'bg-orange-100 text-orange-800 border border-orange-200',
    text: 'text-orange-700',
    dot: 'bg-orange-500',
    row: 'bg-orange-50/50',
  },

  info: {
    label: 'Information',
    badge: 'bg-blue-100 text-blue-800 border border-blue-200',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
    row: 'bg-blue-50/40',
  },

  pending: {
    label: 'Pending',
    badge: 'bg-sky-100 text-sky-800 border border-sky-200',
    text: 'text-sky-700',
    dot: 'bg-sky-500',
    row: 'bg-sky-50/40',
  },

  cancelled: {
    label: 'Cancelled',
    badge: 'bg-gray-100 text-gray-500 border border-gray-200',
    text: 'text-gray-500',
    dot: 'bg-gray-400',
    row: 'bg-gray-50',
  },
}

/* -------------------------------------------------------
   GENERAL COLOR PALETTE
------------------------------------------------------- */

export const uiColors = {
  primary: {
    bg: 'bg-indigo-600',
    hover: 'hover:bg-indigo-700',
    light: 'bg-indigo-50',
    text: 'text-indigo-700',
    border: 'border-indigo-200',
  },

  success: {
    bg: 'bg-green-600',
    hover: 'hover:bg-green-700',
    light: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
  },

  danger: {
    bg: 'bg-red-600',
    hover: 'hover:bg-red-700',
    light: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
  },

  warning: {
    bg: 'bg-amber-500',
    hover: 'hover:bg-amber-600',
    light: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
  },

  info: {
    bg: 'bg-blue-600',
    hover: 'hover:bg-blue-700',
    light: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
  },

  purple: {
    bg: 'bg-purple-600',
    hover: 'hover:bg-purple-700',
    light: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
  },

  neutral: {
    bg: 'bg-gray-100',
    hover: 'hover:bg-gray-200',
    light: 'bg-gray-50',
    text: 'text-gray-700',
    border: 'border-gray-200',
  },
} as const

/* -------------------------------------------------------
   COMMON PAGE LAYOUT
------------------------------------------------------- */

export const uiLayout = {
  page: 'w-full max-w-full mx-auto p-3 sm:p-4 lg:p-6 space-y-4',

  pageHeader:
    'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3',

  pageTitle: 'text-xl sm:text-2xl font-bold text-gray-800 tracking-tight',

  section:
    'bg-white border border-gray-200 rounded-xl shadow-sm p-3 sm:p-4 space-y-3',

  sectionTitle: 'text-base sm:text-lg font-semibold text-gray-800',

  grid: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3',

  divider: 'border-t border-gray-200',
} as const

/* -------------------------------------------------------
   COMMON BUTTONS
------------------------------------------------------- */

export const uiButtons = {
  base:
    'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1',

  primary:
    'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500',

  success:
    'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',

  danger:
    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',

  secondary:
    'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 focus:ring-gray-400',

  warning:
    'bg-amber-500 text-white hover:bg-amber-600 focus:ring-amber-400',

  small: 'px-2.5 py-1.5 text-xs',
} as const

/* -------------------------------------------------------
   FORM CONTROLS
------------------------------------------------------- */

export const uiInputs = {
  base:
    'w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100',

  label: 'block text-sm font-medium text-gray-700 mb-1',

  error: 'mt-1 text-xs text-red-600',

  disabled: 'bg-gray-100 text-gray-500 cursor-not-allowed',
} as const

/* -------------------------------------------------------
   TABLES
------------------------------------------------------- */

export const uiTables = {
  wrapper: 'w-full overflow-x-auto rounded-lg border border-gray-200',

  table: 'w-full text-sm text-left border-collapse',

  header: 'bg-gray-100 text-gray-600 text-xs uppercase tracking-wide',

  headerCell: 'px-3 py-3 font-semibold whitespace-nowrap',

  cell: 'px-3 py-3 text-gray-700',

  row: 'border-t border-gray-100 hover:bg-gray-50 transition-colors',

  alternateRow: 'even:bg-gray-50/70',

  number: 'text-right tabular-nums whitespace-nowrap',
} as const

/* -------------------------------------------------------
   AMOUNTS AND ACCOUNTING FIGURES
------------------------------------------------------- */

export const uiAmounts = {
  normal: 'font-semibold text-gray-800 tabular-nums',

  positive: 'font-semibold text-green-700 tabular-nums',

  negative: 'font-semibold text-red-700 tabular-nums',

  due: 'font-bold text-red-700 tabular-nums',

  total: 'text-xl sm:text-2xl font-bold text-gray-900 tabular-nums',

  subtotal: 'font-semibold text-blue-700 tabular-nums',

  allocated:
    'text-gray-500 line-through decoration-gray-400 decoration-1 tabular-nums',
} as const

/* -------------------------------------------------------
   CARDS AND SUMMARY BOXES
------------------------------------------------------- */

export const uiCards = {
  base: 'rounded-xl border border-gray-200 bg-white p-3 sm:p-4 shadow-sm',

  blue: 'rounded-xl border border-blue-200 bg-blue-50 p-3 sm:p-4',

  green: 'rounded-xl border border-green-200 bg-green-50 p-3 sm:p-4',

  red: 'rounded-xl border border-red-200 bg-red-50 p-3 sm:p-4',

  amber: 'rounded-xl border border-amber-200 bg-amber-50 p-3 sm:p-4',

  purple: 'rounded-xl border border-purple-200 bg-purple-50 p-3 sm:p-4',

  muted: 'rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4',
} as const

/* -------------------------------------------------------
   STATUS HELPER
------------------------------------------------------- */

/**
 * Returns the appearance for a known accounting status.
 * This function does not calculate or determine the status.
 */
export function getStatusStyle(status: AccountingStatus): StatusStyle {
  return statusStyles[status]
}
