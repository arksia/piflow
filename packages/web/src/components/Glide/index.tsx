import type { ReactNode } from 'react'
import { useLayoutEffect, useRef } from 'react'
import styles from './styles.module.css'

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
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector('[aria-checked="true"], [aria-current="page"]')
    if (row instanceof HTMLElement)
      move(row, true)
  }, [pin])
  function track(target: EventTarget | null) {
    if (!(target instanceof Element))
      return
    const row = target.closest('[data-glide]')
    if (!(row instanceof HTMLElement) || row.closest('[data-glide-list]') !== listRef.current)
      return
    if (row.hasAttribute('disabled') || row === rowRef.current)
      return
    move(row, false)
  }
  return (
    <div
      ref={listRef}
      data-glide-list=""
      className={[styles.root, className].filter(Boolean).join(' ')}
      onPointerOver={event => track(event.target)}
      onFocus={event => track(event.target)}
    >
      <span ref={pillRef} className={styles.pill} aria-hidden="true" />
      {children}
    </div>
  )
}
