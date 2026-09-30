'use client'

import * as React from 'react'
import { Check, ChevronDown, Plus, X } from 'lucide-react'

export type ComboOption = {
  value: string
  label: string
  isNew?: boolean
}

type SmartComboboxProps = {
  options: { value: number | string; label: string }[]
  value: string | null
  onValueChange: (value: string, label: string, isNew: boolean) => void
  placeholder?: string
  disabled?: boolean
  allowCreate?: boolean
  onTabKey?: () => void
  inputDataAttr?: string
  focusNextOnSelect?: boolean
  nextFieldSelector?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  onSearch?: (query: string) => void
  searchDebounceMs?: number
}

function splitLabel(label: string): {
  primary: string
  secondary: string
} {
  const parts = label.split('·').map((s) => s.trim())
  return {
    primary: parts[0] || label,
    secondary: parts.slice(1).filter(Boolean).join(' · '),
  }
}

function focusElement(el: HTMLElement | null) {
  if (!el) return
  el.focus()
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement
  ) {
    try {
      el.select()
    } catch {
      // ignore
    }
  }
}

function findNextFieldAfter(from: HTMLElement | null): HTMLElement | null {
  if (!from) return null
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
    )
  ).filter((el) => !!el.offsetParent)
  const idx = all.indexOf(from)
  if (idx === -1) return null
  return all[idx + 1] || null
}

export function SmartCombobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select or type...',
  disabled = false,
  allowCreate = true,
  onTabKey,
  inputDataAttr,
  focusNextOnSelect = false,
  nextFieldSelector,
  inputRef: externalInputRef,
  onSearch,
  searchDebounceMs = 300,
}: SmartComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [inputText, setInputText] = React.useState('')
  const [hovered, setHovered] = React.useState(false)
  // Tracks whether the user is actively typing (vs. just displaying a selected label)
  const [typing, setTyping] = React.useState(false)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const internalRef = React.useRef<HTMLInputElement>(null)
  const inputRef = externalInputRef ?? internalRef

  // Store onSearch in a ref so debounce effect doesn't depend on it
  const onSearchRef = React.useRef(onSearch)
  React.useEffect(() => {
    onSearchRef.current = onSearch
  }, [onSearch])

  const stringOptions: ComboOption[] = React.useMemo(
    () => options.map((o) => ({ ...o, value: String(o.value) })),
    [options]
  )

  const selectedOption = stringOptions.find((o) => o.value === value)

  // Sync input text when the external value changes and the user isn't typing
  React.useEffect(() => {
    if (!typing) {
      if (value === null || value === '') {
        setInputText('')
      } else if (selectedOption) {
        const { primary } = splitLabel(selectedOption.label)
        setInputText(primary)
      }
    }
  }, [value, selectedOption, typing])

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
        // If the user typed but didn't select, revert to the selected label
        setTyping(false)
        if (selectedOption) {
          const { primary } = splitLabel(selectedOption.label)
          setInputText(primary)
        } else {
          setInputText('')
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [selectedOption])

  // Debounced server-side search
  const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    if (!onSearchRef.current) return
    if (!typing) return // don't search when we're just displaying a label
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      onSearchRef.current?.(inputText.trim())
    }, searchDebounceMs)
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [inputText, searchDebounceMs, typing])

  const trimmed = inputText.trim().toLowerCase()

  const filteredOptions = React.useMemo(() => {
    if (onSearch) return stringOptions
    if (!typing || !trimmed) return stringOptions
    const prefix: ComboOption[] = []
    const substring: ComboOption[] = []
    for (const o of stringOptions) {
      const lower = o.label.toLowerCase()
      if (lower.startsWith(trimmed)) prefix.push(o)
      else if (lower.includes(trimmed)) substring.push(o)
    }
    return [...prefix, ...substring]
  }, [stringOptions, trimmed, onSearch, typing])

  const exactMatch = stringOptions.some(
    (o) => o.label.toLowerCase() === trimmed
  )
  const showCreateOption =
    allowCreate && typing && inputText.trim().length > 0 && !exactMatch

  // Show clear button when there's a value OR the user has typed something
  const hasContent = !!value || inputText.length > 0
  const showClear = (hovered || open) && hasContent

  function moveFocusAfterSelect() {
    if (!focusNextOnSelect) return

    const tryFocus = () => {
      if (nextFieldSelector) {
        const el = document.querySelector<HTMLElement>(nextFieldSelector)
        if (el && el.offsetParent) {
          focusElement(el)
          return
        }
      }
      const next = findNextFieldAfter(inputRef.current)
      if (next) {
        focusElement(next)
      }
    }

    tryFocus()
    requestAnimationFrame(tryFocus)
    setTimeout(tryFocus, 120)
  }

  function selectOption(newValue: string, newLabel: string, isNew: boolean) {
    onValueChange(newValue, newLabel, isNew)
    const { primary } = splitLabel(newLabel)
    setInputText(primary)
    setOpen(false)
    setTyping(false)
    moveFocusAfterSelect()
  }

  function clearValue() {
    setInputText('')
    setTyping(false)
    onValueChange('', '', false)
    setOpen(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <div
        className="relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <input
          ref={inputRef}
          type="text"
          data-row-item={inputDataAttr}
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value)
            setTyping(true)
            setOpen(true)
            if (!e.target.value) onValueChange('', '', false)
          }}
          onFocus={(e) => {
            setOpen(true)
            // If a value is already selected and user hasn't started typing,
            // select all text so typing replaces it
            if (value && !typing) {
              try {
                e.target.select()
              } catch {
                // ignore
              }
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              setOpen(false)
              // Commit display back to selected label
              setTyping(false)
              if (selectedOption) {
                const { primary } = splitLabel(selectedOption.label)
                setInputText(primary)
              } else {
                setInputText('')
              }
              if (onTabKey) onTabKey()
            }
            if (e.key === 'Escape') {
              if (typing && (inputText.length > 0 || value)) {
                // First Escape: revert to selected label (or clear)
                setTyping(false)
                if (selectedOption) {
                  const { primary } = splitLabel(selectedOption.label)
                  setInputText(primary)
                } else {
                  setInputText('')
                }
              } else {
                // Second Escape (or nothing to revert): close dropdown
                setOpen(false)
              }
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full h-11 md:h-9 pl-3 pr-10 md:pr-8 text-base md:text-sm border border-slate-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />

        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            if (showClear) {
              clearValue()
            } else {
              setOpen(!open)
            }
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          tabIndex={-1}
          aria-label={showClear ? 'Clear' : 'Open'}
        >
          {showClear ? (
            <X className="w-5 h-5 md:w-4 md:h-4" />
          ) : (
            <ChevronDown className="w-5 h-5 md:w-4 md:h-4" />
          )}
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-[60vh] md:max-h-64 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-lg">
          {filteredOptions.length === 0 && !showCreateOption && (
            <div className="px-3 py-3 text-sm text-slate-400">
              {onSearch && inputText.trim().length < 2
                ? 'Type at least 2 letters to search…'
                : 'No matches.'}
            </div>
          )}

          {filteredOptions.map((opt) => {
            const { primary, secondary } = splitLabel(opt.label)
            const isSelected = value === opt.value
            return (
              <div
                key={opt.value}
                onPointerDown={(e) => {
                  e.preventDefault()
                  selectOption(opt.value, opt.label, false)
                }}
                className={`cursor-pointer px-3 py-3 md:py-2 text-sm hover:bg-slate-100 flex items-center justify-between gap-2 border-b border-slate-100 last:border-b-0 ${
                  isSelected ? 'bg-blue-50' : ''
                }`}
              >
                <span
                  className={`hidden md:block truncate flex-1 ${
                    isSelected
                      ? 'font-semibold text-blue-800'
                      : 'font-medium text-slate-800'
                  }`}
                >
                  {opt.label}
                </span>

                <div className="md:hidden flex flex-col gap-0.5 min-w-0 flex-1">
                  <span
                    className={`text-sm truncate ${
                      isSelected
                        ? 'font-semibold text-blue-800'
                        : 'font-medium text-slate-800'
                    }`}
                  >
                    {primary}
                  </span>
                  {secondary && (
                    <span className="text-xs text-slate-500 truncate">
                      {secondary}
                    </span>
                  )}
                </div>

                {isSelected && (
                  <Check className="w-4 h-4 text-blue-600 shrink-0" />
                )}
              </div>
            )
          })}

          {showCreateOption && (
            <div className="border-t border-slate-200 bg-slate-50">
              <div
                onPointerDown={(e) => {
                  e.preventDefault()
                  selectOption(inputText.trim(), inputText.trim(), true)
                }}
                className="cursor-pointer w-full text-center px-3 py-3 md:py-2 text-xs text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-1"
              >
                <Plus className="size-3" />
                <span>Add &ldquo;{inputText.trim()}&rdquo; as new</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}