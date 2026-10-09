import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tokenMs, usePresence } from '../../motion'
import styles from './styles.module.css'

/**
 * antd Popover with placement topLeft: the popup's bottom-left sits on the
 * trigger's top-left. The popup is portaled, so opening it does not change layout.
 */
export default function Popover({ content, label, children }: { content: ReactNode, label: string, children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const presence = usePresence(open, '--dropdown-close-dur', 150)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(false)
  const enterRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const leaveRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  function mark(next: boolean) {
    openRef.current = next
    setOpen(next)
  }

  function show() {
    clearTimeout(leaveRef.current)
    clearTimeout(enterRef.current)
    if (openRef.current)
      return
    enterRef.current = setTimeout(mark, tokenMs('--tt-delay', 80), true)
  }

  function hide() {
    clearTimeout(enterRef.current)
    leaveRef.current = setTimeout(mark, 0, false)
  }

  useLayoutEffect(() => {
    if (presence.mounted)
      place(triggerRef.current, popupRef.current)
  }, [presence.mounted, presence.className])

  useEffect(() => {
    if (!presence.mounted)
      return
    const follow = () => place(triggerRef.current, popupRef.current)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [presence.mounted])

  useEffect(() => () => {
    clearTimeout(enterRef.current)
    clearTimeout(leaveRef.current)
  }, [])

  return (
    <>
      <span
        ref={triggerRef}
        className={styles.trigger}
        data-open={open ? '' : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {presence.mounted
        ? createPortal(
            <div
              ref={popupRef}
              className={`${styles.popup} t-dropdown ${presence.className}`}
              data-origin="bottom-left"
              role="region"
              aria-label={label}
              onPointerEnter={show}
              onPointerLeave={hide}
            >
              <div className={styles.card}>{content}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function place(trigger: HTMLElement | null, popup: HTMLDivElement | null) {
  if (!trigger || !popup)
    return
  const box = trigger.getBoundingClientRect()
  popup.style.left = `${box.left}px`
  popup.style.top = `${box.top - popup.offsetHeight}px`
}
