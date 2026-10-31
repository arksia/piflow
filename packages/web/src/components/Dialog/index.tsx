import type { ReactNode, RefObject } from 'react'
import { X } from 'lucide-react'
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { tokenMs } from '../../motion'
import IconButton from '../IconButton'
import styles from './styles.module.css'

interface Props {
  title: string
  eyebrow?: string
  width?: number
  maxHeight?: number
  compact?: boolean
  responsive?: boolean
  initialFocus?: RefObject<HTMLElement | null>
  actions?: ReactNode
  describedBy?: string
  role?: 'dialog' | 'alertdialog'
  onClose: () => void
  children: ReactNode | ((close: () => void) => ReactNode)
}

let scrollLocks = 0
let previousOverflow = ''

export default function Dialog({ title, eyebrow, width = 560, maxHeight = 680, compact = false, responsive = false, initialFocus, actions, describedBy, role = 'dialog', onClose, children }: Props) {
  const id = useId()
  const ref = useRef<HTMLDialogElement>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const closingRef = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [phase, setPhase] = useState('')

  const close = useCallback(() => {
    if (closingRef.current)
      return
    closingRef.current = true
    setPhase('is-closing')
    timerRef.current = window.setTimeout(() => onCloseRef.current(), tokenMs('--modal-close-dur', 150))
  }, [])

  useLayoutEffect(() => {
    const dialog = ref.current!
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    initialFocus?.current?.focus({ preventScroll: true })
    if (scrollLocks++ === 0) {
      previousOverflow = document.documentElement.style.overflow
      document.documentElement.style.overflow = 'hidden'
    }
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (!closingRef.current)
          setPhase('is-open')
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      window.clearTimeout(timerRef.current)
      closingRef.current = false
      dialog.close()
      if (--scrollLocks === 0)
        document.documentElement.style.overflow = previousOverflow
      if (trigger?.isConnected)
        trigger.focus({ preventScroll: true })
    }
  }, [initialFocus])

  return (
    <dialog
      ref={ref}
      className={`${styles.backdrop} ${responsive ? styles.responsive : ''}`}
      role={role}
      aria-labelledby={id}
      aria-describedby={describedBy}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape')
          event.stopPropagation()
      }}
      onMouseDown={event => event.target === event.currentTarget && close()}
    >
      <section className={`${styles.surface} pf-flex pf-flex-col pf-overflow-hidden pf-border pf-border-solid pf-border-line pf-rounded-[8px] pf-bg-raise pf-[box-shadow:0_24px_80px_rgb(0_0_0_/_55%)] t-modal ${phase}`} style={{ width: `min(${width}px, 100%)`, maxHeight: `min(${maxHeight}px, 90vh)` }}>
        <header className={`${styles.header} ${compact ? styles.compact : ''} pf-flex pf-items-center pf-justify-between pf-gap-[16px]`}>
          <div>
            {eyebrow ? <p className="pf-m-[0_0_4px] pf-text-signal pf-font-mono pf-text-[0.68rem] pf-uppercase">{eyebrow}</p> : null}
            <h2 id={id}>{title}</h2>
          </div>
          <div className="pf-flex pf-items-center pf-gap-[4px]">
            {actions}
            <IconButton label="关闭" onClick={close}><X /></IconButton>
          </div>
        </header>
        {typeof children === 'function' ? children(close) : children}
      </section>
    </dialog>
  )
}
