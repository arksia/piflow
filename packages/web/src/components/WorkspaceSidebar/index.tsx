import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import styles from './styles.module.css'

const SIDEBAR_WIDTH_KEY = 'piflow.sidebarWidth'
const MIN_SIDEBAR_WIDTH = 220
const MAX_SIDEBAR_WIDTH = 420

function readSidebarWidth() {
  const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY)
  const value = saved === null ? 264 : Number(saved)
  return Number.isFinite(value) ? Math.min(Math.max(value, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH) : 264
}

interface WorkspaceSidebarProps {
  children: ReactNode
  collapsed: boolean
  open: boolean
  narrow: boolean
  onClose: () => void
}

export default function WorkspaceSidebar({ children, collapsed, open, narrow, onClose }: WorkspaceSidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarWidthRef = useRef(sidebarWidth)
  const [isResizing, setIsResizing] = useState(false)
  const stopResizeRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopResizeRef.current?.(), [])

  useEffect(() => {
    if (!narrow || !open)
      return
    const previous = document.activeElement
    sidebarRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape')
        onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus()
    }
  }, [narrow, open, onClose])

  function saveWidth(width: number) {
    const next = Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH)
    sidebarWidthRef.current = next
    setSidebarWidth(next)
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next))
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (collapsed || event.button !== 0)
      return
    stopResizeRef.current?.()
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = sidebarWidth
    setIsResizing(true)
    const previousSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    function resize(moveEvent: PointerEvent) {
      const nextWidth = Math.min(Math.max(startWidth + moveEvent.clientX - startX, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH)
      sidebarWidthRef.current = nextWidth
      sidebarRef.current?.style.setProperty('--sidebar-width', `${nextWidth}px`)
    }

    function stop() {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      setSidebarWidth(sidebarWidthRef.current)
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current))
      setIsResizing(false)
      document.body.style.userSelect = previousSelect
      document.body.style.cursor = previousCursor
      stopResizeRef.current = null
    }

    stopResizeRef.current = stop
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  return (
    <>
      <aside
        ref={sidebarRef}
        aria-label="工作区导航"
        inert={narrow ? !open : collapsed}
        className={`${styles.sidebar} pf-shrink-0 pf-overflow-clip ${open ? styles.open : ''} ${collapsed ? styles.collapsed : ''} ${isResizing ? styles.resizing : ''}`}
        style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        <div className={`${styles.content} pf-h-full`}>{children}</div>
      </aside>
      <div
        className={`${styles.resizer} pf-z-2 pf-w-[6px] pf-mr-[-3px] pf-ml-[-3px] ${collapsed ? 'pf-hidden' : ''}`}
        role="separator"
        aria-label="调整会话列表宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={collapsed ? -1 : 0}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return
          event.preventDefault()
          const width = event.key === 'Home' ? MIN_SIDEBAR_WIDTH : event.key === 'End' ? MAX_SIDEBAR_WIDTH : sidebarWidth + (event.key === 'ArrowRight' ? 16 : -16)
          saveWidth(width)
        }}
        onDoubleClick={() => saveWidth(264)}
        onPointerDown={startResize}
        onLostPointerCapture={() => stopResizeRef.current?.()}
      />
      {open
        ? <button type="button" className={styles.scrim} aria-label="关闭会话列表" onClick={onClose} />
        : null}
    </>
  )
}
