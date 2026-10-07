import type { MouseEvent, ReactElement, ReactNode } from 'react'
import { Check, ChevronRight, Search, X } from 'lucide-react'
import { Children, cloneElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePresence } from '../../motion'
import Glide from '../Glide'
import { filterDropdownItems } from './filter'
import styles from './styles.module.css'

type Placement = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
type Source = 'trigger' | 'menu'

export interface DropdownItem {
  key: string
  label: ReactNode
  extra?: ReactNode
  disabled?: boolean
  selected?: boolean
  /** Group headings render inline. Other items with children fly out. */
  type?: 'item' | 'group'
  children?: DropdownItem[]
  onClick?: () => void
}

interface Props {
  menu: { items: DropdownItem[] }
  open?: boolean
  onOpenChange?: (open: boolean, info: { source: Source }) => void
  placement?: Placement
  /** Menu grows with its labels, at least 220px, and stops at this width. */
  maxWidth?: number
  /** Filter rows from a field at the top of the menu. */
  search?: boolean
  trigger?: Array<'click' | 'hover'>
  children: ReactElement<{
    onClick?: (event: MouseEvent<HTMLElement>) => void
    onMouseEnter?: (event: MouseEvent<HTMLElement>) => void
    className?: string
    disabled?: boolean
  }>
}

const PLACEMENT_ATTR = {
  topLeft: 'top-left',
  topRight: 'top-right',
  bottomLeft: 'bottom-left',
  bottomRight: 'bottom-right',
} as const

function placementOrigin(placement: Placement) {
  const vertical = placement.startsWith('top') ? 'bottom' : 'top'
  const horizontal = placement.endsWith('Left') ? 'left' : 'right'
  return `${vertical}-${horizontal}`
}

/** rc-menu defaults: subMenuOpenDelay / subMenuCloseDelay are 0.1s. */
const SUBMENU_DELAY = 100
/** antd dropdown offset is marginXXS. */
const GAP = 4

interface Box { x: number, y: number, w: number, h: number }
type Side = 'left' | 'right'
type AlignY = 'top' | 'bottom'

function viewport() {
  const root = document.documentElement
  return { l: 0, t: 0, r: root.clientWidth, b: root.clientHeight }
}

function visibleArea(box: Box, view: ReturnType<typeof viewport>) {
  const right = Math.min(box.x + box.w, view.r) - Math.max(box.x, view.l)
  const bottom = Math.min(box.y + box.h, view.b) - Math.max(box.y, view.t)
  return Math.max(0, right) * Math.max(0, bottom)
}

/** Corner placements flip on each axis. antd does not shift topLeft / topRight / bottomLeft / bottomRight. */
function flipPlacement(preferred: Placement, target: DOMRect, width: number, height: number) {
  const view = viewport()
  const boxOf = (placement: Placement): Box => {
    if (placement === 'topLeft')
      return { x: target.left, y: target.top - GAP - height, w: width, h: height }
    if (placement === 'topRight')
      return { x: target.right - width, y: target.top - GAP - height, w: width, h: height }
    if (placement === 'bottomLeft')
      return { x: target.left, y: target.bottom + GAP, w: width, h: height }
    return { x: target.right - width, y: target.bottom + GAP, w: width, h: height }
  }
  const origin = boxOf(preferred)
  const originArea = visibleArea(origin, view)
  let current = preferred
  const flipY: Record<Placement, Placement> = {
    topLeft: 'bottomLeft',
    topRight: 'bottomRight',
    bottomLeft: 'topLeft',
    bottomRight: 'topRight',
  }
  const overflowsY = preferred.startsWith('top') ? origin.y < view.t : origin.y + origin.h > view.b
  if (overflowsY && visibleArea(boxOf(flipY[preferred]), view) > originArea)
    current = flipY[preferred]
  const flipX: Record<Placement, Placement> = {
    topLeft: 'topRight',
    topRight: 'topLeft',
    bottomLeft: 'bottomRight',
    bottomRight: 'bottomLeft',
  }
  const overflowsX = preferred.endsWith('Left') ? origin.x + origin.w > view.r : origin.x < view.l
  if (overflowsX && visibleArea(boxOf(flipX[current]), view) > originArea)
    current = flipX[current]
  return current
}

/** rc-menu rightTop. Flip down only when the full panel would leave the viewport. */
function flipSubmenu(row: DOMRect, width: number, height: number, insetTop: number, insetBottom: number) {
  const view = viewport()
  const boxOf = (side: Side, align: AlignY): Box => ({
    x: side === 'right' ? row.right + GAP : row.left - GAP - width,
    y: align === 'top' ? row.top - insetTop : row.bottom + insetBottom - height,
    w: width,
    h: height,
  })
  const origin = boxOf('right', 'top')
  const originArea = visibleArea(origin, view)
  let side: Side = 'right'
  let align: AlignY = 'top'
  if (origin.y + origin.h > view.b && visibleArea(boxOf('right', 'bottom'), view) > originArea)
    align = 'bottom'
  if (origin.x + origin.w > view.r && visibleArea(boxOf('left', align), view) > originArea)
    side = 'left'
  return { side, align }
}

export default function Dropdown({
  menu,
  open,
  onOpenChange,
  placement = 'bottomLeft',
  maxWidth,
  search = false,
  trigger = ['click'],
  children,
}: Props) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const anchorRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  const controlledRef = useRef(open !== undefined)
  onOpenChangeRef.current = onOpenChange
  controlledRef.current = open !== undefined
  const mergedOpen = open ?? uncontrolledOpen
  const presence = usePresence(mergedOpen, '--dropdown-close-dur', 150)
  const child = Children.only(children) // eslint-disable-line react/no-children-only -- antd Dropdown requires exactly one trigger element

  function setMergedOpen(next: boolean, source: Source) {
    if (!next) {
      setOpenKey(null)
      setQuery('')
    }
    onOpenChangeRef.current?.(next, { source })
    if (!controlledRef.current)
      setUncontrolledOpen(next)
  }

  function clearTimers() {
    if (openTimerRef.current !== null)
      window.clearTimeout(openTimerRef.current)
    if (closeTimerRef.current !== null)
      window.clearTimeout(closeTimerRef.current)
    openTimerRef.current = null
    closeTimerRef.current = null
  }

  function openSubmenu(key: string) {
    setOpenKey(key)
  }

  function scheduleOpen(key: string, target: HTMLElement) {
    clearTimers()
    anchorRef.current = target
    if (openKey) {
      setOpenKey(key)
      return
    }
    openTimerRef.current = window.setTimeout(openSubmenu, SUBMENU_DELAY, key)
  }

  function scheduleClose() {
    if (closeTimerRef.current !== null)
      window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(setOpenKey, SUBMENU_DELAY, null)
  }

  useEffect(() => () => clearTimers(), [])

  useEffect(() => {
    if (!mergedOpen)
      return
    function closeFromTrigger() {
      setOpenKey(null)
      setQuery('')
      onOpenChangeRef.current?.(false, { source: 'trigger' })
      if (!controlledRef.current)
        setUncontrolledOpen(false)
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target))
        return
      closeFromTrigger()
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape')
        return
      closeFromTrigger()
      rootRef.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [mergedOpen])

  function activate(item: DropdownItem, target: HTMLElement) {
    if (!item.children?.length || item.disabled)
      return
    scheduleOpen(item.key, target)
  }

  useLayoutEffect(() => {
    const popup = popupRef.current
    if (!mergedOpen || !popup)
      return
    function align() {
      const trigger = rootRef.current?.querySelector(':scope > button')
      const menuEl = popup?.querySelector('[role="menu"]')
      if (!popup || !trigger || !(menuEl instanceof HTMLElement))
        return
      const next = flipPlacement(placement, trigger.getBoundingClientRect(), menuEl.offsetWidth, menuEl.offsetHeight)
      popup.dataset.placement = PLACEMENT_ATTR[next]
      popup.dataset.origin = placementOrigin(next)
    }
    align()
    window.addEventListener('resize', align)
    window.addEventListener('scroll', align, true)
    return () => {
      window.removeEventListener('resize', align)
      window.removeEventListener('scroll', align, true)
    }
  }, [mergedOpen, presence.mounted, placement, menu.items, query])

  function pick(item: DropdownItem) {
    if (item.disabled)
      return
    if (item.children?.length)
      return
    item.onClick?.()
    setMergedOpen(false, 'menu')
  }

  const visibleItems = search ? filterDropdownItems(menu.items, query) : menu.items
  const openItem = visibleItems.find(item => item.key === openKey)

  useLayoutEffect(() => {
    if (mergedOpen && search)
      searchRef.current?.focus()
  }, [mergedOpen, presence.mounted, search])

  return (
    <span
      ref={rootRef}
      className={styles.root}
      onMouseLeave={() => {
        if (trigger.includes('hover'))
          setMergedOpen(false, 'trigger')
      }}
    >
      {/* antd Dropdown clones trigger props onto the single child. */}
      {/* eslint-disable-next-line react/no-clone-element */}
      {cloneElement(child, {
        'aria-haspopup': 'menu',
        'aria-expanded': mergedOpen,
        'onMouseEnter': (event) => {
          child.props.onMouseEnter?.(event)
          if (trigger.includes('hover'))
            setMergedOpen(true, 'trigger')
        },
        'onClick': (event) => {
          child.props.onClick?.(event)
          if (trigger.includes('click'))
            setMergedOpen(!mergedOpen, 'trigger')
        },
      } as Partial<typeof child.props>)}
      {presence.mounted
        ? (
            <div
              ref={popupRef}
              className={`${styles.popup} t-dropdown ${presence.className}`}
              onBlur={(event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
                  return
                scheduleClose()
              }}
            >
              <div className={styles.menu} style={maxWidth === undefined ? undefined : { maxWidth }}>
                {search
                  ? (
                      <div className={styles.search}>
                        <Search size={14} />
                        <input
                          ref={searchRef}
                          value={query}
                          placeholder="搜索"
                          aria-label="搜索"
                          onChange={event => setQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape' && query) {
                              event.stopPropagation()
                              setQuery('')
                            }
                          }}
                        />
                        {query
                          ? (
                              <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}>
                                <X size={12} />
                              </button>
                            )
                          : null}
                      </div>
                    )
                  : null}
                <div role="menu">
                  {visibleItems.length
                    ? (
                        <Glide className={styles.list} pin={visibleItems.find(item => item.selected)?.key}>
                          {visibleItems.map(item => (
                            <button
                              key={item.key}
                              type="button"
                              data-glide={item.key}
                              className={styles.item}
                              disabled={item.disabled}
                              role={item.selected === undefined ? 'menuitem' : 'menuitemradio'}
                              aria-checked={item.selected}
                              aria-haspopup={item.children?.length ? 'menu' : undefined}
                              aria-expanded={item.children?.length ? openKey === item.key : undefined}
                              onMouseEnter={event => activate(item, event.currentTarget)}
                              onMouseLeave={() => item.children?.length && scheduleClose()}
                              onFocus={event => activate(item, event.currentTarget)}
                              onClick={() => pick(item)}
                            >
                              <span className={styles.label}>{item.label}</span>
                              {(item.extra || item.children?.length)
                                ? (
                                    <span className={styles.extra}>
                                      {item.extra ? <span>{item.extra}</span> : null}
                                      {item.children?.length ? <ChevronRight size={14} /> : null}
                                    </span>
                                  )
                                : null}
                              {item.selected ? <Check size={14} /> : null}
                            </button>
                          ))}
                        </Glide>
                      )
                    : <div className={styles.empty}>没有匹配</div>}
                </div>
              </div>
              {openItem?.children?.length
                ? (
                    <Flyout
                      anchor={anchorRef.current}
                      itemKey={openItem.key}
                      pin={pinnedKey(openItem.children)}
                      label={typeof openItem.label === 'string' ? openItem.label : openItem.key}
                      onEnter={clearTimers}
                      onLeave={scheduleClose}
                    >
                      <ItemList items={openItem.children} onPick={pick} />
                    </Flyout>
                  )
                : null}
            </div>
          )
        : null}
    </span>
  )
}

function pinnedKey(items: DropdownItem[]): string | undefined {
  for (const item of items) {
    if (item.selected)
      return item.key
    if (item.children?.length) {
      const nested = pinnedKey(item.children)
      if (nested)
        return nested
    }
  }
}

function Flyout({
  anchor,
  itemKey,
  pin,
  label,
  onEnter,
  onLeave,
  children,
}: {
  anchor: HTMLElement | null
  itemKey: string
  pin?: string
  label: string
  onEnter: () => void
  onLeave: () => void
  children: ReactNode
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const shownRef = useRef(false)
  const presence = usePresence(true, '--dropdown-close-dur', 150)
  useLayoutEffect(() => {
    const frame = frameRef.current
    const panel = panelRef.current
    const scroller = scrollerRef.current
    if (!frame || !panel || !scroller || !anchor)
      return
    function align() {
      if (!frame || !panel || !scroller || !anchor)
        return
      const animate = shownRef.current
      if (!animate)
        frame.style.transition = 'none'
      const width = frame.offsetWidth || 240
      const saved = scroller.scrollTop
      scroller.style.height = 'auto'
      const contentHeight = scroller.offsetHeight
      scroller.style.height = ''
      const panelStyle = getComputedStyle(panel)
      const insetTop = Number.parseFloat(panelStyle.borderTopWidth) + Number.parseFloat(panelStyle.paddingTop)
      const insetBottom = Number.parseFloat(panelStyle.borderBottomWidth) + Number.parseFloat(panelStyle.paddingBottom)
      const row = anchor.getBoundingClientRect()
      const host = frame.offsetParent instanceof HTMLElement ? frame.offsetParent.getBoundingClientRect() : new DOMRect()
      const height = Math.min(320, contentHeight + insetTop + insetBottom)
      const placed = flipSubmenu(row, width, height, insetTop, insetBottom)
      const frameTop = placed.align === 'top'
        ? row.top - insetTop
        : row.bottom + insetBottom - height
      const top = frameTop - host.top
      const left = placed.side === 'right'
        ? row.right - host.left + GAP
        : row.left - host.left - GAP - width
      frame.style.height = `${height}px`
      frame.style.top = `${top}px`
      frame.style.left = `${left}px`
      panel.dataset.origin = `${placed.align === 'top' ? 'top' : 'bottom'}-${placed.side === 'right' ? 'left' : 'right'}`
      scroller.scrollTop = saved
      if (!animate) {
        void frame.offsetWidth
        frame.style.transition = ''
        shownRef.current = true
      }
    }
    align()
    function onScroll(event: Event) {
      if (event.target instanceof Node && frame.contains(event.target))
        return
      align()
    }
    window.addEventListener('resize', align)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', align)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [anchor, itemKey])
  return (
    <div
      ref={frameRef}
      className={`${styles.submenu} t-resize`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        ref={panelRef}
        className={`${styles.panel} t-dropdown ${presence.className}`}
        role="menu"
        aria-label={label}
      >
        <div ref={scrollerRef} className={styles.scroller}>
          <Glide className={styles.list} pin={pin}>
            {children}
          </Glide>
        </div>
      </div>
    </div>
  )
}

function ItemList({ items, onPick }: { items: DropdownItem[], onPick: (item: DropdownItem) => void }) {
  return items.map((item) => {
    if (item.type === 'group') {
      return (
        <div key={item.key} className={styles.group}>
          <div className={styles.groupLabel}>{item.label}</div>
          <ItemList items={item.children ?? []} onPick={onPick} />
        </div>
      )
    }
    return (
      <button
        key={item.key}
        type="button"
        role={item.selected === undefined ? 'menuitem' : 'menuitemradio'}
        aria-checked={item.selected}
        data-glide={item.key}
        className={styles.item}
        disabled={item.disabled}
        onClick={() => onPick(item)}
      >
        <span className={styles.label}>
          {item.label}
          {item.extra}
        </span>
        {item.selected ? <Check size={14} /> : null}
      </button>
    )
  })
}
