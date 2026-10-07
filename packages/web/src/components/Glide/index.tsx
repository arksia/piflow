import type { ReactNode } from 'react'
import { useLayoutEffect, useRef } from 'react'
import styles from './styles.module.css'

function pinnedRow(list: HTMLElement, pin: string | undefined) {
  if (pin === undefined)
    return null
  const row = list.querySelector(`[data-glide="${CSS.escape(pin)}"]`)
  return row instanceof HTMLElement ? row : null
}

export default function Glide({ pin, className, children }: { pin?: string, className?: string, children: ReactNode }) {
  const listRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const rowRef = useRef<HTMLElement | null>(null)

  function move(row: HTMLElement, snap: boolean) {
    const pill = pillRef.current
    const list = listRef.current
    if (!pill || !list)
      return
    const jump = snap || pill.style.opacity !== '1'
    if (jump)
      pill.style.transition = 'none'
    pill.style.height = `${row.offsetHeight}px`
    pill.style.transform = `translateY(${row.offsetTop}px)`
    pill.style.opacity = '1'
    list.dataset.live = ''
    rowRef.current = row
    if (jump) {
      void pill.offsetHeight
      pill.style.transition = ''
    }
  }

  function hide() {
    const pill = pillRef.current
    const list = listRef.current
    if (pill)
      pill.style.opacity = '0'
    if (list)
      delete list.dataset.live
    rowRef.current = null
  }

  useLayoutEffect(() => {
    const list = listRef.current
    const row = list ? pinnedRow(list, pin) : null
    if (row)
      move(row, true)
    else
      hide()
  }, [pin])

  function track(target: EventTarget | null) {
    if (!(target instanceof Element))
      return
    const row = target.closest('[data-glide]')
    const list = listRef.current
    if (!(row instanceof HTMLElement) || !list || row.closest('[data-glide-list]') !== list)
      return
    if (row.hasAttribute('disabled') || row === rowRef.current)
      return
    move(row, false)
  }

  function rest() {
    const list = listRef.current
    const row = list ? pinnedRow(list, pin) : null
    if (row)
      move(row, false)
    else
      hide()
  }

  return (
    <div
      ref={listRef}
      data-glide-list=""
      className={[styles.root, className].filter(Boolean).join(' ')}
      onPointerOver={event => track(event.target)}
      onPointerLeave={rest}
      onFocus={event => track(event.target)}
    >
      <span ref={pillRef} className={styles.pill} aria-hidden="true" />
      {children}
    </div>
  )
}
