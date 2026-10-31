import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tokenMs, usePresence } from '../../motion'

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
        className="pf-inline-flex"
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
              className={`pf-fixed pf-z-30 pf-w-max pf-pb-[4px] t-dropdown ${presence.className}`}
              data-origin="bottom-left"
              role="region"
              aria-label={label}
              onPointerEnter={show}
              onPointerLeave={hide}
            >
              <div className="pf-[box-shadow:0_10px_34px_rgb(0_0_0_/_50%)] pf-min-w-[168px] pf-p-[8px_10px] pf-border pf-border-solid pf-border-line pf-rounded-[8px] pf-bg-raise pf-text-body pf-text-[0.75rem]">{content}</div>
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
