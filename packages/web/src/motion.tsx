/* eslint-disable react-refresh/only-export-components -- shared motion hooks live next to the wrappers that use them */
import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export function tokenMs(name: string, fallback: number) {
  if (typeof window === 'undefined')
    return fallback
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    return 0
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(value) ? value : fallback
}

type Phase = 'idle' | 'open' | 'closing'

export function usePresence(open: boolean, closeVar: string, fallback: number) {
  const [mounted, setMounted] = useState(open)
  const [phase, setPhase] = useState<Phase>(open ? 'idle' : 'idle')

  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- presence has to mount on the open edge */
    if (open) {
      setMounted(true)
      setPhase('idle')
      const frame = requestAnimationFrame(() => setPhase('open'))
      return () => cancelAnimationFrame(frame)
    }
    setPhase('closing')
    const timer = window.setTimeout(setMounted, tokenMs(closeVar, fallback), false)
    return () => window.clearTimeout(timer)
    /* eslint-enable react/set-state-in-effect */
  }, [closeVar, fallback, open])

  const className = phase === 'open' ? 'is-open' : phase === 'closing' ? 'is-closing' : ''
  return { mounted, className }
}

export function useDelayedClose(onClose: () => void, closeVar: string, fallback: number) {
  const [phase, setPhase] = useState<Phase>('idle')
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setPhase('open'))
    return () => cancelAnimationFrame(frame)
  }, [])
  const close = useCallback(() => {
    setPhase('closing')
    window.setTimeout(onClose, tokenMs(closeVar, fallback))
  }, [closeVar, fallback, onClose])
  const className = phase === 'open' ? 'is-open' : phase === 'closing' ? 'is-closing' : ''
  return { close, className }
}

export function ModalFrame({
  backdropClass,
  dialogClass,
  onClose,
  labelledBy,
  label,
  describedBy,
  role = 'dialog',
  children,
}: {
  backdropClass: string | undefined
  dialogClass: string | undefined
  onClose: () => void
  labelledBy?: string
  label?: string
  describedBy?: string
  role?: 'dialog' | 'alertdialog'
  children: (close: () => void) => ReactNode
}) {
  const { className, close } = useDelayedClose(onClose, '--modal-close-dur', 150)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape')
        close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  return (
    <div className={backdropClass} onMouseDown={event => event.target === event.currentTarget && close()}>
      <section
        className={`${dialogClass} t-modal ${className}`}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        aria-describedby={describedBy}
      >
        {children(close)}
      </section>
    </div>
  )
}

export function useTabsPill(barRef: RefObject<HTMLElement | null>, active: string) {
  const pillRef = useRef<HTMLSpanElement>(null)
  const firstRef = useRef(true)

  const move = useCallback((animate: boolean) => {
    const bar = barRef.current
    const pill = pillRef.current
    if (!bar || !pill)
      return
    const tab = bar.querySelector<HTMLElement>('.t-tab[aria-selected="true"]')
    if (!tab)
      return
    if (!animate) {
      const previous = pill.style.transition
      pill.style.transition = 'none'
      pill.style.transform = `translateX(${tab.offsetLeft}px)`
      pill.style.width = `${tab.offsetWidth}px`
      void pill.offsetWidth
      pill.style.transition = previous
      return
    }
    pill.style.transform = `translateX(${tab.offsetLeft}px)`
    pill.style.width = `${tab.offsetWidth}px`
  }, [barRef])

  useLayoutEffect(() => {
    if (!barRef.current) {
      firstRef.current = true
      return
    }
    move(!firstRef.current)
    firstRef.current = false
  }, [active, barRef, move])

  useEffect(() => {
    function onResize() {
      move(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [move])

  return pillRef
}

export function ThinkLine({ text, sizer, className }: { text: string, sizer?: string, className?: string }) {
  const boxRef = useRef<HTMLSpanElement>(null)
  const shownRef = useRef(text)
  const [line, setLine] = useState(text)
  const [outgoing, setOutgoing] = useState<string | null>(null)
  const [entering, setEntering] = useState(false)

  useLayoutEffect(() => {
    if (text === shownRef.current)
      return
    const previous = shownRef.current
    shownRef.current = text
    /* eslint-disable react/set-state-in-effect -- swap needs the outgoing copy in the same frame */
    setOutgoing(previous || null)
    setLine(text)
    setEntering(true)
    /* eslint-enable react/set-state-in-effect */
    const swap = tokenMs('--think-swap', 150)
    const gap = tokenMs('--think-gap', 50)
    const release = window.setTimeout(() => {
      void boxRef.current?.offsetWidth
      setEntering(false)
    }, gap)
    const remove = window.setTimeout(setOutgoing, swap + gap, null)
    return () => {
      window.clearTimeout(release)
      window.clearTimeout(remove)
    }
  }, [text])

  if (!text && !line && !outgoing)
    return null

  return (
    <span ref={boxRef} className={`t-think ${className ?? ''}`} role="status">
      <span className="t-think-sizer" aria-hidden="true">{sizer ?? (text || line)}</span>
      {outgoing
        ? <span className="t-think-text is-exit" data-text={outgoing}>{outgoing}</span>
        : null}
      {line
        ? <span className={`t-think-text ${entering ? 'is-enter-start' : ''}`} data-text={line}>{line}</span>
        : null}
    </span>
  )
}

export function TextSwap({ text, className }: { text: string, className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shownRef = useRef(text)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || text === shownRef.current)
      return
    const duration = tokenMs('--text-swap-dur', 150)
    el.classList.add('is-exit')
    const timer = window.setTimeout(() => {
      el.textContent = text
      shownRef.current = text
      el.classList.remove('is-exit')
      el.classList.add('is-enter-start')
      void el.offsetHeight
      el.classList.remove('is-enter-start')
    }, duration)
    return () => window.clearTimeout(timer)
  }, [text])

  return <span ref={ref} className={`t-text-swap ${className ?? ''}`}>{text}</span>
}

export function AccChevron() {
  return (
    <span className="t-acc-chevron" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="12" height="12">
        <path d="M4 6.5L8 10.5L12 6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </span>
  )
}

export function TooltipGroup({ children, className }: { children: ReactNode, className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const group = ref.current
    if (!group)
      return
    const tip = group.querySelector<HTMLElement>('.t-tt')
    const label = tip?.querySelector('.t-tt-text')
    if (!tip || !label)
      return

    const groupEl = group
    const tipEl = tip
    const labelEl = label

    function hide() {
      tipEl.setAttribute('data-show', 'false')
      tipEl.setAttribute('aria-hidden', 'true')
    }

    function place(trigger: Element) {
      const showing = tipEl.getAttribute('data-show') === 'true'
      labelEl.textContent = trigger.getAttribute('data-tooltip') || ''
      const computed = getComputedStyle(tipEl)
      const width = Math.ceil(
        labelEl.scrollWidth + Number.parseFloat(computed.paddingLeft) + Number.parseFloat(computed.paddingRight),
      )
      const groupBox = groupEl.getBoundingClientRect()
      const box = trigger.getBoundingClientRect()
      const x = box.left - groupBox.left + box.width / 2 - width / 2
      if (!showing) {
        tipEl.style.transition = 'none'
        tipEl.style.width = `${width}px`
        tipEl.style.setProperty('--tt-x', `${x}px`)
        void tipEl.offsetWidth
        tipEl.style.transition = ''
      }
      else {
        tipEl.style.width = `${width}px`
        tipEl.style.setProperty('--tt-x', `${x}px`)
      }
      tipEl.setAttribute('data-show', 'true')
      tipEl.setAttribute('aria-hidden', 'false')
    }

    const triggers = [...group.querySelectorAll('.t-tt-trigger')]
    const onEnter = (event: Event) => place(event.currentTarget as Element)
    for (const trigger of triggers) {
      trigger.addEventListener('pointerenter', onEnter)
      trigger.addEventListener('focus', onEnter)
      trigger.addEventListener('blur', hide)
    }
    group.addEventListener('pointerleave', hide)
    return () => {
      for (const trigger of triggers) {
        trigger.removeEventListener('pointerenter', onEnter)
        trigger.removeEventListener('focus', onEnter)
        trigger.removeEventListener('blur', hide)
      }
      group.removeEventListener('pointerleave', hide)
    }
  }, [children])

  return (
    <span ref={ref} className={`t-tt-group ${className ?? ''}`}>
      {children}
      <span className="t-tt" role="tooltip" aria-hidden="true" data-show="false">
        <span className="t-tt-text" />
      </span>
    </span>
  )
}
